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

const TIER_1 = new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']);
const TIER_2 = new Set(['TT', '99', 'AQs', 'AQo', 'AJs', 'KQs']);
const TIER_3 = new Set(['88', '77', 'ATs', 'A9s', 'KJs', 'KTs', 'QJs', 'KQo', 'AJo']);
const TIER_4 = new Set([
    '66', '55', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    'K9s', 'Q9s', 'QTs', 'JTs', 'KJo', 'QJo', 'ATo',
]);
const TIER_5 = new Set([
    '44', '33', '22', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
    'Q8s', 'J9s', 'T9s', '98s', '87s', '76s', '65s', '54s',
    'KTo', 'QTo', 'JTo',
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
        return { tier1: 10, tier2: 6, tier3: 3, tier4: 1, tier5: 0.5, base: 0.1 };
    }
    if (stack === 'SHORT') {
        return { tier1: 10, tier2: 7, tier3: 4, tier4: 2, tier5: 1, base: 0.2 };
    }
    if (isIP) {
        return { tier1: 8, tier2: 6, tier3: 5, tier4: 3, tier5: 2, base: 0.5 };
    }
    return { tier1: 9, tier2: 6, tier3: 4, tier4: 2, tier5: 1, base: 0.3 };
}

export class PreflopRangeTemplates {
    /**
     * Get a deterministic preflop range template.
     * Returns a normalized RangeState.
     */
    static getTemplate(spot: SpotTemplateBucket, stack: StackDepthBucket): RangeState {
        const hands = HandClassGenerator.generateAll();
        const weights = getTierWeights(spot, stack);
        const rawMap = new Map<string, number>();

        for (const hand of hands) {
            let weight: number;
            if (TIER_1.has(hand)) weight = weights.tier1;
            else if (TIER_2.has(hand)) weight = weights.tier2;
            else if (TIER_3.has(hand)) weight = weights.tier3;
            else if (TIER_4.has(hand)) weight = weights.tier4;
            else if (TIER_5.has(hand)) weight = weights.tier5;
            else weight = weights.base;
            rawMap.set(hand, weight);
        }

        return RangeMath.normalize(rawMap);
    }
}
