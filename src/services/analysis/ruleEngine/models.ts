import { PremiumTier } from '@prisma/client';

export type ActionType = 'fold' | 'call' | 'raise' | 'bet' | 'check' | 'all-in';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Position = 'SB' | 'BB' | 'UTG' | 'MP' | 'HJ' | 'CO' | 'BTN' | 'any';
export type Severity = 'minor' | 'moderate' | 'critical';
export type BoardTexture = 'monotone' | 'low_connected' | 'paired' | 'dry' | 'flush_possible' | 'straight_possible';
export type HandStrength = 'nuts' | 'very_strong' | 'strong' | 'medium' | 'weak' | 'air';

export interface Action {
    player: string;
    action: ActionType;
    amount: number;
}

export interface Player {
    name: string;
    position: Position;
    stack: number;
    hole_cards?: string[];
}

export interface Mistake {
    street: Street;
    playerName?: string;
    description: string;
    severity: Severity;
}

/**
 * HandState: Trạng thái nội bộ phục vụ Rule Engine
 */
export class HandState {
    id?: string;
    board: string[] = [];
    players: Player[] = [];
    hero: Player | null = null;
    villains: Player[] = [];
    pot: number = 0;
    streets: Record<Street, Action[]> = {
        preflop: [],
        flop: [],
        turn: [],
        river: []
    };
    
    // Derived features (will be populated by FeatureExtractor)
    spr: number = 0;
    isMultiway: boolean = false;
    boardTexture: BoardTexture[] = [];
    heroHandStrength: HandStrength = 'air';
    tags: string[] = [];
    
    constructor(data: any) {
        this.board = data.board || [];
        this.players = data.players || [];
        this.pot = data.pot || 0;
        this.streets = data.actions || { preflop: [], flop: [], turn: [], river: [] };
        
        // Identify Hero (has hole_cards)
        this.hero = this.players.find(p => p.hole_cards && p.hole_cards.length > 0) || null;
        this.villains = this.players.filter(p => !p.hole_cards || p.hole_cards.length === 0);
        this.isMultiway = this.players.length >= 3;
        
        // Basic SPR calc (if hero exists)
        if (this.hero && this.pot > 0) {
            this.spr = Number((this.hero.stack / this.pot).toFixed(2));
        }
    }
}
