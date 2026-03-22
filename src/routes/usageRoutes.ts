import { Router } from 'express';
import { UsageController } from '../controllers/UsageController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const usageController = new UsageController();

// GET /api/usage?action=AI_ANALYZE|OCR_HAND|OCR_NAME
router.get('/', authMiddleware, (req, res) => usageController.getQuota(req, res));

export default router;
