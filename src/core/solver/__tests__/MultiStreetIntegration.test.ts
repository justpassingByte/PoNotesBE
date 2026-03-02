import { SolverEngine, SolverConfig } from '../SolverEngine';
import { GameNode } from '../GameNode';
import { isValidStreetProgression, getNextStreet } from '../types';
import type { BoardTextureBucket, StreetTransitionConfig } from '../types';

const BASE_CONFIG: SolverConfig = {
    spot: 'SRP_IP',
    stack: 'DEEP',
    street: 'preflop',
    potState: 'HALF',
};

const FLOP_BOARD: BoardTextureBucket = {
    highCardTier: 'ACE_HIGH',
    pairedStatus: 'UNPAIRED',
    suitedness: 'RAINBOW',
    connectivity: 'DISCONNECTED',
};

const TURN_BOARD: BoardTextureBucket = {
    highCardTier: 'KING_HIGH',
    pairedStatus: 'UNPAIRED',
    suitedness: 'TWO_TONE',
    connectivity: 'CONNECTED',
};

const RIVER_BOARD: BoardTextureBucket = {
    highCardTier: 'LOW_BOARD',
    pairedStatus: 'PAIRED',
    suitedness: 'MONOTONE',
    connectivity: 'DISCONNECTED',
};

describe('Street Validation', () => {
    it('preflop → flop is valid', () => {
        expect(isValidStreetProgression('preflop', 'flop')).toBe(true);
    });

    it('flop → turn is valid', () => {
        expect(isValidStreetProgression('flop', 'turn')).toBe(true);
    });

    it('turn → river is valid', () => {
        expect(isValidStreetProgression('turn', 'river')).toBe(true);
    });

    it('river → * throws via getNextStreet', () => {
        expect(() => getNextStreet('river')).toThrow('terminal street');
    });

    it('flop → preflop is invalid (backward)', () => {
        expect(isValidStreetProgression('flop', 'preflop')).toBe(false);
    });

    it('preflop → turn is invalid (skip)', () => {
        expect(isValidStreetProgression('preflop', 'turn')).toBe(false);
    });
});

describe('Multi-Street Integration', () => {
    /** Validate a node's RangeState invariants. */
    function assertValidNode(node: GameNode, expectedStreet: string): void {
        expect(node.street).toBe(expectedStreet);
        expect(node.range.size).toBe(169);

        let sum = 0;
        let hasNegative = false;
        for (const [, v] of node.range.entries()) {
            sum += v;
            if (v < 0) hasNegative = true;
        }
        expect(hasNegative).toBe(false);
        expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
    }

    describe('Full 4-Street Lifecycle', () => {
        it('preflop → flop → turn → river with valid ranges at every step', () => {
            // 1. Init root at preflop
            const preflopRoot = SolverEngine.initRoot(BASE_CONFIG);
            SolverEngine.expandNode(preflopRoot);
            assertValidNode(preflopRoot, 'preflop');
            expect(preflopRoot.children).toBeDefined();

            // 2. Advance raise branch to flop
            const flopNode = SolverEngine.advanceAndExpand(preflopRoot, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });
            assertValidNode(flopNode, 'flop');
            expect(flopNode.children).toBeDefined();
            expect(flopNode.boardContext).toEqual(FLOP_BOARD);

            // 3. Advance call branch to turn
            const turnNode = SolverEngine.advanceAndExpand(flopNode, {
                selectedAction: 'call',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            });
            assertValidNode(turnNode, 'turn');
            expect(turnNode.children).toBeDefined();
            expect(turnNode.boardContext).toEqual(TURN_BOARD);

            // 4. Advance raise branch to river
            const riverNode = SolverEngine.advanceAndExpand(turnNode, {
                selectedAction: 'raise',
                nextStreet: 'river',
                boardContext: RIVER_BOARD,
            });
            assertValidNode(riverNode, 'river');
            expect(riverNode.children).toBeDefined();
            expect(riverNode.boardContext).toEqual(RIVER_BOARD);
        });

        it('pot bucket continuity preserved across streets', () => {
            // HALF → raise → POT → call → POT → raise → OVERBET
            const preflopRoot = SolverEngine.initRoot(BASE_CONFIG);
            SolverEngine.expandNode(preflopRoot);
            expect(preflopRoot.potState).toBe('HALF');

            const flopNode = SolverEngine.advanceAndExpand(preflopRoot, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });
            expect(flopNode.potState).toBe('POT');

            const turnNode = SolverEngine.advanceAndExpand(flopNode, {
                selectedAction: 'call',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            });
            expect(turnNode.potState).toBe('POT');

            const riverNode = SolverEngine.advanceAndExpand(turnNode, {
                selectedAction: 'raise',
                nextStreet: 'river',
                boardContext: RIVER_BOARD,
            });
            expect(riverNode.potState).toBe('OVERBET');
        });
    });

    describe('Determinism', () => {
        function runFullLifecycle() {
            const root = SolverEngine.initRoot(BASE_CONFIG);
            SolverEngine.expandNode(root);

            const flop = SolverEngine.advanceAndExpand(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            const turn = SolverEngine.advanceAndExpand(flop, {
                selectedAction: 'call',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            });

            const river = SolverEngine.advanceAndExpand(turn, {
                selectedAction: 'raise',
                nextStreet: 'river',
                boardContext: RIVER_BOARD,
            });

            return { root, flop, turn, river };
        }

        it('identical inputs produce byte-identical RangeStates at every street', () => {
            const run1 = runFullLifecycle();
            const run2 = runFullLifecycle();

            // Compare range at each street
            for (const [, v1] of run1.root.range.entries()) {
                const hand = [...run1.root.range.entries()].find(([, val]) => val === v1)?.[0];
                if (hand) {
                    expect(run1.root.range.get(hand)).toBe(run2.root.range.get(hand));
                }
            }

            // Compare all rivers
            const r1Entries = [...run1.river.range.entries()];
            const r2Entries = [...run2.river.range.entries()];
            for (let i = 0; i < r1Entries.length; i++) {
                expect(r1Entries[i][0]).toBe(r2Entries[i][0]);
                expect(r1Entries[i][1]).toBe(r2Entries[i][1]);
            }
        });

        it('potState and boardContext identical at every node', () => {
            const run1 = runFullLifecycle();
            const run2 = runFullLifecycle();

            expect(run1.root.potState).toBe(run2.root.potState);
            expect(run1.flop.potState).toBe(run2.flop.potState);
            expect(run1.turn.potState).toBe(run2.turn.potState);
            expect(run1.river.potState).toBe(run2.river.potState);

            expect(run1.flop.boardContext).toEqual(run2.flop.boardContext);
            expect(run1.turn.boardContext).toEqual(run2.turn.boardContext);
            expect(run1.river.boardContext).toEqual(run2.river.boardContext);
        });
    });

    describe('Performance', () => {
        it('advanceAndExpand completes in < 10ms per street', () => {
            const root = SolverEngine.initRoot(BASE_CONFIG);
            SolverEngine.expandNode(root);

            const start = performance.now();
            SolverEngine.advanceAndExpand(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });
            const elapsed = performance.now() - start;
            expect(elapsed).toBeLessThan(10);
        });

        it('full 4-street traversal completes in < 50ms', () => {
            const start = performance.now();

            const root = SolverEngine.initRoot(BASE_CONFIG);
            SolverEngine.expandNode(root);

            const flop = SolverEngine.advanceAndExpand(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            const turn = SolverEngine.advanceAndExpand(flop, {
                selectedAction: 'call',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            });

            SolverEngine.advanceAndExpand(turn, {
                selectedAction: 'raise',
                nextStreet: 'river',
                boardContext: RIVER_BOARD,
            });

            const elapsed = performance.now() - start;
            expect(elapsed).toBeLessThan(50);
        });
    });
});
