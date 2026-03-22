import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

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
    const { id, name, price, description, features, ai_limit, ocr_limit, is_popular, color_theme } = req.body;

    const plan = await (prisma as any).pricingPlan.upsert({
        where: { id },
        update: {
            name,
            price: parseFloat(price),
            description,
            features,
            ai_limit: parseInt(ai_limit),
            ocr_limit: parseInt(ocr_limit),
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
            ocr_limit: parseInt(ocr_limit),
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

// GET /api/admin/stats - Overview stats
router.get('/stats', isAdmin, asyncErrorWrapper(async (req, res) => {
    const totalUsers = await prisma.user.count();
    const premiumUsers = await prisma.user.count({ where: { premium_tier: { not: 'FREE' } } });
    
    // Revenue calc from Invoices
    const paidInvoices = await prisma.invoice.findMany({ where: { status: 'FINISHED' } });
    const totalRevenue = paidInvoices.reduce((acc, inv) => acc + (inv.amount || 0), 0);
    
    // Recent hands count
    const totalHands = await prisma.hand.count();

    res.json({
        success: true,
        data: {
            totalUsers,
            premiumUsers,
            totalRevenue,
            totalHands,
            conversionRate: totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : 0
        }
    });
}));

// GET /api/admin/users - List users with their usage and expiry
router.get('/users', isAdmin, asyncErrorWrapper(async (req, res) => {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            premium_tier: true,
            is_admin: true,
            subscription_expiry: true,
            created_at: true,
            _count: { select: { hands: true } },
            usages: {
                orderBy: { period_start: 'desc' },
                take: 5 // Get most recent usage buckets
            }
        },
        orderBy: { created_at: 'desc' }
    });
    res.json({ success: true, data: users });
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

export const adminRoutes = router;

