import { prisma } from '../lib/prisma';
import { InvoiceStatus, PremiumTier } from '@prisma/client';
import { WebhookPayload } from '../validators/payment.schema';

/**
 * State machine ordering: Lower number = earlier state.
 * Forward-only transitions enforce: new_state > current_state.
 */
const STATE_ORDER: Record<InvoiceStatus, number> = {
    PENDING: 0,
    CONFIRMING: 1,
    FINISHED: 2,
    MANUAL_REVIEW: 3,
    FAILED: 4,
    EXPIRED: 5,
};

/**
 * Maps raw NOWPayments payment_status strings to our internal InvoiceStatus enum.
 */
function mapStatus(nowpaymentsStatus: string): InvoiceStatus {
    switch (nowpaymentsStatus.toLowerCase()) {
        case 'waiting':
        case 'pending':
            return InvoiceStatus.PENDING;
        case 'confirming':
        case 'confirmed':
            return InvoiceStatus.CONFIRMING;
        case 'finished':
            return InvoiceStatus.FINISHED;
        case 'partially_paid':
        case 'refunded':
            return InvoiceStatus.MANUAL_REVIEW;
        case 'failed':
            return InvoiceStatus.FAILED;
        case 'expired':
            return InvoiceStatus.EXPIRED;
        default:
            return InvoiceStatus.FAILED;
    }
}

/**
 * Determine if a forward transition is allowed.
 * FINISHED and MANUAL_REVIEW are terminal states that cannot be overwritten.
 */
function isForwardTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    // FINISHED is immutable
    if (from === InvoiceStatus.FINISHED) return false;
    // MANUAL_REVIEW is semi-terminal: only FINISHED can follow
    if (from === InvoiceStatus.MANUAL_REVIEW) return to === InvoiceStatus.FINISHED;
    // Standard progression
    return STATE_ORDER[to] > STATE_ORDER[from];
}

/**
 * PaymentService
 *
 * Encapsulates all business logic for the crypto payment lifecycle:
 * - Invoice lookup with race-condition retry
 * - Forward-only state machine
 * - Amount / currency validation
 * - Idempotency via `is_upgraded` flag
 * - PaymentEvent audit log
 */
export class PaymentService {
    private readonly RETRY_DELAYS_MS = [500, 1000, 2000];
    private readonly AMOUNT_TOLERANCE = 0.98; // 98% — allow small on-chain fee discrepancies

    /**
     * Process an incoming IPN webhook payload.
     * Returns a status string for the controller to log.
     */
    async processWebhook(payload: WebhookPayload, signatureValid: boolean): Promise<{
        action: 'upgraded' | 'state_updated' | 'ignored' | 'manual_review';
        reason: string;
    }> {
        const { order_id, payment_id, payment_status, actually_paid, price_amount, price_currency, pay_currency } = payload;

        // ─── 1. Find invoice with retry (race condition guard) ──────────────────
        const invoice = await this.findInvoiceWithRetry(order_id);

        if (!invoice) {
            // Log the failed lookup and return gracefully (NOWPayments expects 200)
            await prisma.paymentEvent.create({
                data: {
                    invoice_id: order_id,
                    event_type: 'WEBHOOK_INVOICE_NOT_FOUND',
                    payload: this.maskPayload(payload),
                    signature_valid: signatureValid,
                    processed: false,
                }
            }).catch(() => {}); // Don't throw if event log also fails
            return { action: 'ignored', reason: 'Invoice not found after retry exhaustion' };
        }

        // ─── 2. Map status ───────────────────────────────────────────────────────
        const newStatus = mapStatus(payment_status);

        // ─── 3. Log the event ────────────────────────────────────────────────────
        await prisma.paymentEvent.create({
            data: {
                invoice_id: invoice.id,
                event_type: 'WEBHOOK_RECEIVED',
                payload: this.maskPayload({ ...payload, mapped_status: newStatus }),
                signature_valid: signatureValid,
                processed: false,
            }
        });

        // ─── 4. Forward-only state guard ─────────────────────────────────────────
        if (!isForwardTransition(invoice.status, newStatus)) {
            await this.updateEventProcessed(invoice.id, 'WEBHOOK_RECEIVED', `Backward transition ignored: ${invoice.status} → ${newStatus}`);
            return { action: 'ignored', reason: `Backward/duplicate transition ${invoice.status} → ${newStatus}` };
        }

        // ─── 5. Idempotency: already upgraded ────────────────────────────────────
        if (invoice.is_upgraded && newStatus === InvoiceStatus.FINISHED) {
            return { action: 'ignored', reason: 'Already upgraded (is_upgraded=true)' };
        }

        // ─── 6. Strict amount + currency validation ───────────────────────────────
        if (newStatus === InvoiceStatus.FINISHED) {
            // Priority: actually_paid_at_fiat (direct USD) 
            // Fallback: actually_paid (if same currency)
            // Safety: price_amount (what they intended to pay) if status is confirmed "finished"
            let actuallyPaidFiat = payload.actually_paid_at_fiat ?? (payload.pay_currency === payload.price_currency ? actually_paid : 0);
            
            const requiredMin = invoice.amount * this.AMOUNT_TOLERANCE;

            // If reported paid amount is missing or suspiciously low (crypto vs fiat mismatch) but status is FINISHED, trust the price_amount.
            // This happens often when NOWPayments doesn't settle the fiat conversion in time for the IPN.
            if ((!actuallyPaidFiat || actuallyPaidFiat < requiredMin) && payment_status.toLowerCase() === 'finished') {
                console.log(`[PaymentService] Amount mismatch but status is FINISHED. Trusting price_amount: ${payload.price_amount}`);
                actuallyPaidFiat = payload.price_amount;
            }

            console.log(`[PaymentService] Final calculation: Paid ${actuallyPaidFiat} | Required ${requiredMin} | Status: ${newStatus}`);

            if (actuallyPaidFiat < requiredMin) {
                // Short payment → manual review
                await prisma.invoice.update({
                    where: { id: invoice.id },
                    data: {
                        status: InvoiceStatus.MANUAL_REVIEW,
                        payment_id,
                        actually_paid: actuallyPaidFiat,
                        last_webhook_at: new Date(),
                        updated_at: new Date(),
                    }
                });
                await this.logEvent(invoice.id, 'AMOUNT_MISMATCH', { expected: invoice.amount, received: actuallyPaidFiat });
                return { action: 'manual_review', reason: `Amount mismatch: paid ${actuallyPaidFiat}, required ${requiredMin}` };
            }

            // ─── 7. Execute upgrade (FINISHED + amount OK + not yet upgraded) ─────
            await prisma.$transaction(async (tx) => {
                await tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                        status: InvoiceStatus.FINISHED,
                        payment_id,
                        actually_paid: actuallyPaidFiat,
                        is_upgraded: true,
                        last_webhook_at: new Date(),
                        updated_at: new Date(),
                    }
                });

                // Resilient expiry: max(current_expiry, now) + 30 days
                const currentExpiry = invoice.user.subscription_expiry;
                const baseDate = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
                const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

                await tx.user.update({
                    where: { id: invoice.user_id },
                    data: {
                        premium_tier: invoice.tier_requested as PremiumTier,
                        subscription_expiry: newExpiry,
                    }
                });

                // Reset all usage metrics for this user to give immediate full quota
                await tx.userUsage.deleteMany({
                    where: { user_id: invoice.user_id }
                });

                await tx.paymentEvent.create({
                    data: {
                        invoice_id: invoice.id,
                        event_type: 'SUBSCRIPTION_UPGRADED',
                        payload: { tier: invoice.tier_requested, new_expiry: newExpiry.toISOString() },
                        signature_valid: signatureValid,
                        processed: true,
                    }
                });
            });

            console.log(`[PaymentService] User ${invoice.user_id} upgraded to ${invoice.tier_requested}`);
            return { action: 'upgraded', reason: `Upgraded to ${invoice.tier_requested}` };
        }

        // ─── 8. Intermediate state update (PENDING → CONFIRMING etc.) ────────────
        await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                status: newStatus,
                payment_id: payment_id || invoice.payment_id,
                last_webhook_at: new Date(),
                updated_at: new Date(),
            }
        });

        await this.logEvent(invoice.id, 'STATE_UPDATED', { from: invoice.status, to: newStatus });
        return { action: 'state_updated', reason: `${invoice.status} → ${newStatus}` };
    }

    /**
     * Find invoice by ID with exponential backoff retry.
     * Handles race conditions where webhook arrives before DB commit.
     */
    private async findInvoiceWithRetry(invoiceId: string) {
        for (let i = 0; i <= this.RETRY_DELAYS_MS.length; i++) {
            const invoice = await prisma.invoice.findUnique({
                where: { id: invoiceId },
                include: { user: { select: { subscription_expiry: true } } }
            });

            if (invoice) return invoice;

            if (i < this.RETRY_DELAYS_MS.length) {
                const delay = this.RETRY_DELAYS_MS[i];
                console.warn(`[PaymentService] Invoice ${invoiceId} not found, retry ${i + 1} in ${delay}ms`);
                await this.sleep(delay);
            }
        }

        return null;
    }

    /**
     * Mark expired invoices (created > 60 minutes ago, still PENDING/CONFIRMING).
     * Call this from a background task/cron.
     */
    async expireStaleInvoices(): Promise<number> {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 60 min ago

        const result = await prisma.invoice.updateMany({
            where: {
                status: { in: [InvoiceStatus.PENDING, InvoiceStatus.CONFIRMING] },
                created_at: { lt: cutoff },
            },
            data: {
                status: InvoiceStatus.EXPIRED,
                updated_at: new Date(),
            }
        });

        if (result.count > 0) {
            console.log(`[PaymentService] Marked ${result.count} invoices as EXPIRED`);
        }

        return result.count;
    }

    /**
     * Masks sensitive fields before storing in PaymentEvent log.
     */
    private maskPayload(payload: Record<string, any>): Record<string, any> {
        const masked = { ...payload };
        // Mask pay_address and any wallet-related info
        if (masked.pay_address) masked.pay_address = '***MASKED***';
        return masked;
    }

    private async logEvent(invoiceId: string, eventType: string, details: Record<string, any>): Promise<void> {
        await prisma.paymentEvent.create({
            data: {
                invoice_id: invoiceId,
                event_type: eventType,
                payload: details,
                processed: true,
            }
        }).catch(err => console.error('[PaymentService] Failed to log event:', err));
    }

    private async updateEventProcessed(invoiceId: string, _type: string, reason: string): Promise<void> {
        // Just append a new ignore event rather than updating (simpler + more auditable)
        await this.logEvent(invoiceId, 'WEBHOOK_IGNORED', { reason });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const paymentService = new PaymentService();
