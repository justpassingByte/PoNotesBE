import re
import os
import json
import logging
import time

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Card Recognition Utilities
# ─────────────────────────────────────────────

VALID_RANKS = frozenset({'a', 'k', 'q', 'j', 't', '10', '9', '8', '7', '6', '5', '4', '3', '2'})

RANK_MAP = {
    '10': '10', '1o': '10', 'io': '10', 'l0': '10',
    '1': 'A',
    '09': '9', '06': '6', '08': '8', '07': '7',
    '05': '5', '04': '4', '03': '3', '02': '2',
    'o9': '9', 'o6': '6', 'o8': '8', 'o4': '4',
    'ok': 'K', 'oq': 'Q', 'oj': 'J',
}

# Pre-compiled regex patterns (avoid re-compiling per call)
_RE_RANK_SUIT = re.compile(r'^((?:10|[2-9TJQKA]))([HDCS])$', re.IGNORECASE)
_RE_RANK_SUIT_VALID = re.compile(r'^(?:10|[2-9TJQKA])[HDCS]$', re.IGNORECASE)


def normalize_card_rank(name):
    """Normalize OCR text to standard poker card rank. Returns (rank, suit_hint)."""
    n = name.strip()

    # Check for rank+suit pattern (e.g. '8d', 'Ah', '10s')
    m = _RE_RANK_SUIT.match(n)
    if m:
        return m.group(1).upper(), m.group(2).lower()

    # Existing logic for rank-only or partials
    lower = n.lower()
    if lower in RANK_MAP:
        return RANK_MAP[lower], None
    if lower in VALID_RANKS:
        return (n.upper() if len(n) == 1 else n), None

    if len(n) >= 2:
        first_lower = n[0].lower()
        # Check for '08' -> '8', 'o8' -> '8' etc
        if n[0] == '0' or first_lower == 'o':
            rest = n[1:].lower()
            if rest in VALID_RANKS:
                return (rest.upper() if len(rest) == 1 else rest), None
            if rest in RANK_MAP:
                return RANK_MAP[rest], None
        # Handle cases where suit might be there but not matched by regex
        if first_lower in VALID_RANKS:
            return first_lower.upper(), None
        if first_lower in RANK_MAP:
            return RANK_MAP[first_lower], None

    return n, None


def is_valid_card_rank(name):
    """Check if text looks like a valid poker card rank."""
    lower = name.strip().lower()
    if _RE_RANK_SUIT_VALID.match(lower):
        return True
    return lower in VALID_RANKS or lower in RANK_MAP


# ─────────────────────────────────────────────
# LayoutEngine
# ─────────────────────────────────────────────
class LayoutEngine:
    def __init__(self, config_path="layout_config.json"):
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                self.config = json.load(f)
        else:
            self.config = {"layouts": []}
        self.templates_dir = "templates/anchors"
        self._x_scale = 1.0

        # Cache anchor templates at init — avoid cv2.imread per frame
        self._anchor_cache = {}
        for layout in self.config.get('layouts', []):
            anchor_file = layout.get('anchor_file')
            if anchor_file:
                template_path = os.path.join(self.templates_dir, anchor_file)
                if os.path.exists(template_path):
                    img = cv2.imread(template_path, 0)
                    if img is not None:
                        self._anchor_cache[anchor_file] = img

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
        anchor_weight = 0.6 if ocr_results else 0.7

        for layout in self.config.get('layouts', []):
            score = 0.0

            # Signal 1: Anchor template matching (from cache)
            anchor_file = layout.get('anchor_file')
            if anchor_file:
                template = self._anchor_cache.get(anchor_file)
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
                score += 0.1
            else:
                score -= min(ratio_diff * 0.3, 0.2)

            threshold = layout.get('threshold', 0.5)
            if score > threshold and score > max_score:
                max_score = score
                best_match = (layout, score)

        # Calculate sidebar scale factor for the matched layout
        if best_match:
            matched_layout = best_match[0]
            target_ratio = matched_layout.get('aspect_ratio', aspect_ratio)
            sidebar_region = matched_layout.get('regions', {}).get('sidebar')

            if sidebar_region and aspect_ratio < target_ratio * 0.85:
                self._x_scale = sidebar_region.get('x1', 0.8)
                logger.info(f"[LayoutEngine] Sidebar crop detected: x_scale={self._x_scale:.2f}")
            else:
                self._x_scale = 1.0

        return best_match

    def crop_region(self, image, region_coords):
        """Crop region with automatic sidebar compensation."""
        h, w = image.shape[:2]
        x_scale = self._x_scale

        # Scale x-coordinates if sidebar was cropped
        if x_scale < 1.0:
            rx1 = region_coords['x1'] / x_scale
            rx2 = region_coords['x2'] / x_scale
        else:
            rx1 = region_coords['x1']
            rx2 = region_coords['x2']

        # Clamp to [0, 1]
        rx1 = max(0.0, min(1.0, rx1))
        rx2 = max(0.0, min(1.0, rx2))

        x1 = int(rx1 * w)
        y1 = int(region_coords['y1'] * h)
        x2 = int(rx2 * w)
        y2 = int(region_coords['y2'] * h)

        return image[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]


# ─────────────────────────────────────────────
# CardDetector
# ─────────────────────────────────────────────

# Labels that easily raise false positives due to thin/generic shapes
_PENALIZED_LABELS = frozenset({'J', 'Q', '7', '1', 'I'})

# Context-specific configuration
_CONTEXT_CONFIG = {
    "board": {
        "rank_scales": [1.0],
        "suit_scales": [1.0],
        "suit_threshold": 0.80,
        "rank_threshold": 0.75,
        "max_dx": 80,
        "max_dy": 120,
    },
    "_default": {
        "rank_scales": [0.5, 0.6],
        "suit_scales_small": [0.9, 1.0, 1.1],
        "suit_scales_board_fallback": [0.5, 0.6],
        "suit_threshold": 0.70,
        "rank_threshold": 0.70,
        "max_dx": 40,
        "max_dy": 70,
        "fallback_scales": [0.4, 0.5, 0.6, 0.7],
    },
}

# Collect every unique scale used across all contexts — pre-compute these at load time
_ALL_SCALES = set()
for _cfg in _CONTEXT_CONFIG.values():
    for _key, _val in _cfg.items():
        if isinstance(_val, list) and _key.endswith('scales') or _key.endswith('_scales') or 'scale' in _key:
            _ALL_SCALES.update(_val)
_ALL_SCALES = sorted(_ALL_SCALES)


def _prescale_template(img, scales=_ALL_SCALES):
    """Pre-compute all scaled variants of a template image. Returns {scale: img}."""
    scaled = {}
    for s in scales:
        if s == 1.0:
            scaled[s] = img
        else:
            interp = cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR
            resized = cv2.resize(img, None, fx=s, fy=s, interpolation=interp)
            # Skip degenerate sizes
            if resized.shape[0] >= 5 and resized.shape[1] >= 5:
                scaled[s] = resized
    return scaled


class CardDetector:
    def __init__(self, templates_dir="templates"):
        self.templates_dir = templates_dir
        self.ranks_dir = os.path.join(templates_dir, "ranks")
        self.suits_dir = os.path.join(templates_dir, "suits")

        self.rank_templates = {}
        self.suit_templates_board = {}   # *_board.png — large, for board cards
        self.suit_templates_small = {}   # *_small.png — small, for river/showdown
        self._load_templates()
        self._templates_mtime = self._snapshot_mtime()

        self._debug_dir = os.path.join(os.path.dirname(templates_dir), "debug_crops")
        self._failed_dir = os.path.join(os.path.dirname(templates_dir), "templates_failed", "raw")
        self._debug_dir_created = False
        self._failed_dir_created = False

    def _snapshot_mtime(self):
        """Collect {filename: mtime} for all .png files in ranks/ and suits/ dirs."""
        snapshot = {}
        for directory in (self.ranks_dir, self.suits_dir):
            if not os.path.isdir(directory):
                continue
            for f in os.listdir(directory):
                if f.endswith('.png'):
                    path = os.path.join(directory, f)
                    try:
                        snapshot[path] = os.path.getmtime(path)
                    except OSError:
                        pass
        return snapshot

    def reload_if_changed(self):
        """Reload templates only when files on disk have actually changed."""
        current = self._snapshot_mtime()
        if current != self._templates_mtime:
            logger.info("[CardDetector] Template files changed on disk — reloading.")
            self.rank_templates.clear()
            self.suit_templates_board.clear()
            self.suit_templates_small.clear()
            self._load_templates()
            self._templates_mtime = current

    def _load_templates(self):
        """Load rank and suit template images from disk."""
        self._load_template_dir(
            self.ranks_dir,
            target=self.rank_templates,
        )
        self._load_template_dir(
            self.suits_dir,
            target=None,  # routed by suffix
        )

    def _load_template_dir(self, directory, target=None):
        """Load .png templates from a directory into the appropriate dict."""
        os.makedirs(directory, exist_ok=True)
        for f in os.listdir(directory):
            if not f.endswith('.png'):
                continue
            img = cv2.imread(os.path.join(directory, f), 0)
            if img is None:
                continue

            label = f.split('_')[0].split('.')[0]
            scaled = _prescale_template(img)
            entry = {'label': label, 'img': img, 'scaled': scaled}

            if target is not None:
                # Rank templates
                target[f] = entry
            else:
                # Suit templates — route by filename suffix
                if '_small' in f:
                    self.suit_templates_small[f] = entry
                    # Auto-generate inverted variant (white-on-black) for
                    # loser/showdown cards that render suits as light-on-dark
                    inv_img = cv2.bitwise_not(img)
                    inv_scaled = _prescale_template(inv_img)
                    inv_key = f.replace('_small.png', '_small_inv.png')
                    self.suit_templates_small[inv_key] = {
                        'label': label, 'img': inv_img, 'scaled': inv_scaled,
                    }
                else:
                    # '_board' or default
                    self.suit_templates_board[f] = entry

    def _save_debug(self, img, step_name):
        if not self._debug_dir_created:
            os.makedirs(self._debug_dir, exist_ok=True)
            self._debug_dir_created = True
        ts = int(time.time() * 1000)
        cv2.imwrite(os.path.join(self._debug_dir, f"{ts}_{step_name}.png"), img)

    @staticmethod
    def _bb_iou(boxA, boxB):
        """Compute intersection-over-union for two (x, y, w, h) boxes."""
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
        yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

        inter = max(0, xB - xA) * max(0, yB - yA)
        if inter == 0:
            return 0.0

        union = boxA[2] * boxA[3] + boxB[2] * boxB[3] - inter
        return inter / float(union)

    def _nms(self, detections, iou_threshold=0.15, dist_threshold=15):
        """Non-maximum suppression by score, center distance, and IoU."""
        detections.sort(key=lambda x: x['score'], reverse=True)
        keep = []
        dist_threshold_sq = dist_threshold * dist_threshold

        for det in detections:
            det_cx = det['x'] + det['w'] * 0.5
            det_cy = det['y'] + det['h'] * 0.5
            suppressed = False

            for k in keep:
                k_cx = k['x'] + k['w'] * 0.5
                k_cy = k['y'] + k['h'] * 0.5

                # Suppress if centers are extremely close (same physical symbol)
                # Use squared distance to avoid sqrt overhead
                dx = det_cx - k_cx
                dy = det_cy - k_cy
                if dx * dx + dy * dy < dist_threshold_sq:
                    suppressed = True
                    break

                # Standard IOU suppression
                iou = self._bb_iou(
                    (det['x'], det['y'], det['w'], det['h']),
                    (k['x'], k['y'], k['w'], k['h']),
                )
                if iou > iou_threshold:
                    suppressed = True
                    break

            if not suppressed:
                keep.append(det)

        return keep

    def _build_search_images(self, image_gray, color_image):
        """
        Pre-compute all binarized search images once per frame.
        Returns list of grayscale images to match templates against.
        """
        _, binary = cv2.threshold(image_gray, 180, 255, cv2.THRESH_BINARY)
        binary_inv = cv2.bitwise_not(binary)
        search_images = [binary, binary_inv]

        # Red suits (hearts/diamonds) on dark backgrounds have low grayscale
        # values (~60 for pure red) so they vanish during gray binarization.
        # Binarize the isolated Red channel to catch them.
        if color_image is not None and len(color_image.shape) == 3:
            # Zero-copy numpy slicing instead of cv2.split() which allocates 3 arrays
            r_ch = color_image[:, :, 2]
            b_ch = color_image[:, :, 0]
            _, red_binary = cv2.threshold(r_ch, 120, 255, cv2.THRESH_BINARY)
            # Suppress blue-heavy pixels to avoid false positives from blue UI
            red_binary[b_ch > r_ch] = 0
            search_images.append(red_binary)
            search_images.append(cv2.bitwise_not(red_binary))

        return search_images

    def _detect_symbols(self, image_gray, templates_dict, threshold=0.75,
                        scales=None, search_images=None):
        """Detect symbols via multi-scale template matching."""
        if not templates_dict:
            return []

        # Fallback: if no pre-built search images, use raw grayscale
        if search_images is None:
            search_images = [image_gray]

        if scales is None:
            scales = _ALL_SCALES

        results = []

        for tmpl_data in templates_dict.values():
            label = tmpl_data['label']
            scaled_map = tmpl_data['scaled']
            best_score_for_tmpl = 0.0  # Track best score across scales

            for scale in scales:
                tmpl = scaled_map.get(scale)
                if tmpl is None:
                    continue  # Scale was filtered out (too small) at load time

                th, tw = tmpl.shape[:2]

                for search_img in search_images:
                    sh, sw = search_img.shape[:2]
                    if th > sh or tw > sw:
                        continue

                    res = cv2.matchTemplate(search_img, tmpl, cv2.TM_CCOEFF_NORMED)
                    locs = np.where(res >= threshold)

                    for pt_x, pt_y in zip(locs[1], locs[0]):
                        score = float(res[pt_y, pt_x])

                        # Penalize generic/thin shapes that easily raise false positives
                        if label in _PENALIZED_LABELS:
                            score -= 0.06

                        if score >= threshold:
                            results.append({
                                'label': label, 'score': score,
                                'x': int(pt_x), 'y': int(pt_y),
                                'w': tw, 'h': th,
                            })
                            if score > best_score_for_tmpl:
                                best_score_for_tmpl = score

                    # Skip remaining search images if this scale already matched well
                    if best_score_for_tmpl > 0.88:
                        break

                # Early exit: if this template already matched at very high confidence,
                # skip remaining scales — the match is definitive.
                if best_score_for_tmpl > 0.88:
                    break

        return self._nms(results, iou_threshold=0.2)

    def _disambiguate_red_suits(self, detections, search_images):
        """When heart and diamond detections overlap, keep only the correct one
        based on actual pixel shape in the top half of the bounding box."""
        if not search_images:
            return detections

        # Group by approximate center position
        red_suits = {'heart': [], 'diamond': []}
        others = []
        for d in detections:
            if d['label'] in red_suits:
                red_suits[d['label']].append(d)
            else:
                others.append(d)

        if not red_suits['heart'] or not red_suits['diamond']:
            return detections  # No ambiguity

        # For each heart detection, check if a diamond overlaps at same position
        to_remove = set()
        for h in red_suits['heart']:
            h_cx = h['x'] + h['w'] * 0.5
            h_cy = h['y'] + h['h'] * 0.5
            for d_idx, d in enumerate(red_suits['diamond']):
                d_cx = d['x'] + d['w'] * 0.5
                d_cy = d['y'] + d['h'] * 0.5
                # Check if they overlap (centers within 30px)
                if abs(h_cx - d_cx) < 30 and abs(h_cy - d_cy) < 30:
                    # Use the first (binary) search image for shape analysis
                    img = search_images[0]
                    # Use the larger bounding box for analysis
                    x = min(h['x'], d['x'])
                    y = min(h['y'], d['y'])
                    w = max(h['x'] + h['w'], d['x'] + d['w']) - x
                    hh = max(h['y'] + h['h'], d['y'] + d['h']) - y

                    if y + hh > img.shape[0] or x + w > img.shape[1]:
                        continue

                    roi = img[y:y + hh, x:x + w]
                    if roi.size == 0:
                        continue

                    # Compare pixel density in top-third vs bottom-third
                    third = max(1, hh // 3)
                    top_pixels = np.count_nonzero(roi[:third, :])
                    bot_pixels = np.count_nonzero(roi[-third:, :])

                    # Heart: wider top (more pixels) → top >= bottom
                    # Diamond: narrow top (fewer pixels) → top < bottom
                    # Use strict ratio (0.95) to avoid false heart classification
                    # on small cards where shapes are similar
                    if top_pixels >= bot_pixels:
                        # Shape is heart — suppress the diamond detection
                        to_remove.add(id(d))
                        if h['score'] < d['score']:
                            h['score'] = d['score']  # Keep best score
                        logger.debug(
                            f"  [Disambiguate] heart wins over diamond at ({x},{y}) "
                            f"top_px={top_pixels} bot_px={bot_pixels}"
                        )
                    else:
                        # Shape is likely diamond — suppress the heart
                        to_remove.add(id(h))
                        logger.debug(
                            f"  [Disambiguate] diamond wins over heart at ({x},{y}) "
                            f"top_px={top_pixels} bot_px={bot_pixels}"
                        )

        # Rebuild list without suppressed detections
        result = others[:]
        for d in red_suits['heart'] + red_suits['diamond']:
            if id(d) not in to_remove:
                result.append(d)
        return result

    def _handle_failed_case(self, board_img, paired_cards, ranks, suits, context, is_reliable):
        """Save debug data when detection confidence is low."""
        if is_reliable:
            return
        # Avoid saving completely empty regions unless it's the board
        if not ranks and not suits and context != "board":
            return

        if not self._failed_dir_created:
            os.makedirs(self._failed_dir, exist_ok=True)
            self._failed_dir_created = True

        ts = int(time.time() * 1000)
        prefix = f"{ts}_{context}_failed"

        # Save crop
        img_path = os.path.join(self._failed_dir, f"{prefix}.png")
        cv2.imwrite(img_path, board_img)

        # Save metadata
        meta_path = os.path.join(self._failed_dir, f"{prefix}.json")
        try:
            with open(meta_path, "w") as f:
                json.dump({
                    "timestamp": ts,
                    "context": context,
                    "ranks_found": len(ranks),
                    "suits_found": len(suits),
                    "paired": [c['name'] for c in paired_cards],
                }, f)
        except Exception as e:
            logger.error(f"[FailedCaseManager] Error writing meta: {e}")

        logger.warning(f"[FailedCaseManager] Triggered! Context='{context}'. Saved region to {img_path}")

    def _group_symbols(self, ranks, suits, context="board"):
        """Pair each rank detection with its nearest suit detection below it."""
        paired_cards = []
        used_suits = set()

        cfg = _CONTEXT_CONFIG.get(context, _CONTEXT_CONFIG["_default"])
        max_dx = cfg["max_dx"]
        max_dy = cfg["max_dy"]

        # Sort ranks left-to-right
        ranks.sort(key=lambda x: x['x'])

        for r in ranks:
            r_cx = r['x'] + r['w'] * 0.5
            r_cy = r['y'] + r['h'] * 0.5

            best_suit_idx = None
            best_match_val = -999.0

            for s_idx, s in enumerate(suits):
                if s_idx in used_suits:
                    continue

                s_cx = s['x'] + s['w'] * 0.5
                s_cy = s['y'] + s['h'] * 0.5

                dx = abs(r_cx - s_cx)
                dy = s_cy - r_cy  # Suit should be BELOW rank

                if dx < max_dx and 0 < dy < max_dy:
                    # Score drops by 0.1 for every 10 pixels of horizontal drift
                    penalty = (dx / 10.0) * 0.1
                    match_val = s['score'] - penalty
                    if match_val > best_match_val:
                        best_match_val = match_val
                        best_suit_idx = s_idx

            if best_suit_idx is not None:
                s = suits[best_suit_idx]
                used_suits.add(best_suit_idx)
                logger.debug(
                    f"  Paired rank {r['label']}@({r['x']},{r['y']}) "
                    f"with {s['label']}@({s['x']},{s['y']}) score={s['score']:.2f}"
                )

                min_x = min(r['x'], s['x'])
                min_y = min(r['y'], s['y'])
                max_r = max(r['x'] + r['w'], s['x'] + s['w'])
                max_b = max(r['y'] + r['h'], s['y'] + s['h'])
                cx = int((min_x + max_r) / 2)
                cy = int((min_y + max_b) / 2)

                paired_cards.append({
                    'name': f"{r['label']}{s['label']}",
                    'confidence': (r['score'] + s['score']) * 0.5,
                    'x': min_x, 'y': min_y,
                    'w': max_r - min_x, 'h': max_b - min_y,
                    'center': (cx, cy),
                    'is_new': False,
                    'row': 0,
                    'rect': [min_x, min_y, max_r - min_x, max_b - min_y],
                })
            else:
                # No suit found — emit rank with unknown suit
                logger.debug(f"  Unpaired rank {r['label']}@({r['x']},{r['y']}) — no suit nearby")
                paired_cards.append({
                    'name': f"{r['label']}?",
                    'confidence': r['score'] * 0.5,
                    'x': r['x'], 'y': r['y'],
                    'w': r['w'], 'h': r['h'],
                    'center': (int(r['x'] + r['w'] * 0.5), int(r['y'] + r['h'] * 0.5)),
                    'is_new': False,
                    'row': 0,
                    'rect': [r['x'], r['y'], r['w'], r['h']],
                })

        return paired_cards

    def _filter_suits_by_color(self, suits, board_img):
        """Drop suit detections where template color (red/black) contradicts actual pixel color."""
        filtered = []

        for s in suits:
            x, y, w, h = s['x'], s['y'], s['w'], s['h']
            roi = board_img[y:y + h, x:x + w]

            if roi.size > 0:
                # Sample the center of the bounding box (templates are symmetrically centered)
                cy, cx = h // 2, w // 2
                patch_size = max(1, min(3, h // 4, w // 4))

                py1 = max(0, cy - patch_size)
                py2 = min(h, cy + patch_size + 1)
                px1 = max(0, cx - patch_size)
                px2 = min(w, cx + patch_size + 1)
                patch = roi[py1:py2, px1:px2]

                if patch.size > 0:
                    b, g, r = cv2.mean(patch)[:3]
                else:
                    b, g, r = (float(v) for v in roi[cy, cx])

                min_ch = min(r, g, b)
                max_ch = max(r, g, b)
                is_white = min_ch > 180 and (max_ch - min_ch) < 40

                if not is_white:
                    is_red_actual = r > b + 25 and r > g + 25 and r > 80
                    is_red_tmpl = 'heart' in s['label'] or 'diamond' in s['label']

                    if is_red_tmpl != is_red_actual:
                        logger.debug(
                            f"  Suit {s['label']} REJECTED for color mismatch "
                            f"(R={r:.0f}, G={g:.0f}, B={b:.0f})"
                        )
                        continue
                else:
                    logger.debug(
                        f"  Suit {s['label']} SKIPPED color check — white pixel "
                        f"(R={r:.0f}, G={g:.0f}, B={b:.0f})"
                    )

            filtered.append(s)

        return filtered

    def detect_cards_with_info(self, board_img, game_phase=None, min_group_size=2,
                              context="board", save_debug_image=False):
        """
        Main entry point for finding cards in an ROI using Symbol-Based Template Mapping.
        """
        if board_img.size == 0:
            return {"cards": [], "is_reliable": False, "metrics": {}}

        gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)
        is_board = context == "board"

        # Pre-compute binarized search images ONCE per frame
        search_images = self._build_search_images(gray, board_img)
        # Edge-only image for fast first pass (just raw grayscale)
        edge_only = [gray]

        # Context-specific parameters
        if is_board:
            cfg = _CONTEXT_CONFIG["board"]
            suit_tmpls = self.suit_templates_board
            suit_scales = cfg["suit_scales"]
        else:
            cfg = _CONTEXT_CONFIG["_default"]
            if self.suit_templates_small:
                suit_tmpls = self.suit_templates_small
                suit_scales = cfg["suit_scales_small"]
            else:
                suit_tmpls = self.suit_templates_board
                suit_scales = cfg["suit_scales_board_fallback"]

        rank_threshold = cfg["rank_threshold"]
        suit_threshold = cfg["suit_threshold"]

        # ── Detection strategy depends on context ──
        # Board: large, well-lit cards → edge-only first pass is safe & fast.
        # River/small: tiny cards on dark backgrounds → grayscale alone produces
        # false-positive ranks. Always use all binarized images for accuracy.
        if is_board:
            # Phase 1: Edge-only pass for ranks (fast — 1 search image)
            ranks = self._detect_symbols(
                gray, self.rank_templates,
                threshold=rank_threshold, scales=cfg["rank_scales"],
                search_images=edge_only,
            )

            # Phase 2: Selective binarize fallback for RANKS if edge missed some
            edge_rank_count = len(ranks)
            if edge_rank_count < 3:
                found_rank_labels = {r['label'] for r in ranks}
                missing_rank_templates = {
                    k: v for k, v in self.rank_templates.items()
                    if v['label'] not in found_rank_labels
                }
                if missing_rank_templates:
                    ranks_extra = self._detect_symbols(
                        gray, missing_rank_templates,
                        threshold=rank_threshold, scales=cfg["rank_scales"],
                        search_images=search_images,
                    )
                    if ranks_extra:
                        ranks = self._nms(ranks + ranks_extra, iou_threshold=0.2)
                    logger.debug(
                        f"[CardDetector] board: rank binarize fallback ran "
                        f"({len(missing_rank_templates)} missing rank templates)"
                    )
        else:
            # Non-board: use all search images for ranks (small cards need binarization)
            ranks = self._detect_symbols(
                gray, self.rank_templates,
                threshold=rank_threshold, scales=cfg["rank_scales"],
                search_images=search_images,
            )

        # Suits ALWAYS use all search images — red suits (hearts/diamonds)
        # need the red-channel binarized image, invisible in plain grayscale.
        suits = self._detect_symbols(
            gray, suit_tmpls,
            threshold=suit_threshold, scales=suit_scales,
            search_images=search_images,
        )

        # ── Phase 3: River board-template fallback ──
        # Run if there are more ranks than suits — meaning some ranks have no paired suit
        if not is_board and self.suit_templates_board and len(suits) < len(ranks):
            suits_fallback = self._detect_symbols(
                gray, self.suit_templates_board,
                threshold=max(suit_threshold - 0.05, 0.60),
                scales=cfg["fallback_scales"],
                search_images=search_images,
            )
            if suits_fallback:
                logger.debug(
                    f"[CardDetector] river fallback: {len(suits_fallback)} extra suit hits "
                    f"from board templates (had {len(suits)} suits for {len(ranks)} ranks)"
                )
                suits = self._nms(suits + suits_fallback, iou_threshold=0.2)

        # Heart-Diamond disambiguation — only for non-board (river/showdown)
        # Board cards have correct rendering, disambiguation would corrupt them.
        if not is_board:
            suits = self._disambiguate_red_suits(suits, search_images)

        # Apply color-based suit filtering
        suits = self._filter_suits_by_color(suits, board_img)

        logger.debug(f"[CardDetector] {context}: {len(ranks)} rank hits, {len(suits)} suit hits")
        for r in ranks:
            logger.debug(f"  rank: {r['label']} score={r['score']:.2f} at ({r['x']},{r['y']})")
        for s in suits:
            logger.debug(f"  suit: {s['label']} score={s['score']:.2f} at ({s['x']},{s['y']})")

        # Save debug visualization — only copy image when actually needed
        if save_debug_image and (ranks or suits):
            debug_img = board_img.copy()
            for d in ranks:
                cv2.rectangle(debug_img, (d['x'], d['y']),
                              (d['x'] + d['w'], d['y'] + d['h']), (0, 255, 0), 1)
                cv2.putText(debug_img, f"{d['label']} {d['score']:.2f}",
                            (d['x'], d['y'] - 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
            for d in suits:
                cv2.rectangle(debug_img, (d['x'], d['y']),
                              (d['x'] + d['w'], d['y'] + d['h']), (255, 0, 0), 1)
                cv2.putText(debug_img, f"{d['label']} {d['score']:.2f}",
                            (d['x'], d['y'] - 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)
            self._save_debug(debug_img, f"symbols_matched_{context}")

        # Grouping & sorting
        paired_cards = self._group_symbols(ranks, suits, context=context)

        if is_board:
            paired_cards.sort(key=lambda c: c['x'])   # Left to right
        else:
            paired_cards.sort(key=lambda c: c['y'])   # Top to bottom

        names = [c['name'] for c in paired_cards]
        is_duplicate = len(names) != len(set(names))

        if is_board:
            is_reliable = 3 <= len(paired_cards) <= 5 and not is_duplicate
        else:
            is_reliable = len(paired_cards) > 0 and not is_duplicate

        # Trigger Failed Case Logging
        self._handle_failed_case(board_img, paired_cards, ranks, suits, context, is_reliable)

        num_cards = len(paired_cards)
        return {
            "cards": paired_cards,
            "is_reliable": is_reliable,
            "metrics": {
                "card_count": num_cards,
                "has_unknown": False,
                "avg_confidence": (
                    sum(c['confidence'] for c in paired_cards) / num_cards
                    if num_cards else 0.0
                ),
                "is_duplicate": is_duplicate,
                "rows_found": 1,
                "ranks_found": len(ranks),
                "suits_found": len(suits),
            },
        }
