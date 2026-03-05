import { StackDepthBucket } from './types';

/**
 * Phase 4.1: Spot Abstraction - Stack Depth
 * 
 * Deterministically calculates the effective stack size 
 * and maps it rigidly into a standardized categorical bucket.
 * 
 * @param heroStackBB - Sourced strictly from the table state, already normalized to BBs.
 * @param villainStackBB - Sourced strictly from the table state, already normalized to BBs.
 * @returns A guaranteed `StackDepthBucket` enum string.
 */
export class StackDepthParser {

    /**
     * Calculates effective stack and categorizes it. No AI allowed.
     */
    public static categorize(heroStackBB: number, villainStackBB: number): StackDepthBucket {
        // Enforce strict numerical bounds (cannot be NaN, Infinity, undefined, or negative)
        if (!Number.isFinite(heroStackBB) || !Number.isFinite(villainStackBB)) return "UNKNOWN";
        if (heroStackBB <= 0 || villainStackBB <= 0) return "UNKNOWN";

        // Effective stack is the theoretical maximum money that can be put in the pot
        const effectiveStack = Math.min(heroStackBB, villainStackBB);

        // Strict non-overlapping bucket thresholds
        if (effectiveStack < 30) return "SHORT";
        if (effectiveStack < 60) return "MEDIUM";
        if (effectiveStack < 100) return "DEEP";
        return "VERY_DEEP"; // 100 or greater
    }
}
