import { prisma } from '../lib/prisma';
import { PlayerRepository } from '../repositories/PlayerRepository';
import { bulkImportSchema, createPlayerSchema } from '../validators/player.schema';

// Auto-calculate aggression score from playstyle
function calculateAggression(playstyle: string): number {
    switch (playstyle?.toUpperCase()) {
        case 'MANIAC': return 90;
        case 'LAG': return 70;
        case 'TAG': return 45;
        case 'FISH': return 25;
        case 'CALLING STATION': return 20;
        case 'NIT': return 10;
        default: return 0;
    }
}

export class PlayerService {
    constructor(private readonly playerRepository: PlayerRepository) { }

    async getAllPlayers(userId: string) {
        return this.playerRepository.findAll(userId);
    }

    async getPlayersPaginated(userId: string, limit: number, cursor?: string) {
        const [players, stats] = await Promise.all([
            this.playerRepository.findPaginated(userId, limit, cursor),
            this.playerRepository.getAggregateStats(userId)
        ]);

        const flattened = (players as any[]).map((p: any) => ({
            ...p,
            notesCount: p._count?.notes || 0,
        }));

        const lastPlayer = flattened[flattened.length - 1];
        const hasMore = flattened.length === limit;
        const nextCursor = lastPlayer?.id || null;

        return {
            data: flattened,
            meta: {
                totalCount: stats.totalCount,
                totalNotesCount: stats.totalNotesCount,
                playstyleCounts: stats.playstyleCounts,
                hasMore,
                nextCursor,
            }
        };
    }

    async exportAllPlayers(userId: string) {
        return this.playerRepository.findAllWithNotes(userId);
    }

    async getPlayerById(userId: string, id: string) {
        const player = await this.playerRepository.findById(userId, id);
        if (!player) {
            throw new Error(`Player with ID ${id} not found or access denied`);
        }
        return player;
    }

    async createPlayer(userId: string, payload: unknown) {
        const validatedData = createPlayerSchema.parse(payload);
        const dataWithAggression = {
            ...validatedData,
            user_id: userId,
            aggression_score: calculateAggression(validatedData.playstyle || 'UNKNOWN')
        };
        return this.playerRepository.create(dataWithAggression);
    }

    async updatePlayer(userId: string, id: string, payload: unknown) {
        const data: any = {};
        const body = payload as any;
        if (body.name) data.name = body.name;
        if (body.playstyle) {
            data.playstyle = body.playstyle;
            data.aggression_score = calculateAggression(body.playstyle);
        }
        if (body.aggression_score !== undefined) data.aggression_score = body.aggression_score;
        return this.playerRepository.update(userId, id, data);
    }

    async deletePlayer(userId: string, id: string) {
        if (!id) throw new Error('Player ID is required');
        return this.playerRepository.delete(userId, id);
    }

    async getOrCreatePlayerByName(userId: string, name: string, platformId?: string) {
        const existing = await this.playerRepository.findByName(userId, name);
        if (existing) return existing;

        let targetPlatformId = platformId;

        if (!targetPlatformId) {
            const platforms = await prisma.platform.findMany({ take: 1 });
            if (platforms.length === 0) {
                const defaultPlatform = await prisma.platform.create({
                    data: { name: 'Default Platform' }
                });
                targetPlatformId = defaultPlatform.id;
            } else {
                targetPlatformId = platforms[0].id;
            }
        }

        return this.playerRepository.create({
            user_id: userId,
            name,
            platform_id: targetPlatformId,
            playstyle: 'UNKNOWN',
            aggression_score: 0
        });
    }

    async bulkCreatePlayers(userId: string, payload: unknown) {
        const validatedData = bulkImportSchema.parse(payload);
        
        // Ensure we have a fallback platform
        const platforms = await prisma.platform.findMany();
        const firstPlatformId = platforms.length > 0 ? platforms[0].id : null;

        const enriched = [];
        for (const player of validatedData as any[]) {
            let platformId = player.platform_id;
            
            // If ID doesn't exist or is invalid, try to find by name
            if (player.platform_name) {
                const p = platforms.find(pl => pl.name.toLowerCase() === player.platform_name.toLowerCase());
                if (p) platformId = p.id;
            }
            
            // If still no ID or not in our DB, use first available platform
            if (!platformId || !platforms.some(pl => pl.id === platformId)) {
                platformId = firstPlatformId;
            }

            enriched.push({
                ...player,
                platform_id: platformId,
                aggression_score: calculateAggression(player.playstyle || 'UNKNOWN')
            });
        }
        
        return this.playerRepository.bulkCreate(userId, enriched as any);
    }
}
