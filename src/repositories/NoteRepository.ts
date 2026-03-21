import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class NoteRepository {
    async findByPlayerId(userId: string, playerId: string) {
        return prisma.note.findMany({
            where: { player_id: playerId, user_id: userId },
            orderBy: { created_at: 'desc' }
        });
    }

    async create(data: Prisma.NoteUncheckedCreateInput) {
        return prisma.note.create({
            data,
            include: { player: true } 
        });
    }

    async delete(userId: string, noteId: string) {
        // Ensure note belongs to user
        const existing = await prisma.note.findFirst({ where: { id: noteId, user_id: userId } });
        if (!existing) throw new Error('Note not found or access denied');

        return prisma.note.delete({
            where: { id: noteId }
        });
    }

    async update(userId: string, noteId: string, data: Partial<Prisma.NoteUncheckedUpdateInput>) {
        // Ensure note belongs to user
        const existing = await prisma.note.findFirst({ where: { id: noteId, user_id: userId } });
        if (!existing) throw new Error('Note not found or access denied');

        return prisma.note.update({
            where: { id: noteId },
            data
        });
    }
}
