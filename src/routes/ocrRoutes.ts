import { Router, Request, Response } from 'express';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import axios from 'axios';
import { LoggerService, LogType } from '../services/loggerService';

const router = Router();

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';

import multer from 'multer';
import FormData from 'form-data';

const upload = multer();

/**
 * POST /api/ocr/feedback
 * 
 * Handles user feedback from the OCR Confirmation / Correction UI.
 * Forwards the action to the OCR service /feedback endpoint via multipart/form-data.
 * 
 * Body (FormData):
 *   file: image file
 *   cardName: string
 *   action: "confirm"|"edit"|"reject"
 *   correctedName?: string
 *   handId?: string
 *   cardIndex?: string
 */
router.post(
    '/feedback',
    upload.single('file'),
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { cardName, action, correctedName = '', handId, cardIndex } = req.body;
        const file = req.file;
        const userId = (req as any).user?.id || 'system';

        if (!file || !cardName || !action) {
            return res.status(400).json({ error: 'file, cardName, and action are required.' });
        }

        if (!['confirm', 'edit', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be "confirm", "edit", or "reject".' });
        }

        if (action === 'edit' && !correctedName) {
            return res.status(400).json({ error: '"correctedName" is required for edit action.' });
        }

        try {
            await LoggerService.log(
                userId,
                LogType.OCR_FEEDBACK,
                action === 'confirm' 
                    ? `Confirmed detection of [${cardName}]`
                    : `Corrected [${cardName}] to [${correctedName}]`,
                { cardName, action, correctedName, fileBytes: file.size },
                handId
            );

            console.log(`[OCR_NEURAL_TRAIN] Transmitting visual map for '${action}'. Card: [${cardName}] -> [${correctedName || ''}] to Core Vision Engine...`);
            
            const formData = new FormData();
            formData.append('file', file.buffer, file.originalname || 'feedback.png');
            formData.append('card_name', cardName);
            formData.append('action', action);
            if (correctedName) formData.append('corrected_name', correctedName);
            if (cardIndex !== undefined) formData.append('card_index', cardIndex);
            
            const response = await axios.post(`${OCR_SERVICE_URL}/feedback`, formData, {
                headers: formData.getHeaders(),
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
        
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/templates/${type}/${filename}`, {
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

/**
 * GET /api/ocr/failed-cases
 */
router.get(
    '/failed-cases',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/failed-cases`);
            return res.json({ success: true, data: response.data.failed_cases });
        } catch (err: any) {
            console.error(`[OCR_SERVICE] Failed to fetch failed cases:`, err.message);
            return res.status(502).json({ success: false, error: 'Failed to fetch failed cases' });
        }
    })
);

/**
 * POST /api/ocr/failed-cases/label
 */
router.post(
    '/failed-cases/label',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        try {
            const response = await axios.post(`${OCR_SERVICE_URL}/failed-cases/label`, req.body);
            return res.json({ success: true, data: response.data });
        } catch (err: any) {
            console.error(`[OCR_SERVICE] Failed to label failed case:`, err.message);
            return res.status(err.response?.status || 502).json({ success: false, error: err.message });
        }
    })
);

/**
 * GET /api/ocr/templates_failed/:subfolder/:filename
 */
router.get(
    '/templates_failed/:subfolder/:filename',
    asyncErrorWrapper(async (req: Request, res: Response) => {
        const { subfolder, filename } = req.params;
        try {
            const response = await axios.get(`${OCR_SERVICE_URL}/templates_failed/${subfolder}/${filename}`, {
                responseType: 'stream'
            });
            res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
            return response.data.pipe(res);
        } catch (err: any) {
            return res.status(err.response?.status || 502).json({ success: false, error: 'Failed' });
        }
    })
);

export const ocrRoutes = router;
