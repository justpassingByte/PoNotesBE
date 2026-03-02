import { RangeState } from '../RangeState';
import { HandClassGenerator } from '../HandClassGenerator';
import { RangeMath } from '../RangeMath';

/** Helper: create a valid normalized RangeState with equal weights. */
function makeEqualRange(): RangeState {
    const hands = HandClassGenerator.generateAll();
    const rawMap = new Map<string, number>();
    for (const hand of hands) {
        rawMap.set(hand, 1);
    }
    return RangeMath.normalize(rawMap);
}

/** Helper: create a zero-weight RangeState. */
function makeZeroRange(): RangeState {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (const hand of hands) {
        map.set(hand, 0);
    }
    return new RangeState(map);
}

describe('RangeState', () => {
    it('instantiates with exactly 169 keys summing to 100', () => {
        const range = makeEqualRange();
        expect(range.size).toBe(169);
    });

    it('throws when instantiated with < 169 keys', () => {
        const map = new Map<string, number>();
        map.set('AA', 100);
        expect(() => new RangeState(map)).toThrow('exactly 169');
    });

    it('throws when instantiated with > 169 keys', () => {
        const hands = HandClassGenerator.generateAll();
        const map = new Map<string, number>();
        for (const hand of hands) {
            map.set(hand, 100 / 169);
        }
        map.set('EXTRA', 0);
        expect(() => new RangeState(map)).toThrow('exactly 169');
    });

    it('throws when sum !== 100 and sum !== 0', () => {
        const hands = HandClassGenerator.generateAll();
        const map = new Map<string, number>();
        for (const hand of hands) {
            map.set(hand, 1); // sum = 169, not 100
        }
        expect(() => new RangeState(map)).toThrow('sum must be exactly');
    });

    it('throws when negative buckets are present', () => {
        const hands = HandClassGenerator.generateAll();
        const map = new Map<string, number>();
        for (const hand of hands) {
            map.set(hand, 100 / 169);
        }
        map.set('AA', -1);
        expect(() => new RangeState(map)).toThrow('negative value');
    });

    it('throws when a canonical key is missing', () => {
        const hands = HandClassGenerator.generateAll();
        const map = new Map<string, number>();
        for (const hand of hands) {
            map.set(hand, 100 / 169);
        }
        map.delete('AA');
        map.set('XX', 100 / 169);
        expect(() => new RangeState(map)).toThrow('missing canonical');
    });

    it('allows zero-weight RangeState (sum = 0)', () => {
        const range = makeZeroRange();
        expect(range.isZero).toBe(true);
        expect(range.size).toBe(169);
    });

    it('toMap returns a safe copy', () => {
        const range = makeEqualRange();
        const copy = range.toMap();
        copy.set('AA', 999);
        expect(range.get('AA')).not.toBe(999);
    });
});
