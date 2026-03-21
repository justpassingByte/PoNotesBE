import { Router } from 'express';
import { SessionController } from '../controllers/SessionController';
import { SessionService } from '../services/sessionService';
import { SessionRepository } from '../repositories/SessionRepository';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// Dependency Injection Setup
const repository = new SessionRepository();
const service = new SessionService(repository);
const controller = new SessionController(service);

router.post('/register', asyncErrorWrapper((req, res) => controller.register(req, res)));
router.post('/force-logout', asyncErrorWrapper((req, res) => controller.forceLogout(req, res)));
router.post('/logout-all', asyncErrorWrapper((req, res) => controller.logoutAll(req, res)));
router.get('/:userId', asyncErrorWrapper((req, res) => controller.getSessions(req, res)));

export const sessionRoutes = router;
