import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { HandService } from '../services/handService';
import { UsageService } from '../services/usageService';
import { UsageActionType } from '@prisma/client';

/** Serialize usage object — convert resetsAt Date to ISO string for JSON transport */
function serializeUsage(usage: { allowed: boolean; used: number; limit: number; remaining: number; resetsAt: Date }) {
    return { ...usage, resetsAt: usage.resetsAt.toISOString() };
}

export class HandController extends BaseController {
    constructor(private readonly handService: HandService) {
        super();
    }

    /**
     * Phase 1: POST /api/hands/analyze/parse
     * Body: { rawInput, inputType }
     */
    async parseHand(req: Request, res: Response) {
        try {
            const { rawInput, inputType } = req.body;
            const file = (req as any).file;
            const userId = (req as any).user.id;
            const tier = (req as any).user.premium_tier || 'FREE';

            if (!rawInput && !file) {
                return res.status(400).json({ success: false, error: 'rawInput or file is required' });
            }

            // Check OCR quota specifically for images
            let usage = undefined;
            if (inputType === 'image') {
                usage = await UsageService.checkQuota(userId, UsageActionType.OCR_HAND, tier);
                if (!usage.allowed) {
                    return res.status(403).json({ success: false, error: 'OCR hand limit reached', usage: serializeUsage(usage) });
                }
            }

            const result = await this.handService.parseHand({
                userId,
                rawInput,
                fileBytes: file?.buffer,
                fileName: file?.originalname,
                mimeType: file?.mimetype,
                inputType: inputType || 'text',
                tier
            });

            // Re-fetch usage info after processing if it was an image
            if (inputType === 'image' && !result.fromCache) {
                usage = await UsageService.checkQuota(userId, UsageActionType.OCR_HAND, tier);
            }

            this.handleSuccess(res, { ...result, usage: usage ? serializeUsage(usage) : undefined }, 200);
        } catch (error) {
            this.handleError(error, res, 'HandController.parseHand');
        }
    }

    /**
     * Phase 2: POST /api/hands/analyze/analyze
     * Body: { handId, parsedData? }
     */
    async analyzeHand(req: Request, res: Response) {
        try {
            const { handId, parsedData } = req.body;
            const userId = (req as any).user.id;
            const tier = (req as any).user.premium_tier || 'FREE';

            if (!handId) {
                return res.status(400).json({ success: false, error: 'handId is required' });
            }

            // Check AI quota
            let usage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);
            if (!usage.allowed) {
                return res.status(403).json({ success: false, error: 'AI analysis limit reached', usage: serializeUsage(usage) });
            }

            const analysis = await this.handService.analyzeHand({
                userId,
                handId,
                parsedData,
                tier
            });

            // Refresh usage info
            usage = await UsageService.checkQuota(userId, UsageActionType.AI_ANALYZE, tier);

            this.handleSuccess(res, { analysis, usage: serializeUsage(usage) }, 200);
        } catch (error) {
            this.handleError(error, res, 'HandController.analyzeHand');
        }
    }

    /**
     * GET /api/hands/history?userId=...&limit=...&cursor=...&tag=...
     */
    async getHistory(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            
            const minPotRaw = req.query.minPot as string;
            const minPot = (minPotRaw && !isNaN(parseInt(minPotRaw))) ? parseInt(minPotRaw) : undefined;
            
            const hands = await this.handService.getHistory(userId, {
                limit: parseInt(req.query.limit as string) || 20,
                cursor: req.query.cursor as string,
                tag: req.query.tag as string,
                gameType: req.query.gameType as string,
                minPot: minPot,
                playerName: req.query.playerName as string
            });

            this.handleSuccess(res, hands);
        } catch (error) {
            this.handleError(error, res, 'HandController.getHistory');
        }
    }

    /**
     * GET /api/hands/:id
     */
    async getById(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const userId = (req as any).user.id;
            const hand = await this.handService.getHandById(userId, id);

            if (!hand) {
                return res.status(404).json({
                    success: false,
                    error: 'Hand not found'
                });
            }

            this.handleSuccess(res, hand);
        } catch (error) {
            this.handleError(error, res, 'HandController.getById');
        }
    }

    /**
     * DELETE /api/hands/:id
     */
    async deleteHand(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const userId = (req as any).user.id;
            const success = await this.handService.deleteHand(userId, id);

            if (!success) {
                return res.status(404).json({ success: false, error: 'Hand not found' });
            }

            this.handleSuccess(res, { success: true, message: 'Hand deleted' });
        } catch (error) {
            this.handleError(error, res, 'HandController.deleteHand');
        }
    }
}
