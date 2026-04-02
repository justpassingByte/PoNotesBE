import { ParsedHand } from '../../validators/hand.schema';
import { BoardBucketParser } from './context/BoardBucketParser';
import { prisma } from '../../lib/prisma';

export class GtoContextEnricher {
    /**
     * Extracts context and queries GTO database to build a RAG baseline.
     * Supports:
     *   - Flop root spot (OOP check/bet vs IP check/bet)
     *   - Flop facing c-bet spot (OOP fold/call/raise when IP bets)
     */
    public static async enrich(parsedHand: ParsedHand): Promise<{
        gtoContext: string;
        warnings: string[];
    }> {
        const warnings: string[] = [];

        // 1. Check for multi-way
        const preflop = parsedHand.actions?.preflop || [];
        const foldedBeforeFlop = new Set(preflop.filter(a => a.action?.toLowerCase() === 'fold').map(a => a.player));

        let activePlayers: string[] = [];
        if (parsedHand.players) {
            activePlayers = parsedHand.players.map(p => p.name).filter(n => !foldedBeforeFlop.has(n));
        }

        if (activePlayers.length === 0) {
            const flopActors = new Set((parsedHand.actions?.flop || []).map(a => a.player));
            if (flopActors.size > 0) activePlayers = Array.from(flopActors);
        }

        if (activePlayers.length > 2) {
            warnings.push(`MULTIW_POT: Phát hiện Multi-way pot (${activePlayers.length} người). GTO RAG yêu cầu dữ liệu Heads-up nên sẽ bị tắt để tránh AI bị nhiễu.`);
            return { gtoContext: '', warnings };
        }

        if (activePlayers.length < 2) {
            return { gtoContext: '', warnings };
        }

        // 2. Identify Positions (IP and OOP)
        const playerPositions = parsedHand.players.reduce((acc, p) => {
            if (p.name && p.position) acc[p.name] = p.position.toUpperCase();
            return acc;
        }, {} as Record<string, string>);

        let p1Pos = playerPositions[activePlayers[0]] || '';
        let p2Pos = playerPositions[activePlayers[1]] || '';

        if (!p1Pos || !p2Pos) {
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

        const posOrder = ['SB', 'BB', 'UTG', 'MP', 'HJ', 'CO', 'BTN'];
        const p1Idx = posOrder.indexOf(p1Pos);
        const p2Idx = posOrder.indexOf(p2Pos);

        let oop = '', ip = '';
        if (p1Idx !== -1 && p2Idx !== -1) {
            if (p1Idx < p2Idx) { oop = p1Pos; ip = p2Pos; }
            else { oop = p2Pos; ip = p1Pos; }
        } else {
            oop = p1Pos; ip = p2Pos;
        }

        let spotKey = '';
        if (oop === 'SB' && ip === 'BB') {
            spotKey = 'SB_vs_BB';
        } else if (oop === 'BB' && ['BTN', 'CO', 'MP', 'HJ', 'UTG'].includes(ip)) {
            spotKey = 'BTN_vs_BB';
        } else if (['UTG', 'MP', 'HJ', 'CO'].includes(oop) && ip === 'BTN') {
            spotKey = 'CO_vs_BTN';
        } else {
            spotKey = 'BTN_vs_BB';
        }

        // 3. Extract Board Bucket
        const flopCards = (parsedHand.board || []).slice(0, 3);
        if (flopCards.length < 3) {
            return { gtoContext: '', warnings };
        }

        const bucketResult = BoardBucketParser.categorize(flopCards);
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
            if (bucketResult.pairedStatus !== 'UNPAIRED') boardBucket = 'paired_low';
            else if (bucketResult.suitedness === 'MONOTONE') boardBucket = 'monotone_low';
            else if (bucketResult.suitedness === 'TWO_TONE') boardBucket = 'two_tone_low';
            else if (bucketResult.connectivity === 'CONNECTED') boardBucket = 'connected_mid';
            else boardBucket = 'low_dry';
        }

        // 4. Detect flop scenario from actual hand actions
        const flopActions = parsedHand.actions?.flop || [];
        const flopPot = parsedHand.pot ?? 5.5; // pot at start of flop in BB
        const facingCbetSize = detectFacingCbet(flopActions, flopPot);

        // 5. Query root spot (check/bet strategy)
        // @ts-ignore - Prisma Client cache issue
        const rootSpot = await prisma.gtoSpot.findFirst({
            where: {
                position: spotKey,
                board_bucket: boardBucket,
                street: 'flop',
                action_line: null,
            }
        });

        // 6. Query facing c-bet spot if applicable
        let facingSpot: any = null;
        if (facingCbetSize) {
            const actionLine = facingCbetSize === 'small' ? 'facing_cbet33' : 'facing_cbet75';
            // @ts-ignore
            facingSpot = await prisma.gtoSpot.findFirst({
                where: {
                    position: spotKey,
                    board_bucket: boardBucket,
                    street: 'flop',
                    action_line: actionLine,
                }
            });
        }

        if (!rootSpot && !facingSpot) {
            warnings.push(`MISSING_GTO: Không tìm thấy data giải trong CSDL cho spot ${spotKey} board ${boardBucket}. Sử dụng AI baseline.`);
            return { gtoContext: '', warnings };
        }

        // 7. Build Context String
        const contextParts: string[] = [];
        contextParts.push(`[GTO REFERENCE DB]`);
        contextParts.push(`Spot Match: ${spotKey} | Board Bucket: ${boardBucket}`);
        contextParts.push(`Flop Texture: ${flopCards.join(' ')}`);
        contextParts.push('');

        // Root strategy (OOP's first decision)
        if (rootSpot) {
            contextParts.push(`--- OOP Flop Root Strategy (First Action) ---`);
            contextParts.push(`Check: ${pct(rootSpot.oop_check)}%  |  Bet Small (~33%): ${pct(rootSpot.oop_bet_small)}%  |  Bet Big (~75%): ${pct(rootSpot.oop_bet_big)}%`);
            contextParts.push('');
            contextParts.push(`--- IP Flop Strategy (After OOP Check) ---`);
            contextParts.push(`Check: ${pct(rootSpot.ip_check)}%  |  Bet Small (~33%): ${pct(rootSpot.ip_bet_small)}%  |  Bet Big (~75%): ${pct(rootSpot.ip_bet_big)}%`);
        }

        // Facing c-bet strategy (OOP's reaction)
        if (facingSpot) {
            const sizeLabel = facingCbetSize === 'small' ? '~33% pot' : '~75% pot';
            contextParts.push('');
            contextParts.push(`--- OOP vs IP Flop C-Bet (${sizeLabel}) - KEY SCENARIO ---`);
            contextParts.push(`Fold: ${pct(facingSpot.oop_fold)}%  |  Call: ${pct(facingSpot.oop_call)}%  |  Raise: ${pct(facingSpot.oop_raise)}%`);
            contextParts.push(`⚠️ Compare OOP's actual flop reaction against these GTO frequencies.`);
        }

        // --- Turn Context (Experimental) ---
        const turnActions = parsedHand.actions?.turn || [];
        if (turnActions.length > 0 && parsedHand.board && parsedHand.board.length >= 4) {
             const turnPot = parsedHand.pot || 5.5; // Would need exact pot tracking
             const turnFacing = detectFacingCbet(turnActions, turnPot);
             
             // Deduce flop action line base for turn prefix 
             let baseFlopAction = 'check_check';
             if (facingCbetSize === 'small') baseFlopAction = 'cbet33_call';
             else if (facingCbetSize === 'large') baseFlopAction = 'cbet75_call';

             if (turnFacing) {
                 const turnActionStr = turnFacing === 'small' ? 'facing_cbet33' : 'facing_cbet75';
                 const fullTurnActionLine = baseFlopAction === 'check_check' ? turnActionStr : `${baseFlopAction}_${turnActionStr}`;
                 
                 const turnSpotFacing: any = await prisma.gtoSpot.findFirst({
                     where: {
                         position: spotKey,
                         street: 'turn',
                         action_line: fullTurnActionLine
                     }
                 });

                 if (turnSpotFacing) {
                     contextParts.push('');
                     contextParts.push(`--- OOP vs IP Turn C-Bet (${turnFacing === 'small' ? '~33%' : '~75%'}) ---`);
                     contextParts.push(`Action Path: ${fullTurnActionLine}`);
                     contextParts.push(`Fold: ${pct(turnSpotFacing.oop_fold)}%  |  Call: ${pct(turnSpotFacing.oop_call)}%  |  Raise: ${pct(turnSpotFacing.oop_raise)}%`);
                 }
             } else {
                  // Turn root spot (OOP first action)
                  const turnSpotRoot: any = await prisma.gtoSpot.findFirst({
                     where: {
                         position: spotKey,
                         street: 'turn',
                         action_line: baseFlopAction
                     }
                  });
                  if (turnSpotRoot) {
                     contextParts.push('');
                     contextParts.push(`--- OOP Turn Root Strategy ---`);
                     contextParts.push(`Action Path: ${baseFlopAction}`);
                     contextParts.push(`Check: ${pct(turnSpotRoot.oop_check)}%  |  Bet: ${pct(turnSpotRoot.oop_bet_small)}%  |  Bet Big: ${pct(turnSpotRoot.oop_bet_big)}%`);
                  }
             }
        }

        contextParts.push('');
        contextParts.push(`Use these percentages as the absolute mathematically optimal foundation. Any deviation must be justified as an explicit exploit!`);

        return { gtoContext: contextParts.join('\n'), warnings };
    }
}

/** Format float as percentage string */
function pct(val: number | null | undefined): string {
    return ((val ?? 0) * 100).toFixed(1);
}

/**
 * Detect if OOP is facing a c-bet on a postflop street.
 * Returns 'small' | 'large' | null based on action sequence.
 * 
 * Works for Flop, Turn or River action arrays.
 */
function detectFacingCbet(
    streetActions: Array<{ player?: string; action?: string; amount?: number }>,
    pot: number = 5.5
): 'small' | 'large' | null {
    if (!streetActions || streetActions.length < 2) return null;

    const actions = streetActions.map(a => ({
        player: a.player,
        action: (a.action || '').toLowerCase(),
        amount: a.amount ?? 0,
    }));

    // Look for sequence: check → bet
    for (let i = 0; i < actions.length - 1; i++) {
        if (actions[i].action === 'check' && actions[i + 1].action === 'bet') {
            const betAmt = actions[i + 1].amount;
            if (betAmt > 0 && pot > 0) {
                // pot-relative threshold: < 50% pot = small (~33%), >= 50% = large (~75%)
                return (betAmt / pot) < 0.5 ? 'small' : 'large';
            }
        }
    }

    return null;
}

