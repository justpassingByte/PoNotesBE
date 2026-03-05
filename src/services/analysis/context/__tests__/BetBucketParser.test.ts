import { BetBucketParser } from '../BetBucketParser';

describe('BetBucketParser', () => {

    describe('Input Validation & Fallbacks', () => {
        it('should return UNKNOWN for zero betSize', () => {
            expect(BetBucketParser.categorize(0, 100)).toBe('UNKNOWN');
        });

        it('should return UNKNOWN for zero potSize', () => {
            expect(BetBucketParser.categorize(50, 0)).toBe('UNKNOWN');
        });

        it('should return UNKNOWN for negative betSize', () => {
            expect(BetBucketParser.categorize(-10, 100)).toBe('UNKNOWN');
        });

        it('should return UNKNOWN for negative potSize', () => {
            expect(BetBucketParser.categorize(10, -100)).toBe('UNKNOWN');
        });

        it('should return UNKNOWN for non-finite values (Infinity, NaN)', () => {
            expect(BetBucketParser.categorize(Infinity, 100)).toBe('UNKNOWN');
            expect(BetBucketParser.categorize(50, Infinity)).toBe('UNKNOWN');
            expect(BetBucketParser.categorize(NaN, 100)).toBe('UNKNOWN');
            expect(BetBucketParser.categorize(50, NaN)).toBe('UNKNOWN');
        });
    });

    describe('BLOCK threshold (betPct <= 25%)', () => {
        it('should classify 25% of pot as BLOCK (exact boundary, inclusive)', () => {
            expect(BetBucketParser.categorize(25, 100)).toBe('BLOCK');
        });

        it('should classify 10% of pot as BLOCK', () => {
            expect(BetBucketParser.categorize(10, 100)).toBe('BLOCK');
        });

        it('should classify 1% of pot as BLOCK', () => {
            expect(BetBucketParser.categorize(1, 100)).toBe('BLOCK');
        });
    });

    describe('HALF threshold (betPct > 25% AND <= 50%)', () => {
        it('should classify 26% of pot as HALF (just above BLOCK boundary)', () => {
            expect(BetBucketParser.categorize(26, 100)).toBe('HALF');
        });

        it('should classify 33% of pot as HALF', () => {
            expect(BetBucketParser.categorize(33, 100)).toBe('HALF');
        });

        it('should classify exactly 50% of pot as HALF (inclusive boundary)', () => {
            expect(BetBucketParser.categorize(50, 100)).toBe('HALF');
        });
    });

    describe('POT threshold (betPct > 50% AND <= 100%)', () => {
        it('should classify 51% of pot as POT (just above HALF boundary)', () => {
            expect(BetBucketParser.categorize(51, 100)).toBe('POT');
        });

        it('should classify 75% of pot as POT', () => {
            expect(BetBucketParser.categorize(75, 100)).toBe('POT');
        });

        it('should classify exactly 100% of pot as POT (inclusive boundary)', () => {
            expect(BetBucketParser.categorize(100, 100)).toBe('POT');
        });
    });

    describe('OVERBET threshold (betPct > 100%)', () => {
        it('should classify 101% of pot as OVERBET (just above POT boundary)', () => {
            expect(BetBucketParser.categorize(101, 100)).toBe('OVERBET');
        });

        it('should classify 150% of pot as OVERBET', () => {
            expect(BetBucketParser.categorize(150, 100)).toBe('OVERBET');
        });

        it('should classify 250% of pot as OVERBET', () => {
            expect(BetBucketParser.categorize(250, 100)).toBe('OVERBET');
        });
    });

    describe('Realistic poker sizes (non-round pot)', () => {
        it('should classify a 2BB bet into a 6BB pot as HALF (33%)', () => {
            expect(BetBucketParser.categorize(2, 6)).toBe('HALF');
        });

        it('should classify a 3BB bet into a 6BB pot as POT (50% = HALF edge)', () => {
            expect(BetBucketParser.categorize(3, 6)).toBe('HALF'); // exactly 50%, inclusive → HALF
        });

        it('should classify a 4BB bet into a 6BB pot as POT (66%)', () => {
            expect(BetBucketParser.categorize(4, 6)).toBe('POT');
        });

        it('should classify a 7BB bet into a 6BB pot as OVERBET (116%)', () => {
            expect(BetBucketParser.categorize(7, 6)).toBe('OVERBET');
        });
    });
});
