import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/apiKeyService';

/**
 * Middleware for desktop app API key authentication.
 * Reads X-API-Key and X-Device-Id headers.
 * Attaches user context to request on success.
 */
export const apiKeyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const apiKey = req.headers['x-api-key'] as string | undefined;
        const deviceId = req.headers['x-device-id'] as string | undefined;
        const deviceName = req.headers['x-device-name'] as string | undefined;

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key missing. Provide X-API-Key header.',
            });
        }

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID missing. Provide X-Device-Id header.',
            });
        }

        // Extract IP
        const forwarded = req.headers['x-forwarded-for'];
        const ip = typeof forwarded === 'string'
            ? forwarded.split(',')[0].trim()
            : req.ip;

        const result = await ApiKeyService.validateKey(apiKey, deviceId, deviceName, ip);

        // Attach user context (same shape as authMiddleware for compatibility)
        (req as any).user = { id: result.userId, premium_tier: result.tier };
        (req as any).apiKeyId = result.keyId;
        (req as any).deviceId = deviceId;

        next();
    } catch (error: any) {
        const message = error.message || 'API key validation failed';

        // Determine status code from error message
        let status = 401;
        if (message.includes('Device limit')) status = 403;
        if (message.includes('expired')) status = 403;

        console.error('[ApiKeyMiddleware] Error:', message);
        return res.status(status).json({ success: false, error: message });
    }
};
