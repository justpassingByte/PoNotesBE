import {
    ParsedSignal,
    TemplateNoteInput,
    PlayerProfile,
    PlayerTendency,
    Archetype,
    TendencyTag
} from './types';
import { v4 as uuidv4 } from 'uuid';

export class PlayerProfileAggregator {

    /**
     * Layer B: Player Profiling
     * The single source of truth for creating a PlayerProfile.
     * Inherently deterministic. No AI is permitted in this layer.
     */
    public aggregate(
        sampleSize: number,
        stats: { vpip: number; pfr: number; three_bet?: number; },
        templateNotes: TemplateNoteInput[],
        aiSignals: ParsedSignal[],
        aiConfidence: number
    ): PlayerProfile {

        const reliability = this.calculateReliability(sampleSize, templateNotes.length, aiSignals.length, aiConfidence);
        const { aggression, looseness } = this.calculateScores(stats, templateNotes, aiSignals);
        const archetype = this.classifyArchetype(aggression, looseness, sampleSize);
        const tendencies = this.normalizeAndWeightTendencies(templateNotes, aiSignals);

        return {
            player_profile_id: uuidv4(),
            archetype,
            tendencies,
            aggression_score: aggression,
            looseness_score: looseness,
            confidence: reliability.overall_confidence,
            reliability_score: reliability.reliability_score,
            data_sources: {
                stats_weight: reliability.stats_weight,
                template_weight: reliability.template_weight,
                custom_note_weight: reliability.custom_note_weight
            }
        };
    }

    private calculateReliability(sampleSize: number, templateCount: number, signalCount: number, aiConfidence: number) {
        // Simple deterministic weighting math
        let stats_weight = sampleSize > 1000 ? 0.70 : (sampleSize > 100 ? 0.50 : 0.20);
        let template_weight = Math.min(templateCount * 0.05, 0.30);
        let custom_note_weight = Math.min(signalCount * 0.02, 0.20) * (aiConfidence || 1.0);

        // Normalize to 1.0 logic
        const total = stats_weight + template_weight + custom_note_weight;
        if (total === 0) {
            return { stats_weight: 0, template_weight: 0, custom_note_weight: 0, overall_confidence: 0, reliability_score: 0 };
        }

        return {
            stats_weight: Number((stats_weight / total).toFixed(2)),
            template_weight: Number((template_weight / total).toFixed(2)),
            custom_note_weight: Number((custom_note_weight / total).toFixed(2)),
            overall_confidence: Number(Math.min(total, 1.0).toFixed(2)),
            reliability_score: Number(Math.min((sampleSize / 500) * 0.5 + (total * 0.5), 1.0).toFixed(2))
        };
    }

    private calculateScores(stats: any, templates: TemplateNoteInput[], signals: ParsedSignal[]) {
        let looseness = stats.vpip || 20; // fallback to average
        let aggression = stats.pfr ? (stats.pfr / Math.max(stats.vpip || 1, 1)) * 100 : 50;

        // Bounded adjustments based on extracted behaviors - deterministic
        const aggroActions = ['overbet', 'shove', '3bet', '4bet', 'check-raise'];
        const passiveActions = ['call', 'limp', 'fold', 'check-call'];

        let aggroMod = 0;
        signals.concat(templates as any).forEach((actionItem: any) => {
            const actionStr = (actionItem.action_type || actionItem.action || '').toLowerCase();
            if (aggroActions.some(a => actionStr.includes(a))) aggroMod += 2;
            if (passiveActions.some(a => actionStr.includes(a))) aggroMod -= 2;
        });

        return {
            looseness: Math.max(0, Math.min(100, Math.round(looseness))),
            aggression: Math.max(0, Math.min(100, Math.round(aggression + aggroMod)))
        };
    }

    private classifyArchetype(aggression: number, looseness: number, sampleSize: number): Archetype {
        if (sampleSize < 20) return 'unknown';

        if (looseness > 40 && aggression > 60) return 'maniac';
        if (looseness > 40 && aggression <= 30) return 'loose_passive';
        if (looseness > 30 && aggression > 40) return 'lag';
        if (looseness < 20 && aggression > 50) return 'tag';
        if (looseness < 20 && aggression <= 30) return 'nit';
        if (looseness > 25 && aggression < 35) return 'calling_station';

        return 'unknown';
    }

    private normalizeAndWeightTendencies(templates: TemplateNoteInput[], signals: ParsedSignal[]): PlayerTendency[] {
        const tendencyMap = new Map<TendencyTag | string, number>();

        // We normalize arbitrary strings from AI into taxonomy keys
        const normalize = (action: string): string => {
            const a = action.toLowerCase();
            if (a.includes('overfold')) return 'overfold_to_turn_barrel';
            if (a.includes('check-raise') || a.includes('cr')) return 'check_raise_bluff_flop';
            if (a.includes('overbet') || a.includes('jam')) return 'overbet_jam';
            if (a.includes('call station') || a.includes('hero call')) return 'river_call_station';
            if (a.includes('limp') && a.includes('raise')) return 'preflop_limp_reraise';
            return a; // fallback to raw string
        };

        const addWeight = (tag: string, weight: number) => {
            tendencyMap.set(tag, Math.min(1.0, (tendencyMap.get(tag) || 0) + weight));
        };

        templates.forEach(t => addWeight(normalize(t.action), 0.5));
        signals.forEach(s => addWeight(normalize(s.action_type), s.confidence * 0.3));

        return Array.from(tendencyMap.entries())
            .map(([tag, weight]) => ({ tag, weight: Number(weight.toFixed(2)) }))
            .sort((a, b) => b.weight - a.weight);
    }
}
