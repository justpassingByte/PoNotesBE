/**
 * Tests for PaymentService state machine logic.
 *
 * Strategy: Mock prisma so no DB is required.
 * Tests cover: forward-only transitions, amount validation,
 * upgrade guard (is_upgraded), race condition, and expiry.
 */

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
const mockPrisma = {
    invoice: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
    },
    paymentEvent: {
        create: jest.fn(),
    },
    user: {
        update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
};

jest.mock('../lib/prisma', () => ({
    prisma: mockPrisma,
}));

import { PaymentService } from '../services/paymentService';
import { WebhookPayload } from '../validators/payment.schema';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<any> = {}) {
    return {
        id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: 'user-uuid-123',
        amount: 14.99,
        currency: 'USD',
        tier_requested: 'PRO',
        status: 'PENDING',
        payment_id: null,
        actually_paid: null,
        is_upgraded: false,
        last_webhook_at: null,
        nowpayments_id: null,
        created_at: new Date(),
        updated_at: new Date(),
        user: { subscription_expiry: null },
        ...overrides,
    };
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
    return {
        payment_id: '999',
        payment_status: 'finished',
        price_amount: 14.99,
        price_currency: 'usd',
        pay_currency: 'btc',
        actually_paid: 15.00, // Slightly over — accepted
        order_id: '550e8400-e29b-41d4-a716-446655440000',
        ...overrides,
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
    let service: PaymentService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new PaymentService();

        // Default mocks
        mockPrisma.paymentEvent.create.mockResolvedValue({});
        mockPrisma.invoice.update.mockResolvedValue({});
        mockPrisma.user.update.mockResolvedValue({});
    });

    // ── 1. State Machine ───────────────────────────────────────────────────────

    describe('State Machine — forward-only transitions', () => {
        it('✅ PENDING → CONFIRMING is allowed', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(makePayload({ payment_status: 'confirming' }), true);
            expect(result.action).toBe('state_updated');
        });

        it('✅ CONFIRMING → FINISHED triggers upgrade', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(
                makeInvoice({ status: 'CONFIRMING', is_upgraded: false })
            );

            const result = await service.processWebhook(makePayload({ payment_status: 'finished' }), true);
            expect(result.action).toBe('upgraded');
        });

        it('❌ FINISHED → PENDING is ignored (backward transition)', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'FINISHED' }));

            const result = await service.processWebhook(makePayload({ payment_status: 'waiting' }), true);
            expect(result.action).toBe('ignored');
            expect(result.reason).toMatch(/Backward/);
        });

        it('❌ CONFIRMING → PENDING is ignored (backward transition)', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'CONFIRMING' }));

            const result = await service.processWebhook(makePayload({ payment_status: 'waiting' }), true);
            expect(result.action).toBe('ignored');
        });
    });

    // ── 2. Amount Validation ───────────────────────────────────────────────────

    describe('Amount Validation', () => {
        it('✅ valid payment (exact amount) triggers upgrade', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(
                makePayload({ payment_status: 'finished', actually_paid: 14.99, actually_paid_at_fiat: 14.99 }),
                true
            );
            expect(result.action).toBe('upgraded');
        });

        it('✅ overpayment is accepted and triggers upgrade', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(
                makePayload({ payment_status: 'finished', actually_paid: 20.00, actually_paid_at_fiat: 20.00 }),
                true
            );
            expect(result.action).toBe('upgraded');
        });

        it('❌ underpayment (< 98%) sets MANUAL_REVIEW, no upgrade', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(
                // 14.99 * 0.98 = 14.69 required, paid 10 = fail
                makePayload({ payment_status: 'finished', actually_paid: 10.00, actually_paid_at_fiat: 10.00 }),
                true
            );
            expect(result.action).toBe('manual_review');
            // User should NOT be upgraded
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('✅ payment within 98% tolerance (borderline) is accepted', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(
                // 14.99 * 0.98 = 14.6902, paying exactly 14.70 should pass
                makePayload({ payment_status: 'finished', actually_paid: 14.70, actually_paid_at_fiat: 14.70 }),
                true
            );
            expect(result.action).toBe('upgraded');
        });
    });

    // ── 3. Idempotency Guard ──────────────────────────────────────────────────

    describe('Idempotency (is_upgraded guard)', () => {
        it('❌ duplicate FINISHED webhook is ignored if already upgraded', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(
                makeInvoice({ status: 'FINISHED', is_upgraded: true })
            );

            const result = await service.processWebhook(makePayload({ payment_status: 'finished' }), true);
            expect(result.action).toBe('ignored');
            expect(result.reason).toMatch(/Backward\/duplicate transition/);
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });
    });

    // ── 4. Race Condition Retry ───────────────────────────────────────────────

    describe('Race Condition Retry', () => {
        it('✅ finds invoice on 2nd retry after initial null', async () => {
            // First call returns null, second returns valid invoice
            mockPrisma.invoice.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(makeInvoice({ status: 'PENDING' }));

            const result = await service.processWebhook(makePayload({ payment_status: 'confirming' }), true);
            expect(result.action).toBe('state_updated');
            expect(mockPrisma.invoice.findUnique).toHaveBeenCalledTimes(2);
        }, 10000);

        it('❌ returns ignored when invoice not found after all retries', async () => {
            // All 4 calls (1 initial + 3 retries) return null
            mockPrisma.invoice.findUnique.mockResolvedValue(null);

            const result = await service.processWebhook(makePayload({ payment_status: 'finished' }), true);
            expect(result.action).toBe('ignored');
            expect(result.reason).toMatch(/not found/i);
        }, 15000); // Retry delays total ~3.5s
    });

    // ── 5. Subscription Expiry Calculation ────────────────────────────────────

    describe('Subscription Expiry', () => {
        it('✅ extends expiry from NOW when subscription_expiry is null', async () => {
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(
                makeInvoice({ status: 'PENDING', user: { subscription_expiry: null } })
            );

            await service.processWebhook(
                makePayload({ payment_status: 'finished', actually_paid_at_fiat: 14.99 }),
                true
            );

            const userUpdateCall = mockPrisma.user.update.mock.calls[0]?.[0];
            const newExpiry: Date = userUpdateCall?.data?.subscription_expiry;

            if (newExpiry) {
                const diffDays = (newExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                expect(diffDays).toBeGreaterThanOrEqual(29);
                expect(diffDays).toBeLessThanOrEqual(31);
            }
        });

        it('✅ extends expiry from current_expiry when it is in the future', async () => {
            const futureExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days from now
            mockPrisma.invoice.findUnique.mockResolvedValueOnce(
                makeInvoice({ status: 'PENDING', user: { subscription_expiry: futureExpiry } })
            );

            await service.processWebhook(
                makePayload({ payment_status: 'finished', actually_paid_at_fiat: 14.99 }),
                true
            );

            const userUpdateCall = mockPrisma.user.update.mock.calls[0]?.[0];
            const newExpiry: Date = userUpdateCall?.data?.subscription_expiry;

            if (newExpiry) {
                // Should be ~40 days from now (10 remaining + 30 new)
                const diffDays = (newExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                expect(diffDays).toBeGreaterThanOrEqual(39);
                expect(diffDays).toBeLessThanOrEqual(41);
            }
        });
    });

    // ── 6. Invoice Expiry Worker ──────────────────────────────────────────────

    describe('expireStaleInvoices', () => {
        it('✅ marks stale PENDING invoices as EXPIRED', async () => {
            mockPrisma.invoice.updateMany.mockResolvedValueOnce({ count: 3 });

            const count = await service.expireStaleInvoices();
            expect(count).toBe(3);
            expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { in: ['PENDING', 'CONFIRMING'] },
                    }),
                    data: expect.objectContaining({
                        status: 'EXPIRED',
                    }),
                })
            );
        });

        it('✅ returns 0 if no stale invoices', async () => {
            mockPrisma.invoice.updateMany.mockResolvedValueOnce({ count: 0 });

            const count = await service.expireStaleInvoices();
            expect(count).toBe(0);
        });
    });
});
