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

        # 7. Self-Learning — only for AUTO ACCEPT (high confidence)
        if outcome['decision'] == DECISION_AUTO_ACCEPT and board_img is not None:
            for item in card_info:
                name = item['name']
                if item.get('is_new') and item['confidence'] >= 0.95:
                    card_detector.learn_card(item['image'], name, verification_source='high_confidence')

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
            parsed_actions = action_parser.parse(action_img, action_ocr, card_detector, ocr)
            streets_data = parsed_actions['streets']
            street_pots = parsed_actions['street_pots']

        # 10. Hero card detection
        hero_cards_detected = []
        hero_region = regions.get('hero_cards', {'x1': 0.3, 'y1': 0.34, 'x2': 0.45, 'y2': 0.45})
        hero_img = layout_engine.crop_region(img, hero_region)
        phero = cv2.copyMakeBorder(hero_img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
        h_res = ocr.ocr(phero, cls=True)
        if h_res and h_res[0]:
            for line in h_res[0]:
                txt = line[1][0].upper().replace(' ', '')
                h_cards = parse_card_string_with_suit(txt, line[0], phero)
                hero_cards_detected.extend(h_cards)
        hero_cards_detected = list(dict.fromkeys(hero_cards_detected))[:2]
        # Pad hero to always 2 cards
        while len(hero_cards_detected) < 2:
            hero_cards_detected.append('??')

        # 11. Showdown Detection
        showdown_cards = {}
        if 'showdown_area' in regions:
            showdown_img = layout_engine.crop_region(img, regions['showdown_area'])
            sd_info = card_detector.detect_cards_with_info(showdown_img, ocr_engine=ocr)
            sd_cards_list = sd_info.get('cards', []) if isinstance(sd_info, dict) else []
            all_sd_cards = [item['name'] for item in sd_cards_list if item['name'] != '??']
            for i in range(0, len(all_sd_cards), 2):
                pair = all_sd_cards[i:i+2]
                if pair:
                    showdown_cards[f"player_{i//2 + 1}"] = pair
            if showdown_cards:
                logger.info(f"[tasks] Showdown detected: {showdown_cards}")

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
            "hero_hand": hero_cards_detected,
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
                        card_detector.learn_card(item['image'], item['name'], verification_source='user_confirmed')
                logger.info(f"[feedback] User CONFIRMED ALL BOARD CARDS → {len(fb_card_info)} templates reinforced.")
            elif card_index is not None and card_index < len(fb_card_info):
                item = fb_card_info[card_index]
                card_detector.learn_card(item['image'], item['name'], verification_source='user_confirmed')
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
                card_detector.learn_card(bad_item['image'], corrected_name, verification_source='user_corrected')
                logger.info(f"[feedback] User CORRECTED index {card_index} to '{corrected_name}'.")
            return {"status": "ok", "action": action, "card": corrected_name}

        else:  # reject — or edit without correction
            # Log the problematic board region
            card_detector.learn_card(
                board_img if 'board_img' in locals() else img, 
                card_name,
                verification_source='rejected',
                failed_cases_dir="failed_cases"
            )
            logger.info(f"[feedback] User REJECTED '{card_name}' → logged to failed_cases/.")
            return {"status": "ok", "action": "reject", "card": card_name}

    except Exception as e:
        logger.error(f"[feedback] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
