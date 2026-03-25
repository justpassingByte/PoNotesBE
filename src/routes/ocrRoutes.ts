import { Router, Request, Response } from 'express';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import axios from 'axios';
import { LoggerService, LogType } from '../services/loggerService';
import { prisma } from '../lib/prisma';

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
        const { imageHex, cardName, action, correctedName = '', handId, cardIndex } = req.body;
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

            // AUTO-LEARNING ENGINE FOR OCR (Fixed Race Condition with upsert)
            if (action === 'edit') {
                await prisma.template.upsert({
                    where: { label_category: { label: correctedName, category: 'card_ocr' } },
                    update: { weight: { increment: 1 } },
                    create: { label: correctedName, category: 'card_ocr', weight: 1 }
                });
            } else if (action === 'confirm') {
                await prisma.template.upsert({
                    where: { label_category: { label: cardName, category: 'card_ocr' } },
                    update: { weight: { increment: 1 } },
                    create: { label: cardName, category: 'card_ocr', weight: 1 }
                });
            } else if (action === 'reject') {
                try {
                    await prisma.template.update({
                        where: { label_category: { label: cardName, category: 'card_ocr' } },
                        data: { weight: { decrement: 1 } }
                    });
                } catch (e: any) {
                    // It's perfectly fine if we reject a non-existing template
                }
            }

            console.log(`[OCR_NEURAL_TRAIN] Transmitting visual map for '${action}'. Card: [${cardName}] -> [${correctedName || ''}] to Core Vision Engine...`);
            
            const response = await axios.post(`${OCR_SERVICE_URL}/feedback`, {
                image_hex:      imageHex,
                card_name:      cardName,
                action:         action,
                corrected_name: correctedName,
                card_index:     cardIndex,
            });
            
            console.log(`[OCR_NEURAL_TRAIN] Vision Engine acknowledged learning for [${correctedName || cardName}]. Cache Updated.`);
            
            return res.json({ status: 'ok', result: response.data });
        } catch (err: any) {
            console.error(`[OCR_NEURAL_TRAIN] Critical failure communicating with Vision Engine:`, err.message);
            return res.status(502).json({ error: 'OCR feedback service unavailable.', details: err.message });
        }
    })
);

/**
 * GET /api/ocr/templates
 * Fetches the list of all saved card and anchor templates from the OCR service.
 */
router.get(
    '/templates',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/templates`);
            return res.json({ success: true, data: response.data.templates });
        } catch (err: any) {
            console.error(`[OCR_SERVICE] Failed to fetch templates:`, err.message);
            return res.status(502).json({ success: false, error: 'Failed to fetch OCR templates from Vision Engine.' });
        }
    })
);

/**
 * DELETE /api/ocr/templates/:type/:filename
 * Deletes a specific template file from the OCR service.
 */
router.delete(
    '/templates/:type/:filename',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { type, filename } = req.params;
        try {
            const response = await axios.delete(`${OCR_SERVICE_URL}/templates/${type}/${filename}`);
            return res.json({ success: true, message: response.data.message });
        } catch (err: any) {
            console.error(`[OCR_SERVICE] Failed to delete template ${filename}:`, err.message);
            return res.status(err.response?.status || 502).json({ 
                success: false, 
                error: err.response?.data?.detail || 'Failed to delete template from Vision Engine.' 
            });
        }
    })
);

/**
 * GET /api/ocr/templates/:type/:filename
 * Proxies the template image from the OCR service.
 */
router.get(
    '/templates/:type/:filename',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { type, filename } = req.params;
        const normalizedType = type === 'card' ? 'cards' : type === 'anchor' ? 'anchors' : type;
        
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/templates/${normalizedType}/${filename}`, {
                responseType: 'stream'
            });
            res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
            return response.data.pipe(res);
        } catch (err: any) {
            console.error(`[OCR_SERVICE] Failed to fetch template image ${filename}:`, err.message);
            return res.status(err.response?.status || 502).json({ 
                success: false, 
                error: 'Failed to fetch template image from Vision Engine.' 
            });
        }
    })
);

export const ocrRoutes = router;
