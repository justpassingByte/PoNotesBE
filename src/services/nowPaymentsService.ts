import axios, { AxiosInstance } from 'axios';
import { config } from '../config/unifiedConfig';

/**
 * NOWPayments invoice creation payload
 */
export interface CreateInvoicePayload {
    price_amount: number;
    price_currency: string;
    order_id: string;
    order_description: string;
    pay_currency?: string;
    success_url?: string;
    cancel_url?: string;
    is_fixed_rate?: boolean;
    is_fee_paid_by_user?: boolean;
}

/**
 * NOWPayments invoice response
 */
export interface NowPaymentsInvoice {
    id: string;
    token_id: string;
    order_id: string;
    order_description: string;
    price_amount: number;
    price_currency: string;
    pay_currency: string;
    invoice_url: string;
    status: string;
    created_at: string;
    updated_at: string;
}

/**
 * NOWPayments IPN (Instant Payment Notification) webhook payload
 */
export interface NowPaymentsIPN {
    payment_id: number;
    payment_status: string;
    pay_address: string;
    price_amount: number;
    price_currency: string;
    pay_amount: number;
    actually_paid: number;
    actually_paid_at_fiat?: number;
    pay_currency: string;
    order_id: string;
    order_description: string;
    purchase_id: string;
    outcome_amount?: number;
    outcome_currency?: string;
    created_at: string;
    updated_at: string;
}

/**
 * NowPaymentsService
 *
 * Wraps the NOWPayments REST API with:
 * - Exponential backoff retries (3 retries: 500ms, 1s, 2s)
 * - Sandbox / production environment switching via config
 * - Typed request/response contracts
 *
 * Architecture: Services layer — no Express imports, fully unit-testable.
 */
export class NowPaymentsService {
    private readonly client: AxiosInstance;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAYS_MS = [500, 1000, 2000];

    constructor() {
        const baseURL = config.nowpayments.isSandbox
            ? config.nowpayments.sandboxApiUrl
            : config.nowpayments.apiUrl;

        this.client = axios.create({
            baseURL,
            timeout: 10_000,
            headers: {
                'x-api-key': config.nowpayments.apiKey,
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Create a hosted invoice URL via NOWPayments.
     * Returns the full invoice object including the hosted `invoice_url`.
     */
    async createInvoice(payload: CreateInvoicePayload): Promise<NowPaymentsInvoice> {
        return this.withRetry(() =>
            this.client.post<NowPaymentsInvoice>('/invoice', payload).then(r => r.data)
        );
    }

    /**
     * Fetch the current payment status for a given order ID.
     * Used for race condition retry logic and the status polling endpoint.
     */
    /**
     * Fetch all payments for a given internal order ID.
     * Most reliable way to find associated payments in Sandbox and Production.
     */
    async getPaymentsByOrderId(orderId: string): Promise<any> {
        return this.withRetry(() =>
            this.client.get(`/payment`, { params: { order_id: orderId } }).then(r => r.data)
        );
    }

    /**
     * Fetch the current status of a HOSTED INVOICE created via /invoice.
     * Returns the full invoice object including 'status' and 'payment_id' if available.
     */
    async getInvoiceStatus(invoiceId: string): Promise<any> {
        return this.withRetry(() =>
            this.client.get(`/invoice/${invoiceId}`).then(r => r.data)
        );
    }

    /**
     * Fetch the current payment status for a given payment ID.
     * Use this ONLY if you have a payment_id from a webhook or transaction.
     */
    async getPaymentStatus(paymentId: string): Promise<any> {
        return this.withRetry(() =>
            this.client.get(`/payment/${paymentId}`).then(r => r.data)
        );
    }

    /**
     * Verify the HMAC-SHA512 signature from the NOWPayments IPN webhook.
     * NOTE: Verification is done in the controller using the raw body buffer.
     * This helper is here for testability.
     */
    /**
     * Verify the HMAC-SHA512 signature from the NOWPayments IPN webhook.
     * Documentation: https://documenter.getpostman.com/view/7907941/2s93JusNJt#4391e27f-1c54-499f-8623-36c7cd322542
     *
     * IMPORTANT: NOWPayments requires sorting keys alphabetically and stringifying
     * in a compact JSON format before hashing.
     */
    static verifySignature(payload: any, signature: string, ipnSecret: string): boolean {
        if (!payload || !signature || !ipnSecret) return false;

        const crypto = require('crypto');
        
        // If it's a Buffer, parse it first so we can sort the keys correctly
        const normalizedPayload = Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
        
        const sortedPayload = this.sortObject(normalizedPayload);
        const canonString = JSON.stringify(sortedPayload);
        
        const hmac = crypto.createHmac('sha512', ipnSecret);
        const calculated = hmac.update(canonString).digest('hex');
        
        return calculated === signature;
    }

    /**
     * Recursively sort object keys alphabetically for canonical JSON stringification.
     */
    private static sortObject(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObject(item));
        }
        return Object.keys(obj)
            .sort()
            .reduce((result: any, key) => {
                result[key] = this.sortObject(obj[key]);
                return result;
            }, {});
    }

    /**
     * Generic retry wrapper with exponential backoff.
     * @param fn - Async function to execute
     */
    private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;

                if (attempt < this.MAX_RETRIES) {
                    const delay = this.RETRY_DELAYS_MS[attempt];
                    console.warn(`[NowPaymentsService] Retry ${attempt + 1}/${this.MAX_RETRIES} after ${delay}ms`);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton export for use across the app
export const nowPaymentsService = new NowPaymentsService();
