import { prisma } from '../../lib/prisma';
import { PokerNoteParser } from './PokerNoteParser';
import { LoggerService, LogType } from '../loggerService';

export class PatternEngine {
    private static DECAY_FACTOR_PER_DAY = 0.95;
    private static CONFIDENCE_THRESHOLD = 0.7;
    private static MIN_OCCURRENCES = 3;

    /**
     * Process a new note to build Memory Intelligence
     */
    static async processNote(note: any) {
        if (!note || !note.content) return;

        console.log(`[PatternEngine] Processing new note for player ${note.player_id}...`);

        const parsed = PokerNoteParser.parse(note.content);
        let patternStr = "";

        // -- Context Granularity extraction (Position & Stack Depth) --
        const posMatch = note.content.match(/\b([A-Z]{2,3})\s*(vs|v)\s*([A-Z]{2,3})\b/i);
        const stackMatch = note.content.match(/\b(\d+bb)\b/i);
        
        let contextParts = [];
        if (posMatch) contextParts.push(`${posMatch[1].toUpperCase()} vs ${posMatch[3].toUpperCase()}`);
        
        // Normalize Stack Depth to Buckets
        if (stackMatch) {
            const bbMatch = parseInt(stackMatch[1].replace('bb', ''), 10);
            if (!isNaN(bbMatch)) {
                if (bbMatch < 30) contextParts.push("short_stack");
                else if (bbMatch <= 80) contextParts.push("mid_stack");
                else contextParts.push("deep_stack");
            }
        }
        
        const contextStr = contextParts.length > 0 ? ` [${contextParts.join(' | ')}]` : '';

        if (parsed) {
            patternStr = `${note.street?.toLowerCase() || 'general'} ${parsed.category}: ${parsed.action}${contextStr}`;
            if (parsed.potType) patternStr += ` in ${parsed.potType}`;
        } else {
            patternStr = `${note.street?.toLowerCase() || 'general'} tendency: ${note.category || 'unknown'}${contextStr}`;
        }

        const weight = this.calculateWeight(note) * (parsed?.strength || 0.5);
        const now = new Date();

        // Use Prisma Transaction to avoid Race Conditions
        await prisma.$transaction(async (tx) => {
            const existing = await tx.playerPattern.findUnique({
                where: { player_id_pattern: { player_id: note.player_id, pattern: patternStr } }
            });

            if (existing) {
                const daysSinceLast = (now.getTime() - existing.last_seen.getTime()) / (1000 * 60 * 60 * 24);
                const decay = Math.pow(this.DECAY_FACTOR_PER_DAY, daysSinceLast);
                const currentConfidence = existing.confidence * decay;
                
                // Log-based growth: reduces learning speed as occurrences increase to prevent false patterns
                const growthFactor = (0.2 * weight) / Math.sqrt(existing.occurrences);
                const newConfidence = Math.min(1.0, currentConfidence + growthFactor);

                await tx.playerPattern.update({
                    where: { id: existing.id },
                    data: {
                        occurrences: existing.occurrences + 1,
                        confidence: newConfidence,
                        decay_score: decay,
                        last_seen: now
                    }
                });

                console.log(`[PatternEngine] Updated pattern: ${patternStr} -> conf: ${newConfidence.toFixed(2)}, occ: ${existing.occurrences + 1}`);

                if (newConfidence >= this.CONFIDENCE_THRESHOLD && (existing.occurrences + 1) >= this.MIN_OCCURRENCES) {
                    await LoggerService.log(
                        note.user_id,
                        LogType.PROFILE_EVOLUTION,
                        `Memory Intelligence: Verified Pattern -> ${patternStr} (conf: ${newConfidence.toFixed(2)})`,
                        { pattern: patternStr, player_id: note.player_id }
                    );
                }
            } else {
                // Initial confidence much lower, requiring more occurrences to unlock
                const initialConf = Math.min(1.0, 0.2 + (weight * 0.1)); 
                await tx.playerPattern.create({
                    data: {
                        player_id: note.player_id,
                        pattern: patternStr,
                        confidence: initialConf,
                        occurrences: 1,
                        decay_score: 1.0,
                        last_seen: now
                    }
                });
                console.log(`[PatternEngine] Created new pattern: ${patternStr} -> conf: ${initialConf.toFixed(2)}`);
            }
        });
    }

    /**
     * Get verified active patterns for LLM injection
     */
    static async getActivePatterns(playerId: string) {
        const patterns = await prisma.playerPattern.findMany({
            where: { player_id: playerId }
        });

        const now = new Date();
        const active: Array<{ pattern: string; confidence: number; occurrences: number; category?: string; subCategory?: string; action?: string; _rawScore: number }> = [];

        for (const p of patterns) {
            const days = (now.getTime() - p.last_seen.getTime()) / (1000 * 60 * 60 * 24);
            // Global decay
            const decay = Math.pow(this.DECAY_FACTOR_PER_DAY, days);
            // Recency bias: recent patterns get a boost relative to old ones, keeping AI adaptive.
            const recencyWeight = Math.exp(-days / 7); 
            
            const currentConf = p.confidence * decay;
            const finalScore = currentConf * (0.8 + 0.2 * recencyWeight); // Blend score

            if (p.occurrences >= this.MIN_OCCURRENCES && currentConf >= this.CONFIDENCE_THRESHOLD) {
                // Extract semantic parts to resolve conflicts
                const parsedCat = p.pattern.match(/^(.*?) (.*?):/);
                const isAggressive = p.pattern.includes('aggressive');
                const isPassive = p.pattern.includes('passive');

                active.push({
                    pattern: p.pattern,
                    confidence: Number(finalScore.toFixed(2)),
                    occurrences: p.occurrences,
                    category: parsedCat ? parsedCat[2] : undefined,
                    subCategory: isAggressive ? 'aggressive' : isPassive ? 'passive' : 'neutral',
                    _rawScore: finalScore
                });
            }
        }

        // --- CONFLICT RESOLUTION ---
        // If a player has both 'aggressive' and 'passive' verified patterns for the same semantic group,
        // we suppress the weaker one. This prevents confusing the LLM.
        const resolved: typeof active = [];
        const groups = new Map<string, typeof active>();

        for (const p of active) {
            if (p.category) {
                const existingGroup = groups.get(p.category) || [];
                existingGroup.push(p);
                groups.set(p.category, existingGroup);
            } else {
                resolved.push(p); // Can't resolve conflicts without category
            }
        }

        groups.forEach((group) => {
            if (group.length > 1) {
                const hasAggressive = group.some(p => p.subCategory === 'aggressive');
                const hasPassive = group.some(p => p.subCategory === 'passive');
                
                if (hasAggressive && hasPassive) {
                    // Conflict found! Keep ONLY the highest scoring one
                    const dominant = group.reduce((prev, current) => (prev._rawScore > current._rawScore) ? prev : current);
                    resolved.push(dominant);
                    return; // Skip the rest of the conflicting group
                }
            }
            // If no conflict or mono-directional group, keep all
            resolved.push(...group);
        });

        return resolved.sort((a, b) => b.confidence - a.confidence).map(p => ({
            pattern: p.pattern,
            confidence: p.confidence,
            occurrences: p.occurrences
        }));
    }

    private static calculateWeight(note: any): number {
        let weight = 1.0;
        if (note.street === 'river') weight *= 1.5;
        if (note.street === 'turn') weight *= 1.2;
        if (note.content.toLowerCase().includes('critical')) weight *= 3.0;
        if (note.content.toLowerCase().includes('moderate')) weight *= 1.5;
        return weight;
    }
}
