import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class NoteRepository {
    async findByPlayerId(playerId: string) {
        return prisma.note.findMany({
            where: { player_id: playerId },
            orderBy: { created_at: 'desc' }
        });
    }

    async create(data: Prisma.NoteUncheckedCreateInput) {
        return prisma.note.create({
            data,
            include: { player: true } // Return player info optionally
        });
    }

    async delete(noteId: string) {
        return prisma.note.delete({
            where: { id: noteId }
        });
    }

    async update(noteId: string, data: Partial<Prisma.NoteUncheckedUpdateInput>) {
        return prisma.note.update({
            where: { id: noteId },
            data
        });
    }
}
