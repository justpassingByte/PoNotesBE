/**
 * GameNode — Decision Point in the Game Tree
 *
 * Holds RangeState and structural metadata at a specific decision point.
 * Immutable after creation. Delegates all math to RangeMath.
 * Only creates child nodes from returned RangeStates.
 */

import { RangeMath } from './RangeMath';
import { RangeState } from './RangeState';
import type {
    NodeAction,
    Street,
    BoardTextureBucket,
    ActionFrequencies,
    SpotTemplateBucket,
    StackDepthBucket,
    PotStateBucket,
} from './types';

export interface GameNodeConfig {
    readonly range: RangeState;
    readonly street: Street;
    readonly spotTemplate: SpotTemplateBucket;
    readonly stackDepth: StackDepthBucket;
    readonly potState: PotStateBucket;
    readonly boardContext?: BoardTextureBucket;
    readonly parent?: GameNode;
    readonly actionTaken?: NodeAction;
}

export interface GameNodeChildren {
    readonly raise: GameNode;
    readonly call: GameNode;
    readonly fold: GameNode;
}

export class GameNode {
    readonly range: RangeState;
    readonly street: Street;
    readonly spotTemplate: SpotTemplateBucket;
    readonly stackDepth: StackDepthBucket;
    readonly potState: PotStateBucket;
    readonly boardContext?: BoardTextureBucket;
    readonly parent?: GameNode;
    readonly actionTaken?: NodeAction;
    private _children?: GameNodeChildren;

    constructor(config: GameNodeConfig) {
        this.range = config.range;
        this.street = config.street;
        this.spotTemplate = config.spotTemplate;
        this.stackDepth = config.stackDepth;
        this.potState = config.potState;
        this.boardContext = config.boardContext;
        this.parent = config.parent;
        this.actionTaken = config.actionTaken;
    }

    get children(): GameNodeChildren | undefined {
        return this._children;
    }

    /**
     * Expand this node by splitting the range using action frequencies.
     * Delegates all math to RangeMath.split().
     * Creates child GameNodes from the resulting RangeStates.
     * Can only be called once (immutable after expansion).
     */
    expand(freqs: ActionFrequencies): GameNodeChildren {
        if (this._children) {
            throw new Error('GameNode has already been expanded');
        }

        const splitResult = RangeMath.split(this.range, freqs);

        const childBase = {
            street: this.street,
            spotTemplate: this.spotTemplate,
            stackDepth: this.stackDepth,
            potState: this.potState,
            boardContext: this.boardContext,
            parent: this,
        };

        this._children = {
            raise: new GameNode({ ...childBase, range: splitResult.raise, actionTaken: 'raise' }),
            call: new GameNode({ ...childBase, range: splitResult.call, actionTaken: 'call' }),
            fold: new GameNode({ ...childBase, range: splitResult.fold, actionTaken: 'fold' }),
        };

        return this._children;
    }

    /**
     * Expand this node from pre-computed, normalized RangeStates.
     * Used by SolverEngine when strategic layer adjusts branch ranges
     * after split but before child creation.
     * Can only be called once (immutable after expansion).
     */
    expandFromRanges(raise: RangeState, call: RangeState, fold: RangeState): GameNodeChildren {
        if (this._children) {
            throw new Error('GameNode has already been expanded');
        }

        const childBase = {
            street: this.street,
            spotTemplate: this.spotTemplate,
            stackDepth: this.stackDepth,
            potState: this.potState,
            boardContext: this.boardContext,
            parent: this,
        };

        this._children = {
            raise: new GameNode({ ...childBase, range: raise, actionTaken: 'raise' }),
            call: new GameNode({ ...childBase, range: call, actionTaken: 'call' }),
            fold: new GameNode({ ...childBase, range: fold, actionTaken: 'fold' }),
        };

        return this._children;
    }
}
