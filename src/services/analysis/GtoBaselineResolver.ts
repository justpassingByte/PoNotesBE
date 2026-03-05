import { ActionFrequencies, BaselineContext } from './types';
import { HandClassGenerator } from '../../core/solver/HandClassGenerator';
import { RangeState } from '../../core/solver/RangeState';
import { PreflopRangeTemplates } from '../../core/solver/PreflopRangeTemplates';
import { HAND_STRENGTH } from '../../core/solver/HandStrengthTable';
import { PostflopStrengthResolver, HandStrengthCategory } from './PostflopStrengthResolver';
import type { BoardTextureBucket } from './context/types';

/**
 * GTO Baseline Resolver - Deterministic Frequency Computer
 */
export class GtoBaselineResolver {
    private static readonly DEFAULT_BALANCED: ActionFrequencies = {
        raise_pct: 25,
        call_pct: 40,
        fold_pct: 35,
    };

    private static readonly POSTFLOP_PROFILES: Record<
        HandStrengthCategory,
        { raise_delta: number; call_delta: number; fold_delta: number }
    > = {
        NUTS: { raise_delta: +35, call_delta: -10, fold_delta: -25 },
        STRONG: { raise_delta: +20, call_delta: +5, fold_delta: -25 },
        DRAW: { raise_delta: +10, call_delta: +15, fold_delta: -25 },
        MEDIUM: { raise_delta: -10, call_delta: +20, fold_delta: -10 },
        TRASH: { raise_delta: -25, call_delta: -10, fold_delta: +35 },
    };

    // Premium hands that must never fold in preflop baseline.
    private static readonly PREMIUM_NO_FOLD = new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']);

    public static resolve(context: BaselineContext): ActionFrequencies {
        const streetBase = this.resolveByStreet(context);
        const spotModified = this.applySpotModifier(streetBase, context.spot_template);
        const boardModified = context.board_texture
            ? this.applyBoardModifier(spotModified, context.board_texture)
            : spotModified;
        const betModified = this.applyBetModifier(boardModified, context.villain_bet);
        return this.normalize(betModified);
    }

    public static resolvePerHand(
        context: BaselineContext,
        _range: RangeState
    ): Map<string, ActionFrequencies> {
        const baseFreqs = this.resolve(context);
        const hands = HandClassGenerator.generateAll();

        if (context.street === 'preflop') {
            return this.resolvePerHandPreflop(baseFreqs, hands, context);
        }

        return this.resolvePerHandPostflop(baseFreqs, hands, context.board_texture!);
    }

    private static resolvePerHandPreflop(
        baseFreqs: ActionFrequencies,
        hands: readonly string[],
        context: BaselineContext
    ): Map<string, ActionFrequencies> {
        const result = new Map<string, ActionFrequencies>();
        const lockPremiumFold = context.street === 'preflop';
        const maxTemplateWeight = Math.max(
            1e-9,
            PreflopRangeTemplates.getMaxTemplateWeight(context.spot_template, context.stack_depth)
        );
        const contextCallShare = this.clamp(baseFreqs.call_pct / 100, 0, 0.45);

        for (const hand of hands) {
            const templateWeight = PreflopRangeTemplates.getTemplateWeight(
                hand,
                context.spot_template,
                context.stack_depth
            );

            // Hard boundary: hands outside template are pure folds preflop.
            if (templateWeight <= 0) {
                result.set(hand, { raise_pct: 0, call_pct: 0, fold_pct: 100 });
                continue;
            }

            const strength = HAND_STRENGTH[hand];
            const baseRaiseProb = this.mapStrengthToRaiseProb(strength);

            const templateScale = Math.sqrt(templateWeight / maxTemplateWeight);
            const raiseProb = this.clamp(baseRaiseProb * templateScale, 0, 1);

            const raisePct = Math.round(raiseProb * 100);
            const callPctRaw = Math.round((100 - raisePct) * contextCallShare * 0.55);
            const callPct = Math.min(callPctRaw, 35);
            const foldPct = 100 - raisePct - callPct;

            // No normalize() here by design after cap.
            const baseline: ActionFrequencies = {
                raise_pct: raisePct,
                call_pct: callPct,
                fold_pct: foldPct,
            };

            const locked = lockPremiumFold && this.PREMIUM_NO_FOLD.has(hand)
                ? this.lockPremiumFold(baseline)
                : baseline;

            result.set(hand, locked);
        }

        return result;
    }

    private static lockPremiumFold(freqs: ActionFrequencies): ActionFrequencies {
        if (freqs.fold_pct <= 0) {
            return { ...freqs, fold_pct: 0 };
        }

        const nonFold = freqs.raise_pct + freqs.call_pct;
        if (nonFold <= 0) {
            return { raise_pct: 50, call_pct: 50, fold_pct: 0 };
        }

        const raisePct = Math.round(freqs.raise_pct + freqs.fold_pct * (freqs.raise_pct / nonFold));
        const callPct = 100 - raisePct;

        return {
            raise_pct: raisePct,
            call_pct: callPct,
            fold_pct: 0,
        };
    }

    private static mapStrengthToRaiseProb(score: number): number {
        const sig = 1 / (1 + Math.exp(-1.15 * (score - 7.5)));
        return Math.min(Math.max(sig, 0), 0.97);
    }

    private static resolvePerHandPostflop(
        baseFreqs: ActionFrequencies,
        hands: readonly string[],
        board: BoardTextureBucket
    ): Map<string, ActionFrequencies> {
        const result = new Map<string, ActionFrequencies>();

        for (const hand of hands) {
            const category = PostflopStrengthResolver.resolve(hand, board);
            const profile = this.POSTFLOP_PROFILES[category];

            const raw = {
                raise_pct: baseFreqs.raise_pct + profile.raise_delta,
                call_pct: baseFreqs.call_pct + profile.call_delta,
                fold_pct: baseFreqs.fold_pct + profile.fold_delta,
            };

            result.set(hand, this.normalize(raw));
        }

        return result;
    }

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

    private static applySpotModifier(
        base: ActionFrequencies,
        spot: string
    ): ActionFrequencies {
        let result: ActionFrequencies = { ...base };

        if (spot.startsWith('3BP') || spot.startsWith('4BP')) {
            result = {
                raise_pct: result.raise_pct + 3,
                call_pct: result.call_pct - 5,
                fold_pct: result.fold_pct + 2,
            };
        }

        if (spot.endsWith('_IP')) {
            return {
                raise_pct: result.raise_pct + 5,
                call_pct: result.call_pct,
                fold_pct: result.fold_pct - 5,
            };
        }

        if (spot.endsWith('_OOP')) {
            return {
                raise_pct: result.raise_pct - 3,
                call_pct: result.call_pct + 3,
                fold_pct: result.fold_pct,
            };
        }

        return result;
    }

    private static applyBoardModifier(
        base: ActionFrequencies,
        board: NonNullable<BaselineContext['board_texture']>
    ): ActionFrequencies {
        let { raise_pct, call_pct, fold_pct } = base;

        if (board.pairedStatus === 'PAIRED' || board.pairedStatus === 'TRIPS') {
            raise_pct -= 3;
            call_pct += 3;
        }

        if (board.suitedness === 'MONOTONE') {
            raise_pct -= 5;
            fold_pct += 5;
        }

        if (board.connectivity === 'CONNECTED') {
            raise_pct += 3;
            call_pct += 2;
            fold_pct -= 5;
        }

        if (board.connectivity === 'VERY_CONNECTED') {
            raise_pct += 4;
            call_pct += 3;
            fold_pct -= 7;
        }

        if ((board.connectivity === 'DRY' || board.connectivity === 'DISCONNECTED') && board.suitedness === 'RAINBOW') {
            raise_pct += 3;
            fold_pct -= 3;
        }

        return { raise_pct, call_pct, fold_pct };
    }

    private static applyBetModifier(
        base: ActionFrequencies,
        bet: string
    ): ActionFrequencies {
        switch (bet) {
            case 'BLOCK':
                return {
                    raise_pct: base.raise_pct + 5,
                    call_pct: base.call_pct + 5,
                    fold_pct: base.fold_pct - 10,
                };
            case 'OVERBET':
                return {
                    raise_pct: base.raise_pct,
                    call_pct: base.call_pct - 10,
                    fold_pct: base.fold_pct + 10,
                };
            case 'POT':
                return {
                    raise_pct: base.raise_pct - 2,
                    call_pct: base.call_pct - 3,
                    fold_pct: base.fold_pct + 5,
                };
            default:
                return { ...base };
        }
    }

    public static normalize(freq: ActionFrequencies): ActionFrequencies {
        let r = Math.max(0, Math.min(100, freq.raise_pct));
        let c = Math.max(0, Math.min(100, freq.call_pct));
        let f = Math.max(0, Math.min(100, freq.fold_pct));

        const sum = r + c + f;
        if (sum === 0) return { raise_pct: 33, call_pct: 34, fold_pct: 33 };

        const factor = 100 / sum;
        r = Math.round(r * factor);
        c = Math.round(c * factor);
        f = 100 - r - c;

        return { raise_pct: r, call_pct: c, fold_pct: f };
    }

    private static clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
