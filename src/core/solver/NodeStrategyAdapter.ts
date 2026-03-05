/**
 * NodeStrategyAdapter — GameNode → BaselineContext → GtoBaselineResolver
 *
 * Maps GameNode structural state to BaselineContext and calls GtoBaselineResolver.
 * One-way dependency: Solver → Exploit, never the reverse.
 */

import { GtoBaselineResolver } from '../../services/analysis/GtoBaselineResolver';
import { GameNode } from './GameNode';
import type { ActionFrequencies, BaselineContext } from './types';

export class NodeStrategyAdapter {
    /**
     * Compute action frequencies for a GameNode.
     * Maps node state → BaselineContext → GtoBaselineResolver.resolve().
     */
    static computeStrategy(node: GameNode): ActionFrequencies {
        const context: BaselineContext = {
            street: node.street,
            spot_template: node.spotTemplate,
            board_texture: node.boardContext ?? null,
            villain_bet: node.potState,
            stack_depth: node.stackDepth,
        };

        return GtoBaselineResolver.resolve(context);
    }
}
