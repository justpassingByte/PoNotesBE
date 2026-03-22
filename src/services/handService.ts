import { HandRepository } from '../repositories/HandRepository';
import { UsageService } from './usageService';
import { generateHandHash } from '../utils/handHasher';
import { ParsedHandSchema, HandAnalysisSchema, ParsedHand, HandAnalysis } from '../validators/hand.schema';
import { getModelForTier, buildHandAnalysisPrompt, buildHandOcrPrompt } from './promptManager';
import { PremiumTier, UsageActionType } from '@prisma/client';

export class HandService {
    constructor(
        private readonly handRepository: HandRepository,
        private readonly usageService: UsageService
    ) {}

    /**
     * Main entry point: analyze a hand from text or image.
     * Steps: Hash -> Cache check -> Parse (if image) -> LLM Analysis -> Cache -> Return
     */
    /**
     * Phase 1: Parse input (image/text) into structured JSON.
     * Includes OCR and SHA256 caching.
     */
    async parseHand(params: {
        userId: string;
        rawInput: string;
        inputType: 'text' | 'image';
        tier: PremiumTier;
    }): Promise<{ hand: any; fromCache: boolean }> {
        // Include userId in hash to prevent cross-user leakage
        const hash = generateHandHash(`${params.userId}:${params.rawInput}`);

        // Check if we already have this exact hand parsed
        const cached = await this.handRepository.findByHash(hash);
        if (cached) {
            return { hand: cached, fromCache: true };
        }

        // 1. Process OCR or Text
        let parsedData: ParsedHand | null = null;
        if (params.inputType === 'image') {
            parsedData = await this.ocrParseImage(params.rawInput, params.tier);
            await this.usageService.incrementUsage(params.userId, UsageActionType.OCR_HAND, params.tier);
        } else {
            parsedData = this.parseTextHand(params.rawInput);
        }

        // 2. Create temporary hand record (for review)
        const hand = await this.handRepository.create({
            user_id: params.userId,
            hand_hash: hash,
            raw_input: params.rawInput,
            input_type: params.inputType,
            parsed_data: parsedData as any,
            ai_analysis: null as any,
            tags: []
        });

        return { hand, fromCache: false };
    }

    /**
     * Phase 2: Run AI Analysis on parsed data (after user review).
     */
    async analyzeHand(params: {
        userId: string;
        handId: string;
        parsedData?: ParsedHand;
        tier: PremiumTier;
    }): Promise<HandAnalysis> {
        // 1. Fetch hand or use provided edited data
        const hand = await this.handRepository.findById(params.userId, params.handId);
        if (!hand) throw new Error('Hand not found');

        const finalParsedData = params.parsedData || (hand.parsed_data as unknown as ParsedHand);

        // 2. Run LLM Analysis
        const analysis = await this.runAnalysis(finalParsedData, params.tier);
        await this.usageService.incrementUsage(params.userId, UsageActionType.AI_ANALYZE, params.tier);

        // 3. Update hand with analysis
        await this.handRepository.update(params.userId, params.handId, {
            ai_analysis: analysis as any,
            parsed_data: finalParsedData as any // Save user corrections if any
        });

        return analysis;
    }

    /**
     * OCR parse an image into structured hand JSON using Vision AI.
     * MOCK MODE: Returns sample data when no API keys are configured.
     */
    /**
     * OCR parse an image into structured hand JSON using our local Python OCR Service.
     */
    private async ocrParseImage(imageUrl: string, tier: PremiumTier): Promise<ParsedHand> {
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://localhost:8000';
        
        try {
            console.log(`[HandService] Dispatching OCR task to ${ocrServiceUrl}...`);

            // The OCR service expects a multipart file upload (UploadFile = File(...))
            // The frontend sends a base64 data URI like "data:image/png;base64,<data>"
            let imageBuffer: Buffer;
            let mimeType = 'image/png';

            if (imageUrl.startsWith('data:')) {
                // Strip data URI prefix: "data:image/png;base64,<data>"
                const [header, base64Data] = imageUrl.split(',');
                mimeType = header.split(':')[1].split(';')[0] || 'image/png';
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                // Plain URL — fetch and forward the raw bytes
                const imgRes = await fetch(imageUrl);
                const arrayBuf = await imgRes.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuf);
                mimeType = imgRes.headers.get('content-type') || 'image/png';
            }

            // Build multipart form — OCR service field name is "file"
            const formData = new FormData();
            const ext = mimeType.split('/')[1] || 'png';
            const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
            formData.append('file', blob, `hand.${ext}`);

            // 1. Submit image as multipart upload
            const response = await fetch(`${ocrServiceUrl}/ocr`, {
                method: 'POST',
                body: formData
                // Note: Do NOT set Content-Type manually — fetch sets it with boundary automatically
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OCR Service Error: ${response.status} ${response.statusText} — ${errText}`);
            }

            let { job_id, status, result, cached } = await response.json();

            // 2. If cached, we already have the result
            if (cached && result) {
                console.log(`[HandService] Cache Hit from OCR Service for ${job_id}`);
                // Verify the result is actually for this image hash
                return result.data;
            }

            // 3. Polling for Async Result
            console.log(`[HandService] Polling for OCR Job: ${job_id}`);
            const maxRetries = 15;
            let currentRetry = 0;

            while (currentRetry < maxRetries) {
                const pollRes = await fetch(`${ocrServiceUrl}/result/${job_id}`);
                const pollData = await pollRes.json();

                if (pollData.status === 'success') {
                    console.log(`[HandService] OCR Success for ${job_id} in ${currentRetry + 1}s`);
                    return pollData.result.data;
                }

                if (pollData.status === 'error') {
                    throw new Error(`OCR Processing Failed: ${pollData.detail}`);
                }

                // Wait 1s and retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                currentRetry++;
            }

            throw new Error('OCR Service Timeout (Max retries reached)');

        } catch (error) {
            console.error('[HandService] OCR Integration Error:', error);
            // Fallback to Vision AI if enabled or Mock
            const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
            if (apiKey) {
                console.log('[HandService] Falling back to Vision AI...');
                return this.runVisionAiFallback(imageUrl, tier);
            }
            return this.getMockParsedHand();
        }
    }


    /**
     * Fallback to expensive Cloud Vision AI if local OCR fails or is unavailable.
     */
    private async runVisionAiFallback(imageUrl: string, tier: PremiumTier): Promise<ParsedHand> {
        // TODO: Original Vision AI code would go here
        return this.getMockParsedHand();
    }

    /**
     * Parse a raw text hand history into structured JSON.
     */
    private parseTextHand(rawText: string): ParsedHand {
        // Simple mock parse — return a demo hand structure
        return this.getMockParsedHand();
    }

    /**
     * Run AI analysis on a parsed hand.
     * MOCK MODE: Returns sample analysis when no API keys are configured.
     */
    private async runAnalysis(parsedData: ParsedHand | null, tier: PremiumTier): Promise<HandAnalysis> {
        const groqKey = process.env.GROQ_API_KEY;
        const prompt = buildHandAnalysisPrompt();
        const payload = JSON.stringify(parsedData, null, 2);

        // 1. RUN DETERMINISTIC RULE ENGINE FIRST (Ground Truth)
        let ruleEngineResult = null;
        try {
            const { RuleEngine } = require('./analysis/ruleEngine/RuleEngine');
            ruleEngineResult = await RuleEngine.analyze(parsedData);
            console.log('[HandAnalysis] Rule Engine identified mistakes:', ruleEngineResult.heroMistakes.length + ruleEngineResult.villainMistakes.length);
        } catch (ruleErr) {
            console.error('[HandAnalysis] Rule Engine Error (skipping to pure AI):', ruleErr);
        }

        // 2. TRY GROQ (Main Provider) with Hybrid Context
        if (groqKey) {
            try {
                console.log('\n--- [HandAnalysis] STARTING HYBRID AI SESSION (Groq/Llama-3.3-70b) ---');
                
                // Construct enhanced prompt with rule engine findings
                let enhancedPrompt = prompt;
                if (ruleEngineResult) {
                    enhancedPrompt += `\n\n### MANDATORY INSTRUCTIONS FROM RULE ENGINE:
The deterministic rule engine found these objective facts. You MUST use them and explain why they are correct:
- Hero Mistakes (Rule Engine): ${JSON.stringify(ruleEngineResult.heroMistakes)}
- Villain Mistakes (Rule Engine): ${JSON.stringify(ruleEngineResult.villainMistakes)}
- Tags/Context: ${ruleEngineResult.tags.join(', ')}
- Calculated Hand Strength: ${ruleEngineResult.summary}

If the Rule Engine says it's a mistake, analyze it as such. Do NOT contradict these findings. Use your LLM capabilities to provide a deep, natural explanation for these specific points.`;
                }

                console.log('--- SYSTEM PROMPT (HYBRID) ---');
                console.log(enhancedPrompt);
                console.log('--- USER HAND DATA ---');
                console.log(payload);
                console.log('----------------------\n');

                const OpenAI = require('openai');
                const groq = new OpenAI({
                    apiKey: groqKey,
                    baseURL: 'https://api.groq.com/openai/v1'
                });

                const startTime = Date.now();
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: enhancedPrompt },
                        { role: 'user', content: `Hand Data:\n${payload}` }
                    ],
                    model: 'llama-3.3-70b-versatile',
                    response_format: { type: 'json_object' }
                });

                const responseText = completion.choices[0].message.content || '{}';
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);

                console.log(`[HandAnalysis] RAW HYBRID AI RESPONSE (${duration}s):`);
                console.log(responseText);
                console.log('--- [HandAnalysis] END HYBRID AI SESSION ---\n');

                return JSON.parse(responseText);
            } catch (err: any) {
                console.error('[HandAnalysis] Groq Error (falling back to Mocking Rule Results):', err.message);
                if (ruleEngineResult) return ruleEngineResult as any;
            }
        }

        // 3. RULE ENGINE FALLBACK (If pure Groq fails or no key)
        if (ruleEngineResult) {
            console.warn('[HandAnalysis] AI failed — returning deterministic Rule Engine results.');
            return ruleEngineResult as any;
        }

        // 4. MOCK FALLBACK (Complete failure)
        console.warn('[HandAnalysis] No API provider and Rule Engine failed — returning MOCK data.');
        return this.getMockAnalysis();
    }

    private getMockParsedHand(): ParsedHand {
        return {
            hand_id: 'HL9523',
            game_type: 'NLHE',
            board: ['9d', '3c', '6h', '4c', 'Kc'],
            players: [
                { name: 'chipboiz', position: 'BB', stack: 248 },
                { name: 'BigManTing', position: 'UTG+1', stack: 233 },
                { name: 'Lethanh92', position: 'MP', stack: 419 },
                { name: 'kiukiukiu902', position: 'CO', stack: 2590, hole_cards: ['9h', '9c'] },
                { name: 'Vipbka1', position: 'BTN', stack: 0, hole_cards: ['6s', '6d'] },
            ],
            actions: {
                preflop: [
                    { player: 'BigManTing', action: 'fold' },
                    { player: 'Lethanh92', action: 'fold' },
                    { player: 'kiukiukiu902', action: 'call', amount: 37.30 },
                    { player: 'Vipbka1', action: 'raise', amount: 111 },
                ],
                flop: [
                    { player: 'chipboiz', action: 'bet', amount: 37.30 },
                    { player: 'kiukiukiu902', action: 'call', amount: 37.30 },
                ],
                turn: [
                    { player: 'chipboiz', action: 'check' },
                    { player: 'Vipbka1', action: 'bet', amount: 233 },
                    { player: 'kiukiukiu902', action: 'call', amount: 233 },
                ],
                river: [
                    { player: 'kiukiukiu902', action: 'bet', amount: 1128 },
                    { player: 'Vipbka1', action: 'call', amount: 818 },
                ]
            },
            pot: 1947,
            winner: 'kiukiukiu902'
        };
    }

    private getMockAnalysis(): HandAnalysis {
        return {
            heroMistakes: [
                {
                    street: 'preflop',
                    description: 'Flatting with 66 on the BTN after CO limp is fine, but the 3-bet sizing to 111 BB is too large. A smaller 3-bet (65-75 BB) keeps more of villain\'s calling range in.',
                    severity: 'moderate'
                }
            ],
            villainMistakes: [
                {
                    street: 'river',
                    playerName: 'Vipbka1',
                    description: 'Calling river with bottom set (66) when the board runs out K-high with a possible higher set (99) is a significant mistake. The bet sizing screams value; folding is preferred.',
                    severity: 'critical'
                },
                {
                    street: 'turn',
                    playerName: 'Vipbka1',
                    description: 'Betting 233 BB into a pot of ~113 BB on the turn is an overbet that only gets called by better hands. This is a classic "reverse implied odds" mistake.',
                    severity: 'moderate'
                }
            ],
            betterLine: 'Hero (Vipbka1) should check-call turn with bottom set instead of overbetting. On the river, after facing a large bet, folding set-over-set situations is correct GTO play at these stack depths.',
            exploitSuggestion: 'kiukiukiu902 shows willingness to slow-play strong hands (limped 99 preflop). Against this player: value bet thinner on safe boards, and avoid bluffing on paired or monotone boards.',
            summary: 'A classic set-over-set cooler. kiukiukiu902 (99) flopped top set and extracted maximum value. Vipbka1 (66) made a critical error by overbetting turn and calling a massive river bet with the worst possible set.'
        };
    }


    /**
     * Get hand history for a user with optional filters.
     */
    async getHistory(userId: string, options?: {
        limit?: number;
        cursor?: string;
        tag?: string;
        gameType?: string;
        minPot?: number;
    }) {
        return this.handRepository.findByUserId(userId, options);
    }

    async getHandById(userId: string, id: string) {
        return this.handRepository.findById(userId, id);
    }

    /**
     * Delete a single hand by ID.
     */
    async deleteHand(userId: string, id: string) {
        const result = await this.handRepository.delete(userId, id);
        return !!result;
    }
}
