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
    "hj", "co", "ante", "mp", "mp1", "bb+",
    # Common OCR misreads:
    "utg-1", "utg-2", "utg 1", "utg 2",  # '+' read as '-' or space
    "hi", "h]", "hj.",                     # 'HJ' misreads
    "c0", "c)",                             # 'CO' misreads
    "bt", "bt n", "btn.",                   # 'BTN' misreads
    "lj", "loj",                            # LJ (LoJack) variants
    "ep", "mp2", "mp3",                     # Extra position labels
]

# Canonical position map: normalize OCR reads to standard labels
_POS_NORMALIZE = {
    "utg-1": "UTG+1", "utg 1": "UTG+1",
    "utg-2": "UTG+2", "utg 2": "UTG+2",
    "hi": "HJ", "h]": "HJ", "hj.": "HJ",
    "c0": "CO", "c)": "CO",
    "bt": "BTN", "bt n": "BTN", "btn.": "BTN",
    "lj": "LJ", "loj": "LJ",
}

def normalize_pos(text: str) -> str:
    """Canonicalize OCR-read position text to standard abbreviation."""
    low = text.strip().lower()
    return _POS_NORMALIZE.get(low, text.strip().upper())

ACTIONS_LIST = [
    "kiểm tra", "kiem tra",         # Check (with/without diacritics)
    "cược", "cuoc", "cugc",        # BET (Vietnamese + OCR typos)
    "tố", "to", "tốt", "tot", "t6", # RAISE (OCR might read "Tố" as "Tốt" or "T6")
    "theo",                         # CALL
    "bỏ bài", "bo bai", "b6 bai",  # FOLD
    "check", "fold", "call", "raise", "all-in",
    "tất tay", "tố tất", "to tat", # ALL-IN variants
    "cược ante", "cuoc ante",       # Ante posting action
    "str", "straddle",              # Straddle (forced bet, NOT a position)
]

WINNER_KEYWORDS = ["winner", "thắng", "win", "won"]

# Text that should never be treated as a player name
NOISE_KEYWORDS = [
    "winner", "pot", "total",
    "pre-flop", "flop", "turn", "river",
    "bảo hiểm", "bao hiem",        # Insurance — not a player
    "tố tất", "to tat",            # All-in badge text
    "jp",                           # Jackpot label
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


# Currency markers recognized across BB, USD, and CNY formats
CURRENCY_MARKERS = ["bb", "$", "¥", "元"]

def has_currency_marker(text_lower):
    """Check if text contains any known currency marker (BB, $, ¥, 元)."""
    return any(c in text_lower for c in CURRENCY_MARKERS)

def is_money_text(text_lower):
    """Check if text is money/amount (BB, $, ¥, +, -, %). Exclude percentage-only values."""
    # Pure percentage (e.g. "5%", "99%") is NOT a bet amount
    if re.match(r'^\d+%$', text_lower.strip()):
        return False
    return (has_currency_marker(text_lower) or any(c in text_lower for c in ["+", "-"])) and text_lower not in POS_TAGS


def is_signed_amount(text_lower):
    """Check if text starts with + or - (gain/loss indicator)"""
    return bool(re.match(r'^[+\-]', text_lower.strip()))


def parse_bb_value(text):
    """Extract numeric value from text like '1.947 BB', '+1,128 BB', '$ 65,90', '$3.40', '¥100'.
    Handles BB, USD ($), and CNY (¥/元) formats.
    Handles European-style thousands separators (1.947 = 1947, not 1.947)."""
    clean = text.strip().lower()
    for marker in ["bb", "$", "¥", "元", "+", "-"]:
        clean = clean.replace(marker, "")
    clean = clean.strip()
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

    def parse(self, action_img, ocr_results, card_detector=None, ocr_engine=None, sidebar_x=None, layout_name=None):
        """
        Parse action log image into structured streets data.
        
        Args:
            action_img:     OpenCV image of the action log area
            ocr_results:    PaddleOCR results from ocr.ocr(action_img)
            card_detector:  CardDetector instance for finding player hand cards
            ocr_engine:     PaddleOCR engine instance (for card detection)
            sidebar_x:      X-coordinate boundary to mask out the right sidebar
            layout_name:    Name of the layout to prefix learned templates (e.g., 'WPT_GLOBAL_MOBILE')
            
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
                    
                    # Filter: reject too-small elements (icons, badges) — real cards ≥ 25px wide
                    if cw < 25 or ch < 35:
                        logger.info(f"[ActionParser] Card {idx}: SKIPPED (too small {cw}x{ch}px)")
                        continue
                    # Filter: reject near-square elements (avatars) — cards aspect ~0.67
                    aspect = cw / max(ch, 1)
                    if aspect > 0.85 or aspect < 0.45:
                        logger.info(f"[ActionParser] Card {idx}: SKIPPED (bad aspect {aspect:.2f})")
                        continue
                    # Filter: reject FOLD cards (face-down, dark gray card backs)
                    if c.get('image') is not None:
                        gray_card = _cv2.cvtColor(c['image'], _cv2.COLOR_BGR2GRAY) if len(c['image'].shape) == 3 else c['image']
                        mean_val = float(gray_card.mean())
                        if mean_val < 120:
                            logger.info(f"[ActionParser] Card {idx}: SKIPPED (Dark FOLD card, mean={mean_val:.1f})")
                            continue
                        # Filter: reject smooth icons/avatars — real cards have sharp text edges
                        edges = _cv2.Canny(gray_card, 50, 150)
                        edge_ratio = float(edges.sum() / 255) / max(edges.size, 1)
                        if edge_ratio < 0.03:
                            logger.info(f"[ActionParser] Card {idx}: SKIPPED (smooth icon/avatar, edge_ratio={edge_ratio:.4f})")
                            continue
                        # Filter: reject colorful avatars — real cards are mostly white/gray (low saturation)
                        # Avatar photos have rich colors across the entire image
                        hsv_card = _cv2.cvtColor(c['image'], _cv2.COLOR_BGR2HSV)
                        sat_mean = float(hsv_card[:, :, 1].mean())
                        if sat_mean > 80:
                            logger.info(f"[ActionParser] Card {idx}: SKIPPED (colorful avatar, sat_mean={sat_mean:.1f})")
                            continue
                    

                    # (Interactive correction removed to prevent blocking Celery worker)
                    if c['name'] == '??' or c['confidence'] < 0.70:
                        logger.debug(f"[ActionParser] River card {idx} has low confidence ({c['confidence']:.2f}) or is unknown: {c['name']}")
                    
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
            t_lower = text.strip().lower()
            if t_lower in NOISE_KEYWORDS:
                continue
            # Skip percentage values (win equity like 20%, 98%) — not player names
            if re.match(r'^\d{1,3}%$', t_lower):
                continue
            # Skip insurance/jackpot labels (e.g. 'JP:$ 1,026')
            if t_lower.startswith('jp'):
                continue

            col_idx = min(range(5), key=lambda i: abs(x_c - header_centers[i]))
            buckets[col_idx].append({"text": text, "y": y_c, "bbox": box[0]})

        # ═══ Phase 4: Sequential Merge (Vertical Stack) ═══
        player_counter = 0  # Auto-name counter for mobile (no player names, only positions)
        pos_to_player = {}  # Cross-street dedup: same position = same player
        for i, bucket in enumerate(buckets):
            bucket.sort(key=lambda b: b['y'])
            street_key = STREET_KEYS[i]
            current_entry = {}
            pot_found = False
            pending_action = ""   # Buffer for orphan action found before position badge
            pending_amount = ""   # Buffer for orphan amount found before position badge

            for item in bucket:
                line = item['text']
                l_clean = line.strip().lower()

                # Skip pure header text (street names without amounts)
                # "Cược Ante" in col 0 (blinds_ante) is a header; in other cols it's an action
                is_ante_action = (i > 0) and any(kw in l_clean for kw in ["cược", "cuộc", "cuoc"])
                is_header = (
                    any(kw in l_clean for kw in ["blind", "ante", "pre-flop", "flop", "turn", "river"])
                    and len(l_clean) < 15
                    and not is_ante_action  # Don't filter "Cược Ante" as header in non-blind columns
                )
                if is_header:
                    has_bb_amount = bool(re.search(r'\d', l_clean)) and has_currency_marker(l_clean)
                    if not has_bb_amount:
                        continue

                # Pot detection: first $amount in any col, before any player
                if has_currency_marker(l_clean) and not current_entry and not pot_found and len(l_clean) < 20:
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

                # DEBUG: Show raw OCR ordering for key columns
                if i <= 1 or i == 4:  # blinds_ante, preflop, and river buckets
                    tag = "POS" if is_pos else "ACT" if is_action else "$$" if is_money else "WIN" if is_winner else "HDR" if is_header else "???"
                    cur_player = current_entry.get('player', 'NONE')
                    col_name = {0: "BLIND", 1: "PREFL", 4: "RIVER"}.get(i, f"COL{i}")
                    logger.debug(f"[DBG {col_name}] Y={item['y']:4.0f} [{tag:3s}] '{line}' | cur={cur_player} pend_act='{pending_action}' pend_amt='{pending_amount}'")

                # State-Based Merging
                # Position tag: on mobile layout, position IS the start of a new entry
                # (mobile has no player names, only pos badges like UTG, CO, MP)
                if is_pos:
                    norm_pos = normalize_pos(line)
                    # Dedup: if current entry has same pos and is within ~50px Y, merge
                    if (current_entry.get('pos') == norm_pos
                            and abs(current_entry.get('_y', 0) - item['y']) < 50):
                        continue  # Skip duplicate position badge
                    if current_entry.get('player'):
                        streets_data[street_key].append(current_entry)
                    # Cross-street dedup: same position = same player
                    if norm_pos not in pos_to_player:
                        player_counter += 1
                        pos_to_player[norm_pos] = f"Player{player_counter}"
                    current_entry = {
                        "player": pos_to_player[norm_pos], "pos": norm_pos,
                        "action": "", "amount": "", "hand": [],
                        "_y": item['y']
                    }
                    # If there's a pending action from a previous orphan line, assign it now
                    if pending_action:
                        current_entry['action'] = pending_action
                        pending_action = ""
                    if pending_amount:
                        current_entry['amount'] = pending_amount
                        pending_amount = ""
                    continue

                # Player name: not pos/action/money/winner, length >= 3, not noise
                is_likely_player = (
                    not is_pos and not is_action and not is_money and not is_winner
                    and len(l_clean) >= 3
                    and not re.match(r'^\d{1,3}%?$', l_clean)
                    and l_clean not in NOISE_KEYWORDS
                    and not l_clean.startswith('jp')
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
                        current_entry['pos'] = normalize_pos(line)
                    elif is_winner:
                        current_entry['action'] = "WINNER"
                    elif is_action or is_money:
                        # Action + Amount splitting
                        found_act = ""
                        # List of standard mapped actions
                        ACTION_MAP = {
                            "cược": ["cược", "cuoc", "cugc"],
                            "tố": ["tố", "to", "tot", "tốt", "t6"],
                            "check": ["kiểm tra", "kiem tra", "check"],
                            "theo": ["theo", "call"],
                            "bỏ bài": ["bỏ bài", "bo bai", "b6 bai", "fold"],
                            "all-in": ["all-in", "tất tay", "tố tất", "to tat"],
                            "ante": ["cược ante", "cuoc ante"],
                            "straddle": ["str", "straddle"],
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
                            # Straddle always belongs to NEXT player (UTG), never current (BB)
                            if found_act.lower() == 'straddle':
                                pending_action = found_act
                            elif not current_entry['action']:
                                current_entry['action'] = found_act
                            else:
                                # Current entry already has action → this action belongs to NEXT player
                                # Buffer it for the next position badge
                                pending_action = found_act

                            # Extract amount if present in same line
                            amt_match = re.search(
                                r"([+\-]?\d[\d\.,\s]*\d|\d)",
                                l_clean.replace(matched_variant, "")
                            )
                            if amt_match:
                                amt_val = amt_match.group(1).strip() + (" BB" if "bb" in l_clean else "")
                                if not current_entry['amount']:
                                    current_entry['amount'] = amt_val
                                else:
                                    pending_amount = amt_val
                        elif is_money:
                            if not current_entry['amount']:
                                current_entry['amount'] = line
                            else:
                                pending_amount = line

                elif is_winner:
                    # Winner text found but no current player - skip
                    pass
                elif is_action or is_money:
                    # Orphan action/amount: no current entry yet
                    # Buffer for the next position badge (mobile layout: action ABOVE position)
                    if is_action:
                        found_act = ""
                        ACTION_MAP = {
                            "cược": ["cược", "cuoc", "cugc"],
                            "tố": ["tố", "to", "tot", "tốt", "t6"],
                            "check": ["kiểm tra", "kiem tra", "check"],
                            "theo": ["theo", "call"],
                            "bỏ bài": ["bỏ bài", "bo bai", "b6 bai", "fold"],
                            "all-in": ["all-in", "tất tay", "tố tất", "to tat"],
                            "ante": ["cược ante", "cuoc ante"],
                            "straddle": ["str", "straddle"],
                        }
                        for std_act, variants in ACTION_MAP.items():
                            for v in variants:
                                if v == l_clean or (v in l_clean and len(l_clean) < len(v) + 8):
                                    found_act = std_act.capitalize()
                                    break
                            if found_act:
                                break
                        if found_act:
                            pending_action = found_act
                    if is_money:
                        pending_amount = line

            # Close last entry
            if current_entry.get('player'):
                streets_data[street_key].append(current_entry)

            # Blinds_ante: use pot from preflop header if available
            # (don't sum individual entries — that double-counts)

            # Card Matching: match cards to closest player entry by absolute Y distance
            # (on WPT Global mobile, cards can appear ABOVE or BELOW the position badge)
            col_entries_with_y = sorted(
                [e for e in streets_data[street_key] if '_y' in e],
                key=lambda e: e['_y']
            )
            # DEBUG: show river entries for card matching
            if street_key == 'river' and col_entries_with_y:
                for dbg_e in col_entries_with_y:
                    logger.debug(f"[DBG RIVER_ENTRY] {dbg_e.get('player','?')} Y={dbg_e.get('_y',0):.0f} act={dbg_e.get('action','')} amt={dbg_e.get('amount','')}")
            for card in found_player_hands:
                c_col = min(range(5), key=lambda ci: abs(card['x'] - header_centers[ci]))
                if c_col != i:
                    continue
                card_y = card['y']
                best_entry = None
                best_dist = 200
                for entry in col_entries_with_y:
                    dist = abs(card_y - entry['_y'])
                    if dist < best_dist:
                        best_dist = dist
                        best_entry = entry
                if best_entry:
                    best_entry['hand'].append(card['name'])
                    if card.get('image') is not None:
                        best_entry.setdefault('card_images', []).append(card['image'])
                    # DEBUG: card assignment
                    if street_key == 'river':
                        logger.debug(f"[DBG CARD] card={card['name']} Y={card_y:.0f} → {best_entry.get('player','')} (entry_Y={best_entry.get('_y',0):.0f}, dist={best_dist:.0f})")
                elif street_key == 'river':
                    logger.debug(f"[DBG CARD] card={card['name']} Y={card_y:.0f} → NO MATCH")



        # ═══ Phase 4.5: Position Recovery ═══
        # Scan ALL raw OCR boxes for position tags that may have been skipped
        # (common with lang='ch' which may not detect small English badges)
        pos_boxes = []
        for box in boxes:
            text = box[1][0].strip().lower()
            x_c = sum([p[0] for p in box[0]]) / 4.0
            y_c = sum([p[1] for p in box[0]]) / 4.0
            # Exact match OR starts-with match (handles 'utg+1', 'utg+2' OCR variants)
            matched_pos = None
            if text in POS_TAGS:
                matched_pos = text.upper()
            else:
                for tag in POS_TAGS:
                    if (text.startswith(tag) or tag.startswith(text)) and len(text) >= 2:
                        matched_pos = text.upper()
                        break
            if matched_pos:
                col_idx = min(range(5), key=lambda ci: abs(x_c - header_centers[ci]))
                pos_boxes.append({"pos": normalize_pos(matched_pos), "y": y_c, "col": col_idx, "x": x_c})

        logger.debug(f"[ActionParser] Phase 4.5 Position Recovery found: {pos_boxes}")

        # Assign unmatched positions to nearest player by Y in same column
        for pos_box in pos_boxes:
            col = pos_box['col']
            street_key = STREET_KEYS[col]
            entries = streets_data.get(street_key, [])
            best_entry = None
            best_dist = 100  # Increased: 50px → 100px to handle more layout variants
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
                best_entry['pos'] = pos_box['pos']  # already normalized at collection time

        # Clean up internal _y field
        for key in STREET_KEYS:
            for entry in streets_data[key]:
                entry.pop('_y', None)

        # ═══ Phase 5: Post-Processing ═══
        self._post_process(streets_data)

        return {"streets": streets_data, "street_pots": street_pots}

    def _post_process(self, streets_data):
        """Phase 5: Dedup players, mark winners, infer signs."""

        # 5a. Deduplicate players within each street (merge TRUE duplicates only)
        # Keep separate entries when a player has different actions (e.g. Check then Call)
        for key in STREET_KEYS:
            entries = streets_data[key]
            if not entries:
                continue
            result = []
            last_by_name = {}  # player_name -> index of last entry in result
            for entry in entries:
                # Clean name: remove trailing dots or artifacts
                name = re.sub(r'\.+', '', entry['player']).strip()
                if not name:
                    continue
                entry['player'] = name

                if name in last_by_name:
                    existing = result[last_by_name[name]]
                    existing_act = existing.get('action', '').strip().lower()
                    new_act = entry.get('action', '').strip().lower()

                    # Both have different non-empty actions → separate entries (check→call, etc.)
                    if existing_act and new_act and existing_act != new_act:
                        last_by_name[name] = len(result)
                        result.append(entry)
                    else:
                        # True duplicate or partial data → merge fields
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
                        if entry.get('card_images'):
                            existing.setdefault('card_images', []).extend(entry['card_images'])
                else:
                    last_by_name[name] = len(result)
                    result.append(entry)
            streets_data[key] = result

        # 5b. Check cleanup: Check action never has an amount
        # (the amount belongs to the next player's bet/raise, misassigned by OCR ordering)
        CHECK_KEYWORDS = ['check', 'kiểm tra', 'kiem tra']
        for key in STREET_KEYS:
            for entry in streets_data.get(key, []):
                action_lower = entry.get('action', '').strip().lower()
                if any(ck in action_lower for ck in CHECK_KEYWORDS) and entry.get('amount'):
                    entry['amount'] = ''

        # 5c. River: mark +amount entries as WINNER
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

        # 5e. River cleanup: remove players who folded in earlier streets
        # First: identify folded players
        folded_players = set()
        for street_key in ["blinds_ante", "preflop", "flop", "turn"]:
            for entry in streets_data.get(street_key, []):
                action_lower = entry.get('action', '').strip().lower()
                if any(fold_kw in action_lower for fold_kw in ['bỏ bài', 'bo bai', 'fold', 'b6 bai']):
                    folded_players.add(entry.get('player', ''))

        # Strip ghost hands from folded players (card detector artifacts)
        # Only WINNERS keep their hands; folded players can't show cards
        for entry in streets_data.get("river", []):
            player = entry.get('player', '')
            if player in folded_players and entry.get('action') != 'WINNER':
                entry['hand'] = []

        # Protect winners — they stay even if marked as folded (OCR misread)
        protected_players = set()
        for entry in streets_data.get("river", []):
            if entry.get('action') == 'WINNER':
                protected_players.add(entry.get('player', ''))

        # Remove folded (non-protected) players from river
        removable = folded_players - protected_players
        if removable:
            streets_data['river'] = [
                e for e in streets_data.get('river', [])
                if e.get('player', '') not in removable
            ]
