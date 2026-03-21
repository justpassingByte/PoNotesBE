import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { SessionService } from '../services/sessionService';

function extractIp(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded;
    if (Array.isArray(forwarded)) return forwarded[0];
    return req.ip;
}

export class SessionController extends BaseController {
    constructor(private readonly sessionService: SessionService) {
        super();
    }

    /**
     * POST /api/sessions/register
     * Body: { userId, deviceId }
     */
    async register(req: Request, res: Response) {
        try {
            const { userId, deviceId } = req.body;
            if (!userId || !deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'userId and deviceId are required'
                });
            }

            const ipAddress = extractIp(req);
            const result = await this.sessionService.registerDevice(userId, deviceId, ipAddress);

            if (result.status === 'max_devices_reached') {
                return res.status(403).json({
                    success: false,
                    error: 'Maximum devices reached. Please logout other devices first.',
                    data: result
                });
            }

            this.handleSuccess(res, result);
        } catch (error) {
            this.handleError(error, res, 'SessionController.register');
        }
    }

    /**
     * POST /api/sessions/force-logout
     * Body: { userId, deviceId }
     */
    async forceLogout(req: Request, res: Response) {
        try {
            const { userId, deviceId } = req.body;
            if (!userId || !deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'userId and deviceId are required'
                });
            }

            const ipAddress = extractIp(req);
            const result = await this.sessionService.forceLogoutAndRegister(userId, deviceId, ipAddress);
            this.handleSuccess(res, result);
        } catch (error) {
            this.handleError(error, res, 'SessionController.forceLogout');
        }
    }

    /**
     * POST /api/sessions/logout-all
     * Body: { userId }
     */
    async logoutAll(req: Request, res: Response) {
        try {
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'userId is required'
                });
            }

            await this.sessionService.logoutAll(userId);
            this.handleSuccess(res, { message: 'All sessions cleared' });
        } catch (error) {
            this.handleError(error, res, 'SessionController.logoutAll');
        }
    }

    /**
     * GET /api/sessions/:userId
     */
    async getSessions(req: Request, res: Response) {
        try {
            const userId = req.params.userId as string;
            const sessions = await this.sessionService.getActiveSessions(userId);
            this.handleSuccess(res, sessions);
        } catch (error) {
            this.handleError(error, res, 'SessionController.getSessions');
        }
    }
}
