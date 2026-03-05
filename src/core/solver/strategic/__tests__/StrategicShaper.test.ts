import { StrategicShaper } from '../StrategicShaper';
import { RangeState } from '../../RangeState';
import { HandClassGenerator } from '../../HandClassGenerator';
import { RangeInitializer } from '../../RangeInitializer';

describe('StrategicShaper', () => {
    describe('computeMultipliers', () => {
        let range: RangeState;

        beforeEach(() => {
            range = RangeInitializer.init('SRP_IP', 'MEDIUM');
        });

        it('returns balanced identity multipliers without sorting (balanced mode)', () => {
            const multipliers = StrategicShaper.computeMultipliers(range, 'balanced');
            expect(multipliers.size).toBe(169);

            for (const hand of HandClassGenerator.generateAll()) {
                expect(multipliers.get(hand)).toBe(10000);
            }
        });

        it('assigns expected bucket counts for polar mode', () => {
            const multipliers = StrategicShaper.computeMultipliers(range, 'polar');
            const values = Array.from(multipliers.values());

            expect(values.filter(v => v === 13000).length).toBe(34);
            expect(values.filter(v => v === 7000).length).toBe(101);
            expect(values.filter(v => v === 12000).length).toBe(34);
        });

        it('assigns expected bucket counts for merged mode', () => {
            const multipliers = StrategicShaper.computeMultipliers(range, 'merged');
            const values = Array.from(multipliers.values());

            expect(values.filter(v => v === 8000).length).toBe(68);
            expect(values.filter(v => v === 13000).length).toBe(101);
        });

        it('is deterministic for equal-weight ranges', () => {
            const flatRange = new RangeState(new Map(
                HandClassGenerator.generateAll().map(hand => [hand, 100 / 169])
            ));

            const m1 = StrategicShaper.computeMultipliers(flatRange, 'polar');
            const m2 = StrategicShaper.computeMultipliers(flatRange, 'polar');

            for (const hand of HandClassGenerator.generateAll()) {
                expect(m1.get(hand)).toBe(m2.get(hand));
            }
        });

        it('uses intrinsic strength tie-break (not canonical index artifacts)', () => {
            const flatRange = new RangeState(new Map(
                HandClassGenerator.generateAll().map(hand => [hand, 100 / 169])
            ));

            const multipliers = StrategicShaper.computeMultipliers(flatRange, 'polar');

            // Premiums should remain in top tier under flat ties.
            expect(multipliers.get('AA')).toBe(13000);
            expect(multipliers.get('AKs')).toBe(13000);

            // Weak offsuit trash should not be pushed into top tier by matrix order.
            expect(multipliers.get('72o')).not.toBe(13000);
            expect(multipliers.get('32o')).not.toBe(13000);
        });
    });
});
