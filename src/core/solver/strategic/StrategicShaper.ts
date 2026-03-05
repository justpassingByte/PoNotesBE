/**
 * StrategicShaper - Range Shape Profile Multipliers
 *
 * Computes per-hand multipliers for shaping modes.
 * For non-balanced modes, ties are broken by intrinsic hand strength,
 * then canonical index as a final deterministic fallback.
 *
 * MUST NOT inspect boardContext.
 * Board-aware logic belongs exclusively to BucketIntelligence.
 */
import { HandClassGenerator } from '../HandClassGenerator';
import { RangeState } from '../RangeState';
import type { HandClass, MultiplierMap, ShapingMode } from './types';
import { PRECISION } from './types';

// Tier boundaries (after sorting 169 hands by weight descending)
const TOP_END = 33;   // [0, 33] = 34 hands ~= 20.1%
const MID_END = 134;  // [34, 134] = 101 hands ~= 59.8%
// Bottom: [135, 168] = 34 hands ~= 20.1%

const PROFILES: Record<ShapingMode, { top: number; mid: number; bottom: number }> = {
    polar: { top: 13000, mid: 7000, bottom: 12000 },
    merged: { top: 8000, mid: 13000, bottom: 8000 },
    balanced: { top: PRECISION, mid: PRECISION, bottom: PRECISION },
};

const RANK_ORDER = '23456789TJQKA';

function rankValue(rank: string): number {
    const idx = RANK_ORDER.indexOf(rank);
    return idx === -1 ? 0 : idx + 2;
}

function tieBreakStrengthScore(hand: string): number {
    const r1 = hand[0];
    const r2 = hand[1];
    const v1 = rankValue(r1);
    const v2 = rankValue(r2);
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);

    // Pairs outrank non-pairs in tie-break strength.
    if (r1 === r2) {
        return 3_000_000 + high * 1_000;
    }

    const suited = hand.length === 3 && hand[2] === 's';
    const gap = Math.abs(v1 - v2);
    const connectedBonus = Math.max(0, 5 - gap) * 10;
    const broadwayBonus = high >= 10 && low >= 10 ? 200 : 0;
    const suitedBonus = suited ? 150 : 0;

    return 1_000_000 + high * 1_000 + low * 20 + connectedBonus + broadwayBonus + suitedBonus;
}

export class StrategicShaper {
    /**
     * Compute range shaping multipliers based on shaping mode.
     * Returns PRECISION-scaled integer multipliers.
     * Polar: amplify extremes, compress middle.
     * Merged: compress extremes, amplify middle.
     * Balanced: identity (all PRECISION).
     *
     * MUST NOT inspect boardContext.
     */
    static computeMultipliers(
        range: RangeState,
        mode: ShapingMode
    ): MultiplierMap {
        const hands = HandClassGenerator.generateAll();

        // Balanced = identity (skip sort)
        if (mode === 'balanced') {
            const result = new Map<HandClass, number>();
            for (const hand of hands) {
                result.set(hand, PRECISION);
            }
            return result;
        }

        const profile = PROFILES[mode];
        const strengthScore = new Map<string, number>();
        for (const hand of hands) {
            strengthScore.set(hand, tieBreakStrengthScore(hand));
        }

        // Build sortable array with weight + canonical index fallback
        const indexed: Array<{ hand: string; weight: number; canonIdx: number }> = [];
        for (let i = 0; i < hands.length; i++) {
            indexed.push({
                hand: hands[i],
                weight: range.getInt(hands[i]),
                canonIdx: i,
            });
        }

        // Sort descending by weight, then intrinsic strength, then canonical index.
        indexed.sort((a, b) => {
            if (b.weight !== a.weight) return b.weight - a.weight;
            const strengthDelta = (strengthScore.get(b.hand) ?? 0) - (strengthScore.get(a.hand) ?? 0);
            if (strengthDelta !== 0) return strengthDelta;
            return a.canonIdx - b.canonIdx;
        });

        // Assign tier multipliers
        const result = new Map<HandClass, number>();
        for (let i = 0; i < indexed.length; i++) {
            let multiplier: number;
            if (i <= TOP_END) {
                multiplier = profile.top;
            } else if (i <= MID_END) {
                multiplier = profile.mid;
            } else {
                multiplier = profile.bottom;
            }
            result.set(indexed[i].hand as HandClass, multiplier);
        }

        return result;
    }
}
