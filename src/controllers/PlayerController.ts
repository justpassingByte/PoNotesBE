import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ProfileAggregator } from '../services/analysis/ProfileAggregator';
import { playerCache, clearPlayerCache, clearDashboardCache } from '../lib/cache';

export class PlayerController {
    /**
     * List players with cursor-based pagination and search
     */
    async list(req: Request, res: Response) {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const cursor = req.query.cursor as string;
            const query = req.query.query as string;
            const userId = (req as any).user.id;
            
            const cacheKey = `players_list_${userId}_l${limit}_c${cursor || 'none'}_q${query || 'none'}`;
            
            // 1. Try cache
            const cached = playerCache.get(cacheKey);
            if (cached) {
                return res.json({ success: true, ...(cached as any) });
            }

            const where: any = { user_id: userId };
            if (query) {
                where.name = { contains: query, mode: 'insensitive' };
            }

            // 2. Fetch ALL data in PARALLEL if not cached
            const [players, totalCount, totalNotesCount, playstyles] = await Promise.all([
                prisma.player.findMany({
                    take: limit,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    where,
                    include: {
                        platform: true,
                        _count: { select: { notes: true } }
                    },
                    orderBy: { created_at: 'desc' }
                }),
                prisma.player.count({ where }),
                prisma.note.count({ where: { user_id: userId } }),
                prisma.player.groupBy({
                    by: ['playstyle'],
                    where: { user_id: userId },
                    _count: true
                })
            ]);

            const playstyleCounts: Record<string, number> = {};
            playstyles.forEach(p => {
                if (p.playstyle) playstyleCounts[p.playstyle] = p._count;
            });

            const nextCursor = players.length === limit ? players[players.length - 1].id : null;

            const responseData = {
                data: players,
                meta: {
                    totalCount,
                    totalNotesCount,
                    playstyleCounts,
                    nextCursor,
                    hasMore: !!nextCursor
                }
            };

            // 3. Set cache
            playerCache.set(cacheKey, responseData);

            res.json({
                success: true,
                ...responseData
            });
        } catch (error) {
            console.error('[PlayerController] List Error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch players' });
        }
    }

    /**
     * Get player by ID (Full detail)
     */
    async getById(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const player = await prisma.player.findFirst({
                where: { 
                    id,
                    user_id: (req as any).user.id
                },
                include: {
                    notes: { 
                        where: { user_id: (req as any).user.id },
                        orderBy: { created_at: 'desc' } 
                    },
                    stats: true,
                    platform: true
                }
            });

            if (!player) return res.status(404).json({ success: false, error: 'Player not found' });

            res.json({ success: true, data: player });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Error fetching player' });
        }
    }

    /**
     * Get player profile (with optional auto-refresh calculation)
     */
    async getProfile(req: Request, res: Response) {
        const platformId = req.query.platformId as string;
        const name = req.query.name as string;

        if (!platformId || !name) {
            return res.status(400).json({ success: false, error: 'Platform and Player Name required' });
        }

        try {
            // Find player
            let player = await prisma.player.findFirst({
                where: { 
                    user_id: (req as any).user.id,
                    platform_id: platformId as string, 
                    name: name as string 
                },
                include: { notes: { where: { user_id: (req as any).user.id } }, stats: true }
            });

            if (!player) {
                return res.status(404).json({ success: false, error: 'Player not found' });
            }

            // Always recalculate profile if notes exist but no profile is present, 
            // or if force refresh is requested
            const force = req.query.force === 'true';
            if (!player.ai_profile || force) {
                const newProfile = await ProfileAggregator.generateProfile(player.id);
                player = { ...player, ai_profile: newProfile as any };
            }

            res.json({
                success: true,
                data: player
            });
        } catch (error) {
            console.error('[PlayerController] Error:', error);
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }

    /**
     * Trigger explicit re-profiling
     */
    async refreshProfile(req: Request, res: Response) {
        const { playerId } = req.body;
        if (!playerId) return res.status(400).json({ success: false, error: 'Player ID required' });

        try {
            const profile = await ProfileAggregator.generateProfile(playerId);
            res.json({ success: true, data: profile });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to refresh profile' });
        }
    }

    /**
     * Export all players and notes for backup
     */
    async export(req: Request, res: Response) {
        try {
            const players = await prisma.player.findMany({
                where: { user_id: (req as any).user.id },
                include: {
                    notes: true,
                    platform: true,
                    stats: true
                },
                orderBy: { created_at: 'desc' }
            });

            res.json({
                success: true,
                data: players
            });
        } catch (error) {
            console.error('[PlayerController] Export Error:', error);
            res.status(500).json({ success: false, error: 'Failed to export data' });
        }
    }

    /**
     * Bulk create players and notes from JSON import
     */
    async bulkCreate(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const payload = req.body;
            
            // Note: In a real app we'd inject PlayerService here via constructor,
            // but keeping current pattern for now.
            const { PlayerService } = require('../services/playerService');
            const { PlayerRepository } = require('../repositories/PlayerRepository');
            const playerService = new PlayerService(new PlayerRepository());
            
            const result = await playerService.bulkCreatePlayers(userId, payload);
            
            // Invalidate caches after bulk import
            clearPlayerCache(userId);
            clearDashboardCache(userId);

            res.json({ success: true, data: result });
        } catch (error: any) {
            console.error('[PlayerController] Bulk Create Error:', error);
            res.status(400).json({ success: false, error: error.message || 'Failed to bulk import players' });
        }
    }
    /**
     * Delete a player and all their notes
     */
    async delete(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const userId = (req as any).user.id;

            await prisma.player.delete({
                where: { 
                    id,
                    user_id: userId
                }
            });

            // Invalidate caches
            clearPlayerCache(userId);
            clearDashboardCache(userId);

            res.json({ success: true, message: 'Player deleted successfully' });
        } catch (error) {
            console.error('[PlayerController] Delete Error:', error);
            res.status(500).json({ success: false, error: 'Failed to delete player' });
        }
    }
}
