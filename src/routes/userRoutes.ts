import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();
const controller = new UserController();

// PATCH /api/users/profile
router.patch('/profile', asyncErrorWrapper((req, res) => controller.updateProfile(req, res)));

export const userRoutes = router;
