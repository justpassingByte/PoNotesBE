import { prisma } from '../../lib/prisma';
import { buildProfilePrompt } from '../promptManager';
import OpenAI from 'openai';

interface TendencyScore {
    key: string;
    score: number;
    count: number;
}

import { PokerNoteParser } from './PokerNoteParser';

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

        // 4. Call AI for Profiling
        console.log(`\n--- [PlayerProfiling] AI PROMPT SENT ---`);
        const profile = await this.callAI(structuredData, playerId);

        // ... AI Response Log and Update playstyle ...
        if (profile) {
            console.log(`[PlayerProfiling] AI RESPONSE RECEIVED:`, JSON.stringify(profile, null, 2));
            console.log(`[PlayerProfiling] FINAL AI ARCHETYPE: ${profile.archetype} (Confidence: ${profile.confidence || 'unknown'})`);
        }
        
        // 5. Save to DB (Updated sync logic)
        if (profile && profile.archetype) {
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

    private static async callAI(structuredData: any[], playerId: string) {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) return null;

        const groq = new OpenAI({
            apiKey: groqKey,
            baseURL: 'https://api.groq.com/openai/v1'
        });

        try {
            // Fetch raw notes for context
            const notes = await prisma.note.findMany({
                where: { player_id: playerId },
                take: 5,
                orderBy: { created_at: 'desc' }
            });

            const rawContent = notes.map(n => n.content).join('; ');
            const prompt = buildProfilePrompt();
            const inputText = `STRUCTURED TENDENCIES: ${JSON.stringify(structuredData, null, 2)}\n\nRAW CONTEXTUAL NOTES: ${rawContent}`;

            console.log(`[PlayerProfiling] SYSTEM PROMPT:\n${prompt}`);
            console.log(`[PlayerProfiling] USER INPUT:\n${inputText}`);

            const response = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: inputText }
                ],
                model: 'llama-3.3-70b-versatile',
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
