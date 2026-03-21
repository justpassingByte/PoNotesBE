import { HandState, BoardTexture, HandStrength } from './models';

/**
 * FeatureExtractor: Bóc tách các đặc tính quan trọng từ dữ liệu thô
 */
export class FeatureExtractor {

    static extract(state: HandState): void {
        state.boardTexture = this.classifyBoard(state.board);
        if (state.hero && state.hero.hole_cards) {
            state.heroHandStrength = this.evaluateHandStrength(state.hero.hole_cards, state.board);
        }
    }

    /**
     * Phân loại mặt bài (Texture)
     */
    static classifyBoard(board: string[]): BoardTexture[] {
        if (board.length < 3) return ['dry'];
        
        const textures: BoardTexture[] = [];
        const suits = board.map(c => c.slice(-1));
        const ranks = board.map(c => this.rankToVal(c.slice(0, -1)));
        
        // 1. Check Monotone / Flush Possible
        const suitCounts: Record<string, number> = {};
        suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
        const maxSuits = Math.max(...Object.values(suitCounts));
        
        if (maxSuits >= 5) textures.push('monotone');
        else if (maxSuits >= 3) textures.push('flush_possible');

        // 2. Check Straight Possible (Simplified: diff < 5 range)
        const sortedRanks = [...new Set(ranks)].sort((a, b) => a - b);
        let consecutive = 1;
        let maxConsecutive = 1;
        for (let i = 0; i < sortedRanks.length - 1; i++) {
            if (sortedRanks[i+1] === sortedRanks[i] + 1) {
                consecutive++;
                maxConsecutive = Math.max(maxConsecutive, consecutive);
            } else {
                consecutive = 1;
            }
        }
        if (maxConsecutive >= 5) textures.push('low_connected');
        else if (maxConsecutive >= 3) textures.push('straight_possible');

        // 3. Check Paired
        const rankCounts: Record<number, number> = {};
        ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
        if (Object.values(rankCounts).some(c => c >= 2)) textures.push('paired');

        if (textures.length === 0) textures.push('dry');
        return textures;
    }

    /**
     * Đánh giá sức mạnh bài Hero (Simplified Logic)
     */
    static evaluateHandStrength(holeCards: string[], board: string[]): HandStrength {
        if (board.length === 0) return 'air'; // Preflop logic logic would go here

        const allCards = [...holeCards, ...board];
        const rankCounts: Record<number, number> = {};
        allCards.forEach(c => {
            const r = this.rankToVal(c.slice(0, -1));
            rankCounts[r] = (rankCounts[r] || 0) + 1;
        });

        const counts = Object.values(rankCounts);
        const pairs = counts.filter(c => c === 2).length;
        const trips = counts.filter(c => c === 3).length;
        const quads = counts.filter(c => c === 4).length;

        // Simplified Ranking
        if (quads >= 1) return 'nuts';
        if (trips >= 1 && pairs >= 1) return 'nuts'; // Full house
        if (trips >= 1) return 'very_strong';       // Set/Trips
        if (pairs >= 2) return 'strong';            // Two Pair
        if (pairs === 1) {
            // Check if it's Top Pair
            const boardRanks = board.map(c => this.rankToVal(c.slice(0, -1)));
            const maxBoardRank = Math.max(...boardRanks);
            const holeRanks = holeCards.map(c => this.rankToVal(c.slice(0, -1)));
            if (holeRanks.includes(maxBoardRank)) return 'medium'; // Top pair
            return 'weak';
        }

        return 'air';
    }

    private static rankToVal(rank: string): number {
        if (rank === 'A') return 14;
        if (rank === 'K') return 13;
        if (rank === 'Q') return 12;
        if (rank === 'J') return 11;
        if (rank === 'T') return 10;
        return parseInt(rank);
    }
}
