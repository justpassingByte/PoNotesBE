import { SpotTemplateParser } from '../SpotTemplateParser';

describe('SpotTemplateParser', () => {
    describe('categorize()', () => {
        it('should correctly concatenate valid LIMPED IP and OOP pots', () => {
            expect(SpotTemplateParser.categorize('LIMPED', 'IP')).toBe('LIMPED_IP');
            expect(SpotTemplateParser.categorize('LIMPED', 'OOP')).toBe('LIMPED_OOP');
        });

        it('should correctly concatenate valid SRP pots', () => {
            expect(SpotTemplateParser.categorize('SRP', 'IP')).toBe('SRP_IP');
            expect(SpotTemplateParser.categorize('SRP', 'OOP')).toBe('SRP_OOP');
        });

        it('should correctly concatenate valid 3BP pots', () => {
            expect(SpotTemplateParser.categorize('3BP', 'IP')).toBe('3BP_IP');
            expect(SpotTemplateParser.categorize('3BP', 'OOP')).toBe('3BP_OOP');
        });

        it('should correctly concatenate valid 4BP pots', () => {
            expect(SpotTemplateParser.categorize('4BP', 'IP')).toBe('4BP_IP');
            expect(SpotTemplateParser.categorize('4BP', 'OOP')).toBe('4BP_OOP');
        });

        it('should correctly concatenate expanded complex pots', () => {
            expect(SpotTemplateParser.categorize('5BP_PLUS' as any, 'IP')).toBe('5BP_PLUS_IP');
            expect(SpotTemplateParser.categorize('5BP_PLUS' as any, 'OOP')).toBe('5BP_PLUS_OOP');

            expect(SpotTemplateParser.categorize('SQUEEZE_POT' as any, 'IP')).toBe('SQUEEZE_POT_IP');
            expect(SpotTemplateParser.categorize('SQUEEZE_POT' as any, 'OOP')).toBe('SQUEEZE_POT_OOP');

            expect(SpotTemplateParser.categorize('COLD_CALL_3BP' as any, 'IP')).toBe('COLD_CALL_3BP_IP');
            expect(SpotTemplateParser.categorize('COLD_CALL_3BP' as any, 'OOP')).toBe('COLD_CALL_3BP_OOP');
        });

        describe('Invalid Inputs and Fallbacks', () => {
            it('should return UNKNOWN for completely invalid PotTypes', () => {
                expect(SpotTemplateParser.categorize('6BP' as any, 'IP')).toBe('UNKNOWN');
                expect(SpotTemplateParser.categorize('STRADDLE' as any, 'OOP')).toBe('UNKNOWN');
                expect(SpotTemplateParser.categorize('' as any, 'IP')).toBe('UNKNOWN');
            });

            it('should return UNKNOWN for completely invalid Positions', () => {
                expect(SpotTemplateParser.categorize('SRP', 'BTN' as any)).toBe('UNKNOWN'); // Not resolved
                expect(SpotTemplateParser.categorize('3BP', 'UTG' as any)).toBe('UNKNOWN'); // Not resolved
                expect(SpotTemplateParser.categorize('4BP', '' as any)).toBe('UNKNOWN');
            });

            it('should return UNKNOWN for null or undefined inputs safely', () => {
                expect(SpotTemplateParser.categorize(undefined as any, 'IP')).toBe('UNKNOWN');
                expect(SpotTemplateParser.categorize('SRP', null as any)).toBe('UNKNOWN');
            });
        });
    });
});
