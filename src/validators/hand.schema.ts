import { z } from 'zod';

/**
 * Zod schema for the structured hand data output from OCR/parsing.
 * This is the canonical format that all hand inputs (image or text) must be normalized to.
 */
export const HandActionSchema = z.object({
    player: z.string(),
    action: z.enum(['fold', 'call', 'raise', 'bet', 'check', 'all-in', 'post', '']),
    amount: z.number().optional(),
    position: z.string().optional() // SB, BB, UTG, MP, HJ, CO, BTN
});

export const ParsedHandSchema = z.object({
    hand_id: z.string().optional(),
    game_type: z.string().optional(), // NLHE, PLO, etc.
    board: z.array(z.string()).default([]), // ["9d", "3c", "6h", "4c", "Kc"]
    players: z.array(z.object({
        name: z.string(),
        position: z.string().optional(),
        stack: z.number().optional(),
        hole_cards: z.array(z.string()).optional()
    })).default([]),
    actions: z.object({
        blinds_ante: z.array(HandActionSchema).default([]),
        preflop: z.array(HandActionSchema).default([]),
        flop: z.array(HandActionSchema).default([]),
        turn: z.array(HandActionSchema).default([]),
        river: z.array(HandActionSchema).default([])
    }),
    pot: z.number().optional(),
    street_pots: z.record(z.string(), z.string()).optional(),
    showdown: z.record(z.string(), z.array(z.string())).optional(),
    winner: z.string().optional(),
    ocr_result: z.object({
        confidence: z.number(),
        decision: z.string(),
        decision_reason: z.array(z.string()),
        needs_confirmation: z.boolean().optional(),
        breakdown: z.any().optional(),
        performance: z.any().optional()
    }).optional()
});

export type ParsedHand = z.infer<typeof ParsedHandSchema>;
export type HandAction = z.infer<typeof HandActionSchema>;

/**
 * Zod schema for the AI analysis output.
 */
/**
 * Zod schema for the AI analysis output (Version 3).
 */
export const HandAnalysisSchema = z.object({
    summary: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    reasoning_trace: z.array(z.string()).default([]),
    mistakes: z.array(z.object({
        street: z.string(),
        player: z.string(),
        position: z.string().optional(),
        description: z.string(),
        actual_action: z.string().optional(),
        gto_action: z.string().optional(),
        better_line: z.string().optional(),
        gto_deviation_reason: z.string().optional(),
        exploit_strategy: z.string().optional(),
        severity: z.enum(['minor', 'moderate', 'critical']).optional()
    })).default([]),
    exploit_suggestions: z.array(z.string()).default([]),
    final_verdict: z.object({
        grade: z.string(),
        confidence_score: z.number().optional(),
        suggestion_type: z.enum(['GTO', 'Exploit', 'Balanced']).optional()
    }).optional(),
    
    // Compatibility fields (fallback if needed)
    heroMistakes: z.array(z.any()).optional(),
    villainMistakes: z.array(z.any()).optional(),
    betterLine: z.string().optional(),
    exploitSuggestion: z.string().optional(),
    notesCreated: z.array(z.string()).optional()
});

export type HandAnalysis = z.infer<typeof HandAnalysisSchema>;
