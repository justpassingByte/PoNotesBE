// Layer C - Spot Abstraction Types
// These types strictly define the categorical buckets for Poker Strategy contexts.

/**
 * Canonical street identifier used by the Exploit Engine.
 * Preflop has no board cards; flop=3, turn=4, river=5 community cards.
 */
export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * Mutually exclusive stack depth buckets based on Effective Stack size.
 * Assumes inputs are strictly normalized to Big Blinds (BBs).
 */
export type StackDepthBucket =
    | "SHORT"      // 0 - 29 BB
    | "MEDIUM"     // 30 - 59 BB
    | "DEEP"       // 60 - 99 BB
    | "VERY_DEEP"  // 100+ BB
    | "UNKNOWN";   // Fallback for invalid/missing data

/**
 * Phase 4.2: Spot Template Abstraction Types
 */
export type PotType = "LIMPED" | "SRP" | "3BP" | "4BP";
export type PositionalAdvantage = "IP" | "OOP";

export type SpotTemplateBucket =
    | "LIMPED_IP" | "LIMPED_OOP"
    | "SRP_IP" | "SRP_OOP"
    | "3BP_IP" | "3BP_OOP"
    | "4BP_IP" | "4BP_OOP"
    | "UNKNOWN";

/**
 * Phase 5.3+: Board Texture Bucket
 * Multi-attribute structural description of community cards (3-5 cards).
 * 100% deterministic; no AI or solver assumptions.
 */
export type HighCardTier =
    | "ACE_HIGH"
    | "KING_HIGH"
    | "QUEEN_HIGH"
    | "JACK_HIGH"
    | "LOW_BOARD"
    | "UNKNOWN";

export type Suitedness = "MONOTONE" | "TWO_TONE" | "RAINBOW" | "UNKNOWN";
export type Connectivity = "CONNECTED" | "SEMI_CONNECTED" | "DISCONNECTED" | "UNKNOWN";
export type PairedStatus = "UNPAIRED" | "PAIRED" | "TWO_PAIR" | "TRIPS" | "QUADS" | "UNKNOWN";

export interface BoardTextureBucket {
    readonly highCardTier: HighCardTier;
    readonly pairedStatus: PairedStatus;
    readonly suitedness: Suitedness;
    readonly connectivity: Connectivity;
}

/**
 * Phase 5.4: Bet Bucket
 * Strictly pot-percentage-based bet sizing abstraction.
 * No strategic inference (e.g. no "polarizing_bet").
 *
 * Thresholds (inclusive/exclusive, zero overlap):
 *   BLOCK:   betPct <= 25%
 *   HALF:    betPct >  25% AND betPct <= 50%
 *   POT:     betPct >  50% AND betPct <= 100%
 *   OVERBET: betPct >  100%
 */
export type BetBucket = "BLOCK" | "HALF" | "POT" | "OVERBET" | "UNKNOWN";

