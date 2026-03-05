import { Router } from 'express';
import { SolverController } from '../controllers/SolverController';

const router = Router();

/**
 * POST /api/solve
 * Solve a poker strategy based on spot, stack, board, villain type, and shaping mode
 */
router.post('/', SolverController.solve);

export { router as solverRoutes };
