import { Request, Response } from 'express';
import { SolverEngine } from '../core/solver/SolverEngine';
import type {
    BoardTextureBucket,
    SolveRequest,
    Street,
    VillainTypeBucket,
    ShapingMode,
} from '../core/solver/strategic/types';
import { mapSpot } from './utils/SpotMapper';
import { mapStack } from './utils/StackMapper';

const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];
const SHAPING_MODES: readonly ShapingMode[] = ['balanced', 'polar', 'merged'];
const VILLAIN_TYPES: readonly VillainTypeBucket[] = ['NEUTRAL', 'OVERFOLD', 'OVERCALL', 'OVERAGGRO', 'PASSIVE'];

const SUITEDNESS_VALUES: readonly BoardTextureBucket['suitedness'][] = ['MONOTONE', 'TWO_TONE', 'RAINBOW'];
const PAIRED_STATUS_VALUES: readonly BoardTextureBucket['pairedStatus'][] = ['UNPAIRED', 'PAIRED', 'TWO_PAIR', 'TRIPS', 'QUADS'];
const HIGH_CARD_VALUES: readonly BoardTextureBucket['highCardTier'][] = ['ACE_HIGH', 'KING_HIGH', 'QUEEN_HIGH', 'JACK_HIGH', 'LOW_BOARD'];
const CONNECTIVITY_VALUES: readonly string[] = ['DRY', 'CONNECTED', 'VERY_CONNECTED', 'SEMI_CONNECTED', 'DISCONNECTED'];

function mapConnectivity(raw: string): BoardTextureBucket['connectivity'] {
    if (raw === 'DISCONNECTED') return 'DRY';
    if (raw === 'SEMI_CONNECTED') return 'CONNECTED';
    return raw as BoardTextureBucket['connectivity'];
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseBoard(rawBoard: unknown): { board?: BoardTextureBucket; error?: string } {
    if (!rawBoard || typeof rawBoard !== 'object') {
        return { error: 'Invalid board: expected object with suitedness, pairedStatus, highCardTier, connectivity' };
    }

    const board = rawBoard as Partial<BoardTextureBucket>;

    if (!isOneOf(board.suitedness, SUITEDNESS_VALUES)) {
        return { error: `Invalid board.suitedness "${String(board.suitedness)}"` };
    }
    if (!isOneOf(board.pairedStatus, PAIRED_STATUS_VALUES)) {
        return { error: `Invalid board.pairedStatus "${String(board.pairedStatus)}"` };
    }
    if (!isOneOf(board.highCardTier, HIGH_CARD_VALUES)) {
        return { error: `Invalid board.highCardTier "${String(board.highCardTier)}"` };
    }
    if (!isOneOf(board.connectivity, CONNECTIVITY_VALUES)) {
        return { error: `Invalid board.connectivity "${String(board.connectivity)}"` };
    }

    return {
        board: {
            suitedness: board.suitedness,
            pairedStatus: board.pairedStatus,
            highCardTier: board.highCardTier,
            connectivity: mapConnectivity(board.connectivity),
        },
    };
}

export class SolverController {
    /**
     * POST /api/solve
     * Solve a poker strategy based on the provided request parameters
     */
    static async solve(req: Request, res: Response): Promise<void> {
        try {
            const body = req.body as Partial<SolveRequest>;

            // Validate required fields
            if (!body.spot || !body.stack) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields: spot and stack are required'
                });
                return;
            }

            const mappedSpot = mapSpot(body.spot);
            if (!mappedSpot) {
                res.status(400).json({
                    success: false,
                    error: `Invalid spot "${String(body.spot)}". Supported values include SRP_IP, SRP_OOP, 3BET_IP/3BP_IP, 3BET_OOP/3BP_OOP, 4BET_IP/4BP_IP, 4BET_OOP/4BP_OOP.`
                });
                return;
            }

            const mappedStack = mapStack(body.stack);
            if (!mappedStack) {
                res.status(400).json({
                    success: false,
                    error: `Invalid stack "${String(body.stack)}". Use numeric BB (e.g. "100") or one of SHORT|MEDIUM|DEEP|VERY_DEEP.`
                });
                return;
            }

            if (body.street !== undefined && !isOneOf(body.street, STREETS)) {
                res.status(400).json({
                    success: false,
                    error: `Invalid street "${String(body.street)}". Expected one of: preflop, flop, turn, river.`
                });
                return;
            }

            if (body.shapingMode !== undefined && !isOneOf(body.shapingMode, SHAPING_MODES)) {
                res.status(400).json({
                    success: false,
                    error: `Invalid shapingMode "${String(body.shapingMode)}". Expected one of: balanced, polar, merged.`
                });
                return;
            }

            if (body.villainType !== undefined && !isOneOf(body.villainType, VILLAIN_TYPES)) {
                res.status(400).json({
                    success: false,
                    error: `Invalid villainType "${String(body.villainType)}". Expected one of: NEUTRAL, OVERFOLD, OVERCALL, OVERAGGRO, PASSIVE.`
                });
                return;
            }

            const street: Street = body.street ?? 'preflop';
            let board: BoardTextureBucket | undefined;

            if (street !== 'preflop') {
                const boardResult = parseBoard(body.board);
                if (boardResult.error) {
                    res.status(400).json({
                        success: false,
                        error: boardResult.error
                    });
                    return;
                }
                board = boardResult.board;
            }

            const request: SolveRequest = {
                spot: mappedSpot,
                stack: mappedStack,
                street,
                board,
                villainType: body.villainType,
                shapingMode: body.shapingMode,
            };

            // Call the solver engine
            const result = SolverEngine.solve(request);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Solver error:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            });
        }
    }
}
