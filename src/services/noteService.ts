import { NoteRepository } from '../repositories/NoteRepository';
import { createNoteSchema, updateNoteSchema } from '../validators/note.schema';

export class NoteService {
    constructor(private readonly noteRepository: NoteRepository) { }

    async getPlayerNotes(playerId: string) {
        if (!playerId) throw new Error('Player ID is required');
        return this.noteRepository.findByPlayerId(playerId);
    }

    async createNote(payload: unknown) {
        // 1. Zod Validation
        const validatedData = createNoteSchema.parse(payload);

        // 2. Db Execution
        return this.noteRepository.create(validatedData);
    }

    async updateNote(noteId: string, payload: unknown) {
        if (!noteId) throw new Error('Note ID is required');
        const validatedData = updateNoteSchema.parse(payload);
        return this.noteRepository.update(noteId, validatedData);
    }

    async deleteNote(noteId: string) {
        if (!noteId) throw new Error('Note ID is required');
        return this.noteRepository.delete(noteId);
    }
}
