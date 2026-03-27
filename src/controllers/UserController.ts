import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { BaseController } from './BaseController';

export class UserController extends BaseController {
    /**
     * PATCH /api/users/profile
     */
    async updateProfile(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            if (!user) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }

            const { language } = req.body;

            // Optional fields validation
            const updateData: any = {};
            if (language) {
                if (['en', 'vi'].includes(language)) {
                    updateData.language = language;
                } else {
                    return res.status(400).json({ success: false, error: 'Invalid language code. Must be "en" or "vi".' });
                }
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ success: false, error: 'No valid fields provided for update.' });
            }

            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: updateData,
                select: { id: true, email: true, language: true, premium_tier: true }
            });

            return this.handleSuccess(res, updatedUser);
        } catch (error: any) {
            return this.handleError(error, res, 'updateProfile');
        }
    }
}
