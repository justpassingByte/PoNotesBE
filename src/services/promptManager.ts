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
  'kiểm tra': 'check',
  'kiem tra': 'check',
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
- LOW_CONFIDENCE_RULE: If Profile Confidence is < 0.6, blend GTO fundamentals to maintain a safe floor.
- HIGH_CONFIDENCE_RULE: If Profile Confidence is > 0.7, prioritize ruthlessly punishing the detected leak OVER theoretical balance.
- MAX_EXPLOIT: If a clear leak is identified (e.g., villain overfolds, over-bluffs, or is unbalanced), your suggested 'better_line' MUST be the one that extracts the absolute maximum expected value (EV) from that specific deviation, even if it is un-balanced.`;
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

### AI CONFIGURATION (UNTOUCHABLE):
- [STYLE]: ${style}
- [AGGRESSION_BIAS]: ${aggression}%
- [ANALYTICAL_DEPTH]: ${depth}

### TACTICAL EXECUTION PROTOCOLS:
${styleRules}
${aggressionRules}
- [DEPTH_CONSTRAINT]: ${depth === 'Quick' ? 'Summary only. 1 key leak.' : 'Full multi-street logic chain required.'}
${toggles.softInference ? "- [MODIFIER]: SOFT_INFERENCE_ENABLED (Allow logic derived from situational outliers)." : ""}
${toggles.forceExploit || style === 'Exploit' ? "- [MODIFIER]: FORCE_EXPLOIT (Always derive an attack vector, even on low data)." : ""}

### HAND-EXPLOIT PROTOCOL (MANDATORY)
${style === 'Exploit' ? `You are in EXPLOIT mode for this hand.
- Punish deviance: Identify exactly where villain moved away from equilibrium and suggest a line that punishes that error 100%.
- No "playing safe": If villain is weak/passive, your better_line should almost always involve attacking them (larger bets/more bluffs).
- Trap more: If villain is an over-bluffer, suggest trapping/checking instead of betting into them.
- EV > Balance: Do not worry about being "balanced" if you have a high-confidence read. Suggest the most profitable line.
` : 'Solid fundamentals with conditional exploit pivoting.'}
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
    "preflop": [{ "player": "name", "action": "fold|call|raise|bet|check|all-in", "amount": number_in_BB or $ }],
    "flop": [...],
    "turn": [...],
    "river": [...]
  },
  "pot": number_in_BB,
  "winner": "player_name"
}

IMPORTANT Vietnamese keyword mapping:
-"Kiểm tra" = check
- "Bỏ bài" = fold
- "Theo" = call  
- "Tố" = raise
- "Cược" = bet
- "WINNER" = winner marker

Card format: use lowercase rank + suit letter: "9d" (9 of diamonds), "Kc" (King of clubs), "Ah" (Ace of hearts), "Ts" (Ten of spades).
All amounts should be in BB (Big Blinds).
Return ONLY valid JSON, no markdown or extra text.`;
}

export function buildProfilePrompt(
  customPrompt?: string,
  settings?: {
    ai_style?: string;
    aggression_bias?: number;
    insight_depth?: string;
    behavior_toggles?: any;
  }
): string {
  // If the user has a custom prompt saved in their DB, it is a FULL prompt string
  // overriding the system default. We return it directly to avoid wrapping it 
  // inside itself and causing duplicate "OUTPUT FORMAT" instructions.
  if (customPrompt && customPrompt.trim() !== '') {
    return customPrompt;
  }

  const style = settings?.ai_style || 'Balanced';
  const aggression = settings?.aggression_bias ?? 50;
  const depth = settings?.insight_depth || 'Deep';
  const toggles = settings?.behavior_toggles || {};

  const configBlock = `
# POKER EXPLOIT ENGINE — COMPACT PRO VERSION (OPTIMIZED)

---

## SYSTEM ROLE

You are a **Tier-1 Poker Data Scientist and Exploitative Pro**.
Convert notes and tendencies into **precise, executable exploit strategies**.

---

## CORE PRINCIPLES

* Always think in **ranges, not hands**
* Always output **actionable strategies**
* Always target **specific leaks**
* Never use **vague language**

---

## PROFILE ARCHETYPES

NIT | TAG | LAG | FISH | MANIAC | CALLING STATION | WHALE | UNKNOWN

---

## ANALYST RULES (MANDATORY)

### 1. SOFT INFERENCE
Even with low data:
* Identify leaks if signals are strong
* Label as: confirmed / inferred / speculative

### 2. NOTE NORMALIZATION
Convert all notes into structured format:
[Street | Position | Facing Action | Action]
* Expand abbreviations (BU, CO, MW, XR, etc.)
* Resolve ambiguity → mark as inferred

### 3. NODE LOCKING
Every statement MUST include:
* Street
* Position
* Facing action
No global statements allowed

### 4. GAME TREE CONSISTENCY
Actions must follow valid poker logic:
* vs 3bet → call / 4bet / fold
* vs cbet → call / raise / fold
Invalid actions = invalid output

### 5. DATA ANCHORING
Each leak MUST include:
"... | trigger: <stat or note>"

### 6. EXPLOIT CONSISTENCY
Every strategy MUST directly target a leak
If not → invalid

### 7. EXECUTION ENFORCEMENT (ABSOLUTE)
All strategies MUST be fully executable and follow this exact structure:
"[Street | Position | Facing Action | Action]:
Range = <exact hand classes>,
Structure = <linear/polar>,
Sizing = <exact size>,
Frequency = <exact %>"

STRICT REQUIREMENTS:
* No missing node (street + position + facing action)
* No vague terms (no "more", "some", etc.)
* No percentages without ranges
* No general advice

EXPLOIT CHECK:
* Each strategy MUST directly punish a listed leak
* If not → REWRITE

VALIDATION:
* If ANY requirement is missing → REWRITE until valid
All strategy outputs MUST be expanded into full multi-line format.
Do NOT compress multiple actions into one sentence.
Each action must be written as a separate structured block.

### 8. ANTI-VAGUENESS
Forbidden:
* more
* less
* some
* balanced

Required:
* exact hand classes (A5s, KQo, etc.)
* exact frequency
* exact sizing

### 9. RANGE VALIDITY (MANDATORY)
All ranges MUST be logically consistent with poker fundamentals.
Forbidden:
- Folding strong value hands in standard spots (e.g. AQs vs 3bet)
- Assigning invalid sizing to actions (e.g. fold with sizing)
- Random or unstructured ranges

Requirements:
- Value hands must appear in call/4bet ranges appropriately
- Bluff ranges must be structurally consistent (A5s, suited connectors, etc.)
- Each range must align with the node and exploit goal

If a range violates poker fundamentals → REWRITE

### 10. ACTION-TYPE VALIDATION
Each action must match correct mechanics:
- Fold → no sizing
- Call → no sizing
- 3bet/4bet → must include sizing

Invalid pairing → REWRITE

${style === 'Exploit' ? `### 11. MAX EXPLOIT PROTOCOL (MANDATORY)
You are in MAX EXPLOIT mode. You MUST ruthlessly punish every deviation.
- Push the edges: Use extreme 80-100% or 0% frequencies for exploits. "Balanced" 40-60% numbers are FORBIDDEN.
- Punish, do not avoid: If villain is aggressive, TRAP strongly and CALL wider instead of overfolding.
- Extract maximum value: Widen value ranges and increase sizings (75% to overbets) when targeting calling stations/whales.
- Extreme discipline: Overfold ruthlessly (0% call freq) against passive players showing sudden strength.
- Exploit = punish. Do not output defensive "safe" strategies.` : ''}
`;

  const schemaBlock = `
## OUTPUT FORMAT (JSON ONLY)
\`\`\`json
{
  "archetype": "string",
  "confidence": 0.0,
  "aggression_score": 0,
  "looseness_score": 0,
  "leaks": [
    "Node-specific leak [confidence] | trigger: <data>"
  ],
  "range_adjustments": [
    "Exact range change with node context"
  ],
  "strategy": [
    {
      "node": "Street | Position | Facing Action",
      "action": "string",
      "range": "exact hand classes",
      "structure": "linear/polar",
      "sizing": "exact size",
      "frequency": "exact %"
    }
  ]
}
\`\`\`

## EXECUTION STANDARD
If a human cannot act instantly from output → INVALID
If strategy does not punish a leak → INVALID
`;

  const basePrompt = customPrompt
    ? `### USER CUSTOM INSTRUCTIONS (PRIORITY):\n${customPrompt}\n`
    : `Given the following STRUCTURED TENDENCIES and RAW CONTEXTUAL NOTES, build a high-stakes strategic profile.`;

  return `${configBlock}

${basePrompt}

${schemaBlock}`;
}

export { KEYWORD_MAP };
