import { RangeFilterEngine } from '../RangeFilterEngine';
import { RangeMath } from '../RangeMath';
import { HandClassGenerator } from '../HandClassGenerator';
import type { BoardTextureBucket } from '../types';

/** Helper: create a normalized equal-weight range. */
function makeNormalizedRange() {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (const hand of hands) {
        map.set(hand, 1);
    }
    return RangeMath.normalize(map);
}

describe('RangeFilterEngine', () => {
    it('preflop context returns raw Map with 169 keys (pass-through)', () => {
        const range = makeNormalizedRange();
        const filtered = RangeFilterEngine.applyBoard(range);
        expect(filtered).toBeInstanceOf(Map);
        expect(filtered.size).toBe(169);
    });

    it('preflop with explicit undefined returns raw Map', () => {
        const range = makeNormalizedRange();
        const filtered = RangeFilterEngine.applyBoard(range, undefined);
        expect(filtered).toBeInstanceOf(Map);
        expect(filtered.size).toBe(169);
    });

    it('does NOT normalize — returns raw weights that can be normalized by caller', () => {
        const range = makeNormalizedRange();
        const board: BoardTextureBucket = {
            highCardTier: 'ACE_HIGH',
            pairedStatus: 'UNPAIRED',
            suitedness: 'RAINBOW',
            connectivity: 'DISCONNECTED',
        };
        const rawMap = RangeFilterEngine.applyBoard(range, board);
        expect(rawMap).toBeInstanceOf(Map);
        expect(rawMap.size).toBe(169);

        // Caller normalizes
        const normalized = RangeMath.normalize(rawMap);
        expect(normalized.size).toBe(169);
        let sum = 0;
        for (const [, v] of normalized.entries()) {
            sum += v;
        }
        expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
    });

    it('returns a safe copy — mutating returned map does not affect original range', () => {
        const range = makeNormalizedRange();
        const rawMap = RangeFilterEngine.applyBoard(range);
        rawMap.set('AA', 999);
        expect(range.get('AA')).not.toBe(999);
    });
});
