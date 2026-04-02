/**
 * GTO Oracle Prompt Builder
 *
 * Delegates system prompt to promptManager.buildGtoOraclePrompt().
 * Handles response parsing and validation.
 */

import { buildGtoOraclePrompt } from '../promptManager';

const BOARD_BUCKETS = [
    "auto",
    "A_dry", "K_dry", "Q_dry", "ace_wet", "broadway_wet",
    "connected_high", "connected_mid", "connected_low",
    "low_dry", "mid_wet", "monotone_A", "monotone_low",
    "paired_high", "paired_mid", "paired_low",
    "two_tone_A", "two_tone_K", "two_tone_low"
] as const;

export type BoardBucket = typeof BOARD_BUCKETS[number];

export interface GtoParsedQuery {
    position: string;
    board_bucket: BoardBucket;
    street: 'flop' | 'turn' | 'river';
    action_line: string | null;
    turn_type: string | null;
    river_type: string | null;
    hero_hand: string | null;
    hero_hand_class: string | null;
    hero_position: 'oop' | 'ip';
    board_cards: string;
    situation_summary: string;
}

export class GtoPromptBuilder {

    /**
     * Build system prompt — delegates to centralized promptManager.
     */
    public static buildSystemPrompt(language?: string): string {
        return buildGtoOraclePrompt(language);
    }

    /**
     * Build user prompt from the raw question.
     */
    public static buildUserPrompt(question: string): string {
        return question;
    }

    /**
     * Parse the LLM response text into a GtoParsedQuery.
     * Extracts JSON from the response, handling markdown code fences.
     */
    public static parseResponse(llmText: string): GtoParsedQuery {
        const jsonMatch = llmText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('LLM did not return valid JSON');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate required fields
        if (!parsed.position || !parsed.board_bucket || !parsed.street) {
            throw new Error('Missing required fields: position, board_bucket, street');
        }

        // Validate board_bucket
        if (!(BOARD_BUCKETS as readonly string[]).includes(parsed.board_bucket)) {
            throw new Error(`Invalid board_bucket: ${parsed.board_bucket}. Must be one of: ${BOARD_BUCKETS.join(', ')}`);
        }

        // Enforce null rules by street
        if (parsed.street === 'flop') {
            // Preserve facing_cbet action_lines (e.g. "facing_cbet33", "facing_cbet75")
            if (!parsed.action_line?.includes('facing_')) {
                parsed.action_line = null;
            }
            parsed.turn_type = null;
            parsed.river_type = null;
        } else if (parsed.street === 'turn') {
            parsed.river_type = null;
        }

        // Normalize nulls (LLM sometimes sends "null" string)
        for (const key of ['action_line', 'turn_type', 'river_type', 'hero_hand', 'hero_hand_class']) {
            if (parsed[key] === 'null' || parsed[key] === '') {
                parsed[key] = null;
            }
        }

        return parsed as GtoParsedQuery;
    }
}
