import { prisma } from '../../lib/prisma';
import { buildProfilePrompt } from '../promptManager';
import OpenAI from 'openai';

interface TendencyScore {
    key: string;
    score: number;
    count: number;
}

import { PokerNoteParser } from './PokerNoteParser';
import { LoggerService, LogType } from '../loggerService';
import { PatternEngine } from './PatternEngine';

export class ProfileAggregator {
    /**
     * Main pipeline to generate a player profile
     */
    static async generateProfile(playerId: string) {
        // 1. Fetch all notes
        const notes = await prisma.note.findMany({
            where: { player_id: playerId },
            orderBy: { created_at: 'desc' }
        });

        if (notes.length === 0) return null;

        // 2. Normalize and Weighting
        const tendencies: Record<string, TendencyScore> = {};

        notes.forEach(note => {
            // Using NEW POKER PARSER
            const parsed = PokerNoteParser.parse(note.content);
            
            // Inclusion of Street makes the tendency much more specific
            const key = parsed 
                ? `${note.street.toLowerCase()}_${parsed.category}_${parsed.action}`
                : `${note.street.toLowerCase()}_general_tendency`;
            
            const weight = this.calculateWeight(note) * (parsed?.strength || 1.0);
            
            if (!tendencies[key]) {
                tendencies[key] = { key, score: 0, count: 0 };
            }
            
            tendencies[key].score += weight;
            tendencies[key].count += 1;
        });

        // 3. Prepare structured data for AI
        const structuredData = Object.values(tendencies)
            .sort((a, b) => b.score - a.score)
            .map(t => ({
                tendency_key: t.key,
                strength: Number(t.score.toFixed(2)),
                observations: t.count
            }));

        // Log formatted output for user
        console.log(`\n--- [PlayerProfiling] STARTING AGGREGATION v2 FOR PLAYER ID: ${playerId} ---`);
        console.log(`[PlayerProfiling] Raw Notes Processed: ${notes.length}`);
        console.log(`[PlayerProfiling] Structured Tendencies:`, JSON.stringify(structuredData, null, 2));

        // 3.5 Fetch memory patterns
        const activePatterns = await PatternEngine.getActivePatterns(playerId);
        console.log(`[PlayerProfiling] Active Memory Patterns:`, JSON.stringify(activePatterns, null, 2));

        // 4. Call AI for Profiling
        console.log(`\n--- [PlayerProfiling] AI PROMPT SENT ---`);
        let profile = null;
        let playerRecord = null;
        try {
            // Bug #13 Fix: Respect is_enabled flag for profiling too
            playerRecord = await prisma.player.findUnique({ where: { id: playerId }, select: { user_id: true } });
            if (playerRecord) {
                const aiConfig = await prisma.userAIConfig.findUnique({ where: { user_id: playerRecord.user_id } });
                if (aiConfig && aiConfig.is_enabled === false) {
                    console.log(`[PlayerProfiling] AI is disabled for user ${playerRecord.user_id}. Returning null.`);
                    return null;
                }
            }

            profile = await this.callAI(structuredData, playerId, activePatterns);
        } catch (aiErr) {
            // Bug #18 Fix: Graceful failure
            console.error(`[PlayerProfiling] ERROR calling AI:`, aiErr);
            return null; // Don't crash the whole request
        }

        // ... AI Response Log and Update playstyle ...
        if (profile) {
            console.log(`[PlayerProfiling] AI RESPONSE RECEIVED:`, JSON.stringify(profile, null, 2));
            console.log(`[PlayerProfiling] FINAL AI ARCHETYPE: ${profile.archetype} (Confidence: ${profile.confidence || 'unknown'})`);
        }
        
        // 5. Save to DB (Updated sync logic)
        if (profile && profile.archetype) {
            await LoggerService.log(
                playerRecord?.user_id || 'system',
                LogType.PROFILE_EVOLUTION,
                `Evolution: Player archetype refined to ${profile.archetype}. Confidence: ${profile.confidence || 'unknown'}.`,
                { archetype: profile.archetype, notes_count: notes.length }
            );

            await prisma.player.update({
                where: { id: playerId },
                data: { 
                    ai_profile: profile as any,
                    playstyle: profile.archetype.toUpperCase(),
                    aggression_score: profile.aggression_score ?? 50,
                    looseness_score: profile.looseness_score ?? 50
                }
            });
        }

        return profile;
    }

    private static normalize(content: string, type: string): string | null {
        // Obsolete, replaced by PokerNoteParser.parse()
        return null;
    }

    private static calculateWeight(note: any): number {
        let weight = 1.0;

        // Street Weight
        if (note.street === 'river') weight *= 1.5;
        if (note.street === 'turn') weight *= 1.2;

        // Recency (30 day decay)
        const daysOld = (Date.now() - new Date(note.created_at).getTime()) / (1000 * 60 * 60 * 24);
        const recencyDecay = Math.max(0.5, 1 - (daysOld / 30) * 0.5);
        weight *= recencyDecay;

        // Severity (if mentioned in content)
        if (note.content.toLowerCase().includes('critical')) weight *= 3.0;
        if (note.content.toLowerCase().includes('moderate')) weight *= 1.5;

        return weight;
    }

    private static async callAI(structuredData: any[], playerId: string, activePatterns: any[] = []) {
        const groqKey = process.env.GROQ_API_KEY;

        try {
            // Fetch raw notes for context
            const [notes, player] = await Promise.all([
                prisma.note.findMany({
                    where: { player_id: playerId },
                    take: 5,
                    orderBy: { created_at: 'desc' }
                }),
                prisma.player.findUnique({
                    where: { id: playerId },
                    select: { user_id: true }
                })
            ]);

            if (!player) return null;

            // Fetch Custom Prompt
            const aiConfig = await prisma.userAIConfig.findUnique({
                where: { user_id: player.user_id }
            });

            const modelName = aiConfig?.model_name || 'llama-3.3-70b-versatile';
            const isChatGPT = modelName.startsWith('gpt-');
            
            const client = new OpenAI({
                apiKey: isChatGPT ? process.env.OPENAI_API_KEY : groqKey || '',
                baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
            });

            const rawContent = notes.map(n => n.content).join('; ');
            const prompt = buildProfilePrompt(aiConfig?.system_prompt || undefined, aiConfig as any);
            
            let inputText = `STRUCTURED TENDENCIES: ${JSON.stringify(structuredData, null, 2)}\n\nRAW CONTEXTUAL NOTES: ${rawContent}`;
            if (activePatterns && activePatterns.length > 0) {
                inputText = `### VERIFIED PLAYER PATTERNS:\n\n` + 
                            activePatterns.map(p => `- ${p.pattern} (confidence: ${p.confidence}, ${p.occurrences} samples)`).join('\n') +
                            `\n\nUse ONLY if relevant to build archetype.\n\n` + inputText;
            }

            console.log(`[PlayerProfiling] SYSTEM PROMPT (User: ${player.user_id}):\n${prompt}`);
            console.log(`[PlayerProfiling] USER INPUT:\n${inputText}`);

            const response = await client.chat.completions.create({
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: inputText }
                ],
                model: modelName,
                temperature: aiConfig?.temperature ?? 0.7,
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return null;

            return JSON.parse(content);
        } catch (error) {
            console.error('[ProfileAggregator] AI Error:', error);
            return null;
        }
    }
}
