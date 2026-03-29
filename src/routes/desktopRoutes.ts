import { Router } from 'express';
import { DesktopController } from '../controllers/DesktopController';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();
const controller = new DesktopController();

// All desktop routes use API key authentication
router.use(apiKeyMiddleware);

// Verify API key and get user info
router.post('/verify-key', asyncErrorWrapper((req, res) => controller.verifyKey(req, res)));

// Get all player data (for initial load / daily sync)
router.get('/players', asyncErrorWrapper((req, res) => controller.getPlayerData(req, res)));

// Get detailed player info
router.get('/players/:id', asyncErrorWrapper((req, res) => controller.getPlayerDetail(req, res)));

// Batch search players by name (real-time HUD lookups)
router.post('/players/search', asyncErrorWrapper((req, res) => controller.searchPlayers(req, res)));

// Sync local data to server
router.post('/sync', asyncErrorWrapper((req, res) => controller.syncData(req, res)));

export const desktopRoutes = router;
