"""
scorer.py — Hybrid Confidence Scoring for OCR Validation.

Pipeline:
  cv_confidence (from CardDetector) ──┐
                                      ├─→ ConfidenceScorer → final_score → Decision Layer
  llm_adjustment (from LLMReviewer) ──┘

Decision Matrix:
  final_score >= 0.9  →  AUTO ACCEPT  (no user interaction)
  final_score  0.7–0.9 → UI CONFIRMATION (show confirm modal)
  final_score  < 0.7  →  FORCE CORRECTION (user must edit)
"""

from __future__ import annotations
import os
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Decision constants
# ─────────────────────────────────────────────────────────────
DECISION_AUTO_ACCEPT   = "auto_accept"
DECISION_CONFIRM       = "confirm"
DECISION_FORCE_CORRECT = "force_correct"

AUTO_ACCEPT_THRESHOLD   = 0.9
CONFIRM_THRESHOLD       = 0.7


# ─────────────────────────────────────────────────────────────
# ConfidenceScorer  (Task 3.1)
# ─────────────────────────────────────────────────────────────
class ConfidenceScorer:
    """
    Computes:
      base  = cv * 0.7 + llm_adj * 0.3   (LLM as pure adjustment, no CV doubling)
      final = clamp(base - penalty, 0, floor)
      floor = 0.6 if validation_ok=False (hard cap)
    Returns structured confidence_breakdown + decision_reason for frontend explainability.
    """
    CV_WEIGHT  = 0.7
    LLM_WEIGHT = 0.3
    VALIDATION_FLOOR = 0.6   # ❸ hard cap when validation fails

    def compute(
        self,
        cv_confidence: float,
        llm_adjustment: float = 0.0,
        validation_penalty: float = 0.0,
        validation_ok: bool = True,
        reasons: list | None = None,
    ) -> dict:
        """
        Args:
            cv_confidence:     Raw confidence from CardDetector (0–1).
            llm_adjustment:    Adjustment from LLMReviewer (typically -0.5 to 0.0).
            validation_penalty: Extra deduction for rule failures.
            validation_ok:     Hard floor trigger.
            reasons:           List of string reasons to include in output.

        Returns:
            {
              "final": float,
              "decision": str,
              "decision_reason": [str, ...],
              "breakdown": {"cv", "llm_adj", "validation"}
            }
        """
        cv_confidence   = max(0.0, min(1.0, cv_confidence))
        llm_clamped     = max(-0.5, min(0.0, llm_adjustment))  # LLM only adjusts down
        val_pen         = max(0.0, min(1.0, validation_penalty))

        # ❶ Fixed formula: CV*0.7 + llm_adj*0.3 (no double-counting CV)
        base  = cv_confidence * self.CV_WEIGHT + llm_clamped * self.LLM_WEIGHT
        final = max(0.0, base - val_pen)
        
        logger.info(f"[ConfidenceScorer] Base: {base:.3f} (CV={cv_confidence:.2f}*0.7, LLM={llm_clamped:.2f}*0.3) | Penalty: {val_pen:.2f}")

        # ❸ Confidence floor — validation fail cannot score above 0.6
        if not validation_ok:
            logger.warning(f"[ConfidenceScorer] Validation FAILED. Capping score at {self.VALIDATION_FLOOR}.")
            final = min(final, self.VALIDATION_FLOOR)

        final = round(min(1.0, final), 3)
        decision, auto_reasons = self._decide(final, cv_confidence, llm_clamped, validation_ok)
        all_reasons = list(set((reasons or []) + auto_reasons))

        return {
            "final": final,
            "decision": decision,
            "decision_reason": all_reasons,
            "breakdown": {
                "cv":         round(cv_confidence, 3),
                "llm_adj":    round(llm_clamped, 3),
                "validation": round(-val_pen, 3),
            },
        }

    @staticmethod
    def _decide(score: float, cv: float, llm_adj: float, validation_ok: bool) -> tuple:
        """Returns (decision_str, [reason_str, ...])"""
        reasons = []
        if cv < AUTO_ACCEPT_THRESHOLD:
            reasons.append("low_cv_confidence")
        if llm_adj < -0.05:
            reasons.append("llm_flagged")
        if not validation_ok:
            reasons.append("validation_failed")

        if score >= AUTO_ACCEPT_THRESHOLD:
            return DECISION_AUTO_ACCEPT, reasons
        if score >= CONFIRM_THRESHOLD:
            return DECISION_CONFIRM, reasons
        reasons.append("score_below_threshold")
        return DECISION_FORCE_CORRECT, reasons


# ─────────────────────────────────────────────────────────────
# LLMReviewer  (Tasks 3.2 + design rule: trigger ONLY if needed)
# ─────────────────────────────────────────────────────────────
class LLMReviewer:
    """
    Calls an LLM (via OpenAI-compatible API) to review OCR results.

    RESTRICTIONS (by design):
    - MUST NOT generate or hallucinate card names.
    - MUST NOT override OCR values directly.
    - ONLY outputs confidence_adjustment and issues.

    Trigger Condition (Task 3.2):
    - Skip entirely if cv_confidence >= 0.9 AND no validation failures.
    """

    SYSTEM_PROMPT = """You are a Poker OCR Validation Assistant.
Given a set of detected board cards and game context, assess whether the detection looks valid.

RULES:
- Do NOT generate or invent card values.
- Only report issues you observe (e.g., wrong count, impossible combination).
- Return ONLY valid JSON matching this schema:
{
  "is_valid": boolean,
  "issues": ["issue description", ...],
  "confidence_adjustment": float (range -0.5 to 0.0)
}
Return ONLY the JSON, no markdown, no extra text."""

    def __init__(self, api_key: str | None = None, model: str = "gpt-4o-mini"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.model   = model
        self._client: Any = None

    def _get_client(self) -> Any:
        if not self._client and self.api_key:
            try:
                from openai import OpenAI  # type: ignore[import]
                self._client = OpenAI(api_key=self.api_key)
            except ImportError:
                logger.warning("[LLMReviewer] openai package not installed.")
        return self._client

    def should_trigger(self, cv_confidence: float, validation_ok: bool) -> bool:
        """Task 3.2: Only call LLM if cv < 0.9 OR validation failed."""
        return cv_confidence < AUTO_ACCEPT_THRESHOLD or not validation_ok

    def review(
        self,
        board_cards: list[str],
        game_phase: str | None,
        cv_confidence: float,
        validation_ok: bool,
    ) -> dict:
        """
        Returns LLM review dict: { is_valid, issues, confidence_adjustment }
        Falls back gracefully if API unavailable.
        """
        default = {"is_valid": True, "issues": [], "confidence_adjustment": 0.0}

        if not self.should_trigger(cv_confidence, validation_ok):
            logger.info("[LLMReviewer] Skipping LLM — CV high and validation OK.")
            return default

        client = self._get_client()
        if not client:
            logger.warning("[LLMReviewer] No API client — skipping review.")
            return default

        user_msg = json.dumps({
            "board_cards": board_cards,
            "game_phase": game_phase,
            "cv_confidence": round(cv_confidence, 3),
        })

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
                temperature=0.0,
                max_tokens=200,
            )
            raw = response.choices[0].message.content or "{}"
            # Strip any accidental markdown code fences
            raw = re.sub(r"```json|```", "", raw).strip()
            parsed = json.loads(raw)
            logger.info(f"[LLMReviewer] Result: {parsed}")
            return parsed
        except Exception as e:
            logger.error(f"[LLMReviewer] API call failed: {e}")
            return default


# ─────────────────────────────────────────────────────────────
# FallbackStrategy  (Task 3.4)
# ─────────────────────────────────────────────────────────────
class FallbackStrategy:
    """
    Multi-pass fallback for when primary detection fails.
    Pass 1: Adaptive threshold (different block size)
    Pass 2: Region expansion (+10% each side)
    Pass 3: Scale adjust (already handled inside CardDetector multi-scale)
    """

    def apply(self, board_img, card_detector, game_phase=None) -> list:
        """
        Try progressively more aggressive detection strategies.
        Returns detected card results list.
        """
        import cv2  # local import to avoid circular issues at module level

        results = []

        # Pass 1: Try with additional preprocessing (CLAHE contrast)
        logger.info("[FallbackStrategy] Pass 1: CLAHE contrast enhancement.")
        try:
            gray = cv2.cvtColor(board_img, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)
            enhanced_bgr = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
            res = card_detector.detect_cards_with_info(enhanced_bgr, game_phase)
            results = res.get('cards', []) if isinstance(res, dict) else res

            if results and any(r['name'] != '??' for r in results):
                logger.info(f"[FallbackStrategy] Pass 1 succeeded: {len(results)} cards.")
                return results
        except Exception as e:
            logger.warning(f"[FallbackStrategy] Pass 1 exception: {e}")

        # Pass 2: Expanded region (+10%)
        logger.info("[FallbackStrategy] Pass 2: Expanded region crop.")
        try:
            bh, bw = board_img.shape[:2]
            pad_h, pad_w = int(bh * 0.1), int(bw * 0.1)
            expanded = cv2.copyMakeBorder(
                board_img, pad_h, pad_h, pad_w, pad_w,
                cv2.BORDER_REPLICATE
            )
            res = card_detector.detect_cards_with_info(expanded, game_phase)
            results = res.get('cards', []) if isinstance(res, dict) else res

            if results and any(r['name'] != '??' for r in results):
                logger.info(f"[FallbackStrategy] Pass 2 succeeded: {len(results)} cards.")
                return results
        except Exception as e:
            logger.warning(f"[FallbackStrategy] Pass 2 exception: {e}")

        logger.warning("[FallbackStrategy] All passes failed — returning empty.")
        return results


# ─────────────────────────────────────────────────────────────
# DecisionLayer — orchestrates scoring + decision + logging
# ─────────────────────────────────────────────────────────────
class DecisionLayer:
    """
    Orchestrates the full hybrid validation pipeline.
    Usage:
        layer = DecisionLayer()
        outcome = layer.evaluate(board_cards, cv_conf, game_phase, validation_ok, reasons)
    """

    def __init__(self):
        self.scorer   = ConfidenceScorer()
        self.reviewer = LLMReviewer()

    def evaluate(
        self,
        board_cards:   list[str],
        cv_confidence: float,
        game_phase:    str | None = None,
        validation_ok: bool = True,
        reasons:       list | None = None,
    ) -> dict:
        """
        Returns full evaluation result:
        {
          "final": float,
          "decision": str,
          "decision_reason": [str, ...],
          "breakdown": {...},
          "llm_review": {...},
          "board_cards": [...],
        }
        """
        # LLM review (conditional — task 3.2)
        llm_result = self.reviewer.review(
            board_cards   = board_cards,
            game_phase    = game_phase,
            cv_confidence = cv_confidence,
            validation_ok = validation_ok,
        )

        llm_adj     = float(llm_result.get("confidence_adjustment", 0.0))
        llm_invalid = not llm_result.get("is_valid", True)
        llm_issues  = llm_result.get("issues", [])

        # Build reason list before scoring
        all_reasons = list(reasons or [])
        if llm_issues:
            all_reasons.extend([f"llm: {issue}" for issue in llm_issues])
        if not validation_ok:
            all_reasons.append("validation_failed")

        # Penalties
        val_penalty  = 0.1 if not validation_ok else 0.0
        val_penalty += 0.15 if llm_invalid else 0.0

        score_result = self.scorer.compute(
            cv_confidence      = cv_confidence,
            llm_adjustment     = llm_adj,
            validation_penalty = val_penalty,
            validation_ok      = validation_ok,
            reasons            = all_reasons,
        )

        return {
            **score_result,
            "llm_review":  llm_result,
            "board_cards": board_cards,
            "game_phase":  game_phase,
        }
