import { PlayerRepository } from '../repositories/PlayerRepository';
import { bulkImportSchema, createPlayerSchema } from '../validators/player.schema';

// Auto-calculate aggression score from playstyle
function calculateAggression(playstyle: string): number {
    switch (playstyle?.toUpperCase()) {
        case 'MANIAC': return 90;
        case 'LAG': return 70;
        case 'TAG': return 45;
        case 'FISH': return 25;
        case 'CALLING STATION': return 20;
        case 'NIT': return 10;
        default: return 0;
    }
}

export class PlayerService {
    constructor(private readonly playerRepository: PlayerRepository) { }

    async getAllPlayers() {
        return this.playerRepository.findAll();
    }

    async exportAllPlayers() {
        return this.playerRepository.findAllWithNotes();
    }

    async getPlayerById(id: string) {
        const player = await this.playerRepository.findById(id);
        if (!player) {
            throw new Error(`Player with ID ${id} not found`);
        }
        return player;
    }

    async createPlayer(payload: unknown) {
        const validatedData = createPlayerSchema.parse(payload);
        // Auto-calculate aggression from playstyle
        const dataWithAggression = {
            ...validatedData,
            aggression_score: calculateAggression(validatedData.playstyle || 'UNKNOWN')
        };
        return this.playerRepository.create(dataWithAggression);
    }

    async updatePlayer(id: string, payload: unknown) {
        // Allow partial updates — name, playstyle, aggression_score
        const data: any = {};
        const body = payload as any;
        if (body.name) data.name = body.name;
        if (body.playstyle) {
            data.playstyle = body.playstyle;
            data.aggression_score = calculateAggression(body.playstyle);
        }
        if (body.aggression_score !== undefined) data.aggression_score = body.aggression_score;
        return this.playerRepository.update(id, data);
    }

    async deletePlayer(id: string) {
        if (!id) throw new Error('Player ID is required');
        return this.playerRepository.delete(id);
    }

    async bulkCreatePlayers(payload: unknown) {
        const validatedData = bulkImportSchema.parse(payload);
        // Auto-calculate aggression score for each player
        const enriched = validatedData.map(player => ({
            ...player,
            aggression_score: calculateAggression(player.playstyle || 'UNKNOWN')
        }));
        return this.playerRepository.bulkCreate(enriched);
    }
}
