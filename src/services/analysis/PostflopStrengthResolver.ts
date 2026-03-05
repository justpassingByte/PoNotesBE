import { BoardTextureBucket, HighCardTier, PairedStatus } from './context/types';

/**
 * HandStrengthCategory — Qualitative strength buckets for baseline resolution.
 */
export type HandStrengthCategory = 'NUTS' | 'STRONG' | 'DRAW' | 'MEDIUM' | 'TRASH';

/**
 * PostflopStrengthResolver — Heuristic Hand Evaluator
 * 
 * Classifies 169 canonical hand classes into strength buckets based on BoardTextureBucket.
 * This is a deterministic approximation, not a full evaluator.
 */
export class PostflopStrengthResolver {
    /**
     * Resolve the strength category for a hand on a specific board.
     */
    static resolve(hand: string, board: BoardTextureBucket): HandStrengthCategory {
        const ranks = this.parseRanks(hand);
        const isSuited = hand.endsWith('s');
        const isPaired = ranks[0] === ranks[1];

        // 1. NUTS (Sets, Trips, Super-Premium Overpairs)
        if (isPaired) {
            // Set/Trips: pocket rank matches a specific high card tier (not LOW_BOARD catch-all)
            const pairTier = this.rankToTier(ranks[0]);
            if (pairTier !== 'LOW_BOARD' && pairTier === board.highCardTier) return 'NUTS';
            // Overpairs: AA/KK/QQ on low boards
            if (['A', 'K', 'Q'].includes(ranks[0]) && board.highCardTier === 'LOW_BOARD') return 'NUTS';
        }

        // 2. STRONG (Top Pairs) — only match specific high card tiers, not LOW_BOARD
        const rank0Tier = this.rankToTier(ranks[0]);
        const rank1Tier = this.rankToTier(ranks[1]);
        if (
            (rank0Tier !== 'LOW_BOARD' && rank0Tier === board.highCardTier) ||
            (rank1Tier !== 'LOW_BOARD' && rank1Tier === board.highCardTier)
        ) {
            return 'STRONG';
        }

        // 3. DRAW (Flush/Straight draws)
        if (board.suitedness === 'TWO_TONE' && isSuited) return 'DRAW';
        if (
            board.connectivity === 'CONNECTED' ||
            board.connectivity === 'VERY_CONNECTED' ||
            board.connectivity === 'SEMI_CONNECTED'
        ) {
            // Simplified: if ranks are close or high
            if (this.areConnected(ranks)) return 'DRAW';
        }

        // 4. MEDIUM (Middle pairs, pocket pairs)
        if (isPaired) return 'MEDIUM';

        // 5. TRASH (Fold fodder)
        return 'TRASH';
    }

    private static parseRanks(hand: string): [string, string] {
        return [hand[0], hand[1]];
    }

    private static rankToTier(rank: string): HighCardTier {
        switch (rank) {
            case 'A': return 'ACE_HIGH';
            case 'K': return 'KING_HIGH';
            case 'Q': return 'QUEEN_HIGH';
            case 'J': return 'JACK_HIGH';
            default: return 'LOW_BOARD';
        }
    }

    private static areConnected(ranks: [string, string]): boolean {
        const order = 'AKQJT98765432';
        const i1 = order.indexOf(ranks[0]);
        const i2 = order.indexOf(ranks[1]);
        return Math.abs(i1 - i2) <= 2;
    }
}
