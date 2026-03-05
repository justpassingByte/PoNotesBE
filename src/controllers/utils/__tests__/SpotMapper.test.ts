import { mapSpot } from '../SpotMapper';

describe('SpotMapper', () => {
    it('accepts canonical spots', () => {
        expect(mapSpot('SRP_IP')).toBe('SRP_IP');
        expect(mapSpot('3BP_OOP')).toBe('3BP_OOP');
        expect(mapSpot('4BP_IP')).toBe('4BP_IP');
    });

    it('maps frontend aliases to backend enums', () => {
        expect(mapSpot('3BET_IP')).toBe('3BP_IP');
        expect(mapSpot('3BET_OOP')).toBe('3BP_OOP');
        expect(mapSpot('4BET_IP')).toBe('4BP_IP');
        expect(mapSpot('4BET_OOP')).toBe('4BP_OOP');
    });

    it('normalizes casing/whitespace', () => {
        expect(mapSpot('  srp_ip  ')).toBe('SRP_IP');
        expect(mapSpot('  3bet_ip  ')).toBe('3BP_IP');
    });

    it('rejects invalid values', () => {
        expect(mapSpot('RFI_BTN')).toBeNull();
        expect(mapSpot('')).toBeNull();
        expect(mapSpot(undefined)).toBeNull();
        expect(mapSpot(123)).toBeNull();
    });
});
