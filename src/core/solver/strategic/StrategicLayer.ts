/**
 * StrategicLayer — Post-Baseline Strategy Shaping Orchestrator
 *
 * Applies deterministic strategic adjustments to a range branch AFTER baseline split.
 * Returns raw integer-domain Map — does NOT normalize.
 *
 * Internal pipeline executes in fixed order:
 * 1. BucketIntelligence — board-aware + combo-density
 * 2. StrategicShaper — range shape profile
 * 3. ExploitAdjuster — villain-type exploit
 *
 * Contract:
 * - MUST return Map<HandClass, number> in integer domain (PRECISION-scaled)
 * - MUST read weights via RangeState.getInt() — single decimal-to-int boundary
 * - MUST NOT return RangeState
 * - MUST NOT divide result by PRECISION
 * - MUST NOT call RangeMath.normalize()
 * - MUST NOT call RangeMath.split()
 * - MUST NOT mutate input range
 * - MUST iterate hand classes exactly once (O(169))
 */

import { HandClassGenerator } from '../HandClassGenerator';
import { RangeState } from '../RangeState';
import { BucketIntelligence } from './BucketIntelligence';
import { ExploitAdjuster } from './ExploitAdjuster';
import { StrategicShaper } from './StrategicShaper';
import type { HandClass, NodeAction, StrategicContext } from './types';
import { PRECISION } from './types';

export class StrategicLayer {
    /**
     * Apply strategic adjustments to a range branch.
     * Returns raw Map in integer domain (PRECISION-scaled).
     * Caller must normalize via RangeMath.normalize().
     *
     * @param range - the branch RangeState to adjust
     * @param action - which branch this range belongs to (raise/call/fold)
     * @param context - strategic decision context
     */
    static apply(
        range: RangeState,
        action: NodeAction,
        context: StrategicContext
    ): Map<HandClass, number> {
        const hands = HandClassGenerator.generateAll();

        // Pipeline: fixed order, no skipping
        const m1 = BucketIntelligence.computeMultipliers(context.boardContext, context.street);
        const m2 = StrategicShaper.computeMultipliers(range, context.shapingMode);
        const m3 = ExploitAdjuster.computeMultipliers(context.villainType, action);

        const result = new Map<HandClass, number>();

        // Single pass over 169 hand classes — O(169)
        for (const hand of hands) {
            // Pure integer domain — single decimal-to-int boundary
            const weightInt = range.getInt(hand);
            const m1Int = m1.get(hand) ?? PRECISION;
            const m2Int = m2.get(hand) ?? PRECISION;
            const m3Int = m3.get(hand) ?? PRECISION;

            // Sequential integer division — no floating-point intermediates
            const step1 = Math.floor((m1Int * m2Int) / PRECISION);
            const combinedRaw = Math.floor((step1 * m3Int) / PRECISION);
            const combinedInt = Math.min(combinedRaw, 30000); // SAFETY CLAMP
            const adjustedInt = Math.max(0, Math.floor((weightInt * combinedInt) / PRECISION));

            // Return raw integer — NOT divided by PRECISION
            result.set(hand, adjustedInt);
        }

        return result;
    }
}
