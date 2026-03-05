/**
 * Strategic Layer — Unit Tests
 *
 * Tests for types, extractPosition, sub-modules (Phase 1 identity),
 * StrategicLayer orchestrator, and SolverEngine integration.
 */

import { HandClassGenerator } from '../../HandClassGenerator';
import { RangeInitializer } from '../../RangeInitializer';
import { RangeMath } from '../../RangeMath';
import { RangeState } from '../../RangeState';
import { SolverEngine, SolverConfig } from '../../SolverEngine';
import { PRECISION, HAND_CLASS_COUNT } from '../../types';
import { BucketIntelligence } from '../BucketIntelligence';
import { ExploitAdjuster } from '../ExploitAdjuster';
import { StrategicLayer } from '../StrategicLayer';
import { StrategicShaper } from '../StrategicShaper';
import { extractPosition } from '../types';
import type { StrategicContext } from '../types';

// Mock sub-modules to act as identity functions so StrategicLayer behavior can be tested in isolation
jest.mock('../BucketIntelligence', () => ({
    BucketIntelligence: {
        computeMultipliers: jest.fn().mockImplementation(() => {
            const { HandClassGenerator } = require('../../HandClassGenerator');
            const { PRECISION } = require('../../types');
            const result = new Map();
            for (const hand of HandClassGenerator.generateAll()) result.set(hand, PRECISION);
            return result;
        })
    }
}));
jest.mock('../StrategicShaper', () => ({
    StrategicShaper: {
        computeMultipliers: jest.fn().mockImplementation(() => {
            const { HandClassGenerator } = require('../../HandClassGenerator');
            const { PRECISION } = require('../../types');
            const result = new Map();
            for (const hand of HandClassGenerator.generateAll()) result.set(hand, PRECISION);
            return result;
        })
    }
}));
jest.mock('../ExploitAdjuster', () => ({
    ExploitAdjuster: {
        computeMultipliers: jest.fn().mockImplementation(() => {
            const { HandClassGenerator } = require('../../HandClassGenerator');
            const { PRECISION } = require('../../types');
            const result = new Map();
            for (const hand of HandClassGenerator.generateAll()) result.set(hand, PRECISION);
            return result;
        })
    }
}));

// ─── Helpers ────────────────────────────────────────────────────

function makeNormalizedRange(): RangeState {
    return RangeInitializer.init('SRP_IP', 'MEDIUM');
}

function makeIdentityContext(): StrategicContext {
    return {
        street: 'preflop',
        position: 'IP',
        shapingMode: 'balanced',
    };
}

// ─── extractPosition ────────────────────────────────────────────

describe('extractPosition', () => {
    it('returns IP for SRP_IP', () => {
        expect(extractPosition('SRP_IP')).toBe('IP');
    });

    it('returns OOP for SRP_OOP', () => {
        expect(extractPosition('SRP_OOP')).toBe('OOP');
    });

    it('returns IP for 3BP_IP', () => {
        expect(extractPosition('3BP_IP')).toBe('IP');
    });

    it('returns OOP for LIMPED_OOP', () => {
        expect(extractPosition('LIMPED_OOP')).toBe('OOP');
    });

    it('returns OOP for UNKNOWN (conservative default)', () => {
        expect(extractPosition('UNKNOWN')).toBe('OOP');
    });
});

// ─── RangeState.getInt() ─────────────────────────────────────────

describe('RangeState.getInt()', () => {
    it('returns PRECISION-scaled integer for a hand class', () => {
        const range = makeNormalizedRange();
        const hand = HandClassGenerator.generateAll()[0];
        const decimal = range.get(hand);
        const intVal = range.getInt(hand);
        expect(intVal).toBe(Math.round(decimal * PRECISION));
    });

    it('returns 0 for zero-weight hand classes', () => {
        const hands = HandClassGenerator.generateAll();
        const zeroMap = new Map<string, number>();
        for (const h of hands) zeroMap.set(h, 0);
        const zeroRange = new RangeState(zeroMap);
        expect(zeroRange.getInt(hands[0])).toBe(0);
    });

    it('throws for unknown hand class', () => {
        const range = makeNormalizedRange();
        expect(() => range.getInt('ZZ')).toThrow('Unknown hand class');
    });
});

// ─── BucketIntelligence (Phase 1 Identity) ──────────────────────

// ─── Sub-module tests removed: migrated to dedicated test files ────

// ─── StrategicLayer Orchestrator ─────────────────────────────────

describe('StrategicLayer', () => {
    it('returns exactly 169 keys', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(range, 'raise', ctx);
        expect(result.size).toBe(HAND_CLASS_COUNT);
    });

    it('identity context: output matches input integer weights', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(range, 'raise', ctx);
        const hands = HandClassGenerator.generateAll();
        for (const hand of hands) {
            expect(result.get(hand)).toBe(range.getInt(hand));
        }
    });

    it('returns integer-domain values (not divided by PRECISION)', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(range, 'raise', ctx);
        // Sum should be ~100 * PRECISION = 1000000 for identity
        let sum = 0;
        for (const [, val] of result) {
            sum += val;
            expect(Number.isInteger(val)).toBe(true);
        }
        expect(sum).toBe(100 * PRECISION);
    });

    it('all weights are non-negative', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(range, 'raise', ctx);
        for (const [, val] of result) {
            expect(val).toBeGreaterThanOrEqual(0);
        }
    });

    it('does NOT mutate input RangeState', () => {
        const range = makeNormalizedRange();
        const hands = HandClassGenerator.generateAll();
        const before = hands.map(h => range.get(h));
        const ctx = makeIdentityContext();
        StrategicLayer.apply(range, 'raise', ctx);
        const after = hands.map(h => range.get(h));
        expect(after).toEqual(before);
    });

    it('determinism: same inputs produce byte-identical output', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const r1 = StrategicLayer.apply(range, 'raise', ctx);
        const r2 = StrategicLayer.apply(range, 'raise', ctx);
        const hands = HandClassGenerator.generateAll();
        for (const hand of hands) {
            expect(r1.get(hand)).toBe(r2.get(hand));
        }
    });

    it('applies to all 3 branches: raise, call, fold each produce valid output', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        for (const action of ['raise', 'call', 'fold'] as const) {
            const result = StrategicLayer.apply(range, action, ctx);
            expect(result.size).toBe(HAND_CLASS_COUNT);
            for (const [, val] of result) {
                expect(val).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('output is compatible with RangeMath.normalize()', () => {
        const range = makeNormalizedRange();
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(range, 'raise', ctx);
        // Should not throw
        const normalized = RangeMath.normalize(result);
        expect(normalized.size).toBe(HAND_CLASS_COUNT);
    });

    it('zero-weight range returns all 169 keys with zero values', () => {
        const hands = HandClassGenerator.generateAll();
        const zeroMap = new Map<string, number>();
        for (const h of hands) zeroMap.set(h, 0);
        const zeroRange = new RangeState(zeroMap);
        const ctx = makeIdentityContext();
        const result = StrategicLayer.apply(zeroRange, 'raise', ctx);
        expect(result.size).toBe(HAND_CLASS_COUNT);
        for (const [, val] of result) {
            expect(val).toBe(0);
        }
    });
});

// ─── SolverEngine Integration ────────────────────────────────────

describe('SolverEngine with StrategicContext', () => {
    const config: SolverConfig = {
        spot: 'SRP_IP',
        stack: 'MEDIUM',
        street: 'preflop',
        potState: 'HALF',
    };

    it('expandNode without context: identical to baseline', () => {
        const root = SolverEngine.initRoot(config);
        const children = SolverEngine.expandNode(root);
        expect(children.raise.range.size).toBe(HAND_CLASS_COUNT);
        expect(children.call.range.size).toBe(HAND_CLASS_COUNT);
        expect(children.fold.range.size).toBe(HAND_CLASS_COUNT);
    });

    it('expandNode with identity context: produces valid children', () => {
        const root = SolverEngine.initRoot(config);
        const ctx = makeIdentityContext();
        const children = SolverEngine.expandNode(root, ctx);
        expect(children.raise.range.size).toBe(HAND_CLASS_COUNT);
        expect(children.call.range.size).toBe(HAND_CLASS_COUNT);
        expect(children.fold.range.size).toBe(HAND_CLASS_COUNT);
    });

    it('identity context produces valid but asymmetric output (per-hand baseline)', () => {
        const root1 = SolverEngine.initRoot(config);
        const root2 = SolverEngine.initRoot(config);
        const ctx = makeIdentityContext();

        const baseline = SolverEngine.expandNode(root1);
        const strategic = SolverEngine.expandNode(root2, ctx);

        // Both produce valid 169-key ranges; disabled branches can be zero-mass.
        const hands = HandClassGenerator.generateAll();
        for (const branch of ['raise', 'call', 'fold'] as const) {
            let sum = 0;
            for (const hand of hands) {
                const val = strategic[branch].range.get(hand);
                expect(val).toBeGreaterThanOrEqual(0);
                sum += val;
            }
            const isHundred = Math.abs(sum - 100) < 0.01;
            const isZero = Math.abs(sum) < 0.01;
            expect(isHundred || isZero).toBe(true);
        }

        // Strategic path should differ from baseline (per-hand frequencies break symmetry)
        let differenceCount = 0;
        for (const hand of hands) {
            if (Math.abs(strategic.raise.range.get(hand) - baseline.raise.range.get(hand)) > 0.01) {
                differenceCount++;
            }
        }
        expect(differenceCount).toBeGreaterThan(0);
    });

    it('all branches sum to 100 or 0 (disabled)', () => {
        const root = SolverEngine.initRoot(config);
        const ctx = makeIdentityContext();
        const children = SolverEngine.expandNode(root, ctx);

        for (const branch of [children.raise, children.call, children.fold]) {
            let sum = 0;
            for (const [, val] of branch.range.entries()) {
                sum += val;
            }
            const isHundred = Math.abs(sum - 100) < 0.001;
            const isZero = Math.abs(sum) < 0.001;
            expect(isHundred || isZero).toBe(true);
        }
    });

    it('performance: expandNode with strategic context < 10ms', () => {
        const root = SolverEngine.initRoot(config);
        const ctx = makeIdentityContext();
        const start = performance.now();
        SolverEngine.expandNode(root, ctx);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(10);
    });
});
