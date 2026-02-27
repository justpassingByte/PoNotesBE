import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class PlayerRepository {
    async findAll() {
        return prisma.player.findMany({
            include: {
                platform: true,
                _count: {
                    select: { notes: true }
                }
            }
        });
    }

    async findAllWithNotes() {
        return prisma.player.findMany({
            include: {
                platform: true,
                notes: { orderBy: { created_at: 'desc' } }
            }
        });
    }

    async findById(id: string) {
        return prisma.player.findUnique({
            where: { id },
            include: { platform: true, notes: true }
        });
    }

    async create(data: Prisma.PlayerUncheckedCreateInput) {
        return prisma.player.create({
            data,
            include: { platform: true }
        });
    }

    async bulkCreate(playersWithNotes: (Prisma.PlayerUncheckedCreateInput & { notes?: Prisma.NoteUncheckedCreateWithoutPlayerInput[] })[]) {
        const created: any[] = [];
        const skipped: string[] = [];

        for (const player of playersWithNotes) {
            // Check if player already exists with same platform + name
            const existing = await prisma.player.findFirst({
                where: {
                    name: player.name,
                    platform_id: player.platform_id
                }
            });

            if (existing) {
                skipped.push(player.name);
                continue; // Skip this player
            }

            const newPlayer = await prisma.player.create({
                data: {
                    name: player.name,
                    platform_id: player.platform_id,
                    playstyle: player.playstyle,
                    aggression_score: (player as any).aggression_score || 0,
                    notes: player.notes && player.notes.length > 0 ? {
                        create: player.notes
                    } : undefined
                }
            });
            created.push(newPlayer);
        }

        return { created, skipped };
    }

    async update(id: string, data: Partial<Prisma.PlayerUncheckedUpdateInput>) {
        return prisma.player.update({
            where: { id },
            data,
            include: { platform: true, notes: true }
        });
    }

    async delete(id: string) {
        // Check if player exists first
        const player = await prisma.player.findUnique({ where: { id } });
        if (!player) return null;

        // Delete related notes first, then the player
        await prisma.note.deleteMany({ where: { player_id: id } });
        return prisma.player.delete({ where: { id } });
    }
}
