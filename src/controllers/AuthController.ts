import { Request, Response } from 'express';
import { AuthService } from '../services/AuthService';

export class AuthController {
    /**
     * POST /api/auth/register
     */
    async register(req: Request, res: Response) {
        try {
            const { email, password, deviceId } = req.body;
            if (!email || !password) {
                return res.status(400).json({ success: false, error: 'Email and password required' });
            }

            // Register user
            await AuthService.register(email, password);

            // Auto-login after registration
            const { token, user } = await AuthService.login(email, password, deviceId);

            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('token', token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });

            res.status(201).json({ success: true, token, user });
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

            // Set cookie (optional but professional)
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
            res.status(401).json({ success: false, error: error.message || 'Invalid credentials' });
        }
    }

    /**
     * POST /api/auth/logout
     */
    async logout(req: Request, res: Response) {
        try {
            // In a real middleware, req.user would have sessionId
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
     * Use case: Update premium status after payment without logout.
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
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });

            res.json({ success: true, token, user });
        } catch (error: any) {
            console.error('[AuthController] Refresh Error:', error.message);
            res.status(500).json({ success: false, error: 'Session refresh failed' });
        }
    }

    /**
     * GET /api/auth/me
     */
    async me(req: Request, res: Response) {
        // Authenticated user from middleware
        const user = (req as any).user;
        if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

        res.json({ success: true, user });
    }
}
