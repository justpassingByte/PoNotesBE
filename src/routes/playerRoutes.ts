import { Router } from 'express';
import { PlayerController } from '../controllers/PlayerController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

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

// Single Create
router.post(
    '/',
    asyncErrorWrapper((req, res) => controller.create(req, res))
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

// Delete player
router.delete(
    '/:id',
    asyncErrorWrapper((req, res) => controller.delete(req, res))
);

// Update player
router.put(
    '/:id',
    asyncErrorWrapper((req, res) => controller.update(req, res))
);

// Trigger re-analysis/aggregation (quota-gated by controller logic)
router.post(
    '/profile/refresh',
    asyncErrorWrapper((req, res) => controller.refreshProfile(req, res))
);

export const playerRoutes = router;
