export interface ParsedTendency {
    category: string;
    subCategory?: string;
    action: string;
    potType?: string;
    strength: number; // 0-1
}

export class PokerNoteParser {
    /**
     * Parse professional shorthand poker notes into structured tendencies
     */
    static parse(content: string): ParsedTendency | null {
        const text = content.toLowerCase();

        // 1. PREFLOP AGGRESSION (e.g., "5bet shove", "3bp", "srp")
        if (text.includes('5bet') || text.includes('4bet')) {
            return { category: 'aggressive_preflop', action: 'heavy_aggression', strength: 0.95 };
        }
        if (text.includes('shove') || text.includes('all-in') || text.includes('allin')) {
            return { category: 'aggressive_preflop', action: 'shove', strength: 0.9 };
        }
        if (text.includes('3bp') || text.includes('3-bet pot')) {
            if (text.includes('call') && text.includes('xr')) 
                return { category: 'aggressive_postflop', action: 'check_raise', potType: '3bp', strength: 0.9 };
            if (text.includes('call')) 
                return { category: 'passive_preflop', action: 'call_3bet', potType: '3bp', strength: 0.6 };
        }

        // 2. POSTFLOP ACTION (e.g., "xraise", "xr", "fop", "flop")
        if (text.includes('xraise') || text.includes('xr') || text.includes('check raise')) {
            const potType = text.includes('3bp') ? '3bp' : 'srp';
            return { category: 'aggressive_postflop', action: 'check_raise', potType, strength: 0.85 };
        }
        if (text.includes('fop') || text.includes('flop')) {
            if (text.includes('call')) return { category: 'passive_postflop', action: 'call_flop', strength: 0.5 };
        }

        // 3. HAND SPECIFIC (e.g., "99", "78", "aq2", "33")
        if (/\b(99|88|77|66|55|44|33|22|aa|kk|qq|jj|tt)\b/.test(text)) {
            return { category: 'hand_strength', action: 'big_pair_play', strength: 0.7 };
        }
        if (/\b([akqjt2-9][hdsc][akqjt2-9][hdsc]|[akqjt2-9]{2})\b/.test(text)) {
            return { category: 'hand_strength', action: 'specific_holding', strength: 0.5 };
        }

        // 4. STICKINESS / CALLING (e.g., "call wide", "station")
        if (text.includes('call') || text.includes('sticky') || text.includes('hates folding')) {
            return { category: 'calling_station', action: 'overcall', strength: 0.7 };
        }

        // 4. POSITION SPECIFIC (e.g., "utg vs bu")
        if (text.includes('utg') || text.includes('bb') || text.includes('bu')) {
            return { category: 'positional_play', action: 'positional_engagement', strength: 0.4 };
        }

        return null;
    }
}
