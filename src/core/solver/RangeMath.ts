/**
 * RangeMath — Pure Mathematical Operations on RangeState
 *
 * All normalization is centralized here. No other module may normalize.
 * Pure functions: never mutates input, always returns new objects.
 * O(n) complexity where n = 169. No sorting allowed.
 */

import { HandClassGenerator } from './HandClassGenerator';
import { RangeState } from './RangeState';
import { PRECISION, HAND_CLASS_COUNT } from './types';
import type { ActionFrequencies } from './types';

export interface SplitResult {
    readonly raise: RangeState;
    readonly call: RangeState;
    readonly fold: RangeState;
}

export class RangeMath {
    /**
     * Normalize raw weights to sum exactly to 100.0000.
     *
     * Rules:
     * - 4 decimal internal precision
     * - Zero-weight input returns zero-weight RangeState (NOT balanced, NOT throw)
     * - Residual dumped into first non-zero hand class
     * - Idempotent: normalizing an already-normalized state is identity
     */
    static normalize(data: ReadonlyMap<string, number>): RangeState {
        const hands = HandClassGenerator.generateAll();

        if (data.size !== HAND_CLASS_COUNT) {
            throw new Error(
                `normalize requires exactly ${HAND_CLASS_COUNT} keys, got ${data.size}`
            );
        }

        let rawSum = 0;
        for (const hand of hands) {
            if (!data.has(hand)) {
                throw new Error(`normalize: missing canonical hand class: ${hand}`);
            }
            const val = data.get(hand)!;
            if (val < 0) {
                throw new Error(`normalize: negative value for ${hand}: ${val}`);
            }
            rawSum += val;
        }

        // Zero-weight case: return all zeros
        if (rawSum === 0) {
            const zeroMap = new Map<string, number>();
            for (const hand of hands) {
                zeroMap.set(hand, 0);
            }
            return new RangeState(zeroMap);
        }

        const factor = 100 / rawSum;
        const result = new Map<string, number>();
        const intValues: number[] = [];
        let intSum = 0;
        let firstNonZeroIdx = -1;

        for (let i = 0; i < hands.length; i++) {
            const hand = hands[i];
            const raw = data.get(hand)!;
            const intVal = Math.round(raw * factor * PRECISION);
            intValues.push(intVal);
            intSum += intVal;
            if (firstNonZeroIdx === -1 && intVal > 0) {
                firstNonZeroIdx = i;
            }
        }

        // Deterministic residual correction into first non-zero bucket
        const target = 100 * PRECISION;
        if (intSum !== target && firstNonZeroIdx !== -1) {
            intValues[firstNonZeroIdx] += target - intSum;
        }

        for (let i = 0; i < hands.length; i++) {
            result.set(hands[i], intValues[i] / PRECISION);
        }

        return new RangeState(result);
    }

    /**
     * Split a RangeState proportionally by action frequencies.
     *
     * For each hand class:
     *   raiseWeight = originalWeight * (raise_pct / 100)
     *   callWeight  = originalWeight * (call_pct / 100)
     *   foldWeight  = originalWeight * (fold_pct / 100)
     *
     * Invariant: sum of raw branch weights = original weights (pre-normalization).
     * Each branch is independently normalized to 100.0000.
     */
    static split(range: RangeState, freqs: ActionFrequencies): SplitResult {
        const hands = HandClassGenerator.generateAll();

        const raiseMap = new Map<string, number>();
        const callMap = new Map<string, number>();
        const foldMap = new Map<string, number>();

        for (const hand of hands) {
            // Convert to integer domain (4 decimal precision)
            const weightInt = Math.round(range.get(hand) * PRECISION);

            // Proportional split in integer domain
            const raiseInt = Math.round(weightInt * freqs.raise_pct / 100);
            const callInt = Math.round(weightInt * freqs.call_pct / 100);
            // Fold absorbs remainder — guarantees zero weight loss per hand
            const foldInt = Math.max(0, weightInt - raiseInt - callInt);

            raiseMap.set(hand, raiseInt / PRECISION);
            callMap.set(hand, callInt / PRECISION);
            foldMap.set(hand, foldInt / PRECISION);
        }

        return {
            raise: RangeMath.normalize(raiseMap),
            call: RangeMath.normalize(callMap),
            fold: RangeMath.normalize(foldMap),
        };
    }
}
