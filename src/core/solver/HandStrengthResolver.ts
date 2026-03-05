import { HandClassGenerator } from './HandClassGenerator';

const RANK_VALUE: Record<string, number> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    '9': 9,
    '8': 8,
    '7': 7,
    '6': 6,
    '5': 5,
    '4': 4,
    '3': 3,
    '2': 2,
};

const BROADWAY = new Set(['A', 'K', 'Q', 'J', 'T']);
const WHEEL_LOW = new Set(['5', '4', '3', '2']);

interface ParsedHand {
    readonly r1: string;
    readonly r2: string;
    readonly v1: number;
    readonly v2: number;
    readonly high: number;
    readonly low: number;
    readonly gap: number;
    readonly isPair: boolean;
    readonly isSuited: boolean;
}

function parseHand(hand: string): ParsedHand {
    const r1 = hand[0];
    const r2 = hand[1];
    const v1 = RANK_VALUE[r1] ?? 0;
    const v2 = RANK_VALUE[r2] ?? 0;
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);

    return {
        r1,
        r2,
        v1,
        v2,
        high,
        low,
        gap: Math.abs(v1 - v2),
        isPair: r1 === r2,
        isSuited: hand.length === 3 && hand[2] === 's',
    };
}

function isBroadwayCombo(parsed: ParsedHand): boolean {
    return BROADWAY.has(parsed.r1) && BROADWAY.has(parsed.r2);
}

function isWheelAceSuited(parsed: ParsedHand): boolean {
    return parsed.isSuited && (parsed.r1 === 'A' || parsed.r2 === 'A') && WHEEL_LOW.has(parsed.r1 === 'A' ? parsed.r2 : parsed.r1);
}

export class HandStrengthResolver {
    private static cachedAll: ReadonlyMap<string, number> | null = null;

    static computeStrength(hand: string): number {
        const parsed = parseHand(hand);
        let score = 0;

        // Rank strength base: high card dominates, low card still contributes.
        score += parsed.high * 0.45;
        score += parsed.low * 0.18;

        if (parsed.isPair) score += 4;
        if (parsed.isSuited) score += 1.5;
        if (parsed.gap === 1) score += 1.5;
        if (parsed.gap === 2) score += 1;
        if (isBroadwayCombo(parsed)) score += 2;
        if (isWheelAceSuited(parsed)) score += 1;

        // Blocker bonuses.
        if (parsed.r1 === 'A' || parsed.r2 === 'A') score += 1.2;
        if (parsed.r1 === 'K' || parsed.r2 === 'K') score += 0.6;

        // Suited connectors are particularly playable.
        if (parsed.isSuited && parsed.gap === 1) score += 0.7;

        return score;
    }

    static computeAll(): ReadonlyMap<string, number> {
        if (this.cachedAll) {
            return this.cachedAll;
        }

        const all = new Map<string, number>();
        for (const hand of HandClassGenerator.generateAll()) {
            all.set(hand, this.computeStrength(hand));
        }

        this.cachedAll = all;
        return this.cachedAll;
    }
}
