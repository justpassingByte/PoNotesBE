import { CustomNoteParser } from './analysis/CustomNoteParser';
import { PlayerProfileAggregator } from './analysis/PlayerProfileAggregator';
import { PlayerAnalysisInput, PlayerProfile } from './analysis/types';

/**
 * Orchestrator service for the Decision Engine Core.
 * Enforces the strict Layer A (Signal Extraction) -> Layer B (Aggregation) pipeline.
 */
export class PlayerAnalysisService {
    private customNoteParser = new CustomNoteParser();
    private profileAggregator = new PlayerProfileAggregator();

    /**
     * Run the deterministic player profiling pipeline.
     */
    async analyze(input: PlayerAnalysisInput): Promise<PlayerProfile> {
        // LAYER A: Signal Extraction (AI)
        // Only custom notes pass through the AI layer. Returns strict AIParseResult.
        const aiResult = await this.customNoteParser.parse(input.custom_notes_raw);

        // LAYER B: Player Profiling
        // Pure deterministic logic merging stats, templates, and parsed signals.
        const profile = this.profileAggregator.aggregate(
            input.sample_size,
            input.stats,
            input.template_notes,
            aiResult.parsed_signals,
            aiResult.parse_confidence
        );

        // Return the canonical PlayerProfile object.
        // Parsed signals are completely discarded and not exposed to the API/DB.
        return profile;
    }
}
