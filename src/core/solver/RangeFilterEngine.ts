/**
 * RangeFilterEngine — Postflop Card Exclusion Logic
 *
 * Adjusts weights for structurally impossible combos while preserving
 * all 169 canonical hand class keys. Board filtering never deletes keys.
 *
 * IMPORTANT: applyBoard() returns RAW adjusted weights (Map).
 * It does NOT normalize. The caller (StreetAdvancer or SolverEngine)
 * is responsible for calling RangeMath.normalize() exactly once.
 *
 * Phase 1: Stub implementation (preflop pass-through).
 * Future: postflop card exclusion with weight adjustment.
 */

import { RangeState } from './RangeState';
import type { BoardTextureBucket } from './types';

export class RangeFilterEngine {
    /**
     * Apply board-based filtering to a range.
     *
     * Preflop (no boardContext): pass-through, returns the RangeState toMap().
     * Postflop: adjusts weights for impossible combos.
     *
     * Returns RAW weights (Map<string, number>). Does NOT normalize.
     *
     * Rules:
     * - NEVER deletes canonical hand class keys (169 keys are immutable)
     * - May only adjust weights and zero-out impossible combos
     * - Does NOT normalize — caller must call RangeMath.normalize()
     */
    static applyBoard(range: RangeState, boardContext?: BoardTextureBucket): Map<string, number> {
        const rawMap = range.toMap();

        if (!boardContext) {
            return rawMap;
        }

        // Postflop stub: return raw weights copy.
        // Future: zero-out impossible combos based on board cards.
        return rawMap;
    }
}

