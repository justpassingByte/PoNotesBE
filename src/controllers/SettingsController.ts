import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import { buildProfilePrompt } from '../services/promptManager';

export class SettingsController {
    /**
     * Get AI Settings for current user
     */
    static getAISettings = asyncErrorWrapper(async (req: Request, res: Response) => {
        const userId = (req as any).user.id;
        
        let config = await prisma.userAIConfig.findUnique({
            where: { user_id: userId }
        });

        // If no config exists, return defaults
        if (!config) {
            return res.json({
                success: true,
                data: {
                    user_id: userId,
                    system_prompt: buildProfilePrompt(),
                    analysis_prompt: "", // Default to empty (uses promptManager one)
                    model_name: 'llama-3.3-70b-versatile',
                    temperature: 0.7,
                    is_enabled: true
                }
            });
        }

        return res.json({ success: true, data: config });
    });

    /**
     * Update AI Settings
     */
    static updateAISettings = asyncErrorWrapper(async (req: Request, res: Response) => {
        const userId = (req as any).user.id;
        const { system_prompt, analysis_prompt, model_name, temperature, is_enabled } = req.body;

        const config = await prisma.userAIConfig.upsert({
            where: { user_id: userId },
            create: {
                user_id: userId,
                system_prompt,
                analysis_prompt,
                model_name,
                temperature: temperature ?? 0.7,
                is_enabled: is_enabled ?? true
            },
            update: {
                system_prompt,
                analysis_prompt,
                model_name,
                temperature,
                is_enabled
            }
        });

        return res.json({ success: true, data: config });
    });
}
