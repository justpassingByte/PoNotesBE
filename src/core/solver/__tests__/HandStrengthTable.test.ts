import { HandClassGenerator } from '../HandClassGenerator';
import { HAND_STRENGTH } from '../HandStrengthTable';

describe('HandStrengthTable', () => {
    it('covers all 169 canonical hand classes', () => {
        const allHands = HandClassGenerator.generateAll();
        expect(Object.keys(HAND_STRENGTH).length).toBe(169);

        for (const hand of allHands) {
            expect(HAND_STRENGTH[hand]).toBeDefined();
        }
    });

    it('keeps values in [0, 10]', () => {
        for (const hand of HandClassGenerator.generateAll()) {
            const value = HAND_STRENGTH[hand];
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(10);
        }
    });

    it('satisfies required realism ordering', () => {
        expect(HAND_STRENGTH['A5s']).toBeGreaterThan(HAND_STRENGTH['A8o']);
        expect(HAND_STRENGTH['T9s']).toBeGreaterThan(HAND_STRENGTH['J7s']);
        expect(HAND_STRENGTH['KQo']).toBeGreaterThan(HAND_STRENGTH['K9o']);
    });
});
