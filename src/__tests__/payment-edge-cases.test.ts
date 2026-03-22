/**
 * Dedicated Edge Case Tests for Crypto Payment Gateway.
 * These tests specifically address the 5 scenarios requested by the user:
 * 1. Duplicate Webhooks
 * 2. Wrong Order Webhooks
 * 3. Underpayment
 * 4. Overpayment
 * 5. Delayed Webhooks
 */

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
const mockPrisma = {
    invoice: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        updateManyRaw: jest.fn(),
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
import { InvoiceStatus } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<any> = {}) {
    return {
        id: 'invoice-uuid-123',
        user_id: 'user-uuid-123',
        amount: 29.99,
        currency: 'USD',
        tier_requested: 'PRO_PLUS',
        status: InvoiceStatus.PENDING,
        is_upgraded: false,
        user: { subscription_expiry: null },
        ...overrides,
    };
}

function makePayload(status: string, overrides: Partial<WebhookPayload> = {}): WebhookPayload {
    return {
        payment_id: 'pay-777',
        payment_status: status,
        price_amount: 29.99,
        price_currency: 'usd',
        pay_currency: 'usdttrc20',
        actually_paid: 29.99,
        order_id: 'invoice-uuid-123',
        ...overrides,
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Crypto Payment Gateway — Edge Case Validation', () => {
    let service: PaymentService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new PaymentService();
        mockPrisma.paymentEvent.create.mockResolvedValue({});
        mockPrisma.invoice.update.mockResolvedValue({});
        mockPrisma.user.update.mockResolvedValue({});
    });

    /**
     * Case 1: Webhook gửi 2 lần (duplicate)
     * Requirement: Second webhook should be ignored gracefully.
     */
    it('1️⃣ Handles duplicate webhooks (IDEMPOTENCY)', async () => {
        // Mock state: already FINISHED
        mockPrisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.FINISHED, is_upgraded: true }));

        const result = await service.processWebhook(makePayload('finished'), true);
        
        expect(result.action).toBe('ignored');
        expect(result.reason).toMatch(/Backward\/duplicate transition/);
        expect(mockPrisma.user.update).not.toHaveBeenCalled(); // No double upgrade
    });

    /**
     * Case 2: Webhook gửi sai thứ tự
     * Requirement: If 'confirming' arrives after 'finished', ignore 'confirming'.
     */
    it('2️⃣ Handles out-of-order webhooks (STATE MACHINE GUARD)', async () => {
        // Mock state: already FINISHED
        mockPrisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.FINISHED, is_upgraded: true }));

        // Receive 'confirming' (which should strictly precede 'finished')
        const result = await service.processWebhook(makePayload('confirming'), true);
        
        expect(result.action).toBe('ignored');
        expect(result.reason).toMatch(/Backward\/duplicate transition/);
        expect(mockPrisma.invoice.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CONFIRMING' } }));
    });

    /**
     * Case 3: User trả thiếu tiền
     * Requirement: Set status to MANUAL_REVIEW, no upgrade.
     */
    it('3️⃣ Handles underpayment (CURRENCY/AMOUNT VALIDATION)', async () => {
        mockPrisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.PENDING }));

        // User pays $10 instead of $29.99
        const result = await service.processWebhook(makePayload('finished', { actually_paid: 10.00, actually_paid_at_fiat: 10.00 }), true);
        
        expect(result.action).toBe('manual_review');
        expect(result.reason).toMatch(/Amount mismatch/);
        expect(mockPrisma.user.update).not.toHaveBeenCalled(); // 🚨 CRITICAL: No upgrade if underpaid
        
        // Verify DB updated to MANUAL_REVIEW
        expect(mockPrisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'invoice-uuid-123' },
            data: expect.objectContaining({ status: InvoiceStatus.MANUAL_REVIEW })
        }));
    });

    /**
     * Case 4: User trả dư tiền
     * Requirement: Upgrade user (overpayment is accepted).
     */
    it('4️⃣ Handles overpayment (TOLERANCE SYSTEM)', async () => {
        mockPrisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.PENDING }));

        // User pays $35 instead of $29.99
        const result = await service.processWebhook(makePayload('finished', { actually_paid: 35.00, actually_paid_at_fiat: 35.00 }), true);
        
        expect(result.action).toBe('upgraded');
        expect(mockPrisma.user.update).toHaveBeenCalled(); // Upgrade granted
    });

    /**
     * Case 5: Webhook delay 2–5 phút
     * Requirement: Process regardless of timing, handling race conditions if it arrives very early.
     */
    it('5️⃣ Handles delayed webhooks (RESILIENCE)', async () => {
        // A delayed webhook is just a normal webhook arriving later.
        // We test the lookup retry logic which handles the "too early" case.
        
        // Scenario: Webhook arrives but DB hasn't committed invoice yet
        mockPrisma.invoice.findUnique
            .mockResolvedValueOnce(null) // 1st try: not found
            .mockResolvedValueOnce(null) // 2nd try: not found
            .mockResolvedValueOnce(makeInvoice({ status: InvoiceStatus.PENDING })); // 3rd try: found!

        const result = await service.processWebhook(makePayload('finished'), true);
        
        expect(result.action).toBe('upgraded');
        expect(mockPrisma.invoice.findUnique).toHaveBeenCalledTimes(3); // Verified retry logic
    }, 15000); // 15s timeout for the retries to execute

    /**
     * Case 6: Key sorting in Signature Verification
     * Requirement: Ensure our service ignores the order of keys in the incoming JSON
     */
    it('6️⃣ Correctly verifies signature regardless of JSON key order (CRYPTOGRAPHY)', () => {
        const crypto = require('crypto');
        const { NowPaymentsService } = require('../services/nowPaymentsService');
        const SECRET = 'test-secret';
        
        // Object with random key order
        const incomingPayload = {
            zeta: 100,
            alpha: 1,
            nested: { y: 2, x: 1 }
        };

        // Canonical representation (sorted)
        const canonicalStr = JSON.stringify({
            alpha: 1,
            nested: { x: 1, y: 2 },
            zeta: 100
        });
        const correctSignature = crypto.createHmac('sha512', SECRET).update(canonicalStr).digest('hex');

        // Test verifySignature expects incomingPayload, NOT canonically sorted one
        const isValid = NowPaymentsService.verifySignature(incomingPayload, correctSignature, SECRET);
        expect(isValid).toBe(true);
    });
});
