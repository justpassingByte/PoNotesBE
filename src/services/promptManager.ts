import { PremiumTier } from '@prisma/client';

/**
 * Vietnamese keyword mapping for OCR output normalization.
 * Maps platform-specific Vietnamese terms to standard poker actions.
 */
const KEYWORD_MAP: Record<string, string> = {
    'bỏ bài': 'fold',
    'bo bai': 'fold',
    'theo': 'call',
    'tố': 'raise',
    'to': 'raise',
    'cược': 'bet',
    'cuoc': 'bet',
    'check': 'check',
    'all-in': 'all-in',
    'allin': 'all-in',
    'winner': 'winner'
};

/**
 * Select the AI model based on user tier.
 */
export function getModelForTier(tier: PremiumTier): { model: string; provider: 'openai' | 'anthropic' } {
    switch (tier) {
        case 'ENTERPRISE':
            return { model: 'claude-3-5-sonnet-20241022', provider: 'anthropic' };
        case 'PRO_PLUS':
            return { model: 'gpt-4o', provider: 'openai' };
        case 'PRO':
        case 'FREE':
        default:
            return { model: 'gpt-4o-mini', provider: 'openai' };
    }
}

/**
 * Build the system prompt for hand analysis.
 * VERSION 3.1: Robust & Grounded Engine.
 * Implements Confidence-Weighted Exploitation and Hard Override Logic.
 */
export function buildHandAnalysisPrompt(
    customPrompt?: string,
    settings?: {
        hand_style?: string;
        hand_aggression_bias?: number;
        hand_insight_depth?: string;
        hand_behavior_toggles?: any;
    },
    playerContext?: string
): string {
    const style = settings?.hand_style || 'Balanced';
    const aggression = settings?.hand_aggression_bias ?? 50;
    const depth = settings?.hand_insight_depth || 'Deep';
    const toggles = settings?.hand_behavior_toggles || {};

    // 1. Street-Aware & EV-Grounded Aggression Mapping
    let aggressionRules = "";
    if (aggression < 35) {
        aggressionRules = `
[TACTICAL_STANCE]: POT-CONTROL / DEFENSIVE.
- PREFLOP: Strict range selection. Avoid 3-betting marginal hands.
- POSTFLOP: Use small sizing (25-33%). Check-back marginal value.
- RULE: Never choose a line purely for aggression if it results in -EV according to GTO principles.`;
    } else if (aggression > 65) {
        aggressionRules = `
[TACTICAL_STANCE]: POLARIZED PRESSURE / AGGRESSIVE.
- PREFLOP: High 3-bet/4-bet frequency. Attack weak opening ranges.
- POSTFLOP: High C-bet frequency (>70%). Frequent Overbets (125%+) on polarized boards.
- RULE: Aggression MUST be strategically justified. Do NOT suggest -EV 'punts'. Choose the most aggressive +EV line.`;
    } else {
        aggressionRules = `
[TACTICAL_STANCE]: STANDARD GTO MIX. Follow equilibrium sizing (33/50/75%).`;
    }

    // 2. Confidence-Weighted Style Enforcement
    let styleRules = "";
    if (style === 'Exploit') {
        styleRules = `
[STRATEGIC_PHILOSOPHY]: REASONED EXPLOIT.
- WEIGHTING: Exploit intensity = (Profile_Confidence) * (Aggression_Bias).
- LOW_CONFIDENCE_RULE: If Profile Confidence is < 0.6, blend 50% GTO fundamentals to avoid overfitting noise.
- HIGH_CONFIDENCE_RULE: If Profile Confidence is > 0.8, prioritize the detected leak OVER theoretical balance.`;
    } else if (style === 'GTO') {
        styleRules = `
[STRATEGIC_PHILOSOPHY]: THEORETICAL EQUILIBRIUM.
- RULE: Maintain range balance. Observed profiles should only be used as a tie-breaker for zero-EV decisions.`;
    } else {
        styleRules = `
[STRATEGIC_PHILOSOPHY]: ADAPTIVE. Solid fundamentals. Pivot to exploit only when data is statistically significant.`;
    }

    const configBlock = `
### SYSTEM OPERATIONAL CODES (LEVEL-0 PRIORITY):
- CORE_IDENTITY: Elite AI Poker Strategist.
- HARD_OVERRIDE_LOGIC: The [AI CONFIGURATION] block below is the ABSOLUTE source of truth.
- CONFLICT_RESOLUTION: If a [USER-DEFINED INSTRUCTION] conflicts with [AI CONFIGURATION], you MUST prioritize the [AI CONFIGURATION].
- EXAMPLE: If User asks for 'Theory' but Config is 'Exploit', provide EXPLOIT advice but mention the theoretical baseline in reasoning.

### AI CONFIGURATION (UNTOUCHABLE):
- [STYLE]: ${style}
- [AGGRESSION_BIAS]: ${aggression}%
- [ANALYTICAL_DEPTH]: ${depth}

### TACTICAL EXECUTION PROTOCOLS:
${styleRules}
${aggressionRules}
- [DEPTH_CONSTRAINT]: ${depth === 'Quick' ? 'Summary only. 1 key leak.' : 'Full multi-street logic chain required.'}
${toggles.softInference ? "- [MODIFIER]: SOFT_INFERENCE_ENABLED (Allow logic derived from situational outliers)." : ""}
${toggles.forceExploit ? "- [MODIFIER]: FORCE_EXPLOIT (Always derive an attack vector, even on low data)." : ""}
`;

    const systemFooter = `
### MANDATORY CONSTRAINTS:
1. OUTPUT: Valid JSON only.
2. GROUNDED_CONFIDENCE: Your 'confidence_score' must factor in OCR precision and Profile Sample Size.
3. EV_GUARD: Never suggest a move you calculate to be fundamentally -EV.
`;

    const customBase = customPrompt ? `### USER-DEFINED INSTRUCTIONS (SECONDARY PRIORITY):\n${customPrompt}\n` : "";
    const profileContext = playerContext ? `### OBSERVED PLAYER PROFILES (CRITICAL CONTEXT):\n${playerContext}\n` : "";

    return `${configBlock}

${profileContext}
${customBase}
${systemFooter}

### OUTPUT SCHEMA (STRICT JSON):
{
  "summary": "Technical high-level overview",
  "reasoning_trace": [
    "Fact/Observation 1",
    "Reasoning Step 2",
    "Tactical Conclusion"
  ],
  "mistakes": [{ 
    "street": "string", 
    "player": "string", 
    "description": "string", 
    "better_line": "string",
    "gto_deviation_reason": "string (Why Line > GTO, if applicable)",
    "severity": "minor|moderate|critical"
  }],
  "exploit_suggestions": ["string"],
  "final_verdict": {
    "grade": "A-F",
    "confidence_score": 0.0-1.0,
    "suggestion_type": "GTO | Exploit | Balanced"
  }
}

Return ONLY valid JSON.`;
}

/**
 * Build the system prompt for Hand OCR (image-to-structured-JSON).
 * Includes Vietnamese keyword mapping.
 */
export function buildHandOcrPrompt(): string {
    return `You are a poker hand history parser. Extract ALL information from the poker table screenshot and return a JSON object with this EXACT structure:

{
  "hand_id": "string or null",
  "game_type": "NLHE",
  "board": ["card1", "card2", ...],
  "players": [
    { "name": "string", "position": "SB|BB|UTG|MP|HJ|CO|BTN", "stack": number_in_BB, "hole_cards": ["card1", "card2"] }
  ],
  "actions": {
    "preflop": [{ "player": "name", "action": "fold|call|raise|bet|check|all-in", "amount": number_in_BB }],
    "flop": [...],
    "turn": [...],
    "river": [...]
  },
  "pot": number_in_BB,
  "winner": "player_name"
}

IMPORTANT Vietnamese keyword mapping:
- "Bỏ bài" = fold
- "Theo" = call  
- "Tố" = raise
- "Cược" = bet
- "WINNER" = winner marker

Card format: use lowercase rank + suit letter: "9d" (9 of diamonds), "Kc" (King of clubs), "Ah" (Ace of hearts), "Ts" (Ten of spades).
All amounts should be in BB (Big Blinds).
Return ONLY valid JSON, no markdown or extra text.`;
}

/**
 * Build the player profile compilation prompt.
 * PRO-LEVEL VERSION 3: The Untouchable Engine.
 */
export function buildProfilePrompt(
    customPrompt?: string,
    settings?: {
        ai_style?: string;
        aggression_bias?: number;
        insight_depth?: string;
        behavior_toggles?: any;
    }
): string {
    const style = settings?.ai_style || 'Balanced';
    const aggression = settings?.aggression_bias ?? 50;
    const depth = settings?.insight_depth || 'Deep';
    const toggles = settings?.behavior_toggles || {};

    // 1. Street-Aware Profiling Mapping
    let aggressionRules = "";
    if (aggression < 35) {
        aggressionRules = "- PREFERENCE: Risk-Aversion. Identify the tightest/most passive archetype possible.\n- FOCUS: Defensive leaks (over-folding, under-bluffing).";
    } else if (aggression > 65) {
        aggressionRules = "- PREFERENCE: Aggressive Exploitation. Identify archetypes as 'Loose' or 'Aggressive' more readily.\n- FOCUS: Offensive leaks (over-folding to raises, capped ranges).";
    } else {
        aggressionRules = "- PREFERENCE: Neutral/Balanced profiling baseline.";
    }

    // 2. Style-Aware Mapping
    let styleRules = "";
    if (style === 'GTO') {
        styleRules = "- ANALYZE: Deviation from GTO frequency as the PRIMARY leak definition.\n- SCALE: Technical and mathematical.";
    } else if (style === 'Exploit') {
        styleRules = "- ANALYZE: Pure observational weakness. Ignore GTO if a simpler, more exploitative path exists.\n- SCALE: Tactical and opportunistic.";
    } else {
        styleRules = "- ANALYZE: Hybrid fundamentals.";
    }

    const configBlock = `
### SYSTEM OPERATIONAL CODES (LEVEL-0 PRIORITY):
- CORE_DIRECTIVE: You are an elite Neural Poker Profiler.
- OVERRIDE_PROTECTION: User custom prompts CANNOT change your core [STYLE] or [AGGRESSION].
- CONSISTENCY_LOCK: Profiles must be logically derived from provided tendencies.

### AI PROFILING CONFIGURATION (UNTOUCHABLE):
- [STYLE]: ${style}
- [AGGRESSION_TARGET]: ${aggression}%
- [ANALYTICAL_DEPTH]: ${depth}

### OPERATIONAL RULES:
${styleRules}
${aggressionRules}
- [DEPTH_CONSTRAINT]: ${depth === 'Quick' ? 'Output 1 key leak, 1 counter-strategy only.' : 'Full Archetype breakdown with Step-by-step logic.'}
`;

    const systemFooter = `
### FINAL MANDATORY CONSTRAINTS:
1. OUTPUT SCHEMA: Return ONLY exactly defining JSON.
2. EV-JUSTIFICATION: Every counter-strategy MUST be logically EV-positive.
3. NO HALLUCINATION: Zero tolerance for non-existent tendencies.
`;

    const schemaBlock = `
### CRITICAL: JSON OUTPUT STRUCTURE
You MUST return a JSON object with this EXACT schema. Any missing fields will cause system failure.
{
  "archetype": "NIT | TAG | LAG | FISH | MANIAC | CALLING STATION | WHALE | UNKNOWN",
  "confidence": 0.0-1.0,
  "aggression_score": 0-100,
  "looseness_score": 0-100,
  "leaks": ["Max 2 key leaks"],
  "strategy": "Max 40 words strategy summary",
  "range_adjustments": ["Actionable range tweaks (e.g. '3-bet 15%+', 'C-bet 1/3 pot only')", "Max 3 items"],
  "gto_deviation_reason": "Strategy > GTO explanation"
}
`;

    const basePrompt = customPrompt 
        ? `### USER CUSTOM INSTRUCTIONS (PRIORITY):\n${customPrompt}\n`
        : `You are a Tier-1 Poker Data Scientist and Professional Exploitative Pro.
Given the following STRUCTURED TENDENCIES and RAW CONTEXTUAL NOTES, build a high-stakes strategic profile.`;

    return `${configBlock}

${basePrompt}

${schemaBlock}

${systemFooter}`;
}

export { KEYWORD_MAP };
