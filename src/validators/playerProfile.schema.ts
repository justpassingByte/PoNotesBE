import { z } from 'zod';

// ─── Layer A: Signal Extraction (Internal) ────────────

const streetEnum = z.enum(['preflop', 'flop', 'turn', 'river', 'mixed']);
const positionEnum = z.enum(['ip', 'oop', 'ep', 'mp', 'co', 'btn', 'sb', 'bb', 'any']);
const potTypeEnum = z.enum(['srp', '3bp', '4bp', 'limped', 'any']);

export const parsedSignalSchema = z.object({
    street: streetEnum,
    position: positionEnum,
    action_type: z.string().min(1),
    pot_type: potTypeEnum,
    board_bucket_hint: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    source: z.literal('custom_ai')
});

export const aiParseResultSchema = z.object({
    parsed_signals: z.array(parsedSignalSchema),
    parse_confidence: z.number().min(0).max(1),
    source: z.literal('custom_ai')
});

// ─── Layer B: Player Profiling (Public) ──────────────

const archetypeEnum = z.enum(['nit', 'tag', 'lag', 'fish', 'maniac', 'calling_station', 'loose_passive', 'unknown']);

export const playerTendencySchema = z.object({
    tag: z.string().min(1),
    weight: z.number().min(0).max(1)
});

export const playerProfileSchema = z.object({
    player_profile_id: z.string().uuid(),
    archetype: archetypeEnum,
    tendencies: z.array(playerTendencySchema),
    aggression_score: z.number().min(0).max(100),
    looseness_score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    reliability_score: z.number().min(0).max(1),
    data_sources: z.object({
        stats_weight: z.number().min(0).max(1),
        template_weight: z.number().min(0).max(1),
        custom_note_weight: z.number().min(0).max(1),
    })
});

// Types exported for convenience
export type ParsedSignalSchemaType = z.infer<typeof parsedSignalSchema>;
export type AIParseResultSchemaType = z.infer<typeof aiParseResultSchema>;
export type PlayerProfileSchemaType = z.infer<typeof playerProfileSchema>;

// ─── Layer C: Decision Context Schema ────────────────

import {
    boardTextureBucketSchema,
    betBucketSchema,
    stackDepthBucketSchema,
    spotTemplateBucketSchema,
    streetSchema,
} from './context.schema';

export const decisionContextSchema = z.object({
    context_id: z.string().uuid(),
    street: streetSchema,
    player_profile: playerProfileSchema,
    stack_depth: stackDepthBucketSchema,
    spot_template: spotTemplateBucketSchema,
    board_texture: boardTextureBucketSchema.nullable(), // null for preflop
    villain_bet: betBucketSchema,
    created_at: z.string().datetime(),
});

export type DecisionContextSchemaType = z.infer<typeof decisionContextSchema>;

// ─── Exploit Engine Output Schema ────────────────────

const exploitConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

const adjustmentMagnitudeSchema = z.enum([
    'INCREASE', 'DECREASE', 'NO_CHANGE',
]);

const actionFrequenciesSchema = z.object({
    raise_pct: z.number().min(0).max(100),
    call_pct: z.number().min(0).max(100),
    fold_pct: z.number().min(0).max(100),
});

export const exploitResultSchema = z.object({
    exploit_id: z.string().uuid(),
    context_id: z.string().uuid(),
    street: streetSchema,
    baseline_frequencies: actionFrequenciesSchema,
    adjusted_frequencies: actionFrequenciesSchema,
    adjustments_applied: z.object({
        raise: adjustmentMagnitudeSchema,
        call: adjustmentMagnitudeSchema,
        fold: adjustmentMagnitudeSchema,
    }),
    exploit_adjustments: z.string().min(1),
    confidence: exploitConfidenceSchema,
    reasoning_summary: z.string().min(1),
    created_at: z.string().datetime(),
});

export type ExploitResultSchemaType = z.infer<typeof exploitResultSchema>;
