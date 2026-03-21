import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';

const router = Router();
const dashboardController = new DashboardController();

// GET /api/dashboard
router.get('/', dashboardController.getDashboard);

export default router;
