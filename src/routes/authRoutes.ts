import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/authMiddleware';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();
const controller = new AuthController();

/**
 * Public Routes
 */
router.post('/register', asyncErrorWrapper((req, res) => controller.register(req, res)));
router.post('/login', asyncErrorWrapper((req, res) => controller.login(req, res)));

/**
 * Protected Routes (Require Authentication)
 */
router.get('/me', authMiddleware, asyncErrorWrapper((req, res) => controller.me(req, res)));
router.post('/logout', authMiddleware, asyncErrorWrapper((req, res) => controller.logout(req, res)));

export const authRoutes = router;
