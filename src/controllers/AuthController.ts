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

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
            
            res.clearCookie('token');
            res.json({ success: true, message: 'Logged out successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Logout failed' });
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
