import { HandState, Mistake, Severity } from './models';

/**
 * RuleEngineCore: Thực thi các quy tắc logic nghiệp vụ poker
 */
export class RuleEngineCore {

    static analyze(state: HandState): { heroMistakes: Mistake[], villainMistakes: Mistake[], tags: string[] } {
        const heroMistakes: Mistake[] = [];
        const villainMistakes: Mistake[] = [];
        const tags: string[] = [];

        // 1. Value Bet Mandate (River Logic)
        this.checkValueBetMistakes(state, heroMistakes);
        
        // 2. Cooler Detection
        if (this.isCooler(state)) tags.push('cooler');

        // 3. Multiway Adjustments
        if (state.isMultiway) tags.push('multiway_pot');

        // 4. Villain Overcall Check
        this.checkVillainOvercalls(state, villainMistakes);

        return { heroMistakes, villainMistakes, tags };
    }

    /**
     * Quy tắc: Có bài mạnh (Set+) ở River mà không bet là lỗi mất EV
     */
    private static checkValueBetMistakes(state: HandState, mistakes: Mistake[]): void {
        const riverActions = state.streets.river;
        if (!riverActions || riverActions.length === 0) return;

        // Nếu Hero check ở River khi có bài cực mạnh
        const heroAction = riverActions.find(a => a.player === state.hero?.name);
        if (heroAction && heroAction.action === 'check') {
            if (['nuts', 'very_strong'].includes(state.heroHandStrength)) {
                // Kiểm tra Board có quá nguy hiểm(Four flush/Straight) không
                const isExtremeBoard = state.boardTexture.includes('monotone') || state.boardTexture.includes('low_connected');
                
                if (!isExtremeBoard) {
                    mistakes.push({
                        street: 'river',
                        description: `Checking a strong ${state.heroHandStrength} on a relatively safe board losing significant EV. Should prioritize value betting.`,
                        severity: 'moderate'
                    });
                }
            }
        }
    }

    /**
     * Quy tắc: Cooler Detection (Set vs Set)
     */
    private static isCooler(state: HandState): boolean {
        // Logic đơn giản: Nếu Hero có Set+ và có bài của Villain (nếu OCR bóc được showdown) hoặc action cực mạnh
        if (state.heroHandStrength === 'very_strong') {
            const hasHugeVillainAction = Object.values(state.streets).flat().some(a => a.action === 'all-in' || a.amount > 100);
            return hasHugeVillainAction;
        }
        return false;
    }

    /**
     * Quy tắc: Villain Over-call (Call bet lớn với bài yếu ở River)
     */
    private static checkVillainOvercalls(state: HandState, mistakes: Mistake[]): void {
        const riverActions = state.streets.river;
        const lastAction = riverActions[riverActions.length - 1];
        if (!lastAction) return;

        if (lastAction.action === 'call' && lastAction.amount > 50) {
            // Nếu có kết quả showdown (chúng ta sẽ gán vào villains cards nếu có)
            const callingVillain = state.villains.find(v => v.name === lastAction.player);
            if (callingVillain && callingVillain.hole_cards) {
                // Phân tích sức mạnh villain (Nếu có data)
                // TODO: Evaluate villain strength
            }
        }
    }
}
