import { randomUUID } from 'crypto';
import { DecisionContext, PlayerProfile } from './types';
import {
    StackDepthBucket,
    SpotTemplateBucket,
    BoardTextureBucket,
    BetBucket,
    Street,
} from './context/types';
import { boardTextureBucketSchema, betBucketSchema, stackDepthBucketSchema, spotTemplateBucketSchema, streetSchema } from '../../validators/context.schema';
import { playerProfileSchema } from '../../validators/playerProfile.schema';

/**
 * Phase 6+7: Decision Context Builder
 *
 * Orchestrates the final canonical merge of all Phase 5 abstractions into a
 * single immutable `DecisionContext` object.
 *
 * Now street-aware: preflop contexts have null board_texture.
 *
 * Rule: This builder ONLY accepts canonical objects produced by the Phase 5 parsers.
 * ZERO raw data is allowed to leak into the output (no stack numbers, card strings,
 * or raw bet sizes). It validates every input before merging.
 */

export interface DecisionContextInput {
    street: Street;
    player_profile: PlayerProfile;
    stack_depth: StackDepthBucket;
    spot_template: SpotTemplateBucket;
    board_texture: BoardTextureBucket | null; // null for preflop
    villain_bet: BetBucket;
}

export type DecisionContextResult =
    | { success: true; context: DecisionContext }
    | { success: false; errors: string[] };

export class DecisionContextBuilder {

    /**
     * Validate and merge all canonical abstractions into an immutable DecisionContext.
     * Returns a discriminated union: { success: true, context } or { success: false, errors }.
     *
     * @param input - All canonical inputs required for context construction.
     */
    public static build(input: DecisionContextInput): DecisionContextResult {
        const errors: string[] = [];

        // ── Validate street ─────────────────────────────────────────────────
        const streetResult = streetSchema.safeParse(input.street);
        if (!streetResult.success) {
            errors.push(`street: invalid value "${input.street}"`);
        }

        // ── Validate each canonical input individually ──────────────────────

        // Validate PlayerProfile (Layer B output)
        const profileResult = playerProfileSchema.safeParse(input.player_profile);
        if (!profileResult.success) {
            errors.push(`player_profile: ${profileResult.error.message}`);
        }

        // Validate StackDepthBucket
        const stackResult = stackDepthBucketSchema.safeParse(input.stack_depth);
        if (!stackResult.success) {
            errors.push(`stack_depth: invalid value "${input.stack_depth}"`);
        }

        // Validate SpotTemplateBucket
        const spotResult = spotTemplateBucketSchema.safeParse(input.spot_template);
        if (!spotResult.success) {
            errors.push(`spot_template: invalid value "${input.spot_template}"`);
        }

        // Validate BetBucket
        const betResult = betBucketSchema.safeParse(input.villain_bet);
        if (!betResult.success) {
            errors.push(`villain_bet: invalid value "${input.villain_bet}"`);
        }

        // ── Board Texture: Street-conditional validation ────────────────────
        if (input.street === 'preflop') {
            // Preflop: board_texture MUST be null (no community cards)
            if (input.board_texture !== null) {
                errors.push('board_texture: must be null for preflop street');
            }
        } else {
            // Flop/Turn/River: board_texture is required and must not contain UNKNOWN
            if (input.board_texture === null) {
                errors.push(`board_texture: required for ${input.street} street`);
            } else {
                const boardResult = boardTextureBucketSchema.safeParse(input.board_texture);
                if (!boardResult.success) {
                    errors.push(`board_texture: ${boardResult.error.message}`);
                }

                // Reject UNKNOWN fields in board texture
                if (input.board_texture.connectivity === 'UNKNOWN' ||
                    input.board_texture.pairedStatus === 'UNKNOWN' ||
                    input.board_texture.suitedness === 'UNKNOWN' ||
                    input.board_texture.highCardTier === 'UNKNOWN') {
                    errors.push('board_texture: contains UNKNOWN fields — valid board cards must be provided');
                }
            }
        }

        // ── Enforce no UNKNOWN values in a production context ───────────────
        if (input.stack_depth === 'UNKNOWN') errors.push('stack_depth: UNKNOWN is not a valid decision input');
        if (input.spot_template === 'UNKNOWN') errors.push('spot_template: UNKNOWN is not a valid decision input');
        if (input.villain_bet === 'UNKNOWN') errors.push('villain_bet: UNKNOWN is not a valid decision input');

        if (errors.length > 0) {
            return { success: false, errors };
        }

        // ── Build the immutable context object ──────────────────────────────
        const context: DecisionContext = Object.freeze({
            context_id: randomUUID(),
            street: input.street,
            player_profile: Object.freeze({ ...input.player_profile }),
            stack_depth: input.stack_depth,
            spot_template: input.spot_template,
            board_texture: input.board_texture ? Object.freeze({ ...input.board_texture }) : null,
            villain_bet: input.villain_bet,
            created_at: new Date().toISOString(),
        });

        return { success: true, context };
    }
}
