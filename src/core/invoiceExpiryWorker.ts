import { paymentService } from '../services/paymentService';

/**
 * InvoiceExpiryWorker
 *
 * Runs every 5 minutes to mark stale invoices as EXPIRED.
 * An invoice is stale if it's been PENDING or CONFIRMING for > 60 minutes.
 *
 * This is a simple setInterval-based approach.
 * In production, replace with a proper job queue (Bull, pg-boss, etc.) if needed.
 */
export class InvoiceExpiryWorker {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private readonly INTERVAL_MS = 5 * 60 * 1000; // Run every 5 minutes

    start(): void {
        if (this.intervalId) {
            console.warn('[InvoiceExpiryWorker] Already running');
            return;
        }

        console.log('[InvoiceExpiryWorker] Started — polling every 5 minutes');

        // Run immediately on start, then on interval
        this.runOnce();
        this.intervalId = setInterval(() => this.runOnce(), this.INTERVAL_MS);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[InvoiceExpiryWorker] Stopped');
        }
    }

    private async runOnce(): Promise<void> {
        try {
            const expired = await paymentService.expireStaleInvoices();
            if (expired > 0) {
                console.log(`[InvoiceExpiryWorker] Expired ${expired} stale invoices`);
            }
        } catch (err) {
            console.error('[InvoiceExpiryWorker] Error during expiry run:', err);
        }
    }
}

export const invoiceExpiryWorker = new InvoiceExpiryWorker();
