import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { NoteService } from '../services/noteService';
import { z } from 'zod';

export class NoteController extends BaseController {
    constructor(private readonly noteService: NoteService) {
        super();
    }

    async getByPlayer(req: Request, res: Response) {
        try {
            const { playerId } = req.params;
            const notes = await this.noteService.getPlayerNotes(playerId as string);
            this.handleSuccess(res, notes);
        } catch (error) {
            this.handleError(error, res, 'NoteController.getByPlayer');
        }
    }

    async create(req: Request, res: Response) {
        try {
            const note = await this.noteService.createNote(req.body);
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
            await this.noteService.deleteNote(id as string);
            this.handleSuccess(res, { deleted: true });
        } catch (error) {
            this.handleError(error, res, 'NoteController.delete');
        }
    }

    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const note = await this.noteService.updateNote(id as string, req.body);
            this.handleSuccess(res, note);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, error: 'Validation Error' });
            }
            this.handleError(error, res, 'NoteController.update');
        }
    }
}
