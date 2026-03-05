/**
 * BucketIntelligence — Board-Aware + Combo-Density Multipliers
 *
 * Phase 1: Returns identity multipliers (PRECISION = 10000) for all hand classes.
 * Phase 2: Will add board-aware scaling and combo-density adjustments.
 *
 * Combo-density sub-function MUST NOT read or depend on boardContext.
 * Board blocking logic remains exclusively inside RangeFilterEngine.
 */

import { HandClassGenerator } from '../HandClassGenerator';
import type { BoardTextureBucket, Street, HandClass, MultiplierMap } from './types';
import { PRECISION } from './types';

// ─── Combo-Density Constants ───────────────────────────────────────────
const PAIR_COMBOS = 6;
const SUITED_COMBOS = 4;
const OFFSUIT_COMBOS = 12;
const AVG_COMBOS = (PAIR_COMBOS + SUITED_COMBOS + OFFSUIT_COMBOS) / 3;

const DENSITY_MIN = 7000;
const DENSITY_MAX = 13000;

function clampDensity(raw: number): number {
    return Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, raw));
}

const PAIR_DENSITY = clampDensity(Math.floor((PAIR_COMBOS / AVG_COMBOS) * PRECISION));
const SUITED_DENSITY = clampDensity(Math.floor((SUITED_COMBOS / AVG_COMBOS) * PRECISION));
const OFFSUIT_DENSITY = clampDensity(Math.floor((OFFSUIT_COMBOS / AVG_COMBOS) * PRECISION));

// ─── Board-Aware Lookup ────────────────────────────────────────────────

function isPair(hand: string): boolean {
    return hand.length === 2 && hand[0] === hand[1];
}

function isSuited(hand: string): boolean {
    return hand.length === 3 && hand[2] === 's';
}

function isBroadway(hand: string): boolean {
    const broadways = ['A', 'K', 'Q', 'J', 'T'];
    return broadways.includes(hand[0]) && broadways.includes(hand[1]);
}

function getDensityMultiplier(hand: string): number {
    if (isPair(hand)) return PAIR_DENSITY;
    if (isSuited(hand)) return SUITED_DENSITY;
    return OFFSUIT_DENSITY;
}

function getBoardMultiplier(hand: string, boardContext: BoardTextureBucket): number {
    const { suitedness, pairedStatus, highCardTier } = boardContext;
    let multiplier = PRECISION;

    if (suitedness === 'MONOTONE') {
        const suitedFactor = isSuited(hand) ? 12000 : (isPair(hand) ? PRECISION : 8000);
        multiplier = Math.floor((multiplier * suitedFactor) / PRECISION);
    }

    if (pairedStatus === 'PAIRED' || pairedStatus === 'TRIPS') {
        if (isPair(hand)) {
            multiplier = Math.floor((multiplier * 12000) / PRECISION);
        }
    }

    if (highCardTier === 'ACE_HIGH' || highCardTier === 'KING_HIGH') {
        if (isBroadway(hand)) {
            multiplier = Math.floor((multiplier * 11000) / PRECISION);
        }
    }

    return multiplier;
}

export class BucketIntelligence {
    /**
     * Compute combo-density and board-aware multipliers.
     * Returns PRECISION-scaled integer multipliers per hand class.
     *
     * 1. Combo-density: scales by canonical combo count properly clamped.
     * 2. Board-aware: stacks texture aspects multiplicatively.
     *    Combined clamped defensive boundary applied to limit overflow.
     */
    static computeMultipliers(
        boardContext: BoardTextureBucket | undefined,
        _street: Street
    ): MultiplierMap {
        const hands = HandClassGenerator.generateAll();
        const result = new Map<HandClass, number>();

        for (const hand of hands) {
            const density = getDensityMultiplier(hand);

            if (boardContext) {
                const board = getBoardMultiplier(hand, boardContext);
                // Chain: density × board / PRECISION
                const raw = Math.floor((density * board) / PRECISION);
                const combined = Math.min(raw, 30000); // Defensive clamp
                result.set(hand, combined);
            } else {
                result.set(hand, density);
            }
        }
        return result;
    }
}
