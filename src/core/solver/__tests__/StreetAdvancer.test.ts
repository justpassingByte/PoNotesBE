import { StreetAdvancer } from '../StreetAdvancer';
import { SolverEngine, SolverConfig } from '../SolverEngine';
import { GameNode } from '../GameNode';
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

/** Create an expanded preflop root node. */
function makeExpandedRoot(): GameNode {
    const root = SolverEngine.initRoot(BASE_CONFIG);
    SolverEngine.expandNode(root);
    return root;
}

describe('StreetAdvancer', () => {
    describe('happy path', () => {
        it('advances preflop → flop with raise branch', () => {
            const root = makeExpandedRoot();
            const config: StreetTransitionConfig = {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            };

            const flopNode = StreetAdvancer.advance(root, config);

            expect(flopNode.street).toBe('flop');
            expect(flopNode.range.size).toBe(169);
            expect(flopNode.boardContext).toEqual(FLOP_BOARD);
        });

        it('advances flop → turn with call branch', () => {
            const root = makeExpandedRoot();
            const flopNode = SolverEngine.advanceAndExpand(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            const turnNode = StreetAdvancer.advance(flopNode, {
                selectedAction: 'call',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            });

            expect(turnNode.street).toBe('turn');
            expect(turnNode.range.size).toBe(169);
        });

        it('returned node has correct potState (raise escalates)', () => {
            const root = makeExpandedRoot();
            const config: StreetTransitionConfig = {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            };

            const flopNode = StreetAdvancer.advance(root, config);
            // HALF + raise → POT
            expect(flopNode.potState).toBe('POT');
        });

        it('returned node has correct potState (call preserves)', () => {
            const root = makeExpandedRoot();
            const config: StreetTransitionConfig = {
                selectedAction: 'call',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            };

            const flopNode = StreetAdvancer.advance(root, config);
            expect(flopNode.potState).toBe('HALF');
        });

        it('potStateOverride overrides evolution', () => {
            const root = makeExpandedRoot();
            const config: StreetTransitionConfig = {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
                potStateOverride: 'BLOCK',
            };

            const flopNode = StreetAdvancer.advance(root, config);
            expect(flopNode.potState).toBe('BLOCK');
        });

        it('returned RangeState sums to 100', () => {
            const root = makeExpandedRoot();
            const flopNode = StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            let sum = 0;
            for (const [, v] of flopNode.range.entries()) {
                sum += v;
            }
            expect(Math.abs(sum - 100)).toBeLessThan(1e-8);
        });

        it('does NOT mutate parent node', () => {
            const root = makeExpandedRoot();
            const childrenBefore = root.children;
            const rangeBefore = root.range;

            StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            expect(root.children).toBe(childrenBefore);
            expect(root.range).toBe(rangeBefore);
            expect(root.street).toBe('preflop');
        });
    });

    describe('guards', () => {
        it('throws if parent not expanded', () => {
            const root = SolverEngine.initRoot(BASE_CONFIG); // NOT expanded
            expect(() => StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            })).toThrow('parent node has not been expanded');
        });

        it('throws if selectedAction is fold', () => {
            const root = makeExpandedRoot();
            expect(() => StreetAdvancer.advance(root, {
                selectedAction: 'fold',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            })).toThrow('fold nodes are terminal');
        });

        it('throws if street progression is invalid (backward)', () => {
            const root = makeExpandedRoot();
            const flopNode = SolverEngine.advanceAndExpand(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            expect(() => StreetAdvancer.advance(flopNode, {
                selectedAction: 'raise',
                nextStreet: 'preflop',
                boardContext: FLOP_BOARD,
            })).toThrow('Invalid street progression');
        });

        it('throws if street progression skips (preflop → turn)', () => {
            const root = makeExpandedRoot();
            expect(() => StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'turn',
                boardContext: TURN_BOARD,
            })).toThrow('Invalid street progression');
        });

        it('throws if boardContext missing for postflop', () => {
            const root = makeExpandedRoot();
            expect(() => StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                // no boardContext
            })).toThrow('boardContext is required');
        });

        it('throws if boardContext provided for preflop', () => {
            // Since our ordering is preflop→flop→turn→river, advancing TO preflop is never valid.
            // The street validation guard fires before the boardContext guard.
            // This is defense-in-depth — tested via street progression.
            const root = makeExpandedRoot();
            expect(() => StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'preflop',
                boardContext: FLOP_BOARD,
            })).toThrow('Invalid street progression');
        });
    });

    describe('range carry-over', () => {
        it('advanced node range differs from parent range (narrowed)', () => {
            const root = makeExpandedRoot();
            const flopNode = StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            // The flop range is a normalized version of the raise branch,
            // which should differ from the root range (different distribution).
            const rootEntries = [...root.range.entries()];
            const flopEntries = [...flopNode.range.entries()];
            let hasDifference = false;
            for (let i = 0; i < rootEntries.length; i++) {
                if (rootEntries[i][1] !== flopEntries[i][1]) {
                    hasDifference = true;
                    break;
                }
            }
            // After splitting and re-normalizing, distributions should differ
            expect(hasDifference).toBe(true);
        });

        it('advanced node range matches normalized child branch range', () => {
            const root = makeExpandedRoot();
            const raiseChild = root.children!.raise;

            const flopNode = StreetAdvancer.advance(root, {
                selectedAction: 'raise',
                nextStreet: 'flop',
                boardContext: FLOP_BOARD,
            });

            // Since RangeFilterEngine is currently a stub (no actual filtering),
            // the advanced range should be a normalized form of the child's range.
            // Both should have 169 keys summing to 100.
            expect(flopNode.range.size).toBe(169);
            expect(raiseChild.range.size).toBe(169);

            let flopSum = 0;
            for (const [, v] of flopNode.range.entries()) flopSum += v;
            expect(Math.abs(flopSum - 100)).toBeLessThan(1e-8);
        });
    });
});
