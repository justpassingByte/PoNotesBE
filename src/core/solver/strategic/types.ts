/**
 * Strategic Layer - Type Definitions
 *
 * Types for the post-baseline deterministic strategy shaping layer.
 * All multiplier values are PRECISION-scaled integers (10000 = 1.0x).
 */

import type {
    Street,
    BoardTextureBucket,
    SpotTemplateBucket,
    StackDepthBucket,
    PositionalAdvantage,
} from '../../../services/analysis/context/types';
import type { NodeAction } from '../types';
import { PRECISION } from '../types';

// Re-export for strategic layer consumers
export type { Street, BoardTextureBucket, SpotTemplateBucket, StackDepthBucket, PositionalAdvantage, NodeAction };
export { PRECISION };

/** Canonical hand class identifier (e.g., 'AA', 'AKs', 'AKo'). */
export type HandClass = string;

/** Villain behavioral type for exploit adjustments. */
export type VillainTypeBucket =
    | 'NEUTRAL'
    | 'OVERFOLD'
    | 'OVERCALL'
    | 'OVERAGGRO'
    | 'PASSIVE';

/** Range shaping mode. */
export type ShapingMode = 'balanced' | 'polar' | 'merged';

/**
 * Weight multiplier map keyed by hand class.
 * Values are PRECISION-scaled integers (10000 = 1.0x, 13000 = 1.3x, etc.).
 */
export type MultiplierMap = ReadonlyMap<HandClass, number>;

/**
 * Context for strategic layer decision-making.
 * All fields are deterministic abstractions - no raw data.
 */
export interface StrategicContext {
    readonly street: Street;
    readonly boardContext?: BoardTextureBucket;
    readonly position: PositionalAdvantage;
    readonly villainType?: VillainTypeBucket;
    readonly shapingMode: ShapingMode;
}

/**
 * Extract positional advantage from SpotTemplateBucket suffix.
 * 'UNKNOWN' defaults to 'OOP' (conservative).
 */
export function extractPosition(spot: SpotTemplateBucket): PositionalAdvantage {
    if (spot === 'UNKNOWN') return 'OOP';
    return spot.endsWith('_IP') ? 'IP' : 'OOP';
}

// Public API types

/** Public solve request. */
export interface SolveRequest {
    readonly spot: SpotTemplateBucket;
    readonly stack: StackDepthBucket;
    readonly street?: Street;
    readonly board?: BoardTextureBucket;
    readonly villainType?: VillainTypeBucket;
    readonly shapingMode?: ShapingMode; // defaults to 'balanced'
}

/** Public solve response entry - per-hand action probabilities. */
export interface HandStrategy {
    readonly raise: number; // 0..1
    readonly call: number;  // 0..1
    readonly fold: number;  // 0..1
}

/** Public solve response - direct per-hand strategy map. */
export type SolveResponse = Record<HandClass, HandStrategy>;
