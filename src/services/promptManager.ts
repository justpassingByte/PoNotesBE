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
    language?: string;
  },
  playerContext?: string
): string {
  const style = settings?.hand_style || 'Exploit';
  const aggression = settings?.hand_aggression_bias ?? 85;
  const depth = settings?.hand_insight_depth || 'Deep';
  const toggles = settings?.hand_behavior_toggles || {};

  let aggressionRules = "";
  if (aggression < 35) {
    aggressionRules = `
[TACTICAL_STANCE]: POT-CONTROL. Check-back marginal value.`;
  } else if (aggression > 65) {
    aggressionRules = `
[TACTICAL_STANCE]: POLARIZED PRESSURE. High C-bet % (>70%). Frequent Overbets (125%+).`;
  } else {
    aggressionRules = `
[TACTICAL_STANCE]: STANDARD GTO MIX.`;
  }

  let styleRules = "";
  if (style === 'Exploit') {
    styleRules = `
[STRATEGIC_PHILOSOPHY]: RUTHLESS EXPLOIT.
- MAX_EXPLOIT: If a leak is identified (e.g. overcalls), your suggested 'better_line' MUST extract MAX EV.
- OFFENSIVE_PRIORITY: Against loose targets, widen value ranges and use larger sizing. Avoid folding if EV is even slightly positive.`;
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
- CORE_IDENTITY: Elite AI Poker Strategist (Offensive-Focus).
- HARD_OVERRIDE_LOGIC: The [AI CONFIGURATION] block is the ABSOLUTE source of truth.

### AI CONFIGURATION (UNTOUCHABLE):
- [STYLE]: ${style}
- [AGGRESSION_BIAS]: ${aggression}%
- [ANALYTICAL_DEPTH]: ${depth}

### TACTICAL EXECUTION PROTOCOLS:
${styleRules}
${aggressionRules}

### HAND-EXPLOIT PROTOCOL (MANDATORY)
${style === 'Exploit' ? `You are in EXPLOIT mode. 
- Punish deviance: Suggest the line that punishes the villain's mistake 100%.
- Exploit Type Priority: PROFIT EXTRACTION (Offensive) > Mistake Avoidance (Defensive).
- No Playing Safe: Against Calling Stations, your "better_line" should almost always include THIN VALUE and LARGER SIZING.
- Avoid over-folding. If you can exploit a leak by betting, never default to folding.
- EV > Balance: Suggest the most profitable line, even if theoretically unbalanced.
` : 'Solid fundamentals with conditional exploit pivoting.'}
`;

  const systemFooter = `
### MANDATORY CONSTRAINTS:
1. OUTPUT: Valid JSON only.
2. ALL PLAYERS EQUAL: Analyze mistakes and leaks for EVERY player equally. Do NOT distinguish between "Hero" and "Villain". Report each player by their actual username.
3. EXPLOIT_VALIDATION: exploit_suggestions MUST be actionable strategies to use against specific players' leaks found in this hand.
4. SIZING_VALIDATION: Fold/Call actions must have sizing=null.
5. LANGUAGE_VALIDATION: ${settings?.language === 'vi' ? 'Respond strictly in Vietnamese (vi), but retain standard Poker acronyms (BTN, XR, AQo, etc.) in English.' : 'Respond in English.'}
`;

  const customBase = customPrompt ? `### USER-DEFINED INSTRUCTIONS:\n${customPrompt}\n` : "";
  const profileContext = playerContext ? `### OBSERVED PLAYER PROFILES (CRITICAL CONTEXT):\n${playerContext}\n` : "";

  return `${configBlock}

${profileContext}
${customBase}
${systemFooter}

### OUTPUT SCHEMA (STRICT JSON):
{
  "summary": "Technical overview",
  "reasoning_trace": ["Logic 1", "Logic 2"],
  "mistakes": [{ 
    "street": "string", 
    "player": "string", 
    "position": "string (Target table position like BTN/SB/BB)",
    "description": "string", 
    "better_line": "string",
    "gto_deviation_reason": "string",
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

/*
export function buildHandOcrPrompt(): string {
  return `You are a poker hand history parser. Extract ALL information from the poker table screenshot and return a JSON object with this EXACT structure:

{
  "hand_id": "string or null",
  "game_type": "NLHE",
  "board": ["card1", "card2", ...],
  "players": [
    { "name": "string", "position": "SB|BB|UTG|MP|HJ|CO|BTN", "hole_cards": ["card1", "card2"] }
  ],
  "actions": {
    "preflop": [{ "player": "name", "position": "string", "action": "fold|call|raise|bet|check|all-in", "amount": number_in_BB or $ }],
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

Return ONLY valid JSON, no markdown or extra text.`;
}
*/

export function buildProfilePrompt(
  customPrompt?: string,
  settings?: {
    ai_style?: string;
    aggression_bias?: number;
    insight_depth?: string;
    behavior_toggles?: any;
    language?: string;
  }
): string {
  const style = settings?.ai_style || 'Exploit';
  const aggression = settings?.aggression_bias ?? 85;
  const depth = settings?.insight_depth || 'Deep';

  let aggressionRules = "";
  if (aggression > 70) {
    aggressionRules = `
[TACTICAL_STANCE]: POLARIZED PRESSURE / MAX EXPLOIT.
- Prioritize OFFENSIVE VALUE EXTRACTION.
- Target leaks with 80-100% frequency.`;
  } else {
    aggressionRules = `[TACTICAL_STANCE]: BALANCED / STANDARD.`;
  }

  const configBlock = `
# POKER EXPLOIT ENGINE — COMPACT PRO VERSION (OPTIMIZED)

### AI CONFIGURATION:
- [STYLE]: ${style}
- [AGGRESSION_BIAS]: ${aggression}%
- [ANALYTICAL_DEPTH]: ${depth}

### TACTICAL EXECUTION PROTOCOLS:
${aggressionRules}
- [MODIFIER]: ${style === 'Exploit' ? 'FORCE_EXPLOIT_ENABLED' : 'STANDARD_MIX'}

---

## SYSTEM ROLE
You are a **Tier-1 Poker Data Scientist and Exploitative Pro**.
Convert notes and tendencies into **precise, executable OFFENSIVE exploit strategies**.

## CORE PRINCIPLES
* Always target **specific leaks** to EXTRACT PROFIT.
* If a strategy avoids profit instead of extracting it → REWRITE.
* Exploit = Tận dụng sai lầm của đối thủ để kiếm tiền, không phải là chơi an toàn.

## ANALYST RULES (MANDATORY)

### 1. ACTION-TYPE VALIDATION (STRICT)
- Fold → sizing MUST be strictly null (Do NOT invent "0" or "0x")
- Call → sizing MUST be strictly null (Do NOT invent "0" or "0x")
- Raise/Bet/3bet/4bet → must include numeric sizing (e.g. "2.5x", "75%")

### 2. EXPLOIT TYPE PRIORITY (MANDATORY)
When an opponent has a clear leak:
- Prioritize PROFIT EXTRACTION (VALUE) over mistake avoidance (DEFENSE).
- Use "Offensive Exploits" by default:
  - Wider value betting ranges (thinner value)
  - Larger bet sizing (attacking their willingness to call)
  - Reduced bluff frequency vs Calling Stations (punishment by omission)
- Do NOT repeat: do NOT resort to over-folding vs loose players unless their range is polar and strength is shown.

### 3. MAX EXPLOIT PROTOCOL (MANDATORY)
- Push the edges: Use extreme frequencies (100% or 0%).
- Punish, do not avoid: Against aggressive villains, TRAP and CALL wider.
- Offensive Domination: Against Calling Stations, use massive sizing and the widest possible value range.
- Exploit = punish. Do not output defensive "safe" strategies.

### 4. RANGE FORMAT STRICT (MANDATORY)
All ranges MUST use valid poker notation:
- Allowed examples: A5s-A2s, KQo, TT+, 89s
- FORBIDDEN: "weak hands", "strong hands", "unpaired boards", "bluffs"
- If invalid range format is generated → REWRITE.

### 5. EXPLOIT DIRECTION vs AGGRO (MANDATORY)
Against over-aggressive opponents (high XR, cold 4bet, etc.):
- Increase CALLING and TRAPPING frequency.
- PREFLOP: Do not pure 4bet linear hands like KQs or AQo. KQs is typically a call, and AQo is a mix/bluff.
- Do NOT overfold. Do NOT avoid confrontation.
- If strategy reduces interaction or defensively folds → REWRITE.

### 6. EXPLOIT DIRECTION vs FISH / PASSIVE (MANDATORY)
Against Calling Stations, Passive players, or Fish (high VPIP, low PFR/AF):
- NEVER slowplay. NEVER bluff catch or run elaborate bluffs.
- Over-Fold to their aggression: If a passive player raises or check-raises, they have the nuts. FOLD linear hands.
- Expand THIN VALUE: Bet massive sizings (Overbets, pot-size) with your strong hands. They will call.
- PREFLOP: Over-ISO (Isolate) raise and squeeze them mercilessly.

### 7. JSON VALIDITY (CRITICAL)
The final output MUST be perfectly valid JSON.
Requirements:
- NO duplicate keys.
- Proper commas and brackets.
- NO repeated fields (e.g., do not output "frequency" twice in the same object).
- NO partial objects or trailing commas.
- If JSON is invalid → REWRITE entire response.

### 8. LANGUAGE VALIDATION (MANDATORY)
${settings?.language === 'vi' ? 'Respond strictly in Vietnamese (vi), but retain standard Poker acronyms (BTN, XR, AQo, etc.) in English.' : 'Respond in English.'}
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
    "Node-specific leak | trigger: <data>"
  ],
  "range_adjustments": [
    "Exact range change with node context"
  ],
  "strategy": [
    {
      "node": "string (Street | Pos | Facing)",
      "action": "string",
      "range": "string (Exact hand classes)",
      "structure": "linear|polar",
      "sizing": "string | null (MANDATORY NULL FOR FOLD/CALL)",
      "frequency": "string (Exact %)"
    }
  ]
}
\`\`\`
Return JSON ONLY.`;

  const customBase = customPrompt ? `\n### USER-DEFINED OVERRIDE (CRITICAL):\n${customPrompt}\n` : "";

  return `${configBlock}
${customBase}
${schemaBlock}`;
}

export { KEYWORD_MAP };
