import { BetBucket } from './types';

/**
 * Phase 5.4: Bet Bucket Parser
 *
 * Converts a raw bet size and pot size into a canonical BetBucket.
 * Abstraction is STRICTLY percentage-based — no strategic inference allowed.
 *
 * Thresholds (inclusive/exclusive, zero overlap):
 *   BLOCK:   betPct <= 25%
 *   HALF:    betPct >  25% AND betPct <= 50%
 *   POT:     betPct >  50% AND betPct <= 100%
 *   OVERBET: betPct >  100%
 */
export class BetBucketParser {

    /**
     * Classify a bet into a canonical BetBucket.
     * @param betSize  - The absolute size of the bet (any unit, e.g. BB or chips).
     * @param potSize  - The pot size BEFORE the bet (same unit as betSize).
     * @returns A canonical BetBucket string, or "UNKNOWN" if inputs are invalid.
     */
    public static categorize(betSize: number, potSize: number): BetBucket {
        try {
            if (!this.isValidInput(betSize, potSize)) return "UNKNOWN";

            const betPct = (betSize / potSize) * 100;

            if (betPct <= 25) return "BLOCK";
            if (betPct <= 50) return "HALF";
            if (betPct <= 100) return "POT";
            return "OVERBET";

        } catch {
            return "UNKNOWN";
        }
    }

    private static isValidInput(betSize: number, potSize: number): boolean {
        // Both values must be finite, positive numbers
        if (typeof betSize !== 'number' || typeof potSize !== 'number') return false;
        if (!isFinite(betSize) || !isFinite(potSize)) return false;
        if (betSize <= 0) return false;  // A bet of 0 is not a bet
        if (potSize <= 0) return false;  // Pot cannot be 0 or negative
        return true;
    }
}
