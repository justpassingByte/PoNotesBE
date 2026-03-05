import { PostflopStrengthResolver, HandStrengthCategory } from '../PostflopStrengthResolver';
import { BoardTextureBucket } from '../context/types';

// ── Test Fixtures ────────────────────────────────────────────────

const makeBoard = (overrides?: Partial<BoardTextureBucket>): BoardTextureBucket => ({
    highCardTier: 'ACE_HIGH',
    pairedStatus: 'UNPAIRED',
    suitedness: 'RAINBOW',
    connectivity: 'DISCONNECTED',
    ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────

describe('PostflopStrengthResolver', () => {

    describe('Determinism', () => {
        it('should return identical results for identical inputs', () => {
            const board = makeBoard();
            const r1 = PostflopStrengthResolver.resolve('AKs', board);
            const r2 = PostflopStrengthResolver.resolve('AKs', board);
            expect(r1).toBe(r2);
        });
    });

    describe('Return type', () => {
        it('should always return a valid HandStrengthCategory', () => {
            const validCategories: HandStrengthCategory[] = ['NUTS', 'STRONG', 'DRAW', 'MEDIUM', 'TRASH'];
            const board = makeBoard();
            const hands = ['AA', 'KK', 'AKs', 'AKo', 'T9s', '72o', 'QJs', '55', '22'];
            for (const hand of hands) {
                const result = PostflopStrengthResolver.resolve(hand, board);
                expect(validCategories).toContain(result);
            }
        });
    });

    // ── NUTS Detection ───────────────────────────────────────────

    describe('NUTS — Sets and Overpairs', () => {
        it('should classify pocket pair matching board high card as NUTS (set)', () => {
            // AA on ACE_HIGH board = set
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('AA', board)).toBe('NUTS');
        });

        it('should classify KK on KING_HIGH board as NUTS (set)', () => {
            const board = makeBoard({ highCardTier: 'KING_HIGH' });
            expect(PostflopStrengthResolver.resolve('KK', board)).toBe('NUTS');
        });

        it('should classify QQ on QUEEN_HIGH board as NUTS (set)', () => {
            const board = makeBoard({ highCardTier: 'QUEEN_HIGH' });
            expect(PostflopStrengthResolver.resolve('QQ', board)).toBe('NUTS');
        });

        it('should classify JJ on JACK_HIGH board as NUTS (set)', () => {
            const board = makeBoard({ highCardTier: 'JACK_HIGH' });
            expect(PostflopStrengthResolver.resolve('JJ', board)).toBe('NUTS');
        });

        it('should classify AA as NUTS on LOW_BOARD (overpair)', () => {
            const board = makeBoard({ highCardTier: 'LOW_BOARD' });
            expect(PostflopStrengthResolver.resolve('AA', board)).toBe('NUTS');
        });

        it('should classify KK as NUTS on LOW_BOARD (overpair)', () => {
            const board = makeBoard({ highCardTier: 'LOW_BOARD' });
            expect(PostflopStrengthResolver.resolve('KK', board)).toBe('NUTS');
        });

        it('should classify QQ as NUTS on LOW_BOARD (overpair)', () => {
            const board = makeBoard({ highCardTier: 'LOW_BOARD' });
            expect(PostflopStrengthResolver.resolve('QQ', board)).toBe('NUTS');
        });
    });

    // ── STRONG Detection ─────────────────────────────────────────

    describe('STRONG — Top Pairs', () => {
        it('should classify AKs on ACE_HIGH board as STRONG (top pair)', () => {
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('AKs', board)).toBe('STRONG');
        });

        it('should classify AKo on ACE_HIGH board as STRONG (top pair)', () => {
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('AKo', board)).toBe('STRONG');
        });

        it('should classify KQs on KING_HIGH board as STRONG', () => {
            const board = makeBoard({ highCardTier: 'KING_HIGH' });
            expect(PostflopStrengthResolver.resolve('KQs', board)).toBe('STRONG');
        });

        it('should classify ATs on ACE_HIGH board as STRONG (has A)', () => {
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('ATs', board)).toBe('STRONG');
        });

        it('should classify hands with second rank matching board as STRONG', () => {
            // KQs on QUEEN_HIGH → Q matches highCardTier
            const board = makeBoard({ highCardTier: 'QUEEN_HIGH' });
            expect(PostflopStrengthResolver.resolve('KQs', board)).toBe('STRONG');
        });
    });

    // ── DRAW Detection ───────────────────────────────────────────

    describe('DRAW — Flush and Straight Draws', () => {
        it('should classify suited hands on TWO_TONE board as DRAW', () => {
            // Suited + TWO_TONE board, no top pair
            const board = makeBoard({ highCardTier: 'LOW_BOARD', suitedness: 'TWO_TONE' });
            expect(PostflopStrengthResolver.resolve('T9s', board)).toBe('DRAW');
        });

        it('should classify connected hands on CONNECTED board as DRAW', () => {
            const board = makeBoard({
                highCardTier: 'LOW_BOARD',
                connectivity: 'CONNECTED',
                suitedness: 'RAINBOW',
            });
            // T9o: connected ranks, rainbow so flush draw won't trigger
            expect(PostflopStrengthResolver.resolve('T9o', board)).toBe('DRAW');
        });

        it('should classify JTs on TWO_TONE board as DRAW', () => {
            const board = makeBoard({ highCardTier: 'LOW_BOARD', suitedness: 'TWO_TONE' });
            expect(PostflopStrengthResolver.resolve('JTs', board)).toBe('DRAW');
        });

        it('should NOT classify offsuit hands as flush draws on TWO_TONE boards', () => {
            // 72o on TWO_TONE LOW_BOARD — not suited, not connected
            const board = makeBoard({ highCardTier: 'LOW_BOARD', suitedness: 'TWO_TONE' });
            expect(PostflopStrengthResolver.resolve('72o', board)).not.toBe('DRAW');
        });
    });

    // ── MEDIUM Detection ─────────────────────────────────────────

    describe('MEDIUM — Pocket Pairs (non-set, non-overpair)', () => {
        it('should classify middle pocket pairs as MEDIUM', () => {
            // 88 on ACE_HIGH board: not a set (8 != ACE_HIGH), not an overpair
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('88', board)).toBe('MEDIUM');
        });

        it('should classify small pocket pairs as MEDIUM', () => {
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('22', board)).toBe('MEDIUM');
        });

        it('should classify TT on ACE_HIGH as MEDIUM (underpair)', () => {
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('TT', board)).toBe('MEDIUM');
        });

        it('should classify 55 on KING_HIGH as MEDIUM', () => {
            const board = makeBoard({ highCardTier: 'KING_HIGH' });
            expect(PostflopStrengthResolver.resolve('55', board)).toBe('MEDIUM');
        });
    });

    // ── TRASH Detection ──────────────────────────────────────────

    describe('TRASH — Fold Fodder', () => {
        it('should classify 72o on ACE_HIGH rainbow disconnected as TRASH', () => {
            const board = makeBoard({
                highCardTier: 'ACE_HIGH',
                suitedness: 'RAINBOW',
                connectivity: 'DISCONNECTED',
            });
            expect(PostflopStrengthResolver.resolve('72o', board)).toBe('TRASH');
        });

        it('should classify 93o on KING_HIGH dry board as TRASH', () => {
            const board = makeBoard({
                highCardTier: 'KING_HIGH',
                suitedness: 'RAINBOW',
                connectivity: 'DISCONNECTED',
            });
            expect(PostflopStrengthResolver.resolve('93o', board)).toBe('TRASH');
        });

        it('should classify T3o on ACE_HIGH dry board as TRASH', () => {
            const board = makeBoard({
                highCardTier: 'ACE_HIGH',
                suitedness: 'RAINBOW',
                connectivity: 'DISCONNECTED',
            });
            expect(PostflopStrengthResolver.resolve('T3o', board)).toBe('TRASH');
        });
    });

    // ── Hierarchy / Priority ─────────────────────────────────────

    describe('Strength Hierarchy', () => {
        it('NUTS should take priority over STRONG for pocket pair matching board', () => {
            // AA on ACE_HIGH: rank matches highCardTier → NUTS, not just STRONG
            const board = makeBoard({ highCardTier: 'ACE_HIGH' });
            expect(PostflopStrengthResolver.resolve('AA', board)).toBe('NUTS');
        });

        it('STRONG should take priority over DRAW', () => {
            // ATs on ACE_HIGH TWO_TONE: A matches highCardTier → STRONG before DRAW check
            const board = makeBoard({ highCardTier: 'ACE_HIGH', suitedness: 'TWO_TONE' });
            expect(PostflopStrengthResolver.resolve('ATs', board)).toBe('STRONG');
        });

        it('MEDIUM takes priority over TRASH for pocket pairs', () => {
            // 33 on ACE_HIGH dry board: pocket pair → MEDIUM, not TRASH
            const board = makeBoard({ highCardTier: 'ACE_HIGH', suitedness: 'RAINBOW', connectivity: 'DISCONNECTED' });
            expect(PostflopStrengthResolver.resolve('33', board)).toBe('MEDIUM');
        });
    });

    // ── Board Texture Interaction ────────────────────────────────

    describe('Board texture interactions', () => {
        it('same hand can be different categories on different boards', () => {
            // QJs on QUEEN_HIGH board → STRONG (top pair)
            const qHighBoard = makeBoard({ highCardTier: 'QUEEN_HIGH' });
            expect(PostflopStrengthResolver.resolve('QJs', qHighBoard)).toBe('STRONG');

            // QJs on LOW_BOARD TWO_TONE → DRAW (suited + two-tone)
            const lowTwoTone = makeBoard({ highCardTier: 'LOW_BOARD', suitedness: 'TWO_TONE' });
            expect(PostflopStrengthResolver.resolve('QJs', lowTwoTone)).toBe('DRAW');

            // QJs on LOW_BOARD RAINBOW DISCONNECTED → TRASH (no pair, no draw)
            const dryLow = makeBoard({ highCardTier: 'LOW_BOARD', suitedness: 'RAINBOW', connectivity: 'DISCONNECTED' });
            expect(PostflopStrengthResolver.resolve('QJs', dryLow)).toBe('TRASH');
        });

        it('MONOTONE board does not grant draw to unsuited hands', () => {
            const board = makeBoard({
                highCardTier: 'LOW_BOARD',
                suitedness: 'MONOTONE',
                connectivity: 'DISCONNECTED',
            });
            // 72o: offsuit, no pair, no connection → still TRASH
            expect(PostflopStrengthResolver.resolve('72o', board)).toBe('TRASH');
        });
    });
});
