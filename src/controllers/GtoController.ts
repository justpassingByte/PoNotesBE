import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { GtoPromptBuilder } from '../services/analysis/GtoPromptBuilder';
import { BoardBucketParser } from '../services/analysis/context/BoardBucketParser';
import { HandTransposer } from '../services/analysis/context/HandTransposer';

// Representative boards for each of the 18 GTO buckets
const GTO_REP_BOARDS: Record<string, string[]> = {
    "A_dry": ["As", "7d", "2c"],
    "K_dry": ["Ks", "8d", "3c"],
    "Q_dry": ["Qs", "7d", "2c"],
    "ace_wet": ["As", "9s", "8c"],
    "broadway_wet": ["Ks", "Qs", "Jc"],
    "connected_high": ["Ks", "Qd", "Jc"],
    "connected_mid": ["Ts", "9d", "8c"],
    "connected_low": ["7s", "6d", "5c"],
    "low_dry": ["8s", "4d", "2c"],
    "mid_wet": ["Js", "9s", "7c"],
    "monotone_A": ["As", "7s", "2s"],
    "monotone_low": ["Ts", "7s", "2s"],
    "paired_high": ["Ks", "Kd", "2c"],
    "paired_mid": ["9s", "9d", "3c"],
    "paired_low": ["5s", "5d", "2c"],
    "two_tone_A": ["As", "7s", "2c"],
    "two_tone_K": ["Ks", "8s", "3c"],
    "two_tone_low": ["8s", "4s", "2c"]
};

// ─── Helper: group hands and compute class summaries ────────────
function buildHandData(hands: any[], isFacing = false) {
  const grouped: Record<string, Record<string, any[]>> = { oop: {}, ip: {} };
  for (const h of hands) {
    if (!grouped[h.player]) grouped[h.player] = {};
    if (!grouped[h.player][h.hand_class]) grouped[h.player][h.hand_class] = [];
    if (isFacing) {
      grouped[h.player][h.hand_class].push({
        hand: h.hand,
        fold: h.fold,
        call: h.call,
        raise: h.raise,
      });
    } else {
      grouped[h.player][h.hand_class].push({
        hand: h.hand,
        check: h.check,
        bet_small: h.bet_small,
        bet_big: h.bet_big,
      });
    }
  }

  const classSummary: Record<string, Record<string, any>> = { oop: {}, ip: {} };
  for (const p of ['oop', 'ip']) {
    for (const [cls, arr] of Object.entries(grouped[p] || {})) {
      const list = arr as any[];
      const n = list.length;
      if (isFacing) {
        classSummary[p][cls] = {
          count: n,
          avg_fold:  +(list.reduce((s, h) => s + (h.fold  ?? 0), 0) / n).toFixed(4),
          avg_call:  +(list.reduce((s, h) => s + (h.call  ?? 0), 0) / n).toFixed(4),
          avg_raise: +(list.reduce((s, h) => s + (h.raise ?? 0), 0) / n).toFixed(4),
        };
      } else {
        classSummary[p][cls] = {
          count: n,
          avg_check:    +(list.reduce((s, h) => s + h.check, 0) / n).toFixed(4),
          avg_bet_small: +(list.reduce((s, h) => s + h.bet_small, 0) / n).toFixed(4),
          avg_bet_big:   +(list.reduce((s, h) => s + h.bet_big, 0) / n).toFixed(4),
        };
      }
    }
  }

  return { grouped, classSummary };
}

function spotToJson(spot: any) {
  return {
    id: spot.id,
    position: spot.position,
    board_bucket: spot.board_bucket,
    street: spot.street,
    action_line: spot.action_line,
    turn_type: spot.turn_type,
    river_type: spot.river_type,
    board: spot.board,
    pot: spot.pot,
    eff_stack: spot.eff_stack,
  };
}

function spotStrategy(spot: any) {
  const isFacing = spot.action_line?.includes('facing_');
  if (isFacing) {
    return {
      oop: { fold: spot.oop_fold, call: spot.oop_call, raise: spot.oop_raise },
    };
  }
  return {
    oop: { check: spot.oop_check, bet_small: spot.oop_bet_small, bet_big: spot.oop_bet_big },
    ip: { check: spot.ip_check, bet_small: spot.ip_bet_small, bet_big: spot.ip_bet_big },
  };
}

export class GtoController {

  /**
   * POST /api/gto/ask
   * Natural language → LLM parse → GTO query → full result
   */
  static async ask(req: Request, res: Response) {
    try {
      const { question, language } = req.body;
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'Missing "question" in request body' });
      }

      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
      }

      // Step 1: LLM parse via GtoPromptBuilder
      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: GtoPromptBuilder.buildSystemPrompt(language) },
            { role: 'user', content: GtoPromptBuilder.buildUserPrompt(question) },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!groqResp.ok) {
        const errText = await groqResp.text();
        return res.status(502).json({ error: `Groq API error: ${groqResp.status}`, details: errText });
      }

      const groqData = await groqResp.json();
      const llmText = groqData.choices?.[0]?.message?.content || '';

      console.log('\n--- GTO ORACLE LLM PARSING DEBUG ---');
      console.log('Query:', question);
      console.log('LLM Raw Output:', llmText);

      let parsed: any;
      try {
        parsed = GtoPromptBuilder.parseResponse(llmText);
        console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));
      } catch (parseErr: any) {
        console.error('Parse Error:', parseErr.message);
        return res.status(422).json({ error: parseErr.message, raw: llmText });
      }
      console.log('------------------------------------\n');

      // Step 2: Deterministic bucket mapping and hand transposition
      let boardBucket = parsed.board_bucket;
      let queryHand = parsed.hero_hand;
      let repBoardStr: string | null = null;

      if (parsed.board_cards && (parsed.board_bucket === 'auto' || !parsed.board_bucket)) {
          const cards = parsed.board_cards.split(',').map(c => c.trim());
          boardBucket = BoardBucketParser.getGtoBucketName(cards);
          
          const repBoard = GTO_REP_BOARDS[boardBucket];
          if (repBoard) {
              parsed.board_bucket = boardBucket; // Update the parsed object to display in GUI
              repBoardStr = repBoard.join(',');
              if (parsed.hero_hand) {
                  const suitMap = HandTransposer.createSuitMap(cards, repBoard);
                  queryHand = HandTransposer.transposeHand(parsed.hero_hand, suitMap);
                  console.log(`[GTO ORACLE] Transposed Hand: ${parsed.hero_hand} -> ${queryHand} for bucket ${boardBucket}`);
              }
          }
      }

      // Step 3: Query DB
      const spot = await (prisma as any).gtoSpot.findFirst({
        where: {
          position: parsed.position,
          board_bucket: boardBucket,
          board: repBoardStr || undefined, // Filter by rep board to avoid cross-board ambiguity
          street: parsed.street,
          action_line: parsed.action_line || null,
          turn_type: parsed.turn_type || null,
          river_type: parsed.river_type || null,
        },
      });

      if (!spot) {
        return res.status(404).json({
          error: 'Spot not found in GTO database',
          parsed,
          hint: `No data for ${parsed.position} / ${boardBucket} / ${parsed.street}` +
                (parsed.action_line ? ` / ${parsed.action_line}` : '') +
                (parsed.turn_type ? ` / ${parsed.turn_type}` : ''),
        });
      }

      // Step 4: Get hands
      const hands = await (prisma as any).gtoHand.findMany({
        where: { spot_id: spot.id },
        orderBy: [{ player: 'asc' }, { hand_class: 'asc' }, { hand: 'asc' }],
      });

      const isFacing = spot.action_line?.includes('facing_');
      const { grouped, classSummary } = buildHandData(hands, isFacing);

      // Step 5: Find hero hand
      let heroResult: any = null;
      if (queryHand) {
        const heroPlayer = parsed.hero_position || 'oop';
        for (const [cls, handList] of Object.entries(grouped[heroPlayer] || {})) {
          for (const h of (handList as any[])) {
            if (h.hand === queryHand) {
              heroResult = { ...h, hand: parsed.hero_hand, hand_class: cls }; // Map back to user's original hand name for UI
              break;
            }
          }
          if (heroResult) break;
        }

        // Graceful Fallback: The user's hand (e.g. Ts9s on Ks,8s,3c) is missing because the DB 
        // representative board (e.g. Ts,9d,8c) contains those cards, making the hand "blocked" in the DB tree.
        if (!heroResult && parsed.hero_hand_class && classSummary[heroPlayer]?.[parsed.hero_hand_class]) {
           const avg = classSummary[heroPlayer][parsed.hero_hand_class];
           if (isFacing) {
             heroResult = {
               hand: parsed.hero_hand,
               hand_class: parsed.hero_hand_class,
               fold: avg.avg_fold,
               call: avg.avg_call,
               raise: avg.avg_raise,
             };
           } else {
             heroResult = {
               hand: parsed.hero_hand,
               hand_class: parsed.hero_hand_class,
               check: avg.avg_check,
               bet_small: avg.avg_bet_small,
               bet_big: avg.avg_bet_big,
             };
           }
        }
      }

      // Step 6: Query Future Runouts (only for non-facing root spots)
      const futureRunouts: any[] = [];
      const isFacingSpot = spot.action_line?.includes('facing_');
      if (heroResult && !isFacingSpot) {
        if (parsed.street === 'turn' && parsed.action_line && parsed.turn_type) {
          const runoutSpots = await (prisma as any).gtoSpot.findMany({
            where: {
              position: parsed.position,
              board: repBoardStr || undefined,
              street: 'river',
              action_line: parsed.action_line,
              turn_type: parsed.turn_type,
            }
          });
          for (const rs of runoutSpots) {
             const futureHand = await (prisma as any).gtoHand.findFirst({
                where: { spot_id: rs.id, player: parsed.hero_position, hand: queryHand }
             });
             if (futureHand) {
                 futureRunouts.push({
                    runout_type: rs.river_type,
                    board: rs.board,
                    ...futureHand,
                    hand: parsed.hero_hand // Map back to original hand for UI
                 });
             }
          }
        } else if (parsed.street === 'flop') {
          let bestActionLine = 'xx';
          if (spot.ip_bet_big > spot.ip_bet_small && spot.ip_bet_big > spot.ip_check) {
            bestActionLine = 'cbet75_call';
          } else if (spot.ip_bet_small > spot.ip_check) {
            bestActionLine = 'cbet33_call';
          }
 
           const runoutSpots = await (prisma as any).gtoSpot.findMany({
             where: {
               position: parsed.position,
               board: repBoardStr || undefined,
               street: 'turn',
               action_line: bestActionLine,
             }
           });
           for (const rs of runoutSpots) {
              const futureHand = await (prisma as any).gtoHand.findFirst({
                 where: { spot_id: rs.id, player: parsed.hero_position, hand: queryHand }
              });
             if (futureHand) {
                 futureRunouts.push({
                    action_line: bestActionLine,
                    runout_type: rs.turn_type,
                    board: rs.board,
                    ...futureHand
                 });
             }
          }
        }
      }

      let log_id = null;
      try {
         const queryLog = await (prisma as any).gtoQueryLog.create({
            data: {
               user_id: (req as any).user?.id || null,
               board: parsed.board || "Unknown",
               position: parsed.position || "Unknown",
               hole_cards: parsed.hero_hand || "Unknown",
               action_history: parsed.action_line || null,
               ai_response: parsed
            }
         });
         log_id = queryLog.id;
      } catch (logErr) {
         console.warn("Error creating GtoQueryLog:", logErr);
      }

      return res.json({
        log_id,
        parsed,
        spot: spotToJson(spot),
        strategy: spotStrategy(spot),
        hero: heroResult,
        by_hand_class: classSummary,
        hands: grouped,
        future_runouts: futureRunouts,
      });
    } catch (error: any) {
      console.error('GtoController.ask error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/gto/strategy */
  static async getStrategy(req: Request, res: Response) {
    try {
      const { position, board_bucket, street, action_line, turn_type, river_type, hand_class, player } = req.query;

      if (!position || !board_bucket || !street) {
        return res.status(400).json({ error: 'Missing required params: position, board_bucket, street' });
      }

      const spot = await (prisma as any).gtoSpot.findFirst({
        where: {
          position: String(position),
          board_bucket: String(board_bucket),
          street: String(street),
          action_line: action_line ? String(action_line) : null,
          turn_type: turn_type ? String(turn_type) : null,
          river_type: river_type ? String(river_type) : null,
        },
      });

      if (!spot) return res.status(404).json({ error: 'Spot not found' });

      const handWhere: any = { spot_id: spot.id };
      if (hand_class) handWhere.hand_class = String(hand_class);
      if (player) handWhere.player = String(player);

      const hands = await (prisma as any).gtoHand.findMany({
        where: handWhere,
        orderBy: [{ player: 'asc' }, { hand_class: 'asc' }, { hand: 'asc' }],
      });

      const { grouped, classSummary } = buildHandData(hands);

      return res.json({
        spot: spotToJson(spot),
        strategy: spotStrategy(spot),
        by_hand_class: classSummary,
        hands: grouped,
      });
    } catch (error: any) {
      console.error('GtoController.getStrategy error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/gto/buckets */
  static async getBuckets(req: Request, res: Response) {
    try {
      const buckets = await (prisma as any).gtoSpot.groupBy({
        by: ['board_bucket', 'position'],
        _count: { id: true },
        orderBy: { board_bucket: 'asc' },
      });

      const result: Record<string, any> = {};
      for (const b of buckets) {
        if (!result[b.board_bucket]) result[b.board_bucket] = { positions: {}, total: 0 };
        result[b.board_bucket].positions[b.position] = b._count.id;
        result[b.board_bucket].total += b._count.id;
      }

      return res.json(result);
    } catch (error: any) {
      console.error('GtoController.getBuckets error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/gto/stats */
  static async getStats(req: Request, res: Response) {
    try {
      const [spotCount, handCount, streetCounts] = await Promise.all([
        (prisma as any).gtoSpot.count(),
        (prisma as any).gtoHand.count(),
        (prisma as any).gtoSpot.groupBy({ by: ['street'], _count: { id: true } }),
      ]);

      const classDistribution = await (prisma as any).gtoHand.groupBy({
        by: ['hand_class'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      return res.json({
        total_spots: spotCount,
        total_hands: handCount,
        by_street: Object.fromEntries(streetCounts.map((s: any) => [s.street, s._count.id])),
        by_hand_class: Object.fromEntries(classDistribution.map((c: any) => [c.hand_class, c._count.id])),
      });
    } catch (error: any) {
      console.error('GtoController.getStats error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  /** POST /api/gto/feedback */
  static async submitFeedback(req: Request, res: Response) {
    try {
      const { log_id, is_helpful, feedback_reason } = req.body;
      if (!log_id) return res.status(400).json({ error: "Missing log_id" });

      await (prisma as any).gtoQueryLog.update({
        where: { id: log_id },
        data: { 
          is_helpful, 
          feedback_reason 
        }
      });

      return res.json({ success: true, message: "Feedback submitted" });
    } catch (err: any) {
      console.error('submitFeedback error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
