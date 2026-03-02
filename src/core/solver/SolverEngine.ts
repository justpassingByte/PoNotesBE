/**
 * SolverEngine — High-Level Orchestrator
 *
 * Coordinates range initialization, strategy computation, and tree expansion.
 * Single entry point for solver-style operations.
 */

import { GameNode } from './GameNode';
import { NodeStrategyAdapter } from './NodeStrategyAdapter';
import { RangeFilterEngine } from './RangeFilterEngine';
import { RangeInitializer } from './RangeInitializer';
import { RangeMath } from './RangeMath';
import { StreetAdvancer } from './StreetAdvancer';
import type {
    SpotTemplateBucket,
    StackDepthBucket,
    Street,
    PotStateBucket,
    BoardTextureBucket,
} from './types';
import type { StreetTransitionConfig } from './types';
import type { GameNodeChildren } from './GameNode';

export interface SolverConfig {
    readonly spot: SpotTemplateBucket;
    readonly stack: StackDepthBucket;
    readonly street: Street;
    readonly potState: PotStateBucket;
    readonly boardContext?: BoardTextureBucket;
}

export class SolverEngine {
    /** Initialize a root GameNode with a preflop range. */
    static initRoot(config: SolverConfig): GameNode {
        const range = RangeInitializer.init(config.spot, config.stack);
        const rawFiltered = RangeFilterEngine.applyBoard(range, config.boardContext);
        const filteredRange = RangeMath.normalize(rawFiltered);

        return new GameNode({
            range: filteredRange,
            street: config.street,
            spotTemplate: config.spot,
            stackDepth: config.stack,
            potState: config.potState,
            boardContext: config.boardContext,
        });
    }

    /** Expand a node: compute strategy via adapter, then split range. */
    static expandNode(node: GameNode): GameNodeChildren {
        const freqs = NodeStrategyAdapter.computeStrategy(node);
        return node.expand(freqs);
    }

    /** Full solve step: init root → compute strategy → expand. */
    static solveStep(config: SolverConfig): GameNode {
        const root = this.initRoot(config);
        this.expandNode(root);
        return root;
    }

    /**
     * Advance a node's selected branch to the next street, then expand.
     * Combines StreetAdvancer.advance() + SolverEngine.expandNode().
     */
    static advanceAndExpand(
        node: GameNode,
        config: StreetTransitionConfig
    ): GameNode {
        const advanced = StreetAdvancer.advance(node, config);
        this.expandNode(advanced);
        return advanced;
    }
}
