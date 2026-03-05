import { PotStateEvolution } from '../PotStateEvolution';
import type { PotStateBucket, NodeAction, Street } from '../types';

describe('PotStateEvolution', () => {
    describe('raise escalation', () => {
        it('BLOCK → HALF', () => {
            expect(PotStateEvolution.evolve('BLOCK', 'raise')).toBe('HALF');
        });

        it('HALF → POT', () => {
            expect(PotStateEvolution.evolve('HALF', 'raise')).toBe('POT');
        });

        it('POT → OVERBET', () => {
            expect(PotStateEvolution.evolve('POT', 'raise')).toBe('OVERBET');
        });

        it('OVERBET → OVERBET (ceiling)', () => {
            expect(PotStateEvolution.evolve('OVERBET', 'raise')).toBe('OVERBET');
        });

        it('UNKNOWN → HALF', () => {
            expect(PotStateEvolution.evolve('UNKNOWN', 'raise')).toBe('HALF');
        });
    });

    describe('call keeps pot unchanged', () => {
        const buckets: PotStateBucket[] = ['BLOCK', 'HALF', 'POT', 'OVERBET', 'UNKNOWN'];
        for (const bucket of buckets) {
            it(`call preserves ${bucket}`, () => {
                expect(PotStateEvolution.evolve(bucket, 'call')).toBe(bucket);
            });
        }
    });

    describe('fold throws deterministic error', () => {
        it('throws on fold action', () => {
            expect(() => PotStateEvolution.evolve('HALF', 'fold'))
                .toThrow('fold branches are terminal');
        });
    });

    describe('pot bucket persists across street transitions', () => {
        it('raise at POT remains POT-evolved regardless of street context', () => {
            // Evolution depends only on action, not on street.
            // We call evolve with same pot + action, simulating different streets.
            const result1 = PotStateEvolution.evolve('POT', 'raise');
            const result2 = PotStateEvolution.evolve('POT', 'raise');
            expect(result1).toBe(result2);
            expect(result1).toBe('OVERBET');
        });

        it('street transition does NOT reset pot bucket (call preserves)', () => {
            // Simulate: preflop pot=HALF, call → flop still HALF
            const afterCall = PotStateEvolution.evolve('HALF', 'call');
            expect(afterCall).toBe('HALF');
            // No reset — HALF stays HALF
        });

        it('multi-step evolution is consistent', () => {
            let pot: PotStateBucket = 'BLOCK';
            pot = PotStateEvolution.evolve(pot, 'raise'); // BLOCK → HALF
            expect(pot).toBe('HALF');
            pot = PotStateEvolution.evolve(pot, 'call');   // HALF → HALF
            expect(pot).toBe('HALF');
            pot = PotStateEvolution.evolve(pot, 'raise'); // HALF → POT
            expect(pot).toBe('POT');
            pot = PotStateEvolution.evolve(pot, 'raise'); // POT → OVERBET
            expect(pot).toBe('OVERBET');
        });
    });

    describe('determinism', () => {
        it('all action × bucket combinations produce deterministic results', () => {
            const buckets: PotStateBucket[] = ['BLOCK', 'HALF', 'POT', 'OVERBET', 'UNKNOWN'];
            const actions: NodeAction[] = ['raise', 'call'];

            for (const bucket of buckets) {
                for (const action of actions) {
                    const r1 = PotStateEvolution.evolve(bucket, action);
                    const r2 = PotStateEvolution.evolve(bucket, action);
                    expect(r1).toBe(r2);
                }
            }
        });
    });
});
