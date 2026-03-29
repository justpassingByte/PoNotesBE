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
router.get('/verify-email', asyncErrorWrapper((req, res) => controller.verifyEmail(req, res)));
router.post('/resend-verification', asyncErrorWrapper((req, res) => controller.resendVerification(req, res)));
router.post('/forgot-password', asyncErrorWrapper((req, res) => controller.forgotPassword(req, res)));
router.post('/reset-password', asyncErrorWrapper((req, res) => controller.resetPassword(req, res)));

/**
 * Protected Routes (Require Authentication)
 */
router.get('/me', authMiddleware, asyncErrorWrapper((req, res) => controller.me(req, res)));
router.post('/refresh-session', authMiddleware, asyncErrorWrapper((req, res) => controller.refreshSession(req, res)));
router.post('/logout', authMiddleware, asyncErrorWrapper((req, res) => controller.logout(req, res)));

export const authRoutes = router;
