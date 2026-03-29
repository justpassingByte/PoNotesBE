import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { ApiKeyService } from '../services/apiKeyService';

export class ApiKeyController extends BaseController {
    /**
     * POST /api/api-keys
     * Generate a new API key. Only PRO+ users.
     */
    async create(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const { name } = req.body;

            const result = await ApiKeyService.generateKey(user.id, name);

            res.status(201).json({
                success: true,
                data: {
                    id: result.id,
                    rawKey: result.rawKey,  // Only returned once!
                    keyPrefix: result.keyPrefix,
                    name: result.name,
                    createdAt: result.createdAt,
                },
                message: 'API key generated. Copy it now — you won\'t be able to see it again.',
            });
        } catch (error) {
            this.handleError(error, res, 'ApiKeyController.create', 400);
        }
    }

    /**
     * GET /api/api-keys
     * List all API keys with device info.
     */
    async list(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const keys = await ApiKeyService.listKeys(user.id);

            const formatted = keys.map(key => ({
                id: key.id,
                keyPrefix: key.key_prefix,
                name: key.name,
                isActive: key.is_active,
                lastUsedAt: key.last_used_at,
                createdAt: key.created_at,
                devices: key.devices.map(d => ({
                    id: d.id,
                    deviceId: d.device_id,
                    deviceName: d.device_name,
                    ipAddress: d.ip_address,
                    lastUsed: d.last_used,
                    createdAt: d.created_at,
                })),
            }));

            this.handleSuccess(res, formatted);
        } catch (error) {
            this.handleError(error, res, 'ApiKeyController.list');
        }
    }


    /**
     * DELETE /api/api-keys/:id
     * Revoke an API key.
     */
    async revoke(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const keyId = req.params.id as string;

            await ApiKeyService.revokeKey(keyId, user.id);
            this.handleSuccess(res, { message: 'API key revoked' });
        } catch (error) {
            this.handleError(error, res, 'ApiKeyController.revoke', 400);
        }
    }

    /**
     * DELETE /api/api-keys/:id/devices/:deviceId
     * Remove a device from an API key.
     */
    async removeDevice(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const keyId = req.params.id as string;
            const deviceId = req.params.deviceId as string;

            await ApiKeyService.removeDevice(keyId, deviceId, user.id);
            this.handleSuccess(res, { message: 'Device removed' });
        } catch (error) {
            this.handleError(error, res, 'ApiKeyController.removeDevice', 400);
        }
    }

    /**
     * DELETE /api/api-keys/:id/permanent
     * Permanently delete an API key and all devices.
     */
    async deleteKey(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const keyId = req.params.id as string;

            await ApiKeyService.deleteKey(keyId, user.id);
            this.handleSuccess(res, { message: 'API key deleted permanently' });
        } catch (error) {
            this.handleError(error, res, 'ApiKeyController.deleteKey', 400);
        }
    }
}
