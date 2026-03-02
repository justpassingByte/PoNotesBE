/**
 * PotStateEvolution — Deterministic Pot State Transition Rules
 *
 * Pure function for evolving PotStateBucket based on action.
 * Evolution depends ONLY on action, NOT on street.
 * Pot bucket persists across street transitions — no auto-reset.
 *
 * Rules:
 * - raise: escalates bucket (BLOCK→HALF→POT→OVERBET→OVERBET)
 * - call: keeps bucket unchanged
 * - fold: throws (fold branches are terminal, cannot evolve)
 */

import type { NodeAction, PotStateBucket } from './types';

/** Deterministic raise escalation map. */
const RAISE_ESCALATION: Record<string, PotStateBucket> = {
    BLOCK: 'HALF',
    HALF: 'POT',
    POT: 'OVERBET',
    OVERBET: 'OVERBET',
    UNKNOWN: 'HALF',
};

export class PotStateEvolution {
    /**
     * Evolve pot state based on action.
     * No street parameter — evolution depends only on action.
     *
     * @throws if action is 'fold' (terminal branch)
     */
    static evolve(currentPot: PotStateBucket, action: NodeAction): PotStateBucket {
        if (action === 'fold') {
            throw new Error(
                'Cannot evolve pot state for fold action: fold branches are terminal'
            );
        }

        if (action === 'call') {
            return currentPot;
        }

        // action === 'raise'
        const escalated = RAISE_ESCALATION[currentPot];
        if (!escalated) {
            throw new Error(`Unknown PotStateBucket: ${currentPot}`);
        }
        return escalated;
    }
}
