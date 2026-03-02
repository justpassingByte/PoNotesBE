import { StackDepthParser } from '../StackDepthParser';

describe('StackDepthParser', () => {
    describe('categorize()', () => {
        it('should correctly identify SHORT stacks (<30 BB)', () => {
            expect(StackDepthParser.categorize(15, 100)).toBe('SHORT'); // Hero is short
            expect(StackDepthParser.categorize(100, 20)).toBe('SHORT'); // Villain is short
            expect(StackDepthParser.categorize(29, 29)).toBe('SHORT');  // Both are short, edge
            expect(StackDepthParser.categorize(0.5, 0.5)).toBe('SHORT'); // Micro stacks
        });

        it('should correctly identify MEDIUM stacks (30 - 59 BB)', () => {
            expect(StackDepthParser.categorize(30, 100)).toBe('MEDIUM'); // Lower bound
            expect(StackDepthParser.categorize(50, 50)).toBe('MEDIUM');  // Mid range
            expect(StackDepthParser.categorize(100, 59)).toBe('MEDIUM'); // Upper bound
        });

        it('should correctly identify DEEP stacks (60 - 99 BB)', () => {
            expect(StackDepthParser.categorize(60, 150)).toBe('DEEP'); // Lower bound
            expect(StackDepthParser.categorize(80, 80)).toBe('DEEP');  // Mid range
            expect(StackDepthParser.categorize(200, 99)).toBe('DEEP'); // Upper bound
        });

        it('should correctly identify VERY_DEEP stacks (100+ BB)', () => {
            expect(StackDepthParser.categorize(100, 100)).toBe('VERY_DEEP'); // Lower bound edge
            expect(StackDepthParser.categorize(150, 200)).toBe('VERY_DEEP'); // Typical deep cash
            expect(StackDepthParser.categorize(1000, 1000)).toBe('VERY_DEEP'); // Extremely deep
        });

        describe('Invalid Inputs and Edge Cases', () => {
            it('should return UNKNOWN for zero or negative stacks', () => {
                expect(StackDepthParser.categorize(0, 100)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(100, 0)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(-10, 50)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(50, -5)).toBe('UNKNOWN');
            });

            it('should return UNKNOWN for non-finite values', () => {
                expect(StackDepthParser.categorize(NaN, 100)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(100, NaN)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(Infinity, 100)).toBe('UNKNOWN');
                expect(StackDepthParser.categorize(100, -Infinity)).toBe('UNKNOWN');
            });

            it('should handle decimal values properly', () => {
                expect(StackDepthParser.categorize(29.9, 100)).toBe('SHORT');
                expect(StackDepthParser.categorize(59.9, 100)).toBe('MEDIUM');
                expect(StackDepthParser.categorize(99.9, 100)).toBe('DEEP');
            });
        });
    });
});
