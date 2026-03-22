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

    async parseHand(params: {
        userId: string;
        rawInput: string;
        inputType: 'text' | 'image';
        tier: PremiumTier;
    }): Promise<{ hand: any; fromCache: boolean }> {
        const hashInput = `${params.userId}:${params.rawInput}`;
        const hash = params.inputType === 'text' 
            ? generateHandHash(hashInput)
            : crypto.createHash('sha256').update(hashInput).digest('hex');

        // OCR Cache Disabled per user request (Self-learning engine requirement)
        /* 
        const cached = await this.handRepository.findByHash(hash);
        if (cached) {
            return { hand: cached, fromCache: true };
        }
        */

        let parsedData: ParsedHand | null = null;
        if (params.inputType === 'image') {
            const ocrResponse = await this.ocrParseImage(params.rawInput, params.tier);
            parsedData = ocrResponse.data;
            
            (parsedData as any).ocr_result = {
                confidence: ocrResponse.confidence?.total ?? 0,
                decision: ocrResponse.decision,
                decision_reason: ocrResponse.decision_reason,
                needs_confirmation: ocrResponse.needs_confirmation,
                breakdown: ocrResponse.confidence?.breakdown,
                performance: ocrResponse.performance
            };
            
            await UsageService.incrementUsage(params.userId, UsageActionType.OCR_HAND, params.tier);
        } else {
            parsedData = this.parseTextHand(params.rawInput);
        }

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

    async analyzeHand(params: {
        userId: string;
        handId: string;
        parsedData?: ParsedHand;
        tier: PremiumTier;
    }): Promise<HandAnalysis> {
        const hand = await this.handRepository.findById(params.userId, params.handId);
        if (!hand) throw new Error('Hand not found');

        const finalParsedData = params.parsedData || (hand.parsed_data as unknown as ParsedHand);
        const analysis = await this.runAnalysis(finalParsedData, params.tier, params.userId);
        await UsageService.incrementUsage(params.userId, UsageActionType.AI_ANALYZE, params.tier);

        await this.handRepository.update(params.userId, params.handId, {
            ai_analysis: analysis as any,
            parsed_data: finalParsedData as any
        });

        let notesCreated: string[] = [];
        try {
            notesCreated = await this.autoExtractNotesFromAnalysis(params.userId, hand, finalParsedData, analysis);
        } catch (noteErr) {
            console.error('[HandService] Failed to auto-extract notes:', noteErr);
        }

        return { ...analysis, notesCreated };
    }

    private async autoExtractNotesFromAnalysis(userId: string, hand: any, parsedHand: ParsedHand, analysis: HandAnalysis): Promise<string[]> {
        const villainMistakes = (analysis as any).villainMistakes || [];
        if (villainMistakes.length === 0 && !analysis.exploit_suggestions?.length) return [];

        const createdNoteIds: string[] = [];
        
        console.log(`[HandService] Auto-extracting notes for hand ${hand.id}...`);

        for (const mistake of villainMistakes) {
            if (!mistake.playerName || !mistake.description) continue;

            const playerName = mistake.playerName;
            
            let player = await prisma.player.findFirst({
                where: {
                    user_id: userId,
                    name: { equals: playerName, mode: 'insensitive' }
                }
            });

            if (!player) {
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
            }

            const existingNote = await prisma.note.findFirst({
                where: {
                    hand_id: hand.id,
                    player_id: player.id,
                    content: { contains: mistake.description.substring(0, 50) }
                }
            });

            if (existingNote) continue;

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
        }

        if (analysis.exploit_suggestions?.length) {
            const playersInHand = parsedHand.players || [];
            for (const p of playersInHand) {
                const mentions = analysis.exploit_suggestions.filter(s => s.toLowerCase().includes(p.name.toLowerCase()));
                if (mentions.length > 0) {
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

                    for (const suggestion of mentions) {
                        const note = await prisma.note.create({
                            data: {
                                user_id: userId,
                                player_id: playerRecord.id,
                                hand_id: hand.id,
                                street: 'GENERAL',
                                content: `[AI Exploit] ${suggestion}`,
                                is_ai_generated: true,
                                source: 'ai',
                                category: 'EXPLOIT'
                            }
                        });
                        createdNoteIds.push(note.id);
                    }
                }
            }
        }

        return createdNoteIds;
    }

    private async ocrParseImage(imageUrl: string, tier: PremiumTier): Promise<any> {
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';
        
        try {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';

            if (imageUrl.startsWith('data:')) {
                const [header, base64Data] = imageUrl.split(',');
                mimeType = header.split(':')[1].split(';')[0] || 'image/png';
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                const imgRes = await fetch(imageUrl);
                const arrayBuf = await imgRes.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuf);
                mimeType = imgRes.headers.get('content-type') || 'image/png';
            }

            const formData = new FormData();
            const ext = mimeType.split('/')[1] || 'png';
            const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
            formData.append('file', blob, `hand.${ext}`);

            const response = await fetch(`${ocrServiceUrl}/ocr`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OCR Service Error: ${response.status} ${response.statusText} — ${errText}`);
            }

            let { job_id, status } = await response.json();

            // OCR Cache Ignored per user request (Self-learning engine requirement)
            /* 
            if (cached && result) return result;
            */

            const maxRetries = 15;
            let currentRetry = 0;
            while (currentRetry < maxRetries) {
                const pollRes = await fetch(`${ocrServiceUrl}/result/${job_id}`);
                const pollData = await pollRes.json();

                if (pollData.status === 'success') return pollData.result;
                if (pollData.status === 'error') throw new Error(`OCR Processing Failed: ${pollData.detail}`);

                await new Promise(resolve => setTimeout(resolve, 1000));
                currentRetry++;
            }
            throw new Error('OCR Service Timeout');
        } catch (error: any) {
            console.error('[HandService] OCR Integration Error:', error);
            if (process.env.NODE_ENV === 'production') throw error;
            return this.runVisionAiFallback(imageUrl, tier);
        }
    }

    private async runVisionAiFallback(imageUrl: string, tier: PremiumTier): Promise<ParsedHand> {
        return this.getMockParsedHand();
    }

    private parseTextHand(rawText: string): ParsedHand {
        return this.getMockParsedHand();
    }

    private async runAnalysis(parsedData: ParsedHand | null, tier: PremiumTier, userId?: string): Promise<HandAnalysis> {
        const groqKey = process.env.GROQ_API_KEY;
        let customAnalysisPrompt = undefined;
        let aiConfig = null;
        let playerContext = undefined;
        
        if (userId) {
            aiConfig = await prisma.userAIConfig.findUnique({
                where: { user_id: userId }
            });
            customAnalysisPrompt = aiConfig?.analysis_prompt || undefined;

            const playerNames = (parsedData as any)?.players?.map((p: any) => p.name) || [];
            if (playerNames.length > 0) {
                const profiles = await prisma.player.findMany({
                    where: { user_id: userId, name: { in: playerNames } }
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

        let ruleEngineResult = null;
        try {
            const { RuleEngine } = require('./analysis/ruleEngine/RuleEngine');
            ruleEngineResult = await RuleEngine.analyze(parsedData);
        } catch (ruleErr) {}

        if (userId && aiConfig && aiConfig.is_enabled === false) {
            if (ruleEngineResult) return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
            throw new Error('AI Analysis is disabled');
        }

        if (groqKey) {
            try {
                let enhancedPrompt = prompt;
                if (ruleEngineResult) {
                    enhancedPrompt += `\n\n### MANDATORY INSTRUCTIONS FROM RULE ENGINE:\n${JSON.stringify(ruleEngineResult)}`;
                }

                const OpenAI = require('openai');
                const modelName = aiConfig?.model_name || 'llama-3.3-70b-versatile';
                const isChatGPT = modelName.startsWith('gpt-');
                
                const client = new OpenAI({
                    apiKey: isChatGPT ? process.env.OPENAI_API_KEY : groqKey,
                    baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
                });

                const completion = await client.chat.completions.create({
                    messages: [
                        { role: 'system', content: enhancedPrompt },
                        { role: 'user', content: `Hand Data:\n${payload}` }
                    ],
                    model: modelName,
                    temperature: aiConfig?.temperature ?? 0.7,
                    response_format: { type: 'json_object' }
                });

                return JSON.parse(completion.choices[0].message.content || '{}');
            } catch (err: any) {
                if (ruleEngineResult) return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
            }
        }

        if (ruleEngineResult) return this.mapRuleEngineToHandAnalysis(ruleEngineResult);
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
                preflop: [ { player: 'BigManTing', action: 'fold' }, { player: 'Vipbka1', action: 'raise', amount: 111 } ],
                flop: [ { player: 'chipboiz', action: 'bet', amount: 37.30 } ],
                turn: [ { player: 'Vipbka1', action: 'bet', amount: 233 } ],
                river: [ { player: 'kiukiukiu902', action: 'bet', amount: 1128 } ]
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
            reasoning_trace: ["Rule Engine results applied."],
            mistakes,
            exploit_suggestions: result.exploitSuggestion ? [result.exploitSuggestion] : [],
            final_verdict: { grade: 'A', confidence_score: 1.0, suggestion_type: 'GTO' }
        };
    }

    private getMockAnalysis(): HandAnalysis {
        return {
            summary: "Mock analysis.",
            reasoning_trace: [],
            mistakes: [],
            exploit_suggestions: [],
            final_verdict: { grade: 'B', confidence_score: 0.5, suggestion_type: 'GTO' }
        };
    }

    async getHistory(userId: string, options?: any) {
        return this.handRepository.findByUserId(userId, options);
    }

    async getHandById(userId: string, id: string) {
        return this.handRepository.findById(userId, id);
    }

    async deleteHand(userId: string, id: string) {
        const result = await this.handRepository.delete(userId, id);
        return !!result;
    }
}
