import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ProfileAggregator } from '../services/analysis/ProfileAggregator';
import { playerCache, clearPlayerCache, clearDashboardCache } from '../lib/cache';
import { UsageService } from '../services/usageService';
import { UsageActionType } from '@prisma/client';
import { PlayerService } from '../services/playerService';
import { PlayerRepository } from '../repositories/PlayerRepository';

export class PlayerController {
    private playerService = new PlayerService(new PlayerRepository());

    /**
     * Create a single player
     */
    async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const player = await this.playerService.createPlayer(userId, req.body);
            clearPlayerCache(userId);
            clearDashboardCache(userId);
            res.status(201).json({ success: true, data: player });
        } catch (error: any) {
            console.error('[PlayerController] Create Error:', error);
            res.status(400).json({ success: false, error: error.message || 'Failed to create player' });
        }
    }

    /**
     * Update a player
     */
    async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const player = await this.playerService.updatePlayer(userId, id, req.body);
            clearPlayerCache(userId);
            clearDashboardCache(userId);
            res.json({ success: true, data: player });
        } catch (error: any) {
            console.error('[PlayerController] Update Error:', error);
            res.status(400).json({ success: false, error: error.message || 'Failed to update player' });
        }
    }
    /**
     * List players with cursor-based pagination and search
     */
    async list(req: Request, res: Response) {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const cursor = req.query.cursor as string;
            const query = req.query.query as string;
            const playstyle = req.query.playstyle as string;
            const platform = req.query.platform as string;
            const userId = (req as any).user.id;
            
            const cacheKey = `players_list_${userId}_l${limit}_c${cursor || 'none'}_q${query || 'none'}_s${playstyle || 'all'}_p${platform || 'all'}`;
            
            // 1. Try cache
            const cached = playerCache.get(cacheKey);
            if (cached) {
                return res.json({ success: true, ...(cached as any) });
            }

            const where: any = { user_id: userId };
            if (query) {
                where.name = { contains: query, mode: 'insensitive' };
            }
            if (playstyle && playstyle !== 'All') {
                where.playstyle = playstyle;
            }
            if (platform && platform !== 'All') {
                where.platform = { name: platform };
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
                    orderBy: [
                        { created_at: 'desc' },
                        { id: 'asc' }
                    ]
                }),
                prisma.player.count({ where: { user_id: userId } }),
                prisma.note.count({ where: { user_id: userId } }),
                prisma.player.groupBy({
                    by: ['playstyle'],
                    where: { user_id: userId },
                    _count: { _all: true }
                })
            ]);

            const playstyleCounts: Record<string, number> = {};
            playstyles.forEach(p => {
                if (p.playstyle) playstyleCounts[p.playstyle] = p._count._all;
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
            console.error('[PlayerController] GetById Error:', error);
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
            const userId = (req as any).user.id;
            const tier = (req as any).user.premium_tier || 'FREE';

            // Find player
            let player = await prisma.player.findFirst({
                where: { 
                    user_id: userId,
                    platform_id: platformId as string, 
                    name: name as string 
                },
                include: { notes: { where: { user_id: userId } }, stats: true, platform: true }
            });

            if (!player) {
                return res.status(404).json({ success: false, error: 'Player not found' });
            }

            // Check usage if we need to generate/refresh
            const force = req.query.force === 'true';
            let usage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);

            if (!player.ai_profile || force) {
                if (!usage.allowed) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Monthly/Daily AI quota exceeded', 
                        usage: { ...usage, resetsAt: usage.resetsAt.toISOString() }
                    });
                }

                const newProfile = await ProfileAggregator.generateProfile(player.id);
                if (newProfile) {
                    await UsageService.incrementUsage(userId, UsageActionType.AI_ANALYZE, tier);
                    
                    // Invalidate caches so other screens see the new AI profile immediately
                    clearPlayerCache(userId);
                    clearDashboardCache(userId);
                    
                    // Refresh usage info after increment
                    usage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);
                    player = { ...player, ai_profile: newProfile as any };
                }
            }

            res.json({
                success: true,
                data: player,
                usage: usage ? { ...usage, resetsAt: usage.resetsAt.toISOString() } : undefined
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
            const userId = (req as any).user.id;
            const tier = (req as any).user.premium_tier || 'FREE';

            const usage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);
            if (!usage.allowed) {
                return res.status(403).json({ success: false, error: 'AI limit reached', usage: { ...usage, resetsAt: usage.resetsAt.toISOString() } });
            }

            const profile = await ProfileAggregator.generateProfile(playerId);
            if (profile) {
                await UsageService.incrementUsage(userId, UsageActionType.AI_ANALYZE, tier);
            }
            
            // Invalidate cache so Dashboard and PlayerList get the new AI Profile!
            clearPlayerCache(userId);
            clearDashboardCache(userId);
            
            const updatedUsage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);
            res.json({ 
                success: true, 
                data: profile, 
                usage: { ...updatedUsage, resetsAt: updatedUsage.resetsAt.toISOString() }
            });
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
                    stats: true,
                    patterns: true,
                    analysis_contexts: true
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
