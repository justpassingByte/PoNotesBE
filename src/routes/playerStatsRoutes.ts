import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// GET /api/players/:playerId/stats — get stats for a player
router.get('/:playerId/stats', asyncErrorWrapper(async (req, res) => {
    const playerId = req.params.playerId as string;

    let stats = await prisma.playerStats.findUnique({
        where: { player_id: playerId }
    });

    // If no stats exist yet, return empty defaults
    if (!stats) {
        stats = {
            id: '',
            player_id: playerId,
            vpip: null,
            rfi: null,
            pfr: null,
            three_bet: null,
            fold_to_3bet: null,
            cbet: null,
            fold_to_cbet: null,
            wtsd: null,
            wsd: null,
            aggression_freq: null,
        };
    }

    res.json({ success: true, data: stats });
}));

// PUT /api/players/:playerId/stats — upsert stats for a player
router.put('/:playerId/stats', asyncErrorWrapper(async (req, res) => {
    const playerId = req.params.playerId as string;

    // Verify player exists
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
        return res.status(404).json({ success: false, error: 'Player not found' });
    }

    const {
        vpip, rfi, pfr, three_bet, fold_to_3bet,
        cbet, fold_to_cbet, wtsd, wsd, aggression_freq
    } = req.body;

    // Validate: all values must be null, undefined, or a number 0-100
    const fields = { vpip, rfi, pfr, three_bet, fold_to_3bet, cbet, fold_to_cbet, wtsd, wsd, aggression_freq };
    for (const [key, val] of Object.entries(fields)) {
        if (val !== null && val !== undefined) {
            const num = Number(val);
            if (isNaN(num) || num < 0 || num > 100) {
                return res.status(400).json({ success: false, error: `${key} must be a number between 0 and 100` });
            }
        }
    }

    const data = {
        vpip: vpip != null ? Number(vpip) : null,
        rfi: rfi != null ? Number(rfi) : null,
        pfr: pfr != null ? Number(pfr) : null,
        three_bet: three_bet != null ? Number(three_bet) : null,
        fold_to_3bet: fold_to_3bet != null ? Number(fold_to_3bet) : null,
        cbet: cbet != null ? Number(cbet) : null,
        fold_to_cbet: fold_to_cbet != null ? Number(fold_to_cbet) : null,
        wtsd: wtsd != null ? Number(wtsd) : null,
        wsd: wsd != null ? Number(wsd) : null,
        aggression_freq: aggression_freq != null ? Number(aggression_freq) : null,
    };

    const stats = await prisma.playerStats.upsert({
        where: { player_id: playerId },
        create: { player_id: playerId, ...data },
        update: data
    });

    res.json({ success: true, data: stats });
}));

export const playerStatsRoutes = router;
