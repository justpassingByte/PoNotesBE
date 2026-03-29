import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { PremiumTier } from '@prisma/client';

const API_KEY_PREFIX = 'pk_';

/**
 * API Key management for desktop app authentication.
 * Keys are stored as SHA-256 hashes — raw key is only returned once at creation.
 */
export class ApiKeyService {
    /**
     * Generate a new API key for a user (PRO+ only).
     * Returns the raw key — this is the ONLY time the full key is available.
     */
    static async generateKey(userId: string, name?: string): Promise<{
        id: string;
        rawKey: string;
        keyPrefix: string;
        name: string;
        createdAt: Date;
    }> {
        // Check user eligibility
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        if (user.premium_tier === 'FREE') {
            throw new Error('API keys are only available for PRO subscribers and above');
        }

        // Check subscription expiry
        if (user.subscription_expiry && new Date(user.subscription_expiry) < new Date()) {
            throw new Error('Your subscription has expired. Please renew to generate API keys.');
        }

        // Enforce 1 active key limit
        const activeKeysCount = await prisma.apiKey.count({
            where: { user_id: userId, is_active: true }
        });
        
        if (activeKeysCount >= 1) {
            throw new Error('You can only have 1 active API key at a time. Please delete your existing key first.');
        }

        // Generate secure random key
        const rawKeyBody = crypto.randomBytes(32).toString('hex');
        const rawKey = `${API_KEY_PREFIX}${rawKeyBody}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.substring(0, 11); // "pk_" + 8 chars

        const apiKey = await prisma.apiKey.create({
            data: {
                user_id: userId,
                key_hash: keyHash,
                key_prefix: keyPrefix,
                name: name || 'Desktop App',
            },
        });

        return {
            id: apiKey.id,
            rawKey,
            keyPrefix,
            name: apiKey.name,
            createdAt: apiKey.created_at,
        };
    }

    /**
     * Validate an API key and register/update device.
     * Called on every desktop API request.
     */
    static async validateKey(
        rawKey: string,
        deviceId: string,
        deviceName?: string,
        ipAddress?: string
    ): Promise<{
        userId: string;
        tier: PremiumTier;
        keyId: string;
    }> {
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const apiKey = await prisma.apiKey.findUnique({
            where: { key_hash: keyHash },
            include: {
                user: true,
                devices: true,
            },
        });

        if (!apiKey || !apiKey.is_active) {
            throw new Error('Invalid or revoked API key');
        }

        const user = apiKey.user;

        // Check subscription
        if (user.premium_tier === 'FREE') {
            throw new Error('API key access requires an active subscription');
        }

        if (user.subscription_expiry && new Date(user.subscription_expiry) < new Date()) {
            throw new Error('Subscription expired');
        }

        // Check device limit
        const existingDevice = apiKey.devices.find(d => d.device_id === deviceId);
        if (!existingDevice && apiKey.devices.length >= user.max_devices) {
            throw new Error(
                `Device limit reached (${user.max_devices}). Remove a device from your dashboard to continue.`
            );
        }

        // Register or update device
        await prisma.apiKeyDevice.upsert({
            where: {
                api_key_id_device_id: {
                    api_key_id: apiKey.id,
                    device_id: deviceId,
                },
            },
            update: {
                last_used: new Date(),
                device_name: deviceName || undefined,
                ip_address: ipAddress || undefined,
            },
            create: {
                api_key_id: apiKey.id,
                device_id: deviceId,
                device_name: deviceName,
                ip_address: ipAddress,
            },
        });

        // Update key last_used
        await prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { last_used_at: new Date() },
        });

        return {
            userId: user.id,
            tier: user.premium_tier,
            keyId: apiKey.id,
        };
    }

    /**
     * List all API keys for a user (with device info, no raw keys).
     */
    static async listKeys(userId: string) {
        return prisma.apiKey.findMany({
            where: { user_id: userId },
            include: {
                devices: {
                    orderBy: { last_used: 'desc' },
                },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    /**
     * Revoke (deactivate) an API key.
     */
    static async revokeKey(keyId: string, userId: string): Promise<void> {
        const apiKey = await prisma.apiKey.findFirst({
            where: { id: keyId, user_id: userId },
        });
        if (!apiKey) throw new Error('API key not found');

        await prisma.apiKey.update({
            where: { id: keyId },
            data: { is_active: false },
        });
    }

    /**
     * Remove a device from an API key.
     */
    static async removeDevice(keyId: string, deviceId: string, userId: string): Promise<void> {
        const apiKey = await prisma.apiKey.findFirst({
            where: { id: keyId, user_id: userId },
        });
        if (!apiKey) throw new Error('API key not found');

        await prisma.apiKeyDevice.deleteMany({
            where: {
                api_key_id: keyId,
                device_id: deviceId,
            },
        });
    }

    /**
     * Delete an API key and all its devices permanently.
     */
    static async deleteKey(keyId: string, userId: string): Promise<void> {
        const apiKey = await prisma.apiKey.findFirst({
            where: { id: keyId, user_id: userId },
        });
        if (!apiKey) throw new Error('API key not found');

        await prisma.apiKey.delete({ where: { id: keyId } });
    }
}
