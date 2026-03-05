/**
 * SolverEngine - High-Level Orchestrator
 *
 * Coordinates range initialization, strategy computation, and tree expansion.
 * Single entry point for solver-style operations.
 */

import { GameNode } from './GameNode';
import { HandClassGenerator } from './HandClassGenerator';
import { NodeStrategyAdapter } from './NodeStrategyAdapter';
import { RangeFilterEngine } from './RangeFilterEngine';
import { RangeInitializer } from './RangeInitializer';
import { RangeMath } from './RangeMath';
import { RangeState } from './RangeState';
import { StreetAdvancer } from './StreetAdvancer';
import { StrategicLayer } from './strategic/StrategicLayer';
import { GtoBaselineResolver } from '../../services/analysis/GtoBaselineResolver';
import type {
    SpotTemplateBucket,
    StackDepthBucket,
    Street,
    PotStateBucket,
    BoardTextureBucket,
    BaselineContext,
    ActionFrequencies,
} from './types';
import type { StreetTransitionConfig } from './types';
import type { GameNodeChildren } from './GameNode';
import type {
    StrategicContext,
    SolveRequest,
    SolveResponse,
    HandClass,
    HandStrategy,
} from './strategic/types';
import { extractPosition } from './strategic/types';

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

    /**
     * Expand a node: compute strategy via adapter, then split range.
     * When strategicContext is provided, applies strategic layer to each branch
     * between split and child creation.
     */
    static expandNode(node: GameNode, strategicContext?: StrategicContext): GameNodeChildren {
        const baselineContext: BaselineContext = {
            street: node.street,
            spot_template: node.spotTemplate,
            board_texture: node.boardContext ?? null,
            villain_bet: node.potState,
            stack_depth: node.stackDepth,
        };

        const isRootNode = node.parent === undefined;

        if (strategicContext) {
            const perHandFreqs = GtoBaselineResolver.resolvePerHand(baselineContext, node.range);
            const rootPolicyFreqs = applyRootActionPolicy(perHandFreqs, baselineContext, isRootNode);
            const rawSplit = RangeMath.splitRawPerHand(node.range, rootPolicyFreqs);

            const raiseRange = RangeState.fromRaw(rawSplit.raise);
            const callRange = RangeState.fromRaw(rawSplit.call);
            const foldRange = RangeState.fromRaw(rawSplit.fold);

            const adjRaise = RangeMath.normalize(
                StrategicLayer.apply(raiseRange, 'raise', strategicContext)
            );
            const adjCall = RangeMath.normalize(
                StrategicLayer.apply(callRange, 'call', strategicContext)
            );
            const adjFold = RangeMath.normalize(
                StrategicLayer.apply(foldRange, 'fold', strategicContext)
            );

            return node.expandFromRanges(adjRaise, adjCall, adjFold);
        }

        const freqs = NodeStrategyAdapter.computeStrategy(node);
        const rootPolicyFreqs = applyRootActionPolicyToGlobal(freqs, baselineContext, isRootNode);
        return node.expand(rootPolicyFreqs);
    }

    /** Full solve step: init root -> compute strategy -> expand. */
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

    /**
     * Public Solve API.
     * Returns true per-hand action frequencies (0..1) for UI consumption.
     */
    static solve(request: SolveRequest): SolveResponse {
        const street = request.street ?? 'preflop';
        const boardContext = street === 'preflop' ? undefined : request.board;

        const config: SolverConfig = {
            spot: request.spot,
            stack: request.stack,
            street,
            potState: 'HALF',
            boardContext,
        };

        const context: StrategicContext = {
            street,
            boardContext,
            position: extractPosition(request.spot),
            villainType: request.villainType,
            shapingMode: request.shapingMode ?? 'balanced',
        };

        const root = SolverEngine.initRoot(config);

        const baselineContext: BaselineContext = {
            street,
            spot_template: request.spot,
            board_texture: boardContext ?? null,
            villain_bet: 'HALF',
            stack_depth: request.stack,
        };

        const baselinePerHandFreqs = GtoBaselineResolver.resolvePerHand(baselineContext, root.range);
        const rootPolicyFreqs = applyRootActionPolicy(baselinePerHandFreqs, baselineContext, true);

        const rawSplit = RangeMath.splitRawPerHand(root.range, rootPolicyFreqs);

        const raiseRange = RangeState.fromRaw(rawSplit.raise);
        const callRange = RangeState.fromRaw(rawSplit.call);
        const foldRange = RangeState.fromRaw(rawSplit.fold);

        const adjRaiseRaw = StrategicLayer.apply(raiseRange, 'raise', context);
        const adjCallRaw = StrategicLayer.apply(callRange, 'call', context);
        const adjFoldRaw = StrategicLayer.apply(foldRange, 'fold', context);

        return rawToStrategyRecord(adjRaiseRaw, adjCallRaw, adjFoldRaw, rootPolicyFreqs);
    }
}

function isPreflopSrpOpenSpot(context: BaselineContext): boolean {
    return (
        context.street === 'preflop' &&
        (context.spot_template === 'SRP_IP' || context.spot_template === 'SRP_OOP')
    );
}

function applyRootActionPolicy(
    perHandFreqs: ReadonlyMap<string, ActionFrequencies>,
    context: BaselineContext,
    isRootNode: boolean
): Map<string, ActionFrequencies> {
    if (!isRootNode || !isPreflopSrpOpenSpot(context)) {
        return new Map(perHandFreqs);
    }

    const adjusted = new Map<string, ActionFrequencies>();

    for (const [hand, freqs] of perHandFreqs) {
        const raise = Math.max(0, freqs.raise_pct);
        const fold = Math.max(0, freqs.fold_pct);
        const nonCall = raise + fold;

        if (nonCall <= 0) {
            adjusted.set(hand, { raise_pct: 0, call_pct: 0, fold_pct: 100 });
            continue;
        }

        const raisePct = Math.round((raise / nonCall) * 100);
        const foldPct = 100 - raisePct;

        adjusted.set(hand, {
            raise_pct: raisePct,
            call_pct: 0,
            fold_pct: foldPct,
        });
    }

    return adjusted;
}

function applyRootActionPolicyToGlobal(
    freqs: ActionFrequencies,
    context: BaselineContext,
    isRootNode: boolean
): ActionFrequencies {
    if (!isRootNode || !isPreflopSrpOpenSpot(context)) {
        return freqs;
    }

    const raise = Math.max(0, freqs.raise_pct);
    const fold = Math.max(0, freqs.fold_pct);
    const nonCall = raise + fold;

    if (nonCall <= 0) {
        return { raise_pct: 0, call_pct: 0, fold_pct: 100 };
    }

    const raisePct = Math.round((raise / nonCall) * 100);
    return {
        raise_pct: raisePct,
        call_pct: 0,
        fold_pct: 100 - raisePct,
    };
}

function rawToStrategyRecord(
    raiseRaw: ReadonlyMap<string, number>,
    callRaw: ReadonlyMap<string, number>,
    foldRaw: ReadonlyMap<string, number>,
    baselinePerHandFreqs: ReadonlyMap<string, ActionFrequencies>
): Record<HandClass, HandStrategy> {
    const result: Record<string, HandStrategy> = {};

    for (const hand of HandClassGenerator.generateAll()) {
        const raise = raiseRaw.get(hand) ?? 0;
        const call = callRaw.get(hand) ?? 0;
        const fold = foldRaw.get(hand) ?? 0;
        const baseline = baselinePerHandFreqs.get(hand);

        result[hand] = normalizeStrategyWeights(raise, call, fold, baseline);
    }

    return result as Record<HandClass, HandStrategy>;
}

function normalizeStrategyWeights(
    raise: number,
    call: number,
    fold: number,
    baseline?: ActionFrequencies
): HandStrategy {
    const r = Math.max(0, raise);
    const c = Math.max(0, call);
    const f = Math.max(0, fold);
    const sum = r + c + f;

    // Preserve no-fold lock from baseline through strategic stages.
    const lockedNoFold = baseline?.fold_pct === 0;

    if (lockedNoFold) {
        const nonFold = r + c;
        if (nonFold > 0) {
            const raiseProb = clamp01(r / nonFold);
            const callProb = clamp01(1 - raiseProb);
            return {
                raise: raiseProb,
                call: callProb,
                fold: 0,
            };
        }

        const baseRaise = baseline ? clamp01(baseline.raise_pct / 100) : 0.5;
        const baseCall = clamp01(1 - baseRaise);
        return {
            raise: baseRaise,
            call: baseCall,
            fold: 0,
        };
    }

    if (sum <= 0) {
        return { raise: 0, call: 0, fold: 1 };
    }

    const raiseProb = clamp01(r / sum);
    const callProb = clamp01(c / sum);
    const foldProb = clamp01(1 - raiseProb - callProb);

    return {
        raise: raiseProb,
        call: callProb,
        fold: foldProb,
    };
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}
