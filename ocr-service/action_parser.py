"""
action_parser.py — 5-Phase Action Log Parser for Poker Hand History.

Extracted from test_response.py for reuse in tasks.py production pipeline.
Parses the action log area of a poker hand history screenshot into structured
streets data with player actions, positions, amounts, and hands.

Pipeline:
  Phase 1:   Header Detection (find column centers)
  Phase 1.5: Boundary Filters (Y threshold + X boundary)
  Phase 2:   Card Detection (find player hand cards in action log)
  Phase 3:   Column Bucketing (assign OCR text to street columns)
  Phase 4:   Sequential Merge (build player entries from vertical text stack)
  Phase 5:   Post-Processing (dedup, winner marking, sign inference)
"""

import re
import logging


logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

STREET_KEYS = ["blinds_ante", "preflop", "flop", "turn", "river"]

POS_TAGS = [
    "sb", "bb", "btn", "utg", "utg+1", "utg+2",
    "hj", "co", "str", "ante", "mp", "mp1", "bb+", "str+1"
]

ACTIONS_LIST = [
    "kiểm tra",                     #Check
    "cược", "cuoc", "cugc",        # BET (Vietnamese + OCR typos)
    "tố", "to", "tốt", "tot", "t6", # RAISE (OCR might read "Tố" as "Tốt" or "T6")
    "theo",                         # CALL
    "bỏ bài", "bo bai", "b6 bai",  # FOLD
    "check", "fold", "call", "raise", "all-in",
    "tất tay",                      # ALL-IN
]

WINNER_KEYWORDS = ["winner", "thắng", "win", "won"]

# Text that should never be treated as a player name
NOISE_KEYWORDS = [
    "winner", "pot", "total", "ante", "blind",
    "pre-flop", "flop", "turn", "river", "cuộc ante",
]


# ─────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────


def greedy_pot(s):
    """Extract pot number, handling OCR splitting (e.g. '1 . 947' → '1.947')"""
    s = re.sub(r'(\d)\s+([.,])\s*(\d)', r'\1\2\3', s)
    s = re.sub(r'(\d)\s+(\d)', r'\1\2', s)
    m = re.search(r"(\d[\d\.,]*\d|\d)", s)
    return m.group(1).strip() if m else "0"


def is_money_text(text_lower):
    """Check if text is money/amount (BB, $, +, -, %). Exclude percentage-only values."""
    # Pure percentage (e.g. "5%", "99%") is NOT a bet amount
    if re.match(r'^\d+%$', text_lower.strip()):
        return False
    return any(c in text_lower for c in ["bb", "$", "+", "-"]) and text_lower not in POS_TAGS


def is_signed_amount(text_lower):
    """Check if text starts with + or - (gain/loss indicator)"""
    return bool(re.match(r'^[+\-]', text_lower.strip()))


def parse_bb_value(text):
    """Extract numeric BB value from text like '1.947 BB', '+1,128 BB'.
    Handles European-style thousands separators (1.947 = 1947, not 1.947)."""
    clean = text.strip().lower().replace("bb", "").replace("+", "").replace("-", "").strip()
    clean = re.sub(r'\s+', '', clean)
    # Detect thousands separator: X.XXX or X,XXX pattern (exactly 3 digits after separator)
    if re.match(r'^\d{1,3}[.,]\d{3}$', clean):
        clean = clean.replace('.', '').replace(',', '')
    else:
        clean = clean.replace(',', '.')
    try:
        return float(clean)
    except ValueError:
        return 0.0


def format_bb(val):
    """Format a BB value for display, using dot as thousands separator."""
    if val == 0: return "0 BB"
    if val >= 1000:
        if val == int(val):
            return f"{int(val//1000)}.{int(val%1000):03d} BB"
        else:
            whole = int(val)
            dec = round((val - whole) * 100)
            return f"{int(whole//1000)}.{int(whole%1000):03d},{dec:02d} BB"
    return f"{val:g} BB"


# ─────────────────────────────────────────────
# ActionLogParser
# ─────────────────────────────────────────────

class ActionLogParser:
    """
    5-Phase parser for poker action log screenshots.
    
    Usage:
        parser = ActionLogParser()
        result = parser.parse(action_img, ocr_results, card_detector, ocr_engine)
        # result = {
        #     "streets": { "blinds_ante": [...], "preflop": [...], ... },
        #     "street_pots": { "blinds_ante": "5.50 BB", ... }
        # }
    """

    def parse(self, action_img, ocr_results, card_detector=None, ocr_engine=None, sidebar_x=None):
        """
        Parse action log image into structured streets data.
        
        Args:
            action_img:     OpenCV image of the action log area
            ocr_results:    PaddleOCR results from ocr.ocr(action_img)
            card_detector:  CardDetector instance for finding player hand cards
            ocr_engine:     PaddleOCR engine instance (for card detection)
            
        Returns:
            {
                "streets": { street_key: [{ player, pos, action, amount, hand }, ...] },
                "street_pots": { street_key: "X BB" }
            }
        """
        streets_data = {k: [] for k in STREET_KEYS}
        street_pots = {k: "0 BB" for k in STREET_KEYS}

        if not ocr_results or not ocr_results[0]:
            logger.warning("[ActionParser] No OCR results for action log.")
            return {"streets": streets_data, "street_pots": street_pots}

        h_act, w_act = action_img.shape[:2]
        boxes = ocr_results[0]

        # ═══ Phase 1: Header Detection ═══
        header_centers = [(idx + 0.5) * (w_act / 5.0) for idx in range(5)]
        header_keywords = ["blind", "pre-flop", "flop", "turn", "river"]
        found_headers = [False] * 5
        header_y_values = []

        for box in boxes:
            text = box[1][0].lower().strip()
            x_c = sum([p[0] for p in box[0]]) / 4.0
            y_c = sum([p[1] for p in box[0]]) / 4.0
            for idx, kw in enumerate(header_keywords):
                if kw in text and not found_headers[idx]:
                    if "pre" in text and kw == "flop":
                        continue
                    header_centers[idx] = x_c
                    found_headers[idx] = True
                    header_y_values.append(y_c)

        logger.debug(f"[ActionParser] Headers found: {[header_keywords[i] for i in range(5) if found_headers[i]]}")

        # ═══ Phase 1.5: Boundary Filters ═══
        if header_y_values:
            y_threshold = min(header_y_values) - 15  # 15px margin above topmost header
        else:
            y_threshold = 0

        col_width = w_act / 5.0
        if any(found_headers):
            rightmost_header_x = max(header_centers[i] for i in range(5) if found_headers[i])
            x_boundary = rightmost_header_x + col_width * 0.6
        else:
            x_boundary = w_act

        # ═══ Phase 2: Card Detection (river column, CardDetector) ═══
        # Use template matching on the river column only.
        # sidebar_x limits the right edge to exclude sidebar content.
        found_player_hands = []
        if card_detector is not None:
            try:
                import cv2 as _cv2
                river_x1 = max(0, int(header_centers[4] - col_width * 0.6))
                # Right edge: whichever is smaller — sidebar boundary or column edge
                right_limit = sidebar_x if sidebar_x is not None else w_act
                river_x2 = min(int(right_limit), int(header_centers[4] + col_width * 0.5))
                river_col_img = action_img[:, river_x1:river_x2]



                log_cards = card_detector.detect_cards_with_info(river_col_img, ocr_engine=ocr_engine, min_group_size=1)
                for idx, c in enumerate(log_cards.get('cards', [])):
                    rect = c.get('rect', [0,0,0,0])
                    cw, ch = rect[2], rect[3]
                    logger.info(f"[ActionParser] Card {idx}: name={c['name']} conf={c['confidence']:.2f} rect={rect} (w={cw}x{ch}px) center={c['center']}")
                    
                    # Filter: reject too-small elements (icons, badges) — real cards ≥ 35px wide
                    if cw < 35 or ch < 50:
                        logger.info(f"[ActionParser] Card {idx}: SKIPPED (too small {cw}x{ch}px)")
                        continue
                    # Filter: reject near-square elements (avatars) — cards aspect ~0.67
                    aspect = cw / max(ch, 1)
                    if aspect > 0.85 or aspect < 0.45:
                        logger.info(f"[ActionParser] Card {idx}: SKIPPED (bad aspect {aspect:.2f})")
                        continue
                    

                    # Interactive: ask user to correct ?? or low-confidence river cards
                    if c['name'] == '??' or c['confidence'] < 0.70:
                        try:
                            user_input = input(f"  [?] River card {idx} is '{c['name']}'. Correct name (e.g. Qs) or Enter to skip: ").strip()
                            if user_input:
                                c['name'] = user_input
                                c['confidence'] = 1.0
                                if c.get('image') is not None:
                                    card_detector.learn_card(c['image'], user_input, verification_source='user_corrected')
                                    print(f"  [LEARN] User taught river card: {user_input}")
                        except EOFError:
                            pass
                    
                    found_player_hands.append({
                        "x": c['center'][0] + river_x1,
                        "y": c['center'][1],
                        "name": c['name'],
                        "image": c.get('image')
                    })
                logger.info(f"[ActionParser] Found {len(found_player_hands)} valid cards in river column.")
            except Exception as e:
                logger.warning(f"[ActionParser] Card detection in river column failed: {e}")

        # ═══ Phase 3: Column Bucketing (with boundary filter) ═══
        buckets = [[] for _ in range(5)]
        for box in boxes:
            x_c = sum([p[0] for p in box[0]]) / 4.0
            y_c = sum([p[1] for p in box[0]]) / 4.0
            text = box[1][0]

            # Boundary filter: skip text above headers or beyond rightmost column
            if y_c < y_threshold:
                continue
            if x_c > x_boundary:
                continue

            # Skip pure noise keywords
            if text.strip().lower() in NOISE_KEYWORDS:
                continue

            col_idx = min(range(5), key=lambda i: abs(x_c - header_centers[i]))
            buckets[col_idx].append({"text": text, "y": y_c, "bbox": box[0]})

        # ═══ Phase 4: Sequential Merge (Vertical Stack) ═══
        for i, bucket in enumerate(buckets):
            bucket.sort(key=lambda b: b['y'])
            street_key = STREET_KEYS[i]
            current_entry = {}
            total_blind_sum = 0.0
            pot_found = False

            for item in bucket:
                line = item['text']
                l_clean = line.strip().lower()

                # Skip pure header text (street names without amounts)
                is_header = (
                    any(kw in l_clean for kw in ["blind", "ante", "pre-flop", "flop", "turn", "river"])
                    and len(l_clean) < 15
                )
                if is_header:
                    has_bb_amount = bool(re.search(r'\d', l_clean)) and "bb" in l_clean
                    if not has_bb_amount:
                        continue

                # Pot detection: first BB line in col 1-4, before any player
                if i > 0 and "bb" in l_clean and not current_entry and not pot_found and len(l_clean) < 20:
                    if re.search(r'\d', l_clean):
                        street_pots[street_key] = line
                        pot_found = True
                        continue

                # Content type identification
                is_pos = (l_clean in POS_TAGS)
                is_action = any(
                    act == l_clean or (act in l_clean and len(l_clean) < len(act) + 8)
                    for act in ACTIONS_LIST
                )
                is_money = (is_money_text(l_clean) or is_signed_amount(l_clean)) and not is_pos
                is_winner = any(wk in l_clean for wk in WINNER_KEYWORDS)

                # State-Based Merging
                # Player name: not pos/action/money/winner, length >= 3, not a position tag
                is_likely_player = (
                    not is_pos and not is_action and not is_money and not is_winner
                    and len(l_clean) >= 3
                    and not re.match(r'^\d{1,2}$', l_clean)
                    and l_clean not in NOISE_KEYWORDS
                )
                if is_likely_player:
                    # New player name detected
                    if current_entry.get('player'):
                        streets_data[street_key].append(current_entry)
                    current_entry = {
                        "player": line, "pos": "", "action": "", "amount": "", "hand": [],
                        "_y": item['y']
                    }
                elif current_entry.get('player'):
                    # Assign to current player
                    if is_pos and not current_entry['pos']:
                        current_entry['pos'] = line.upper()
                    elif is_winner:
                        current_entry['action'] = "WINNER"
                    elif is_action or is_money:
                        # Action + Amount splitting
                        found_act = ""
                        # List of standard mapped actions
                        ACTION_MAP = {
                            "cược": ["cược", "cuoc", "cugc"],
                            "tố": ["tố", "to", "tot", "tốt", "t6"],
                            "chi check": ["kiểm tra", "check"],
                            "theo": ["theo", "call"],
                            "bỏ bài": ["bỏ bài", "bo bai", "b6 bai", "fold"],
                            "all-in": ["all-in", "tất tay"]
                        }
                        
                        for std_act, variants in ACTION_MAP.items():
                            for v in variants:
                                if v == l_clean or (v in l_clean and len(l_clean) < len(v) + 8):
                                    found_act = std_act.capitalize()
                                    matched_variant = v
                                    break
                            if found_act:
                                break
                        
                        if not found_act:
                            for act in ACTIONS_LIST:
                                if act in l_clean:
                                    found_act = act.capitalize()
                                    matched_variant = act
                                    break

                        if found_act:
                            if not current_entry['action']:
                                current_entry['action'] = found_act

                            # Extract amount if present in same line
                            amt_match = re.search(
                                r"([+\-]?\d[\d\.,\s]*\d|\d)",
                                l_clean.replace(matched_variant, "")
                            )
                            if amt_match and not current_entry['amount']:
                                current_entry['amount'] = (
                                    amt_match.group(1).strip() + (" BB" if "bb" in l_clean else "")
                                )
                        elif is_money:
                            if not current_entry['amount']:
                                current_entry['amount'] = line

                        # Extra: accumulate blinds
                        if i == 0 and (is_money or "bb" in l_clean):
                            m = re.search(r"(\d+[\.,]\d+|\d+)", l_clean)
                            if m:
                                total_blind_sum += float(m.group(1).replace(',', '.'))
                elif is_winner:
                    # Winner text found but no current player - skip
                    pass
                else:
                    if is_money and i == 0:
                        m = re.search(r"(\d+[\.,]\d+|\d+)", l_clean)
                        if m:
                            total_blind_sum += float(m.group(1).replace(',', '.'))

            # Close last entry
            if current_entry.get('player'):
                streets_data[street_key].append(current_entry)

            # Card Matching: cards appear BELOW the player name
            col_entries_with_y = sorted(
                [e for e in streets_data[street_key] if '_y' in e],
                key=lambda e: e['_y']
            )
            for card in found_player_hands:
                c_col = min(range(5), key=lambda ci: abs(card['x'] - header_centers[ci]))
                if c_col != i:
                    continue
                card_y = card['y']
                best_entry = None
                best_dist = 200
                for entry in col_entries_with_y:
                    dist = card_y - entry['_y']
                    if 0 <= dist < best_dist:
                        best_dist = dist
                        best_entry = entry
                if best_entry:
                    best_entry['hand'].append(card['name'])
                    if card.get('image') is not None:
                        best_entry.setdefault('card_images', []).append(card['image'])

            if i == 0:
                street_pots["blinds_ante"] = f"{total_blind_sum:.2f} BB"

        # ═══ Phase 4.5: Position Recovery ═══
        # Scan ALL raw OCR boxes for position tags that may have been skipped
        # (common with lang='ch' which may not detect small English badges)
        pos_boxes = []
        for box in boxes:
            text = box[1][0].strip().lower()
            x_c = sum([p[0] for p in box[0]]) / 4.0
            y_c = sum([p[1] for p in box[0]]) / 4.0
            if text in POS_TAGS:
                col_idx = min(range(5), key=lambda ci: abs(x_c - header_centers[ci]))
                pos_boxes.append({"pos": text.upper(), "y": y_c, "col": col_idx})

        logger.debug(f"[ActionParser] Phase 4.5 Position Recovery found: {pos_boxes}")

        # Assign unmatched positions to nearest player by Y in same column
        for pos_box in pos_boxes:
            col = pos_box['col']
            street_key = STREET_KEYS[col]
            entries = streets_data.get(street_key, [])
            best_entry = None
            best_dist = 50  # Max Y distance for matching (px)
            for entry in entries:
                if entry.get('pos'):
                    continue  # Already has position
                # Use stored y or estimate
                entry_y = entry.get('_y', 0)
                dist = abs(pos_box['y'] - entry_y)
                if dist < best_dist:
                    best_dist = dist
                    best_entry = entry
            if best_entry:
                best_entry['pos'] = pos_box['pos']

        # Clean up internal _y field
        for key in STREET_KEYS:
            for entry in streets_data[key]:
                entry.pop('_y', None)

        # ═══ Phase 5: Post-Processing ═══
        self._post_process(streets_data)

        return {"streets": streets_data, "street_pots": street_pots}

    def _post_process(self, streets_data):
        """Phase 5: Dedup players, mark winners, infer signs."""

        # 5a. Deduplicate players within each street (merge fields)
        for key in STREET_KEYS:
            entries = streets_data[key]
            if not entries:
                continue
            deduped = {}
            for entry in entries:
                # Clean name: remove trailing dots or artifacts
                name = re.sub(r'\.+', '', entry['player']).strip()
                if not name:
                    continue

                if name in deduped:
                    existing = deduped[name]
                    # Merge fields
                    for field in ['pos', 'action', 'amount']:
                        new_val = entry.get(field, '').strip()
                        old_val = existing.get(field, '').strip()
                        if not old_val and new_val:
                            existing[field] = new_val
                        elif field == 'amount' and new_val != old_val:
                            # SMART MERGE: sign + number separately
                            if (new_val in ['+', '-']) and old_val and not old_val.startswith(new_val):
                                existing[field] = new_val + old_val
                            elif (old_val in ['+', '-']) and new_val and not new_val.startswith(old_val):
                                existing[field] = old_val + new_val
                            elif is_signed_amount(new_val) and not is_signed_amount(old_val):
                                existing[field] = new_val

                    if entry.get('hand'):
                        existing['hand'] = list(set(existing.get('hand', []) + entry['hand']))
                else:
                    entry['player'] = name
                    deduped[name] = entry
            streets_data[key] = list(deduped.values())

        # 5b. River: mark +amount entries as WINNER
        for entry in streets_data.get("river", []):
            amt = entry.get('amount', '').strip()
            if amt.startswith('+') and not entry.get('action'):
                entry['action'] = "WINNER"

        # 5c. Poker logic: non-winners with unsigned amounts in River must be losses (-)
        has_winner = any(e.get('action') == 'WINNER' for e in streets_data.get("river", []))
        if has_winner:
            for entry in streets_data.get("river", []):
                amt = entry.get('amount', '').strip()
                if (amt and entry.get('action') != 'WINNER'
                        and not amt.startswith('-') and not amt.startswith('+')):
                    entry['amount'] = '-' + amt
