import { Router } from 'express';
import { HandController } from '../controllers/HandController';
import { HandService } from '../services/handService';
import { HandRepository } from '../repositories/HandRepository';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

import multer from 'multer';
const upload = multer();

// Dependency Injection Setup
const handRepository = new HandRepository();
const handService = new HandService(handRepository);
const controller = new HandController(handService);

// Phase 1: Parse (OCR or text) — quota checked inside controller (inputType-aware)
router.post(
    '/analyze/parse',
    upload.single('file'),
    asyncErrorWrapper((req, res) => controller.parseHand(req, res))
);

// Phase 2: Analyze (LLM) — quota checked inside controller
router.post(
    '/analyze/analyze',
    asyncErrorWrapper((req, res) => controller.analyzeHand(req, res))
);

// Hand history — no quota needed
router.get('/history', asyncErrorWrapper((req, res) => controller.getHistory(req, res)));

// Single hand by ID
router.get('/:id', asyncErrorWrapper((req, res) => controller.getById(req, res)));

// Delete a hand
router.delete('/:id', asyncErrorWrapper((req, res) => controller.deleteHand(req, res)));

export const handRoutes = router;
