import { Router } from 'express';
import { HandController } from '../controllers/HandController';
import { HandService } from '../services/handService';
import { HandRepository } from '../repositories/HandRepository';
import { UsageService } from '../services/usageService';
import { checkUsageQuota } from '../middleware/usageMiddleware';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// Dependency Injection Setup
const handRepository = new HandRepository();
const usageService = new UsageService();
const handService = new HandService(handRepository, usageService);
const controller = new HandController(handService);

// Phase 1: Parse (OCR) — quota-gated
router.post(
    '/analyze/parse',
    checkUsageQuota('OCR_HAND'),
    asyncErrorWrapper((req, res) => controller.parseHand(req, res))
);

// Phase 2: Analyze (LLM) — quota-gated
router.post(
    '/analyze/analyze',
    checkUsageQuota('AI_ANALYZE'),
    asyncErrorWrapper((req, res) => controller.analyzeHand(req, res))
);

// Hand history — no quota needed
router.get('/history', asyncErrorWrapper((req, res) => controller.getHistory(req, res)));

// Single hand by ID
router.get('/:id', asyncErrorWrapper((req, res) => controller.getById(req, res)));

export const handRoutes = router;
