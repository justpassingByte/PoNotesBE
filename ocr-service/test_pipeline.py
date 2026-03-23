"""
test_pipeline.py — End-to-end test for the merged OCR pipeline.
Tests action_parser + engine (CardDetector) without Celery/Redis.
"""

# ── Suppress ALL noisy logs BEFORE imports ──
import os
os.environ["PPOCR_LOG_LEVEL"] = "ERROR"
import warnings
warnings.filterwarnings("ignore")
import logging
logging.disable(logging.WARNING)  # Kill ALL warning/info globally
logger = logging.getLogger(__name__)
logger.setLevel(logging.ERROR)

import sys
import cv2
import numpy as np
import json
from paddleocr import PaddleOCR
from engine import LayoutEngine, CardDetector, get_suit_from_color
from action_parser import ActionLogParser, greedy_pot, parse_bb_value, format_bb, STREET_KEYS


def parse_card_string_with_suit(txt, bbox, padded_img):
    """Parse OCR text into card rank+suit (same as tasks.py)."""
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


def test_pipeline(img_path="ocrtest.png"):
    if not os.path.exists(img_path):
        print(f"[ERROR] Image not found: {img_path}")
        return

    print(f"\n{'='*60}")
    print(f"  OCR Pipeline Test: {img_path}")
    print(f"{'='*60}")

    # 1. Initialize
    ocr = PaddleOCR(use_angle_cls=False, lang='ch', show_log=False)  # ch = Chinese + English + Numbers
    layout_engine = LayoutEngine(config_path="layout_config.json")
    card_detector = CardDetector(templates_dir="templates/cards", enable_learning=True)
    action_parser = ActionLogParser()

    img = cv2.imread(img_path)
    if img is None:
        print(f"[ERROR] Failed to read image: {img_path}")
        return

    h, w = img.shape[:2]
    print(f"  Image size: {w}x{h}")

    # 2. Layout Detection
    match = layout_engine.match_layout(img, ocr_engine=ocr)
    if not match:
        print("[FAIL] No layout matched!")
        return

    layout, score = match
    layout_name = layout['name']
    regions = layout['regions']
    print(f"\n[✓] Layout: {layout_name} (score={score:.3f})")

    # 3. Board Card Detection
    print(f"\n{'─'*40}")
    print("  BOARD CARDS")
    print(f"{'─'*40}")
    board_cards = []
    if 'board_cards' in regions:
        board_img = layout_engine.crop_region(img, regions['board_cards'])
        cv2.imwrite("debug_crop_board.png", board_img)
        bh, bw = board_img.shape[:2]
        print(f"  Crop size: {bw}x{bh}")

        res = card_detector.detect_cards_with_info(board_img, ocr_engine=ocr)
        card_info = res.get('cards', []) if isinstance(res, dict) else res

        if card_info:
            for i, c in enumerate(card_info):
                src = "TEMPLATE" if not c.get('is_new') else "OCR"
                print(f"  → {c['name']} (conf={c['confidence']:.2f}, src={src})")
                # Self-learning: save high-confidence OCR cards as templates
                if c.get('is_new') and c['confidence'] >= 0.85 and c['name'] != '??':
                    print(f"  [LEARN] Saving template for: {c['name']}")
                    card_detector.learn_card(c['image'], c['name'], verification_source='high_confidence', layout_name=layout_name)
                # Interactive: ask user to correct ?? or low-confidence cards
                elif c['name'] == '??' or c['confidence'] < 0.70:
                    user_input = input(f"  [?] Card {i} is '{c['name']}'. Correct name (e.g. 9h) or Enter to skip: ").strip()
                    if user_input:
                        c['name'] = user_input
                        c['confidence'] = 1.0
                        card_detector.learn_card(c['image'], user_input, verification_source='user_corrected', layout_name=layout_name)
                        print(f"  [LEARN] User taught: {user_input}")
            board_cards = [c['name'] for c in card_info]

    # Pad board to always 5 cards
    board_cards = [c for c in board_cards if c != '??'][:5]
    while len(board_cards) < 5:
        board_cards.append('??')
    print(f"  Board: {board_cards}")


    # 5. Pot OCR
    print(f"\n{'─'*40}")
    print("  POT")
    print(f"{'─'*40}")
    raw_pot = ""
    if 'pot_area' in regions:
        pot_img = layout_engine.crop_region(img, regions['pot_area'])
        cv2.imwrite("debug_crop_pot.png", pot_img)
        pot_res = ocr.ocr(pot_img, cls=True)
        raw_pot = pot_res[0][0][1][0] if pot_res and pot_res[0] else ""
    print(f"  Raw: '{raw_pot}'")
    pot_value = parse_bb_value(greedy_pot(raw_pot))
    print(f"  Parsed: {format_bb(pot_value)}")

    # 6. Action Log Parsing
    print(f"\n{'─'*40}")
    print("  ACTION LOG (5-Phase Parser)")
    print(f"{'─'*40}")
    streets_data = {}
    street_pots = {}
    if 'action_log' in regions:
        action_img = layout_engine.crop_region(img, regions['action_log'])
        cv2.imwrite("debug_crop_action.png", action_img)
        ah, aw = action_img.shape[:2]
        print(f"  Crop size: {aw}x{ah}")

        action_ocr = ocr.ocr(action_img, cls=True)

        # Calculate sidebar boundary in action_img coordinates
        sidebar_x = None
        if 'sidebar' in regions:
            sidebar_x1_ratio = regions['sidebar']['x1']
            action_x1_ratio = regions['action_log']['x1']
            action_x2_ratio = regions['action_log']['x2']
            # sidebar position within the action_img
            action_range = action_x2_ratio - action_x1_ratio
            sidebar_x = int((sidebar_x1_ratio - action_x1_ratio) / action_range * aw) if action_range > 0 else None

        parsed = action_parser.parse(
            action_img, action_ocr, card_detector, ocr, 
            sidebar_x=sidebar_x, layout_name=layout_name
        )
        streets_data = parsed['streets']
        street_pots = parsed['street_pots']

        for street_key in STREET_KEYS:
            entries = streets_data.get(street_key, [])
            pot = street_pots.get(street_key, "0 BB")
            if entries or pot != "0 BB":
                print(f"\n  [{street_key.upper()}] Pot: {pot}")
                for e in entries:
                    hand_str = f" [{', '.join(e['hand'])}]" if e.get('hand') else ""
                    print(f"    {e['player']} | {e['action']} | {e['amount']}{hand_str}")

    # 7. Build player_hands (mirrors tasks.py logic)
    player_hands: dict = {}
    # Source 1: hands in action log entries (detected via OCR+color in turn/river)
    # Also collect card images for learning
    card_images_map: dict = {}  # player_name -> list of card crop images
    for sk in STREET_KEYS:
        for entry in streets_data.get(sk, []):
            if not isinstance(entry, dict):
                continue
            cards = [c for c in entry.get('hand', []) if c and c != '??']
            if cards and entry.get('player'):
                name = entry['player']
                existing = player_hands.get(name, [])
                merged = (existing + cards)[:2]
                # If 2 identical cards → suit must be wrong on at least one
                if len(merged) == 2 and merged[0] == merged[1] and len(merged[0]) >= 2:
                    rank = merged[0][:-1]  # e.g. "9" from "9d"
                    merged = [f"{rank}?", f"{rank}?"]
                player_hands[name] = merged
                # Collect card images for template learning
                imgs = entry.get('card_images', [])
                if imgs:
                    existing_imgs = card_images_map.get(name, [])
                    card_images_map[name] = (existing_imgs + imgs)[:2]


    # Strip 'hand' from all street action entries (hands belong in player_hands only)
    for sk in STREET_KEYS:
        for entry in streets_data.get(sk, []):
            if isinstance(entry, dict):
                entry.pop('hand', None)
                entry.pop('card_images', None)

    # Build positions map
    positions: dict = {}
    for sk in STREET_KEYS:
        for entry in streets_data.get(sk, []):
            if not isinstance(entry, dict):
                continue
            name = entry.get('player', '').strip()
            pos  = entry.get('pos', '').strip()
            if name and pos and name not in positions:
                positions[name] = pos

    if player_hands:
        # Interactive: let user correct cards with unknown suit (?)
        for name, cards in list(player_hands.items()):
            corrected = []
            images = card_images_map.get(name, [])
            for i, card in enumerate(cards):
                if '?' in card or card == '??':
                    try:
                        user_input = input(f"  [?] {name} card {i+1} is '{card}'. Correct (e.g. 9h) or Enter to skip: ").strip()
                        if user_input:
                            # If user only enters suit letter, prepend the rank from original card
                            if len(user_input) == 1 and user_input in 'hdcs':
                                rank = card.replace('?', '')  # "9?" → "9", "??" → ""
                                if rank:
                                    user_input = f"{rank}{user_input}"
                            corrected.append(user_input)
                            # Learn template if we have the card image
                            if i < len(images) and images[i] is not None:
                                card_detector.learn_card(images[i], user_input, verification_source='user_corrected')
                                print(f"  [LEARN] Saved template: {user_input}")
                        else:
                            corrected.append(card)
                    except EOFError:
                        corrected.append(card)
                else:
                    corrected.append(card)
            player_hands[name] = corrected

        print(f"\n{'─'*40}")
        print("  PLAYER HANDS")
        print(f"{'─'*40}")
        for name, cards in player_hands.items():
            print(f"  {name}: {cards}")

    if positions:
        print(f"\n{'─'*40}")
        print("  POSITIONS")
        print(f"{'─'*40}")
        for name, pos in positions.items():
            print(f"  {name}: {pos}")

    # 8. Final JSON
    # Strip pos from action entries — positions are in the 'positions' object
    for sk in STREET_KEYS:
        for entry in streets_data.get(sk, []):
            if isinstance(entry, dict):
                entry.pop('pos', None)

    hand_data = {
        "pot": format_bb(pot_value),
        "board": board_cards,
        "player_hands": player_hands,
        "positions": positions,
        "streets": streets_data,
        "metadata": {"street_pots": street_pots}
    }

    print(f"\n{'='*60}")
    print("  FINAL OUTPUT")
    print(f"{'='*60}")
    print(json.dumps(hand_data, indent=2, ensure_ascii=False))
    return hand_data


if __name__ == '__main__':
    images = sys.argv[1:] if len(sys.argv) > 1 else ["ocrtest.png"]
    for img_path in images:
        test_pipeline(img_path)
