import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// GET /api/settings — returns current app settings
router.get('/', asyncErrorWrapper(async (req, res) => {
    // Upsert to ensure the singleton always exists
    const settings = await prisma.appSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ai_enabled: false, analysis_mode: 'simple' },
        update: {}
    });
    res.json({ success: true, data: settings });
}));

// PATCH /api/settings — update app settings
router.patch('/', asyncErrorWrapper(async (req, res) => {
    const { ai_enabled, analysis_mode } = req.body;

    const updateData: Record<string, unknown> = {};
    if (typeof ai_enabled === 'boolean') updateData.ai_enabled = ai_enabled;
    if (analysis_mode === 'simple' || analysis_mode === 'advanced') updateData.analysis_mode = analysis_mode;

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const settings = await prisma.appSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ai_enabled: false, analysis_mode: 'simple', ...updateData },
        update: updateData
    });

    res.json({ success: true, data: settings });
}));

export const settingsRoutes = router;
