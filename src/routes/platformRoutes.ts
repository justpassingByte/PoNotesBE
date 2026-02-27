import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

router.get('/', asyncErrorWrapper(async (req, res) => {
    const platforms = await prisma.platform.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: platforms });
}));

export const platformRoutes = router;
