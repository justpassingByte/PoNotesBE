import { DecisionContextBuilder, DecisionContextInput } from '../DecisionContextBuilder';
import { PlayerProfile } from '../types';
import { BoardTextureBucket } from '../context/types';

// ── Test Fixtures ───────────────────────────────────────────────

const validProfile: PlayerProfile = {
    player_profile_id: '550e8400-e29b-41d4-a716-446655440000',
    archetype: 'lag',
    tendencies: [{ tag: 'check_raise_bluff_flop', weight: 0.7 }],
    aggression_score: 72,
    looseness_score: 60,
    confidence: 0.8,
    reliability_score: 0.65,
    data_sources: { stats_weight: 0.6, template_weight: 0.25, custom_note_weight: 0.15 },
};

const validBoard: BoardTextureBucket = {
    highCardTier: 'ACE_HIGH',
    pairedStatus: 'UNPAIRED',
    suitedness: 'RAINBOW',
    connectivity: 'DISCONNECTED',
};

const validFlopInput: DecisionContextInput = {
    street: 'flop',
    player_profile: validProfile,
    stack_depth: 'DEEP',
    spot_template: 'SRP_IP',
    board_texture: validBoard,
    villain_bet: 'HALF',
};

// ── Tests ────────────────────────────────────────────────────────

describe('DecisionContextBuilder', () => {

    describe('Successful builds', () => {
        it('should build a valid flop context', () => {
            const result = DecisionContextBuilder.build(validFlopInput);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.context.street).toBe('flop');
                expect(result.context.player_profile.archetype).toBe('lag');
                expect(result.context.stack_depth).toBe('DEEP');
                expect(result.context.spot_template).toBe('SRP_IP');
                expect(result.context.board_texture).toEqual(validBoard);
                expect(result.context.villain_bet).toBe('HALF');
                expect(result.context.context_id).toBeDefined();
                expect(result.context.created_at).toBeDefined();
            }
        });

        it('should build a valid preflop context with null board_texture', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                street: 'preflop',
                board_texture: null,
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.context.street).toBe('preflop');
                expect(result.context.board_texture).toBeNull();
            }
        });

        it('should build a valid turn context', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                street: 'turn',
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(true);
        });

        it('should build a valid river context', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                street: 'river',
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(true);
        });
    });

    describe('Preflop / board_texture validation', () => {
        it('should FAIL if preflop has non-null board_texture', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                street: 'preflop',
                board_texture: validBoard, // should be null!
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(false);
            if (!result.success) {
                const err = result as { success: false; errors: string[] };
                expect(err.errors.some(e => e.includes('must be null for preflop'))).toBe(true);
            }
        });

        it('should FAIL if flop has null board_texture', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                street: 'flop',
                board_texture: null,
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(false);
            if (!result.success) {
                const err = result as { success: false; errors: string[] };
                expect(err.errors.some(e => e.includes('required for flop'))).toBe(true);
            }
        });
    });

    describe('UNKNOWN rejection', () => {
        it('should FAIL if stack_depth is UNKNOWN', () => {
            const input: DecisionContextInput = { ...validFlopInput, stack_depth: 'UNKNOWN' };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(false);
            if (!result.success) {
                const err = result as { success: false; errors: string[] };
                expect(err.errors.some(e => e.includes('stack_depth') && e.includes('UNKNOWN'))).toBe(true);
            }
        });

        it('should FAIL if villain_bet is UNKNOWN', () => {
            const input: DecisionContextInput = { ...validFlopInput, villain_bet: 'UNKNOWN' };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(false);
        });

        it('should FAIL if board_texture contains UNKNOWN fields', () => {
            const input: DecisionContextInput = {
                ...validFlopInput,
                board_texture: { ...validBoard, highCardTier: 'UNKNOWN' },
            };
            const result = DecisionContextBuilder.build(input);
            expect(result.success).toBe(false);
        });
    });

    describe('Immutability', () => {
        it('should freeze the returned context', () => {
            const result = DecisionContextBuilder.build(validFlopInput);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(Object.isFrozen(result.context)).toBe(true);
            }
        });
    });
});
