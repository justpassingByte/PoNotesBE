/**
 * Solver Range Core — Type Definitions
 *
 * Strict type definitions for /core/solver/.
 * Zero `any` types. Full TypeScript strict mode compliance.
 */

import type {
    Street,
    StackDepthBucket,
    SpotTemplateBucket,
    BoardTextureBucket,
    BetBucket,
} from '../../services/analysis/context/types';

import type { ActionFrequencies, BaselineContext } from '../../services/analysis/types';

// Re-export for solver consumers
export type {
    Street,
    StackDepthBucket,
    SpotTemplateBucket,
    BoardTextureBucket,
    BetBucket,
    ActionFrequencies,
    BaselineContext,
};

/** The action that led to a node in the game tree. */
export type NodeAction = 'raise' | 'call' | 'fold';

/**
 * Alias for BetBucket used in GameNode pot state context.
 * Design doc references PotStateBucket; underlying type is BetBucket.
 */
export type PotStateBucket = BetBucket;

/** Internal precision multiplier for 4-decimal-place arithmetic. */
export const PRECISION = 10000;

/** Target sum for a normalized range (100.0000). */
export const TARGET_SUM = 100;

/** Exact count of canonical poker hand classes. */
export const HAND_CLASS_COUNT = 169;

// ─── Multi-Street Progression Types ────────────────────────────

/** Strict street ordering for solver progression. */
export const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'] as const;

/** Union literal type derived from STREET_ORDER — compile-time aligned with Street. */
export type StreetOrder = typeof STREET_ORDER[number];

/**
 * Configuration for advancing a branch to the next street.
 */
export interface StreetTransitionConfig {
    readonly selectedAction: NodeAction;
    readonly nextStreet: Street;
    readonly boardContext?: BoardTextureBucket;
    readonly potStateOverride?: PotStateBucket;
}

/**
 * Get the next street in the progression.
 * Throws if current street is 'river' (terminal).
 */
export function getNextStreet(current: Street): Street {
    const idx = STREET_ORDER.indexOf(current);
    if (idx === -1 || idx === STREET_ORDER.length - 1) {
        throw new Error(`Cannot advance past '${current}': terminal street`);
    }
    return STREET_ORDER[idx + 1];
}

/**
 * Validate that a street progression is legal.
 * Only allows exactly one step forward: preflop→flop, flop→turn, turn→river.
 */
export function isValidStreetProgression(from: Street, to: Street): boolean {
    const fromIdx = STREET_ORDER.indexOf(from);
    const toIdx = STREET_ORDER.indexOf(to);
    return fromIdx !== -1 && toIdx !== -1 && toIdx === fromIdx + 1;
}

