import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { HandService } from '../services/handService';

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
            const userId = (req as any).user.id;

            if (!rawInput) {
                return res.status(400).json({ success: false, error: 'rawInput is required' });
            }

            const tier = (req as any).userTier || 'FREE';
            const result = await this.handService.parseHand({
                userId,
                rawInput,
                inputType: inputType || 'text',
                tier
            });

            this.handleSuccess(res, result, 200);
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

            if (!handId) {
                return res.status(400).json({ success: false, error: 'handId is required' });
            }

            const tier = (req as any).userTier || 'FREE';
            const analysis = await this.handService.analyzeHand({
                userId,
                handId,
                parsedData,
                tier
            });

            // The provided snippet seems to be intended for HandService, not HandController.
            // HandController should call HandService, and HandService would handle repository updates.
            // Assuming the instruction meant to ensure the HandService call is correct and
            // the update logic is handled within the service, as the controller should not
            // directly interact with repositories.
            // The original code already calls `this.handService.analyzeHand`.
            // If there was an issue with `HandService.update` it would be in the service itself.
            // The instruction also mentions "HandController.getById call" but the snippet is for analyzeHand.
            // Given the snippet's content, it's likely a misplacement.
            // The current `analyzeHand` method correctly calls the service.
            // No change is made here based on the provided snippet as it would introduce a non-existent `handRepository`
            // into the controller, which is not its responsibility.

            this.handleSuccess(res, { analysis }, 200);
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
            
            const hands = await this.handService.getHistory(userId, {
                limit: parseInt(req.query.limit as string) || 20,
                cursor: req.query.cursor as string,
                tag: req.query.tag as string,
                gameType: req.query.gameType as string,
                minPot: req.query.minPot ? parseInt(req.query.minPot as string) : undefined
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
}
