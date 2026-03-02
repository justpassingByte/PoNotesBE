/**
 * HandClassGenerator — 169 Canonical Poker Hand Classes
 *
 * Generates exactly 169 canonical hand classes in deterministic order.
 * Standard 13x13 grid: pairs on diagonal, suited above, offsuit below.
 */

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

let cachedHands: readonly string[] | null = null;

export class HandClassGenerator {
    /**
     * Returns exactly 169 canonical hand classes in deterministic order.
     * Result is cached and frozen after first call.
     */
    static generateAll(): readonly string[] {
        if (cachedHands !== null) return cachedHands;

        const hands: string[] = [];
        for (let i = 0; i < RANKS.length; i++) {
            // Pair first (AA, KK, ...)
            hands.push(`${RANKS[i]}${RANKS[i]}`);
            // Then suited/offsuit pairs with each lower rank
            for (let j = i + 1; j < RANKS.length; j++) {
                hands.push(`${RANKS[i]}${RANKS[j]}s`);
                hands.push(`${RANKS[i]}${RANKS[j]}o`);
            }
        }

        cachedHands = Object.freeze(hands);
        return cachedHands;
    }
}
