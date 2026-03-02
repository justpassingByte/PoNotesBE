/**
 * StreetAdvancer — Branch → Next Street Progression
 *
 * Orchestrates selecting a branch, carrying the narrowed RangeState,
 * applying board filtering, normalizing, evolving pot state, and
 * creating a new immutable GameNode for the next street.
 *
 * Execution order (NO reordering allowed):
 *   1) Validate parent expanded
 *   2) Validate selectedAction !== 'fold'
 *   3) Validate street progression
 *   4) Validate boardContext rules
 *   5) Select child branch
 *   6) Extract narrowed RangeState
 *   7) Apply RangeFilterEngine.applyBoard()
 *   8) Normalize via RangeMath.normalize()
 *   9) Compute potState (override or evolve)
 *  10) Create and return new immutable GameNode
 */

import { GameNode } from './GameNode';
import { PotStateEvolution } from './PotStateEvolution';
import { RangeFilterEngine } from './RangeFilterEngine';
import { RangeMath } from './RangeMath';
import { isValidStreetProgression } from './types';
import type { StreetTransitionConfig } from './types';

export class StreetAdvancer {
    /**
     * Advance a parent node's selected branch to the next street.
     *
     * Note:
     * Advanced nodes are intentionally created without parent/actionTaken references.
     * Multi-street progression creates independent solver states.
     * This prevents circular references and memory growth in long traversals.
     *
     * @throws if parent not expanded, fold selected, invalid street, or boardContext rules violated
     */
    static advance(parentNode: GameNode, config: StreetTransitionConfig): GameNode {
        // Step 1: Validate parent is expanded
        if (!parentNode.children) {
            throw new Error('Cannot advance: parent node has not been expanded');
        }

        // Step 2: Validate selectedAction !== 'fold'
        if (config.selectedAction === 'fold') {
            throw new Error('Cannot advance fold branch: fold nodes are terminal');
        }

        // Step 3: Validate street progression
        if (!isValidStreetProgression(parentNode.street, config.nextStreet)) {
            throw new Error(
                `Invalid street progression: ${parentNode.street} → ${config.nextStreet}`
            );
        }

        // Step 4: Validate boardContext rules
        if (config.nextStreet !== 'preflop' && !config.boardContext) {
            throw new Error(
                `boardContext is required when advancing to ${config.nextStreet}`
            );
        }
        if (config.nextStreet === 'preflop' && config.boardContext) {
            throw new Error('boardContext is forbidden when advancing to preflop');
        }

        // Step 5: Select child branch
        const selectedChild = parentNode.children[config.selectedAction];
        if (!selectedChild) {
            throw new Error(
                `Selected child branch '${config.selectedAction}' does not exist`
            );
        }

        // Step 6: Extract narrowed RangeState
        const narrowedRange = selectedChild.range;

        // Step 7: Apply RangeFilterEngine.applyBoard() — returns raw Map
        const rawFiltered = RangeFilterEngine.applyBoard(narrowedRange, config.boardContext);

        // Step 8: Normalize via RangeMath.normalize()
        const normalizedRange = RangeMath.normalize(rawFiltered);

        // Step 9: Compute potState
        const newPotState = config.potStateOverride
            ?? PotStateEvolution.evolve(parentNode.potState, config.selectedAction);

        // Step 10: Create and return new immutable GameNode
        return new GameNode({
            range: normalizedRange,
            street: config.nextStreet,
            spotTemplate: parentNode.spotTemplate,
            stackDepth: parentNode.stackDepth,
            potState: newPotState,
            boardContext: config.boardContext,
        });
    }
}
