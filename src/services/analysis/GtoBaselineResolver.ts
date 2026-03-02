import { ActionFrequencies, BaselineContext } from './types';

/**
 * GTO Baseline Resolver — Deterministic Frequency Computer
 *
 * Computes GTO-like baseline action frequencies from canonical BaselineContext.
 * NO AI. NO randomness. Pure deterministic heuristic.
 *
 * Resolution order:
 *   1. Street
 *   2. Spot Template
 *   3. Board Texture (postflop only)
 *   4. Villain Bet Size
 *   5. Fallback balanced default
 *
 * These are heuristic approximations of GTO frequencies, not solver outputs.
 */
export class GtoBaselineResolver {

    // Balanced default: slightly defensive
    private static readonly DEFAULT_BALANCED: ActionFrequencies = { raise_pct: 25, call_pct: 40, fold_pct: 35 };

    /**
     * Resolve deterministic baseline frequencies from a BaselineContext.
     * Always returns a triple that sums to 100.
     */
    public static resolve(context: BaselineContext): ActionFrequencies {
        // Step 1: Street-level resolution
        const streetBase = this.resolveByStreet(context);

        // Step 2: Apply spot template modifier
        const spotModified = this.applySpotModifier(streetBase, context.spot_template);

        // Step 3: Apply board texture modifier (postflop only)
        const boardModified = context.board_texture
            ? this.applyBoardModifier(spotModified, context.board_texture)
            : spotModified;

        // Step 4: Apply bet size modifier
        const betModified = this.applyBetModifier(boardModified, context.villain_bet);

        // Ensure sum = 100 after all modifications
        return this.normalize(betModified);
    }

    // ─── Street Resolution ──────────────────────────────────────────

    private static resolveByStreet(context: BaselineContext): ActionFrequencies {
        switch (context.street) {
            case 'preflop':
                return { raise_pct: 30, call_pct: 35, fold_pct: 35 };
            case 'flop':
                return { raise_pct: 25, call_pct: 40, fold_pct: 35 };
            case 'turn':
                return { raise_pct: 22, call_pct: 38, fold_pct: 40 };
            case 'river':
                return { raise_pct: 20, call_pct: 35, fold_pct: 45 };
            default:
                return { ...this.DEFAULT_BALANCED };
        }
    }

    // ─── Spot Template Modifier ─────────────────────────────────────

    private static applySpotModifier(
        base: ActionFrequencies,
        spot: string
    ): ActionFrequencies {
        // IP players raise more, fold less
        if (spot.endsWith('_IP')) {
            return {
                raise_pct: base.raise_pct + 5,
                call_pct: base.call_pct,
                fold_pct: base.fold_pct - 5,
            };
        }

        // OOP players are more defensive
        if (spot.endsWith('_OOP')) {
            return {
                raise_pct: base.raise_pct - 3,
                call_pct: base.call_pct + 3,
                fold_pct: base.fold_pct,
            };
        }

        // 3BP/4BP pots: tighter ranges, more polarized
        if (spot.startsWith('3BP') || spot.startsWith('4BP')) {
            return {
                raise_pct: base.raise_pct + 3,
                call_pct: base.call_pct - 5,
                fold_pct: base.fold_pct + 2,
            };
        }

        return { ...base };
    }

    // ─── Board Texture Modifier ─────────────────────────────────────

    private static applyBoardModifier(
        base: ActionFrequencies,
        board: NonNullable<BaselineContext['board_texture']>
    ): ActionFrequencies {
        let { raise_pct, call_pct, fold_pct } = base;

        // Paired boards: less raising (fewer combos hit)
        if (board.pairedStatus === 'PAIRED' || board.pairedStatus === 'TRIPS') {
            raise_pct -= 3;
            call_pct += 3;
        }

        // Monotone boards: more caution
        if (board.suitedness === 'MONOTONE') {
            raise_pct -= 5;
            fold_pct += 5;
        }

        // Connected boards: more action
        if (board.connectivity === 'CONNECTED') {
            raise_pct += 3;
            call_pct += 2;
            fold_pct -= 5;
        }

        // Dry disconnected boards: more aggression viable
        if (board.connectivity === 'DISCONNECTED' && board.suitedness === 'RAINBOW') {
            raise_pct += 3;
            fold_pct -= 3;
        }

        return { raise_pct, call_pct, fold_pct };
    }

    // ─── Bet Size Modifier ──────────────────────────────────────────

    private static applyBetModifier(
        base: ActionFrequencies,
        bet: string
    ): ActionFrequencies {
        switch (bet) {
            case 'BLOCK':
                // Small bet: more calls, more raises
                return {
                    raise_pct: base.raise_pct + 5,
                    call_pct: base.call_pct + 5,
                    fold_pct: base.fold_pct - 10,
                };
            case 'OVERBET':
                // Overbet: more folds, fewer calls
                return {
                    raise_pct: base.raise_pct,
                    call_pct: base.call_pct - 10,
                    fold_pct: base.fold_pct + 10,
                };
            case 'POT':
                // Pot bet: slightly more folds
                return {
                    raise_pct: base.raise_pct - 2,
                    call_pct: base.call_pct - 3,
                    fold_pct: base.fold_pct + 5,
                };
            default:
                // HALF or unknown: no modification
                return { ...base };
        }
    }

    // ─── Normalize to sum=100 ───────────────────────────────────────

    public static normalize(freq: ActionFrequencies): ActionFrequencies {
        // Clamp first
        let r = Math.max(0, Math.min(100, freq.raise_pct));
        let c = Math.max(0, Math.min(100, freq.call_pct));
        let f = Math.max(0, Math.min(100, freq.fold_pct));

        const sum = r + c + f;
        if (sum === 0) return { raise_pct: 33, call_pct: 34, fold_pct: 33 };

        // Normalize by ratio
        const factor = 100 / sum;
        r = Math.round(r * factor);
        c = Math.round(c * factor);
        f = 100 - r - c; // Force exact sum

        return { raise_pct: r, call_pct: c, fold_pct: f };
    }
}
