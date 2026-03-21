import { z } from 'zod';

/**
 * Zod schema for the structured hand data output from OCR/parsing.
 * This is the canonical format that all hand inputs (image or text) must be normalized to.
 */
export const HandActionSchema = z.object({
    player: z.string(),
    action: z.enum(['fold', 'call', 'raise', 'bet', 'check', 'all-in']),
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
        preflop: z.array(HandActionSchema).default([]),
        flop: z.array(HandActionSchema).default([]),
        turn: z.array(HandActionSchema).default([]),
        river: z.array(HandActionSchema).default([])
    }),
    pot: z.number().optional(),
    winner: z.string().optional()
});

export type ParsedHand = z.infer<typeof ParsedHandSchema>;
export type HandAction = z.infer<typeof HandActionSchema>;

/**
 * Zod schema for the AI analysis output.
 */
export const HandAnalysisSchema = z.object({
    heroMistakes: z.array(z.object({
        street: z.string(),
        description: z.string(),
        severity: z.enum(['minor', 'moderate', 'critical']).optional()
    })).default([]),
    villainMistakes: z.array(z.object({
        street: z.string(),
        playerName: z.string().optional(),
        description: z.string(),
        severity: z.enum(['minor', 'moderate', 'critical']).optional()
    })).default([]),
    betterLine: z.string().optional(),
    exploitSuggestion: z.string().optional(),
    summary: z.string().optional()
});

export type HandAnalysis = z.infer<typeof HandAnalysisSchema>;
