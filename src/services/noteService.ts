import { NoteRepository } from '../repositories/NoteRepository';
import { createNoteSchema, updateNoteSchema } from '../validators/note.schema';
import { AIAnalysisService } from './AIAnalysisService';

export class NoteService {
    private readonly aiService: AIAnalysisService;

    constructor(private readonly noteRepository: NoteRepository) {
        this.aiService = new AIAnalysisService();
    }

    async getPlayerNotes(playerId: string) {
        if (!playerId) throw new Error('Player ID is required');
        return this.noteRepository.findByPlayerId(playerId);
    }

    async createNote(payload: unknown) {
        // 1. Zod Validation
        const validatedData = createNoteSchema.parse(payload);

        // 2. Db Execution
        const note = await this.noteRepository.create(validatedData);

        // 3. Trigger AI analysis (fire-and-forget, errors won't fail the note)
        this.triggerAIAnalysis(validatedData.player_id);

        return note;
    }

    async updateNote(noteId: string, payload: unknown) {
        if (!noteId) throw new Error('Note ID is required');
        const validatedData = updateNoteSchema.parse(payload);
        const note = await this.noteRepository.update(noteId, validatedData);

        // Trigger AI re-analysis
        if (note.player_id) {
            this.triggerAIAnalysis(note.player_id);
        }

        return note;
    }

    async deleteNote(noteId: string) {
        if (!noteId) throw new Error('Note ID is required');
        const note = await this.noteRepository.delete(noteId);

        // Trigger AI re-analysis after deletion
        if (note.player_id) {
            this.triggerAIAnalysis(note.player_id);
        }

        return note;
    }

    /**
     * Fire-and-forget AI analysis. Errors are logged but never bubble up.
     */
    private triggerAIAnalysis(playerId: string): void {
        this.aiService.analyzePlayer(playerId).catch(err => {
            console.error(`[AI] Background analysis failed for player ${playerId}:`, err);
        });
    }
}
