import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AIAnalysisService } from '../services/AIAnalysisService';
import { z } from 'zod';

const router = Router({ mergeParams: true });
const aiService = new AIAnalysisService();

const analyzeSchema = z.object({
    position: z.enum(['IP', 'OOP']),
    hero_stack: z.number().positive().max(1000),
    villain_stack: z.number().positive().max(1000),
    analysis_mode: z.enum(['simple', 'advanced']).optional(),
});

/**
 * POST /api/players/:playerId/analyze
 * Manually trigger AI analysis with specific context (position, stack size)
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const { playerId } = req.params;

        // Validate request body
        const parseResult = analyzeSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Invalid request body',
                details: parseResult.error.format(),
            });
        }

        const { position, hero_stack, villain_stack, analysis_mode } = parseResult.data;

        // Check if player exists
        const player = await prisma.player.findUnique({
            where: { id: playerId as string },
        });

        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }

        // Trigger analysis
        const result = await aiService.analyzeWithContext(
            playerId as string,
            position,
            hero_stack,
            villain_stack,
            analysis_mode
        );

        if (!result) {
            return res.status(400).json({
                error: 'AI analysis failed. Ensure AI is enabled in settings, Gemini API key is configured, and player has notes or stats.'
            });
        }

        return res.json({
            message: 'Analysis completed successfully',
            result
        });

    } catch (error) {
        console.error(`[API] Error triggering analysis for player ${req.params.playerId}:`, error);
        return res.status(500).json({ error: 'Internal server error while triggering analysis' });
    }
});

export default router;
