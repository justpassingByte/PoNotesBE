import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { dashboardCache } from '../lib/cache';

export class DashboardController {
    /**
     * Get isolated dashboard statistics and top targets.
     * Fully cached per user for ultimate performance.
     */
    async getDashboard(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const cacheKey = `dashboard_${userId}`;

            // 1. Try to serve instantly from Cache (0ms latency!)
            const cachedData = dashboardCache.get(cacheKey);
            if (cachedData) {
                return res.json({ success: true, data: cachedData });
            }

            // 2. Fetch fresh data using parallel queries if not cached
            const where = { user_id: userId };
            
            // We need: totalCount, totalNotesCount, playstyles, and recently added players for the Fish logic.
            const [players, totalCount, totalNotesCount, playstyles] = await Promise.all([
                prisma.player.findMany({
                    take: 10,
                    where,
                    include: {
                        platform: true,
                        _count: { select: { notes: true } }
                    },
                    orderBy: { created_at: 'desc' }
                }),
                prisma.player.count({ where }),
                prisma.note.count({ where }),
                prisma.player.groupBy({
                    by: ['playstyle'],
                    where,
                    _count: true
                })
            ]);

            // Combine stats
            const playstyleCounts: Record<string, number> = {};
            playstyles.forEach(p => {
                if (p.playstyle) playstyleCounts[p.playstyle] = p._count;
            });

            // Extract Top Fish identically to frontend
            const fishyStyles = ['FISH', 'CALLING STATION', 'UNKNOWN'];
            let topFish = players.filter(p => fishyStyles.includes((p.playstyle || '').toUpperCase())).slice(0, 4);
            
            if (topFish.length < 2) {
                topFish = players.slice(0, 4);
            }

            // Format data exactly for frontend layout
            const responseData = {
                stats: {
                    totalCount,
                    totalNotesCount,
                    playstyleCounts,
                },
                topFish: topFish.map(p => ({
                    id: p.id,
                    name: p.name,
                    playstyle: p.playstyle || "UNKNOWN",
                    aggression_score: p.aggression_score ?? 0,
                    notesCount: p._count?.notes ?? 0,
                    platform: p.platform ? { id: p.platform.id, name: p.platform.name } : undefined
                }))
            };

            // 3. Store in Memory Cache
            dashboardCache.set(cacheKey, responseData);

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
