import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { prisma } from '../lib/prisma';
import { nowPaymentsService } from '../services/nowPaymentsService';
import { paymentService } from '../services/paymentService';
import { NowPaymentsService } from '../services/nowPaymentsService';
import { config } from '../config/unifiedConfig';
import {
    createInvoiceSchema,
    webhookPayloadSchema,
    paymentStatusParamsSchema,
} from '../validators/payment.schema';

/**
 * Plan tier → price mapping (source of truth: backend).
 * Matches PricingPlan DB rows. Could fetch from DB for full dynamic pricing.
 */
const PLAN_PRICING: Record<string, number> = {
    PRO: 14.99,
    PRO_PLUS: 29.99,
    ENTERPRISE: 79.00,
};

export class PaymentController extends BaseController {

    /**
     * POST /api/payments/create-invoice
     * Body: { tierRequested: 'PRO'|'PRO_PLUS'|'ENTERPRISE' }
     * Rate limited: 5 req/min/user (applied in routes)
     */
    async createInvoice(req: Request, res: Response) {
        try {
            // ─── 1. Auth guard ───────────────────────────────────────────────────
            const user = (req as any).user;
            if (!user?.id) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // ─── 2. Validate input ───────────────────────────────────────────────
            const parseResult = createInvoiceSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({
                    success: false,
                    error: parseResult.error.issues[0]?.message ?? 'Invalid request'
                });
            }
            const { tierRequested } = parseResult.data;

            // ─── 3. Get price from database (not hardcoded) ─────────────────
            const plan = await (prisma as any).pricingPlan.findUnique({
                where: { id: tierRequested }
            });

            if (!plan || plan.price <= 0) {
                return res.status(400).json({ success: false, error: `Invalid or unavailable tier: ${tierRequested}` });
            }

            const priceAmount = plan.price;

            // ─── 4. Create internal invoice first (optimistic) ───────────────────
            const invoice = await prisma.invoice.create({
                data: {
                    user_id: user.id,
                    amount: priceAmount,
                    currency: 'USD',
                    tier_requested: tierRequested as any,
                    status: 'PENDING',
                }
            });

            // ─── 5. Call NOWPayments API ─────────────────────────────────────────
            let invoiceUrl = '';
            let nowpayments_id = '';

            if (!config.nowpayments.apiKey) {
                // No API key configured — return stub for development
                return this.handleSuccess(res, {
                    invoiceId: invoice.id,
                    amount: priceAmount,
                    currency: 'USD',
                    tier: tierRequested,
                    invoice_url: null,
                    message: 'NOWPayments API key not configured. Set NOWPAYMENTS_API_KEY in environment.',
                    sandbox: true,
                }, 201);
            }

            const externalInvoice = await nowPaymentsService.createInvoice({
                price_amount: priceAmount,
                price_currency: 'usd',
                order_id: invoice.id,
                order_description: `VillainVault ${tierRequested} Plan — 30 days`,
                success_url: config.nowpayments.successUrl,
                cancel_url: config.nowpayments.cancelUrl,
                is_fixed_rate: false,
                is_fee_paid_by_user: true, // User pays gas/network fees
            });

            invoiceUrl = externalInvoice.invoice_url;
            nowpayments_id = externalInvoice.id;

            // ─── 6. Persist external IDs ─────────────────────────────────────────
            await prisma.invoice.update({
                where: { id: invoice.id },
                data: { nowpayments_id }
            });

            // ─── 7. Log creation event ───────────────────────────────────────────
            await prisma.paymentEvent.create({
                data: {
                    invoice_id: invoice.id,
                    event_type: 'INVOICE_CREATED',
                    payload: {
                        nowpayments_id,
                        tier: tierRequested,
                        amount: priceAmount,
                        is_sandbox: config.nowpayments.isSandbox,
                    },
                    processed: true,
                }
            });

            return this.handleSuccess(res, {
                invoiceId: invoice.id,
                amount: priceAmount,
                currency: 'USD',
                tier: tierRequested,
                invoice_url: invoiceUrl,
                notice: 'Network fees may apply depending on your wallet.',
                sandbox: config.nowpayments.isSandbox,
            }, 201);
        } catch (error) {
            this.handleError(error, res, 'PaymentController.createInvoice');
        }
    }

    /**
     * POST /api/payments/webhook
     * Called by NOWPayments IPN system when payment status changes.
     * MUST: verify HMAC-SHA512 on raw body, be idempotent, return 200 always.
     * Rate limited: 10 req/s (applied in routes)
     */
    async handleWebhook(req: Request, res: Response) {
        // Always return 200 so NOWPayments doesn't retry indefinitely
        const respond = () => res.status(200).json({ success: true });

        try {
            const signature = req.headers['x-nowpayments-sig'] as string;
            const ipnSecret = config.nowpayments.ipnSecret;

            // ─── 1. Config guard ─────────────────────────────────────────────────
            if (!ipnSecret) {
                console.error('[Webhook] NOWPAYMENTS_IPN_SECRET not configured');
                return respond();
            }

            // ─── 2. Signature verification (mandatory) ───────────────────────────
            let signatureValid = false;

            if (!signature || !req.body || Object.keys(req.body).length === 0) {
                console.warn('[Webhook] Missing signature or empty body — rejecting');
                return respond();
            }

            signatureValid = NowPaymentsService.verifySignature(req.body, signature, ipnSecret);

            if (!signatureValid) {
                console.error('[Webhook] Invalid HMAC signature — request rejected');
                // Still return 200 so NOWPayments doesn't block on bad requests
                return respond();
            }

            // ─── 3. Validate payload with Zod ────────────────────────────────────
            const parseResult = webhookPayloadSchema.safeParse(req.body);
            if (!parseResult.success) {
                console.error('[Webhook] Invalid payload schema:', parseResult.error.issues);
                return respond();
            }

            const payload = parseResult.data;

            // ─── 4. Delegate to PaymentService (state machine) ───────────────────
            const result = await paymentService.processWebhook(payload, signatureValid);

            console.log(`[Webhook] Payment ${payload.payment_id} — Action: ${result.action} | Reason: ${result.reason}`);
            return respond();
        } catch (error) {
            console.error('[Webhook] Unhandled error:', error);
            return respond(); // Always 200 to prevent NOWPayments retry storm
        }
    }

    /**
     * GET /api/payments/:id/status
     * Returns current invoice status for the authenticated user.
     * Security: verifies ownership (invoice.user_id === req.user.id)
     */
    async getStatus(req: Request, res: Response) {
        try {
            // ─── 1. Auth guard ───────────────────────────────────────────────────
            const user = (req as any).user;
            if (!user?.id) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // ─── 2. Validate params ──────────────────────────────────────────────
            const parseResult = paymentStatusParamsSchema.safeParse(req.params);
            if (!parseResult.success) {
                return res.status(400).json({
                    success: false,
                    error: parseResult.error.issues[0]?.message ?? 'Invalid invoice ID'
                });
            }
            const { id } = parseResult.data;

            // ─── 3. Fetch invoice ────────────────────────────────────────────────
            const invoice = await prisma.invoice.findUnique({
                where: { id },
                select: {
                    id: true,
                    user_id: true,
                    status: true,
                    tier_requested: true,
                    amount: true,
                    actually_paid: true,
                    nowpayments_id: true,
                    is_upgraded: true,
                    last_webhook_at: true,
                    created_at: true,
                    updated_at: true,
                }
            });

            if (!invoice) {
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }

            // ─── 4. Ownership check ──────────────────────────────────────────────
            if (invoice.user_id !== user.id) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }

            // ─── 5. Return sanitized status (no sensitive internal IDs) ──────────
            return this.handleSuccess(res, {
                id: invoice.id,
                status: invoice.status,
                tier: invoice.tier_requested,
                amount: invoice.amount,
                actually_paid: invoice.actually_paid,
                is_upgraded: invoice.is_upgraded,
                last_webhook_at: invoice.last_webhook_at,
                created_at: invoice.created_at,
                updated_at: invoice.updated_at,
                ui_message: this.getUiMessage(invoice.status),
            });
        } catch (error) {
            this.handleError(error, res, 'PaymentController.getStatus');
        }
    }

    /**
     * Returns a user-friendly message for each invoice status.
     */
    private getUiMessage(status: string): string {
        const messages: Record<string, string> = {
            PENDING: 'Waiting for your payment...',
            CONFIRMING: 'Waiting for blockchain confirmations. This may take a few minutes.',
            FINISHED: 'Payment confirmed! Your subscription has been activated.',
            FAILED: 'Payment failed. Please try again.',
            EXPIRED: 'Payment window expired. Please create a new invoice.',
            MANUAL_REVIEW: 'Partial payment received — under manual review. Contact support.',
        };
        return messages[status] ?? 'Unknown status';
    }
}
