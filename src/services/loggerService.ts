import { prisma } from '../lib/prisma';

export enum LogType {
    OCR_FEEDBACK = 'OCR_FEEDBACK',
    AI_LEARNING = 'AI_LEARNING',
    PROFILE_EVOLUTION = 'PROFILE_EVOLUTION',
    SYSTEM = 'SYSTEM'
}

export class LoggerService {
    /**
     * Log a cognitive or system event.
     * Always logs to Console, also attempts DB if table exists.
     */
    static async log(userId: string, type: LogType, message: string, metadata: any = {}, handId?: string) {
        const timestamp = new Date().toISOString();
        const prefix = `[${type}] ${timestamp}`;
        
        // 1. Console Log (Always visible to Dev)
        console.log(`${prefix} ${message}`, metadata ? JSON.stringify(metadata) : '');

        // 2. DB Log (Fail-safe, doesn't break if table doesn't exist yet)
        try {
            // Check if the systemLog model exists in prisma client (it won't until regenerated)
            if ((prisma as any).systemLog) {
                await (prisma as any).systemLog.create({
                    data: {
                        user_id: userId,
                        hand_id: handId,
                        event_type: type,
                        message,
                        metadata: metadata as any
                    }
                });
            }
        } catch (err) {
            // Silently fail if table not yet pushed/generated
        }
    }

    static async getHandLogs(userId: string, handId: string) {
        try {
            if ((prisma as any).systemLog) {
                return await (prisma as any).systemLog.findMany({
                    where: { user_id: userId, hand_id: handId },
                    orderBy: { created_at: 'asc' }
                });
            }
        } catch (err) {}
        return [];
    }
}
