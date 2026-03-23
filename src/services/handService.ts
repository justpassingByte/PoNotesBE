import { HandRepository } from '../repositories/HandRepository';
import { UsageService } from './usageService';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import { generateHandHash } from '../utils/handHasher';
import { ParsedHand, HandAnalysis } from '../validators/hand.schema';
import { getModelForTier, buildHandAnalysisPrompt } from './promptManager';
import { PremiumTier, UsageActionType } from '@prisma/client';
import { LoggerService, LogType } from './loggerService';
import OpenAI from 'openai';
import { PatternEngine } from './analysis/PatternEngine';
export class HandService {
    constructor(
        private readonly handRepository: HandRepository
    ) { }

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

        // Check for existing hand to log repeat processing
        const existingHand = await prisma.hand.findUnique({ where: { hand_hash: hash } });

        if (existingHand) {
            await LoggerService.log(
                params.userId,
                LogType.SYSTEM,
                `Hand re-upload detected (hash match). Clearing previous analysis for re-learning.`,
                { hash: hash.slice(0, 16) },
                existingHand.id
            );
        } else {
            await LoggerService.log(
                params.userId,
                LogType.SYSTEM,
                `New hand uploaded. Initializing OCR neural pipeline.`,
                { hash: hash.slice(0, 16) }
            );
        }

        let parsedData: ParsedHand | null = null;
        if (params.inputType === 'image') {
            const ocrResponse = await this.ocrParseImage(params.rawInput, params.tier);
            const rawData = ocrResponse.data || ocrResponse;
            const playersMap = new Map<string, any>();
            
            // Build players from streets
            Object.values(rawData.streets || {}).forEach((actions: any[]) => {
                actions.forEach(act => {
                    const cleanName = typeof act.player === 'string' ? act.player.trim() : act.player;
                    if (!cleanName) return;
                    if (!playersMap.has(cleanName)) {
                        playersMap.set(cleanName, {
                            name: cleanName,
                            position: act.pos || undefined,
                            stack: undefined, // OCR doesn't reliably give stacks yet
                            hole_cards: []
                        });
                    } else if (act.pos) {
                        playersMap.get(cleanName).position = act.pos;
                    }
                });
            });

            // Parse pot to number
            const potStr = rawData.pot ? String(rawData.pot).replace(/[^\d.]/g, '') : '0';

            const parseAmount = (amt: any): number | undefined => {
                if (!amt) return undefined;
                if (typeof amt === 'number') return amt;
                const match = String(amt).replace(',', '.').match(/([+\-]?\d[\d\.]*)/);
                return match ? parseFloat(match[1]) : undefined;
            };

            const mapActions = (streetActions: any[]) => {
                if (!streetActions) return [];
                return streetActions.map(act => {
                    let standardAction = act.action?.toLowerCase() || '';
                    if (standardAction.includes('tố') || standardAction === 'raise') standardAction = 'raise';
                    else if (standardAction.includes('cược') || standardAction === 'bet') standardAction = 'bet';
                    else if (standardAction.includes('theo') || standardAction === 'call') standardAction = 'call';
                    else if (standardAction.includes('bỏ bài') || standardAction.includes('fold')) standardAction = 'fold';
                    else if (standardAction.includes('check') || standardAction.includes('xem')) standardAction = 'check';
                    else if (standardAction.includes('all') || standardAction.includes('in')) standardAction = 'all-in';
                    else if (standardAction.includes('post') || standardAction.includes('sb') || standardAction.includes('bb')) standardAction = 'post';

                    return {
                        player: act.player,
                        action: standardAction,
                        amount: parseAmount(act.amount),
                        position: act.pos || undefined,
                    };
                });
            };

            parsedData = {
                board: rawData.board || [],
                players: Array.from(playersMap.values()),
                actions: {
                    preflop: mapActions(rawData.streets?.preflop),
                    flop: mapActions(rawData.streets?.flop),
                    turn: mapActions(rawData.streets?.turn),
                    river: mapActions(rawData.streets?.river)
                },
                pot: parseFloat(potStr) || 0,
            } as any;

            (parsedData as any).ocr_result = {
                confidence: ocrResponse.confidence?.total ?? 0,
                decision: ocrResponse.decision || 'auto_accept',
                decision_reason: ocrResponse.decision_reason || [],
                needs_confirmation: ocrResponse.needs_confirmation || false,
                breakdown: ocrResponse.confidence?.breakdown || {},
                performance: ocrResponse.performance || {}
            };

            await UsageService.incrementUsage(params.userId, UsageActionType.OCR_HAND, params.tier);
        } else {
            parsedData = this.parseTextHand(params.rawInput);
        }

        // UPSERT HAND (Avoid Duplicates & Support Re-learning)
        const hand = await prisma.hand.upsert({
            where: { hand_hash: hash },
            update: {
                parsed_data: parsedData as any,
                ai_analysis: null as any,
                created_at: new Date()
            },
            create: {
                user_id: params.userId,
                hand_hash: hash,
                raw_input: params.rawInput,
                input_type: params.inputType,
                parsed_data: parsedData as any,
                ai_analysis: null as any,
                tags: []
            }
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

        await LoggerService.log(
            params.userId,
            LogType.AI_LEARNING,
            `Starting AI Leak Scan with ${hand.input_type === 'image' ? 'Neural OCR' : 'Text'} inputs.`,
            { handId: hand.id },
            hand.id
        );

        // Clean up previous AI notes for this hand so re-learning is pure
        const deletedNotes = await prisma.note.deleteMany({
            where: { hand_id: params.handId, is_ai_generated: true, user_id: params.userId }
        });
        if (deletedNotes.count > 0) {
            await LoggerService.log(
                params.userId,
                LogType.SYSTEM,
                `Wiped ${deletedNotes.count} previous AI notes for this hand. Ready for a clean re-eval.`,
                { count: deletedNotes.count },
                hand.id
            );
        }

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

    async getHistory(userId: string, options: any) {
        return this.handRepository.findByUserId(userId, options);
    }

    async getHandById(userId: string, id: string) {
        return this.handRepository.findById(userId, id);
    }

    async deleteHand(userId: string, id: string) {
        return this.handRepository.delete(userId, id);
    }

    private async autoExtractNotesFromAnalysis(userId: string, hand: any, parsedHand: ParsedHand, analysis: HandAnalysis): Promise<string[]> {
        const villainMistakes = (analysis as any).villainMistakes || analysis.mistakes?.filter(m => m.player.toLowerCase() !== 'hero') || [];
        if (villainMistakes.length === 0 && !analysis.exploit_suggestions?.length) {
            await LoggerService.log(userId, LogType.SYSTEM, `No actionable villain leaks found in this hand.`, { handId: hand.id }, hand.id);
            return [];
        }

        await LoggerService.log(
            userId, 
            LogType.AI_LEARNING, 
            `Extracting ${villainMistakes.length} actionable leaks from AI neural output...`, 
            { raw_mistakes: villainMistakes.map(m => m.description) }, 
            hand.id
        );

        const createdNoteIds: string[] = [];
        for (const mistake of villainMistakes) {
            const playerName = mistake.playerName || mistake.player;
            if (!playerName || !mistake.description) continue;

            let player = await prisma.player.findFirst({
                where: { user_id: userId, name: { equals: playerName, mode: 'insensitive' } }
            });

            if (!player) {
                const platform = await prisma.platform.upsert({ where: { name: 'General' }, update: {}, create: { name: 'General' } });
                player = await prisma.player.create({
                    data: { user_id: userId, name: playerName, platform_id: platform.id, playstyle: 'UNKNOWN' }
                });
            }

            const note = await prisma.note.create({
                data: {
                    user_id: userId,
                    player_id: player.id,
                    hand_id: hand.id,
                    street: (mistake.street?.toLowerCase() || 'general') as any,
                    content: `[AI Analysis] ${mistake.description}`,
                    is_ai_generated: true,
                    source: 'ai',
                    category: 'GENERAL',
                }
            });
            createdNoteIds.push(note.id);

            await LoggerService.log(
                userId,
                LogType.PROFILE_EVOLUTION,
                `Auto-extracted note for [${playerName}] on street [${mistake.street || 'general'}]. Pushing to Memory Engine...`,
                { noteId: note.id, content: mistake.description },
                hand.id
            );

            // CRITICAL: Feed AI-generated notes into the PatternEngine memory loop!
            try {
                await PatternEngine.processNote(note);
            } catch (err) {
                console.error('[HandService] PatternEngine error during auto extraction:', err);
            }
        }

        await LoggerService.log(
            userId,
            LogType.SYSTEM,
            `Successfully bridged ${createdNoteIds.length} new insights into the Long-term Memory core.`,
            { createdNotesCount: createdNoteIds.length },
            hand.id
        );

        return createdNoteIds;
    }

    private async ocrParseImage(imageUrl: string, tier: PremiumTier): Promise<any> {
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';
        try {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';

            if (imageUrl.startsWith('data:')) {
                const [header, base64Data] = imageUrl.split(',');
                mimeType = header.split(':')[1].split(';')[0];
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                const imgRes = await fetch(imageUrl);
                imageBuffer = Buffer.from(await imgRes.arrayBuffer());
                mimeType = imgRes.headers.get('content-type') || 'image/png';
            }

            const formData = new FormData();
            const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
            formData.append('file', blob, `hand.${mimeType.split('/')[1] || 'png'}`);

            const response = await fetch(`${ocrServiceUrl}/ocr`, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`OCR Service Error: ${response.status}`);

            const { job_id } = await response.json();
            console.log(`[OCR_ENGINE] Sent visual payload. Job ID: ${job_id}. Waiting for core...`);
            
            for (let i = 0; i < 20; i++) {
                const poll = await fetch(`${ocrServiceUrl}/result/${job_id}`);
                const data = await poll.json();
                if (data.status === 'success') {
                    console.log(`[OCR_ENGINE] Scan Complete (Job: ${job_id}). Confidence: ${data.result.confidence?.total || 0}%. Payload extracted!`);
                    return data.result;
                }
                if (data.status === 'error') throw new Error(data.detail);
                await new Promise(r => setTimeout(r, 1000));
            }
            throw new Error('OCR Timeout');
        } catch (error) {
            console.error('[HandService] OCR Error:', error);
            return { data: { players: [], actions: { preflop: [], flop: [], turn: [], river: [] }, board: [], pot: 0 }, confidence: { total: 0 } };
        }
    }

    private parseTextHand(rawText: string): ParsedHand {
        return {
            players: [],
            board: [],
            pot: 0,
            actions: { preflop: [], flop: [], turn: [], river: [] }
        };
    }

    private async runAnalysis(parsedData: ParsedHand | null, tier: PremiumTier, userId?: string): Promise<HandAnalysis> {
        const groqKey = process.env.GROQ_API_KEY;
        const aiConfig = userId ? await prisma.userAIConfig.findUnique({ where: { user_id: userId } }) : null;

        const modelInfo = (aiConfig?.model_name && typeof aiConfig.model_name === 'string')
            ? { model: aiConfig.model_name, provider: aiConfig.model_name.startsWith('gpt-') ? 'openai' : 'openai' as any } // Default to openai for custom models for now
            : getModelForTier(tier);

        const modelName = modelInfo.model;
        const isChatGPT = modelName.startsWith('gpt-') || modelName.startsWith('o1-') || modelName.startsWith('o3-');

        const client = new OpenAI({
            apiKey: isChatGPT ? process.env.OPENAI_API_KEY : (process.env.GROQ_API_KEY || ''),
            baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
        });

        const prompt = buildHandAnalysisPrompt(aiConfig?.analysis_prompt || undefined, aiConfig as any);
        const response = await client.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: JSON.stringify(parsedData) }
            ],
            model: modelName,
            temperature: aiConfig?.temperature ?? 0.7,
            response_format: { type: 'json_object' }
        });

        const rawJson = response.choices[0]?.message?.content || '{}';
        
        // Verbose Logging for Debugging/Learning Loop
        console.log(`\n[AI_LEARNING_DUMP] Raw Model Output:\n${rawJson}\n`);

        return JSON.parse(rawJson);
    }
}
