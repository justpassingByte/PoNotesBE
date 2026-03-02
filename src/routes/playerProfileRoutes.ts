import { Router, Request, Response } from 'express';
import { playerAnalysisSchema } from '../validators/playerAnalysis.schema';
import { PlayerAnalysisService } from '../services/PlayerAnalysisService';
import { PlayerAnalysisInput } from '../services/analysis/types';
import { PrismaClient } from '@prisma/client';

const router = Router({ mergeParams: true });
const prisma = new PrismaClient();
const analysisService = new PlayerAnalysisService();

/**
 * POST /api/players/:playerId/profile
 * Generate a structured player analysis profile.
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const playerId = req.params.playerId as string;

        // Verify the player exists
        const player = await prisma.player.findUnique({
            where: { id: playerId },
        });

        if (!player) {
            return res.status(404).json({
                success: false,
                error: 'Player not found',
            });
        }

        // Validate request body
        const parseResult = playerAnalysisSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: parseResult.error.flatten(),
            });
        }

        const validated = parseResult.data;

        // Assemble the analysis input
        const input: PlayerAnalysisInput = {
            player_id: playerId,
            sample_size: validated.sample_size,
            stats: validated.stats,
            three_bet: validated.three_bet,
            fold_to_three_bet: validated.fold_to_three_bet,
            cbet_flop: validated.cbet_flop,
            fold_to_cbet_flop: validated.fold_to_cbet_flop,
            aggression_factor: validated.aggression_factor,
            template_notes: validated.template_notes,
            custom_notes_raw: validated.custom_notes_raw,
        };

        // Run the analysis pipeline
        const profile = await analysisService.analyze(input as any);
        const { playerProfileSchema } = await import('../validators/playerProfile.schema');
        const strictProfile = playerProfileSchema.parse(profile);

        return res.status(200).json({
            success: true,
            data: strictProfile,
        });
    } catch (error) {
        console.error('[PlayerProfile] Analysis failed:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error during analysis',
        });
    }
});

export { router as playerProfileRoutes };
