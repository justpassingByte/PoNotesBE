"""
test_pipeline.py — End-to-end test for the merged OCR pipeline.
Tests action_parser + engine (CardDetector) without Celery/Redis.
"""

import os
import sys
import cv2
import numpy as np
import json
import logging
from paddleocr import PaddleOCR
from engine import LayoutEngine, CardDetector, get_suit_from_color
from action_parser import ActionLogParser, greedy_pot, parse_bb_value, format_bb, STREET_KEYS

# ── Logging ──
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


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
    card_detector = CardDetector(templates_dir="templates/cards", enable_learning=False)
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
        bh, bw = board_img.shape[:2]
        print(f"  Crop size: {bw}x{bh}")

        res = card_detector.detect_cards_with_info(board_img, ocr_engine=ocr)
        card_info = res.get('cards', []) if isinstance(res, dict) else res

        if card_info:
            for c in card_info:
                src = "TEMPLATE" if not c.get('is_new') else "OCR"
                print(f"  → {c['name']} (conf={c['confidence']:.2f}, src={src})")
            board_cards = [c['name'] for c in card_info]

    # Pad board to always 5 cards
    board_cards = [c for c in board_cards if c != '??'][:5]
    while len(board_cards) < 5:
        board_cards.append('??')
    print(f"  Board: {board_cards}")

    # 4. Hero Card Detection (OCR-based, same as tasks.py)
    print(f"\n{'─'*40}")
    print("  HERO CARDS")
    print(f"{'─'*40}")
    hero_cards = []
    hero_region = regions.get('hero_cards', {'x1': 0.3, 'y1': 0.34, 'x2': 0.45, 'y2': 0.45})
    hero_img = layout_engine.crop_region(img, hero_region)
    hh, hw = hero_img.shape[:2]
    print(f"  Crop size: {hw}x{hh}")

    phero = cv2.copyMakeBorder(hero_img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
    h_res = ocr.ocr(phero, cls=True)
    if h_res and h_res[0]:
        for line in h_res[0]:
            txt = line[1][0].upper().replace(' ', '')
            h_cards = parse_card_string_with_suit(txt, line[0], phero)
            hero_cards.extend(h_cards)
    hero_cards = list(dict.fromkeys(hero_cards))[:2]
    # Pad hero to always 2 cards
    while len(hero_cards) < 2:
        hero_cards.append('??')
    print(f"  Hero: {hero_cards}")

    # 5. Pot OCR
    print(f"\n{'─'*40}")
    print("  POT")
    print(f"{'─'*40}")
    raw_pot = ""
    if 'pot_area' in regions:
        pot_img = layout_engine.crop_region(img, regions['pot_area'])
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
        ah, aw = action_img.shape[:2]
        print(f"  Crop size: {aw}x{ah}")

        action_ocr = ocr.ocr(action_img, cls=True)
        parsed = action_parser.parse(action_img, action_ocr, card_detector, ocr)
        streets_data = parsed['streets']
        street_pots = parsed['street_pots']

        for street_key in STREET_KEYS:
            entries = streets_data.get(street_key, [])
            pot = street_pots.get(street_key, "0 BB")
            if entries or pot != "0 BB":
                print(f"\n  [{street_key.upper()}] Pot: {pot}")
                for e in entries:
                    hand_str = f" [{', '.join(e['hand'])}]" if e.get('hand') else ""
                    print(f"    {e['player']} | {e['pos']} | {e['action']} | {e['amount']}{hand_str}")

    # 7. Final JSON
    hand_data = {
        "pot": format_bb(pot_value),
        "board": board_cards,
        "hero_hand": hero_cards,
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
