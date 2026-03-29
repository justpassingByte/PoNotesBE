import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { prisma } from '../lib/prisma';
import { ApiKeyService } from '../services/apiKeyService';
import crypto from 'crypto';

/**
 * Desktop-specific endpoints for the PokerHUD desktop app.
 * All routes use apiKeyMiddleware for authentication.
 */
export class DesktopController extends BaseController {
    /**
     * POST /api/desktop/verify-key
     * Verifies an API key and returns user info + tier.
     * Called once when user enters their key in Settings.
     */
    async verifyKey(req: Request, res: Response) {
        try {
            // If we reach here, apiKeyMiddleware already validated the key
            const user = (req as any).user;
            const userId = user.id;

            // Fetch full user info
            const userData = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    premium_tier: true,
                    subscription_expiry: true,
                    max_devices: true,
                    language: true,
                },
            });

            if (!userData) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }

            res.json({
                success: true,
                data: {
                    userId: userData.id,
                    email: userData.email,
                    tier: userData.premium_tier,
                    subscriptionExpiry: userData.subscription_expiry,
                    maxDevices: userData.max_devices,
                    language: userData.language,
                },
                message: 'API key verified successfully',
            });
        } catch (error) {
            this.handleError(error, res, 'DesktopController.verifyKey');
        }
    }

    /**
     * GET /api/desktop/players
     * Returns all player data for the authenticated user (for initial load / daily sync).
     * Includes stats, notes count, and platform info.
     */
    async getPlayerData(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;

            const players = await prisma.player.findMany({
                where: { user_id: userId },
                include: {
                    stats: true,
                    platform: true,
                    _count: { select: { notes: true } },
                },
                orderBy: { created_at: 'desc' },
            });

            // Map to a clean format for the desktop app
            const data = players.map((p: any) => ({
                id: p.id,
                name: p.name,
                platform: p.platform?.name || 'Unknown',
                platformId: p.platform_id,
                playstyle: p.playstyle,
                aggressionScore: p.aggression_score,
                loosenessScore: p.looseness_score,
                notesCount: p._count.notes,
                stats: p.stats ? {
                    vpip: p.stats.vpip,
                    pfr: p.stats.pfr,
                    rfi: p.stats.rfi,
                    threeBet: p.stats.three_bet,
                    foldTo3Bet: p.stats.fold_to_3bet,
                    cbet: p.stats.cbet,
                    foldToCBet: p.stats.fold_to_cbet,
                    wtsd: p.stats.wtsd,
                    wsd: p.stats.wsd,
                    aggressionFreq: p.stats.aggression_freq,
                    steal: p.stats.steal,
                    foldToSteal: p.stats.fold_to_steal,
                    checkRaise: p.stats.check_raise,
                    totalHands: p.stats.total_hands,
                } : null,
            }));

            res.json({ success: true, data });
        } catch (error) {
            this.handleError(error, res, 'DesktopController.getPlayerData');
        }
    }

    /**
     * GET /api/desktop/players/:id
     * Returns detailed info for a specific player, including notes and full stats.
     */
    async getPlayerDetail(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const playerId = req.params.id as string;

            const player: any = await prisma.player.findFirst({
                where: { id: playerId, user_id: userId },
                include: {
                    stats: true,
                    platform: true,
                    notes: {
                        where: { user_id: userId },
                        orderBy: { created_at: 'desc' },
                        take: 50,
                    },
                },
            });

            if (!player) {
                return res.status(404).json({ success: false, error: 'Player not found' });
            }

            res.json({
                success: true,
                data: {
                    id: player.id,
                    name: player.name,
                    platform: player.platform?.name || 'Unknown',
                    platformId: player.platform_id,
                    playstyle: player.playstyle,
                    aiProfile: player.ai_profile,
                    stats: player.stats ? {
                        vpip: player.stats.vpip,
                        pfr: player.stats.pfr,
                        rfi: player.stats.rfi,
                        threeBet: player.stats.three_bet,
                        foldTo3Bet: player.stats.fold_to_3bet,
                        cbet: player.stats.cbet,
                        foldToCBet: player.stats.fold_to_cbet,
                        wtsd: player.stats.wtsd,
                        wsd: player.stats.wsd,
                        aggressionFreq: player.stats.aggression_freq,
                        steal: player.stats.steal,
                        foldToSteal: player.stats.fold_to_steal,
                        checkRaise: player.stats.check_raise,
                        totalHands: player.stats.total_hands,
                    } : null,
                    notes: player.notes.map(n => ({
                        id: n.id,
                        street: n.street,
                        content: n.content,
                        category: n.category,
                        createdAt: n.created_at,
                    })),
                },
            });
        } catch (error) {
            this.handleError(error, res, 'DesktopController.getPlayerDetail');
        }
    }

    /**
     * POST /api/desktop/sync
     * Receives local data from the desktop app for daily sync.
     * Accepts: action events, notes, and player stats updates.
     */
    async syncData(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { events, notes, statsUpdates } = req.body;

            let eventsProcessed = 0;
            let notesProcessed = 0;
            let statsProcessed = 0;

            // 1. Process action events (player stat increments)
            if (events && Array.isArray(events)) {
                for (const event of events) {
                    try {
                        // Find or create the player
                        let player = await prisma.player.findFirst({
                            where: {
                                user_id: userId,
                                name: { equals: event.playerName, mode: 'insensitive' as const },
                            },
                        });

                        if (player) {
                            // Log as a system event
                            await prisma.systemLog.create({
                                data: {
                                    user_id: userId,
                                    event_type: 'DESKTOP_SYNC',
                                    message: `Action: ${event.type} for ${event.playerName}`,
                                    metadata: event,
                                },
                            });
                            eventsProcessed++;
                        }
                    } catch (err) {
                        // Skip individual event errors
                        console.error('[DesktopSync] Event error:', err);
                    }
                }
            }

            // 2. Process notes
            if (notes && Array.isArray(notes)) {
                for (const note of notes) {
                    try {
                        const player = await prisma.player.findFirst({
                            where: {
                                user_id: userId,
                                name: { equals: note.playerName, mode: 'insensitive' as const },
                            },
                        });

                        if (player) {
                            await prisma.note.create({
                                data: {
                                    user_id: userId,
                                    player_id: player.id,
                                    street: note.street || 'general',
                                    content: note.content,
                                    category: note.category || 'GENERAL',
                                    source: 'desktop',
                                },
                            });
                            notesProcessed++;
                        }
                    } catch (err) {
                        console.error('[DesktopSync] Note error:', err);
                    }
                }
            }

            // 3. Process stats updates
            if (statsUpdates && Array.isArray(statsUpdates)) {
                for (const update of statsUpdates) {
                    try {
                        const player = await prisma.player.findFirst({
                            where: {
                                user_id: userId,
                                name: { equals: update.playerName, mode: 'insensitive' as const },
                            },
                        });

                        if (player) {
                            const statsData: any = {};
                            if (update.vpip != null) statsData.vpip = Number(update.vpip);
                            if (update.pfr != null) statsData.pfr = Number(update.pfr);
                            if (update.threeBet != null) statsData.three_bet = Number(update.threeBet);
                            if (update.foldTo3Bet != null) statsData.fold_to_3bet = Number(update.foldTo3Bet);
                            if (update.cbet != null) statsData.cbet = Number(update.cbet);
                            if (update.foldToCBet != null) statsData.fold_to_cbet = Number(update.foldToCBet);
                            if (update.wtsd != null) statsData.wtsd = Number(update.wtsd);
                            if (update.wsd != null) statsData.wsd = Number(update.wsd);
                            if (update.aggressionFreq != null) statsData.aggression_freq = Number(update.aggressionFreq);
                            if (update.steal != null) statsData.steal = Number(update.steal);
                            if (update.foldToSteal != null) statsData.fold_to_steal = Number(update.foldToSteal);
                            if (update.checkRaise != null) statsData.check_raise = Number(update.checkRaise);
                            if (update.totalHands != null) statsData.total_hands = Number(update.totalHands);

                            await prisma.playerStats.upsert({
                                where: { player_id: player.id },
                                create: { player_id: player.id, ...statsData },
                                update: statsData,
                            });
                            statsProcessed++;
                        }
                    } catch (err) {
                        console.error('[DesktopSync] Stats error:', err);
                    }
                }
            }

            res.json({
                success: true,
                data: {
                    eventsProcessed,
                    notesProcessed,
                    statsProcessed,
                    syncedAt: new Date().toISOString(),
                },
                message: 'Sync completed',
            });
        } catch (error) {
            this.handleError(error, res, 'DesktopController.syncData');
        }
    }

    /**
     * POST /api/desktop/players/search
     * Batch search for players by name (used by HUD for real-time lookups).
     * Same as legacy /api/players/search but scoped to apiKey user.
     */
    async searchPlayers(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { names } = req.body;

            if (!names || !Array.isArray(names) || names.length === 0) {
                return res.status(400).json({ success: false, error: 'names array required' });
            }

            // Search for all matching players
            const players = await prisma.player.findMany({
                where: {
                    user_id: userId,
                    name: { in: names as string[], mode: 'insensitive' as const },
                },
                include: {
                    stats: true,
                    platform: true,
                },
            });

            // Map to the format expected by the desktop ApiClient
            const data = players.map((p: any) => ({
                playerId: p.name,
                vpip: p.stats?.vpip ?? 0,
                pfr: p.stats?.pfr ?? 0,
                af: p.stats?.aggression_freq ?? 0,
                totalHands: p.stats?.total_hands ?? 0,
                cbet: p.stats?.cbet ?? 0,
                foldTo3Bet: p.stats?.fold_to_3bet ?? 0,
                threeBet: p.stats?.three_bet ?? 0,
                foldToCBet: p.stats?.fold_to_cbet ?? 0,
                wtsd: p.stats?.wtsd ?? 0,
                wsd: p.stats?.wsd ?? 0,
                steal: p.stats?.steal ?? 0,
                foldToSteal: p.stats?.fold_to_steal ?? 0,
                aggPct: p.stats?.aggression_freq ?? 0,
                checkRaisePct: p.stats?.check_raise ?? 0,
                platform: p.platform?.name || 'Unknown',
                playstyle: p.playstyle,
            }));

            res.json(data);
        } catch (error) {
            this.handleError(error, res, 'DesktopController.searchPlayers');
        }
    }
}
