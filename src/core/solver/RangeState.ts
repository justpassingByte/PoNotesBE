/**
 * RangeState — Immutable, Validated 169-Element Range
 *
 * Wraps a ReadonlyMap<string, number> ensuring:
 * - Exactly 169 canonical hand class keys
 * - No negative values
 * - Sum is exactly 100.0000 or 0.0000 (zero-weight)
 * - Immutable after creation
 */

import { HandClassGenerator } from './HandClassGenerator';
import { HAND_CLASS_COUNT } from './types';

export class RangeState {
    private readonly _data: ReadonlyMap<string, number>;

    constructor(data: ReadonlyMap<string, number>) {
        if (data.size !== HAND_CLASS_COUNT) {
            throw new Error(
                `RangeState must contain exactly ${HAND_CLASS_COUNT} keys, got ${data.size}`
            );
        }

        const canonicalHands = HandClassGenerator.generateAll();
        let sum = 0;

        for (const hand of canonicalHands) {
            if (!data.has(hand)) {
                throw new Error(`RangeState missing canonical hand class: ${hand}`);
            }
            const value = data.get(hand)!;
            if (value < 0) {
                throw new Error(`RangeState contains negative value for ${hand}: ${value}`);
            }
            sum += value;
        }

        // Allow sum === 0 (zero-weight) or sum === 100 (normalized)
        if (Math.abs(sum - 100) > 1e-8 && Math.abs(sum) > 1e-8) {
            throw new Error(
                `RangeState sum must be exactly 100.0000 or 0.0000, got ${sum}`
            );
        }

        this._data = new Map(data);
    }

    /** Get frequency for a hand class. */
    get(hand: string): number {
        const value = this._data.get(hand);
        if (value === undefined) {
            throw new Error(`Unknown hand class: ${hand}`);
        }
        return value;
    }

    /** Iterate over all hand/frequency pairs. */
    entries(): IterableIterator<[string, number]> {
        return this._data.entries();
    }

    /** Get the underlying data as a new Map (safe copy). */
    toMap(): Map<string, number> {
        return new Map(this._data);
    }

    /** Get the number of hand classes (always 169). */
    get size(): number {
        return this._data.size;
    }

    /** Check if this is a zero-weight range. */
    get isZero(): boolean {
        for (const v of this._data.values()) {
            if (v !== 0) return false;
        }
        return true;
    }
}
