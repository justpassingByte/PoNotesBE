import { z } from 'zod';

const streetEnum = z.enum(['preflop', 'flop', 'turn', 'river', 'mixed']);
const positionEnum = z.enum(['ip', 'oop', 'ep', 'mp', 'co', 'btn', 'sb', 'bb', 'any']);

const templateNoteSchema = z.object({
    street: streetEnum,
    position: positionEnum,
    action: z.string().min(1, 'Action is required'),
    bucket: z.string().min(1, 'Bucket is required'),
});

export const playerAnalysisSchema = z.object({
    sample_size: z.number().int().min(0, 'Sample size must be non-negative'),
    stats: z.object({
        vpip: z.number().min(0).max(100),
        pfr: z.number().min(0).max(100),
    }),
    // Optional stats
    three_bet: z.number().min(0).max(100).optional(),
    fold_to_three_bet: z.number().min(0).max(100).optional(),
    cbet_flop: z.number().min(0).max(100).optional(),
    fold_to_cbet_flop: z.number().min(0).max(100).optional(),
    aggression_factor: z.number().min(0).optional(),
    // Notes
    template_notes: z.array(templateNoteSchema).default([]),
    custom_notes_raw: z.array(z.string().min(1)).default([]),
});

export type PlayerAnalysisSchemaType = z.infer<typeof playerAnalysisSchema>;
