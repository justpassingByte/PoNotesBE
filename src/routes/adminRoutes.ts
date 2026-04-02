import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { backupController } from '../controllers/backupController';

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

const router = Router();

// Middleware to check if user is admin
const isAdmin = (req: any, res: any, next: any) => {
    if (req.user && req.user.is_admin) {
        next();
    } else {
        res.status(403).json({ success: false, error: 'Access denied. Admin only.' });
    }
};

// GET /api/admin/pricing - Get all plans (Public-ish, but registered under admin)
router.get('/pricing/public', asyncErrorWrapper(async (req, res) => {
    const plans = await (prisma as any).pricingPlan.findMany({
        orderBy: { price: 'asc' }
    });
    res.json({ success: true, data: plans });
}));

// GET /api/admin/pricing - Get all plans (Admin only)
router.get('/pricing', isAdmin, asyncErrorWrapper(async (req, res) => {
    const plans = await (prisma as any).pricingPlan.findMany({
        orderBy: { price: 'asc' }
    });
    res.json({ success: true, data: plans });
}));

// POST /api/admin/pricing - Create or update a plan
router.post('/pricing', isAdmin, asyncErrorWrapper(async (req, res) => {
    const { id, name, price, description, features, ai_limit, name_ocr_limit, hand_ocr_limit, max_devices, is_popular, color_theme } = req.body;

    const plan = await (prisma as any).pricingPlan.upsert({
        where: { id },
        update: {
            name,
            price: parseFloat(price),
            description,
            features,
            ai_limit: parseInt(ai_limit),
            name_ocr_limit: parseInt(name_ocr_limit) || 0,
            hand_ocr_limit: parseInt(hand_ocr_limit) || 0,
            max_devices: parseInt(max_devices) || 1,
            is_popular,
            color_theme
        },
        create: {
            id,
            name,
            price: parseFloat(price),
            description,
            features,
            ai_limit: parseInt(ai_limit),
            name_ocr_limit: parseInt(name_ocr_limit) || 0,
            hand_ocr_limit: parseInt(hand_ocr_limit) || 0,
            max_devices: parseInt(max_devices) || 1,
            is_popular: is_popular || false,
            color_theme: color_theme || 'gold'
        }
    });

    res.json({ success: true, data: plan });
}));

// SEED /api/admin/pricing/seed - Initial data seed
router.post('/pricing/seed', isAdmin, asyncErrorWrapper(async (req, res) => {
    const initialPlans = [
        {
            id: "FREE",
            name: "Trial",
            price: 0,
            description: "Perfect for casual players wanting to see what AI can do.",
            features: ["2 AI Analysis / Day", "5 Name OCR / Day", "2 Full Hand OCR / Day", "Basic Player Profiles"],
            ai_limit: 2,
            ocr_limit: 2,
            is_popular: false,
            color_theme: "blue"
        },
        {
            id: "PRO",
            name: "Pro",
            price: 29,
            description: "For serious grinders playing multiple sessions per week.",
            features: ["100 AI Analysis / Month", "100 Full OCR / Month", "Advanced Leak Detection", "Exploit Strategy"],
            ai_limit: 100,
            ocr_limit: 100,
            is_popular: true,
            color_theme: "gold"
        },
        {
            id: "PRO_PLUS",
            name: "Elite",
            price: 59,
            description: "Unleash the full power of Claude 3.5 Sonnet logic.",
            features: ["500 AI Analysis / Month", "300 Full OCR / Month", "GTO Baseline Comparison", "VGG OCR"],
            ai_limit: 500,
            ocr_limit: 300,
            is_popular: false,
            color_theme: "purple"
        }
    ];

    for (const plan of initialPlans) {
        await (prisma as any).pricingPlan.upsert({
            where: { id: plan.id },
            update: plan,
            create: plan
        });
    }

    res.json({ success: true, message: 'Pricing plans seeded successfully' });
}));

// DELETE /api/admin/pricing/:id - Delete a plan
router.delete('/pricing/:id', isAdmin, asyncErrorWrapper(async (req, res) => {
    const { id } = req.params;
    await (prisma as any).pricingPlan.delete({ where: { id } });
    res.json({ success: true, message: 'Plan deleted' });
}));

// GET /api/admin/stats - Overview stats with real growth and activity
router.get('/stats', isAdmin, asyncErrorWrapper(async (req, res) => {
    const totalUsers = await prisma.user.count();
    const premiumUsers = await prisma.user.count({ where: { premium_tier: { not: 'FREE' } } });
    
    // Revenue calc from Invoices
    const paidInvoices = await prisma.invoice.findMany({ 
        where: { status: 'FINISHED' },
        orderBy: { created_at: 'desc' },
        take: 20, // Most recent for activity
        include: { user: { select: { email: true } } }
    });
    
    const allPaidInvoices = await prisma.invoice.findMany({ where: { status: 'FINISHED' } });
    const totalRevenue = allPaidInvoices.reduce((acc, inv) => acc + (inv.amount || 0), 0);
    
    // Recent hands count
    const totalHands = await prisma.hand.count();

    // Power Users (at least 1 hand)
    const powerUsers = await prisma.user.count({
        where: { hands: { some: {} } }
    });

    // Growth Metrics (Last 7 days registration)
    const growth = [];
    for (let i = 6; i >= 0; i--) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - i);
        
        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        const count = await prisma.user.count({
            where: { created_at: { gte: start, lt: end } }
        });
        growth.push(count);
    }

    res.json({
        success: true,
        data: {
            totalUsers,
            premiumUsers,
            totalRevenue,
            totalHands,
            loyalUsers: powerUsers,
            conversionRate: totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : 0,
            growth,
            recentActivity: paidInvoices.map(inv => ({
                id: inv.id,
                email: inv.user.email,
                amount: inv.amount,
                tier: inv.tier_requested,
                date: inv.created_at
            }))
        }
    });
}));

// GET /api/admin/users - List users with filters
router.get('/users', isAdmin, asyncErrorWrapper(async (req, res) => {
    const { tier, status, search, verified } = req.query;
    
    const where: any = {};
    
    if (tier && tier !== 'ALL') {
        where.premium_tier = tier;
    }
    
    if (status) {
        if (status === 'EXPIRED') {
            where.subscription_expiry = { lte: new Date() };
            where.premium_tier = { not: 'FREE' };
        } else if (status === 'ACTIVE') {
            where.subscription_expiry = { gte: new Date() };
        }
    }

    if (verified === 'true') {
        where.email_verified = true;
    } else if (verified === 'false') {
        where.email_verified = false;
    }
    
    if (search) {
        where.email = { contains: search as string, mode: 'insensitive' };
    }

    const users = await (prisma.user as any).findMany({
        where,
        select: {
            id: true,
            email: true,
            email_verified: true,
            premium_tier: true,
            is_admin: true,
            subscription_expiry: true,
            created_at: true,
            _count: { select: { hands: true } },
            usages: {
                orderBy: { period_start: 'desc' },
                take: 1
            }
        },
        orderBy: { created_at: 'desc' }
    });
    res.json({ success: true, data: users });
}));

// DELETE /api/admin/users/:id - Delete a user
router.delete('/users/:id', isAdmin, asyncErrorWrapper(async (req, res) => {
    const { id } = req.params;
    await (prisma.user as any).delete({ where: { id } });
    res.json({ success: true, message: 'User deleted successfully' });
}));

// GET /api/admin/revenue - Monthly revenue chart data
router.get('/revenue-chart', isAdmin, asyncErrorWrapper(async (req, res) => {
    const invoices = await prisma.invoice.findMany({
        where: { status: 'FINISHED' },
        select: { amount: true, created_at: true }
    });

    const monthlyData: Record<string, number> = {};
    invoices.forEach(inv => {
        const month = inv.created_at.toISOString().slice(0, 7); // YYYY-MM
        monthlyData[month] = (monthlyData[month] || 0) + (inv.amount || 0);
    });

    res.json({ success: true, data: monthlyData });
}));

// POST /api/admin/users/update-subscription - Admin manually updates a user's plan
router.post('/users/update-subscription', isAdmin, asyncErrorWrapper(async (req, res) => {
    const { userId, tier, expiryDays } = req.body;

    const updateData: any = {
        premium_tier: tier,
    };

    if (expiryDays) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
        updateData.subscription_expiry = expiryDate;
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData
    });

    res.json({ success: true, data: updatedUser });
}));

// POST /api/admin/promote-me - Promote current user to admin (temporary or if requested)
router.post('/promote-me', asyncErrorWrapper(async (req, res) => {
    const { secret } = req.body;
    // Simple safety check: check against an environment variable or a hardcoded one in dev
    if (secret !== process.env.ADMIN_SECRET && secret !== 'villainvault_secret_2026') {
        return res.status(401).json({ success: false, error: 'Invalid secret key' });
    }

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    await (prisma.user as any).update({
        where: { id: userId },
        data: { is_admin: true }
    });

    res.json({ success: true, message: 'You are now an administrator.' });
}));

// GET /api/admin/db/settings - Get current backup email
router.get('/db/settings', isAdmin, backupController.getSettings);

// POST /api/admin/db/settings - Update backup email
router.post('/db/settings', isAdmin, backupController.updateSettings);

// POST /api/admin/db/backup - Trigger manual backup
router.post('/db/backup', isAdmin, backupController.triggerBackup);

// POST /api/admin/db/restore - Upload and restore backup
router.post('/db/restore', isAdmin, upload.single('backup'), backupController.restoreBackup);

export const adminRoutes = router;

