import crypto from 'crypto';
import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { prisma } from '../lib/prisma';
import { InvoiceStatus, PremiumTier } from '@prisma/client';

export class PaymentController extends BaseController {

    /**
     * POST /api/payments/create-invoice
     * Body: { userId, tierRequested: 'PRO'|'PRO_PLUS'|'ENTERPRISE' }
     */
    async createInvoice(req: Request, res: Response) {
        try {
            const { userId, tierRequested } = req.body;

            if (!userId || !tierRequested) {
                return res.status(400).json({
                    success: false,
                    error: 'userId and tierRequested are required'
                });
            }

            // Calculate price based on tier
            const pricing: Record<string, number> = {
                'PRO': 14.99,
                'PRO_PLUS': 29.99,
                'ENTERPRISE': 79.00
            };

            const amount = pricing[tierRequested];
            if (!amount) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid tier: ${tierRequested}`
                });
            }

            // Create invoice record in DB
            const invoice = await prisma.invoice.create({
                data: {
                    user_id: userId,
                    amount,
                    currency: 'USD',
                    tier_requested: tierRequested as PremiumTier,
                    status: 'PENDING'
                }
            });

            // TODO: Call NOWPayments API to create external invoice
            // const externalInvoice = await nowPaymentsClient.createInvoice({
            //     price_amount: amount,
            //     price_currency: 'usd',
            //     order_id: invoice.id,
            //     ...
            // });
            //
            // await prisma.invoice.update({
            //     where: { id: invoice.id },
            //     data: { nowpayments_id: externalInvoice.id }
            // });

            this.handleSuccess(res, {
                invoiceId: invoice.id,
                amount,
                currency: 'USD',
                tier: tierRequested,
                // paymentUrl: externalInvoice.invoice_url  // TODO
                message: 'NOWPayments API integration pending. Configure NOWPAYMENTS_API_KEY.'
            }, 201);
        } catch (error) {
            this.handleError(error, res, 'PaymentController.createInvoice');
        }
    }

    /**
     * POST /api/payments/webhook
     * Called by NOWPayments when payment status changes.
     * MUST be idempotent and verify HMAC signature.
     */
    async handleWebhook(req: Request, res: Response) {
        try {
            const signature = req.headers['x-nowpayments-sig'] as string;
            const secret = process.env.NOWPAYMENTS_IPN_SECRET;

            if (!secret) {
                console.error('[Webhook] NOWPAYMENTS_IPN_SECRET not configured');
                return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
            }

            if (!signature) {
                return res.status(401).json({ success: false, error: 'Missing signature' });
            }

            // Verify HMAC SHA-512 signature
            const sortedPayload = this.sortObject(req.body);
            const hmac = crypto.createHmac('sha512', secret);
            const calculatedSig = hmac.update(JSON.stringify(sortedPayload)).digest('hex');

            if (calculatedSig !== signature) {
                console.error('[Webhook] Signature mismatch');
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const { order_id, payment_status } = req.body;

            if (payment_status !== 'finished') {
                // Not a completed payment — acknowledge but don't process
                return res.status(200).json({ success: true, message: 'Status noted' });
            }

            // IDEMPOTENCY: Check if invoice is already FINISHED
            const invoice = await prisma.invoice.findUnique({
                where: { id: order_id }
            });

            if (!invoice) {
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }

            if (invoice.status === 'FINISHED') {
                // Already processed — return 200 to prevent retries
                return res.status(200).json({ success: true, message: 'Already processed' });
            }

            // Transaction: Update invoice + Unlock user tier
            await prisma.$transaction([
                prisma.invoice.update({
                    where: { id: order_id },
                    data: {
                        status: InvoiceStatus.FINISHED,
                        nowpayments_id: req.body.payment_id?.toString()
                    }
                }),
                prisma.user.update({
                    where: { id: invoice.user_id },
                    data: {
                        premium_tier: invoice.tier_requested,
                        subscription_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days
                    }
                })
            ]);

            console.log(`[Webhook] User ${invoice.user_id} upgraded to ${invoice.tier_requested}`);
            this.handleSuccess(res, { message: 'Payment processed successfully' });
        } catch (error) {
            this.handleError(error, res, 'PaymentController.handleWebhook');
        }
    }

    /**
     * Sort object keys recursively for consistent HMAC calculation.
     */
    private sortObject(obj: any): any {
        if (typeof obj !== 'object' || obj === null) return obj;
        if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));
        return Object.keys(obj)
            .sort()
            .reduce((sorted: any, key: string) => {
                sorted[key] = this.sortObject(obj[key]);
                return sorted;
            }, {});
    }
}
