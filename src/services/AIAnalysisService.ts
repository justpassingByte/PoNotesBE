import { prisma } from '../lib/prisma';

export interface AIAnalysisResult {
    playstyle: string;
    aggression_level: string;
    aggression_score: number;
    strategic_insight: string;
    analysis_mode: string;
    stats_used: string[];
    stats_missing?: string[];
    improvement_suggestions?: string;
    ai_range_matrix?: any;
    ai_action_breakdown?: any;
}

/**
 * ARCHITECTURE ENFORCEMENT STUB
 * 
 * The previous version of this service violated the strict 3-Layer deterministic architecture by
 * directly feeding raw notes to the AI and bypassing the PlayerProfileAggregator to hallucinate
 * archetypes, aggression scores, and exploit logic in one monolithic prompt.
 * 
 * Exploit Generation cannot occur until:
 * 1. stack-depth-bucket-system
 * 2. spot-template-system
 * 3. board-bucket-system
 * 4. bet-bucket-system
 * 5. decision-context-builder 
 * ... are explicitly defined and implemented.
 * 
 * This service is temporarily stubbed out. It will be rebuilt properly in Phase 6 to purely consume
 * the Canonical `decision_context` object.
 */
export class AIAnalysisService {

    async analyzeWithContext(
        playerId: string,
        position: string,
        heroStack: number,
        villainStack: number,
        forcedMode?: 'simple' | 'advanced'
    ): Promise<AIAnalysisResult | null> {

        console.error('[ARCHITECTURE VIOLATION] Attempted to run legacy monolithic AI strategy generation.');
        console.error('Exploit generation is disabled until the Decision Context builder (Phase 5) is complete.');

        throw new Error(
            'Architecture Violation: Exploit engine cannot run until Spot Abstraction and Decision Context Builder components are implemented. Please complete the prerequisite build layers.'
        );
    }

    async analyzePlayer(playerId: string): Promise<AIAnalysisResult | null> {
        return this.analyzeWithContext(playerId, 'IP', 100, 100);
    }
}
