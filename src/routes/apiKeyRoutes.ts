import { Router } from 'express';
import { ApiKeyController } from '../controllers/ApiKeyController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();
const controller = new ApiKeyController();

// All routes require authentication (via authMiddleware applied in app.ts)
router.post('/', asyncErrorWrapper((req, res) => controller.create(req, res)));
router.get('/', asyncErrorWrapper((req, res) => controller.list(req, res)));
router.delete('/:id', asyncErrorWrapper((req, res) => controller.revoke(req, res)));
router.delete('/:id/permanent', asyncErrorWrapper((req, res) => controller.deleteKey(req, res)));
router.delete('/:id/devices/:deviceId', asyncErrorWrapper((req, res) => controller.removeDevice(req, res)));

export const apiKeyRoutes = router;
