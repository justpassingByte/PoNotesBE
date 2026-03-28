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
        playerName?: string;
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

        if (options?.minPot !== undefined) {
            where.parsed_data = {
                path: ['pot'],
                gte: options.minPot
            } as any;
        }

        if (options?.playerName) {
            // Prisma doesn't support easy "contains" in JSON array elements via findMany filter directly for every scenario,
            // but for simple string matching in path, we can use string_contains or similar if data is structured.
            // Since players is an array of objects, we use a more complex path or let standard JSON logic handle it.
            // For now, we'll use a path check if possible or raw query for exact player name match in the session.
            where.parsed_data = {
                path: ['players'],
                array_contains: { name: options.playerName }
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
            select: {
                id: true,
                hand_hash: true,
                input_type: true,
                tags: true,
                created_at: true,
                parsed_data: true,
                ai_analysis: true,
                user_id: true,
                // raw_input excluded — contains large base64 images, not needed for list view
                notes: true,
                system_logs: { orderBy: { created_at: 'asc' as const } }
            }
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
