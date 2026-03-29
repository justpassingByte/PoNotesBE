import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EmailService } from './emailService';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'villainvault-super-secret-key';

export class AuthService {
    /**
     * Register a new user — sends verification email, does NOT auto-login.
     */
    static async register(email: string, password: string) {
        const existing = await prisma.user.findUnique({
            where: { email }
        });

        if (existing) {
            throw new Error('Email is already registered');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verifyToken = crypto.randomBytes(32).toString('hex');
        const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                premium_tier: 'FREE',
                email_verified: false,
                email_verify_token: verifyToken,
                email_verify_expires: verifyExpires,
            }
        });

        // Send verification email (fire and forget — don't block registration)
        EmailService.sendVerificationEmail(email, verifyToken).catch(err => {
            console.error('[AuthService] Failed to send verification email:', err.message);
        });

        return user;
    }

    /**
     * Generate a new JWT for a session
     */
    static generateToken(user: any, session: any) {
        return jwt.sign(
            { 
                userId: user.id, 
                sessionId: session.id,
                email: user.email,
                tier: user.premium_tier 
            }, 
            JWT_SECRET,
            { expiresIn: '7d' }
        );
    }

    /**
     * Authenticate user and create a session
     */
    static async login(email: string, password: string, device_id: string = 'web-default') {
        const user = await prisma.user.findUnique({
            where: { email },
            include: { sessions: true }
        });

        if (!user) {
            throw new Error('Invalid credentials');
        }

        // Check email verification (Admins are exempt)
        if (!user.email_verified && !user.is_admin) {
            const error: any = new Error('Please verify your email before logging in. Check your inbox.');
            error.code = 'EMAIL_NOT_VERIFIED';
            throw error;
        }

        // --- Subscription Guard: Auto-Degrade ---
        if (user.premium_tier !== 'FREE' && user.subscription_expiry && new Date(user.subscription_expiry) < new Date()) {
            console.log(`[SubscriptionGuard] User ${user.email} subscription expired. Degrading to FREE.`);
            await prisma.user.update({
                where: { id: user.id },
                data: { premium_tier: 'FREE' }
            });
            user.premium_tier = 'FREE'; // Update local object for token
        }
        // ----------------------------------------

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Invalid credentials');
        }

        // Check device limit
        if (user.sessions.length >= user.max_devices) {
            const oldestSession = user.sessions.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
            await prisma.session.delete({ where: { id: oldestSession.id } });
        }

        // Create new session or update existing device's session
        const session = await prisma.session.upsert({
            where: {
                user_id_device_id: {
                    user_id: user.id,
                    device_id,
                }
            },
            update: {
                last_active: new Date(),
            },
            create: {
                user_id: user.id,
                device_id,
            }
        });

        // Sign JWT
        const token = this.generateToken(user, session);

        return { token, user: { id: user.id, email: user.email, tier: user.premium_tier, language: user.language } };
    }

    /**
     * Verify email with token
     */
    static async verifyEmail(token: string) {
        const user = await prisma.user.findUnique({
            where: { email_verify_token: token }
        });

        if (!user) {
            throw new Error('Invalid verification token');
        }

        if (user.email_verify_expires && new Date() > new Date(user.email_verify_expires)) {
            throw new Error('Verification token has expired. Please request a new one.');
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                email_verified: true,
                email_verify_token: null,
                email_verify_expires: null,
            }
        });

        return { email: user.email };
    }

    /**
     * Resend verification email
     */
    static async resendVerification(email: string) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Don't reveal whether email exists
            return;
        }

        if (user.email_verified) {
            throw new Error('Email is already verified');
        }

        const verifyToken = crypto.randomBytes(32).toString('hex');
        const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                email_verify_token: verifyToken,
                email_verify_expires: verifyExpires,
            }
        });

        await EmailService.sendVerificationEmail(email, verifyToken);
    }

    /**
     * Request password reset — sends reset email
     */
    static async requestPasswordReset(email: string) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Don't reveal whether email exists — silently succeed
            return;
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.user.update({
            where: { id: user.id },
            data: {
                reset_token: resetToken,
                reset_token_expires: resetExpires,
            }
        });

        await EmailService.sendPasswordResetEmail(email, resetToken);
    }

    /**
     * Reset password with token
     */
    static async resetPassword(token: string, newPassword: string) {
        const user = await prisma.user.findUnique({
            where: { reset_token: token }
        });

        if (!user) {
            throw new Error('Invalid or expired reset token');
        }

        if (user.reset_token_expires && new Date() > new Date(user.reset_token_expires)) {
            throw new Error('Reset token has expired. Please request a new one.');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                reset_token: null,
                reset_token_expires: null,
            }
        });

        return { email: user.email };
    }

    /**
     * Verify session exists and is active
     */
    static async verifySession(sessionId: string) {
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { user: true }
        });

        if (!session) return null;

        // --- Real-time Subscription Guard ---
        const user = session.user;
        if (user.premium_tier !== 'FREE' && user.subscription_expiry && new Date(user.subscription_expiry) < new Date()) {
            console.log(`[SubscriptionGuard] Session sync: User ${user.email} expired. Degrading.`);
            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: { premium_tier: 'FREE' }
            });
            return updatedUser;
        }
        // ------------------------------------

        // Update last active
        await prisma.session.update({
            where: { id: sessionId },
            data: { last_active: new Date() }
        });

        return session.user;
    }

    /**
     * Issues a fresh token for a valid session (e.g. after payment)
     */
    static async refreshTokenForSession(sessionId: string) {
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { user: true }
        });

        if (!session) throw new Error('Session not found');

        const token = this.generateToken(session.user, session);
        return { token, user: { id: session.user.id, email: session.user.email, tier: session.user.premium_tier, language: session.user.language } };
    }

    /**
     * Logout from a specific session
     */
    static async logout(sessionId: string) {
        try {
            await prisma.session.delete({ where: { id: sessionId } });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Logout from ALL devices
     */
    static async logoutAllDevices(userId: string) {
        await prisma.session.deleteMany({
            where: { user_id: userId }
        });
        return true;
    }
}
