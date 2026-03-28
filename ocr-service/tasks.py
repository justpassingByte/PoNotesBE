import os
import time
import cv2
import numpy as np
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from celery_worker import celery_app
from paddleocr import PaddleOCR
from engine import LayoutEngine, CardDetector
from scorer import DecisionLayer, FallbackStrategy, DECISION_AUTO_ACCEPT, DECISION_FORCE_CORRECT
from action_parser import ActionLogParser, greedy_pot, parse_bb_value, format_bb, STREET_KEYS
import base64
from typing import Optional

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Initialize Engine Singletons
ocr = PaddleOCR(
    use_angle_cls=False, lang='ch', show_log=False,
    use_gpu=False, enable_mkldnn=True, cpu_threads=2,
    ocr_version='PP-OCRv4',       # PP-OCRv4 mobile (faster inference, +4.5% accuracy)
    det_db_thresh=0.3,             # slightly lower threshold for small poker text
)
layout_engine   = LayoutEngine(config_path="layout_config.json")
card_detector   = CardDetector(templates_dir="templates")
decision_layer  = DecisionLayer()
fallback        = FallbackStrategy()
action_parser   = ActionLogParser()


# ─── Helpers ───────────────────────────────────────────────────────────────────


def _ocr_region(img, region_key, regions):
    """Crop a region and run OCR on it. Returns (region_key, crop, ocr_result)."""
    if region_key not in regions:
        return region_key, None, None
    crop = layout_engine.crop_region(img, regions[region_key])
    result = ocr.ocr(crop, cls=False)
    return region_key, crop, result


def detect_game_phase(board_cards: list) -> str:
    count = len([c for c in board_cards if c and c != '??'])
    if count == 0: return "preflop"
    if count <= 3: return "flop"
    if count == 4: return "turn"
    return "river"


# ─── Main Celery Task ──────────────────────────────────────────────────────────

# ─── OCR Warm-up ───────────────────────────────────────────────────────────────
# Eliminate cold-start penalty: first PaddleOCR call loads model weights (~2-3s).
# Do it now at module import so the first real request is fast.

def _warmup():
    try:
        dummy = np.zeros((100, 100, 3), dtype=np.uint8)
        ocr.ocr(dummy, cls=False)
        logger.info("[tasks] OCR warm-up complete")
    except Exception as e:
        logger.warning(f"[tasks] OCR warm-up failed (non-fatal): {e}")

_warmup()


# ─── Core pipeline (accepts raw bytes) ─────────────────────────────────────────

def process_hand_bytes(img_bytes: bytes, image_hash: str):
    """
    Core OCR pipeline. Accepts raw image bytes directly (no encoding overhead).
    Called by /ocr/sync endpoint and internally by the Celery task.
    """
    card_detector.reload_if_changed()

    start_time = time.time()
    try:
        nparr = np.frombuffer(img_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")
        logger.info(f"[tasks] Image received: {img.shape[1]}x{img.shape[0]} ({len(img_bytes)} bytes)")

        # 2. Layout Detection (template-only, no OCR needed)
        match = layout_engine.match_layout(img)
        if not match:
            t_fail = time.time()
            logger.warning(f"[tasks] No layout matched for {image_hash}. Falling back to raw OCR.")
            results = ocr.ocr(img, cls=False)
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
        logger.info(f"[tasks] Layout: {layout_name} (score={layout_score:.3f}) [{(t_layout - start_time)*1000:.0f}ms]")

        # 3. Board Card Detection (template-only, no OCR)
        board_cards  = []
        card_info    = []
        cv_conf_avg  = 0.0
        board_img    = None

        if 'board_cards' in regions:
            board_img = layout_engine.crop_region(img, regions['board_cards'])
            res = card_detector.detect_cards_with_info(board_img, context="board")
            card_info = res.get('cards', []) if isinstance(res, dict) else res
            is_reliable = res.get('is_reliable', False) if isinstance(res, dict) else False

            # Fallback if primary detection produced nothing useful
            if not card_info or all(c['name'] == '??' for c in card_info):
                logger.info("[tasks] Primary detection weak — running FallbackStrategy.")
                card_info = fallback.apply(board_img, card_detector, game_phase=None)

        # Smart gap-based padding: use X positions to detect missing cards
        if card_info:
            # Sort by X position (left to right)
            sorted_cards = sorted(card_info, key=lambda c: c['rect'][0])
            
            # Calculate gaps between consecutive cards
            board_cards_ordered = []
            if len(sorted_cards) < 5 and len(sorted_cards) >= 2:
                # Find the average card width + gap
                widths = [c['rect'][2] for c in sorted_cards]
                avg_w = sum(widths) / len(widths)
                
                # Check for large gaps (>1.5x expected card width+gap)
                for i, card in enumerate(sorted_cards):
                    if i > 0:
                        prev_end = sorted_cards[i-1]['rect'][0] + sorted_cards[i-1]['rect'][2]
                        curr_start = card['rect'][0]
                        gap = curr_start - prev_end
                        # If gap is larger than expected (>1.3x avg card width), insert ??
                        if gap > avg_w * 1.3:
                            board_cards_ordered.append('??')
                    board_cards_ordered.append(card['name'])
            else:
                board_cards_ordered = [c['name'] for c in sorted_cards]
            
            # Pad remaining to 5 cards at the end
            while len(board_cards_ordered) < 5:
                board_cards_ordered.append('??')
            board_cards = board_cards_ordered[:5]
        else:
            board_cards = ['??'] * 5

        # Average CV confidence (excluding unknown cards)
        valid_confs = [item['confidence'] for item in card_info if item['name'] != '??'] if card_info else []
        cv_conf_avg = sum(valid_confs) / len(valid_confs) if valid_confs else 0.0

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

        # 7. Sequential Per-Region OCR — pot, action_log (PaddleOCR is not thread-safe)
        t_ocr_start = time.time()
        ocr_regions = ['pot_area', 'action_log']
        ocr_results = {}  # region_key -> (crop, ocr_result)

        for rk in ocr_regions:
            _, crop, result = _ocr_region(img, rk, regions)
            ocr_results[rk] = (crop, result)

        t_ocr = time.time()
        logger.info(f"[tasks] Parallel OCR (pot+action) completed in {(t_ocr - t_ocr_start)*1000:.0f}ms")

        # 8. Pot
        raw_pot_text = ""
        pot_crop, pot_res = ocr_results.get('pot_area', (None, None))
        if pot_res and pot_res[0]:
            raw_pot_text = " ".join([line[1][0] for line in pot_res[0]])

        # 9. Action Log Parsing
        streets_data = {}
        street_pots = {}
        action_img, action_ocr = ocr_results.get('action_log', (None, None))
        if action_img is not None:
            parsed_actions = action_parser.parse(
                action_img, action_ocr, card_detector, None,
                layout_name=layout_name
            )
            streets_data = parsed_actions['streets']
            street_pots = parsed_actions['street_pots']

        # 10. Extract player hands and clean up
        RANK_ORDER = {'A': 0, 'K': 1, 'Q': 2, 'J': 3, 'T': 4, '9': 5, '8': 6, '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12}
        def sort_hand(cards):
            return sorted(cards, key=lambda c: RANK_ORDER.get(c[0], 99) if c else 99)

        player_hands = {}
        for s in STREET_KEYS:
            for e in streets_data.get(s, []):
                if isinstance(e, dict) and e.get('hand') and e.get('player'):
                    sorted_h = sort_hand(e['hand'])
                    e['hand'] = sorted_h
                    player_hands[e['player']] = sorted_h
                
                # Cleanup output
                if isinstance(e, dict):
                    e.pop('image', None)
                    e.pop('card_images', None)
                    e.pop('card_objs', None)
                    e.pop('hand', None)
                    if s == 'showdown':
                        e.pop('action', None)

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
            "metadata": {"street_pots": street_pots}
        }

        # 12b. Build winner/losers from showdown entries
        winner_entry = {"player": None, "amount": None}
        loser_entries = []
        for e in streets_data.get('showdown', []) + streets_data.get('river', []):
            if not isinstance(e, dict):
                continue
            amt = str(e.get('amount', '')).strip()
            if e.get('action') == 'WINNER' or amt.startswith('+'):
                if not winner_entry.get('player'):
                    p_name = e.get('player', '')
                    winner_entry = {
                        "player": p_name,
                        "amount": amt,
                        "hand": player_hands.get(p_name, [])
                    }
            elif e.get('action') == 'LOSER' or amt.startswith('-'):
                p_name = e.get('player', '')
                loser_entries.append({
                    "player": p_name,
                    "amount": amt,
                    "hand": player_hands.get(p_name, [])
                })
        if not winner_entry.get('player'):
            wi = streets_data.get('winner', {})
            if wi:
                winner_entry = wi

        # 12c. Build summary (per-player action history + hands)
        final_summary = {
            "board": board_cards,
            "pot": street_pots.get('river', pot_final),
            "winner": winner_entry,
            "players": {}
        }
        for sk in STREET_KEYS:
            for act in streets_data.get(sk, []):
                if not isinstance(act, dict):
                    continue
                p_name = act.get('player', '')
                if not p_name:
                    continue
                if p_name not in final_summary["players"]:
                    final_summary["players"][p_name] = {"hand": [], "actions": []}
                final_summary["players"][p_name]["actions"].append({
                    "street": sk,
                    "action": act.get('action', ''),
                    "amount": act.get('amount', '')
                })
        for p_name, cards in player_hands.items():
            if p_name not in final_summary["players"]:
                final_summary["players"][p_name] = {"hand": [], "actions": []}
            final_summary["players"][p_name]["hand"] = cards

        hand_data["summary"] = final_summary
        hand_data["winner"] = winner_entry
        hand_data["losers"] = loser_entries

        logger.info(f"[tasks] Winner: {winner_entry.get('player')} | Losers: {[l['player'] for l in loser_entries]}")

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

        return final_result

    except Exception as e:
        logger.error(f"[tasks] Task failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}

# ─── Celery Task Wrapper ───────────────────────────────────────────────────────

@celery_app.task(name="tasks.process_hand")
def process_hand(image_data: str, image_hash: str):
    """
    Celery-compatible wrapper. Accepts base64 or hex encoded image data,
    decodes to bytes, then delegates to process_hand_bytes().
    """
    # Handle Data URL prefix
    if "," in image_data:
        image_data = image_data.split(",")[1]

    # Decode: try base64 first (more efficient), fall back to hex
    try:
        img_bytes = base64.b64decode(image_data)
    except Exception:
        img_bytes = bytes.fromhex(image_data)

    return process_hand_bytes(img_bytes, image_hash)


# ─── Feedback Endpoint Task (Phase 4) ──────────────────────────────────────────

def apply_feedback_bytes(
    img_bytes: bytes,
    card_name: str,
    action: str,            # "confirm" | "edit" | "reject"
    corrected_name: str = "",
    card_index: Optional[int] = None
):
    """
    Processes user feedback directly from bytes.
    action="confirm"  → learn with verification_source='user_confirmed'
    action="edit"     → learn corrected card as 'user_corrected' (gold label)
    action="reject"   → log to failed_cases, no learning
    """
    try:
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
        
        # We gather cards from both board and action log to support all corrections
        fb_card_info = []
        
        if 'board_cards' in regions:
            board_img = layout_engine.crop_region(img, regions['board_cards'])
            fb_res = card_detector.detect_cards_with_info(board_img, ocr_engine=ocr)
            fb_card_info.extend(fb_res.get('cards', []) if isinstance(fb_res, dict) else [])
            
        if 'action_log' in regions:
            action_img = layout_engine.crop_region(img, regions['action_log'])
            # Only right half of action log usually contains the small player cards
            ah, aw = action_img.shape[:2]
            river_x1 = int(aw * 0.50)
            action_col = action_img[:, river_x1:aw]
            fb_res_col = card_detector.detect_cards_with_info(action_col, ocr_engine=ocr)
            fb_card_info.extend(fb_res_col.get('cards', []) if isinstance(fb_res_col, dict) else [])
            
        if not fb_card_info:
             return {"status": "error", "error": "No regions found to extract cards for feedback"}
        
        # Find the slot that corresponds to the card_name
        target_roi = None
        target_item = None
        
        # Try finding by name first (most reliable since frontend index might clash between hole/board)
        for item in fb_card_info:
            if item['name'] == card_name:
                target_item = item
                target_roi = item['image']
                break
                
        # Fallback to index if name not found (e.g., if it was '??')
        if target_roi is None and card_index is not None and card_index < len(fb_card_info):
             target_item = fb_card_info[card_index]
             target_roi = target_item['image']
        
        if target_roi is None and action != "reject":
            logger.warning(f"[feedback] Could not find ROI for '{card_name}'. Learning whole board_cards region as fallback.")
            target_roi = board_img if 'board_img' in locals() else img

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
            if target_item:
                bad_filename = target_item.get('matched_filename')
                if bad_filename:
                    card_detector.report_error(bad_filename)
                
                # Learn the new one
                card_detector.learn_card(target_item['image'], corrected_name, verification_source='user_corrected', layout_name=layout_name)
                logger.info(f"[feedback] User CORRECTED '{card_name}' to '{corrected_name}'.")
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
