import { prisma } from '../lib/prisma';
import { UsageActionType, PremiumTier } from '@prisma/client';

/**
 * Tier-based usage limits.
 * Format: { actionType: { tier: limitPerPeriod } }
 * -1 means unlimited (soft-capped at SOFT_CAP for Enterprise).
 */
const USAGE_LIMITS: Record<UsageActionType, Record<PremiumTier, number>> = {
    AI_ANALYZE: {
        FREE: 2,        // 2/day
        PRO: 100,       // 100/month
        PRO_PLUS: 500,  // 500/month
        ENTERPRISE: -1  // unlimited (soft cap 2000)
    },
    OCR_NAME: {
        FREE: 5,        // 5/day
        PRO: 100,       // 100/month
        PRO_PLUS: 300,  // 300/month
        ENTERPRISE: -1  // unlimited
    },
    OCR_HAND: {
        FREE: 2,        // 2/day (same as AI_ANALYZE for free)
        PRO: 100,       // 100/month
        PRO_PLUS: 300,  // 300/month
        ENTERPRISE: -1  // unlimited
    }
};

const ENTERPRISE_SOFT_CAP = 2000;

export class UsageService {

    /**
     * Get the start of the current billing period.
     * FREE tier resets daily. Paid tiers reset monthly.
     */
    private getPeriodStart(tier: PremiumTier): Date {
        const now = new Date();
        if (tier === 'FREE') {
            // Daily reset: start of today (UTC)
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        }
        // Monthly reset: start of current month (UTC)
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }

    /**
     * Check if user can perform the given action. Returns remaining count.
     */
    async checkQuota(userId: string, actionType: UsageActionType, tier: PremiumTier): Promise<{
        allowed: boolean;
        used: number;
        limit: number;
        remaining: number;
        resetsAt: Date;
    }> {
        const periodStart = this.getPeriodStart(tier);
        const limit = USAGE_LIMITS[actionType][tier];

        // Get or create usage record
        const usage = await prisma.userUsage.findFirst({
            where: {
                user_id: userId,
                action_type: actionType,
                period_start: periodStart
            }
        });

        const used = usage?.count ?? 0;

        // Unlimited tier (Enterprise) — soft cap with throttle note
        if (limit === -1) {
            return {
                allowed: true,
                used,
                limit: ENTERPRISE_SOFT_CAP,
                remaining: Math.max(0, ENTERPRISE_SOFT_CAP - used),
                resetsAt: this.getNextResetDate(tier)
            };
        }

        const remaining = Math.max(0, limit - used);
        return {
            allowed: used < limit,
            used,
            limit,
            remaining,
            resetsAt: this.getNextResetDate(tier)
        };
    }

    /**
     * Increment the usage counter. Call AFTER a successful AI/OCR operation.
     */
    async incrementUsage(userId: string, actionType: UsageActionType, tier: PremiumTier): Promise<void> {
        const periodStart = this.getPeriodStart(tier);

        await prisma.userUsage.upsert({
            where: {
                user_id_action_type_period_start: {
                    user_id: userId,
                    action_type: actionType,
                    period_start: periodStart
                }
            },
            update: {
                count: { increment: 1 }
            },
            create: {
                user_id: userId,
                action_type: actionType,
                period_start: periodStart,
                count: 1
            }
        });
    }

    private getNextResetDate(tier: PremiumTier): Date {
        const now = new Date();
        if (tier === 'FREE') {
            // Tomorrow at 00:00 UTC
            const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
            return tomorrow;
        }
        // First day of next month
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }
}
