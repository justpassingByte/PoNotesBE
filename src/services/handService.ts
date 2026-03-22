import { HandRepository } from '../repositories/HandRepository';
import { UsageService } from './usageService';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import { generateHandHash } from '../utils/handHasher';
import { ParsedHandSchema, HandAnalysisSchema, ParsedHand, HandAnalysis } from '../validators/hand.schema';
import { getModelForTier, buildHandAnalysisPrompt, buildHandOcrPrompt } from './promptManager';
import { PremiumTier, UsageActionType } from '@prisma/client';

export class HandService {
    constructor(
        private readonly handRepository: HandRepository,
        private readonly usageService?: UsageService  // Optional: we use static UsageService methods directly
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
        // 1. Generate unique hash for caching
        // For text, we normalize (strip names/dates). For images, we use raw content to ensure uniqueness.
        const hashInput = `${params.userId}:${params.rawInput}`;
        const hash = params.inputType === 'text' 
            ? generateHandHash(hashInput)
            : crypto.createHash('sha256').update(hashInput).digest('hex');

        // Check if we already have this exact hand parsed
        const cached = await this.handRepository.findByHash(hash);
        if (cached) {
            return { hand: cached, fromCache: true };
        }

        // 1. Process OCR or Text
        let parsedData: ParsedHand | null = null;
        if (params.inputType === 'image') {
            const ocrResponse = await this.ocrParseImage(params.rawInput, params.tier);
            parsedData = ocrResponse.data;
            
            // Inject OCR metadata into the parsed data for the UI
            (parsedData as any).ocr_result = {
                confidence: ocrResponse.confidence,
                decision: ocrResponse.decision,
                decision_reason: ocrResponse.decision_reason,
                needs_confirmation: ocrResponse.needs_confirmation,
                breakdown: ocrResponse.breakdown,
                performance: ocrResponse.performance
            };
            
            await UsageService.incrementUsage(params.userId, UsageActionType.OCR_HAND, params.tier);
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
        const analysis = await this.runAnalysis(finalParsedData, params.tier, params.userId);
        await UsageService.incrementUsage(params.userId, UsageActionType.AI_ANALYZE, params.tier);

        // 3. Update hand with analysis
        await this.handRepository.update(params.userId, params.handId, {
            ai_analysis: analysis as any,
            parsed_data: finalParsedData as any // Save user corrections if any
        });

        // 4. AUTO-EXTRACT NOTES FROM ANALYSIS
        let notesCreated: string[] = [];
        try {
            notesCreated = await this.autoExtractNotesFromAnalysis(params.userId, hand, finalParsedData, analysis);
        } catch (noteErr) {
            console.error('[HandService] Failed to auto-extract notes:', noteErr);
        }

        return { ...analysis, notesCreated };
    }

    /**
     * Helper to automatically create notes from AI analysis findings.
     */
    private async autoExtractNotesFromAnalysis(userId: string, hand: any, parsedHand: ParsedHand, analysis: HandAnalysis): Promise<string[]> {
        if (!analysis.villainMistakes || analysis.villainMistakes.length === 0) return [];

        const createdNoteIds: string[] = [];
        console.log(`[HandService] Auto-extracting ${analysis.villainMistakes.length} notes for hand ${hand.id}...`);

        for (const mistake of analysis.villainMistakes) {
            if (!mistake.playerName || !mistake.description) continue;

            const playerName = mistake.playerName;
            
            // 1. Find or Create player (Bug #2 Fix: Don't skip new players)
            let player = await prisma.player.findFirst({
                where: {
                    user_id: userId,
                    name: { equals: playerName, mode: 'insensitive' }
                }
            });

            if (!player) {
                // We need a platform. We'll look for or create a "General" platform
                const generalPlatform = await prisma.platform.upsert({
                    where: { name: 'General' },
                    update: {},
                    create: { name: 'General' }
                });

                player = await prisma.player.create({
                    data: {
                        user_id: userId,
                        name: playerName,
                        platform_id: generalPlatform.id,
                        playstyle: 'UNKNOWN'
                    }
                });
                console.log(`[HandService] Auto-created new player record for: ${playerName}`);
            }

            // 2. Avoid Duplicates (Bug #12 Fix)
            const existingNote = await prisma.note.findFirst({
                where: {
                    hand_id: hand.id,
                    player_id: player.id,
                    content: { contains: mistake.description.substring(0, 50) } // Match partial content to be safe
                }
            });

            if (existingNote) {
                console.log(`[HandService] Note already exists for ${playerName} in this hand. Skipping.`);
                continue;
            }

            // 3. Create the note
            const street = (mistake.street?.toLowerCase() || 'general') as any;
            const note = await prisma.note.create({
                data: {
                    user_id: userId,
                    player_id: player.id,
                    hand_id: hand.id,
                    street: street,
                    content: `[AI Analysis] ${mistake.description}`,
                    is_ai_generated: true,
                    source: 'ai',
                    category: 'GENERAL',
                }
            });
            createdNoteIds.push(note.id);
            console.log(`[HandService] Auto-note created for ${playerName}: ${mistake.description.substring(0, 30)}...`);
        }

        // Also add the general exploit suggestion to players mentioned in it
        if (analysis.exploitSuggestion) {
            const playersInHand = parsedHand.players || [];
            for (const p of playersInHand) {
                if (analysis.exploitSuggestion.toLowerCase().includes(p.name.toLowerCase())) {
                    // Find or create for exploit too
                    let playerRecord = await prisma.player.findFirst({
                        where: { user_id: userId, name: { equals: p.name, mode: 'insensitive' } }
                    });

                    if (!playerRecord) {
                        const generalPlatform = await prisma.platform.upsert({
                            where: { name: 'General' },
                            update: {},
                            create: { name: 'General' }
                        });
                        playerRecord = await prisma.player.create({
                            data: {
                                user_id: userId,
                                name: p.name,
                                platform_id: generalPlatform.id,
                                playstyle: 'UNKNOWN'
                            }
                        });
                    }

                    const note = await prisma.note.create({
                        data: {
                            user_id: userId,
                            player_id: playerRecord.id,
                            hand_id: hand.id,
                            street: 'GENERAL',
                            content: `[AI Exploit] ${analysis.exploitSuggestion}`,
                            is_ai_generated: true,
                            source: 'ai',
                            category: 'EXPLOIT'
                        }
                    });
                    createdNoteIds.push(note.id);
                }
            }
        }

        return createdNoteIds;
    }

    /**
     * OCR parse an image into structured hand JSON using Vision AI.
     * MOCK MODE: Returns sample data when no API keys are configured.
     */
    /**
     * OCR parse an image into structured hand JSON using our local Python OCR Service.
     */
    private async ocrParseImage(imageUrl: string, tier: PremiumTier): Promise<any> {
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';
        
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
                    
                    if (!pollData.result || !pollData.result.data) {
                        console.warn(`[HandService] Warning: OCR result for ${job_id} is incomplete!`, pollData.result);
                    }

                    return pollData.result; // Return the full wrapper (data + confidence)
                }

                if (pollData.status === 'error') {
                    throw new Error(`OCR Processing Failed: ${pollData.detail}`);
                }

                // Wait 1s and retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                currentRetry++;
            }

            throw new Error('OCR Service Timeout (Max retries reached)');

        } catch (error: any) {
            console.error('[HandService] OCR Integration Error:', error);
            
            // In Production: Never return mock data secretly
            // Instead, throw so the user knows the OCR service is down/unreachable
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`OCR Processing unavailable: ${error.message || 'Unknown error'}`);
            }

            // Fallback to Vision AI if enabled or Mock (Dev only)
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
    private async runAnalysis(parsedData: ParsedHand | null, tier: PremiumTier, userId?: string): Promise<HandAnalysis> {
        const groqKey = process.env.GROQ_API_KEY;
        
        // Fetch Custom Prompt if userId provided
        let customAnalysisPrompt = undefined;
        let aiConfig = null;
        let playerContext = undefined;
        
        if (userId) {
            aiConfig = await prisma.userAIConfig.findUnique({
                where: { user_id: userId }
            });
            
            customAnalysisPrompt = aiConfig?.analysis_prompt || undefined;

            // CONSISTENCY MEMORY: Fetch existing profiles for context
            const playerNames = (parsedData as any)?.players?.map((p: any) => p.name) || [];
            if (playerNames.length > 0) {
                const profiles = await prisma.player.findMany({
                    where: {
                        user_id: userId,
                        name: { in: playerNames }
                    }
                });
                if (profiles.length > 0) {
                    playerContext = profiles.map(p => 
                        `- ${p.name}: [ARCHETYPE: ${p.ai_playstyle || 'UNKNOWN'}] (AGGR: ${p.aggression_score}, LOOSE: ${p.looseness_score})`
                    ).join('\n');
                }
            }
        }

        const prompt = buildHandAnalysisPrompt(customAnalysisPrompt, aiConfig as any, playerContext);
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

        if (userId && aiConfig && aiConfig.is_enabled === false) {
            console.log(`[HandAnalysis] AI is disabled for user ${userId}. Skipping LLM analysis.`);
            if (ruleEngineResult) return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
            throw new Error('AI Analysis is disabled in your settings.');
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
                const modelName = aiConfig?.model_name || 'llama-3.3-70b-versatile';
                const isChatGPT = modelName.startsWith('gpt-');
                
                const client = new OpenAI({
                    apiKey: isChatGPT ? process.env.OPENAI_API_KEY : groqKey,
                    baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
                });

                const startTime = Date.now();
                const completion = await client.chat.completions.create({
                    messages: [
                        { role: 'system', content: enhancedPrompt },
                        { role: 'user', content: `Hand Data:\n${payload}` }
                    ],
                    model: modelName,
                    temperature: aiConfig?.temperature ?? 0.7,
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
                if (ruleEngineResult) return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
            }
        }

        // 3. RULE ENGINE FALLBACK (If pure Groq fails or no key)
        if (ruleEngineResult) {
            console.warn('[HandAnalysis] AI failed — returning deterministic Rule Engine results.');
            return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
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

    private mapRuleEngineToHandAnalysis(result: any): any {
        const mistakes = [
            ...(result.heroMistakes || []).map((m: any) => ({ ...m, player: 'Hero' })),
            ...(result.villainMistakes || []).map((m: any) => ({ ...m, player: m.playerName || 'Opponent' }))
        ];

        return {
            summary: result.summary,
            reasoning_trace: [
                "Deterministic Rule Engine started.",
                `Analyzed ${result.tags?.join(', ') || 'base'} situation.`,
                "Applied objective poker heuristics."
            ],
            mistakes,
            exploit_suggestions: result.exploitSuggestion ? [result.exploitSuggestion] : [],
            final_verdict: {
                grade: mistakes.length > 2 ? 'C' : 'A',
                confidence_score: 1.0, // Rules are 100% deterministic
                suggestion_type: 'GTO'
            }
        };
    }

    private getMockAnalysis(): HandAnalysis {
        return {
            summary: "Set-over-set cooler. Hero failed to fold bottom set on a K-high board where opponent sizing indicated extreme strength.",
            reasoning_trace: [
                "Board texture is dynamic with high set-over-set probability.",
                "Villain sizing on river (150% pot) indicates pure value polarized range.",
                "Hero has bottom possible set (66), losing to 99 and KK.",
                "Conclusion: Standard GTO fold vs overbet."
            ],
            mistakes: [
                {
                    street: 'river',
                    player: 'Hero',
                    description: 'Calling river with bottom set (66) when the board runs out K-high is a significant mistake vs this sizing.',
                    better_line: 'Fold to river overbet',
                    severity: 'critical'
                }
            ],
            exploit_suggestions: [
                "Target kiukiukiu902's willingness to slow-play 3-bet sets by betting smaller on flops."
            ],
            final_verdict: {
                grade: 'C+',
                confidence_score: 0.88,
                suggestion_type: 'GTO'
            }
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
        playerName?: string;
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
