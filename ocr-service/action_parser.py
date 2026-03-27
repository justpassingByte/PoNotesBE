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

STREET_KEYS = ["blinds_ante", "preflop", "flop", "turn", "river", "showdown"]

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

# Currency markers recognized across BB, USD, and CNY formats
# Includes common OCR misreads in various encodings (Windows/Docker)
CURRENCY_MARKERS = [
    "bb", "$", "¥", "￥", "元", 
    "∩┐Ñ", "∩┐ñ", "┬Ñ", "┬ñ", "Γö╝", "√ê", "√Ñ", "∩┐╝"
]

def has_currency_marker(text_lower):
    """Check if text contains any known currency marker."""
    return any(c in text_lower for c in CURRENCY_MARKERS)

def is_money_text(text_lower):
    """Check if text is likely just a money value (digits + currency)."""
    # Remove markers and whitespace
    clean = text_lower
    for c in CURRENCY_MARKERS:
        clean = clean.replace(c, "")
    clean = clean.strip()
    # If it's pure digits/dots/commas, it's money
    return bool(re.match(r'^[\d\s\.,]+$', clean)) and clean != ""

_ACTION_NORMALIZE = {
    "kiểm tra": "Check", "kiem tra": "Check",
    "cược": "Bet", "cuoc": "Bet", "cugc": "Bet",
    "tố": "Raise", "to": "Raise", "tốt": "Raise", "tot": "Raise", "t6": "Raise",
    "theo": "Call",
    "bỏ bài": "Fold", "bo bai": "Fold", "b6 bài": "Fold",
    "check": "Check", "fold": "Fold", "call": "Call", "raise": "Raise", "bet": "Bet", "all-in": "All-In",
    "tất tay": "All-In", "tố tất": "All-In", "to tat": "All-In",
    "str": "Straddle", "straddle": "Straddle", "strade": "Straddle",
    "bảo hiểm": "Insurance", "bao hiem": "Insurance", "insurance": "Insurance"
}

def normalize_action(text: str) -> str:
    """Normalize action text to standard English labels."""
    low = text.strip().lower()
    # Use word boundaries for English keywords
    for kw, norm in _ACTION_NORMALIZE.items():
        if kw == low:
            return norm
        # For multi-word or common fragments, be careful
        if len(kw) > 3 and kw in low:
            return norm
        # Stricter check for Vietnamese 'tố' or 'to'
        if kw in ['tố', 'to'] and low == kw:
            return norm
    return text.strip().capitalize()

def is_signed_amount(text: str) -> bool:
    """Check if text is a signed amount like '+￥74' or '-$31'."""
    low = text.strip().lower()
    # Check for +/- followed by optional marker and digits
    pattern = r'^[+-][^0-9]?\s*[\d\.,]+'
    return bool(re.match(pattern, low)) or (('+' in low or '-' in low) and has_currency_marker(low))

ACTIONS_LIST = list(_ACTION_NORMALIZE.keys()) + [
    "cược ante", "cuoc ante", "str", "straddle"
]

def is_action_text(text_lower):
    """Stricter check if text is a poker action."""
    for act in ACTIONS_LIST:
        if act == text_lower:
            return True
        # Allow fragments only for longer specific keywords
        if len(act) > 3 and act in text_lower and len(text_lower) < len(act) + 4:
            return True
    return False

WINNER_KEYWORDS = ["winner", "thắng", "win", "won"]

# Text that should never be treated as a player name
NOISE_KEYWORDS = [
    "winner", "pot", "total", "tổng", "tong",
    "pre-flop", "flop", "turn", "river", "trước flop", "truoc flop",
    "tố tất", "to tat", "jp", "盲注", "翻牌前",
]


# ─────────────────────────────────────────────
# Utility Functions


def greedy_pot(s):
    """Extract pot number, handling OCR splitting (e.g. '1 . 947' → '1.947')"""
    s = re.sub(r'(\d)\s+([.,])\s*(\d)', r'\1\2\3', s)
    s = re.sub(r'(\d)\s+(\d)', r'\1\2', s)
    m = re.search(r"(\d[\d\.,]*\d|\d)", s)
    return m.group(1).strip() if m else "0"



def parse_bb_value(text: str) -> float:
    """
    Extract numeric value from text like '+¥693', '-¥4', '22,395', '1.947 BB'.
    Handles commas/dots as thousands separators.
    """
    if not text:
        return 0.0
        
    # Standardize: keep digits, dots, commas, 'k', and negative sign
    clean = re.sub(r'[^-\d\.,k]', '', text.lower())
    if not clean:
        return 0.0

    # Pattern X,XXX or X.XXX (exactly 3 digits after separator) is likely thousands
    if re.match(r'^-?\d+[.,]\d{3}$', clean):
        clean = clean.replace('.', '').replace(',', '')
    else:
        clean = clean.replace(',', '.')

    try:
        if 'k' in clean:
            return float(clean.replace('k', '')) * 1000.0
        return float(clean)
    except:
        return 0.0

def parse_currency(text: str) -> float:
    return parse_bb_value(text)


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
            return {"streets": streets_data, "street_pots": street_pots, "winner": {"player": None, "amount": None}}

        h_act, w_act = action_img.shape[:2]
        boxes = ocr_results[0]

        # ═══ Phase 1: Header Detection ═══
        header_centers = [(idx + 0.5) * (w_act / 5.0) for idx in range(5)]
        
        # Header keywords with multi-language support (English, Vietnamese, Chinese)
        header_keywords = [
            ["blind", "mù", "ante", "盲注", "前注"], # Blinds
            ["pre-flop", "trước flop", "truoc flop", "前牌"], # Pre-flop
            ["flop", "翻牌"],
            ["turn", "转牌"],
            ["river", "河牌"]
        ]
        
        found_headers = [False] * 5
        header_y_values = []

        for box in boxes:
            text = box[1][0].lower().strip()
            x_c = sum([p[0] for p in box[0]]) / 4.0
            y_c = sum([p[1] for p in box[0]]) / 4.0
            
            for idx, kws in enumerate(header_keywords):
                if not found_headers[idx] and any(kw in text for kw in kws):
                    # Guard against "pre-flop" matching "flop"
                    if idx == 2 and ("pre" in text or "trước" in text or "truoc" in text):
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
                # Cắt thật sát cột "Hand" (cột số 4) để tránh lấn sân sang cột "Amount" hoặc "Action"
                # Cột Hand bắt đầu từ tâm lùi lại khoảng 0.3 là an toàn và tránh được chữ "WINNER" / số tiền
                river_x1 = max(0, int(header_centers[4] - col_width * 0.3))
                right_limit = sidebar_x if sidebar_x is not None else w_act
                river_x2 = min(int(right_limit), int(header_centers[4] + col_width * 0.5))
                river_col_img = action_img[:, river_x1:river_x2]



                log_cards = card_detector.detect_cards_with_info(river_col_img, min_group_size=1, context="river")
                for idx, c in enumerate(log_cards.get('cards', [])):
                    rect = c.get('rect', [0,0,0,0])
                    cw, ch = rect[2], rect[3]
                    logger.info(f"[ActionParser] Card {idx}: name={c['name']} conf={c['confidence']:.2f} rect={rect} (w={cw}x{ch}px) center={c['center']}")
                    
                    # Symbol-based detection: cards are rank+suit symbol pairs, not full card rects
                    # Skip cards with very low confidence (noise from action text)
                    if c['confidence'] < 0.35:
                        logger.info(f"[ActionParser] Card {idx}: SKIPPED (low confidence {c['confidence']:.2f})")
                        continue
                    
                    # Skip unknown cards with no valid rank
                    if c['name'] == '??':
                        logger.debug(f"[ActionParser] River card {idx}: SKIPPED (unknown)")
                        continue
                    
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
        all_card_rects = [] # Collect all card rects for debug dumping
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

                # Content type identification
                is_pos = (l_clean in POS_TAGS)
                is_action = is_action_text(l_clean)
                is_money = (is_money_text(l_clean) or is_signed_amount(l_clean)) and not is_pos
                is_winner = any(wk in l_clean for wk in WINNER_KEYWORDS)

                # Pot / Ante detection: robust check for lines starting with non-alphanumeric currency/metadata
                # This catches ￥14, ∩┐Ñ105, etc. even with encoding issues.
                # Regex meaning: starts with a non-word char (like ￥, $, ∩) OR contains currency marker
                is_money_prefix = bool(re.match(r'^[^\w\s\(\.]', l_clean)) or has_currency_marker(l_clean)
                has_digits = bool(re.search(r'\d', l_clean))
                
                # If it's a "money-like" line and we haven't found a player yet, it's a Pot
                if (is_money_prefix and has_digits and not is_signed_amount(l_clean)) and not current_entry and not pot_found:
                    # Special case: ignore if it's a known position tag (though rare to have money in pos)
                    if not is_pos:
                        street_pots[street_key] = line
                        pot_found = True
                        # Pot lines often contain the first action (e.g. "￥14 Raise")
                        if any(act in l_clean for act in ["raise", "call", "fold", "check", "bet", "tố", "theo", "bỏ"]):
                            pending_action = normalize_action(line)
                        continue

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
                    
                    # If we ALREADY have a player name from a previous line in this bucket, keep it!
                    # Otherwise, use mapping/PlayerX fallback
                    if not current_entry.get('player'):
                        if norm_pos not in pos_to_player:
                            player_counter += 1
                            pos_to_player[norm_pos] = f"Player{player_counter}"
                        
                        current_entry = {
                            "player": pos_to_player[norm_pos], "pos": norm_pos,
                            "action": "", "sub_action": "", "amount": "", "hand": [],
                            "_y": item['y']
                        }
                    else:
                        # Existing player from actual name line - just attach position
                        current_entry['pos'] = norm_pos
                        if not current_entry.get('_y'):
                             current_entry['_y'] = item['y']
                    
                    # If there's a pending action from a previous orphan line, assign it now
                    if pending_action:
                        current_entry['action'] = pending_action
                        pending_action = ""
                    if pending_amount:
                        current_entry['amount'] = pending_amount
                        pending_amount = ""
                    continue

                # Player name: not pos/action/money/winner, length >= 2 (Chinese names), not noise
                # WPT PC: Names are usually 2+ chars. If it starts with money symbol and is short, it's noise.
                is_likely_player = (
                    not is_pos and not is_action and not is_money and not is_winner
                    and len(l_clean) >= 2
                    and not (is_money_prefix and len(l_clean) < 6)
                    and not re.match(r'^\d{1,3}%?$', l_clean)
                    and l_clean not in NOISE_KEYWORDS
                    and not l_clean.startswith('jp')
                    and not is_header
                )
                if is_likely_player:
                    # New player name detected
                    if current_entry.get('player'):
                        streets_data[street_key].append(current_entry)
                    current_entry = {
                        "player": line, "pos": "", "action": "", "sub_action": "", "amount": "", "hand": [],
                        "_y": item['y']
                    }
                elif current_entry.get('player'):
                    # Assign to current player
                    if is_pos and not current_entry['pos']:
                        current_entry['pos'] = normalize_pos(line)
                    elif is_winner:
                        current_entry['action'] = "WINNER"
                    elif is_action:
                        norm_act = normalize_action(line)
                        # On PC, Straddle/All-In often appear right under the main action (e.g. Raise)
                        if not current_entry['action']:
                            current_entry['action'] = norm_act
                        else:
                            # We already have a main action. This must be a sub-action (like All-in or Insurance)
                            # because no new player name/pos badge bounded it.
                            if not current_entry.get('sub_action'):
                                current_entry['sub_action'] = norm_act
                            elif norm_act not in current_entry['sub_action']:
                                current_entry['sub_action'] += f", {norm_act}"

                        # Match first sequence of digits
                        clean_for_amt = l_clean
                        for kw in ["straddle", "str", "raise", "call", "bet", "tố", "tá", "theo", "check", "fold"]:
                            clean_for_amt = clean_for_amt.replace(kw, "")
                        
                        amt_match = re.search(r"(\d[\d\.,\s]*\d|\d)", clean_for_amt)
                        if amt_match:
                            val = amt_match.group(1).strip().replace(" ", "")
                            amt_val = val + (" BB" if "bb" in l_clean else "")
                            if not current_entry['amount']:
                                current_entry['amount'] = amt_val
                            else:
                                current_entry['amount'] = amt_val
                    elif is_money:
                        if not current_entry['amount']:
                            current_entry['amount'] = line
                        else:
                            # If amount already exists, same logic: push old, create new
                            if current_entry['action']:
                                streets_data[street_key].append(current_entry)
                                current_entry = {
                                    "player": current_entry['player'],
                                    "pos": current_entry['pos'],
                                    "action": "",
                                    "sub_action": "",
                                    "amount": line,
                                    "hand": [],
                                    "_y": item['y']
                                }
                            else:
                                current_entry['amount'] = line

                elif is_winner:
                    # Winner text found but no current player - skip
                    pass
                elif is_action or is_money:
                    # Orphan action/amount: no current entry yet
                    # Buffer for the next position badge (mobile layout: action ABOVE position)
                    if is_action:
                        norm_act = normalize_action(line)
                        pending_action = norm_act
                    if is_money:
                        pending_amount = line

            # Close last entry
            if current_entry.get('player'):
                streets_data[street_key].append(current_entry)

            # Blinds_ante: use pot from preflop header if available
            # (don't sum individual entries — that double-counts)

            # Skip the separate showdown split logic - keep everything in river
            if street_key == 'river':
                # Build showdown_players: players with WINNER/LOSER or no gameplay action
                gameplay_actions = {'check', 'bet', 'raise', 'call', 'fold', 'all-in', 'straddle'}
                showdown_players = set()
                for e in streets_data[street_key]:
                    pname = e.get('player', '')
                    act = e.get('action', '').strip().lower()
                    if pname and (not act or act in ('winner', 'loser') or act not in gameplay_actions):
                        showdown_players.add(pname)

                # Split: action entries (have action like Check) → stay in river
                # Result entries (no action) for SHOWDOWN players → showdown
                action_entries = []
                showdown_entries = []
                for e in streets_data[street_key]:
                    pname = e.get('player', '')
                    if e.get('action', '') and e.get('action', '').strip().lower() in gameplay_actions:
                        action_entries.append(e)  # Check, Bet, etc. → river
                    elif pname in showdown_players:
                        showdown_entries.append(e)  # WINNER/LOSER only → showdown
                
                # ONLY split if river has actual action entries.
                # If river has NO actions (e.g., all-in runout), keep everything in river
                # and match cards to river entries directly.
                if action_entries:
                    streets_data[street_key] = action_entries
                    streets_data['showdown'] = showdown_entries
                    card_match_entries = showdown_entries
                    card_match_players = showdown_players
                    print(f"  [Showdown] Split: {len(action_entries)} action + {len(showdown_entries)} showdown")
                else:
                    # No actions in river → don't split, keep all in river
                    # All entries are result-only, match cards to them
                    card_match_entries = streets_data[street_key]
                    card_match_players = {e.get('player', '') for e in card_match_entries if e.get('player', '')}
                    print(f"  [Showdown] No river actions → keeping {len(card_match_entries)} entries in river")
                
                # Card Matching: for entries that have results (showdown or river)
                entries_with_y = sorted(
                    [e for e in card_match_entries 
                     if '_y' in e and e.get('player', '') in card_match_players],
                    key=lambda e: e['_y']
                )
                
                if entries_with_y:
                    print(f"  [Card Match] Entries for card matching (filtered):")
                    for dbg_e in entries_with_y:
                        print(f"    {dbg_e.get('player','?')} Y={dbg_e.get('_y',0):.0f}")
                
                # Sort cards by Y, then X (left card first in pair)
                river_cards = sorted(
                    [c for c in found_player_hands 
                     if min(range(5), key=lambda ci: abs(c['x'] - header_centers[ci])) == i],
                    key=lambda c: (c['y'], c['x'])
                )
                
                # Map cards by iterating OVER players, so fake overlapping cards don't steal slots.
                # Find all cards close to each player, then pick the Top 2 highest confidence ones.
                assigned_cards = set()
                for entry in entries_with_y:
                    player_y = entry['_y']
                    # Find all cards within ~100px of this player
                    candidates = []
                    for cid, card in enumerate(river_cards):
                        if cid in assigned_cards: continue
                        dist = abs(card['y'] - player_y)
                        if dist < 110:  # Card pairs can be slightly offset natively, 110px is safe given ~150px spacing
                            candidates.append((dist, cid, card))
                            
                    # Sort candidates primarily by confidence (descending) so real cards beat fake ones
                    candidates.sort(key=lambda x: (x[2].get('confidence', 0), -x[0]), reverse=True)
                    
                    # Take up to 2 cards
                    taken = candidates[:2]
                    # Restore left-to-right order for the picked cards
                    taken.sort(key=lambda x: x[2]['x'])
                    
                    for dist, cid, card in taken:
                        assigned_cards.add(cid)
                        entry.setdefault('hand', []).append(card['name'])
                        if card.get('image') is not None:
                            entry.setdefault('card_images', []).append(card['image'])
                        print(f"    [Card Match] player={entry.get('player','')} picked card={card['name']} Y={card['y']:.0f} (dist={dist:.0f}, conf={card.get('confidence',0):.2f})")


                # Store ALL card rects for debug dumping
                all_card_rects = []
                for card in river_cards:
                    all_card_rects.append({
                        'name': card.get('name', '??'),
                        'y': card.get('y', 0),
                        'image': card.get('image'),
                    })


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

        # ═══ Phase 5.5: Winner Extraction & Summary ═══
        winner_info = {"player": None, "amount": None}
        for street_key in STREET_KEYS:
            for entry in streets_data[street_key]:
                if entry.get('action') == 'WINNER' or any(wk in str(entry.get('player','')).lower() for wk in WINNER_KEYWORDS):
                    winner_info["player"] = entry['player']
                    winner_info["amount"] = entry.get('amount')
                    break
        
        # If no winner found in entries, scan all buckets for a standalone Winner line
        if not winner_info["player"]:
            for bucket in buckets:
                for item in bucket:
                    line = item['text']
                    l_clean = line.lower()
                    if any(wk in l_clean for wk in WINNER_KEYWORDS):
                        # Extract amount from the same line if present
                        amt_match = re.search(r"(\d[\d\.,\s]*\d|\d)", l_clean)
                        winner_info["amount"] = amt_match.group(1).strip() if amt_match else None
                        
                        # Try to find a player name in the same line by removing winner/amount
                        clean_name = line
                        for wk in WINNER_KEYWORDS:
                            pattern = re.compile(re.escape(wk), re.IGNORECASE)
                            clean_name = pattern.sub("", clean_name)
                        if winner_info["amount"]:
                            clean_name = clean_name.replace(winner_info["amount"], "")
                        
                        clean_name = clean_name.strip(":, \t\n\r")
                        if len(clean_name) >= 2 and clean_name.lower() not in NOISE_KEYWORDS:
                            winner_info["player"] = clean_name
                        break

        return {
            "streets": streets_data,
            "street_pots": street_pots,
            "winner": winner_info,
            "all_card_rects": all_card_rects if 'all_card_rects' in dir() else []
        }

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
                    # Vietnamese / Thai / Chinese mappings
                    action_map = {
                        "tố": "Raise",
                        "theo": "Call",
                        "bỏ bài": "Fold"
                    }
                    existing_act = existing.get('action', '').strip().lower()
                    for vi, en in action_map.items():
                        if vi in existing_act:
                            existing_act = en.lower()
                            break
                    new_act = entry.get('action', '').strip().lower()
                    for vi, en in action_map.items():
                        if vi in new_act:
                            new_act = en.lower()
                            break

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

                        # Merge sub_action 
                        if entry.get('sub_action'):
                            if not existing.get('sub_action'):
                                existing['sub_action'] = entry['sub_action']
                            elif entry['sub_action'] not in existing['sub_action']:
                                existing['sub_action'] += f", {entry['sub_action']}"

                        if entry.get('hand'):
                            existing['hand'] = list(set(existing.get('hand', []) + entry['hand']))[:2]
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
                amt = entry.get('amount', '').strip()
                # Only clear unsigned amounts from Check entries (those are misassigned bet sizes)
                # Preserve signed amounts (+/-) — those are win/loss results, not bets
                if any(ck in action_lower for ck in CHECK_KEYWORDS) and amt and not amt.startswith('+') and not amt.startswith('-'):
                    entry['amount'] = ''

        # 5c/d. River: extract WINNER/LOSER. Non-winners with unsigned amounts in River must be losses (-)
        # We also move ALL WINNER and LOSER entries into Showdown so they don't pollute River actions.
        new_river = []
        has_winner = any(e.get('action') == 'WINNER' or e.get('amount', '').strip().startswith('+') for e in streets_data.get("river", []) + streets_data.get("showdown", []))
        
        for entry in streets_data.get("river", []):
            amt = entry.get('amount', '').strip()
            
            # Identify if it's a result (Win/Loss) rather than an action
            is_result = False
            
            if amt.startswith('+'):
                entry['action'] = "WINNER"
                is_result = True
            elif amt.startswith('-'):
                entry['action'] = "LOSER"
                is_result = True
            elif has_winner and amt and entry.get('action') not in ('WINNER', 'LOSER', 'Check', 'Fold', 'Call', 'Raise', 'Bet', 'All-In', 'Straddle'):
                # It has an amount but no known action, and someone already won -> must be a loss
                entry['amount'] = '-' + amt if not amt.startswith('-') and not amt.startswith('+') else amt
                entry['action'] = "LOSER"
                is_result = True
            
            # If it's explicitly marked WINNER or LOSER, it goes to showdown
            if entry.get('action') in ("WINNER", "LOSER") or is_result:
                streets_data.setdefault('showdown', []).append(entry)
            else:
                new_river.append(entry)
                
        streets_data["river"] = new_river

        # 5d. Showdown: hardcode LOSER for unsigned amounts when a WINNER exists
        # PaddleOCR often fails to read the minus sign (-) so we infer it
        has_showdown_winner = any(
            e.get('action') == 'WINNER' or e.get('amount', '').strip().startswith('+')
            for e in streets_data.get('showdown', [])
        )
        if has_showdown_winner:
            for entry in streets_data.get('showdown', []):
                amt = entry.get('amount', '').strip()
                if amt and not amt.startswith('+') and not amt.startswith('-') and entry.get('action') != 'WINNER':
                    entry['amount'] = '-' + amt
                    entry['action'] = 'LOSER'

        # 5e. River/Showdown cleanup: remove players who folded in earlier streets
        # First: identify folded players
        folded_players = set()
        for street_key in ["blinds_ante", "preflop", "flop", "turn"]:
            for entry in streets_data.get(street_key, []):
                action_lower = entry.get('action', '').strip().lower()
                if any(fold_kw in action_lower for fold_kw in ['bỏ bài', 'bo bai', 'fold', 'b6 bai']):
                    folded_players.add(entry.get('player', ''))

        # Strip ghost hands from folded players (card detector artifacts)
        # Only WINNERS keep their hands; folded players can't show cards
        for sk in ["river", "showdown"]:
            for entry in streets_data.get(sk, []):
                player = entry.get('player', '')
                if player in folded_players and entry.get('action') != 'WINNER':
                    entry['hand'] = []

        # Protect winners — they stay even if marked as folded (OCR misread)
        protected_players = set()
        for sk in ["river", "showdown"]:
            for entry in streets_data.get(sk, []):
                if entry.get('action') == 'WINNER':
                    protected_players.add(entry.get('player', ''))

        # Remove folded (non-protected) players from river and showdown
        removable = folded_players - protected_players
        if removable:
            for sk in ["river", "showdown"]:
                streets_data[sk] = [
                    e for e in streets_data.get(sk, [])
                    if e.get('player', '') not in removable
                ]
