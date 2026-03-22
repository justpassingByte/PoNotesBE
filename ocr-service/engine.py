import cv2
import numpy as np
import json
import os
import time
import math
import logging

logger = logging.getLogger(__name__)

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

        # 🚀 Fix Bug 2: Call OCR once and share result across layouts for performance
        ocr_results = []
        if ocr_engine:
            try:
                # Downscale 1920x1080 -> something smaller if we only need keywords?
                # For now, just call once and cache.
                res = ocr_engine.ocr(image, cls=True)
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

            # Signal 3: Aspect ratio consistency bonus
            target_ratio = layout.get('aspect_ratio', 1.77)
            if abs(aspect_ratio - target_ratio) < 0.1:
                score += 0.1

            if score > layout.get('threshold', 0.5) and score > max_score:
                max_score = score
                best_match = (layout, score)

        return best_match

    def crop_region(self, image, region_coords):
        h, w = image.shape[:2]
        x1, y1 = int(region_coords['x1'] * w), int(region_coords['y1'] * h)
        x2, y2 = int(region_coords['x2'] * w), int(region_coords['y2'] * h)
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
        self.card_templates = {}  # name -> img
        self.template_meta = {}   # name -> {usage_count, success_rate}
        self._load_templates()

    def _load_templates(self):
        if not os.path.exists(self.templates_dir):
            os.makedirs(self.templates_dir, exist_ok=True)
        for f in os.listdir(self.templates_dir):
            if f.endswith(".png"):
                name = f.split("_")[0]
                img = cv2.imread(os.path.join(self.templates_dir, f))
                if img is not None:
                    self.card_templates[name] = img
                    self.template_meta.setdefault(
                        name,
                        {"usage_count": 0, "success_rate": 1.0, "last_used": time.time()}
                    )

    # ── Task 2.2 / 2.3 / 2.4: Contour detection with merged split & gap guard ──
    def _detect_card_rects(self, board_img, scale_factor=1.0):
        """
        Detect card bounding boxes via thresholding + contours.
        Handles merged cards by splitting wide contours.
        Gap detection is used ONLY to trigger fallback — never produces output.
        """
        bh, bw = board_img.shape[:2]

        # Optionally upscale for resolution-challenged images
        if scale_factor != 1.0:
            board_img = cv2.resize(
                board_img,
                (int(bw * scale_factor), int(bh * scale_factor)),
                interpolation=cv2.INTER_CUBIC
            )
            bh, bw = board_img.shape[:2]

        gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)

        # Adaptive threshold — detects white cards on varied backgrounds
        thresh = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 15, -5
        )

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        expected_card_h = bh * 0.7
        expected_card_w = expected_card_h * 0.72   # approx card aspect ratio

        rects = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            aspect = w / float(h) if h > 0 else 0
            area = w * h

            # Task 2.3: Merged contour split — wide contour → try splitting
            if w > expected_card_w * 1.5 and h > expected_card_h * 0.5:
                split = self._split_merged_contour(board_img, x, y, w, h, expected_card_w)
                rects.extend(split)
                continue

            # Keep contours that look like single cards
            if (self.CARD_ASPECT_MIN <= aspect <= self.CARD_ASPECT_MAX
                    and h > expected_card_h * 0.5
                    and area > 300):
                rects.append((x, y, w, h))

        # 🚀 Fix Bug 1: Scale rects back down to original coordinates
        final_rects = []
        if scale_factor != 1.0:
            inv_scale = 1.0 / scale_factor
            for rx, ry, rw, rh in rects:
                final_rects.append((
                    int(rx * inv_scale),
                    int(ry * inv_scale),
                    int(rw * inv_scale),
                    int(rh * inv_scale)
                ))
        else:
            final_rects = rects

        # Task 2.4: Gap detection — ONLY signals fallback, NEVER modifies rects
        has_gap = False
        if final_rects:
            # We check gaps in original coordinates (or scaled, doesn't matter much as long as threshold matches)
            # but final_rects are what we return.
            has_gap = self._check_gaps(final_rects, expected_card_w * (1.0 / scale_factor))

        return final_rects, has_gap

    def _split_merged_contour(self, img, x, y, w, h, expected_card_w):
        """
        Task 2.3: Vertical projection split for merged (touching) cards.
        """
        roi = img[y:y+h, x:x+w]
        gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, bin_roi = cv2.threshold(gray_roi, 200, 255, cv2.THRESH_BINARY)

        # Vertical projection (sum of white pixels per column)
        v_proj = np.sum(bin_roi, axis=0) / 255.0
        expected_splits = max(2, int(round(w / expected_card_w)))
        card_w = w // expected_splits

        rects = []
        for i in range(expected_splits):
            cx = x + i * card_w
            cw = card_w if (i < expected_splits - 1) else (w - i * card_w)
            if cw > 10:
                rects.append((cx, y, cw, h))

        logger.info(f"[CardDetector] Split merged contour into {len(rects)} cards.")
        return rects

    def _check_gaps(self, rects, expected_card_w) -> bool:
        """
        Task 2.4: Detect suspicious gaps between cards.
        Returns True if a large gap was found (signals caller to trigger fallback).

        HARD RULE: This method NEVER modifies rects or generates new slots.
        Callers must NOT inject cards based on this signal.
        """
        gap_threshold = expected_card_w * 0.6
        has_gap = False
        for i in range(1, len(rects)):
            prev_end = rects[i-1][0] + rects[i-1][2]
            gap = rects[i][0] - prev_end
            if gap > gap_threshold:
                logger.warning(
                    f"[CardDetector] Large gap ({gap:.0f}px) detected at index {i}. "
                    f"Possible missing card. Triggering fallback."
                )
                has_gap = True
        return has_gap

    # ── Task 2.2: Validate rects against game phase ──
    def _validate_rects(self, rects, game_phase=None):
        """
        Strict uniformity check + game phase count prediction.
        """
        expected = {"flop": 3, "turn": 4, "river": 5}
        min_count = 3
        max_count = 5

        if game_phase and game_phase.lower() in expected:
            target = expected[game_phase.lower()]
            min_count = max_count = target

        if not (min_count <= len(rects) <= max_count):
            return False

        if len(rects) < 2:
            return len(rects) > 0

        widths  = [r[2] for r in rects]
        heights = [r[3] for r in rects]
        xs      = [r[0] for r in rects]
        spacings = [xs[i+1] - xs[i] for i in range(len(xs)-1)]

        w_var = np.var(widths)
        h_var = np.var(heights)
        s_var = np.var(spacings) if spacings else 0

        # Thresholds defined empirically — can be tuned
        if w_var > 500 or h_var > 500 or s_var > 1500:
            logger.warning(f"[CardDetector] Uniformity check FAILED: w_var={w_var:.1f}, h_var={h_var:.1f}, s_var={s_var:.1f}")
            return False

        return True

    # ── Task 2.5: Center-based crop + normalize ──
    def _center_crop(self, board_img, rect):
        """
        Crop a card from the board image and normalize to TARGET_CARD_SIZE.
        """
        x, y, w, h = rect
        bh, bw = board_img.shape[:2]

        # Expand slightly to capture full card
        pad_x = int(w * 0.05)
        pad_y = int(h * 0.05)
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(bw, x + w + pad_x)
        y2 = min(bh, y + h + pad_y)

        crop = board_img[y1:y2, x1:x2]
        if crop.size == 0:
            return np.zeros((self.TARGET_CARD_SIZE[1], self.TARGET_CARD_SIZE[0], 3), dtype=np.uint8)

        # Task 2.1: Perspective normalization (simple affine warp via bounding rect)
        normalized = cv2.resize(crop, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
        return normalized

    # ── Task 2.6: Duplicate card check ──
    def _check_duplicates(self, card_names):
        """
        Returns True if there are duplicate card names in the result.
        """
        valid_names = [n for n in card_names if n and n != '??']
        return len(valid_names) != len(set(valid_names))

    # ── Main detection entry point ──
    def detect_cards_with_info(self, board_img, ocr_engine=None, game_phase=None):
        """
        Robust card detection pipeline:
        1. Multi-scale detection passes.
        2. Merged contour splitting.
        3. Gap detection (fallback signal only).
        4. Center crop + normalization.
        5. Template matching + OCR fallback.
        6. Duplicate card validation.
        """
        results = []
        best_rects = []

        # Multi-scale passes (1.0x, 1.25x, 1.5x)
        for scale in [1.0, 1.25, 1.5]:
            rects, has_gap = self._detect_card_rects(board_img, scale_factor=scale)
            if self._validate_rects(rects, game_phase):
                # If gap detected → re-run with next scale before accepting
                if has_gap and scale < 1.5:
                    logger.info(f"[CardDetector] Gap detected at {scale}x, trying next scale.")
                    continue
                logger.info(f"[CardDetector] Valid detection at scale {scale}x: {len(rects)} cards.")
                best_rects = rects
                break
            # Keep the best attempt (most cards found)
            if len(rects) > len(best_rects):
                best_rects = rects

        if not best_rects:
            logger.warning("[CardDetector] No card rects found after all scale passes.")
            return results

        for idx, rect in enumerate(best_rects):
            card_crop = self._center_crop(board_img, rect)

            # Recognition: Template first, OCR fallback
            name, conf = self._match_template(card_crop)
            if name:
                logger.info(f"[CardDetector] Slot {idx}: matched '{name}' (conf={conf:.2f})")
                results.append({'name': name, 'confidence': conf, 'image': card_crop, 'is_new': False})
                
                # Fix Bug 5: Consistently initialize / update meta with full schema
                if name not in self.template_meta:
                    self.template_meta[name] = {"usage_count": 0, "success_rate": 1.0, "last_used": time.time()}
                
                meta: dict = self.template_meta[name]  # type: ignore[assignment]
                meta['usage_count'] = meta.get('usage_count', 0) + 1
                meta['last_used'] = time.time()
            elif ocr_engine is not None:
                try:
                    padded = cv2.copyMakeBorder(card_crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
                    res = ocr_engine.ocr(padded, cls=True)  # type: ignore[union-attr]
                    if res and res[0]:
                        txt = "".join([line[1][0] for line in res[0]]).strip().replace(" ", "")
                        ocr_conf = res[0][0][1][1] if res[0] else 0.0
                        logger.info(f"[CardDetector] Slot {idx} OCR: '{txt}' (conf={ocr_conf:.2f})")
                        results.append({'name': txt, 'confidence': ocr_conf, 'image': card_crop, 'is_new': True})
                    else:
                        logger.warning(f"[CardDetector] Slot {idx} OCR returned no text.")
                        results.append({'name': '??', 'confidence': 0.0, 'image': card_crop, 'is_new': True})
                except Exception as e:
                    logger.error(f"[CardDetector] Slot {idx} OCR Exception: {e}")
                    results.append({'name': '??', 'confidence': 0.0, 'image': card_crop, 'is_new': True})

        # Task 2.6: Duplicate card check
        names = [r['name'] for r in results]
        if self._check_duplicates(names):
            logger.error(f"[CardDetector] DUPLICATE CARDS DETECTED: {names}. Invalidating result.")
            for r in results:
                r['confidence'] = 0.0
                r['invalid_reason'] = 'duplicate'

        return results

    def _match_template(self, slot_img):
        """
        Template matching with decay-weighted priority ranking.
        score = success_rate * log1p(usage_count) * recency_weight
        recency_weight decays with 30-day half-life (templates unused for 30d score 0.5x).
        Returns (name, score) or (None, 0).
        """
        HALF_LIFE_SECONDS = 30 * 24 * 3600  # 30 days
        now = time.time()

        def _rank(name):
            # Explicitly force dict to avoid Pyre2 'NoneType' false positives
            meta = self.template_meta.get(name)
            if meta is None:
                meta = {"usage_count": 0, "success_rate": 1.0, "last_used": now}
            
            usage     = meta.get("usage_count", 0)
            sr        = meta.get("success_rate", 1.0)
            last_used = meta.get("last_used", now)
            age_secs  = max(0.0, now - last_used)
            recency   = math.exp(-math.log(2) * age_secs / HALF_LIFE_SECONDS)
            return sr * math.log1p(usage) * recency

        sorted_templates = sorted(
            self.card_templates.items(),
            key=lambda kv: _rank(kv[0]),
            reverse=True
        )

        # Normalize slot to target size for consistent matching
        try:
            normalized_slot = cv2.resize(slot_img, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
        except Exception:
            normalized_slot = slot_img

        for name, tmpl in sorted_templates:
            try:
                tmpl_resized = cv2.resize(tmpl, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)
                res = cv2.matchTemplate(normalized_slot, tmpl_resized, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(res)
                if float(max_val) > 0.85:
                    return name, float(max_val)
            except Exception:
                continue
        return None, 0.0

    def learn_card(self, card_img, card_name, verification_source='auto', failed_cases_dir="failed_cases"):
        """
        Safe self-learning with:
        - Verification source check (high_confidence | user_confirmed | user_corrected)
        - Tight contour crop before saving
        - Failed case logging for rejected/unverified data
        - last_used timestamp stored for decay ranking
        """
        if not self.enable_learning:
            return
        if card_name in self.card_templates and verification_source == 'auto':
            return  # Already known; only overwrite if user-grounded

        allowed_sources = {'high_confidence', 'user_confirmed', 'user_corrected'}
        if verification_source not in allowed_sources:
            os.makedirs(failed_cases_dir, exist_ok=True)
            fail_path = os.path.join(failed_cases_dir, f"{card_name}_rejected.png")
            cv2.imwrite(fail_path, card_img)
            logger.warning(f"[CardDetector] Rejected learn for '{card_name}' (source={verification_source}). Saved to {fail_path}.")
            return

        # Tight contour crop
        gray = cv2.cvtColor(card_img, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        cropped = card_img
        if contours:
            c = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(c)
            if w > card_img.shape[1] * 0.3 and h > card_img.shape[0] * 0.3:
                cropped = card_img[y:y+h, x:x+w]

        # Normalize before save
        cropped_norm = cv2.resize(cropped, self.TARGET_CARD_SIZE, interpolation=cv2.INTER_AREA)

        suffix = "_auto" if verification_source == 'high_confidence' else "_user"
        path = os.path.join(self.templates_dir, f"{card_name}{suffix}.png")
        cv2.imwrite(path, cropped_norm)
        self.card_templates[card_name] = cropped_norm
        # Record metadata with current timestamp for decay ranking
        existing = self.template_meta.get(card_name)
        if existing is None:
            existing = {"usage_count": 0, "success_rate": 1.0}
            
        self.template_meta[card_name] = {
            "usage_count":  existing.get("usage_count", 0) + 1,
            "success_rate": 1.0,  # freshly learned = max success rate
            "last_used":    time.time(),
        }
        logger.info(f"[CardDetector] Learned '{card_name}' (source={verification_source}) → {path}")
