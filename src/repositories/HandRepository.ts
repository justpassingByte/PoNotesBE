import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class HandRepository {
    async findByHash(handHash: string) {
        return prisma.hand.findUnique({
            where: { hand_hash: handHash },
            include: { notes: true }
        });
    }

    async findByUserId(userId: string, options?: {
        limit?: number;
        cursor?: string;
        tag?: string;
        gameType?: string;
        boardCards?: string[];
        minPot?: number;
    }) {
        const where: Prisma.HandWhereInput = { user_id: userId };

        if (options?.tag) {
            where.tags = { has: options.tag };
        }

        if (options?.gameType) {
            where.parsed_data = {
                path: ['game_type'],
                equals: options.gameType
            } as any;
        }

        if (options?.minPot) {
            where.parsed_data = {
                path: ['pot'],
                gte: options.minPot
            } as any;
        }

        return prisma.hand.findMany({
            where,
            take: options?.limit || 20,
            ...(options?.cursor ? {
                skip: 1,
                cursor: { id: options.cursor }
            } : {}),
            orderBy: { created_at: 'desc' },
            include: { notes: true }
        });
    }

    async findById(userId: string, id: string) {
        return prisma.hand.findFirst({
            where: { id, user_id: userId },
            include: { notes: true }
        });
    }

    async create(data: Prisma.HandUncheckedCreateInput) {
        return prisma.hand.create({ data });
    }

    async update(userId: string, id: string, data: Prisma.HandUncheckedUpdateInput) {
        // Ensure hand belongs to user
        const existing = await prisma.hand.findFirst({ where: { id, user_id: userId } });
        if (!existing) throw new Error('Hand not found or access denied');

        return prisma.hand.update({
            where: { id },
            data
        });
    }

    async addTags(userId: string, id: string, tags: string[]) {
        const hand = await prisma.hand.findFirst({ where: { id, user_id: userId } });
        if (!hand) return null;
        const merged = [...new Set([...hand.tags, ...tags])];
        return prisma.hand.update({
            where: { id },
            data: { tags: merged }
        });
    }

    async delete(userId: string, id: string) {
        const existing = await prisma.hand.findFirst({ where: { id, user_id: userId } });
        if (!existing) return null;

        return prisma.hand.delete({ where: { id } });
    }
}
