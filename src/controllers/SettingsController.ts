import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import { buildProfilePrompt, buildHandAnalysisPrompt } from '../services/promptManager';

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
                    is_enabled: true,
                    ai_style: 'Balanced',
                    aggression_bias: 50,
                    insight_depth: 'Deep',
                    behavior_toggles: {
                        softInference: true,
                        forceExploit: false,
                        highlightLeaks: true
                    },
                    hand_style: 'Balanced',
                    hand_aggression_bias: 50,
                    hand_insight_depth: 'Deep',
                    hand_behavior_toggles: {
                        softInference: true,
                        forceExploit: false,
                        highlightLeaks: true
                    }
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
        const { 
            system_prompt, 
            analysis_prompt, 
            model_name, 
            temperature, 
            is_enabled,
            ai_style,
            aggression_bias,
            insight_depth,
            behavior_toggles,
            hand_style,
            hand_aggression_bias,
            hand_insight_depth,
            hand_behavior_toggles
        } = req.body;

        const config = await prisma.userAIConfig.upsert({
            where: { user_id: userId },
            create: {
                user_id: userId,
                system_prompt,
                analysis_prompt,
                model_name,
                temperature: temperature ?? 0.7,
                is_enabled: is_enabled ?? true,
                // @ts-ignore
                ai_style: ai_style ?? 'Balanced',
                aggression_bias: aggression_bias ?? 50,
                insight_depth: insight_depth ?? 'Deep',
                behavior_toggles: behavior_toggles ?? {
                    softInference: true,
                    forceExploit: false,
                    highlightLeaks: true
                },
                hand_style: hand_style ?? 'Balanced',
                hand_aggression_bias: hand_aggression_bias ?? 50,
                hand_insight_depth: hand_insight_depth ?? 'Deep',
                hand_behavior_toggles: hand_behavior_toggles ?? {
                    softInference: true,
                    forceExploit: false,
                    highlightLeaks: true
                }
            },
            update: {
                system_prompt,
                analysis_prompt,
                model_name,
                temperature,
                is_enabled,
                // @ts-ignore
                ai_style,
                aggression_bias,
                insight_depth,
                behavior_toggles,
                hand_style,
                hand_aggression_bias,
                hand_insight_depth,
                hand_behavior_toggles
            }
        });

        return res.json({ success: true, data: config });
    });
    /**
     * Preview AI Prompts based on settings
     */
    static getAIPreview = asyncErrorWrapper(async (req: Request, res: Response) => {
        const { ai_style, aggression_bias, insight_depth, behavior_toggles, hand_style, hand_aggression_bias, hand_insight_depth, hand_behavior_toggles } = req.body;
        
        const profilePrompt = buildProfilePrompt(undefined, { 
            ai_style, 
            aggression_bias, 
            insight_depth, 
            behavior_toggles 
        });
        
        const analysisPrompt = buildHandAnalysisPrompt(undefined, {
            hand_style,
            hand_aggression_bias,
            hand_insight_depth,
            hand_behavior_toggles
        });

        return res.json({ 
            success: true, 
            data: { 
                system_prompt: profilePrompt,
                analysis_prompt: analysisPrompt 
            } 
        });
    });
}
