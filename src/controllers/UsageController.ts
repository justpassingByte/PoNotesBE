import { Request, Response } from 'express';
import { UsageService } from '../services/usageService';
import { UsageActionType, PremiumTier } from '@prisma/client';

/**
 * GET /api/usage?action=AI_ANALYZE
 * Returns the current quota status for the authenticated user.
 * Lightweight endpoint \u2014 does NOT consume any quota.
 */
export class UsageController {
    async getQuota(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tier = ((req as any).user.premium_tier || 'FREE') as PremiumTier;
            const action = (req.query.action as UsageActionType) || UsageActionType.AI_ANALYZE;

            // Validate action type is a known enum value
            if (!Object.values(UsageActionType).includes(action)) {
                return res.status(400).json({ success: false, error: `Invalid action: ${action}` });
            }

            const quota = await UsageService.checkQuota(userId, action, tier);

            res.json({
                success: true,
                data: {
                    ...quota,
                    resetsAt: quota.resetsAt.toISOString()
                }
            });
        } catch (error) {
            console.error('[UsageController] Error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch quota' });
        }
    }
}
