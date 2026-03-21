import { ParsedSignal, AIParseResult } from './types';

/**
 * Layer A: Signal Extraction (AI Layer)
 * AI-powered custom note parser using Groq.
 * Extracts low-level structured behavioral signals from raw text notes.
 * STRICTLY internal output. Must not attempt to aggregate, profile, or suggest exploits.
 */
export class CustomNoteParser {

    /**
     * Parse an array of raw custom notes into structured signals.
     */
    async parse(customNotes: string[]): Promise<AIParseResult> {
        if (customNotes.length === 0) return { parsed_signals: [], parse_confidence: 1.0, source: 'custom_ai' };

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.log('[CustomNoteParser] Groq key not available, skipping custom note parsing');
            return { parsed_signals: [], parse_confidence: 1.0, source: 'custom_ai' };
        }

        console.log(`[CustomNoteParser] Starting parallel parsing of ${customNotes.length} notes via Groq...`);

        // Parse all notes in parallel with graceful error handling
        const results = await Promise.allSettled(
            customNotes.map(note => this.parseSingleNote(apiKey, note))
        );

        const signals: ParsedSignal[] = [];
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value.parsed_signals.length > 0) {
                // Merge valid signals
                for (const signal of result.value.parsed_signals) {
                    if (signal.action_type !== 'mocked action (rate limited)') {
                        signals.push(signal);
                        successCount++;
                    }
                }
            } else if (result.status === 'rejected') {
                console.warn(`[CustomNoteParser] Failed to parse note ${i}: ${result.reason}`);
                failCount++;
            } else {
                failCount++;
            }
        }

        console.log(`[CustomNoteParser] Parsing complete. Success: ${successCount}, Skipped/Failed: ${failCount}. Extracted ${signals.length} signals.`);

        // Calculate a naive average confidence for the batch parse operation
        const avgConfidence = signals.length > 0
            ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
            : 0.1;

        return {
            parsed_signals: signals,
            parse_confidence: Number(avgConfidence.toFixed(2)),
            source: 'custom_ai'
        };
    }

    private async parseSingleNote(apiKey: string, noteText: string): Promise<AIParseResult> {
        const prompt = this.buildPrompt(noteText);
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const OpenAI = require('openai');
                const groq = new OpenAI({
                    apiKey: apiKey,
                    baseURL: 'https://api.groq.com/openai/v1'
                });

                console.log(`\n--- [CustomNoteParser] AI PROMPT (Attempt ${attempt + 1}) ---`);
                console.log(prompt);
                console.log(`---------------------------------------------------\n`);

                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: prompt }
                    ],
                    model: 'llama-3.3-70b-versatile',
                    response_format: { type: 'json_object' },
                    temperature: 0.1
                });

                const text = completion.choices[0].message.content || '{}';

                console.log(`--- [CustomNoteParser] AI RAW RESPONSE ---`);
                console.log(text);
                console.log(`--------------------------------------------\n`);

                const parsed = JSON.parse(text) as any;

                if (!parsed.parsed_signals || !Array.isArray(parsed.parsed_signals)) {
                    console.warn('[CustomNoteParser] Invalid response structure, skipping note');
                    return this.getMockResponse(noteText);
                }

                // Transform AI-parsed signals into strictest ParsedSignal schema
                const validSignals = parsed.parsed_signals
                    .filter((s: any) => s.street && s.position && s.action_type)
                    .map((s: any) => ({
                        street: (['preflop', 'flop', 'turn', 'river', 'mixed'].includes(s.street) ? s.street : 'mixed') as any,
                        position: (['ip', 'oop', 'ep', 'mp', 'co', 'btn', 'sb', 'bb', 'any'].includes(s.position) ? s.position : 'any') as any,
                        action_type: s.action_type,
                        pot_type: (['srp', '3bp', '4bp', 'limped', 'any'].includes(s.pot_type) ? s.pot_type : 'any') as any,
                        board_bucket_hint: s.board_bucket_hint || null,
                        confidence: Math.max(0, Math.min(1, s.confidence || 0.5)),
                        source: 'custom_ai' as const,
                    }));

                return {
                    parsed_signals: validSignals,
                    parse_confidence: validSignals.length > 0 ? validSignals[0].confidence : 0,
                    source: 'custom_ai'
                };
            } catch (error: any) {
                const is429 = error?.status === 429 || error?.message?.includes('429');

                if (is429) {
                    console.warn(`[CustomNoteParser] Rate limited on note "${noteText.substring(0, 30)}...". Returning MOCK response.`);
                    return this.getMockResponse(noteText);
                }

                if (attempt < maxRetries) {
                    const backoffMs = Math.min(2000 * Math.pow(2, attempt), 8000);
                    console.warn(`[CustomNoteParser] Temporary error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue;
                }

                const errMsg = error?.message || 'Unknown error';
                console.warn(`[CustomNoteParser] Failed to parse note after retries: ${errMsg.split('\n')[0]}. Returning MOCK response.`);
                return this.getMockResponse(noteText);
            }
        }

        return this.getMockResponse(noteText);
    }

    private getMockResponse(noteText: string): AIParseResult {
        console.log(`\n--- [CustomNoteParser] USING MOCK RESPONSE FOR: "${noteText.substring(0, 30)}..." ---`);
        const mockSignals: ParsedSignal[] = [
            {
                street: 'mixed',
                position: 'any',
                action_type: 'mocked action (rate limited)',
                pot_type: 'any',
                board_bucket_hint: null,
                confidence: 0.1,
                source: 'custom_ai'
            }
        ];
        console.log(JSON.stringify(mockSignals, null, 2));
        console.log(`------------------------------------------------------------------------\n`);
        return {
            parsed_signals: mockSignals,
            parse_confidence: 0.1,
            source: 'custom_ai'
        };
    }

    private buildPrompt(noteText: string): string {
        return `System: You are a low-level signal extraction engine. Convert the following raw poker note into parsed_signal objects. Output ONLY valid JSON matching this exact schema. Do not add any commentary, do not aggregate, do not attempt to guess the player's archetype or exploit strategy.

Note: "${noteText}"

Output Schema:
{
  "parsed_signals": [
    {
      "street": "preflop" | "flop" | "turn" | "river" | "mixed",
      "position": "ip" | "oop" | "ep" | "mp" | "co" | "btn" | "sb" | "bb" | "any",
      "action_type": "string describing the action concisely (e.g. 'overbet', 'check-raise')",
      "pot_type": "srp" | "3bp" | "4bp" | "limped" | "any",
      "board_bucket_hint": "string or null (e.g., 'wet', 'dry', 'paired', 'monotone')",
      "confidence": 0.0 to 1.0 (how clear this specific signal was in the text)
    }
  ]
}

Rules:
- MUST extract ALL distinct behavioral signals as separate array items.
- CANNOT invent archetypes.
- MUST use exact literal strings for street, position, and pot_type enums. If unclear, use "mixed" / "any".`;
    }
}
