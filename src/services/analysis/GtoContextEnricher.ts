import { ParsedHand } from '../../validators/hand.schema';
import { BoardBucketParser } from './context/BoardBucketParser';
import { prisma } from '../../lib/prisma';

export class GtoContextEnricher {
    /**
     * Extracts context and queries GTO database to build a RAG baseline.
     */
    public static async enrich(parsedHand: ParsedHand): Promise<{
        gtoContext: string;
        warnings: string[];
    }> {
        const warnings: string[] = [];
        
        // 1. Check for multi-way
        // Find players who reached flop
        const preflop = parsedHand.actions?.preflop || [];
        const foldedBeforeFlop = new Set(preflop.filter(a => a.action?.toLowerCase() === 'fold').map(a => a.player));
        
        let activePlayers: string[] = [];
        if (parsedHand.players) {
            activePlayers = parsedHand.players.map(p => p.name).filter(n => !foldedBeforeFlop.has(n));
        }

        // Check showdown/street actions if players array is missing
        if (activePlayers.length === 0) {
            const flopActors = new Set((parsedHand.actions?.flop || []).map(a => a.player));
            if (flopActors.size > 0) activePlayers = Array.from(flopActors);
        }

        if (activePlayers.length > 2) {
            warnings.push(`MULTIW_POT: Phát hiện Multi-way pot (${activePlayers.length} người). GTO RAG yêu cầu dữ liệu Heads-up nên sẽ bị tắt để tránh AI bị nhiễu.`);
            return { gtoContext: '', warnings };
        }

        if (activePlayers.length < 2) {
            return { gtoContext: '', warnings }; // Everyone folded preflop or parse failed
        }

        // 2. Identify Positions (IP and OOP)
        // Try mapping them into [BTN_vs_BB, SB_vs_BB, CO_vs_BTN]
        const playerPositions = parsedHand.players.reduce((acc, p) => {
            if (p.name && p.position) acc[p.name] = p.position.toUpperCase();
            return acc;
        }, {} as Record<string, string>);

        let p1Pos = playerPositions[activePlayers[0]] || '';
        let p2Pos = playerPositions[activePlayers[1]] || '';

        // If positions are missing, we can't reliably map to GTO spot
        if (!p1Pos || !p2Pos) {
             // Let's try to extract from actions
             const preflopActs = parsedHand.actions?.preflop || [];
             for (const a of preflopActs) {
                 if (a.player === activePlayers[0] && a.position) p1Pos = a.position.toUpperCase();
                 if (a.player === activePlayers[1] && a.position) p2Pos = a.position.toUpperCase();
             }
        }

        if (!p1Pos || !p2Pos) {
            warnings.push("MISSING_POS: Không xác định được vị trí (Position) của 2 người chơi. Bỏ qua RAG GTO.");
            return { gtoContext: '', warnings };
        }

        // Standardize positions
        const posOrder = ['SB', 'BB', 'UTG', 'MP', 'HJ', 'CO', 'BTN'];
        const p1Idx = posOrder.indexOf(p1Pos);
        const p2Idx = posOrder.indexOf(p2Pos);

        let oop = '', ip = '';
        if (p1Idx !== -1 && p2Idx !== -1) {
            if (p1Idx < p2Idx) { oop = p1Pos; ip = p2Pos; }
            else { oop = p2Pos; ip = p1Pos; }
        } else {
            // Fallback heuristics
            oop = p1Pos; ip = p2Pos;
        }

        // Map to 3 standard spots: BTN_vs_BB | SB_vs_BB | CO_vs_BTN
        let spotKey = '';
        if (oop === 'SB' && ip === 'BB') {
            spotKey = 'SB_vs_BB';
        } else if (oop === 'BB' && ['BTN', 'CO', 'MP', 'HJ', 'UTG'].includes(ip)) {
             // In actual postflop, BB is OOP vs everyone except SB
            spotKey = 'BTN_vs_BB'; 
        } else if (['UTG', 'MP', 'HJ', 'CO'].includes(oop) && ip === 'BTN') {
            spotKey = 'CO_vs_BTN';
        } else {
            // Generic fallback
            spotKey = 'BTN_vs_BB';
        }

        // 3. Extract Board Bucket
        const flopCards = (parsedHand.board || []).slice(0, 3);
        if (flopCards.length < 3) {
            return { gtoContext: '', warnings }; // Preflop
        }

        const bucketResult = BoardBucketParser.categorize(flopCards);
        // Map detailed bucket to simple bucket format for GtoSpot DB, e.g. "A_dry", "K_dry"...
        let boardBucket = '';
        if (bucketResult.highCardTier === 'ACE_HIGH') {
            if (bucketResult.suitedness === 'MONOTONE') boardBucket = 'monotone_A';
            else if (bucketResult.suitedness === 'TWO_TONE') boardBucket = 'two_tone_A';
            else if (bucketResult.connectivity === 'CONNECTED' || bucketResult.connectivity === 'SEMI_CONNECTED') boardBucket = 'ace_wet';
            else boardBucket = 'A_dry';
        } else if (bucketResult.highCardTier === 'KING_HIGH') {
            if (bucketResult.suitedness === 'TWO_TONE') boardBucket = 'two_tone_K';
            else boardBucket = 'K_dry';
        } else if (bucketResult.highCardTier === 'QUEEN_HIGH') {
             boardBucket = 'Q_dry';
        } else if (bucketResult.highCardTier === 'JACK_HIGH') {
             boardBucket = 'broadway_wet';
        } else {
             // LOW_BOARD or UNKNOWN
             if (bucketResult.pairedStatus !== 'UNPAIRED') boardBucket = 'paired_low';
             else if (bucketResult.suitedness === 'MONOTONE') boardBucket = 'monotone_low';
             else if (bucketResult.suitedness === 'TWO_TONE') boardBucket = 'two_tone_low';
             else if (bucketResult.connectivity === 'CONNECTED') boardBucket = 'connected_mid'; // Or connected_low
             else boardBucket = 'low_dry';
        }

        // @ts-ignore - Prisma Client cache issue
        const gtoSpot = await prisma.gtoSpot.findFirst({
            where: {
                position: spotKey,
                board_bucket: boardBucket,
                street: 'flop'
            }
        });

        if (!gtoSpot) {
            warnings.push(`MISSING_GTO: Không tìm thấy data giải trong CSDL cho spot ${spotKey} board ${boardBucket}. Sử dụng AI baseline.`);
            return { gtoContext: '', warnings };
        }

        // 4. Build Context String
        const contextString = `
[GTO REFERENCE DB]
Spot Match: ${spotKey}
Board Bucket: ${boardBucket}
Flop Texture: ${flopCards.join(' ')}

Baseline Strategy (Mathematical Solver Data):
OOP Strategy: Check ${(gtoSpot.oop_check * 100).toFixed(1)}%, Bet Small ${(gtoSpot.oop_bet_small * 100).toFixed(1)}%, Bet Big ${(gtoSpot.oop_bet_big * 100).toFixed(1)}%
IP Strategy: Check ${(gtoSpot.ip_check * 100).toFixed(1)}%, Bet Small ${(gtoSpot.ip_bet_small * 100).toFixed(1)}%, Bet Big ${(gtoSpot.ip_bet_big * 100).toFixed(1)}%

Use these percentages as the absolute mathematically optimal foundation. Any deviation must be justified as an explicit exploit!
`;

        return { gtoContext: contextString, warnings };
    }
}
