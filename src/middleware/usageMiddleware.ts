import { Request, Response, NextFunction } from 'express';
import { UsageService } from '../services/usageService';
import { UsageActionType, PremiumTier } from '@prisma/client';
import { prisma } from '../lib/prisma';

const usageService = new UsageService();

/**
 * Middleware factory: Creates a quota-checking middleware for a specific action type.
 * Attach to any route that consumes AI/OCR tokens.
 *
 * Usage:
 *   router.post('/analyze', checkUsageQuota('AI_ANALYZE'), handler);
 */
export function checkUsageQuota(actionType: UsageActionType) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // Extract userId from incoming request (real auth sets this on req.userId)
            // TODO: Remove dev fallback once real auth is implemented
            const rawUserId = (req as any).userId || req.body.userId || req.query.userId as string;

            let userId: string;
            let user: { premium_tier: PremiumTier } | null = null;

            if (rawUserId) {
                // Real auth path: look up user by their ID
                user = await prisma.user.findUnique({
                    where: { id: rawUserId },
                    select: { premium_tier: true }
                });
                userId = rawUserId;

                if (!user) {
                    res.status(404).json({ success: false, error: 'User not found' });
                    return;
                }
            } else {
                // Dev mock path: upsert by email so it works regardless of what ID is in DB
                const devUser = await prisma.user.upsert({
                    where: { email: 'dev@localhost' },
                    update: {},
                    create: {
                        id: process.env.DEV_MOCK_USER_ID || '00000000-0000-0000-0000-000000000001',
                        email: 'dev@localhost',
                        premium_tier: 'PRO_PLUS',
                    },
                    select: { id: true, premium_tier: true }
                });
                userId = devUser.id;   // Use whatever ID is actually in the DB
                user = { premium_tier: devUser.premium_tier };
            }

            const quota = await usageService.checkQuota(userId, actionType, user.premium_tier);

            if (!quota.allowed) {
                res.status(429).json({
                    success: false,
                    error: 'Usage limit reached',
                    data: {
                        action: actionType,
                        tier: user.premium_tier,
                        used: quota.used,
                        limit: quota.limit,
                        resetsAt: quota.resetsAt
                    }
                });
                return;
            }

            // Attach quota info and userId to request for downstream use
            (req as any).userId = userId;
            (req as any).userTier = user.premium_tier;
            (req as any).quotaInfo = quota;

            next();
        } catch (error) {
            console.error('[UsageMiddleware] Error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal error during quota check'
            });
        }
    };
}
