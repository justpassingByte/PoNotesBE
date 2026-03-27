import cv2
import numpy as np
import json
import os
import time
import math
import logging

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Card Recognition Utilities
# ─────────────────────────────────────────────

VALID_RANKS = {'a', 'k', 'q', 'j', 't', '10', '9', '8', '7', '6', '5', '4', '3', '2'}

RANK_MAP = {
    '10': '10', '1o': '10', 'io': '10', 'l0': '10',
    '1': 'A',
    '09': '9', '06': '6', '08': '8', '07': '7',
    '05': '5', '04': '4', '03': '3', '02': '2',
    'o9': '9', 'o6': '6', 'o8': '8', 'o4': '4',
    'ok': 'K', 'oq': 'Q', 'oj': 'J',
}


def normalize_card_rank(name):
    """Normalize OCR text to standard poker card rank. Returns (rank, suit_hint)."""
    n = name.strip()
    # Check for rank+suit pattern (e.g. '8d', 'Ah', '10s')
    suit_hint = None
    import re
    m = re.match(r'^((?:10|[2-9TJQKA]))([HDCS])$', n, re.IGNORECASE)
    if m:
        return m.group(1).upper(), m.group(2).lower()
    
    # Existing logic for rank-only or partials
    lower = n.lower()
    if lower in RANK_MAP:
        return RANK_MAP[lower], None
    if lower in VALID_RANKS:
        return (n.upper() if len(n) == 1 else n), None
    if len(n) >= 2:
        # Check for '08' -> '8', 'o8' -> '8' etc
        if n[0] == '0' or n[0].lower() == 'o':
            rest = n[1:].lower()
            if rest in VALID_RANKS:
                return (rest.upper() if len(rest) == 1 else rest), None
            if rest in RANK_MAP:
                return RANK_MAP[rest], None
        # Handle cases where suit might be there but not matched by regex (e.g. '8.' or '8 ')
        first = n[0].lower()
        if first in VALID_RANKS:
            return first.upper(), None
        if first in RANK_MAP:
            return RANK_MAP[first], None
    return n, None


def is_valid_card_rank(name):
    """Check if text looks like a valid poker card rank."""
    lower = name.strip().lower()
    # If it's rank+suit, it's valid
    import re
    if re.match(r'^(?:10|[2-9TJQKA])[HDCS]$', lower, re.IGNORECASE):
        return True
    return lower in VALID_RANKS or lower in RANK_MAP


# Removed get_suit_from_color as suit is now detected via symbol templates

# ─────────────────────────────────────────────
# LayoutEngine
# ─────────────────────────────────────────────
class LayoutEngine:
    def __init__(self, config_path="layout_config.json"):
        if not os.path.exists(config_path):
            self.config = {"layouts": []}
        else:
            with open(config_path, 'r') as f:
                self.config = json.load(f)
        self.templates_dir = "templates/anchors"

    def match_layout(self, image, ocr_engine=None):
        """
        Multi-signal layout detection.
        Score = anchor_match (70%) + aspect_ratio bonus (30%).
        OCR keyword matching is optional and skipped if ocr_engine is None.
        Returns (layout_dict, score) for best match above threshold.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        h, w = image.shape[:2]
        aspect_ratio = w / float(h)

        # Call OCR only if an engine is provided (for backward compat)
        ocr_results = []
        if ocr_engine:
            try:
                res = ocr_engine.ocr(image, cls=False)
                if res and res[0]:
                    ocr_results = res[0]
            except Exception as e:
                logger.warning(f"[LayoutEngine] OCR signal failed: {e}")

        best_match = None
        max_score = -1

        for layout in self.config.get('layouts', []):
            score = 0.0

            # Signal 1: Anchor template matching (weight 70% when no OCR)
            anchor_weight = 0.6 if ocr_results else 0.7
            anchor_file = layout.get('anchor_file')
            if anchor_file:
                template_path = os.path.join(self.templates_dir, anchor_file)
                if os.path.exists(template_path):
                    template = cv2.imread(template_path, 0)
                    if template is not None:
                        res = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
                        _, cur_max_val, _, _ = cv2.minMaxLoc(res)
                        score += cur_max_val * anchor_weight
                        logger.debug(f"[LayoutEngine] {layout['name']} anchor score: {cur_max_val:.3f}")

            # Signal 2: OCR keyword match (weight 30%, skipped if no OCR)
            keyword = layout.get('anchor_text', '').lower()
            if keyword and ocr_results:
                for line in ocr_results:
                    if keyword in line[1][0].lower():
                        score += line[1][1] * 0.3
                        break

            # Signal 3: Aspect ratio — gradual penalty (not cliff)
            target_ratio = layout.get('aspect_ratio', 1.77)
            ratio_diff = abs(aspect_ratio - target_ratio)
            
            if ratio_diff < 0.2:
                score += 0.1   # Good match bonus
            else:
                score -= min(ratio_diff * 0.3, 0.2)  # Gradual, capped at -0.2
            
            if score > layout.get('threshold', 0.5) and score > max_score:
                max_score = score
                best_match = (layout, score)

        # Calculate sidebar scale factor for the matched layout
        if best_match:
            matched_layout = best_match[0]
            target_ratio = matched_layout.get('aspect_ratio', aspect_ratio)
            sidebar_region = matched_layout.get('regions', {}).get('sidebar')
            
            if sidebar_region and aspect_ratio < target_ratio * 0.85:
                # Sidebar was likely cropped — calculate x-scale factor
                sidebar_x1 = sidebar_region.get('x1', 0.8)
                # Content area is 0..sidebar_x1 in original, but 0..1.0 in cropped image
                self._x_scale = sidebar_x1
                logger.info(f"[LayoutEngine] Sidebar crop detected: x_scale={self._x_scale:.2f}")
            else:
                self._x_scale = 1.0

        return best_match

    def crop_region(self, image, region_coords):
        """Crop region with automatic sidebar compensation."""
        h, w = image.shape[:2]
        x_scale = getattr(self, '_x_scale', 1.0)
        
        # Scale x-coordinates if sidebar was cropped
        rx1 = region_coords['x1'] / x_scale if x_scale < 1.0 else region_coords['x1']
        rx2 = region_coords['x2'] / x_scale if x_scale < 1.0 else region_coords['x2']
        
        # Clamp to [0, 1]
        rx1, rx2 = max(0, min(1, rx1)), max(0, min(1, rx2))
        
        x1, y1 = int(rx1 * w), int(region_coords['y1'] * h)
        x2, y2 = int(rx2 * w), int(region_coords['y2'] * h)
        return image[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]


# ─────────────────────────────────────────────
# CardDetector
# ─────────────────────────────────────────────
class CardDetector:
    def __init__(self, templates_dir="templates"):
        self.templates_dir = templates_dir
        self.ranks_dir = os.path.join(templates_dir, "ranks")
        self.suits_dir = os.path.join(templates_dir, "suits")
        
        self.rank_templates = {}
        self.suit_templates_board = {}   # *_board.png — large, for board cards
        self.suit_templates_small = {}   # *_small.png — small, for river/showdown
        self._load_templates()

    def _load_templates(self):
        # Load rank templates
        if not os.path.exists(self.ranks_dir):
            os.makedirs(self.ranks_dir, exist_ok=True)
        for f in os.listdir(self.ranks_dir):
            if f.endswith('.png'):
                path = os.path.join(self.ranks_dir, f)
                img = cv2.imread(path, 0)
                if img is not None:
                    label = f.split('_')[0].split('.')[0]
                    self.rank_templates[f] = {'label': label, 'img': img}
        
        # Load suit templates — split by size
        if not os.path.exists(self.suits_dir):
            os.makedirs(self.suits_dir, exist_ok=True)
        for f in os.listdir(self.suits_dir):
            if f.endswith('.png'):
                path = os.path.join(self.suits_dir, f)
                img = cv2.imread(path, 0)
                if img is not None:
                    label = f.split('_')[0].split('.')[0]
                    entry = {'label': label, 'img': img}
                    if '_small' in f:
                        self.suit_templates_small[f] = entry
                    elif '_board' in f:
                        self.suit_templates_board[f] = entry
                    else:
                        self.suit_templates_board[f] = entry  # default to board

    def _save_debug(self, img, step_name):
        debug_dir = os.path.join(os.path.dirname(self.templates_dir), "debug_crops")
        os.makedirs(debug_dir, exist_ok=True)
        ts = int(time.time() * 1000)
        path = os.path.join(debug_dir, f"{ts}_{step_name}.png")
        cv2.imwrite(path, img)

    def _bb_iou(self, boxA, boxB):
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
        yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])
        interArea = max(0, xB - xA) * max(0, yB - yA)
        if interArea == 0: return 0.0
        boxAArea = boxA[2] * boxA[3]
        boxBArea = boxB[2] * boxB[3]
        return interArea / float(boxAArea + boxBArea - interArea)

    def _nms(self, detections, iou_threshold=0.3):
        detections = sorted(detections, key=lambda x: x['score'], reverse=True)
        keep = []
        for det in detections:
            overlap = False
            for k in keep:
                iou = self._bb_iou((det['x'], det['y'], det['w'], det['h']), 
                                   (k['x'], k['y'], k['w'], k['h']))
                if iou > iou_threshold:
                    overlap = True
                    break
            if not overlap:
                keep.append(det)
        return keep

    def _detect_symbols(self, image_gray, templates_dict, threshold=0.75, binarize=False, scales=None):
        results = []
        
        if not templates_dict:
            return []

        if binarize:
            _, binary = cv2.threshold(image_gray, 180, 255, cv2.THRESH_BINARY)
            binary_inv = cv2.bitwise_not(binary)
            search_images = [binary, binary_inv]
        else:
            search_images = [image_gray]
        
        # Multi-scale: limit scales based on context to improve speed
        if scales is None:
            scales = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]
        
        for _filename, tmpl_data in templates_dict.items():
            label = tmpl_data['label']
            tmpl_orig = tmpl_data['img']
            
            for scale in scales:
                if scale == 1.0:
                    tmpl = tmpl_orig
                else:
                    tmpl = cv2.resize(tmpl_orig, None, fx=scale, fy=scale,
                                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
                
                th, tw = tmpl.shape[:2]
                if th < 5 or tw < 5:
                    continue
                
                for search_img in search_images:
                    if th > search_img.shape[0] or tw > search_img.shape[1]:
                        continue
                        
                    res = cv2.matchTemplate(search_img, tmpl, cv2.TM_CCOEFF_NORMED)
                    loc = np.where(res >= threshold)
                    
                    for pt in zip(*loc[::-1]):
                        score = float(res[pt[1], pt[0]])
                        results.append({
                            'label': label, 'score': score,
                            'x': pt[0], 'y': pt[1], 'w': tw, 'h': th
                        })
                
        # NMS locally for this category
        return self._nms(results, iou_threshold=0.2)
        
    def _handle_failed_case(self, board_img, paired_cards, ranks, suits, context, is_reliable):
        if is_reliable:
            return
            
        # Avoid saving completely empty regions unless it's the board
        if len(ranks) == 0 and len(suits) == 0 and context != "board":
            return
            
        failed_dir = os.path.join(os.path.dirname(self.templates_dir), "templates_failed", "raw")
        os.makedirs(failed_dir, exist_ok=True)
        
        ts = int(time.time() * 1000)
        file_prefix = f"{ts}_{context}_failed"
        
        # 1. Save Crop
        img_path = os.path.join(failed_dir, f"{file_prefix}.png")
        cv2.imwrite(img_path, board_img)
        
        # 2. Save Metadata
        import json
        meta_path = os.path.join(failed_dir, f"{file_prefix}.json")
        try:
            with open(meta_path, "w") as f:
                json.dump({
                    "timestamp": ts,
                    "context": context,
                    "ranks_found": len(ranks),
                    "suits_found": len(suits),
                    "paired": [c['name'] for c in paired_cards]
                }, f)
        except Exception as e:
            logger.error(f"[FailedCaseManager] Error writing meta: {e}")
            
        logger.warning(f"[FailedCaseManager] Triggered! Context='{context}'. Saved region to {img_path}")

    def _group_symbols(self, ranks, suits):
        paired_cards = []
        used_suits = set()
        
        # Sort ranks left-to-right
        ranks.sort(key=lambda x: x['x'])
        
        for r in ranks:
            r_cx = r['x'] + r['w'] / 2.0
            r_cy = r['y'] + r['h'] / 2.0
            
            best_suit = None
            best_score = -1  # Pick highest score, not closest distance
            
            for s_idx, s in enumerate(suits):
                if s_idx in used_suits:
                    continue
                s_cx = s['x'] + s['w'] / 2.0
                s_cy = s['y'] + s['h'] / 2.0
                
                dx = abs(r_cx - s_cx)
                dy = s_cy - r_cy  # Suit should be BELOW rank
                
                # Heuristic bounds: Rank is above Suit, horizontally close
                if dx < 80 and 0 < dy < 120:
                    if s['score'] > best_score:
                        best_score = s['score']
                        best_suit = s_idx
            
            if best_suit is not None:
                s = suits[best_suit]
                used_suits.add(best_suit)
                logger.debug(f"  Paired rank {r['label']}@({r['x']},{r['y']}) with {s['label']}@({s['x']},{s['y']}) score={s['score']:.2f}")
                
                min_x = min(r['x'], s['x'])
                min_y = min(r['y'], s['y'])
                max_r = max(r['x']+r['w'], s['x']+s['w'])
                max_b = max(r['y']+r['h'], s['y']+s['h'])
                
                paired_cards.append({
                    'name': f"{r['label']}{s['label']}",
                    'confidence': (r['score'] + s['score']) / 2.0,
                    'x': min_x, 'y': min_y,
                    'w': max_r - min_x, 'h': max_b - min_y,
                    'center': (int((min_x + max_r)/2), int((min_y + max_b)/2)),
                    'is_new': False,
                    'row': 0,
                    'rect': [min_x, min_y, max_r - min_x, max_b - min_y]
                })
            else:
                # No suit found — emit rank with unknown suit
                logger.debug(f"  Unpaired rank {r['label']}@({r['x']},{r['y']}) — no suit nearby")
                paired_cards.append({
                    'name': f"{r['label']}?",
                    'confidence': r['score'] * 0.5,  # Lower confidence for partial match
                    'x': r['x'], 'y': r['y'],
                    'w': r['w'], 'h': r['h'],
                    'center': (int(r['x'] + r['w']/2), int(r['y'] + r['h']/2)),
                    'is_new': False,
                    'row': 0,
                    'rect': [r['x'], r['y'], r['w'], r['h']]
                })
        
        return paired_cards

    def detect_cards_with_info(self, board_img, game_phase=None, min_group_size=2, context="board", save_debug_image=True):
        """
        Main entry point for finding cards in an ROI using Symbol-Based Template Mapping.
        """
        if board_img.size == 0:
            return {"cards": [], "is_reliable": False, "metrics": {}}

        gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)
        
        # Use targeted scales per context to optimize speed
        if context == "board":
            rank_scales = [1.0, 1.1] # Board cards are large (full size)
            suit_tmpls = self.suit_templates_board
            suit_scales = [1.0, 1.1]
            suit_threshold = 0.9
        else:
            # River/Action column showdown cards are smaller
            rank_scales = [0.5, 0.6] 
            suit_tmpls = self.suit_templates_small if self.suit_templates_small else self.suit_templates_board
            # If using small-sized suit templates, search near original size (1.0)
            # If fallback to board templates, must scale down (0.5-0.6)
            suit_scales = [1.0] if self.suit_templates_small else [0.5, 0.6]
            suit_threshold = 0.75

        ranks = self._detect_symbols(gray, self.rank_templates, threshold=0.7, binarize=True, scales=rank_scales)
        suits = self._detect_symbols(gray, suit_tmpls, threshold=suit_threshold, scales=suit_scales)
        
        logger.debug(f"[CardDetector] {context}: {len(ranks)} rank hits, {len(suits)} suit hits")
        for r in ranks:
            logger.debug(f"  rank: {r['label']} score={r['score']:.2f} at ({r['x']},{r['y']})")
        for s in suits:
            logger.debug(f"  suit: {s['label']} score={s['score']:.2f} at ({s['x']},{s['y']})")
        
        if save_debug_image and (len(ranks) > 0 or len(suits) > 0):
            debug_img = board_img.copy()
            for s in ranks:
                cv2.rectangle(debug_img, (s['x'], s['y']), (s['x']+s['w'], s['y']+s['h']), (0, 255, 0), 1)
                cv2.putText(debug_img, f"{s['label']} {s['score']:.2f}", (s['x'], s['y']-2), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
            for s in suits:
                cv2.rectangle(debug_img, (s['x'], s['y']), (s['x']+s['w'], s['y']+s['h']), (255, 0, 0), 1)
                cv2.putText(debug_img, f"{s['label']} {s['score']:.2f}", (s['x'], s['y']-2), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)
            self._save_debug(debug_img, f"symbols_matched_{context}")

        # Grouping Logic
        paired_cards = self._group_symbols(ranks, suits)
        
        # Sorting Logic
        if context == "board":
            paired_cards.sort(key=lambda c: c['x']) # Left to right
        else:
            paired_cards.sort(key=lambda c: c['y']) # Top to bottom
            
        names = [c['name'] for c in paired_cards]
        is_duplicate = len(names) != len(set(names))
        is_reliable = (3 <= len(paired_cards) <= 5) and not is_duplicate if context == "board" else ((len(paired_cards) > 0) and not is_duplicate)

        # Trigger Failed Case Logging
        self._handle_failed_case(board_img, paired_cards, ranks, suits, context, is_reliable)

        return {
            "cards": paired_cards,
            "is_reliable": is_reliable,
            "metrics": {
                "card_count": len(paired_cards),
                "has_unknown": False,
                "avg_confidence": sum(c['confidence'] for c in paired_cards) / max(1, len(paired_cards)),
                "is_duplicate": is_duplicate,
                "rows_found": 1,
                "ranks_found": len(ranks),
                "suits_found": len(suits)
            }
        }

