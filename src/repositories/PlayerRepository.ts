import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class PlayerRepository {
    async findAll(userId: string) {
        return prisma.player.findMany({
            where: { user_id: userId },
            include: {
                platform: true,
                _count: {
                    select: { notes: true }
                }
            }
        });
    }

    async findPaginated(userId: string, limit: number, cursor?: string) {
        const args: any = {
            take: limit,
            where: { user_id: userId },
            orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
            include: {
                platform: true,
                _count: { select: { notes: true } }
            }
        };

        if (cursor) {
            args.skip = 1; 
            args.cursor = { id: cursor };
        }

        return prisma.player.findMany(args);
    }

    async getAggregateStats(userId: string) {
        const [totalCount, totalNotesCount, playstyleGroups] = await Promise.all([
            prisma.player.count({ where: { user_id: userId } }),
            prisma.note.count({ where: { user_id: userId } }),
            prisma.player.groupBy({
                by: ['playstyle'],
                where: { user_id: userId },
                _count: { _all: true }
            })
        ]);

        const playstyleCounts: Record<string, number> = {};
        playstyleGroups.forEach(g => {
            playstyleCounts[g.playstyle || 'UNKNOWN'] = g._count._all;
        });

        return { totalCount, totalNotesCount, playstyleCounts };
    }

    async findAllWithNotes(userId: string) {
        return prisma.player.findMany({
            where: { user_id: userId },
            include: {
                platform: true,
                notes: { 
                    where: { user_id: userId },
                    orderBy: { created_at: 'desc' } 
                }
            }
        });
    }

    async findById(userId: string, id: string) {
        return prisma.player.findFirst({
            where: { id, user_id: userId },
            include: { platform: true, notes: { where: { user_id: userId } } }
        });
    }

    async findByName(userId: string, name: string) {
        return prisma.player.findFirst({
            where: { name, user_id: userId },
            include: { platform: true }
        });
    }

    async create(data: Prisma.PlayerUncheckedCreateInput) {
        return prisma.player.create({
            data,
            include: { platform: true }
        });
    }

    async bulkCreate(userId: string, playersWithNotes: (Prisma.PlayerUncheckedCreateInput & { notes?: Prisma.NoteUncheckedCreateWithoutPlayerInput[] })[]) {
        const skipped: string[] = [];
        const toCreate: any[] = [];

        const existingPlayers = await prisma.player.findMany({
            where: {
                user_id: userId,
                name: { in: playersWithNotes.map(p => p.name) }
            },
            select: { name: true, platform_id: true }
        });

        const existingSet = new Set(existingPlayers.map(p => `${p.name}|${p.platform_id}`));

        for (const player of playersWithNotes) {
            const key = `${player.name}|${player.platform_id}`;
            if (existingSet.has(key)) {
                skipped.push(player.name);
                continue;
            }
            existingSet.add(key); // prevent duplicates within payload

            toCreate.push(prisma.player.create({
                data: {
                    user_id: userId,
                    name: player.name,
                    platform_id: player.platform_id,
                    playstyle: player.playstyle,
                    aggression_score: (player as any).aggression_score || 0,
                    looseness_score: (player as any).looseness_score || 0,
                    
                    // AI Fields
                    ai_profile: player.ai_profile,
                    ai_playstyle: (player as any).ai_playstyle,
                    ai_aggression_level: (player as any).ai_aggression_level,
                    ai_aggression_score: (player as any).ai_aggression_score,
                    ai_gto_baseline: (player as any).ai_gto_baseline,
                    ai_exploit_strategy: (player as any).ai_exploit_strategy,
                    ai_stats_used: (player as any).ai_stats_used,
                    ai_analysis_mode: (player as any).ai_analysis_mode,
                    ai_range_matrix: (player as any).ai_range_matrix,
                    ai_action_breakdown: (player as any).ai_action_breakdown,
                    ai_last_analyzed_at: (player as any).ai_last_analyzed_at ? new Date((player as any).ai_last_analyzed_at) : null,

                    notes: player.notes && player.notes.length > 0 ? {
                        create: player.notes.map((n: any) => {
                            const { id, player_id, ...rest } = n;
                            return { ...rest, user_id: userId };
                        })
                    } : undefined,

                    stats: (player as any).stats ? {
                        create: (() => {
                            const { id, player_id, ...statFields } = (player as any).stats;
                            return statFields;
                        })()
                    } : undefined,

                    patterns: (player as any).patterns && (player as any).patterns.length > 0 ? {
                        create: (player as any).patterns.map((p: any) => {
                            const { id, player_id, ...rest } = p;
                            return rest;
                        })
                    } : undefined,

                    analysis_contexts: (player as any).analysis_contexts && (player as any).analysis_contexts.length > 0 ? {
                        create: (player as any).analysis_contexts.map((ac: any) => {
                            const { id, player_id, ...rest } = ac;
                            return rest;
                        })
                    } : undefined
                }
            }));
        }

        const created = [];
        const chunkSize = 1000;
        for (let i = 0; i < toCreate.length; i += chunkSize) {
            const chunk = toCreate.slice(i, i + chunkSize);
            const chunkResult = await prisma.$transaction(chunk);
            created.push(...chunkResult);
        }

        return { created, skipped };
    }

    async update(userId: string, id: string, data: Partial<Prisma.PlayerUncheckedUpdateInput>) {
        // Ensure player belongs to user
        const existing = await prisma.player.findFirst({ where: { id, user_id: userId } });
        if (!existing) throw new Error('Player not found or access denied');

        return prisma.player.update({
            where: { id },
            data,
            include: { platform: true, notes: { where: { user_id: userId } } }
        });
    }

    async delete(userId: string, id: string) {
        const player = await prisma.player.findFirst({ where: { id, user_id: userId } });
        if (!player) return null;

        await prisma.note.deleteMany({ where: { player_id: id, user_id: userId } });
        return prisma.player.delete({ where: { id } });
    }
}
