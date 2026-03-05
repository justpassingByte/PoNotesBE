/**
 * Public Solve API tests for per-hand action-frequency contract.
 */

import { HandClassGenerator } from '../../HandClassGenerator';
import { SolverEngine } from '../../SolverEngine';
import type { SolveRequest } from '../types';

describe('SolverEngine.solve() Public API', () => {
    const baseRequest: SolveRequest = {
        spot: 'SRP_IP',
        stack: 'DEEP',
    };

    it('returns 169 per-hand entries', () => {
        const response = SolverEngine.solve(baseRequest);
        expect(Object.keys(response).length).toBe(169);
    });

    it('returns 0..1 probabilities and each hand sums to 1', () => {
        const response = SolverEngine.solve(baseRequest);

        for (const hand of Object.keys(response)) {
            const entry = response[hand];
            expect(entry.raise).toBeGreaterThanOrEqual(0);
            expect(entry.call).toBeGreaterThanOrEqual(0);
            expect(entry.fold).toBeGreaterThanOrEqual(0);
            expect(entry.raise).toBeLessThanOrEqual(1);
            expect(entry.call).toBeLessThanOrEqual(1);
            expect(entry.fold).toBeLessThanOrEqual(1);

            const sum = entry.raise + entry.call + entry.fold;
            expect(sum).toBeCloseTo(1, 6);
        }
    });

    it('is deterministic for identical requests', () => {
        const r1 = SolverEngine.solve(baseRequest);
        const r2 = SolverEngine.solve(baseRequest);

        for (const hand of HandClassGenerator.generateAll()) {
            expect(r1[hand]).toEqual(r2[hand]);
        }
    });

    it('defaults shapingMode to balanced', () => {
        const withDefault = SolverEngine.solve(baseRequest);
        const withExplicit = SolverEngine.solve({ ...baseRequest, shapingMode: 'balanced' });

        for (const hand of HandClassGenerator.generateAll()) {
            expect(withDefault[hand]).toEqual(withExplicit[hand]);
        }
    });

    it('handles optional villainType and postflop board context', () => {
        const response = SolverEngine.solve({
            spot: 'SRP_OOP',
            stack: 'MEDIUM',
            street: 'flop',
            villainType: 'OVERFOLD',
            shapingMode: 'polar',
            board: {
                suitedness: 'TWO_TONE',
                pairedStatus: 'UNPAIRED',
                highCardTier: 'ACE_HIGH',
                connectivity: 'VERY_CONNECTED',
            },
        });

        expect(Object.keys(response).length).toBe(169);
        for (const hand of HandClassGenerator.generateAll()) {
            expect(response[hand]).toBeDefined();
            const sum = response[hand].raise + response[hand].call + response[hand].fold;
            expect(sum).toBeCloseTo(1, 6);
        }
    });

    it('uses canonical hand class keys', () => {
        const response = SolverEngine.solve(baseRequest);
        const canonical = HandClassGenerator.generateAll();

        expect(Object.keys(response).sort()).toEqual([...canonical].sort());
    });

    it('preflop SRP root disallows call for all hands', () => {
        const response = SolverEngine.solve({
            spot: 'SRP_IP',
            stack: 'DEEP',
            street: 'preflop',
        });

        for (const hand of HandClassGenerator.generateAll()) {
            expect(response[hand].call).toBeCloseTo(0, 9);
        }
    });

    it('premium hands never fold at preflop SRP root', () => {
        const response = SolverEngine.solve({
            spot: 'SRP_IP',
            stack: 'DEEP',
            street: 'preflop',
        });

        const premium = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'] as const;
        for (const hand of premium) {
            expect(response[hand].fold).toBe(0);
        }
    });

    it('trash offsuit hand remains fold-heavy preflop', () => {
        const response = SolverEngine.solve({
            spot: 'SRP_IP',
            stack: 'DEEP',
            street: 'preflop',
        });

        expect(response['72o'].fold).toBeGreaterThan(0.6);
        expect(response['72o'].fold).toBeGreaterThan(response['72o'].raise);
    });

    it('sanity pattern resembles realistic 100bb SRP IP preflop baseline', () => {
        const response = SolverEngine.solve({
            spot: 'SRP_IP',
            stack: 'DEEP',
            street: 'preflop',
            shapingMode: 'balanced',
        });

        // Strong pairs stay highly aggressive.
        for (const hand of ['AA', 'KK', 'QQ', 'JJ', 'TT'] as const) {
            expect(response[hand].raise).toBeGreaterThan(0.84);
        }

        // Broadway aces remain high-frequency opens.
        for (const hand of ['AKs', 'AKo', 'AQs', 'AJs', 'ATs'] as const) {
            expect(response[hand].raise).toBeGreaterThan(0.45);
        }

        // Suited connectors and wheel aces are playable.
        expect(response['T9s'].raise).toBeGreaterThan(0);
        expect(response['A5s'].raise).toBeGreaterThan(0);

        // Requested playability ordering from strength-aware baseline.
        expect(response['A5s'].raise).toBeGreaterThanOrEqual(response['A8o'].raise);
        expect(response['T9s'].raise).toBeGreaterThanOrEqual(response['J7s'].raise);
        expect(response['KQo'].raise).toBeGreaterThanOrEqual(response['K9o'].raise);

        // Avoid near-uniform 33/33/33 artefacts.
        let nearUniformCount = 0;
        for (const hand of HandClassGenerator.generateAll()) {
            const strat = response[hand];
            if (
                Math.abs(strat.raise - 1 / 3) < 0.05 &&
                Math.abs(strat.call - 1 / 3) < 0.05 &&
                Math.abs(strat.fold - 1 / 3) < 0.05
            ) {
                nearUniformCount += 1;
            }
        }
        expect(nearUniformCount).toBe(0);
    });
});
