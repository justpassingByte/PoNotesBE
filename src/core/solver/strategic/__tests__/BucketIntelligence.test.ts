import { BucketIntelligence } from '../BucketIntelligence';
import { HandClassGenerator } from '../../HandClassGenerator';
import { BoardTextureBucket } from '../types';

describe('BucketIntelligence', () => {
    describe('Combo-Density Scaling', () => {
        it('returns correctly clamped density multipliers without boardContext', () => {
            const multipliers = BucketIntelligence.computeMultipliers(undefined, 'preflop');
            expect(multipliers.size).toBe(169);

            // pair: 6 combos. avg = 7.333. raw = 6 / 7.333 * 10000 = 8181. bounded [7000, 13000].
            expect(multipliers.get('AA')).toBe(8181);
            expect(multipliers.get('22')).toBe(8181);

            // suited: 4 combos. avg = 7.333. raw = 4 / 7.333 * 10000 = 5454. clamped to 7000.
            expect(multipliers.get('AKs')).toBe(7000);
            expect(multipliers.get('72s')).toBe(7000);

            // offsuit: 12 combos. avg = 7.333. raw = 12 / 7.333 * 10000 = 16363. clamped to 13000.
            expect(multipliers.get('AKo')).toBe(13000);
            expect(multipliers.get('72o')).toBe(13000);
        });

        it('is deterministic returning exactly the same values across runs', () => {
            const run1 = BucketIntelligence.computeMultipliers(undefined, 'preflop');
            const run2 = BucketIntelligence.computeMultipliers(undefined, 'preflop');

            for (const hand of HandClassGenerator.generateAll()) {
                expect(run1.get(hand)).toBe(run2.get(hand));
            }
        });
    });

    describe('Board-Aware Lookup', () => {
        it('stacks suited conditions correctly (MONOTONE)', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'MONOTONE',
                pairedStatus: 'UNPAIRED',
                highCardTier: 'LOW_BOARD',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // Suited hand (e.g. AKs): density (7000) * 12000 / 10000 = 8400
            expect(multipliers.get('AKs')).toBe(8400);

            // Pair hand (e.g. AA): density (8181) * identity / 10000 = 8181
            expect(multipliers.get('AA')).toBe(8181);

            // Offsuit hand (e.g. AKo): density (13000) * 8000 / 10000 = 10400
            expect(multipliers.get('AKo')).toBe(10400);
        });

        it('stacks paired conditions correctly (PAIRED)', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'RAINBOW',
                pairedStatus: 'PAIRED',
                highCardTier: 'LOW_BOARD',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // Pair hand: density (8181) * 12000 / 10000 = 9817
            expect(multipliers.get('AA')).toBe(9817);

            // Others stay identity from board perspective
            expect(multipliers.get('AKs')).toBe(7000);
            expect(multipliers.get('AKo')).toBe(13000);
        });

        it('stacks high-card conditions correctly (ACE_HIGH)', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'RAINBOW',
                pairedStatus: 'UNPAIRED',
                highCardTier: 'ACE_HIGH',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // Broadway hands: density * 11000 / 10000
            // AKo (offsuit + broadway): 13000 * 11000 / 10000 = 14300
            expect(multipliers.get('AKo')).toBe(14300);

            // KQs (suited + broadway): 7000 * 11000 / 10000 = 7700
            expect(multipliers.get('KQs')).toBe(7700);

            // Non-broadway: density * identity
            expect(multipliers.get('98s')).toBe(7000);
        });

        it('handles unknown highCardTier returning identity', () => {
            const boardContext = {
                suitedness: 'RAINBOW',
                pairedStatus: 'UNPAIRED',
                highCardTier: 'SOME_UNKNOWN_TIER',
                connectivity: 'DISCONNECTED'
            } as any;
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // Should be just density
            expect(multipliers.get('AKo')).toBe(13000);
            expect(multipliers.get('AKs')).toBe(7000);
        });
    });

    describe('Composite Board Tests (Task A.8)', () => {
        it('stacks MONOTONE + PAIRED correctly', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'MONOTONE',
                pairedStatus: 'PAIRED',
                highCardTier: 'LOW_BOARD',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // AA: density(8181) * monotone(10000) = 8181 -> * paired(12000) = 9817
            expect(multipliers.get('AA')).toBe(9817);

            // AKs: density(7000) * monotone(12000) = 8400 -> * paired(10000) = 8400
            expect(multipliers.get('AKs')).toBe(8400);
        });

        it('stacks MONOTONE + ACE_HIGH correctly', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'MONOTONE',
                pairedStatus: 'UNPAIRED',
                highCardTier: 'ACE_HIGH',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // AKs (suited broadway):
            // raw: Math.floor(density(7000) * board(monotone:12000 -> 12000, ace_high:11000 -> floor(12000*11000/10000)=13200))
            // wait: chaining calculates board factor natively first:
            // multiplier = 10000
            // monotone factor = 12000 -> multiplier = 12000
            // ace_high factor = 11000 -> multiplier = 13200
            // final chaining = floor(7000 * 13200 / 10000) = 9240
            expect(multipliers.get('AKs')).toBe(9240);
        });

        it('stacks MONOTONE + PAIRED + ACE_HIGH and clamps combined correctly', () => {
            const boardContext: BoardTextureBucket = {
                suitedness: 'MONOTONE',
                pairedStatus: 'PAIRED',
                highCardTier: 'ACE_HIGH',
                connectivity: 'DISCONNECTED'
            };
            const multipliers = BucketIntelligence.computeMultipliers(boardContext, 'flop');

            // AKo (offsuit broadway):
            // multiplier = 10000
            // monotone factor = 8000 -> multiplier = 8000
            // paired factor = 10000 -> multiplier = 8000
            // ace_high factor = 11000 -> multiplier = floor(8000 * 11000 / 10000) = 8800
            // final chaining = floor(density(13000) * 8800 / 10000) = 11440
            expect(multipliers.get('AKo')).toBe(11440);

            // AA (pair broadway):
            // multiplier = 10000 -> monotone 10000 -> paired 12000 -> broadway 11000 = 13200
            // final: 8181 * 13200 / 10000 = 10798
            expect(multipliers.get('AA')).toBe(10798);
        });
    });
});
