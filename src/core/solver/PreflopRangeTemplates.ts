/**
 * PreflopRangeTemplates — Deterministic Starting Range Definitions
 *
 * Provides fixed preflop range templates keyed by spot template and stack depth.
 * All templates parse deterministically to a RangeState via RangeMath.normalize().
 */

import { HandClassGenerator } from './HandClassGenerator';
import { RangeMath } from './RangeMath';
import { RangeState } from './RangeState';
import type { SpotTemplateBucket, StackDepthBucket } from './types';

export const TIER_1 = new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo']);
export const TIER_2 = new Set(['AQs', 'AQo', 'AJs', 'KQs', 'KQo']);
export const TIER_3 = new Set(['ATs', 'KJs', 'QJs', 'JTs', 'T9s']);
export const TIER_4 = new Set([
    'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    '98s', '87s', '76s', '65s', '54s',
]);
export const TIER_5 = new Set([
    '66', '55', '44', '33', '22', 'KJo', 'QJo',
]);

interface TierWeights {
    tier1: number;
    tier2: number;
    tier3: number;
    tier4: number;
    tier5: number;
    base: number;
}

function getTierWeights(spot: SpotTemplateBucket, stack: StackDepthBucket): TierWeights {
    const is3BP = spot.startsWith('3BP') || spot.startsWith('4BP');
    const isIP = spot.endsWith('_IP');

    if (is3BP) {
        return { tier1: 10, tier2: 6, tier3: 3, tier4: 1, tier5: 0.5, base: 0 };
    }
    if (stack === 'SHORT') {
        return { tier1: 10, tier2: 7, tier3: 4, tier4: 2, tier5: 1, base: 0 };
    }
    if (isIP) {
        return { tier1: 8, tier2: 6, tier3: 5, tier4: 3, tier5: 2, base: 0 };
    }
    return { tier1: 9, tier2: 6, tier3: 4, tier4: 2, tier5: 1, base: 0 };
}

function getHandTierWeight(hand: string, weights: TierWeights): number {
    if (TIER_1.has(hand)) return weights.tier1;
    if (TIER_2.has(hand)) return weights.tier2;
    if (TIER_3.has(hand)) return weights.tier3;
    if (TIER_4.has(hand)) return weights.tier4;
    if (TIER_5.has(hand)) return weights.tier5;
    return weights.base;
}

export class PreflopRangeTemplates {
    /** Get the tier rank of a hand (1-5, or 6 for trash). */
    static getTier(hand: string): number {
        if (TIER_1.has(hand)) return 1;
        if (TIER_2.has(hand)) return 2;
        if (TIER_3.has(hand)) return 3;
        if (TIER_4.has(hand)) return 4;
        if (TIER_5.has(hand)) return 5;
        return 6;
    }

    /** Get deterministic preflop template weight for a specific hand class. */
    static getTemplateWeight(
        hand: string,
        spot: SpotTemplateBucket,
        stack: StackDepthBucket
    ): number {
        const weights = getTierWeights(spot, stack);
        return getHandTierWeight(hand, weights);
    }

    /** Get maximum template weight among all hand classes for this spot/stack. */
    static getMaxTemplateWeight(
        spot: SpotTemplateBucket,
        stack: StackDepthBucket
    ): number {
        const weights = getTierWeights(spot, stack);
        return Math.max(
            weights.tier1,
            weights.tier2,
            weights.tier3,
            weights.tier4,
            weights.tier5,
            weights.base
        );
    }

    /**
     * Get a deterministic preflop range template.
     * Returns a normalized RangeState.
     */
    static getTemplate(spot: SpotTemplateBucket, stack: StackDepthBucket): RangeState {
        const hands = HandClassGenerator.generateAll();
        const weights = getTierWeights(spot, stack);
        const rawMap = new Map<string, number>();

        for (const hand of hands) {
            const weight = getHandTierWeight(hand, weights);
            rawMap.set(hand, weight);
        }

        return RangeMath.normalize(rawMap);
    }
}
