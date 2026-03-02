import { z } from 'zod';

export const stackDepthBucketSchema = z.enum([
    "SHORT",
    "MEDIUM",
    "DEEP",
    "VERY_DEEP",
    "UNKNOWN"
]);

export const potTypeSchema = z.enum([
    "LIMPED", "SRP", "3BP", "4BP",
    "5BP_PLUS", "SQUEEZE_POT", "COLD_CALL_3BP"
]);
export const positionalAdvantageSchema = z.enum(["IP", "OOP"]);

export const spotTemplateBucketSchema = z.enum([
    "LIMPED_IP", "LIMPED_OOP",
    "SRP_IP", "SRP_OOP",
    "3BP_IP", "3BP_OOP",
    "4BP_IP", "4BP_OOP",
    "5BP_PLUS_IP", "5BP_PLUS_OOP",
    "SQUEEZE_POT_IP", "SQUEEZE_POT_OOP",
    "COLD_CALL_3BP_IP", "COLD_CALL_3BP_OOP",
    "UNKNOWN"
]);

export const highCardTierSchema = z.enum(["ACE_HIGH", "KING_HIGH", "QUEEN_HIGH", "JACK_HIGH", "LOW_BOARD", "UNKNOWN"]);
export const suitednessSchema = z.enum(["MONOTONE", "TWO_TONE", "RAINBOW", "UNKNOWN"]);
export const connectivitySchema = z.enum(["CONNECTED", "SEMI_CONNECTED", "DISCONNECTED", "UNKNOWN"]);
export const pairedStatusSchema = z.enum(["UNPAIRED", "PAIRED", "TWO_PAIR", "TRIPS", "QUADS", "UNKNOWN"]);

export const boardTextureBucketSchema = z.object({
    highCardTier: highCardTierSchema,
    pairedStatus: pairedStatusSchema,
    suitedness: suitednessSchema,
    connectivity: connectivitySchema
});

/**
 * Phase 5.4: Bet Bucket Schema
 * Strictly pot-percentage based — no strategic inference.
 */
export const betBucketSchema = z.enum(["BLOCK", "HALF", "POT", "OVERBET", "UNKNOWN"]);

/**
 * Street schema for Exploit Engine context.
 */
export const streetSchema = z.enum(["preflop", "flop", "turn", "river"]);
