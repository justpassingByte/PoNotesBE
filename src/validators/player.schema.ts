import { z } from 'zod';

export const bulkImportSchema = z.array(z.object({
    name: z.string().min(1, 'Name is required'),
    platform_id: z.string().uuid('Invalid platform ID').optional(),
    platform_name: z.string().optional(),
    playstyle: z.string().nullable().optional().default('UNKNOWN'),
    aggression_score: z.number().optional(),
    looseness_score: z.number().optional(),
    
    // AI Fields
    ai_profile: z.any().optional(),
    ai_playstyle: z.string().nullable().optional(),
    ai_aggression_level: z.string().nullable().optional(),
    ai_aggression_score: z.number().nullable().optional(),
    ai_gto_baseline: z.string().nullable().optional(),
    ai_exploit_strategy: z.string().nullable().optional(),
    ai_stats_used: z.string().nullable().optional(),
    ai_analysis_mode: z.string().nullable().optional(),
    ai_range_matrix: z.any().optional(),
    ai_action_breakdown: z.any().optional(),
    ai_last_analyzed_at: z.union([z.string().datetime(), z.date()]).nullable().optional(),

    notes: z.array(z.object({
        street: z.string().optional().default('Preflop'),
        note_type: z.string().optional().default('TEXT'),
        content: z.string().min(1, 'Note content cannot be empty'),
        category: z.string().optional(),
        source: z.string().optional(),
        is_ai_generated: z.boolean().optional(),
        metadata: z.any().optional(),
    })).optional().default([]),

    stats: z.object({
        vpip: z.number().nullable().optional(),
        rfi: z.number().nullable().optional(),
        pfr: z.number().nullable().optional(),
        three_bet: z.number().nullable().optional(),
        fold_to_3bet: z.number().nullable().optional(),
        cbet: z.number().nullable().optional(),
        fold_to_cbet: z.number().nullable().optional(),
        wtsd: z.number().nullable().optional(),
        wsd: z.number().nullable().optional(),
        aggression_freq: z.number().nullable().optional(),
        steal: z.number().nullable().optional(),
        fold_to_steal: z.number().nullable().optional(),
        check_raise: z.number().nullable().optional(),
        total_hands: z.number().nullable().optional(),
    }).nullable().optional(),

    patterns: z.array(z.object({
        pattern: z.string(),
        confidence: z.number().optional(),
        occurrences: z.number().optional(),
        decay_score: z.number().optional(),
        last_seen: z.union([z.string().datetime(), z.date()]).optional(),
    })).optional().default([]),

    analysis_contexts: z.array(z.object({
        position: z.string(),
        hero_stack: z.number(),
        villain_stack: z.number(),
        created_at: z.union([z.string().datetime(), z.date()]).optional(),
    })).optional().default([]),
}));

export const createPlayerSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    platform_id: z.string().uuid('Invalid platform ID'),
    playstyle: z.string().optional().default('UNKNOWN'),
});

export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().uuid('Invalid cursor ID').optional(),
});
