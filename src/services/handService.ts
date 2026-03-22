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

export class HandService {
    constructor(
        private readonly handRepository: HandRepository
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
        if (villainMistakes.length === 0 && !analysis.exploit_suggestions?.length) return [];

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
            for (let i = 0; i < 20; i++) {
                const poll = await fetch(`${ocrServiceUrl}/result/${job_id}`);
                const data = await poll.json();
                if (data.status === 'success') return data.result;
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
        
        const modelName = aiConfig?.model_name || getModelForTier(tier);
        const isChatGPT = modelName.startsWith('gpt-');
        
        const client = new OpenAI({
            apiKey: isChatGPT ? process.env.OPENAI_API_KEY : groqKey || '',
            baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
        });

        const prompt = buildHandAnalysisPrompt(aiConfig?.system_prompt || undefined, aiConfig as any);
        const response = await client.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: JSON.stringify(parsedData) }
            ],
            model: modelName,
            temperature: aiConfig?.temperature ?? 0.7,
            response_format: { type: 'json_object' }
        });

        return JSON.parse(response.choices[0]?.message?.content || '{}');
    }
}
