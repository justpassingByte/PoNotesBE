import { mapStack } from '../StackMapper';

describe('StackMapper', () => {
    it('maps numeric strings using UI stack boundaries', () => {
        expect(mapStack('20')).toBe('SHORT');
        expect(mapStack('40')).toBe('MEDIUM');
        expect(mapStack('80')).toBe('MEDIUM');
        expect(mapStack('100')).toBe('DEEP');
        expect(mapStack('200')).toBe('VERY_DEEP');
    });

    it('maps numeric values using UI stack boundaries', () => {
        expect(mapStack(39)).toBe('SHORT');
        expect(mapStack(40)).toBe('MEDIUM');
        expect(mapStack(80)).toBe('MEDIUM');
        expect(mapStack(81)).toBe('DEEP');
        expect(mapStack(150)).toBe('DEEP');
        expect(mapStack(151)).toBe('VERY_DEEP');
    });

    it('accepts canonical enum buckets as-is', () => {
        expect(mapStack('SHORT')).toBe('SHORT');
        expect(mapStack('MEDIUM')).toBe('MEDIUM');
        expect(mapStack('DEEP')).toBe('DEEP');
        expect(mapStack('VERY_DEEP')).toBe('VERY_DEEP');
    });

    it('rejects invalid values', () => {
        expect(mapStack('')).toBeNull();
        expect(mapStack('very-deep-ish')).toBeNull();
        expect(mapStack(0)).toBeNull();
        expect(mapStack(-5)).toBeNull();
    });
});
