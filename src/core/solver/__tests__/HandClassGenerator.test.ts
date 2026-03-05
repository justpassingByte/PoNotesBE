import { HandClassGenerator } from '../HandClassGenerator';

describe('HandClassGenerator', () => {
    it('generates exactly 169 hands', () => {
        const hands = HandClassGenerator.generateAll();
        expect(hands.length).toBe(169);
    });

    it('contains expected boundary hands', () => {
        const hands = HandClassGenerator.generateAll();
        expect(hands).toContain('AA');
        expect(hands).toContain('32o');
        expect(hands).toContain('AKs');
        expect(hands).toContain('AKo');
        expect(hands).toContain('22');
    });

    it('contains no duplicates', () => {
        const hands = HandClassGenerator.generateAll();
        const unique = new Set(hands);
        expect(unique.size).toBe(169);
    });

    it('returns the same frozen reference on subsequent calls', () => {
        const first = HandClassGenerator.generateAll();
        const second = HandClassGenerator.generateAll();
        expect(first).toBe(second);
    });

    it('has 13 pairs, 78 suited, 78 offsuit', () => {
        const hands = HandClassGenerator.generateAll();
        const pairs = hands.filter(h => h.length === 2);
        const suited = hands.filter(h => h.endsWith('s'));
        const offsuit = hands.filter(h => h.endsWith('o'));
        expect(pairs.length).toBe(13);
        expect(suited.length).toBe(78);
        expect(offsuit.length).toBe(78);
    });
});
