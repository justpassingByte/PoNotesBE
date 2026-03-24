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
    """Normalize OCR text to standard poker card rank."""
    n = name.strip()
    lower = n.lower()
    if lower in RANK_MAP:
        return RANK_MAP[lower]
    if lower in VALID_RANKS:
        return n.upper() if len(n) == 1 else n
    if len(n) >= 2:
        if n[0] == '0' or n[0].lower() == 'o':
            rest = n[1:].lower()
            if rest in VALID_RANKS:
                return rest.upper() if len(rest) == 1 else rest
            if rest in RANK_MAP:
                return RANK_MAP[rest]
        first = n[0].lower()
        if first in VALID_RANKS:
            return first.upper()
        if first in RANK_MAP:
            return RANK_MAP[first]
    return n


def is_valid_card_rank(name):
    """Check if text looks like a valid poker card rank."""
    lower = name.strip().lower()
    return lower in VALID_RANKS or lower in RANK_MAP


def get_suit_from_color(roi):
    """Detect card suit from its color: red=hearts, blue=diamonds, green=clubs, default=spades."""
    if roi is None or roi.size == 0:
        return 's'
    
    # Focus on top 60% of card where rank+suit symbol are (avoid bottom noise)
    h, w = roi.shape[:2]
    top_region = roi[:int(h * 0.6), :]
    
    hsv = cv2.cvtColor(top_region, cv2.COLOR_BGR2HSV)
    total_pixels = top_region.shape[0] * top_region.shape[1]
    
    # Color ranges in HSV
    lower_red1, upper_red1 = np.array([0, 40, 30]),   np.array([10, 255, 255])
    lower_red2, upper_red2 = np.array([170, 40, 30]), np.array([180, 255, 255])
    lower_blue, upper_blue  = np.array([100, 40, 30]), np.array([130, 255, 255])
    lower_green, upper_green = np.array([40, 40, 30]),  np.array([90, 255, 255])
    
    mask_red   = cv2.inRange(hsv, lower_red1, upper_red1) | cv2.inRange(hsv, lower_red2, upper_red2)
    mask_blue  = cv2.inRange(hsv, lower_blue, upper_blue)
    mask_green = cv2.inRange(hsv, lower_green, upper_green)
    
    counts = {'h': cv2.countNonZero(mask_red), 'd': cv2.countNonZero(mask_blue), 'c': cv2.countNonZero(mask_green)}
    best_suit = max(counts, key=lambda k: counts[k])
    best_count = counts[best_suit]
    
    # Need at least 20 colored pixels AND >1% of total area to be confident
    # Otherwise default to spades (black/dark suit)
    min_pixels = max(20, int(total_pixels * 0.01))
    
    logger.debug(f"[SuitColor] h={counts['h']} d={counts['d']} c={counts['c']} total={total_pixels} min={min_pixels} -> {'s' if best_count < min_pixels else best_suit}")
    return best_suit if best_count >= min_pixels else 's'

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
        Score = anchor_match (60%) + ocr_keyword (40%) + aspect_ratio bonus.
        Returns (layout_dict, score) for best match above threshold.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        h, w = image.shape[:2]
        aspect_ratio = w / float(h)

        # Call OCR once and share result across layouts
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

            # Signal 1: Anchor template matching (weight 60%)
            anchor_file = layout.get('anchor_file')
            if anchor_file:
                template_path = os.path.join(self.templates_dir, anchor_file)
                if os.path.exists(template_path):
                    template = cv2.imread(template_path, 0)
                    if template is not None:
                        res = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
                        _, cur_max_val, _, _ = cv2.minMaxLoc(res)
                        score += cur_max_val * 0.6
                        logger.debug(f"[LayoutEngine] {layout['name']} anchor score: {cur_max_val:.3f}")

            # Signal 2: OCR keyword match (weight 40%)
            keyword = layout.get('anchor_text', '').lower()
            if keyword and ocr_results:
                for line in ocr_results:
                    if keyword in line[1][0].lower():
                        score += line[1][1] * 0.4
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
    # Expected card aspect ratio (width/height ≈ 0.7)
    CARD_ASPECT_MIN = 0.5
    CARD_ASPECT_MAX = 0.95
    TARGET_CARD_SIZE = (60, 90)  # (w, h) for normalization

    def __init__(self, templates_dir="templates/cards", enable_learning=True):
        self.templates_dir = templates_dir
        self.enable_learning = enable_learning
        self.card_templates: dict = {}  # filename -> img
        self.template_meta: dict = {}   # filename -> {usage_count, success_rate}
        self._load_templates()

    def _load_templates(self):
        if not os.path.exists(self.templates_dir):
            os.makedirs(self.templates_dir, exist_ok=True)
        for f in os.listdir(self.templates_dir):
            if f.endswith(".png"):
                img = cv2.imread(os.path.join(self.templates_dir, f))
                if img is not None:
                    self.card_templates[f] = img
                    self.template_meta.setdefault(
                        f,
                        {"usage_count": 0, "success_rate": 1.0, "last_used": time.time()}
                    )



    # ── Contour detection with merged split & gap guard ──
    def _detect_card_rects(self, board_img, min_group_size=2):
        """
        Detect card bounding boxes via thresholding + contours.
        Handles merged cards by splitting wide contours.
        Returns actual bounding boxes sorted from left to right.
        """
        bh, bw = board_img.shape[:2]

        # Adaptive upscale: only for truly tiny images
        if bh < 80:
            scale = 5.0
        else:
            scale = 1.5
        upscaled = cv2.resize(board_img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)

        thresh = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 15, -5
        )



        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        logger.info(f"[CardDetector] Found {len(contours)} raw contours in {bw}x{bh} image (scale={scale})")

        rects = []
        img_h_scaled = int(board_img.shape[0] * scale)
        # Cap min_h: 10% of scaled height works for dedicated board crops,
        # but for tall crops (action log ≥200px) it becomes too large.
        # Hard cap at 40px scaled to allow small embedded card thumbnails.
        min_h = max(10, min(int(img_h_scaled * 0.10), 40))
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            area = w * h
            
            # Filter tiny noise (require meaningful size)
            if h < min_h or area < 300:
                continue
            
            # 12%-of-height guard: only enforce on short dedicated crops (≤200px)
            # For tall crops (action-log river column) this filter is too aggressive.
            if bh <= 200 and h < img_h_scaled * 0.12:
                continue

            aspect = w / float(h)

            # Split vertical if contour is too wide (merged cards).
            if aspect > 1.05 and h >= 40:
                expected_splits = max(2, int(round(aspect / 0.72)))
                card_w = w // expected_splits
                for i in range(expected_splits):
                    cx = x + i * card_w
                    cw = card_w if (i < expected_splits - 1) else (w - i * card_w)
                    if cw > 5:
                        rects.append((cx, y, cw, h))
                continue

            # Filter rectangle by aspect ratio (cards are taller than wide)
            # Permissive here — action_parser adds stricter river-specific filters
            if 0.4 <= aspect <= 1.0:
                rects.append((x, y, w, h))

        # Sort left -> right by center_x instead of raw x to handle slight overlaps safely
        rects = sorted(rects, key=lambda r: r[0] + r[2] / 2.0)

        # Merge fragment rects that are parts of the same card (e.g. Q split by threshold)
        # Two rects merge if they overlap horizontally AND are close vertically
        merged = True
        while merged:
            merged = False
            new_rects = []
            used = set()
            for i in range(len(rects)):
                if i in used:
                    continue
                x1, y1, w1, h1 = rects[i]
                for j in range(i + 1, len(rects)):
                    if j in used:
                        continue
                    x2, y2, w2, h2 = rects[j]
                    # Check horizontal overlap
                    overlap_x = min(x1 + w1, x2 + w2) - max(x1, x2)
                    # Check vertical proximity (gap < 15px scaled)
                    gap_y = max(0, max(y1, y2) - min(y1 + h1, y2 + h2))
                    if overlap_x > min(w1, w2) * 0.5 and gap_y < 15:
                        # Merge into bounding rect
                        mx = min(x1, x2)
                        my = min(y1, y2)
                        mx2 = max(x1 + w1, x2 + w2)
                        my2 = max(y1 + h1, y2 + h2)
                        rects[i] = (mx, my, mx2 - mx, my2 - my)
                        x1, y1, w1, h1 = rects[i]
                        used.add(j)
                        merged = True
                if i not in used:
                    new_rects.append(rects[i])
            rects = new_rects

        # Scale back down to original coordinates
        final_rects = []
        for rx, ry, rw, rh in rects:
            final_rects.append((
                int(rx / scale),
                int(ry / scale),
                int(rw / scale),
                int(rh / scale)
            ))

        #  Brain Phase: Grouping & Clustering (Phase 3.4)
        if not final_rects:
             return []

        # 1. Cluster by Y-center
        groups: list[list[tuple[int, int, int, int]]] = []
        final_rects.sort(key=lambda r: r[1]) # Sort by Y top
        
        for rect in final_rects:
            ry_center = rect[1] + rect[3] / 2
            
            found_group = False
            for group in groups:
                # Calculate average Y-center of group
                g_avg_y = sum(r[1] + r[3] / 2 for r in group) / len(group)
                if abs(ry_center - g_avg_y) < 50: # Variance threshold 50px
                    group.append(rect)
                    found_group = True
                    break
            
            if not found_group:
                groups.append([rect])

        # 2. Filter groups by size and geometry
        img_h = board_img.shape[0]
        valid_groups = []
        logger.debug(f"[Brain] Found {len(groups)} raw Y-groups.")
        
        for i, g in enumerate(groups):
            if not g: continue
            
            # Sub-filter: Filter items in group that are too different from median height
            heights = sorted([r[3] for r in g])
            median_h = heights[len(heights)//2]
            
            # Clean group: keep only those near median height (35% tolerance)
            clean_g = [r for r in g if abs(r[3] - median_h) < (median_h * 0.35)]
            
            # Also filter by median width — cards should be similarly sized
            if clean_g:
                widths = sorted([r[2] for r in clean_g])
                median_w = widths[len(widths)//2]
                clean_g = [r for r in clean_g if abs(r[2] - median_w) < (median_w * 0.4)]
            
            # Sort clean_g horizontally
            clean_g.sort(key=lambda r: r[0])
            
            logger.debug(f"[Brain] Group {i}: raw={len(g)}, clean={len(clean_g)}, median_h={median_h:.1f}")
            
            if min_group_size <= len(clean_g) <= 6:
                # Spacing regularity check: gaps between cards should be roughly uniform
                if len(clean_g) >= 3:
                    gaps = []
                    for j in range(1, len(clean_g)):
                        gap = clean_g[j][0] - (clean_g[j-1][0] + clean_g[j-1][2])
                        gaps.append(gap)
                    avg_gap = sum(gaps) / len(gaps) if gaps else 0
                    # Filter if any gap is more than 3x average (non-uniform = noise)
                    if avg_gap > 0 and any(g > avg_gap * 3 for g in gaps):
                        logger.debug(f"[Brain] Group {i} filtered: irregular spacing (gaps={gaps})")
                        continue
                valid_groups.append(clean_g)
            else:
                logger.debug(f"[Brain] Group {i} filtered: clean size {len(clean_g)} not in [2..6]")

        if not valid_groups:
             logger.warning(f"[CardDetector] Brain filtered all {len(groups)} groups. No valid rows found.")
             return []

        # Brain Phase: Return ALL valid rows in Y-order (top to bottom)
        valid_groups.sort(key=lambda g: sum(r[1] for r in g)/len(g))
        
        logger.info(f"[CardDetector] Brain found {len(valid_groups)} card rows out of {len(final_rects)} raw rects.")
        return valid_groups

    def _center_crop(self, board_img, rect):
        """
        Crop a card exactly from the bounding box with 3px safe padding to avoid cutting borders,
        and normalize to TARGET_CARD_SIZE.
        """
        x, y, w, h = rect
        bh, bw = board_img.shape[:2]

        pad = 3
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(bw, x + w + pad)
        y2 = min(bh, y + h + pad)

        crop = board_img[y1:y2, x1:x2]
        if crop.size == 0:
            return np.zeros((self.TARGET_CARD_SIZE[1], self.TARGET_CARD_SIZE[0], 3), dtype=np.uint8)

        # Normalize card size
        normalized = cv2.resize(crop, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
        return normalized

    def _check_duplicates(self, card_names):
        """
        Returns True if there are duplicate card names in the result.
        """
        valid_names = [n for n in card_names if n and n != '??']
        return len(valid_names) != len(set(valid_names))

    def _get_ocr_passes(self, card_crop):
        """
        Generate multiple preprocessed versions of a card crop for OCR.
        Returns list of (pass_name, image) tuples.
        """
        passes = [("original", card_crop)]
        
        try:
            h, w = card_crop.shape[:2]
            
            # Pass 2: Always upscale (even 60x90 is too small for PaddleOCR)
            scale = max(2.0, 160 / max(h, 1))
            upscaled = cv2.resize(card_crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            passes.append(("upscaled", upscaled))
            
            # Pass 3: CLAHE contrast enhancement on upscaled
            gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
            enhanced = clahe.apply(gray)
            enhanced_bgr = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
            passes.append(("clahe", enhanced_bgr))
            
            # Pass 4: Inverted (for dark background cards like river column)
            inverted = cv2.bitwise_not(upscaled)
            passes.append(("inverted", inverted))
        except Exception as e:
            logger.warning(f"[CardDetector] OCR pass generation error: {e}")
        
        return passes

    # ── Main detection entry point ──
    def detect_cards_with_info(self, board_img, ocr_engine=None, game_phase=None, min_group_size=2):
        results = []
        all_groups = self._detect_card_rects(board_img, min_group_size=min_group_size)

        if not all_groups:
            logger.warning("[CardDetector] No card groups found by Brain.")
            return {
                "cards": [],
                "is_reliable": False,
                "metrics": {"card_count": 0, "has_unknown": False, "avg_confidence": 0.0}
            }

        # Process each group (row)
        for g_idx, group_rects in enumerate(all_groups):
            for idx, rect in enumerate(group_rects):
                card_crop = self._center_crop(board_img, rect)
                
                # Also keep ORIGINAL (non-normalized) crop for OCR — avoids blur from upscaling small cards to 60x90
                x, y, w, h = rect
                bh, bw = board_img.shape[:2]
                pad = 3
                x1, y1 = max(0, x - pad), max(0, y - pad)
                x2, y2 = min(bw, x + w + pad), min(bh, y + h + pad)
                raw_crop = board_img[y1:y2, x1:x2]
                
                # Recognition: Template first, OCR fallback
                name, conf, matched_file = self._match_template(card_crop)
                if name:
                    # Trust template fully — rank + suit both come from the learned template
                    logger.info(f"[CardDetector] Row {g_idx} Slot {idx}: matched '{name}' (conf={conf:.2f})")
                    results.append({
                        'name': name, 
                        'confidence': conf, 
                        'image': card_crop, 
                        'is_new': False,
                        'matched_filename': matched_file,
                        'row': g_idx,
                        'center': (int(rect[0] + rect[2]/2), int(rect[1] + rect[3]/2)),
                        'rect': list(rect)
                    })
                    
                    # Fix Bug 5: Consistently initialize / update meta with full schema
                    meta_key = matched_file if matched_file else name
                    if meta_key not in self.template_meta:
                        self.template_meta[meta_key] = {"usage_count": 0, "success_rate": 1.0, "last_used": time.time()}
                    
                    meta: dict = self.template_meta[meta_key]  # type: ignore[assignment]
                    meta['usage_count'] = meta.get('usage_count', 0) + 1
                    meta['last_used'] = time.time()
                elif ocr_engine is not None:
                    try:
                        # Multi-pass OCR — use RAW crop (not normalized) to preserve sharpness
                        best_txt = '??'
                        best_conf = 0.0
                        
                        for pass_name, pass_img in self._get_ocr_passes(raw_crop):
                            padded = cv2.copyMakeBorder(pass_img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
                            res = ocr_engine.ocr(padded, cls=False)  # type: ignore[union-attr]
                            if res and res[0]:
                                for line in res[0]:
                                    raw_txt = line[1][0].strip().replace(' ', '')
                                    conf = line[1][1]
                                    normalized = normalize_card_rank(raw_txt)
                                    if is_valid_card_rank(normalized) and conf > best_conf:
                                        best_txt = normalized.upper() if len(normalized) <= 2 else normalized
                                        best_conf = conf
                        
                        if best_txt != '??':
                            # Add suit detection (unreliable — color-based)
                            suit = get_suit_from_color(card_crop)
                            name_with_suit = f"{best_txt}{suit}"
                            # Cap confidence to ALWAYS trigger interactive correction
                            # OCR rank + color-based suit is unreliable, let user verify
                            capped_conf = min(best_conf, 0.50)
                            logger.info(f"[CardDetector] Row {g_idx} Slot {idx} OCR: '{name_with_suit}' (raw_conf={best_conf:.2f}, capped={capped_conf:.2f})")
                            results.append({
                                'name': name_with_suit,
                                'confidence': capped_conf,
                                'image': card_crop,
                                'is_new': True,
                                'row': g_idx,
                                'center': (int(rect[0] + rect[2]/2), int(rect[1] + rect[3]/2)),
                                'rect': list(rect)
                            })
                        else:
                            results.append({
                                'name': '??',
                                'confidence': 0.0,
                                'image': card_crop,
                                'is_new': False,
                                'row': g_idx,
                                'center': (int(rect[0] + rect[2]/2), int(rect[1] + rect[3]/2)),
                                'rect': list(rect)
                            })
                    except Exception as e:
                        logger.error(f"[CardDetector] OCR Error at Row {g_idx} Slot {idx}: {e}")
                        results.append({
                            'name': '??',
                            'confidence': 0.0,
                            'image': card_crop,
                            'is_new': False,
                            'row': g_idx,
                            'center': (int(rect[0] + rect[2]/2), int(rect[1] + rect[3]/2)),
                            'rect': list(rect)
                        })
                else:
                    results.append({
                        'name': '??',
                        'confidence': 0.0,
                        'image': card_crop,
                        'is_new': False,
                        'row': g_idx,
                        'center': (int(rect[0] + rect[2]/2), int(rect[1] + rect[3]/2)),
                        'rect': list(rect)
                    })

        # Phase 4: Identify Roles for each Group (Board, Hero, Villain)
        img_h, img_w = board_img.shape[:2]
        regions = None # Placeholder for region mapping logic
        
        # Determine center Y for known regions (in pixels)
        # Assuming layout is accessible? Better: Let caller specify which region board_img came from.
        # But if we want to guess from full image:
        
        final_cards = []
        for r in results:
            row_idx = r['row']
            # Find all cards in this row to calculate row average position
            row_cards = [c for c in results if c['row'] == row_idx]
            avg_y = sum((c['image'].shape[0]/2) for c in row_cards) / len(row_cards) # This is relative to board_img!
            
            # Simple heuristic for now: Board is usually top/middle, Hero is bottom
            # Better: Label them in test_full/tasks based on which region they were cropped from.
            final_cards.append(r)

        # Let's add a 'role' key if possible
        # Determine reliability
        names = [r['name'] for r in results]
        valid_confs = [r['confidence'] for r in results if r['name'] != '??']
        
        avg_conf = sum(valid_confs) / len(valid_confs) if valid_confs else 0.0
        has_unknown = '??' in names
        is_dup = self._check_duplicates(names)
        
        # Determine reliability
        is_reliable = (3 <= len(results) <= 5) and (not has_unknown) and (not is_dup) and (avg_conf > 0.8)

        return {
            "cards": results,
            "is_reliable": is_reliable,
            "metrics": {
                "card_count": len(results),
                "has_unknown": has_unknown,
                "avg_confidence": avg_conf,
                "is_duplicate": is_dup,
                "rows_found": len(all_groups)
            }
        }

    def _match_template(self, slot_img):
        """
        Template matching with multi-template voting and decay-weighted priority ranking.
        """
        HALF_LIFE_SECONDS = 30 * 24 * 3600  # 30 days
        now = time.time()

        try:
            normalized_slot = cv2.resize(slot_img, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
        except Exception:
            normalized_slot = slot_img

        matches = []
        for name, tmpl in self.card_templates.items():
            try:
                tmpl_resized = cv2.resize(tmpl, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
                res = cv2.matchTemplate(normalized_slot, tmpl_resized, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(res)
                match_score = float(max_val)
                
                # Apply ranking boost/decay per user request
                meta = self.template_meta.get(name, {})
                sr = meta.get("success_rate", 1.0)
                
                # Rule: Reject bad templates (Phase 3)
                if sr < 0.4:
                    continue

                last_used = meta.get("last_used", now)
                age_secs = max(0.0, now - last_used)
                decay = math.exp(-math.log(2) * age_secs / HALF_LIFE_SECONDS)
                
                final_score = match_score * sr * decay
                matches.append({'label': name, 'score': final_score, 'raw': match_score})
            except Exception as e:
                logger.error(f"Error matching {name}: {e}")

        if not matches:
            return None, 0.0, None

        matches.sort(key=lambda x: x['score'], reverse=True)
        top_matches = matches[:3]

        if top_matches and top_matches[0]['score'] >= 0.92:
            votes = {}
            for m in top_matches:
                if m['score'] >= 0.85:
                    # e.g., Ah_auto -> Ah
                    base_label = m['label'].split('_')[0]
                    votes[base_label] = votes.get(base_label, 0) + m['score']
            
            if votes:
                best_label = sorted(votes.items(), key=lambda x: x[1], reverse=True)[0][0]
                best_score = max([m['score'] for m in top_matches if m['label'].startswith(best_label)])
                
                logger.info(f"[MATCH] top1={top_matches[0]['label']} score={top_matches[0]['score']:.2f}")
                if len(top_matches) > 1:
                    logger.info(f"[MATCH] top2={top_matches[1]['label']} score={top_matches[1]['score']:.2f}")
                logger.info(f"[MATCH] final={best_label} score={best_score:.2f}")
                
                # Return best_label, best_score, and the actual filename of the top match for error reporting
                return best_label, best_score, top_matches[0]['label']
        
        # Debug: log why template matching failed
        if top_matches:
            logger.warning(f"[MATCH FAIL] Best: {top_matches[0]['label']} raw={top_matches[0].get('raw',0):.3f} final={top_matches[0]['score']:.3f} (threshold=0.92)")

        return None, 0.0, None

    def report_error(self, filename):
        """
        Record a failure for a specific template. 
        Lowers success_rate. If below threshold, will be ignored in future matches.
        """
        if not filename:
             return
             
        if filename in self.template_meta:
            meta = self.template_meta[filename]
            old_sr = meta.get("success_rate", 1.0)
            # Fast decay on error: sr = sr * 0.7
            new_sr = max(0.0, old_sr * 0.7)
            meta["success_rate"] = new_sr
            logger.warning(f"[CardDetector] Penalty for '{filename}': success_rate={old_sr:.2f} -> {new_sr:.2f}")
            if new_sr < 0.4:
                logger.error(f"[CardDetector] Template '{filename}' DISABLED due to low accuracy.")
        else:
             logger.warning(f"[CardDetector] Cannot report error: filename '{filename}' not in meta.")

    def learn_card(self, card_img, card_name, verification_source='auto', failed_cases_dir="failed_cases", layout_name=None):
        """
        Safe self-learning with:
        - Card name validation (must be valid rank+suit)
        - Verification source check (high_confidence | user_confirmed | user_corrected)
        - Tight contour crop before saving
        - Failed case logging for rejected/unverified data
        - last_used timestamp stored for decay ranking
        """
        if not self.enable_learning:
            return
        
        # Validate card name — must be a real poker card (e.g. Ah, Ks, Td, 10c)
        import re
        if not re.match(r'^(?:10|[2-9TJQKA])[hdcs]$', card_name, re.IGNORECASE):
            logger.warning(f"[CardDetector] Rejected learn for '{card_name}' — invalid card name (must be rank+suit, e.g. Ah, Ks, Td).")
            return
            
        suffix = "_auto" if verification_source == 'high_confidence' else "_user"
        if layout_name:
            suffix = f"_{layout_name}{suffix}"
            
        filename = f"{card_name}{suffix}.png"
        
        if filename in self.card_templates and verification_source == 'auto':
            return  # Already known; only overwrite if user-grounded

        allowed_sources = {'high_confidence', 'user_confirmed', 'user_corrected'}
        if verification_source not in allowed_sources:
            os.makedirs(failed_cases_dir, exist_ok=True)
            fail_path = os.path.join(failed_cases_dir, f"{card_name}_rejected.png")
            cv2.imwrite(fail_path, card_img)
            logger.warning(f"[CardDetector] Rejected learn for '{card_name}' (source={verification_source}). Saved to {fail_path}.")
            return

        # Normalize before save - DO NOT do a tight contour crop, because matchTemplate needs the same aspect ratio as the source slot
        cropped_norm = cv2.resize(card_img, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)

        os.makedirs(self.templates_dir, exist_ok=True)
        path = os.path.join(self.templates_dir, filename)
        cv2.imwrite(path, cropped_norm)
        
        self.card_templates[filename] = cropped_norm
        
        # Record metadata with current timestamp for decay ranking
        existing = self.template_meta.get(filename, {"usage_count": 0, "success_rate": 1.0})
        new_usage = existing.get("usage_count", 0) + 1
            
        self.template_meta[filename] = {
            "usage_count":  new_usage,
            "success_rate": 1.0,  # freshly learned = max success rate
            "last_used":    time.time(),
        }
        
        # [LEARN] Logging
        template_count = sum(1 for k in self.card_templates.keys() if k.startswith(card_name))
        logger.info(f"[LEARN] label={card_name} template_count={template_count} usage={new_usage} (source={verification_source})")
