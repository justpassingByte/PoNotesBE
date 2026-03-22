import { z } from 'zod';

/**
 * Zod schema for POST /api/payments/create-invoice
 */
export const createInvoiceSchema = z.object({
    tierRequested: z.enum(['PRO', 'PRO_PLUS', 'ENTERPRISE'], 'tierRequested must be PRO, PRO_PLUS, or ENTERPRISE'),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/**
 * Zod schema for NOWPayments IPN webhook payload
 * Validates the incoming webhook before processing.
 */
export const webhookPayloadSchema = z.object({
    payment_id: z.union([z.string(), z.number()]).transform(v => String(v)),
    payment_status: z.string(),
    price_amount: z.coerce.number(),
    price_currency: z.string(),
    pay_currency: z.string(),
    actually_paid: z.coerce.number().optional().default(0),
    actually_paid_at_fiat: z.coerce.number().optional(),
    order_id: z.string().uuid('order_id must be a valid UUID'),
    order_description: z.string().optional(),
    purchase_id: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/**
 * Zod schema for GET /api/payments/:id/status
 */
export const paymentStatusParamsSchema = z.object({
    id: z.string().uuid('id must be a valid UUID'),
});
