import { BoardBucketParser } from '../BoardBucketParser';
import { BoardTextureBucket } from '../types';

describe('BoardBucketParser', () => {

    const UNKNOWN_BOARD: BoardTextureBucket = {
        highCardTier: "UNKNOWN",
        pairedStatus: "UNKNOWN",
        suitedness: "UNKNOWN",
        connectivity: "UNKNOWN"
    };

    describe('Input Validation & Fallbacks', () => {
        it('should return atomic UNKNOWN if length < 3 or > 5', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd'])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize(['Ah'])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize([])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c', '3s', '7h', '9d'])).toEqual(UNKNOWN_BOARD);
        });

        it('should accept 3, 4, or 5 cards', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c']).highCardTier).toBe('ACE_HIGH');
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c', '7s']).highCardTier).toBe('ACE_HIGH');
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c', '7s', 'Jh']).highCardTier).toBe('ACE_HIGH');
        });

        it('should return atomic UNKNOWN if regex formatting fails', () => {
            expect(BoardBucketParser.categorize(['A', 'K', '2'])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize(['10h', 'Kd', '2c'])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize(['Ah', 'Kd', 'XYZ'])).toEqual(UNKNOWN_BOARD);
        });

        it('should return atomic UNKNOWN if duplicate cards exist', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ah', '2c'])).toEqual(UNKNOWN_BOARD);
            expect(BoardBucketParser.categorize(['Ah', 'aH', '2c'])).toEqual(UNKNOWN_BOARD);
            // Duplicate in 4-card board
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c', 'Ah'])).toEqual(UNKNOWN_BOARD);
        });
    });

    describe('HighCardTier Calculation', () => {
        it('should identify ACE_HIGH', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c']).highCardTier).toBe('ACE_HIGH');
        });
        it('should identify KING_HIGH', () => {
            expect(BoardBucketParser.categorize(['Ks', 'Jd', '9c']).highCardTier).toBe('KING_HIGH');
        });
        it('should identify LOW_BOARD (Ten or lower)', () => {
            expect(BoardBucketParser.categorize(['Ts', '4d', '2c']).highCardTier).toBe('LOW_BOARD');
            expect(BoardBucketParser.categorize(['8s', '4d', '2c']).highCardTier).toBe('LOW_BOARD');
        });
    });

    // ─── Flop (3 cards) PairedStatus ────────────────────────────────

    describe('PairedStatus - Flop (3 cards)', () => {
        it('should identify UNPAIRED boards', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c']).pairedStatus).toBe('UNPAIRED');
        });
        it('should identify PAIRED boards', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', '2c']).pairedStatus).toBe('PAIRED');
        });
        it('should identify TRIPS boards', () => {
            expect(BoardBucketParser.categorize(['7h', '7c', '7d']).pairedStatus).toBe('TRIPS');
        });
    });

    // ─── Turn (4 cards) PairedStatus ────────────────────────────────

    describe('PairedStatus - Turn (4 cards)', () => {
        it('should identify UNPAIRED (4 unique ranks)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '7c', '2s']).pairedStatus).toBe('UNPAIRED');
        });
        it('should identify PAIRED (3 unique ranks = one pair)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', '7c', '2s']).pairedStatus).toBe('PAIRED');
        });
        it('should identify TWO_PAIR (2 unique ranks, max freq 2)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', '7c', '7s']).pairedStatus).toBe('TWO_PAIR');
        });
        it('should identify TRIPS (2 unique ranks, max freq 3)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', 'As', '7c']).pairedStatus).toBe('TRIPS');
        });
        it('should identify QUADS (1 unique rank)', () => {
            expect(BoardBucketParser.categorize(['7h', '7d', '7c', '7s']).pairedStatus).toBe('QUADS');
        });
    });

    // ─── River (5 cards) PairedStatus ───────────────────────────────

    describe('PairedStatus - River (5 cards)', () => {
        it('should identify UNPAIRED (5 unique ranks)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', 'Qc', '7s', '2h']).pairedStatus).toBe('UNPAIRED');
        });
        it('should identify PAIRED (4 unique ranks)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', 'Kc', '7s', '2h']).pairedStatus).toBe('PAIRED');
        });
        it('should identify TWO_PAIR (3 unique ranks)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', 'Kc', 'Ks', '2h']).pairedStatus).toBe('TWO_PAIR');
        });
        it('should identify TRIPS / full house (2 unique ranks, max freq 3)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', 'As', 'Kc', 'Ks']).pairedStatus).toBe('TRIPS');
        });
        it('should identify QUADS (2 unique ranks, max freq 4)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Ad', 'As', 'Ac', 'Ks']).pairedStatus).toBe('QUADS');
        });
    });

    describe('Suitedness Calculation', () => {
        it('should identify MONOTONE (1 suit)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kh', '2h']).suitedness).toBe('MONOTONE');
        });
        it('should identify TWO_TONE (2 suits)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kh', '2c']).suitedness).toBe('TWO_TONE');
        });
        it('should identify RAINBOW (3+ suits)', () => {
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c']).suitedness).toBe('RAINBOW');
            // 4 suits on turn
            expect(BoardBucketParser.categorize(['Ah', 'Kd', '2c', '7s']).suitedness).toBe('RAINBOW');
        });
    });

    describe('Connectivity Calculation', () => {
        it('should short-circuit to DISCONNECTED if board is paired', () => {
            expect(BoardBucketParser.categorize(['5h', '6d', '6c']).connectivity).toBe('DISCONNECTED');
        });

        it('should identify CONNECTED (span === 2)', () => {
            expect(BoardBucketParser.categorize(['5h', '6d', '7c']).connectivity).toBe('CONNECTED');
            expect(BoardBucketParser.categorize(['Th', 'Jd', 'Qc']).connectivity).toBe('CONNECTED');
        });

        it('should identify SEMI_CONNECTED (span === 3 or 4)', () => {
            expect(BoardBucketParser.categorize(['5h', '7d', '8c']).connectivity).toBe('SEMI_CONNECTED');
            expect(BoardBucketParser.categorize(['5h', '6d', '9c']).connectivity).toBe('SEMI_CONNECTED');
        });

        it('should identify DISCONNECTED (span > 4)', () => {
            expect(BoardBucketParser.categorize(['2h', '7d', 'Kc']).connectivity).toBe('DISCONNECTED');
        });

        it('should handle dual-Ace logic (A-2-3 wheel)', () => {
            expect(BoardBucketParser.categorize(['Ah', '2d', '3c']).connectivity).toBe('CONNECTED');
            expect(BoardBucketParser.categorize(['Ah', '3d', '4c']).connectivity).toBe('SEMI_CONNECTED');
            expect(BoardBucketParser.categorize(['Ah', '5d', '6c']).connectivity).toBe('DISCONNECTED');
        });
    });

    describe('Turn/River Comprehensive Tests', () => {
        it('should parse a 4-card turn board accurately', () => {
            const result = BoardBucketParser.categorize(['Qh', 'Jd', 'Th', '9c']);
            expect(result.highCardTier).toBe('QUEEN_HIGH');
            expect(result.pairedStatus).toBe('UNPAIRED');
            expect(result.suitedness).toBe('RAINBOW');
        });

        it('should parse a 5-card river board accurately', () => {
            const result = BoardBucketParser.categorize(['Ah', 'Kd', 'Qc', 'Js', 'Th']);
            expect(result.highCardTier).toBe('ACE_HIGH');
            expect(result.pairedStatus).toBe('UNPAIRED');
            expect(result.suitedness).toBe('RAINBOW');
        });

        it('should detect paired turn board', () => {
            const result = BoardBucketParser.categorize(['Ah', 'Ad', '7c', '2s']);
            expect(result.pairedStatus).toBe('PAIRED');
            expect(result.connectivity).toBe('DISCONNECTED'); // paired → disconnected
        });
    });

    describe('Comprehensive Matrix Test', () => {
        it('should successfully parse a complex flop accurately', () => {
            const result = BoardBucketParser.categorize(['Qh', 'Jd', 'Th']);
            expect(result).toEqual({
                highCardTier: 'QUEEN_HIGH',
                pairedStatus: 'UNPAIRED',
                suitedness: 'TWO_TONE',
                connectivity: 'CONNECTED'
            });
        });
    });
});
