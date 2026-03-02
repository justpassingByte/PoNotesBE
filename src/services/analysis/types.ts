// Shared TypeScript interfaces for the Decision Engine Core

import type {
    StackDepthBucket,
    SpotTemplateBucket,
    BoardTextureBucket,
    BetBucket,
    Street,
} from './context/types';

// Re-export context types for external consumers
export type { StackDepthBucket, SpotTemplateBucket, BoardTextureBucket, BetBucket, Street };

// ─── Input Types ────────────────────────────────────────────────

export interface PlayerAnalysisInput {
    player_id: string;
    sample_size: number;
    stats: {
        vpip: number;
        pfr: number;
    };
    // Optional stats
    three_bet?: number;
    fold_to_three_bet?: number;
    cbet_flop?: number;
    fold_to_cbet_flop?: number;
    aggression_factor?: number;
    // Notes
    template_notes: TemplateNoteInput[];
    custom_notes_raw: string[];
}

export interface TemplateNoteInput {
    street: 'preflop' | 'flop' | 'turn' | 'river' | 'mixed';
    position: 'ip' | 'oop' | 'ep' | 'mp' | 'co' | 'btn' | 'sb' | 'bb' | 'any';
    action: string;
    bucket: string;
}

// ─── Layer A: Signal Extraction (Internal AI Output) ────────────

export type CanonicalStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'mixed';
export type CanonicalPosition = 'ip' | 'oop' | 'ep' | 'mp' | 'co' | 'btn' | 'sb' | 'bb' | 'any';

// Represents a low-level behavioral signal emitted by the AI parser
export interface ParsedSignal {
    street: CanonicalStreet;
    position: CanonicalPosition;
    action_type: string; // e.g., 'overbet', 'check-raise'
    pot_type: 'srp' | '3bp' | '4bp' | 'limped' | 'any';
    board_bucket_hint: string | null;
    confidence: number; // 0.0 to 1.0
    source: 'custom_ai';
}

// The strictly contained result from CustomNoteParser
export interface AIParseResult {
    parsed_signals: ParsedSignal[];
    parse_confidence: number; // 0.0 to 1.0
    source: 'custom_ai';
}

// ─── Layer B: Player Profiling (Public API Output) ──────────────

// A taxonomy of acceptable tags. Extensible but strict.
export type TendencyTag =
    | 'overfold_to_turn_barrel'
    | 'turn_overbet_bluff_heavy'
    | 'river_call_station'
    | 'preflop_limp_reraise'
    | 'check_raise_bluff_flop'
    | '3bet_light_ip'
    | 'overbet_jam'
    | 'general_passive'
    | 'general_aggressive'
    | 'unknown';

export type Archetype =
    | 'nit'
    | 'tag'
    | 'lag'
    | 'fish'
    | 'maniac'
    | 'calling_station'
    | 'loose_passive'
    | 'unknown';

export interface PlayerTendency {
    tag: TendencyTag | string; // strict taxonomy preferred, string allowed for flexibility initially
    weight: number; // 0.0 to 1.0 (strength of the read)
}

// The canonical player object. The ONLY object allowed to represent a player profile.
export interface PlayerProfile {
    player_profile_id: string; // uuid
    archetype: Archetype;
    tendencies: PlayerTendency[];
    aggression_score: number; // 0-100
    looseness_score: number; // 0-100
    confidence: number; // Overall profile mathematical confidence (0.0 - 1.0)
    reliability_score: number; // Data quality score (0.0 - 1.0)
    data_sources: {
        stats_weight: number; // e.g., 0.6
        template_weight: number; // e.g., 0.25
        custom_note_weight: number; // e.g., 0.15
    };
}

// ─── Layer C: Decision Context (Immutable Exploit Input) ────────

/**
 * The canonical, immutable object consumed by the Exploit Engine (Layer C).
 * Rule: ZERO raw data allowed — no raw stack numbers, card strings, or bet sizes.
 * All fields must be canonical abstractions derived from Phase 5 parsers.
 */
export interface DecisionContext {
    readonly context_id: string;          // UUID — uniquely identifies this context snapshot
    readonly street: Street;              // Which street this context is for
    readonly player_profile: PlayerProfile;
    readonly stack_depth: StackDepthBucket;
    readonly spot_template: SpotTemplateBucket;
    readonly board_texture: BoardTextureBucket | null; // null for preflop (no community cards)
    readonly villain_bet: BetBucket;       // The villain's bet abstracted to a bucket
    readonly created_at: string;           // ISO timestamp
}

/**
 * Structural context only. Used for deterministic baseline computation.
 * Explicitly excludes player_profile and any opponent-dependent variables.
 */
export interface BaselineContext {
    readonly street: Street;
    readonly spot_template: SpotTemplateBucket;
    readonly board_texture: BoardTextureBucket | null;
    readonly villain_bet: BetBucket;
    readonly stack_depth: StackDepthBucket;
}

// ─── Exploit Engine Output ──────────────────────────────────────

export type ExploitConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Directional labels that AI returns.
 * Backend maps these to a fixed ±8 delta. AI never controls arithmetic.
 */
export type AdjustmentMagnitude = 'INCREASE' | 'DECREASE' | 'NO_CHANGE';

/**
 * Action frequency triple. Always sums to 100.
 */
export interface ActionFrequencies {
    readonly raise_pct: number;  // 0-100
    readonly call_pct: number;   // 0-100
    readonly fold_pct: number;   // 0-100
}

/**
 * What Gemini AI returns — directional labels ONLY.
 * AI is an advisor, not a solver.
 */
export interface AIExploitResponse {
    readonly exploit_adjustments: string;      // Natural language deviations
    readonly raise_adjustment: AdjustmentMagnitude;
    readonly call_adjustment: AdjustmentMagnitude;
    readonly fold_adjustment: AdjustmentMagnitude;
    readonly reasoning_summary: string;
}

/**
 * Final structured output from the Exploit Engine.
 * Baseline is deterministic. Adjustments are bounded by backend math.
 */
export interface ExploitResult {
    readonly exploit_id: string;
    readonly context_id: string;
    readonly street: Street;
    readonly baseline_frequencies: ActionFrequencies;    // Deterministic, no AI
    readonly adjusted_frequencies: ActionFrequencies;    // Baseline + bounded deltas
    readonly adjustments_applied: {                      // The AI directions that were applied
        readonly raise: AdjustmentMagnitude;
        readonly call: AdjustmentMagnitude;
        readonly fold: AdjustmentMagnitude;
    };
    readonly exploit_adjustments: string;                // Natural language explanation
    readonly confidence: ExploitConfidence;
    readonly reasoning_summary: string;
    readonly created_at: string;
}
