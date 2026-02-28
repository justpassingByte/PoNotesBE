import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

router.get('/', asyncErrorWrapper(async (req, res) => {
    const platforms = await prisma.platform.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: platforms });
}));

router.post('/', asyncErrorWrapper(async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Name is required' });
    }

    // Check for duplicate
    const existing = await prisma.platform.findFirst({ where: { name: name.trim() } });
    if (existing) {
        return res.status(409).json({ success: false, error: 'Platform already exists' });
    }

    const platform = await prisma.platform.create({
        data: { name: name.trim() }
    });
    res.status(201).json({ success: true, data: platform });
}));

router.delete('/:id', asyncErrorWrapper(async (req, res) => {
    const id = req.params.id as string;
    // Check if any players are using this platform
    const playerCount = await prisma.player.count({ where: { platform_id: id } });
    if (playerCount > 0) {
        return res.status(400).json({ success: false, error: `Cannot delete: ${playerCount} player(s) still use this platform` });
    }
    await prisma.platform.delete({ where: { id } });
    res.json({ success: true });
}));

export const platformRoutes = router;
