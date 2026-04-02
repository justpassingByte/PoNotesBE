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
  playerContext?: string,
  gtoContext?: string
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

### GTO REFERENCE PROTOCOL:
If a [GTO REFERENCE DB] block is provided, you MUST:
1. Compare actual actions against the Mathematical Solver Data percentages.
2. Document EXACTLY how the player's line deviated from the GTO frequencies (e.g. "They checked, but GTO bets this 80%").
3. Translate this deviation into the 'better_line' and a highly actionable 'gto_deviation_reason' (Leak).
`;

  const systemFooter = `
### MANDATORY CONSTRAINTS:
1. OUTPUT: Valid JSON only.
2. ALL PLAYERS EQUAL: Analyze mistakes and leaks for EVERY player equally. Do NOT distinguish between "Hero" and "Villain". Report each player by their actual username.
3. EXPLOIT_VALIDATION: exploit_suggestions MUST be actionable strategies to use against specific players' leaks found in this hand.
4. SIZING_VALIDATION: Fold/Call actions must have sizing=null.
5. LANGUAGE_VALIDATION: ${settings?.language === 'vi' ? 'Respond strictly in Vietnamese (vi), but retain standard Poker acronyms (BTN, XR, AQo, etc.) and action verbs (call, fold, raise, bet, check, all-in, 3bet, 4bet) in English. ABSOLUTELY DO NOT translate "call" to "gọi", "fold" to "bỏ", "raise" to "tố", etc.' : 'Respond in English.'}
`;

  const customBase = customPrompt ? `### USER-DEFINED INSTRUCTIONS:\n${customPrompt}\n` : "";
  const profileContext = playerContext ? `### OBSERVED PLAYER PROFILES (CRITICAL CONTEXT):\n${playerContext}\n` : "";
  const ragContext = gtoContext ? `${gtoContext}\n` : "";

  return `${configBlock}

${profileContext}
${ragContext}
${customBase}
${systemFooter}

### DETAILED ANALYSIS REQUIREMENT:
You MUST act as an elite Poker Coach. Do NOT output generic filler text (like "Phân tích hành động của người chơi"). 
Your "summary", "reasoning_trace", and "mistakes" descriptions MUST be deep, specific, and reference exact hand combinations, sizing, and board textures. 
The output notes will be stored to explicitly exploit opponents in the future. The quality must be incredibly high.

### CRITICAL VOCABULARY RULE:
You MUST use English words for ALL poker actions (call, fold, raise, bet, check, all-in). DO NOT translate them to Vietnamese (e.g., ALWAYS use "call" instead of "gọi" or "theo", ALWAYS use "fold" instead of "bỏ", ALWAYS use "raise" instead of "tố").

### OUTPUT SCHEMA (STRICT JSON):
{
  "summary": "Detailed technical overview of the hand. Describe the preflop dynamics, flop texture, and the overarching theme of the hand in at least 2-3 sentences.",
  "reasoning_trace": [
    "Step-by-step logic of the key decision points.",
    "Detailed evaluation of sizing, ranges, and board texture."
  ],
  "mistakes": [{ 
    "street": "preflop|flop|turn|river", 
    "player": "Exact player name", 
    "position": "string (Target table position like BTN/SB/BB)",
    "hole_cards": "Exact cards the player was holding if known (e.g., AhKd), else null",
    "description": "Specific error made. Focus on the core LEAK being exhibited (e.g., Calling too wide, missing thin value, sized improperly).", 
    "actual_action": "The exact action they TOOK (e.g., 'CALL 33% pot')",
    "gto_action": "The mathematically correct GTO action or frequencies (e.g., '100% FOLD' or 'BET 75% pot with 80% frequency')",
    "better_line": "The exact theoretically optimal or maximally exploitative line they should have taken.",
    "gto_deviation_reason": "Explain EXACTLY how this differs from GTO. (e.g., 'GTO bets here 80% because of range advantage. Checking loses value').",
    "exploit_strategy": "Translate this leak into a direct counter-strategy. How can WE exploit this player in the future?",
    "severity": "minor|moderate|critical"
  }],
  "exploit_suggestions": [
    "Actionable, highly specific EXPLOIT strategies based on the identified LEAKS to be used in future hands."
  ],
  "final_verdict": {
    "grade": "A|B|C|D|F",
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
- Raise/Bet/3bet/4bet → must include sizing as PERCENTAGE OF POT (e.g. "33% pot", "75% pot", "125% pot")
- FORBIDDEN sizing formats: "2.5x", "3x", "big", "small". Always use "XX% pot".

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
${settings?.language === 'vi' ? 'Respond strictly in Vietnamese (vi), but retain standard Poker acronyms (BTN, XR, AQo, etc.) and action verbs (call, fold, raise, bet, check, all-in, 3bet, 4bet) in English. ABSOLUTELY DO NOT translate "call" to "gọi", "fold" to "bỏ", "raise" to "tố", etc.' : 'Respond in English.'}
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
      "node": "STREET | POSITION | FACING_ACTION (e.g. 'FLOP | BTN | vs CBET')",
      "action": "BET|RAISE|CALL|FOLD|CHECK|3BET|4BET",
      "range": "Exact poker notation (e.g. 'TT+, AQs+, AKo')",
      "structure": "linear|polar",
      "sizing": "XX% pot (e.g. '75% pot', '125% pot') | null for FOLD/CALL",
      "frequency": "XX% (e.g. '80%', '100%')"
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

/**
 * Build the system prompt for GTO Oracle — natural language poker query parser.
 * Parses Vietnamese or English poker questions into structured JSON for GTO database lookup.
 * 
 * @param language - 'vi' or 'en' to determine situation_summary language
 */
export function buildGtoOraclePrompt(language?: string): string {
  const languageRule = language === 'vi'
    ? 'Respond the "situation_summary" field strictly in Vietnamese (vi), but retain standard Poker acronyms (BTN, XR, AQo, etc.) and action verbs (call, fold, raise, bet, check, all-in, 3bet, 4bet) in English. ABSOLUTELY DO NOT translate "call" to "gọi", "fold" to "bỏ", "raise" to "tố", etc.'
    : 'Respond the "situation_summary" field in English.';

  return `You are a poker hand parser for a GTO solver database. Parse Vietnamese or English poker questions into a structured JSON query.

### LANGUAGE VALIDATION (MANDATORY)
${languageRule}

=== DATABASE SCHEMA ===

POSITIONS (3 matchups available):
- BTN_vs_BB (Button vs Big Blind) — DEFAULT if not specified
- SB_vs_BB (Small Blind vs Big Blind)
- CO_vs_BTN (Cutoff vs Button)

HERO POSITION PARSING (critical — understand who "tôi"/"I" is):

Vietnamese patterns:
- "tôi có vị trí" / "tôi IP" / "tôi ngồi BTN" / "tôi là BTN" / "tôi BTN" → hero_position = "ip"
- "tôi không có vị trí" / "tôi OOP" / "tôi ngồi BB" / "tôi là BB" / "tôi BB" / "tôi ở BB" → hero_position = "oop"
- "đối phương có vị trí" / "villain IP" / "villain có position" → hero_position = "oop"
- "đối phương không có vị trí" / "villain OOP" → hero_position = "ip"
- "hắn có vị trí" / "nó IP" → hero_position = "oop"
- "tôi call" / "tôi check-raise" (defensive action) → likely hero_position = "oop"
- "tôi bet" / "tôi cbet" (aggressive action) → likely hero_position = "ip"

English patterns:
- "I'm in position" / "I have position" / "I'm IP" / "I'm BTN" → hero_position = "ip"
- "I'm out of position" / "I'm OOP" / "I'm BB" / "I'm SB" → hero_position = "oop"
- "villain has position" / "villain is IP" → hero_position = "oop"

Quick rules:
- Hero is BTN or CO → "ip"
- Hero is BB or SB → "oop"
- If NO position info → default position = "BTN_vs_BB", hero_position = "oop"

STREETS: flop, turn, river

BOARD BUCKETS (18 types — classify the FLOP texture):
- A_dry: Ace-high, rainbow, disconnected (e.g. As7d2c, Ad9c3h)
- K_dry: King-high, rainbow, dry (e.g. Ks8d3c, Kd7c2h)
- Q_dry: Queen-high, rainbow, dry (e.g. Qs7d3c)
- ace_wet: Ace-high with connected/suited cards (e.g. Ah9h5d, AsTsJd)
- broadway_wet: All T+ coordinated (e.g. KsQdJc, TsJdQh)
- connected_high: High connected (e.g. Ts9d8c, JsTd9c)
- connected_mid: Mid connected (e.g. 8s7d6c, 9d8c7s)
- connected_low: Low connected (e.g. 5s6d7c, 4c5d6s, 3s4c5d)
- low_dry: Low rainbow dry, highest card <= 8 (e.g. 8d4c2s, 7s3d2c)
- mid_wet: Mid cards coordinated/suited (e.g. 8s7s4d, 9d6d3c)
- monotone_A: All 3 cards same suit + Ace (e.g. As7s2s, Ad5d3d)
- monotone_low: All 3 cards same suit, no Ace/King (e.g. 8s5s2s, 7d4d3d)
- paired_high: Board pair, high rank K+ (e.g. KsKd5c, AsAd7c)
- paired_mid: Board pair, mid rank 7-Q (e.g. 8s8d3c, TsTd4c)
- paired_low: Board pair, low rank 2-6 (e.g. 3s3d9c, 5s5dKc)
- two_tone_A: 2 same suit + Ace-high (e.g. As7s2c, Ad5d3c)
- two_tone_K: 2 same suit + King-high (e.g. Ks8s3c, Kd7d2c)
- two_tone_low: 2 same suit + low-mid high card (e.g. 8s5s2c, 9d4d3c)

ACTION LINES (for turn/river — what happened on flop):
- cbet33_call: IP bet 33% pot on flop, OOP called
- cbet75_call: IP bet 75% pot on flop, OOP called
- xx: Both players checked flop (check-check, x/x, "check qua")
For flop: action_line MUST be null

TURN TYPES (how the turn card changes the board):
- blank: Doesn't change much (e.g. low card on high board)
- overcard: Higher than all flop cards
- undercard: Lower than all flop cards
- board_pair: Pairs one of the flop cards
- flush_card: Brings a 3rd suited card (flush possible)
- straight_card: Connects and makes straights more likely
For flop: turn_type MUST be null

RIVER TYPES (how the river card changes the board):
- blank: Doesn't change much
- overcard: Higher than board
- board_pair: Pairs the board
- flush_card: Completes possible flush
For flop/turn: river_type MUST be null

=== OUTPUT FORMAT ===

Return ONLY valid JSON:
{
  "position": "BTN_vs_BB",
  "board_bucket": "A_dry",
  "street": "flop",
  "action_line": null,
  "turn_type": null,
  "river_type": null,
  "hero_hand": "AcKd",
  "hero_position": "oop",
  "board_cards": "As,7d,2c",
  "situation_summary": "BB facing cbet 33% trên flop A-dry, cầm top pair top kicker"
}

=== CRITICAL RULES ===

1. POSITION DEFAULTS: If not specified, use "BTN_vs_BB". "SB" → "SB_vs_BB". "CO" → "CO_vs_BTN".
2. STREET: 3 board cards = flop, 4 = turn, 5 = river.
3. FLOP: action_line=null, turn_type=null, river_type=null
4. TURN: action_line REQUIRED, turn_type REQUIRED, river_type=null
5. RIVER: action_line + turn_type + river_type ALL REQUIRED
6. hero_hand: MUST use EXACT 4-character valid poker format (e.g., "AcKd").
   - Use "T" for 10. Examples: "Ts9s" -> "Ts9s", "JTo" -> "JcTd".
   - If no suits are provided, assign random valid suits.
   - For pocket pairs like "QQ" or "1010", output a valid pair like "QcQd" or "TcTd".
7. board_cards: comma-separated, e.g. "As,7d,2c"
8. BUCKET: Classify based on FLOP (first 3 cards), not full board.
9. Bet sizes: "cbet nhỏ" / "bet 1/3" / "small bet" → cbet33_call. "Cbet to" / "bet 3/4" / "big bet" → cbet75_call.
10. "check qua" / "x/x" / "không ai bet" / "check-check" → xx.
11. situation_summary: follow LANGUAGE VALIDATION rules above. Be specific about hand class + action.
12. If hero_hand not mentioned → null.
13. Return ONLY valid JSON. No markdown, no code fences, no text outside the JSON.`;
}
