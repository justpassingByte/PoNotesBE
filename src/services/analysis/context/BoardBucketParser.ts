import { BoardTextureBucket, HighCardTier, PairedStatus, Suitedness, Connectivity } from './types';

const UNKNOWN_BOARD: BoardTextureBucket = {
    highCardTier: "UNKNOWN",
    pairedStatus: "UNKNOWN",
    suitedness: "UNKNOWN",
    connectivity: "UNKNOWN"
};

/**
 * Board Texture Bucket Parser
 * 100% Deterministic extraction of board structural properties.
 * Supports flop (3 cards), turn (4 cards), and river (5 cards).
 */
export class BoardBucketParser {

    // Ranks mapped to numeric values
    private static RANK_MAP: Record<string, number> = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
        '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };

    /**
     * Parse array of raw card strings (e.g. ["Ah", "Kd", "2c"] or ["Ah", "Kd", "2c", "7s", "Jh"])
     * Accepts 3 (flop), 4 (turn), or 5 (river) cards.
     * Guarantees returning either a perfect extraction object OR the fully UNKNOWN atomic object.
     */
    public static categorize(cards: string[]): BoardTextureBucket {
        try {
            if (!this.isValidInput(cards)) return UNKNOWN_BOARD;

            const ranks = cards.map(c => c[0].toUpperCase());
            const suits = cards.map(c => c[1].toLowerCase());

            const pairedStatus = this.calculatePairedStatus(ranks);

            return {
                highCardTier: this.calculateHighCardTier(ranks),
                pairedStatus,
                suitedness: this.calculateSuitedness(suits),
                connectivity: this.calculateConnectivity(ranks, pairedStatus)
            };
        } catch (e) {
            return UNKNOWN_BOARD; // Pure atomic fallback on any throw
        }
    }

    private static isValidInput(cards: string[]): boolean {
        if (!Array.isArray(cards)) return false;
        // Accept 3 (flop), 4 (turn), or 5 (river) cards
        if (cards.length < 3 || cards.length > 5) return false;

        const cardRegex = /^[23456789TJQKA][shdc]$/i;
        const seen = new Set<string>();

        for (const card of cards) {
            if (!cardRegex.test(card)) return false;

            // Normalize case before checking uniqueness (e.g., 'Ah' equals 'aH')
            const normalized = card[0].toUpperCase() + card[1].toLowerCase();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
        }

        return true;
    }

    private static calculateHighCardTier(ranks: string[]): HighCardTier {
        const values = ranks.map(r => this.RANK_MAP[r]);
        const maxVal = Math.max(...values);

        if (maxVal === 14) return "ACE_HIGH";
        if (maxVal === 13) return "KING_HIGH";
        if (maxVal === 12) return "QUEEN_HIGH";
        if (maxVal === 11) return "JACK_HIGH";
        if (maxVal <= 10 && maxVal >= 2) return "LOW_BOARD";

        return "UNKNOWN";
    }

    /**
     * Calculate paired status based on the number of unique ranks.
     * Adapts to board size:
     *   Flop (3 cards):  3 unique → UNPAIRED, 2 → PAIRED, 1 → TRIPS
     *   Turn (4 cards):  4 unique → UNPAIRED, 3 → PAIRED, 2 → TWO_PAIR or TRIPS, 1 → QUADS
     *   River (5 cards): 5 unique → UNPAIRED, 4 → PAIRED, 3 → TWO_PAIR, 2 → TRIPS, 1 → QUADS
     *
     * For ambiguous cases (e.g., 4 cards with 2 unique ranks could be TWO_PAIR or TRIPS),
     * we check max frequency to disambiguate.
     */
    private static calculatePairedStatus(ranks: string[]): PairedStatus {
        const uniqueCount = new Set(ranks).size;
        const cardCount = ranks.length;

        // All ranks unique — unpaired
        if (uniqueCount === cardCount) return "UNPAIRED";

        // All ranks identical
        if (uniqueCount === 1) {
            return cardCount >= 4 ? "QUADS" : "TRIPS";
        }

        // Count frequency of each rank to disambiguate
        const freq = new Map<string, number>();
        for (const r of ranks) {
            freq.set(r, (freq.get(r) || 0) + 1);
        }
        const maxFreq = Math.max(...freq.values());

        // Flop (3 cards)
        if (cardCount === 3) {
            if (uniqueCount === 2) return "PAIRED";
            if (uniqueCount === 1) return "TRIPS";
        }

        // Turn (4 cards)
        if (cardCount === 4) {
            if (uniqueCount === 3) return "PAIRED";        // one pair + 2 singles
            if (uniqueCount === 2) {
                return maxFreq >= 3 ? "TRIPS" : "TWO_PAIR"; // 3+1 = TRIPS, 2+2 = TWO_PAIR
            }
        }

        // River (5 cards)
        if (cardCount === 5) {
            if (uniqueCount === 4) return "PAIRED";         // one pair + 3 singles
            if (uniqueCount === 3) return "TWO_PAIR";       // two pairs + 1 single (most common)
            if (uniqueCount === 2) {
                return maxFreq >= 4 ? "QUADS" : "TRIPS";    // 4+1 = QUADS, 3+2 = TRIPS (full house)
            }
        }

        return "UNKNOWN";
    }

    private static calculateSuitedness(suits: string[]): Suitedness {
        const uniqueSuits = new Set(suits).size;
        if (uniqueSuits === 1) return "MONOTONE";
        if (uniqueSuits === 2) return "TWO_TONE";
        if (uniqueSuits >= 3) return "RAINBOW";

        return "UNKNOWN"; // Defensive fallback
    }

    private static calculateConnectivity(ranks: string[], pairedStatus: PairedStatus): Connectivity {
        // Non-unpaired boards short-circuit to disconnected
        if (pairedStatus !== "UNPAIRED") return "DISCONNECTED";

        // Extract strictly unique numeric values
        const uniqueValues = Array.from(new Set(ranks.map(r => this.RANK_MAP[r])));
        if (uniqueValues.length < 3) return "DISCONNECTED"; // Fallback constraint

        const maxStd = Math.max(...uniqueValues);
        const minStd = Math.min(...uniqueValues);
        const standardSpan = maxStd - minStd;

        let minSpan = standardSpan;

        // Dual Ace evaluation: If Ace exists (14), treat it as 1 and re-eval span
        if (uniqueValues.includes(14)) {
            const lowValues = uniqueValues.map(v => v === 14 ? 1 : v);
            const maxLow = Math.max(...lowValues);
            const minLow = Math.min(...lowValues);
            const lowSpan = maxLow - minLow;

            minSpan = Math.min(standardSpan, lowSpan);
        }

        // Strict span mapping
        if (minSpan < 2) return "DISCONNECTED"; // Defensive
        if (minSpan === 2) return "CONNECTED"; // e.g. 5,6,7 (7-5=2)
        if (minSpan === 3 || minSpan === 4) return "SEMI_CONNECTED"; // e.g. 5,7,8 (8-5=3) or 5,6,9 (9-5=4)

        return "DISCONNECTED"; // span > 4 e.g. 2,6,A (14-2=12)
    }
}
