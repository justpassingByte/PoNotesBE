import { GtoBaselineResolver } from '../GtoBaselineResolver';
import { BaselineContext } from '../types';
import { BoardTextureBucket } from '../context/types';
import { RangeInitializer } from '../../../core/solver/RangeInitializer';

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

    describe('3BP/4BP spot effects', () => {
        it('should differ between SRP_IP and 3BP_IP', () => {
            const srpIp = GtoBaselineResolver.resolve(makeContext({ street: 'preflop', spot_template: 'SRP_IP', board_texture: null } as any));
            const threeBetIp = GtoBaselineResolver.resolve(makeContext({ street: 'preflop', spot_template: '3BP_IP', board_texture: null } as any));

            expect(threeBetIp.raise_pct).toBeGreaterThan(srpIp.raise_pct);
            expect(threeBetIp.call_pct).toBeLessThan(srpIp.call_pct);
        });

        it('should differ between SRP_OOP and 3BP_OOP', () => {
            const srpOop = GtoBaselineResolver.resolve(makeContext({ street: 'preflop', spot_template: 'SRP_OOP', board_texture: null } as any));
            const threeBetOop = GtoBaselineResolver.resolve(makeContext({ street: 'preflop', spot_template: '3BP_OOP', board_texture: null } as any));

            expect(threeBetOop.raise_pct).toBeGreaterThan(srpOop.raise_pct);
            expect(threeBetOop.call_pct).toBeLessThan(srpOop.call_pct);
        });
    });

    describe('Board texture effects', () => {
        it('should be less aggressive on monotone boards', () => {
            const rainbow = GtoBaselineResolver.resolve(makeContext({ board_texture: makeBoard({ suitedness: 'RAINBOW' }) }));
            const mono = GtoBaselineResolver.resolve(makeContext({ board_texture: makeBoard({ suitedness: 'MONOTONE' }) }));
            expect(mono.raise_pct).toBeLessThan(rainbow.raise_pct);
        });

        it('should be more aggressive on connected boards than disconnected boards', () => {
            const disconnected = GtoBaselineResolver.resolve(
                makeContext({ board_texture: makeBoard({ suitedness: 'TWO_TONE', connectivity: 'DISCONNECTED' }) })
            );
            const connected = GtoBaselineResolver.resolve(
                makeContext({ board_texture: makeBoard({ suitedness: 'TWO_TONE', connectivity: 'CONNECTED' }) })
            );
            expect(connected.raise_pct).toBeGreaterThan(disconnected.raise_pct);
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

    // ── Task 4.1: Tier-based resolvePerHand tests ────────────────

    describe('resolvePerHand — Preflop', () => {
        const preflopCtx = makeContext({
            street: 'preflop',
            spot_template: 'SRP_IP',
            villain_bet: 'HALF',
            board_texture: null,
        } as any);
        const range = RangeInitializer.init('SRP_IP', 'DEEP');

        it('should return 169 entries', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            expect(result.size).toBe(169);
        });

        it('all per-hand frequencies should sum to 100', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            for (const [, freq] of result) {
                expect(freq.raise_pct + freq.call_pct + freq.fold_pct).toBe(100);
            }
        });

        it('should be deterministic', () => {
            const r1 = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const r2 = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            for (const [hand, freq1] of r1) {
                expect(freq1).toEqual(r2.get(hand));
            }
        });

        it('AA (Tier 1) should have higher raise_pct than 72o (Tier 6)', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const aa = result.get('AA')!;
            const trash = result.get('72o')!;
            expect(aa.raise_pct).toBeGreaterThan(trash.raise_pct);
        });

        it('AA (Tier 1) raise_pct >= 65%', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const aa = result.get('AA')!;
            expect(aa.raise_pct).toBeGreaterThanOrEqual(65);
        });

        it('72o (Tier 6) fold_pct >= 60%', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const trash = result.get('72o')!;
            expect(trash.fold_pct).toBeGreaterThanOrEqual(60);
        });

        it('Tier 1 hands should raise more than Tier 5 hands', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const tier1 = result.get('AA')!;
            const tier5 = result.get('44')!;
            expect(tier1.raise_pct).toBeGreaterThan(tier5.raise_pct);
        });

        it('hands outside template boundary remain pure folds', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const a8o = result.get('A8o')!;
            expect(a8o.raise_pct).toBe(0);
            expect(a8o.call_pct).toBe(0);
            expect(a8o.fold_pct).toBe(100);
        });

        it('caps preflop call_pct to 35', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            for (const [, freq] of result) {
                expect(freq.call_pct).toBeLessThanOrEqual(35);
            }
        });

        it('captures strength-aware ordering: A5s > A8o', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            expect(result.get('A5s')!.raise_pct).toBeGreaterThan(result.get('A8o')!.raise_pct);
        });

        it('captures strength-aware ordering: T9s > J7s', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            expect(result.get('T9s')!.raise_pct).toBeGreaterThan(result.get('J7s')!.raise_pct);
        });

        it('captures strength-aware ordering: KQo > K9o', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            expect(result.get('KQo')!.raise_pct).toBeGreaterThan(result.get('K9o')!.raise_pct);
        });

        it('locks premium fold to 0 in SRP preflop', () => {
            const result = GtoBaselineResolver.resolvePerHand(preflopCtx, range);
            const aa = result.get('AA')!;
            expect(aa.fold_pct).toBe(0);
            expect(aa.raise_pct + aa.call_pct + aa.fold_pct).toBe(100);
        });

        it('locks premium fold to 0 in 3BP preflop as well', () => {
            const threeBetCtx = makeContext({
                street: 'preflop',
                spot_template: '3BP_IP',
                villain_bet: 'HALF',
                board_texture: null,
            } as any);
            const result = GtoBaselineResolver.resolvePerHand(threeBetCtx, range);
            const aa = result.get('AA')!;
            const aks = result.get('AKs')!;
            expect(aa.fold_pct).toBe(0);
            expect(aks.fold_pct).toBe(0);
        });
    });

    describe('resolvePerHand — Postflop (Flop)', () => {
        const flopBoard = makeBoard({ highCardTier: 'ACE_HIGH' });
        const flopCtx = makeContext({
            street: 'flop',
            board_texture: flopBoard,
            spot_template: 'SRP_IP',
            villain_bet: 'HALF',
        });
        const range = RangeInitializer.init('SRP_IP', 'DEEP');

        it('should return 169 entries', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            expect(result.size).toBe(169);
        });

        it('all per-hand frequencies should sum to 100', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            for (const [, freq] of result) {
                expect(freq.raise_pct + freq.call_pct + freq.fold_pct).toBe(100);
            }
        });

        it('AA (NUTS: set on ACE_HIGH) should raise more than 72o (TRASH)', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            const aa = result.get('AA')!;
            const trash = result.get('72o')!;
            expect(aa.raise_pct).toBeGreaterThan(trash.raise_pct);
        });

        it('AKs (STRONG) should raise more than 72o (TRASH)', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            const strong = result.get('AKs')!;
            const trash = result.get('72o')!;
            expect(strong.raise_pct).toBeGreaterThan(trash.raise_pct);
        });

        it('NUTS hands should raise more than MEDIUM hands', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            const nuts = result.get('AA')!;    // NUTS on ACE_HIGH
            const medium = result.get('88')!;  // MEDIUM (underpair)
            expect(nuts.raise_pct).toBeGreaterThan(medium.raise_pct);
        });

        it('TRASH hands should fold more than NUTS hands', () => {
            const result = GtoBaselineResolver.resolvePerHand(flopCtx, range);
            const nuts = result.get('AA')!;
            const trash = result.get('72o')!;
            expect(trash.fold_pct).toBeGreaterThan(nuts.fold_pct);
        });
    });

    describe('resolvePerHand — Postflop (Turn/River)', () => {
        const turnCtx = makeContext({
            street: 'turn',
            board_texture: makeBoard({ highCardTier: 'KING_HIGH' }),
            spot_template: 'SRP_IP',
            villain_bet: 'HALF',
        });
        const riverCtx = makeContext({
            street: 'river',
            board_texture: makeBoard({ highCardTier: 'KING_HIGH' }),
            spot_template: 'SRP_IP',
            villain_bet: 'HALF',
        });
        const range = RangeInitializer.init('SRP_IP', 'DEEP');

        it('Turn: KK (NUTS) should raise more than 72o (TRASH)', () => {
            const result = GtoBaselineResolver.resolvePerHand(turnCtx, range);
            const kk = result.get('KK')!;
            const trash = result.get('72o')!;
            expect(kk.raise_pct).toBeGreaterThan(trash.raise_pct);
        });

        it('River: KK (NUTS) should raise more than 72o (TRASH)', () => {
            const result = GtoBaselineResolver.resolvePerHand(riverCtx, range);
            const kk = result.get('KK')!;
            const trash = result.get('72o')!;
            expect(kk.raise_pct).toBeGreaterThan(trash.raise_pct);
        });

        it('Turn: all per-hand frequencies sum to 100', () => {
            const result = GtoBaselineResolver.resolvePerHand(turnCtx, range);
            for (const [, freq] of result) {
                expect(freq.raise_pct + freq.call_pct + freq.fold_pct).toBe(100);
            }
        });

        it('River: all per-hand frequencies sum to 100', () => {
            const result = GtoBaselineResolver.resolvePerHand(riverCtx, range);
            for (const [, freq] of result) {
                expect(freq.raise_pct + freq.call_pct + freq.fold_pct).toBe(100);
            }
        });
    });

    // ── Task 4.2: AA raises more than 72o across all streets ─────

    describe('AA vs 72o — balanced baseline across streets', () => {
        const streets = ['preflop', 'flop', 'turn', 'river'] as const;
        const range = RangeInitializer.init('SRP_IP', 'DEEP');

        for (const street of streets) {
            it(`${street}: AA should raise more than 72o`, () => {
                const ctx = makeContext({
                    street,
                    spot_template: 'SRP_IP',
                    villain_bet: 'HALF',
                    board_texture: street === 'preflop' ? null : makeBoard(),
                } as any);
                const result = GtoBaselineResolver.resolvePerHand(ctx, range);
                const aa = result.get('AA')!;
                const trash = result.get('72o')!;
                expect(aa.raise_pct).toBeGreaterThan(trash.raise_pct);
            });

            it(`${street}: 72o should fold more than AA`, () => {
                const ctx = makeContext({
                    street,
                    spot_template: 'SRP_IP',
                    villain_bet: 'HALF',
                    board_texture: street === 'preflop' ? null : makeBoard(),
                } as any);
                const result = GtoBaselineResolver.resolvePerHand(ctx, range);
                const aa = result.get('AA')!;
                const trash = result.get('72o')!;
                expect(trash.fold_pct).toBeGreaterThan(aa.fold_pct);
            });
        }
    });
});
