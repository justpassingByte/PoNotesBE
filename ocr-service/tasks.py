import os
import time
import cv2
import numpy as np
import redis
import json
import logging
from celery_worker import celery_app
from paddleocr import PaddleOCR
from engine import LayoutEngine, CardDetector, get_suit_from_color
from scorer import DecisionLayer, FallbackStrategy, DECISION_AUTO_ACCEPT, DECISION_FORCE_CORRECT
from action_parser import ActionLogParser, greedy_pot, parse_bb_value, format_bb, STREET_KEYS
import base64
from typing import Optional

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Cache DB (Redis /1)
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/1')
cache = redis.from_url(redis_url)

# Initialize Engine Singletons
ocr = PaddleOCR(use_angle_cls=False, lang='ch', show_log=False)  # ch = Chinese + English + Numbers
layout_engine   = LayoutEngine(config_path="layout_config.json")
card_detector   = CardDetector(templates_dir="templates/cards", enable_learning=True)
decision_layer  = DecisionLayer()
fallback        = FallbackStrategy()
action_parser   = ActionLogParser()


# ─── Helpers ───────────────────────────────────────────────────────────────────


def parse_card_string_with_suit(txt, bbox, padded_img):
    ranks = []
    if 'BB' in txt or len(txt) > 3 or '.' in txt or ',' in txt:
        return ranks
    x1 = int(min(pt[0] for pt in bbox))
    y1 = int(min(pt[1] for pt in bbox))
    x2 = int(max(pt[0] for pt in bbox))
    y2 = int(max(pt[1] for pt in bbox))
    roi = padded_img[y1:y2, x1:x2]
    if txt == '10':
        return ['10' + get_suit_from_color(roi)]
    char_w = (x2 - x1) // max(1, len(txt))
    for i, char in enumerate(txt):
        if char in ['A','K','Q','J','T','9','8','7','6','5','4','3','2']:
            c_roi = roi[:, i*char_w:(i+1)*char_w] if char_w > 0 else roi
            ranks.append(char + get_suit_from_color(c_roi))
    return ranks


def detect_game_phase(board_cards: list) -> str:
    count = len([c for c in board_cards if c and c != '??'])
    if count == 0: return "preflop"
    if count <= 3: return "flop"
    if count == 4: return "turn"
    return "river"


# ─── Main Celery Task ──────────────────────────────────────────────────────────

@celery_app.task(name="tasks.process_hand")
def process_hand(image_hex: str, image_hash: str):
    """
    Main OCR processing task with hybrid validation pipeline.
    Returns structured hand data + confidence breakdown.
    """
    # ── HOTFIX: Always reload global templates so we don't use stale worker memory ──
    card_detector._load_templates()
    
    start_time = time.time()
    try:
        # 1. Decode Image (Handle both Hex and Base64/DataURL)
        if "," in image_hex: # Handle Data URL
            image_hex = image_hex.split(",")[1]
            
        try:
            img_bytes = bytes.fromhex(image_hex)
        except ValueError:
            img_bytes = base64.b64decode(image_hex)
            
        nparr = np.frombuffer(img_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")

        # 2. Layout Detection (multi-signal scoring)
        match = layout_engine.match_layout(img, ocr_engine=ocr)
        if not match:
            t_fail = time.time()
            logger.warning(f"[tasks] No layout matched for {image_hash}. Falling back to raw OCR.")
            results = ocr.ocr(img, cls=True)
            return {
                "status": "success",
                "site": "unknown",
                "performance": {
                    "total_ms": round((t_fail - start_time) * 1000),
                    "ocr_only": True
                },
                "result": {"raw": str(results)}
            }

        layout, layout_score = match
        layout_name = layout['name']
        regions     = layout['regions']
        t_layout = time.time()
        logger.info(f"[tasks] Layout: {layout_name} (score={layout_score:.3f})")

        # 3. Board Card Detection
        board_cards  = []
        card_info    = []  # Initialize outside conditional for use in self-learning
        cv_conf_avg  = 0.0
        board_img    = None

        if 'board_cards' in regions:
            board_img = layout_engine.crop_region(img, regions['board_cards'])
            res = card_detector.detect_cards_with_info(board_img, ocr_engine=ocr)
            card_info = res.get('cards', []) if isinstance(res, dict) else res
            is_reliable = res.get('is_reliable', False) if isinstance(res, dict) else False

            # Fallback if primary detection produced nothing useful
            if not card_info or all(c['name'] == '??' for c in card_info):
                logger.info("[tasks] Primary detection weak — running FallbackStrategy.")
                card_info = fallback.apply(board_img, card_detector, ocr, game_phase=None)

            board_cards = [item['name'] for item in card_info]

            # Average CV confidence (excluding unknown cards)
            valid_confs = [item['confidence'] for item in card_info if item['name'] != '??']
            cv_conf_avg = sum(valid_confs) / len(valid_confs) if valid_confs else 0.0

        # Pad board to always 5 cards (standard poker board)
        board_cards = [c for c in board_cards if c != '??'][:5]
        while len(board_cards) < 5:
            board_cards.append('??')

        # 4. Game Phase Prediction
        game_phase = detect_game_phase(board_cards)
        t_detection = time.time()

        # 5. (Removed: redundant re-detect — game_phase was unused in detect_cards_with_info)

        # 6. Hybrid Validation → Decision Layer
        validation_ok = (3 <= len([c for c in board_cards if c != '??']) <= 5)

        # Collect validation reasons for decision_reason
        validation_reasons = []
        if not validation_ok:
            validation_reasons.append("board_count_invalid")
        if any(c == '??' for c in board_cards):
            validation_reasons.append("unknown_cards_detected")

        outcome = decision_layer.evaluate(
            board_cards   = board_cards,
            cv_confidence = cv_conf_avg,
            game_phase    = game_phase,
            validation_ok = validation_ok,
            reasons       = validation_reasons,
        )
        t_validation = time.time()

        logger.info(f"[tasks] Decision: {outcome['decision']} | Final conf: {outcome['final']:.3f}")

        # 7. Self-Learning — learn from high-confidence OCR detections
        # Runs on both AUTO_ACCEPT and FORCE_CORRECT (if conf is high enough)
        if board_img is not None:
            for item in card_info:
                name = item['name']
                if not name or name == '??':
                    continue

                if item.get('is_new'):
                    # OCR-detected card: save as new template if confidence >= 0.75
                    # (PaddleOCR text conf rarely exceeds 0.95, so 0.95 was too strict)
                    if item['confidence'] >= 0.75:
                        logger.info(f"[LEARN] New card '{name}' via OCR (conf={item['confidence']:.2f}) — saving template.")
                        card_detector.learn_card(item['image'], name, verification_source='high_confidence', layout_name=layout_name)
                else:
                    # Template-matched card: reinforce to reset decay clock on last_used
                    if item['confidence'] >= 0.92 and outcome['decision'] == DECISION_AUTO_ACCEPT:
                        card_detector.learn_card(item['image'], name, verification_source='high_confidence', layout_name=layout_name)

        # 8. Pot OCR
        raw_pot_text = ""
        if 'pot_area' in regions:
            pot_img = layout_engine.crop_region(img, regions['pot_area'])
            pot_res = ocr.ocr(pot_img, cls=True)
            raw_pot_text = pot_res[0][0][1][0] if pot_res and pot_res[0] else ""

        # 9. Action Log Parsing (5-phase matrix from action_parser.py)
        streets_data = {}
        street_pots = {}
        if 'action_log' in regions:
            action_img = layout_engine.crop_region(img, regions['action_log'])
            action_ocr = ocr.ocr(action_img, cls=True)

            # Calculate sidebar boundary in action_img coordinates
            sidebar_x = None
            if 'sidebar' in regions:
                ah, aw = action_img.shape[:2]
                sidebar_x1_ratio = regions['sidebar']['x1']
                action_x1_ratio = regions['action_log']['x1']
                action_x2_ratio = regions['action_log']['x2']
                action_range = action_x2_ratio - action_x1_ratio
                sidebar_x = int((sidebar_x1_ratio - action_x1_ratio) / action_range * aw) if action_range > 0 else None

            parsed_actions = action_parser.parse(
                action_img, action_ocr, card_detector, ocr,
                sidebar_x=sidebar_x, layout_name=layout_name
            )
            streets_data = parsed_actions['streets']
            street_pots = parsed_actions['street_pots']



        # 11. Showdown Detection — detect card pairs then OCR to map to player names
        showdown_cards = {}
        if 'showdown_area' in regions:
            showdown_img = layout_engine.crop_region(img, regions['showdown_area'])
            sd_info = card_detector.detect_cards_with_info(showdown_img, ocr_engine=ocr)
            sd_cards_list = sd_info.get('cards', []) if isinstance(sd_info, dict) else []

            # Group detected cards by 'row' index (each row = one player's pair)
            sd_by_row: dict = {}
            for item in sd_cards_list:
                row_idx = item.get('row', 0)
                sd_by_row.setdefault(row_idx, [])
                if isinstance(item, dict):
                    sd_by_row[row_idx].append(item)

            # Collect all known player names from action log (candidate set)
            known_players: set = set()
            for sk in STREET_KEYS:
                for e in streets_data.get(sk, []):
                    if isinstance(e, dict) and e.get('player'):
                        known_players.add(e['player'])

            # OCR the showdown area to find player name text near each card group
            sd_ocr_results = ocr.ocr(showdown_img, cls=True)
            sd_text_boxes: list = []
            if sd_ocr_results and sd_ocr_results[0]:
                for line in sd_ocr_results[0]:
                    text = line[1][0].strip()
                    x_c = sum(p[0] for p in line[0]) / 4.0
                    y_c = sum(p[1] for p in line[0]) / 4.0
                    if text in known_players:
                        sd_text_boxes.append({'text': text, 'x': x_c, 'y': y_c})

            for slot_idx, (row_idx, cards_in_row) in enumerate(sd_by_row.items()):
                cards = [c['name'] for c in cards_in_row if isinstance(c, dict) and c['name'] != '??'][:2]
                if not cards:
                    continue

                avg_x = sum(c['center'][0] for c in cards_in_row if isinstance(c, dict)) / max(len(cards_in_row), 1)
                avg_y = sum(c['center'][1] for c in cards_in_row if isinstance(c, dict)) / max(len(cards_in_row), 1)

                best_name: str = ''
                best_dist: float = 300.0
                for tb in sd_text_boxes:
                    dist = ((tb['x'] - avg_x) ** 2 + (tb['y'] - avg_y) ** 2) ** 0.5
                    if dist < best_dist:
                        best_dist = dist
                        best_name = tb['text']

                slot_key = best_name if best_name else f"player_{slot_idx + 1}"
                showdown_cards[slot_key] = cards

            if showdown_cards:
                logger.info(f"[tasks] Showdown detected: {showdown_cards}")

        # 11b. Build unified player_hands map
        player_hands: dict = {}

        # Source 1: hands spotted in the action log next to a named player
        for street_key in STREET_KEYS:
            for entry in streets_data.get(street_key, []):
                if not isinstance(entry, dict):
                    continue
                cards = [c for c in entry.get('hand', []) if c and c != '??']
                if cards and entry.get('player'):
                    name = entry['player']
                    existing = player_hands.get(name, [])
                    merged = (existing + cards)[:2]
                    # If 2 identical cards → suit must be wrong on at least one
                    if len(merged) == 2 and merged[0] == merged[1] and len(merged[0]) >= 2:
                        rank = merged[0][:-1]
                        merged = [f"{rank}?", f"{rank}?"]
                    player_hands[name] = merged

        # Source 2: showdown area cards (only add if player not already known)
        for slot_key, pair in showdown_cards.items():
            if slot_key not in player_hands:
                player_hands[slot_key] = pair



        # 11d. Strip 'hand' and 'card_images' from all street action entries
        for sk in STREET_KEYS:
            for entry in streets_data.get(sk, []):
                if isinstance(entry, dict):
                    entry.pop('hand', None)
                    entry.pop('card_images', None)

        logger.info(f"[tasks] player_hands: {player_hands}")

        # 11c. Build positions map: player_name -> position label
        # Scan streets in priority order; first match wins so blinds/preflop
        # (most reliable) take precedence over later streets.
        positions: dict = {}
        for sk in STREET_KEYS:  # blinds_ante first
            for entry in streets_data.get(sk, []):
                if not isinstance(entry, dict):
                    continue
                name = entry.get('player', '').strip()
                pos  = entry.get('pos', '').strip()
                if name and pos and name not in positions:
                    positions[name] = pos
        logger.info(f"[tasks] positions: {positions}")

        # Strip pos from action entries — positions are in the 'positions' object
        for sk in STREET_KEYS:
            for entry in streets_data.get(sk, []):
                if isinstance(entry, dict):
                    entry.pop('pos', None)

        # 12. Build hand data (using ActionLogParser output directly)
        # Pot finalization
        pot_final_text = greedy_pot(raw_pot_text)
        pot_value = parse_bb_value(pot_final_text)
        # Check if any street pot is larger
        for sk in STREET_KEYS:
            val = parse_bb_value(street_pots.get(sk, '0'))
            if val > pot_value:
                pot_value = val
        pot_final = format_bb(pot_value)

        hand_data = {
            "pot": pot_final,
            "board": board_cards,
            "player_hands": player_hands,
            "positions": positions,
            "streets": streets_data,
            "showdown": showdown_cards,
            "metadata": {"street_pots": street_pots}
        }

        t_end = time.time()

        # 12. Final Result with confidence_breakdown + latency breakdown
        final_result = {
            "status":             "success",
            "site":               layout.get('site', 'unknown'),
            "layout":             layout_name,
            "variant":            layout.get('variant', 'desktop'),
            "game_phase":         game_phase,
            "decision":           outcome['decision'],
            "decision_reason":    outcome.get('decision_reason', []),
            "needs_confirmation": outcome['decision'] != DECISION_AUTO_ACCEPT,
            "confidence": {
                "total":      outcome['final'],
                "breakdown":  outcome['breakdown'],
                "llm_issues": outcome['llm_review'].get('issues', []),
            },
            "data":     hand_data,
            "performance": {
                "total_ms":          round((t_end - start_time) * 1000),
                "stage_latency_ms": {
                    "layout":     round((t_layout    - start_time)  * 1000),
                    "detection":  round((t_detection - t_layout)    * 1000),
                    "recognition":round((t_validation - t_detection)* 1000),
                    "validation": round((t_end       - t_validation)* 1000),
                },
            }
        }

        # OCR Output Caching Disabled (Self-learning engine requirement)
        # cache.set(f"hash:{image_hash}", json.dumps(final_result), ex=3600*24)
        return final_result

    except Exception as e:
        logger.error(f"[tasks] Task failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# ─── Feedback Endpoint Task (Phase 4) ──────────────────────────────────────────

@celery_app.task(name="tasks.apply_feedback")
def apply_feedback(
    image_hex: str,
    card_name: str,
    action: str,            # "confirm" | "edit" | "reject"
    corrected_name: str = "",
    card_index: Optional[int] = None
):
    """
    Processes user feedback from the Confirmation / Correction UI.
    action="confirm"  → learn with verification_source='user_confirmed'
    action="edit"     → learn corrected card as 'user_corrected' (gold label)
    action="reject"   → log to failed_cases, no learning
    """
    try:
        # 1. Decode Image (Handle both Hex and Base64/DataURL)
        if "," in image_hex: # Handle Data URL
            image_hex = image_hex.split(",")[1]
            
        try:
            img_bytes = bytes.fromhex(image_hex)
        except ValueError:
            img_bytes = base64.b64decode(image_hex)
            
        nparr = np.frombuffer(img_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")

        # 2. Re-detect to find the specific ROI for the feedback
        # We need to know WHERE the card was to learn it correctly.
        match = layout_engine.match_layout(img, ocr_engine=ocr)
        if not match:
             return {"status": "error", "error": "Could not match layout for feedback image"}
        
        layout, _ = match
        regions = layout['regions']
        layout_name = layout.get('name')
        
        # We focus on board cards for learning for now
        if 'board_cards' not in regions:
             return {"status": "error", "error": "No board_cards region in layout"}
             
        board_img = layout_engine.crop_region(img, regions['board_cards'])
        fb_res = card_detector.detect_cards_with_info(board_img, ocr_engine=ocr)
        fb_card_info = fb_res.get('cards', []) if isinstance(fb_res, dict) else []
        
        # Find the slot that corresponds to the card_name (the one the user is confirming or replacing)
        target_roi = None
        if card_index is not None and card_index < len(fb_card_info):
            target_roi = fb_card_info[card_index]['image']
        else:
            for item in fb_card_info:
                if item['name'] == card_name:
                    target_roi = item['image']
                    break
        
        if target_roi is None and action != "reject":
            # If we can't find the exact card, try finding any card if it's the only one?
            # Or just fail safely.
            logger.warning(f"[feedback] Could not find ROI for '{card_name}' in image. Learning whole region as fallback.")
            target_roi = board_img # Better than the whole screenshot, but still slightly risky.

        if action == "confirm":
            if card_name == "all_board":
                for item in fb_card_info:
                    if item['name'] != '??':
                        card_detector.learn_card(item['image'], item['name'], verification_source='user_confirmed', layout_name=layout_name)
                logger.info(f"[feedback] User CONFIRMED ALL BOARD CARDS → {len(fb_card_info)} templates reinforced.")
            elif card_index is not None and card_index < len(fb_card_info):
                item = fb_card_info[card_index]
                card_detector.learn_card(item['image'], item['name'], verification_source='user_confirmed', layout_name=layout_name)
                logger.info(f"[feedback] User CONFIRMED '{item['name']}' → template reinforced.")
            return {"status": "ok", "action": action, "card": card_name}

        elif action == "edit" and corrected_name:
            # Phase 3: Penalize the wrong template if we had one
            if card_index is not None and card_index < len(fb_card_info):
                bad_item = fb_card_info[card_index]
                bad_filename = bad_item.get('matched_filename')
                if bad_filename:
                    card_detector.report_error(bad_filename)
                
                # Learn the new one
                card_detector.learn_card(bad_item['image'], corrected_name, verification_source='user_corrected', layout_name=layout_name)
                logger.info(f"[feedback] User CORRECTED index {card_index} to '{corrected_name}'.")
            return {"status": "ok", "action": action, "card": corrected_name}

        else:  # reject — or edit without correction
            # Log the problematic board region
            card_detector.learn_card(
                board_img if 'board_img' in locals() else img, 
                card_name,
                verification_source='rejected',
                failed_cases_dir="failed_cases",
                layout_name=layout_name
            )
            logger.info(f"[feedback] User REJECTED '{card_name}' → logged to failed_cases/.")
            return {"status": "ok", "action": "reject", "card": card_name}

    except Exception as e:
        logger.error(f"[feedback] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
