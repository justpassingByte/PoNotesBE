"""
test_pipeline.py — End-to-end test for the merged OCR pipeline.
Tests action_parser + engine (CardDetector) without Celery/Redis.
"""

# ── Suppress only system/3rd party noisy logs ──
import os
os.environ["PPOCR_LOG_LEVEL"] = "ERROR"
import warnings
warnings.filterwarnings("ignore")
import logging
# Only disable logs for specific modules if needed, but keep our DEBUG ones
for m in ["paddle", "onnxruntime"]:
    logging.getLogger(m).setLevel(logging.ERROR)

import sys
import io
import cv2
import numpy as np
import json
import re

# Force UTF-8 encoding for console output to correctly display Chinese names on Windows
if sys.platform == 'win32':
    import codecs
    # Try to set codepage 65001 (UTF-8) programmatically
    try:
        os.system('chcp 65001 > nul')
        # On modern Python, reconfigure is better
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
            sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass
    # Fallback to codecs wrapper if reconfigure failed or not enough
    if not hasattr(sys.stdout, 'reconfigure'):
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'replace')
        sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'replace')
elif hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Configure basic logging for our output
logging.basicConfig(level=logging.DEBUG, format='%(message)s')
logger = logging.getLogger("test_pipeline")

from paddleocr import PaddleOCR
from engine import LayoutEngine, CardDetector
from action_parser import ActionLogParser, greedy_pot, parse_bb_value, format_bb, STREET_KEYS
import time
from concurrent.futures import ThreadPoolExecutor


def test_pipeline(img_path="ocrtestMain.png"):
    if not os.path.exists(img_path):
        print(f"[ERROR] Image not found: {img_path}")
        return

    print("=" * 60)
    print(f"  OCR Pipeline Test: {img_path}")
    print("=" * 60)

    img = cv2.imread(img_path)
    if img is None:
        print(f"[ERROR] Could not load image: {img_path}")
        return
    h, w = img.shape[:2]
    print(f"  Image size: {w}x{h}")

    # 1. Layout Detection (template-only, no OCR needed)
    engine = LayoutEngine()
    t0 = time.time()
    best_match = engine.match_layout(img)
    t_layout = time.time()
    if not best_match:
        print("[ERROR] No layout matched!")
        return
    
    layout, score = best_match
    layout_name = layout.get('name', 'Unknown')
    print(f"\n[✓] Layout: {layout_name} (score={score:.3f}) [{(t_layout - t0)*1000:.0f}ms]")

    # 1b. Initialize OCR engine with MKL-DNN
    ocr = PaddleOCR(
        use_angle_cls=False, lang='ch', show_log=False,
        use_gpu=False, enable_mkldnn=True, cpu_threads=4
    )

    # 2. Board Cards (template-only, no OCR for cards)
    detector = CardDetector()
    board_region = layout['regions'].get('board_cards')
    board_crop = engine.crop_region(img, board_region) if board_region else None
    
    # Save the base board crop for layout debugging
    if board_crop is not None:
        cv2.imwrite("debug_crops/layout_board_crop.png", board_crop)
        print(f"  → Dumped layout crop: debug_crops/layout_board_crop.png")
    
    # Derive platform tag: site + name (e.g. "wpt_global" + "PC" → "WPT_PC")
    site_prefix = layout.get('site', '').replace('_global', '').replace('_', '').upper()  # "WPT"
    variant = layout_name.replace(' ', '_') if layout_name else 'UNKNOWN'
    platform_tag = f"{site_prefix}_{variant}" if site_prefix else variant  # "WPT_PC"
    
    board_data = detector.detect_cards_with_info(
        board_crop, context="board"
    ) if board_crop is not None else {"cards": []}
    
    # Smart gap-based padding: use X positions to detect missing cards
    detected_cards = board_data['cards']
    if detected_cards:
        # Sort by X position (left to right)
        sorted_cards = sorted(detected_cards, key=lambda c: c['rect'][0])
        
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
    
    print("\n" + "─" * 40)
    print("  BOARD CARDS (Template-Only)")
    print("─" * 40)
    if board_crop is not None:
        print(f"  Crop size: {board_crop.shape[1]}x{board_crop.shape[0]}")
    raw_names = [c['name'] for c in detected_cards]
    print(f"  Detected: {raw_names}")
    print(f"  Board:    {board_cards}")
    
    # Debug dump: save each board card crop for visual verification
    unknown_indices = [i for i, c in enumerate(board_cards) if c == '??']
    if unknown_indices and detected_cards:
        sorted_by_x = sorted(detected_cards, key=lambda c: c['rect'][0])
        print(f"\n  ⚠ {len(unknown_indices)} unknown card(s) — saving debug crops...")
        for i, card_data in enumerate(sorted_by_x):
            if card_data.get('image') is not None:
                debug_path = f"debug_board_card_{i}.png"
                cv2.imwrite(debug_path, card_data['image'])
                print(f"    → Saved {debug_path} (rect={card_data['rect']})")
        print(f"  Check debug_board_card_*.png files to verify crops are correct.")
        
        print(f"\n  Board (final): {board_cards}")

    # 3. Parallel Per-Region OCR: pot + action in parallel
    def _ocr_crop(region_key):
        region = layout['regions'].get(region_key)
        if not region:
            return region_key, None, None
        crop = engine.crop_region(img, region)
        result = ocr.ocr(crop, cls=False)
        return region_key, crop, result

    t_ocr_start = time.time()
    ocr_results = {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_ocr_crop, rk) for rk in ['pot_area', 'action_log']]
        for f in futures:
            rk, crop, result = f.result()
            ocr_results[rk] = (crop, result)
    t_ocr = time.time()
    print(f"  Parallel OCR (pot+action) completed in {(t_ocr - t_ocr_start)*1000:.0f}ms")

    # 3a. Pot
    pot_text = ""
    pot_crop, pot_res = ocr_results.get('pot_area', (None, None))
    if pot_res and pot_res[0]:
        pot_text = " ".join([line[1][0] for line in pot_res[0]])
    
    pot_val = greedy_pot(pot_text) if pot_text else 0
    print("\n" + "─" * 40)
    print("  POT")
    print("─" * 40)
    print(f"  Raw: '{pot_text}'")
    print(f"  Parsed: {pot_val} BB")

    # 4. Action Log
    action_parser = ActionLogParser()
    action_crop, action_ocr = ocr_results.get('action_log', (None, None))
    
    print("\n" + "─" * 40)
    print("  ACTION LOG (5-Phase Parser)")
    print("─" * 40)
    
    parsed = {"streets": {}, "street_pots": {}}
    if action_crop is not None:
        print(f"  Crop size: {action_crop.shape[1]}x{action_crop.shape[0]}")
        
        # Save action crop for layout debugging
        cv2.imwrite("debug_crops/layout_action_crop.png", action_crop)
        print(f"  → Dumped layout crop: debug_crops/layout_action_crop.png")
        
        # River card detection happens inside action_parser.parse() — no need to run it separately
        parsed = action_parser.parse(
            action_crop,
            action_ocr,
            card_detector=detector,
            ocr_engine=None,
            layout_name=layout_name
        )
        # Debug dump: Chỉ lưu ảnh card đã match với Player
        all_cards = parsed.get('all_card_rects', [])
        # Lưu các card đã vào tay người chơi (trên mọi street)
        idx = 0
        for street in STREET_KEYS:
            for entry in parsed['streets'].get(street, []):
                for c in entry.get('card_objs', []):
                    card_img = c.get('image')
                    if card_img is not None:
                        debug_path = f"debug_player_card_river_{idx}_{c.get('name', 'unknown')}.png"
                        cv2.imwrite(debug_path, card_img)
                        print(f"    → MATCHED River card crop dumped: {debug_path}")
                        idx += 1

        # Print summary
        for street in STREET_KEYS:
            entries = parsed['streets'].get(street, [])
            if entries:
                print(f"\n  [{street.upper()}] Pot: {parsed['street_pots'].get(street, '0 BB')}")
                for e in entries:
                    hand_str = f" | Cards: {e['hand']}" if e.get('hand') else ""
                    amt_str = f" | {e['amount']}" if e.get('amount') else ""
                    pos_str = f" ({e['pos']})" if e.get('pos') else ""
                    print(f"    {e['player']}{pos_str} | {e['action']}{amt_str}{hand_str}")

    # Final Output
    final_result = {
        "pot": f"{pot_val} BB",
        "board": board_cards,
        "player_hands": {},
        "positions": {},
        "streets": parsed['streets'],
        "metadata": {"street_pots": parsed['street_pots']}
    }
    
    # 5. Collect player hands BEFORE cleanup (pop removes them from entries)
    RANK_ORDER = {'A': 0, 'K': 1, 'Q': 2, 'J': 3, 'T': 4, '9': 5, '8': 6, '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12}
    def sort_hand(cards):
        """Sort cards by rank (A first, 2 last)."""
        return sorted(cards, key=lambda c: RANK_ORDER.get(c[0], 99) if c else 99)
    
    temp_hands = {}
    for s in STREET_KEYS:
        for e in parsed['streets'].get(s, []):
            if isinstance(e, dict) and e.get('hand') and e.get('player'):
                sorted_h = sort_hand(e['hand'])
                e['hand'] = sorted_h
                temp_hands[e['player']] = sorted_h
                final_result['player_hands'][e['player']] = sorted_h

    # 6. Final Output Cleanup (remove images and redundant data for JSON)
    for s in STREET_KEYS:
        for e in parsed['streets'].get(s, []):
            if isinstance(e, dict):
                e.pop('image', None)
                e.pop('card_images', None)
                e.pop('card_objs', None)
                e.pop('hand', None)
                # Remove action field from showdown entries
                if s == 'showdown':
                    e.pop('action', None)
            
            # Populate positions
            if isinstance(e, dict) and e.get('player'):
                p_name = e['player']
                if e.get('pos'):
                    final_result['positions'][p_name] = e['pos']

    # 7. Pretty report with UTF-8 support
    o = []
    o.append("")
    o.append("╔" + "═"*68 + "╗")
    o.append("║" + "       WPT GLOBAL OCR — FINAL REPORT".ljust(68) + "║")
    o.append("╚" + "═"*68 + "╝")
    
    # ── Board & Pot ──
    o.append("")
    o.append("┌─── BOARD ─────────────────────────────────────────────────────────┐")
    o.append(f"│  Cards : {' '.join(board_cards):57s} │")
    
    # Show pot per street
    pots = parsed.get('street_pots', {})
    pot_line = "│  Pots  :"
    for sk in STREET_KEYS:
        p = pots.get(sk, '')
        if p:
            pot_line += f"  {sk[:4].upper()}={p}"
    o.append(f"{pot_line:69s} │")
    o.append("└──────────────────────────────────────────────────────────────────┘")
    
    # ── Streets ──
    for street in STREET_KEYS:
        entries = final_result['streets'].get(street, [])
        if not entries:
            continue
        
        pot_val = pots.get(street, '')
        header = f"  {street.upper()}"
        if pot_val:
            header += f"  (Pot: {pot_val})"
        
        o.append("")
        o.append(f"┌─── {street.upper()} " + "─" * max(0, 63 - len(street)) + "┐")
        o.append(f"│  {'Player':<20s} {'Pos':>4s}   {'Action':<10s} {'Amount':<14s} {'Hand':<10s}  │")
        o.append("│  " + "─"*64 + "  │")
        
        for e in entries:
            p_name = e.get('player', '?')
            pos = final_result['positions'].get(p_name, e.get('pos', ''))
            action = e.get('action', '')
            amount = e.get('amount', '')
            # Use temp_hands for river cards (since hands are popped from entries)
            cards = temp_hands.get(p_name, []) if street == 'river' else []
            hand_str = ' '.join(cards) if cards else ''
            
            # Highlight winner
            prefix = "★ " if action == 'WINNER' else "  "
            o.append(f"│{prefix}{p_name:<20s} {pos:>4s}   {action:<10s} {amount:<14s} {hand_str:<10s}  │")
        
        o.append("└──────────────────────────────────────────────────────────────────┘")
    
    # ── Player Summary ──
    o.append("")
    o.append("┌─── PLAYER SUMMARY ────────────────────────────────────────────────┐")
    o.append(f"│  {'Player':<20s} {'Pos':>4s}   {'Hand':<12s} {'Result':<14s}            │")
    o.append("│  " + "─"*64 + "  │")
    
    # Collect river results for each player
    river_entries = final_result['streets'].get('river', [])
    shown_players = set()
    for e in river_entries:
        p_name = e.get('player', '?')
        if p_name in shown_players:
            continue
        shown_players.add(p_name)
        pos = final_result['positions'].get(p_name, '')
        cards = temp_hands.get(p_name, [])
        hand_str = ' '.join(cards) if cards else '—'
        amount = e.get('amount', '')
        action = e.get('action', '')
        
        if action == 'WINNER':
            result_str = f"WIN {amount}"
        elif amount.startswith('-'):
            result_str = f"LOSS {amount}"
        elif amount:
            result_str = amount
        else:
            result_str = '—'
        
        o.append(f"│  {p_name:<20s} {pos:>4s}   {hand_str:<12s} {result_str:<14s}            │")
    
    # Add folded players not in river
    all_players = set()
    for sk in STREET_KEYS:
        for e in final_result['streets'].get(sk, []):
            all_players.add(e.get('player', ''))
    for p in all_players - shown_players:
        if not p:
            continue
        pos = final_result['positions'].get(p, '')
        o.append(f"│  {p:<20s} {pos:>4s}   {'—':<12s} {'Folded':<14s}            │")
    
    o.append("└──────────────────────────────────────────────────────────────────┘")
    
    full_output = "\n".join(o) + "\n"
    
    # Write report to console with UTF-8
    if hasattr(sys.stdout, 'buffer'):
        sys.stdout.buffer.write(full_output.encode('utf-8'))
        sys.stdout.buffer.flush()
    else:
        print(full_output)

    # --- JSON Serialization Support ---
    class NumpyEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, np.ndarray):
                return "<numpy_array>"
            return super().default(obj)

    # 8. Update summary with player hands and winner
    # Derive winner/losers from showdown entries
    winner_entry = {"player": None, "amount": None}
    loser_entries = []
    for e in parsed['streets'].get('showdown', []) + parsed['streets'].get('river', []):
        if not isinstance(e, dict):
            continue
        amt = e.get('amount', '').strip()
        if e.get('action') == 'WINNER' or amt.startswith('+'):
            if not winner_entry['player']:
                winner_entry = {
                    "player": e.get('player', ''),
                    "amount": amt,
                    "hand": temp_hands.get(e.get('player', ''), [])
                }
        elif e.get('action') == 'LOSER' or amt.startswith('-'):
            loser_entries.append({
                "player": e.get('player', ''),
                "amount": amt,
                "hand": temp_hands.get(e.get('player', ''), [])
            })
    if not winner_entry['player']:
        wi = parsed.get('winner', {})
        if wi:
            winner_entry = wi
    
    final_summary = {
        "board": board_cards,
        "pot": parsed.get('street_pots', {}).get('river', '0 BB'),
        "winner": winner_entry,
        "players": {}
    }
    
    # Populate player actions summary across all streets
    for street in STREET_KEYS:
        for act in parsed['streets'].get(street, []):
            if not isinstance(act, dict):
                continue
            p_name = act.get('player', '')
            if not p_name:
                continue
            if p_name not in final_summary["players"]:
                final_summary["players"][p_name] = {"hand": [], "actions": []}
            final_summary["players"][p_name]["actions"].append({
                "street": street,
                "action": act.get('action', ''),
                "amount": act.get('amount', '')
            })
    
    # Merge player hands from temp_hands (collected before cleanup)
    for p_name, cards in temp_hands.items():
        if p_name not in final_summary["players"]:
            final_summary["players"][p_name] = {"hand": [], "actions": []}
        final_summary["players"][p_name]["hand"] = cards
            
    # Inject final summary into result
    final_result["summary"] = final_summary
    final_result["winner"] = winner_entry
    final_result["losers"] = loser_entries
    
    # Save JSON result
    with open("ocr_result.json", "w", encoding="utf-8") as f:
        json.dump(final_result, f, ensure_ascii=False, indent=2, cls=NumpyEncoder)
    
    t_end = time.time()
    total_ms = round((t_end - t0) * 1000)
    print(f"\n[✔] Result saved to ocr_result.json")
    print(f"[⏱] Total pipeline: {total_ms}ms (Layout: {(t_layout-t0)*1000:.0f}ms, OCR: {(t_ocr-t_ocr_start)*1000:.0f}ms, Processing: {(t_end-t_ocr)*1000:.0f}ms)")

if __name__ == "__main__":
    img_path = sys.argv[1] if len(sys.argv) > 1 else "ocrtestMain.png"
    test_pipeline(img_path)
