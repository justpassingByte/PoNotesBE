import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { NoteService } from '../services/noteService';
import { z } from 'zod';
import { clearPlayerCache, clearDashboardCache } from '../lib/cache';

export class NoteController extends BaseController {
    constructor(private readonly noteService: NoteService) {
        super();
    }

    async getByPlayer(req: Request, res: Response) {
        try {
            const { playerId } = req.params;
            const userId = (req as any).user.id;
            const notes = await this.noteService.getPlayerNotes(userId, playerId as string);
            this.handleSuccess(res, notes);
        } catch (error) {
            this.handleError(error, res, 'NoteController.getByPlayer');
        }
    }

    async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const note = await this.noteService.createNote(userId, req.body);
            
            // Invalidate caches
            clearPlayerCache(userId);
            clearDashboardCache(userId);

            this.handleSuccess(res, note, 201);
        } catch (error) {
            // Handle Zod Validation Errors Specially
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error'
                });
            }
            this.handleError(error, res, 'NoteController.create');
        }
    }

    async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as any).user.id;
            await this.noteService.deleteNote(userId, id as string);

            // Invalidate caches
            clearPlayerCache(userId);
            clearDashboardCache(userId);

            this.handleSuccess(res, { deleted: true });
        } catch (error) {
            this.handleError(error, res, 'NoteController.delete');
        }
    }

    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as any).user.id;
            const note = await this.noteService.updateNote(userId, id as string, req.body);
            
            // Invalidate caches
            clearPlayerCache(userId);
            clearDashboardCache(userId);

            this.handleSuccess(res, note);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, error: 'Validation Error' });
            }
            this.handleError(error, res, 'NoteController.update');
        }
    }
}
