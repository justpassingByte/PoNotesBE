import { NoteRepository } from '../repositories/NoteRepository';
import { createNoteSchema, updateNoteSchema } from '../validators/note.schema';
import { AIAnalysisService } from './AIAnalysisService';
import { PlayerService } from './playerService';

export class NoteService {
    private readonly aiService: AIAnalysisService;

    constructor(
        private readonly noteRepository: NoteRepository,
        private readonly playerService: PlayerService
    ) {
        this.aiService = new AIAnalysisService();
    }

    async getPlayerNotes(userId: string, playerId: string) {
        if (!playerId) throw new Error('Player ID is required');
        return this.noteRepository.findByPlayerId(userId, playerId);
    }

    async createNote(userId: string, payload: unknown) {
        // 1. Zod Validation
        const validatedData = createNoteSchema.parse(payload);

        let playerId = validatedData.player_id;

        // 2. Resolve Player if missing ID but has Name
        if (!playerId && (validatedData as any).player_name) {
            const playerName = (validatedData as any).player_name;
            const player = await this.playerService.getOrCreatePlayerByName(userId, playerName);
            playerId = player.id;
        }

        if (!playerId) {
            throw new Error('player_id or player_name is required');
        }

        // 3. Db Execution
        const note = await this.noteRepository.create({
            ...validatedData,
            user_id: userId,
            player_id: playerId
        } as any);

        // 4. Trigger AI analysis (fire-and-forget)
        this.triggerAIAnalysis(playerId);

        return note;
    }

    async updateNote(userId: string, noteId: string, payload: unknown) {
        if (!noteId) throw new Error('Note ID is required');
        const validatedData = updateNoteSchema.parse(payload);
        const note = await this.noteRepository.update(userId, noteId, validatedData);

        // Trigger AI re-analysis
        if (note.player_id) {
            this.triggerAIAnalysis(note.player_id);
        }

        return note;
    }

    async deleteNote(userId: string, noteId: string) {
        if (!noteId) throw new Error('Note ID is required');
        const note = await this.noteRepository.delete(userId, noteId);

        // Trigger AI re-analysis after deletion
        if (note.player_id) {
            this.triggerAIAnalysis(note.player_id);
        }

        return note;
    }

    /**
     * Trigger the new ProfileAggregator pipeline.
     */
    private triggerAIAnalysis(playerId: string): void {
        import('./analysis/ProfileAggregator').then(({ ProfileAggregator }) => {
            ProfileAggregator.generateProfile(playerId).catch(err => {
                console.error(`[Profiling] Background update failed for player ${playerId}:`, err);
            });
        });
    }
}
