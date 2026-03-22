import { Router, Request, Response } from 'express';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import axios from 'axios';
import { LoggerService, LogType } from '../services/loggerService';

const router = Router();

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';

/**
 * POST /api/ocr/feedback
 * 
 * Handles user feedback from the OCR Confirmation / Correction UI.
 * Forwards the action to the OCR service Celery task `apply_feedback`.
 * 
 * Body:
 *   { imageHex: string, cardName: string, action: "confirm"|"edit"|"reject", correctedName?: string, handId?: string }
 */
router.post(
    '/feedback',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { imageHex, cardName, action, correctedName = '', handId } = req.body;
        const userId = (req as any).user?.id || 'system';

        if (!imageHex || !cardName || !action) {
            return res.status(400).json({ error: 'imageHex, cardName, and action are required.' });
        }

        if (!['confirm', 'edit', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be "confirm", "edit", or "reject".' });
        }

        if (action === 'edit' && !correctedName) {
            return res.status(400).json({ error: '"correctedName" is required for edit action.' });
        }

        try {
            // Log the feedback event for self-learning tracking
            await LoggerService.log(
                userId,
                LogType.OCR_FEEDBACK,
                action === 'confirm' 
                    ? `Confirmed detection of [${cardName}]`
                    : `Corrected [${cardName}] to [${correctedName}]`,
                { cardName, action, correctedName, imageHex: imageHex.slice(0, 16) + '...' },
                handId
            );

            const response = await axios.post(`${OCR_SERVICE_URL}/feedback`, {
                image_hex:      imageHex,
                card_name:      cardName,
                action:         action,
                corrected_name: correctedName,
            });
            return res.json({ status: 'ok', result: response.data });
        } catch (err: any) {
            return res.status(502).json({ error: 'OCR feedback service unavailable.', details: err.message });
        }
    })
);

/**
 * GET /api/ocr/status/:imageHash
 * 
 * Check if a previously processed image has a cached result.
 */
router.get(
    '/status/:imageHash',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { imageHash } = req.params;
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/status/${imageHash}`);
            return res.json(response.data);
        } catch (err: any) {
            return res.status(404).json({ status: 'not_found' });
        }
    })
);

export const ocrRoutes = router;
