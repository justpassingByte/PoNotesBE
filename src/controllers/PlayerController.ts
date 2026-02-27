import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { PlayerService } from '../services/playerService';
import { z } from 'zod';

export class PlayerController extends BaseController {
    constructor(private readonly playerService: PlayerService) {
        super();
    }

    async getAll(req: Request, res: Response) {
        try {
            const players = await this.playerService.getAllPlayers();
            // Flatten _count.notes into notesCount for the frontend
            const flattened = (players as any[]).map((p: any) => ({
                ...p,
                notesCount: p._count?.notes || 0,
            }));
            this.handleSuccess(res, flattened);
        } catch (error) {
            this.handleError(error, res, 'PlayerController.getAll');
        }
    }

    async exportAll(req: Request, res: Response) {
        try {
            const players = await this.playerService.exportAllPlayers();
            // Map to a clean export format
            const exportData = (players as any[]).map((p: any) => ({
                name: p.name,
                playstyle: p.playstyle || 'UNKNOWN',
                platform: p.platform?.name || 'Unknown',
                platform_id: p.platform_id,
                notes: (p.notes || []).map((n: any) => ({
                    street: n.street,
                    note_type: n.note_type,
                    content: n.content,
                    created_at: n.created_at
                }))
            }));
            this.handleSuccess(res, exportData);
        } catch (error) {
            this.handleError(error, res, 'PlayerController.exportAll');
        }
    }

    async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const player = await this.playerService.getPlayerById(id as string);
            this.handleSuccess(res, player);
        } catch (error) {
            this.handleError(error, res, 'PlayerController.getById', 404);
        }
    }

    async create(req: Request, res: Response) {
        try {
            const player = await this.playerService.createPlayer(req.body);
            this.handleSuccess(res, player, 201);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, error: 'Validation Error' });
            }
            this.handleError(error, res, 'PlayerController.create');
        }
    }

    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const player = await this.playerService.updatePlayer(id as string, req.body);
            this.handleSuccess(res, player);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, error: 'Validation Error' });
            }
            this.handleError(error, res, 'PlayerController.update');
        }
    }

    async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await this.playerService.deletePlayer(id as string);
            this.handleSuccess(res, { deleted: true });
        } catch (error) {
            this.handleError(error, res, 'PlayerController.delete');
        }
    }

    async bulkCreate(req: Request, res: Response) {
        try {
            // Validate that input is an array
            if (!Array.isArray(req.body)) throw new Error('Input must be an array of players');

            const result = await this.playerService.bulkCreatePlayers(req.body);
            this.handleSuccess(res, {
                count: result.created.length,
                skipped: result.skipped.length,
                skippedNames: result.skipped,
                players: result.created
            }, 201);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, error: 'Bulk Validation Error' });
            }
            this.handleError(error, res, 'PlayerController.bulkCreate');
        }
    }
}
