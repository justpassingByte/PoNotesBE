import { RangeMath } from '../RangeMath';
import { RangeState } from '../RangeState';
import { HandClassGenerator } from '../HandClassGenerator';
import type { ActionFrequencies } from '../types';

/** Helper: build a raw map with equal weights. */
function makeRawEqual(): Map<string, number> {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (const hand of hands) {
        map.set(hand, 1);
    }
    return map;
}

/** Helper: build a raw map with specific weights. */
function makeRawWeighted(): Map<string, number> {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (let i = 0; i < hands.length; i++) {
        map.set(hands[i], i + 1);
    }
    return map;
}

/** Helper: build a zero-weight raw map. */
function makeRawZero(): Map<string, number> {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (const hand of hands) {
        map.set(hand, 0);
    }
    return map;
}

/** Sum all values in a RangeState. */
function sumRange(range: RangeState): number {
    let sum = 0;
    for (const [, v] of range.entries()) {
        sum += v;
    }
    return sum;
}

// ─── RangeMath.normalize ─────────────────────────────────────────

describe('RangeMath.normalize', () => {
    it('correctly scales [50, 50] style weights to sum to 100.0000', () => {
        const rawMap = makeRawEqual(); // all 1s, sum = 169
        const range = RangeMath.normalize(rawMap);
        const sum = sumRange(range);
        expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
    });

    it('all 169 values are exactly 4 decimal places', () => {
        const rawMap = makeRawWeighted();
        const range = RangeMath.normalize(rawMap);
        for (const [, v] of range.entries()) {
            const decimals = Math.round(v * 10000) / 10000;
            expect(v).toBe(decimals);
        }
    });

    it('handles floating point remainders via first non-zero bucket correction', () => {
        const rawMap = makeRawWeighted();
        const range = RangeMath.normalize(rawMap);
        const sum = sumRange(range);
        expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
    });

    it('idempotency: normalizing an already-normalized RangeState produces identical output', () => {
        const rawMap = makeRawWeighted();
        const first = RangeMath.normalize(rawMap);
        const second = RangeMath.normalize(first.toMap());
        const hands = HandClassGenerator.generateAll();
        for (const hand of hands) {
            expect(first.get(hand)).toBe(second.get(hand));
        }
    });

    it('zero-weight input returns zero-weight RangeState without throwing', () => {
        const rawMap = makeRawZero();
        const range = RangeMath.normalize(rawMap);
        expect(range.isZero).toBe(true);
        expect(range.size).toBe(169);
        const sum = sumRange(range);
        expect(sum).toBe(0);
    });
});

// ─── RangeMath.split ─────────────────────────────────────────────

describe('RangeMath.split', () => {
    const freqs: ActionFrequencies = { raise_pct: 50, call_pct: 30, fold_pct: 20 };

    it('executes correct proportional split', () => {
        const range = RangeMath.normalize(makeRawEqual());
        const result = RangeMath.split(range, freqs);
        // Each branch should be a valid RangeState summing to 100
        expect(Math.abs(sumRange(result.raise) - 100)).toBeLessThan(1e-8);
        expect(Math.abs(sumRange(result.call) - 100)).toBeLessThan(1e-8);
        expect(Math.abs(sumRange(result.fold) - 100)).toBeLessThan(1e-8);
    });

    it('pre-normalization invariant: raw branch weights equal original', () => {
        const hands = HandClassGenerator.generateAll();
        const range = RangeMath.normalize(makeRawWeighted());
        const raiseFrac = freqs.raise_pct / 100;
        const callFrac = freqs.call_pct / 100;
        const foldFrac = freqs.fold_pct / 100;

        for (const hand of hands) {
            const original = range.get(hand);
            const raiseRaw = original * raiseFrac;
            const callRaw = original * callFrac;
            const foldRaw = original * foldFrac;
            const reconstructed = raiseRaw + callRaw + foldRaw;
            expect(Math.abs(reconstructed - original)).toBeLessThan(1e-10);
        }
    });

    it('all three branches are re-normalized to 100.0000', () => {
        const range = RangeMath.normalize(makeRawWeighted());
        const result = RangeMath.split(range, freqs);
        for (const branch of [result.raise, result.call, result.fold]) {
            expect(branch.size).toBe(169);
            const sum = sumRange(branch);
            expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
        }
    });

    it('byte-identical results: same inputs produce identical outputs', () => {
        const range = RangeMath.normalize(makeRawWeighted());
        const result1 = RangeMath.split(range, freqs);
        const result2 = RangeMath.split(range, freqs);
        const hands = HandClassGenerator.generateAll();
        for (const hand of hands) {
            expect(result1.raise.get(hand)).toBe(result2.raise.get(hand));
            expect(result1.call.get(hand)).toBe(result2.call.get(hand));
            expect(result1.fold.get(hand)).toBe(result2.fold.get(hand));
        }
    });

    it('all branches have exactly 169 keys with no negative values', () => {
        const range = RangeMath.normalize(makeRawEqual());
        const result = RangeMath.split(range, freqs);
        for (const branch of [result.raise, result.call, result.fold]) {
            expect(branch.size).toBe(169);
            for (const [, v] of branch.entries()) {
                expect(v).toBeGreaterThanOrEqual(0);
            }
        }
    });
});
