/**
 * Tests for NowPaymentsService.verifySignature
 * These are pure unit tests — no DB, no network.
 */
import crypto from 'crypto';
import { NowPaymentsService } from '../services/nowPaymentsService';

describe('NowPaymentsService.verifySignature', () => {
    const SECRET = 'test-ipn-secret-1234';

    function makeSignature(body: Record<string, any>): { payload: any; signature: string } {
        // Mock the canonical logic: sort keys recursive + compact stringify
        function sortObject(obj: any): any {
            if (obj === null || typeof obj !== 'object') return obj;
            return Object.keys(obj).sort().reduce((res: any, k) => {
                res[k] = sortObject(obj[k]);
                return res;
            }, {});
        }
        
        const canonStr = JSON.stringify(sortObject(body));
        const hmac = crypto.createHmac('sha512', SECRET);
        const signature = hmac.update(canonStr).digest('hex');
        return { payload: body, signature };
    }

    it('✅ returns true for a valid sorted signature', () => {
        const payload = { b: 2, a: 1, c: { e: 5, d: 4 } };
        const { signature } = makeSignature(payload);

        const result = NowPaymentsService.verifySignature(payload, signature, SECRET);
        expect(result).toBe(true);
    });

    it('❌ returns false when signature is tampered', () => {
        const payload = { payment_id: 123 };
        const { signature } = makeSignature(payload);

        const result = NowPaymentsService.verifySignature(payload, 'bad' + signature.slice(3), SECRET);
        expect(result).toBe(false);
    });

    it('❌ returns false when payload is modified after signing', () => {
        const payload = { price: 100 };
        const { signature } = makeSignature(payload);

        const result = NowPaymentsService.verifySignature({ ...payload, price: 101 }, signature, SECRET);
        expect(result).toBe(false);
    });

    it('❌ returns false when the secret is wrong', () => {
        const payload = { payment_id: 123, payment_status: 'finished', order_id: 'abc' };
        const { signature } = makeSignature(payload);

        const result = NowPaymentsService.verifySignature(payload, signature, 'wrong-secret');
        expect(result).toBe(false);
    });
});
