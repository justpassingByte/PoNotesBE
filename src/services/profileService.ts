import { prisma } from '../lib/prisma';
import { buildProfilePrompt, getModelForTier } from './promptManager';
import { PremiumTier } from '@prisma/client';

export interface PlayerProfile {
    tendencies: string[];
    leaks: string[];
    exploitStrategy: string[];
}

export class ProfileService {
    /**
     * Aggregate all notes for a player, then run through LLM to generate
     * a structured profile (tendencies, leaks, exploitStrategy).
     * 
     * Uses Map-Reduce for large note sets:
     * 1. Chunk notes into batches
     * 2. Summarize each batch
     * 3. Merge summaries into final profile
     */
    async compileProfile(playerId: string, tier: PremiumTier): Promise<PlayerProfile> {
        // Fetch all notes for the player
        const notes = await prisma.note.findMany({
            where: { player_id: playerId },
            orderBy: { created_at: 'desc' }
        });

        if (notes.length === 0) {
            return { tendencies: [], leaks: [], exploitStrategy: [] };
        }

        // Check if we can just return existing cached profile
        const player = await prisma.player.findUnique({ where: { id: playerId } });
        if (player?.ai_profile && player.ai_last_analyzed_at) {
            const lastNote = notes[0];
            if (lastNote.created_at <= player.ai_last_analyzed_at) {
                // No new notes since last analysis — return cached
                return player.ai_profile as unknown as PlayerProfile;
            }
        }

        // Build note content for LLM
        const noteTexts = notes.map((n, i) =>
            `[${i + 1}] (${n.street}, ${n.note_type}): ${n.content}`
        );

        const CHUNK_SIZE = 50;

        let profile: PlayerProfile;

        if (noteTexts.length <= CHUNK_SIZE) {
            // Small enough to process in one shot
            profile = await this.analyzeNotesBatch(noteTexts, tier);
        } else {
            // Map-Reduce for large note sets
            const chunks: string[][] = [];
            for (let i = 0; i < noteTexts.length; i += CHUNK_SIZE) {
                chunks.push(noteTexts.slice(i, i + CHUNK_SIZE));
            }

            // Map: summarize each chunk
            const partialProfiles = await Promise.all(
                chunks.map(chunk => this.analyzeNotesBatch(chunk, tier))
            );

            // Reduce: merge all partial profiles
            const mergedTendencies = partialProfiles.flatMap(p => p.tendencies);
            const mergedLeaks = partialProfiles.flatMap(p => p.leaks);
            const mergedExploits = partialProfiles.flatMap(p => p.exploitStrategy);

            // Final pass to deduplicate and consolidate
            profile = await this.consolidateProfile(
                { tendencies: mergedTendencies, leaks: mergedLeaks, exploitStrategy: mergedExploits },
                tier
            );
        }

        // Cache the result in the Player record
        await prisma.player.update({
            where: { id: playerId },
            data: {
                ai_profile: profile as any,
                ai_last_analyzed_at: new Date()
            }
        });

        return profile;
    }

    /**
     * Analyze a batch of notes. Calls LLM.
     * TODO: Wire up actual LLM API call
     */
    private async analyzeNotesBatch(noteTexts: string[], tier: PremiumTier): Promise<PlayerProfile> {
        const { model, provider } = getModelForTier(tier);
        const systemPrompt = buildProfilePrompt();
        const userContent = `Player notes:\n${noteTexts.join('\n')}`;

        // TODO: Call LLM API with systemPrompt + userContent
        // For now, return empty profile until API keys are configured
        console.warn(`[ProfileService] LLM call pending. Model: ${model}, Notes: ${noteTexts.length}`);
        return { tendencies: [], leaks: [], exploitStrategy: [] };
    }

    /**
     * Consolidation pass: merge partial profiles into a final deduplicated profile.
     */
    private async consolidateProfile(merged: PlayerProfile, tier: PremiumTier): Promise<PlayerProfile> {
        // For now, simple dedup via Set
        return {
            tendencies: [...new Set(merged.tendencies)],
            leaks: [...new Set(merged.leaks)],
            exploitStrategy: [...new Set(merged.exploitStrategy)]
        };
    }
}
