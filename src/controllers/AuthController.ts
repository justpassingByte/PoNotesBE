import { Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { prisma } from '../lib/prisma';
import { UsageService } from '../services/usageService';
import { UsageActionType } from '@prisma/client';

export class AuthController {
    /**
     * POST /api/auth/register
     * No longer auto-logs in — user must verify email first.
     */
    async register(req: Request, res: Response) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ success: false, error: 'Email and password required' });
            }

            if (password.length < 6) {
                return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
            }

            await AuthService.register(email, password);

            res.status(201).json({
                success: true,
                message: 'Registration successful! Please check your email to verify your account.',
                requiresVerification: true,
            });
        } catch (error: any) {
            console.error('[AuthController] Register Error:', error.message);
            res.status(400).json({ success: false, error: error.message || 'Registration failed' });
        }
    }

    /**
     * POST /api/auth/login
     */
    async login(req: Request, res: Response) {
        try {
            const { email, password, deviceId } = req.body;
            if (!email || !password) {
                return res.status(400).json({ success: false, error: 'Email and password required' });
            }

            const { token, user } = await AuthService.login(email, password, deviceId);

            // Set cookie
            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('token', token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });

            res.json({ success: true, token, user });
        } catch (error: any) {
            console.error('[AuthController] Login Error:', error.message);
            const statusCode = error.code === 'EMAIL_NOT_VERIFIED' ? 403 : 401;
            res.status(statusCode).json({
                success: false,
                error: error.message || 'Invalid credentials',
                code: error.code || undefined,
            });
        }
    }

    /**
     * POST /api/auth/logout
     */
    async logout(req: Request, res: Response) {
        try {
            const sessionId = (req as any).sessionId;
            if (sessionId) {
                await AuthService.logout(sessionId);
            }
            
            const isProduction = process.env.NODE_ENV === 'production';
            res.clearCookie('token', {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'none' : 'lax',
                path: '/'
            });
            res.json({ success: true, message: 'Logged out successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Logout failed' });
        }
    }

    /**
     * POST /api/auth/refresh-session
     */
    async refreshSession(req: Request, res: Response) {
        try {
            const sessionId = (req as any).sessionId;
            if (!sessionId) {
                return res.status(401).json({ success: false, error: 'No active session' });
            }

            const { token, user } = await AuthService.refreshTokenForSession(sessionId);

            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('token', token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/'
            });

            res.json({ success: true, token, user });
        } catch (error: any) {
            console.error('[AuthController] Refresh Error:', error.message);
            res.status(500).json({ success: false, error: 'Session refresh failed' });
        }
    }

    /**
     * GET /api/auth/verify-email?token=xxx
     */
    async verifyEmail(req: Request, res: Response) {
        try {
            const token = req.query.token as string;
            if (!token) {
                return res.status(400).json({ success: false, error: 'Verification token required' });
            }

            const result = await AuthService.verifyEmail(token);
            res.json({ success: true, message: 'Email verified successfully!', email: result.email });
        } catch (error: any) {
            console.error('[AuthController] Verify Email Error:', error.message);
            res.status(400).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/auth/resend-verification
     */
    async resendVerification(req: Request, res: Response) {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ success: false, error: 'Email required' });
            }

            await AuthService.resendVerification(email);
            res.json({ success: true, message: 'If that email exists, a verification link has been sent.' });
        } catch (error: any) {
            console.error('[AuthController] Resend Verification Error:', error.message);
            // Don't expose internal details
            if (error.message === 'Email is already verified') {
                return res.status(400).json({ success: false, error: error.message });
            }
            res.json({ success: true, message: 'If that email exists, a verification link has been sent.' });
        }
    }

    /**
     * POST /api/auth/forgot-password
     */
    async forgotPassword(req: Request, res: Response) {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ success: false, error: 'Email required' });
            }

            await AuthService.requestPasswordReset(email);
            // Always return success to prevent email enumeration
            res.json({ success: true, message: 'If that email exists, a password reset link has been sent.' });
        } catch (error: any) {
            console.error('[AuthController] Forgot Password Error:', error.message);
            res.json({ success: true, message: 'If that email exists, a password reset link has been sent.' });
        }
    }

    /**
     * POST /api/auth/reset-password
     */
    async resetPassword(req: Request, res: Response) {
        try {
            const { token, password } = req.body;
            if (!token || !password) {
                return res.status(400).json({ success: false, error: 'Token and new password required' });
            }

            if (password.length < 6) {
                return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
            }

            const result = await AuthService.resetPassword(token, password);
            res.json({ success: true, message: 'Password reset successfully!' });
        } catch (error: any) {
            console.error('[AuthController] Reset Password Error:', error.message);
            res.status(400).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/auth/me
     */
    async me(req: Request, res: Response) {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

        try {
            const plan = await (prisma as any).pricingPlan.findUnique({
                where: { id: user.premium_tier }
            });

            const recentNotes = await prisma.note.findMany({
                where: { user_id: user.id },
                orderBy: { created_at: 'desc' },
                take: 5,
                select: {
                    id: true,
                    content: true,
                    street: true,
                    note_type: true,
                    category: true,
                    source: true,
                    is_ai_generated: true,
                    created_at: true,
                    player: {
                        select: { id: true, name: true, playstyle: true }
                    }
                }
            });

            const totalNotes = await prisma.note.count({ where: { user_id: user.id } });
            const totalPlayers = await prisma.player.count({ where: { user_id: user.id } });

            const aiQuota = await UsageService.checkQuota(user.id, UsageActionType.AI_ANALYZE, user.premium_tier);
            const handOcrQuota = await UsageService.checkQuota(user.id, UsageActionType.OCR_HAND, user.premium_tier);

            res.json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    premium_tier: user.premium_tier,
                    language: user.language,
                    subscription_expiry: user.subscription_expiry ?? null,
                    created_at: user.created_at,
                    is_admin: user.is_admin ?? false,
                    email_verified: user.email_verified ?? true,
                },
                plan: plan ?? null,
                stats: {
                    totalNotes,
                    totalPlayers,
                },
                usage: {
                    ai: { ...aiQuota, resetsAt: aiQuota.resetsAt.toISOString() },
                    hand_ocr: { ...handOcrQuota, resetsAt: handOcrQuota.resetsAt.toISOString() },
                },
                recentNotes,
            });
        } catch (err: any) {
            console.error('[AuthController] /me error:', err.message);
            res.json({ success: true, user, plan: null, stats: null, recentNotes: [] });
        }
    }
}
