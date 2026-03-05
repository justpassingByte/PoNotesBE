import { HandStrengthResolver } from '../HandStrengthResolver';

describe('HandStrengthResolver', () => {
    it('is deterministic for computeStrength()', () => {
        expect(HandStrengthResolver.computeStrength('A5s')).toBe(
            HandStrengthResolver.computeStrength('A5s')
        );
    });

    it('computeAll() is cached and stable', () => {
        const first = HandStrengthResolver.computeAll();
        const second = HandStrengthResolver.computeAll();

        expect(first).toBe(second);
        expect(first.size).toBe(169);
        expect(first.get('AKs')).toBe(second.get('AKs'));
    });

    it('captures requested playability ordering', () => {
        expect(HandStrengthResolver.computeStrength('A5s'))
            .toBeGreaterThan(HandStrengthResolver.computeStrength('A8o'));
        expect(HandStrengthResolver.computeStrength('T9s'))
            .toBeGreaterThan(HandStrengthResolver.computeStrength('J7s'));
        expect(HandStrengthResolver.computeStrength('KQo'))
            .toBeGreaterThan(HandStrengthResolver.computeStrength('K9o'));
    });

    it('applies blocker bonuses', () => {
        expect(HandStrengthResolver.computeStrength('A2o'))
            .toBeGreaterThan(HandStrengthResolver.computeStrength('Q2o'));
        expect(HandStrengthResolver.computeStrength('K2o'))
            .toBeGreaterThan(HandStrengthResolver.computeStrength('Q2o'));
    });

    it('applies suited connector bonus only for suited connectors', () => {
        const suitedConnector = HandStrengthResolver.computeStrength('T9s');
        const suitedNonConnector = HandStrengthResolver.computeStrength('T8s');
        const offsuitConnector = HandStrengthResolver.computeStrength('T9o');

        expect(suitedConnector).toBeGreaterThan(suitedNonConnector);
        expect(suitedConnector).toBeGreaterThan(offsuitConnector);
    });
});
