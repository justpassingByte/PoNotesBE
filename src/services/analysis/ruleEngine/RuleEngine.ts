import { HandState, Mistake } from './models';
import { FeatureExtractor } from './FeatureExtractor';
import { RuleEngineCore } from './RuleEngineCore';

export interface RuleEngineResult {
    heroMistakes: Mistake[];
    villainMistakes: Mistake[];
    betterLine: string;
    exploitSuggestion: string;
    summary: string;
    tags: string[];
}

/**
 * RuleEngine: Orchestrator chính cho toàn bộ hệ thống phân tích deterministic
 */
export class RuleEngine {

    static async analyze(rawHandData: any): Promise<RuleEngineResult> {
        // 1. Build State
        const state = new HandState(rawHandData);
        
        // 2. Extract Features (Texture, Strength, SPR)
        FeatureExtractor.extract(state);
        
        // 3. Run Core Rules (Deterministic Logic)
        const coreResult = RuleEngineCore.analyze(state);
        
        // 4. Build Automated Exploit & Line (Simple Baseline)
        const betterLine = this.buildBetterLine(state, coreResult.heroMistakes);
        const exploitSuggestion = this.buildExploit(state, coreResult.villainMistakes);
        const summary = this.buildSummary(state, coreResult.tags);

        return {
            heroMistakes: coreResult.heroMistakes,
            villainMistakes: coreResult.villainMistakes,
            betterLine,
            exploitSuggestion,
            summary,
            tags: coreResult.tags
        };
    }

    private static buildBetterLine(state: HandState, mistakes: Mistake[]): string {
        const valueMistake = mistakes.find(m => m.description.includes('Checking a strong'));
        if (valueMistake) {
            return `Aggressive Value Betting: With a ${state.heroHandStrength}, prioritize betting at least 66-75% pot on neutral rivers instead of checking.`;
        }
        return 'Standard GTO line: Maintain balance between check-calling medium hands and betting polar ranges.';
    }

    private static buildExploit(state: HandState, mistakes: Mistake[]): string {
        if (state.tags.includes('cooler')) {
            return `Unavoidable Cooler: Focus on identifying sizing tells in future hands to mitigate losses, but avoid over-folding sets.`;
        }
        return `Default Exploit: Adjust sizing based on board texture; over-bet vs passive opponents and under-bet vs aggressive ones.`;
    }

    private static buildSummary(state: HandState, tags: string[]): string {
        let text = `Analysis of a ${state.isMultiway ? 'multiway' : 'heads-up'} pot. SPR is ${state.spr}. Board texture is ${state.boardTexture.join(', ')}.`;
        if (tags.includes('cooler')) text += ` | Hand flagged as a potential Cooler.`;
        return text;
    }
}
