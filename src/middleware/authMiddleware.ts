import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/AuthService';

const JWT_SECRET = process.env.JWT_SECRET || 'villainvault-super-secret-key';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // 1. Get token from Header or Cookie
        const authHeader = req.headers.authorization;
        const cookieToken = req.cookies?.token;
        const token = cookieToken || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

        if (!token) {
            return res.status(401).json({ success: false, error: 'Authorization token missing' });
        }

        // 2. Decode & Verify JWT
        const decoded: any = jwt.verify(token, JWT_SECRET);
        const { userId, sessionId } = decoded;

        // 3. Verify Session exists in DB (CRITICAL for multi-device logout)
        const user = await AuthService.verifySession(sessionId);
        if (!user) {
            return res.status(440).json({ success: false, error: 'Session expired or invalidated' });
        }

        // 4. Attach to request
        (req as any).user = user;
        (req as any).sessionId = sessionId;

        next();
    } catch (error: any) {
        console.error('[AuthMiddleware] Error:', error.message);
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
};
