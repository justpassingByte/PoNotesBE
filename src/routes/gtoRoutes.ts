import { Router } from 'express';
import { GtoController } from '../controllers/GtoController';

const router = Router();

/**
 * GET /api/gto/strategy
 * Query GTO strategy data from database
 * 
 * Query params:
 *   position     - BTN_vs_BB | SB_vs_BB | CO_vs_BTN (required)
 *   board_bucket - A_dry | K_dry | ... (required)
 *   street       - flop | turn | river (required)
 *   action_line  - cbet33_call | cbet75_call | xx (required for turn/river)
 *   turn_type    - blank | overcard | board_pair | ... (required for turn/river)
 *   river_type   - blank | overcard | board_pair | flush_card (required for river)
 *   hand_class   - top_pair | flush_draw | ... (optional, filter hands)
 *   player       - oop | ip (optional, filter by player)
 */
router.get('/strategy', GtoController.getStrategy);

/**
 * POST /api/gto/ask
 * Natural language poker question → LLM parse → GTO result
 * Body: { question: "Board As 7d 2c, BB cầm AcKd, BTN cbet 33%..." }
 */
router.post('/ask', GtoController.ask);

/**
 * POST /api/gto/feedback
 * Submit RLHF feedback for an AI response
 */
router.post('/feedback', GtoController.submitFeedback);

/**
 * GET /api/gto/buckets
 * List all available board buckets and their metadata
 */
router.get('/buckets', GtoController.getBuckets);

/**
 * GET /api/gto/stats
 * Get summary statistics (total spots, hands, etc.)
 */
router.get('/stats', GtoController.getStats);

export { router as gtoRoutes };
