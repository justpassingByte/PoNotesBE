import { GtoBaselineResolver } from '../GtoBaselineResolver';
import { BaselineContext } from '../types';
import { BoardTextureBucket } from '../context/types';

// ── Test Fixture ────────────────────────────────────────────────

const makeBoard = (overrides?: Partial<BoardTextureBucket>): BoardTextureBucket => ({
    highCardTier: 'ACE_HIGH',
    pairedStatus: 'UNPAIRED',
    suitedness: 'RAINBOW',
    connectivity: 'DISCONNECTED',
    ...overrides,
});

const makeContext = (overrides?: Partial<BaselineContext>): BaselineContext => ({
    street: 'flop',
    stack_depth: 'DEEP',
    spot_template: 'SRP_IP',
    board_texture: makeBoard(),
    villain_bet: 'HALF',
    ...overrides,
} as BaselineContext);

// ── Tests ────────────────────────────────────────────────────────

describe('GtoBaselineResolver', () => {

    describe('Determinism', () => {
        it('should return identical results for identical inputs', () => {
            const ctx = makeContext();
            const r1 = GtoBaselineResolver.resolve(ctx);
            const r2 = GtoBaselineResolver.resolve(ctx);
            expect(r1).toEqual(r2);
        });
    });

    describe('Sum always equals 100', () => {
        const streets = ['preflop', 'flop', 'turn', 'river'] as const;
        const spots = ['SRP_IP', 'SRP_OOP', '3BP_IP', '3BP_OOP', 'LIMPED_IP'] as const;
        const bets = ['BLOCK', 'HALF', 'POT', 'OVERBET'] as const;

        for (const street of streets) {
            for (const spot of spots) {
                for (const bet of bets) {
                    it(`should sum to 100 for ${street}/${spot}/${bet}`, () => {
                        const ctx = makeContext({
                            street,
                            spot_template: spot,
                            villain_bet: bet,
                            board_texture: street === 'preflop' ? null : makeBoard(),
                        } as any);
                        const freq = GtoBaselineResolver.resolve(ctx);
                        expect(freq.raise_pct + freq.call_pct + freq.fold_pct).toBe(100);
                    });
                }
            }
        }
    });

    describe('Street differentiation', () => {
        it('should produce different baselines for different streets', () => {
            const preflop = GtoBaselineResolver.resolve(makeContext({ street: 'preflop', board_texture: null } as any));
            const river = GtoBaselineResolver.resolve(makeContext({ street: 'river' }));
            // River should fold more than preflop
            expect(river.fold_pct).toBeGreaterThan(preflop.fold_pct);
        });
    });

    describe('IP vs OOP', () => {
        it('should raise more IP than OOP', () => {
            const ip = GtoBaselineResolver.resolve(makeContext({ spot_template: 'SRP_IP' } as any));
            const oop = GtoBaselineResolver.resolve(makeContext({ spot_template: 'SRP_OOP' } as any));
            expect(ip.raise_pct).toBeGreaterThan(oop.raise_pct);
        });
    });

    describe('Board texture effects', () => {
        it('should be less aggressive on monotone boards', () => {
            const rainbow = GtoBaselineResolver.resolve(makeContext({ board_texture: makeBoard({ suitedness: 'RAINBOW' }) }));
            const mono = GtoBaselineResolver.resolve(makeContext({ board_texture: makeBoard({ suitedness: 'MONOTONE' }) }));
            expect(mono.raise_pct).toBeLessThan(rainbow.raise_pct);
        });
    });

    describe('normalize', () => {
        it('should clamp negative values', () => {
            const result = GtoBaselineResolver.normalize({ raise_pct: -10, call_pct: 80, fold_pct: 30 });
            expect(result.raise_pct).toBeGreaterThanOrEqual(0);
            expect(result.raise_pct + result.call_pct + result.fold_pct).toBe(100);
        });

        it('should handle all zeros', () => {
            const result = GtoBaselineResolver.normalize({ raise_pct: 0, call_pct: 0, fold_pct: 0 });
            expect(result.raise_pct + result.call_pct + result.fold_pct).toBe(100);
        });
    });
});
