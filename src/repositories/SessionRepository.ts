import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class SessionRepository {
    async findByUserId(userId: string) {
        return prisma.session.findMany({
            where: { user_id: userId },
            orderBy: { last_active: 'desc' }
        });
    }

    async countByUserId(userId: string): Promise<number> {
        return prisma.session.count({
            where: { user_id: userId }
        });
    }

    async upsert(userId: string, deviceId: string, ipAddress?: string) {
        return prisma.session.upsert({
            where: {
                user_id_device_id: { user_id: userId, device_id: deviceId }
            },
            update: {
                last_active: new Date(),
                ip_address: ipAddress || null
            },
            create: {
                user_id: userId,
                device_id: deviceId,
                ip_address: ipAddress || null
            }
        });
    }

    async deleteByUserId(userId: string) {
        return prisma.session.deleteMany({
            where: { user_id: userId }
        });
    }

    async deleteOldest(userId: string) {
        const oldest = await prisma.session.findFirst({
            where: { user_id: userId },
            orderBy: { last_active: 'asc' }
        });
        if (oldest) {
            return prisma.session.delete({ where: { id: oldest.id } });
        }
        return null;
    }

    async deleteByDeviceId(userId: string, deviceId: string) {
        return prisma.session.deleteMany({
            where: { user_id: userId, device_id: deviceId }
        });
    }
}
