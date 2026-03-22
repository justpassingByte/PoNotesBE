import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { PaymentController } from '../controllers/PaymentController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const controller = new PaymentController();

/**
 * Rate limiter: /create-invoice — 5 requests per minute per user (by IP as proxy)
 */
const createInvoiceLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    keyGenerator: (req: Request) => {
        const user = (req as any).user;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        return user?.id || ip?.toString() || 'unknown';
    },
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            success: false,
            error: 'Too many invoice creation requests. Please wait 1 minute.'
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Rate limiter: /webhook — 10 requests per second
 */
const webhookLimiter = rateLimit({
    windowMs: 1000, // 1 second
    max: 10,
    handler: (_req: Request, res: Response) => {
        // NOWPayments expects 200 — don't block their retries
        res.status(200).json({ success: true });
    },
    standardHeaders: true,
    legacyHeaders: false,
});



// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/payments/create-invoice
 * Create a NOWPayments invoice for a premium tier upgrade.
 */
router.post(
    '/create-invoice',
    authMiddleware,
    createInvoiceLimiter,
    asyncErrorWrapper((req, res) => controller.createInvoice(req, res))
);

/**
 * POST /api/payments/webhook
 * NOWPayments IPN webhook endpoint.
 * Verify signature against standard JSON parsed body.
 */
/**
 * GET /api/payments/public-plans
 * Publicly accessible list of pricing plans for the landing page.
 */
router.get(
    '/public-plans',
    asyncErrorWrapper((req, res) => controller.getPublicPlans(req, res))
);

router.post(
    '/webhook',
    webhookLimiter,
    asyncErrorWrapper((req, res) => controller.handleWebhook(req, res))
);

/**
 * GET /api/payments/:id/status
 * Poll invoice status. User must own the invoice.
 */
router.get(
    '/:id/status',
    authMiddleware,
    asyncErrorWrapper((req, res) => controller.getStatus(req, res))
);

router.post(
    '/:id/simulate-success',
    authMiddleware,
    asyncErrorWrapper((req, res) => controller.simulateSuccess(req, res))
);

export const paymentRoutes = router;
