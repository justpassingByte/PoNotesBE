import { SessionRepository } from '../repositories/SessionRepository';

export class SessionService {
    constructor(private readonly sessionRepository: SessionRepository) {}

    private readonly MAX_DEVICES = 2;

    /**
     * Register or refresh a device session.
     * If user already has MAX_DEVICES, returns status requiring force-logout.
     */
    async registerDevice(userId: string, deviceId: string, ipAddress?: string) {
        const existingSessions = await this.sessionRepository.findByUserId(userId);

        // Check if this device is already registered
        const isExistingDevice = existingSessions.some(s => s.device_id === deviceId);

        if (isExistingDevice) {
            // Refresh existing session
            const session = await this.sessionRepository.upsert(userId, deviceId, ipAddress);
            return { status: 'ok' as const, session };
        }

        // New device — check limit
        if (existingSessions.length >= this.MAX_DEVICES) {
            return {
                status: 'max_devices_reached' as const,
                active_devices: existingSessions.length,
                sessions: existingSessions.map(s => ({
                    device_id: s.device_id,
                    last_active: s.last_active,
                    ip_address: s.ip_address
                }))
            };
        }

        // Within limit — create new session
        const session = await this.sessionRepository.upsert(userId, deviceId, ipAddress);
        return { status: 'ok' as const, session };
    }

    /**
     * Force logout all other devices for a user, then register the current device.
     */
    async forceLogoutAndRegister(userId: string, deviceId: string, ipAddress?: string) {
        await this.sessionRepository.deleteByUserId(userId);
        const session = await this.sessionRepository.upsert(userId, deviceId, ipAddress);
        return { status: 'ok' as const, session };
    }

    /**
     * Get all active sessions for a user.
     */
    async getActiveSessions(userId: string) {
        return this.sessionRepository.findByUserId(userId);
    }

    /**
     * Logout all devices.
     */
    async logoutAll(userId: string) {
        return this.sessionRepository.deleteByUserId(userId);
    }
}
