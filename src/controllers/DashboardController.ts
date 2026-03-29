import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { dashboardCache } from '../lib/cache';
import { UsageService } from '../services/usageService';
import { UsageActionType } from '@prisma/client';

export class DashboardController {
    /**
     * Get isolated dashboard statistics and top targets.
     * Fully cached per user for ultimate performance.
     */
    async getDashboard(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tier = (req as any).user.premium_tier || 'FREE';
            const cacheKey = `dashboard_v3_${userId}`;

            // 1. Try to serve instantly from Cache (0ms latency!)
            const cachedData = dashboardCache.get(cacheKey);
            if (cachedData) {
                // Usage must always be fresh (never serve stale quota data from cache)
                const [aiUsage, ocrUsage] = await Promise.all([
                    UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier),
                    UsageService.checkQuota(userId, UsageActionType.OCR_HAND, tier)
                ]);
                const freshStats = {
                    ...(cachedData as any).stats,
                    aiUsage: { ...aiUsage, resetsAt: aiUsage.resetsAt.toISOString() },
                    ocrUsage: { ...ocrUsage, resetsAt: ocrUsage.resetsAt.toISOString() }
                };
                return res.json({ success: true, data: { ...(cachedData as any), stats: freshStats } });
            }

            // 2. Fetch fresh data using parallel queries if not cached
            const where = { user_id: userId };
            
            // We need: totalCount, totalNotesCount, playstyles, weak targets, hands analyzed, AI vs Manual notes
            const [
                totalCount, 
                totalNotesCount, 
                playstyles, 
                weakTargets, 
                strongTargets,
                totalHands,
                aiNotesCount,
                manualNotesCount
            ] = await Promise.all([
                prisma.player.count({ where }),
                prisma.note.count({ where }),
                prisma.player.groupBy({
                    by: ['playstyle'],
                    where,
                    _count: { _all: true }
                }),
                // Specifically fetch weak targets (Whales/Fish)
                prisma.player.findMany({
                    where: {
                        user_id: userId,
                        playstyle: { in: ['WHALE', 'FISH', 'CALLING STATION', 'MANIAC'] }
                    },
                    include: {
                        platform: true,
                        _count: { select: { notes: true } }
                    },
                    orderBy: { created_at: 'desc' },
                    take: 20
                }),
                // Specifically fetch strong targets (Regs)
                prisma.player.findMany({
                    where: {
                        user_id: userId,
                        playstyle: { in: ['TAG', 'NIT', 'LAG'] }
                    },
                    include: {
                        platform: true,
                        _count: { select: { notes: true } }
                    },
                    orderBy: { notes: { _count: 'desc' } }, // Experienced/Active regs
                    take: 20
                }),
                prisma.hand.count({ where }),
                prisma.note.count({ where: { ...where, is_ai_generated: true } }),
                prisma.note.count({ where: { ...where, is_ai_generated: false } })
            ]);

            // Combine stats
            const playstyleCounts: Record<string, number> = {};
            playstyles.forEach(p => {
                if (p.playstyle) playstyleCounts[p.playstyle] = p._count._all;
            });

            // Prioritization: WHALE > FISH > CALLING STATION > MANIAC
            const fishPriority = ['WHALE', 'FISH', 'CALLING STATION', 'MANIAC'];
            const sortedWhales = [...weakTargets].sort((a, b) => {
                const pA = fishPriority.indexOf((a.playstyle || '').toUpperCase());
                const pB = fishPriority.indexOf((b.playstyle || '').toUpperCase());
                return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
            });

            // Prioritization: TAG > LAG > NIT
            const regPriority = ['TAG', 'LAG', 'NIT'];
            const sortedRegs = [...strongTargets].sort((a, b) => {
                const pA = regPriority.indexOf((a.playstyle || '').toUpperCase());
                const pB = regPriority.indexOf((b.playstyle || '').toUpperCase());
                return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
            });

            const topWhales = sortedWhales.slice(0, 4);
            const topRegs = sortedRegs.slice(0, 4);

            const formatPlayer = (p: any) => ({
                id: p.id,
                name: p.name,
                playstyle: p.playstyle || "UNKNOWN",
                aggression_score: p.aggression_score ?? 0,
                notesCount: p._count?.notes ?? 0,
                platform: p.platform ? { id: p.platform.id, name: p.platform.name } : undefined,
                ai_playstyle: p.ai_playstyle,
                ai_aggression_score: p.ai_aggression_score,
                ai_exploit_strategy: p.ai_exploit_strategy,
                ai_profile: p.ai_profile
            });

            const [aiUsage, ocrUsage] = await Promise.all([
                UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier),
                UsageService.checkQuota(userId, UsageActionType.OCR_HAND, tier)
            ]);

            // Store base data in cache WITHOUT usage (usage should always be fresh)
            const cacheableData = {
                stats: {
                    totalCount,
                    totalNotesCount,
                    playstyleCounts,
                    totalHands,
                    aiNotesCount,
                    manualNotesCount
                },
                topWhales: topWhales.map(formatPlayer),
                topRegs: topRegs.map(formatPlayer)
            };
            dashboardCache.set(cacheKey, cacheableData);

            // Attach fresh usage data to response (NOT cached)
            const responseData = {
                ...cacheableData,
                stats: {
                    ...cacheableData.stats,
                    aiUsage: { ...aiUsage, resetsAt: aiUsage.resetsAt.toISOString() },
                    ocrUsage: { ...ocrUsage, resetsAt: ocrUsage.resetsAt.toISOString() }
                }
            };

            res.json({
                success: true,
                data: responseData
            });
        } catch (error) {
            console.error('[DashboardController] Error:', error);
            res.status(500).json({ success: false, error: 'Failed to generate dashboard profile' });
        }
    }
}
