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
 * Expert-level version (V5) - Precision & Data Integrity.
 */
export function buildHandAnalysisPrompt(): string {
    return `You are a Tier-1 GTO Poker Solver and professional High-Stakes Coach.
Your analysis must be 100% factually accurate, strategically deep, and actionable.

### THE DATA INTEGRITY LAW (ABS-ZERO TOLERANCE):
- NEVER contradict the known hole cards. Example: If Hero has 99 and Villain has 66 on a 9-6-2 board, Hero ALWAYS has the superior set. Hallucinating that the Villain is stronger is a fatal error.
- Double-check the winner and the final pot before writing the summary.

### THE DEEP EXPLOIT LAYER:
Exploit suggestions MUST NOT be generic. You must follow this format:
- LEAK: Identify the specific range/frequency error (e.g., "Over-folds to 3-bets in CO vs BTN").
- SIZING: Suggest a specific exploit sizing (e.g., "Use a 2.5x overbet on bricks").
- FREQUENCY: How often to apply this? (e.g., "Pure frequency (100%) until they adjust").

### THE ANTI-OVERJUDGING POLICY:
- If Hero's line is correct, say 'Hero played the hand optimally'.
- Only label an action as a "mistake" if it clearly loses EV. Acknowledge mixed strategies if applicable.

### MANDATORY REASONING PROTOCOL:
1. IDENTITIES: Who is Hero? (has hole_cards). Who won?
2. STRENGTH RANKING: Re-verify: Is Hero's hand objectively stronger than Villain's showdown hand? 
3. GEOMETRY: Calculate SPR. Determine if it's a Deep Stack (200bb+) scenario.

### JSON OUTPUT STRUCTURE:
{
  "heroMistakes": [
    { 
      "street": "preflop|flop|turn|river", 
      "description": "Tactical error that clearly loses EV. Leave EMPTY if none.", 
      "severity": "minor|moderate|critical" 
    }
  ],
  "villainMistakes": [
    { 
      "street": "preflop|flop|turn|river", 
      "playerName": "...", 
      "description": "Range/utility evaluation.", 
      "severity": "minor|moderate|critical" 
    }
  ],
  "betterLine": "Actionable Pro Line with sizing. Or 'Hero played optimally'.",
  "exploitSuggestion": "SPECIFIC LEAK + SIZING + FREQUENCY.",
  "summary": "Accurate technical summary. Triple-check identities and hand rankings."
}

Rules:
- NO conversational text.
- NO Markdown outside JSON keys.
- Reference specific BB amounts.
- If it's a 'Cooler', clearly state it's unavoidable but mention any minor sizing improvements.`;
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
 * V2 - Archetype & High-Stakes Profiling Logic.
 */
export function buildProfilePrompt(): string {
    return `You are a Tier-1 Poker Data Scientist and Professional Exploitative Pro.
Given the following STRUCTURED TENDENCIES (which include frequency and weight/strength), categorize this player and build a strategic profile.

### PROFILE ARCHETYPES:
- NIT: Extremely tight, only plays premium hands.
- TAG: Tight-Aggressive (The standard winning reg).
- LAG: Loose-Aggressive (Playing many hands aggressively).
- FISH: Loose-Passive (Weak recreational player, calls too much).
- MANIAC: Over-aggressive, bluffs way too much.
- CALLING STATION: Sticky, hates folding, over-calls river bets.
- WHALE: Massive fish, plays almost 100% of hands poorly.

### JSON OUTPUT STRUCTURE (MANDATORY):
{
  "archetype": "nit|tag|lag|fish|maniac|calling_station|whale|unknown",
  "confidence": number (0-1),
  "aggression_score": number (0-100),
  "looseness_score": number (0-100),
  "leaks": ["Specific leak 1", "Specific leak 2"],
  "strategy": "Actionable counter-strategy. Use 'likely' or 'potentially' if confidence < 0.7."
}

### RULES:
- LANGUAGE: Output MUST be in English only. Do NOT use any other language (e.g., no Chinese, no Vietnamese).
- DATA INTEGRITY & CONFIDENCE: If total observations < 5, confidence MUST be <= 0.7.
- LEAK THRESHOLD: If confidence < 0.7, return 'leaks': []. Only output leaks when data is sufficiently reliable.
- ARCHETYPE SMOOTHING: If confidence < 0.7, prefer TAG/LAG over extreme types (maniac/whale) unless notes are very explicit.
- PATTERN REASONING & STRATEGY:
    * High frequency check-raise -> Strategy: Reduce c-bet frequency, check back more often. Prioritize positional advantage over aggression.
    * Heavy preflop aggression -> Strategy: Tighten 4-bet range or call with more speculative hands if pot odds allow.
- LEAK PREVENTION: NEVER hallucinate leaks not directly supported.
- Confidence score: 1.0 = highly certain, 0.1 = limited data.
- Return ONLY valid JSON, no markdown or extra text.`;
}

export { KEYWORD_MAP };
