/**
 * HandTransposer Utility
 * Handles suit isomorphism by mapping suits from a User Board to a Representative DB Board.
 */
export class HandTransposer {

    /**
     * Creates a suit mapping from userBoard to repBoard based on rank matches.
     * @param userBoard - e.g. ["Kh", "8h", "3d"]
     * @param repBoard - e.g. ["Ks", "8s", "3c"]
     * @returns A map of { userSuit: repSuit }
     */
    public static createSuitMap(userBoard: string[], repBoard: string[]): Record<string, string> {
        const suitMap: Record<string, string> = {};
        const usedRepSuits = new Set<string>();

        // 1. Map suits based on rank matches (e.g. King of Hearts -> King of Spades)
        for (let i = 0; i < Math.min(userBoard.length, repBoard.length, 3); i++) {
            const uSuit = userBoard[i][1].toLowerCase();
            const rSuit = repBoard[i][1].toLowerCase();
            
            if (!suitMap[uSuit]) {
                suitMap[uSuit] = rSuit;
                usedRepSuits.add(rSuit);
            }
        }

        // 2. Map remaining suits to unused rep suits
        const allSuits = ['s', 'h', 'd', 'c'];
        const remainingUserSuits = allSuits.filter(s => !suitMap[s]);
        const remainingRepSuits = allSuits.filter(s => !usedRepSuits.has(s));

        for (let i = 0; i < remainingUserSuits.length; i++) {
            suitMap[remainingUserSuits[i]] = remainingRepSuits[i];
        }

        return suitMap;
    }

    /**
     * Transposes a hand using the provided suit map.
     * @param hand - e.g. "AhKh"
     * @param suitMap - e.g. { "h": "s" }
     * @returns e.g. "AsKs"
     */
    public static transposeHand(hand: string, suitMap: Record<string, string>): string {
        if (!hand || hand.length !== 4) return hand;
        
        const r1 = hand[0];
        const s1 = hand[1].toLowerCase();
        const r2 = hand[2];
        const s2 = hand[3].toLowerCase();

        const ts1 = suitMap[s1] || s1;
        const ts2 = suitMap[s2] || s2;

        // Sort to maintain canonical order (optional but good for DB lookup)
        // Hand format in DB is usually HighCard then LowCard
        return r1 + ts1 + r2 + ts2;
    }
}
