import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController';

const router = Router();

// AI Settings
router.get('/ai', SettingsController.getAISettings);
router.patch('/ai', SettingsController.updateAISettings);

export const settingRoutes = router;
