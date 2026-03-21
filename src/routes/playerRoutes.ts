import { Router } from 'express';
import { PlayerController } from '../controllers/PlayerController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import { checkUsageQuota } from '../middleware/usageMiddleware';

const router = Router();
const controller = new PlayerController();

// List / Pagination
router.get(
    '/',
    asyncErrorWrapper((req, res) => controller.list(req, res))
);

// Bulk Create / Import
router.post(
    '/bulk',
    asyncErrorWrapper((req, res) => controller.bulkCreate(req, res))
);

// Export all data (Must come before :id route)
router.get(
    '/export',
    asyncErrorWrapper((req, res) => controller.export(req, res))
);

// Get profile
router.get(
    '/profile', 
    asyncErrorWrapper((req, res) => controller.getProfile(req, res))
);

// Get by ID
router.get(
    '/:id',
    asyncErrorWrapper((req, res) => controller.getById(req, res))
);

// Trigger re-analysis/aggregation (quota-gated because it uses LLM)
router.post(
    '/profile/refresh',
    checkUsageQuota('AI_ANALYZE'), // Re-profiling uses LLM tokens
    asyncErrorWrapper((req, res) => controller.refreshProfile(req, res))
);

export const playerRoutes = router;
