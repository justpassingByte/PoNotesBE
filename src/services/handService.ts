import { HandRepository } from '../repositories/HandRepository';
import { UsageService } from './usageService';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import { generateHandHash } from '../utils/handHasher';
import { ParsedHand, HandAnalysis } from '../validators/hand.schema';
import { getModelForTier, buildHandAnalysisPrompt } from './promptManager';
import { PremiumTier, UsageActionType } from '@prisma/client';
import { LoggerService, LogType } from './loggerService';
import OpenAI from 'openai';
import { PatternEngine } from './analysis/PatternEngine';
import { BoardBucketParser } from './analysis/context/BoardBucketParser';
import { GtoContextEnricher } from './analysis/GtoContextEnricher';
import axios from 'axios';
export class HandService {
    constructor(
        private readonly handRepository: HandRepository
    ) { }

    async parseHand(params: {
        userId: string;
        rawInput?: string;
        inputType: 'text' | 'image';
        tier: PremiumTier;
        fileBytes?: Buffer;
        fileName?: string;
        mimeType?: string;
    }): Promise<{ hand: any; fromCache: boolean }> {
        // Always generate unique hash per upload — OCR self-learning means
        // re-processing the same image should yield improved results over time.
        const hashInput = `${params.userId}:${params.rawInput || (params.fileBytes ? params.fileBytes.length : '')}:${Date.now()}`;
        const hash = params.inputType === 'text'
            ? generateHandHash(hashInput)
            : crypto.createHash('sha256').update(hashInput).digest('hex');

        await LoggerService.log(
            params.userId,
            LogType.SYSTEM,
            `New hand uploaded. Initializing OCR neural pipeline.`,
            { hash: hash.slice(0, 16) }
        );

        let parsedData: ParsedHand | null = null;
        if (params.inputType === 'image') {
            const ocrResponse = await this.ocrParseImage({
                imageUrl: params.rawInput,
                fileBytes: params.fileBytes,
                fileName: params.fileName,
                mimeType: params.mimeType
            }, params.tier);
            const rawData = ocrResponse.data || ocrResponse;
            console.log('\n--- [HandService] RAW OCR DATA RECEIVED ---');
            console.log(JSON.stringify(rawData, null, 2).slice(0, 1500) + '... (truncated)');

            // Normalize card names: OCR outputs "Aheart" but frontend expects "Ah"
            const normalizeCard = (c: string): string => {
                if (!c || c === '??') return c;
                return c
                    .replace(/heart$/i, 'h')
                    .replace(/diamond$/i, 'd')
                    .replace(/club$/i, 'c')
                    .replace(/spade$/i, 's');
            };

            // Normalize board cards
            if (Array.isArray(rawData.board)) {
                rawData.board = rawData.board.map(normalizeCard);
            }

            // Normalize player_hands cards
            if (rawData.player_hands && typeof rawData.player_hands === 'object') {
                for (const [name, cards] of Object.entries(rawData.player_hands)) {
                    if (Array.isArray(cards)) {
                        rawData.player_hands[name] = (cards as string[]).map(normalizeCard);
                    }
                }
            }

            const playersMap = new Map<string, any>();
            const positionsMap = rawData.positions || {};

            // Build players from streets (Robust extraction of identity)
            Object.values(rawData.streets || {}).forEach((actions: any[]) => {
                if (!Array.isArray(actions)) return;
                actions.forEach(act => {
                    const rawPlayer = act.player;
                    const cleanName = typeof rawPlayer === 'string' ? rawPlayer.trim() : (rawPlayer?.name || String(rawPlayer || ''));
                    if (!cleanName || cleanName === 'undefined') return;

                    // Look up position from the dedicated positions map
                    const pos = positionsMap[cleanName] || undefined;

                    if (!playersMap.has(cleanName)) {
                        playersMap.set(cleanName, {
                            name: cleanName,
                            position: pos,
                            hole_cards: []
                        });
                    } else if (pos && !playersMap.get(cleanName).position) {
                        playersMap.get(cleanName).position = pos;
                    }
                });
            });

            // --- Inject Player Hands  ---
            if (rawData.player_hands && typeof rawData.player_hands === 'object') {
                for (const [playerName, cards] of Object.entries(rawData.player_hands)) {
                    const validCards = (cards as string[]).filter(c => c != null && c !== '');
                    if (validCards.length === 0) continue;
                    if (playersMap.has(playerName)) {
                        const existing = playersMap.get(playerName).hole_cards || [];
                        if (existing.length === 0) {
                            playersMap.get(playerName).hole_cards = validCards;
                        }
                    } else {
                        const pos = positionsMap[playerName] || undefined;
                        playersMap.set(playerName, {
                            name: playerName,
                            position: pos,
                            hole_cards: validCards
                        });
                    }
                }
            }

            // Parse pot to number
            const potStr = rawData.pot ? String(rawData.pot).replace(/[^\d.]/g, '') : '0';

            // Detect currency from raw amounts
            const detectCurrency = (raw: any): string => {
                if (!raw) return 'BB';
                const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
                if (str.includes('￥') || str.includes('¥')) return '￥';
                if (str.includes('$')) return '$';
                if (str.includes('€')) return '€';
                return 'BB';
            };
            // Infer from pot or first action amount
            let currency = detectCurrency(rawData.pot);
            if (currency === 'BB') {
                // Try first action amount
                for (const sk of ['preflop', 'flop', 'turn', 'river', 'blinds_ante']) {
                    const acts = rawData.streets?.[sk];
                    if (Array.isArray(acts)) {
                        for (const a of acts) {
                            const c = detectCurrency(a?.amount);
                            if (c !== 'BB') { currency = c; break; }
                        }
                    }
                    if (currency !== 'BB') break;
                }
            }

            const parseAmount = (amt: any): number | undefined => {
                if (amt === undefined || amt === null) return undefined;
                if (typeof amt === 'number') return amt;
                const match = String(amt).replace(',', '.').match(/([+\-]?\d[\d\.]*)/);
                return match ? parseFloat(match[1]) : undefined;
            };

            const mapActions = (streetActions: any[], streetName: string) => {
                if (!Array.isArray(streetActions)) return [];
                return streetActions.map(act => {
                    let standardAction = act.action?.toLowerCase() || '';
                    // Robust mapping for Vietnamese and fallback terms
                    if (standardAction.includes('tố') || standardAction.includes('raise')) standardAction = 'raise';
                    else if (standardAction.includes('cược') || standardAction.includes('bet')) standardAction = 'bet';
                    else if (standardAction.includes('theo') || standardAction.includes('call')) standardAction = 'call';
                    else if (standardAction.includes('bỏ bài') || standardAction.includes('fold')) standardAction = 'fold';
                    else if (standardAction.includes('check') || standardAction.includes('xem') || standardAction.includes('kiểm tra')) standardAction = 'check';
                    else if (standardAction.includes('all') || standardAction.includes('in')) standardAction = 'all-in';
                    else if (standardAction.includes('post') || standardAction.includes('sb') || standardAction.includes('bb')) standardAction = 'post';

                    const rawPlayer = act.player;
                    const playerName = typeof rawPlayer === 'string' ? rawPlayer.trim() : (rawPlayer?.name || String(rawPlayer || 'Unknown'));

                    // Resolve position from positionsMap OR from the action itself
                    const position = act.position || positionsMap[playerName] || playersMap.get(playerName)?.position || undefined;

                    console.log(`[HandService] Action Mapped [${streetName}]: Player=${playerName}, Pos=${position}, Act=${standardAction}, Amt=${act.amount}`);

                    return {
                        player: playerName,
                        position,
                        action: standardAction,
                        amount: parseAmount(act.amount),
                    };
                });
            };

            parsedData = {
                board: rawData.board || [],
                players: Array.from(playersMap.values()),
                actions: {
                    blinds_ante: mapActions(rawData.streets?.blinds_ante, 'blinds_ante'),
                    preflop: mapActions(rawData.streets?.preflop, 'preflop'),
                    flop: mapActions(rawData.streets?.flop, 'flop'),
                    turn: mapActions(rawData.streets?.turn, 'turn'),
                    river: mapActions(rawData.streets?.river, 'river')
                },
                pot: parseFloat(potStr) || 0,
                currency: currency,
                street_pots: rawData.street_pots || rawData.metadata?.street_pots || {},
                showdown: rawData.showdown || rawData.player_hands || {},
            } as any;

            (parsedData as any).ocr_result = {
                confidence: ocrResponse.confidence?.total ?? 0,
                decision: ocrResponse.decision || 'auto_accept',
                decision_reason: ocrResponse.decision_reason || [],
                needs_confirmation: ocrResponse.needs_confirmation || false,
                breakdown: ocrResponse.confidence?.breakdown || {},
                performance: ocrResponse.performance || {}
            };

            // Build showdown_players for frontend ShowdownBlock display
            const showdownPlayers: any[] = [];
            if (rawData.winner?.player) {
                showdownPlayers.push({
                    name: rawData.winner.player,
                    position: positionsMap[rawData.winner.player] || '',
                    hole_cards: (rawData.winner.hand || rawData.player_hands?.[rawData.winner.player] || []).map(normalizeCard),
                    result: 'winner',
                    resultAmount: String(rawData.winner.amount || '').replace(/[^+\-\d.,]/g, '')
                });
            }
            for (const loser of (rawData.losers || [])) {
                if (!loser?.player) continue;
                showdownPlayers.push({
                    name: loser.player,
                    position: positionsMap[loser.player] || '',
                    hole_cards: (loser.hand || rawData.player_hands?.[loser.player] || []).map(normalizeCard),
                    result: 'loser',
                    resultAmount: String(loser.amount || '').replace(/[^+\-\d.,]/g, '')
                });
            }
            // Fallback: if no winner/losers but player_hands exist, build from showdown entries
            if (showdownPlayers.length === 0 && rawData.player_hands) {
                for (const [name, cards] of Object.entries(rawData.player_hands)) {
                    if (Array.isArray(cards) && cards.length > 0) {
                        showdownPlayers.push({
                            name,
                            position: positionsMap[name] || '',
                            hole_cards: (cards as string[]).map(normalizeCard),
                            result: 'unknown',
                            resultAmount: ''
                        });
                    }
                }
            }
            (parsedData as any).showdown_players = showdownPlayers;
            console.log('[HandService] showdown_players built:', JSON.stringify(showdownPlayers));

            await UsageService.incrementUsage(params.userId, UsageActionType.OCR_HAND, params.tier);
        } else {
            parsedData = this.parseTextHand(params.rawInput);
        }

        const rawDataToSave = params.rawInput || (params.fileBytes ? `data:${params.mimeType || 'image/png'};base64,${params.fileBytes.toString('base64')}` : "");

        // Always create new hand record (unique hash per upload)
        const hand = await prisma.hand.create({
            data: {
                user_id: params.userId,
                hand_hash: hash,
                raw_input: rawDataToSave,
                input_type: params.inputType,
                parsed_data: parsedData as any,
                ai_analysis: null as any,
                tags: []
            }
        });

        return { hand, fromCache: false };
    }

    async analyzeHand(params: {
        userId: string;
        handId: string;
        parsedData?: ParsedHand;
        tier: PremiumTier;
    }): Promise<HandAnalysis> {
        const hand = await this.handRepository.findById(params.userId, params.handId);
        if (!hand) throw new Error('Hand not found');

        const finalParsedData = params.parsedData || (hand.parsed_data as unknown as ParsedHand);

        await LoggerService.log(
            params.userId,
            LogType.AI_LEARNING,
            `Starting AI Leak Scan with ${hand.input_type === 'image' ? 'Neural OCR' : 'Text'} inputs.`,
            { handId: hand.id },
            hand.id
        );

        // Notes accumulate — previous AI notes are preserved for historical tracking

        const analysis = await this.runAnalysis(finalParsedData, params.tier, params.userId);
        await UsageService.incrementUsage(params.userId, UsageActionType.AI_ANALYZE, params.tier);

        await this.handRepository.update(params.userId, params.handId, {
            ai_analysis: analysis as any,
            parsed_data: finalParsedData as any
        });

        let notesCreated: string[] = [];
        try {
            notesCreated = await this.autoExtractNotesFromAnalysis(params.userId, hand, finalParsedData, analysis);
        } catch (noteErr) {
            console.error('[HandService] Failed to auto-extract notes:', noteErr);
        }

        return { ...analysis, notesCreated };
    }

    async getHistory(userId: string, options: any) {
        return this.handRepository.findByUserId(userId, options);
    }

    async getHandById(userId: string, id: string) {
        return this.handRepository.findById(userId, id);
    }

    async deleteHand(userId: string, id: string) {
        return this.handRepository.delete(userId, id);
    }

    /**
     * Detect pot type from preflop actions (SRP / 3bet / 4bet / Limped / etc.)
     */
    private detectPotType(parsedHand: ParsedHand): string {
        const preflopActions = parsedHand.actions?.preflop || [];
        let raiseCount = 0;
        for (const act of preflopActions) {
            const a = act.action?.toLowerCase() || '';
            if (a === 'raise' || a === 'all-in' || a === '3bet' || a === '4bet') raiseCount++;
        }
        if (raiseCount === 0) return 'Limped Pot';
        if (raiseCount === 1) return 'SRP';
        if (raiseCount === 2) return '3bet Pot';
        if (raiseCount >= 3) return '4bet+ Pot';
        return 'SRP';
    }

    /**
     * Describe board texture for a specific street using the canonical BoardBucketParser.
     */
    private describeBoardTexture(board: string[], street: string): string {
        if (!board || board.length === 0) return '';

        const suitName = (s: string) => ({ h: '♥', d: '♦', c: '♣', s: '♠' }[s] || s);
        const formatCard = (c: string) => {
            if (!c || c === '??') return '?';
            const rank = c.slice(0, -1).toUpperCase();
            const suit = c.slice(-1).toLowerCase();
            return `${rank}${suitName(suit)}`;
        };

        const streetLow = street.toLowerCase();
        let relevantCards: string[] = [];

        if (streetLow === 'flop') relevantCards = board.slice(0, 3);
        else if (streetLow === 'turn') relevantCards = board.slice(0, 4);
        else if (streetLow === 'river') relevantCards = board.slice(0, 5);
        else return ''; // preflop, blinds_ante, general — no board to show

        if (relevantCards.length === 0) return '';

        const display = relevantCards.map(formatCard).join(' ');

        // Use canonical BoardBucketParser for texture classification
        const bucket = BoardBucketParser.categorize(relevantCards);
        const labels: string[] = [];
        if (bucket.suitedness !== 'UNKNOWN') labels.push(bucket.suitedness.toLowerCase());
        if (bucket.connectivity !== 'UNKNOWN' && bucket.connectivity !== 'DISCONNECTED') labels.push(bucket.connectivity.toLowerCase());
        if (bucket.pairedStatus !== 'UNKNOWN' && bucket.pairedStatus !== 'UNPAIRED') labels.push(bucket.pairedStatus.toLowerCase());
        if (bucket.highCardTier !== 'UNKNOWN') labels.push(bucket.highCardTier.toLowerCase().replace('_', ' '));

        const textureSuffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
        return `[${display}]${textureSuffix}`;
    }

    /**
     * Find what action the player actually took on a specific street.
     */
    private findPlayerAction(parsedHand: ParsedHand, playerName: string, street: string): string {
        const streetLow = street.toLowerCase() as keyof ParsedHand['actions'];
        const actions = parsedHand.actions?.[streetLow] || [];
        const playerActions = actions.filter(a =>
            a.player?.toLowerCase() === playerName.toLowerCase()
        );
        if (playerActions.length === 0) return '';
        return playerActions.map(a => {
            const act = (a.action || '').toUpperCase();
            return a.amount != null ? `${act} ${a.amount}` : act;
        }).join(' → ');
    }

    /**
     * Find what the player was facing on a specific street (last opponent action before theirs).
     */
    private findFacingAction(parsedHand: ParsedHand, playerName: string, street: string): string {
        const streetLow = street.toLowerCase() as keyof ParsedHand['actions'];
        const actions = parsedHand.actions?.[streetLow] || [];
        let lastOpponentAction = '';
        for (const a of actions) {
            if (a.player?.toLowerCase() === playerName.toLowerCase()) break;
            const act = (a.action || '').toUpperCase();
            lastOpponentAction = a.amount != null ? `${act} ${a.amount}` : act;
        }
        return lastOpponentAction;
    }

    /**
     * Build a rich, context-packed note from a mistake object + parsed hand data.
     * Returns both human-readable text AND structured metadata for future analysis.
     */
    private buildRichNote(mistake: any, parsedHand: ParsedHand): { content: string; metadata: Record<string, any> } {
        const potType = this.detectPotType(parsedHand);
        const streetLow = (mistake.street || 'general').toLowerCase();
        const streetLabel = streetLow.toUpperCase();
        const position = mistake.position || '';
        const playerName = mistake.playerName || mistake.player || '';

        // Board bucket (structured)
        const board = parsedHand.board || [];
        let relevantCards: string[] = [];
        if (streetLow === 'flop') relevantCards = board.slice(0, 3);
        else if (streetLow === 'turn') relevantCards = board.slice(0, 4);
        else if (streetLow === 'river') relevantCards = board.slice(0, 5);

        const boardBucket = relevantCards.length >= 3 ? BoardBucketParser.categorize(relevantCards) : null;
        const boardDisplay = this.describeBoardTexture(board, streetLow);

        // Facing & Action (structured)
        const facing = this.findFacingAction(parsedHand, playerName, streetLow);
        const action = this.findPlayerAction(parsedHand, playerName, streetLow);
        const severity = (mistake.severity || 'minor').toLowerCase();

        // ── Build human-readable text ──
        const parts: string[] = [];
        let header = potType;
        if (boardDisplay) header += `, Board ${boardDisplay}`;
        header += `, ${streetLabel}`;
        if (position) header += ` (${position})`;
        parts.push(header);

        const playerObj = parsedHand.players?.find(p => p.name?.toLowerCase() === playerName.toLowerCase());
        const holeCards = mistake.hole_cards || playerObj?.hole_cards?.join(' ') || '';
        if (holeCards && holeCards.length > 0) {
            parts.push(`Hole Cards: [${holeCards}]`);
        }
        
        const potSize = parsedHand.pot || 0;
        const currency = (parsedHand as any).currency || 'BB';
        if (potSize > 0) {
            parts.push(`Pot: ${potSize} ${currency}`);
        }

        if (facing) parts.push(`Facing: ${facing}`);
        if (action) parts.push(`Action: ${action}`);
        // ── Compare Actual vs GTO ──
        if (mistake.actual_action) parts.push(`👉 Thực tế: ${mistake.actual_action}`);
        if (mistake.gto_action) parts.push(`🤖 GTO Data: ${mistake.gto_action}`);

        parts.push(`❌ Leak [${severity.toUpperCase()}]: ${mistake.description}`);
        if (mistake.gto_deviation_reason) parts.push(`💡 Phân tích phân kỳ: ${mistake.gto_deviation_reason}`);
        if (mistake.better_line) parts.push(`✅ Better Line: ${mistake.better_line}`);
        if (mistake.exploit_strategy) parts.push(`🎯 Exploit Plan: ${mistake.exploit_strategy}`);

        // ── Build structured metadata ──
        const metadata: Record<string, any> = {
            pot_type: potType,
            street: streetLow,
            position: position || null,
            hole_cards: holeCards || null,
            board_cards: relevantCards.length > 0 ? relevantCards : null,
            board_bucket: boardBucket,
            facing: facing || null,
            action: action || null,
            severity,
            description: mistake.description,
            actual_action: mistake.actual_action || null,
            gto_action: mistake.gto_action || null,
            better_line: mistake.better_line || null,
            gto_reason: mistake.gto_deviation_reason || null,
            exploit_strategy: mistake.exploit_strategy || null,
        };

        return { content: parts.join('\n'), metadata };
    }

    private async autoExtractNotesFromAnalysis(userId: string, hand: any, parsedHand: ParsedHand, analysis: HandAnalysis): Promise<string[]> {
        const allMistakes = analysis.mistakes || [];
        if (allMistakes.length === 0 && !analysis.exploit_suggestions?.length) {
            await LoggerService.log(userId, LogType.SYSTEM, `No actionable leaks found in this hand.`, { handId: hand.id }, hand.id);
            return [];
        }

        await LoggerService.log(
            userId,
            LogType.AI_LEARNING,
            `Extracting ${allMistakes.length} actionable leaks from AI neural output...`,
            { raw_mistakes: allMistakes.map((m: any) => m.description) },
            hand.id
        );

        const createdNoteIds: string[] = [];
        for (const mistake of allMistakes) {
            const playerName = (mistake as any).playerName || mistake.player;
            if (!playerName || !mistake.description) continue;

            let player = await prisma.player.findFirst({
                where: { user_id: userId, name: { equals: playerName, mode: 'insensitive' } }
            });

            if (!player) {
                const platform = await prisma.platform.upsert({ where: { name: 'General' }, update: {}, create: { name: 'General' } });
                player = await prisma.player.create({
                    data: { user_id: userId, name: playerName, platform_id: platform.id, playstyle: 'UNKNOWN' }
                });
            }

            const { content: richContent, metadata } = this.buildRichNote(mistake, parsedHand);

            const baseNoteData: any = {
                    user_id: userId,
                    player_id: player.id,
                    hand_id: hand.id,
                    street: (mistake.street?.toLowerCase() || 'general') as any,
                    content: richContent,
                    is_ai_generated: true,
                    source: 'ai',
                    category: 'GENERAL',
                };

            let note: any;
            try {
                // Try with metadata first (requires migration applied)
                note = await prisma.note.create({ data: { ...baseNoteData, metadata } });
            } catch (metaErr: any) {
                // Fallback: save without metadata if column doesn't exist yet
                console.warn('[HandService] Note metadata column not available, saving without it:', metaErr.message?.slice(0, 100));
                note = await prisma.note.create({ data: baseNoteData });
            }
            createdNoteIds.push(note.id);

            await LoggerService.log(
                userId,
                LogType.PROFILE_EVOLUTION,
                `Auto-extracted note for [${playerName}] on street [${mistake.street || 'general'}]. Pushing to Memory Engine...`,
                { noteId: note.id, content: richContent },
                hand.id
            );

            // CRITICAL: Feed AI-generated notes into the PatternEngine memory loop!
            try {
                await PatternEngine.processNote(note);
            } catch (err) {
                console.error('[HandService] PatternEngine error during auto extraction:', err);
            }
        }

        await LoggerService.log(
            userId,
            LogType.SYSTEM,
            `Successfully bridged ${createdNoteIds.length} new insights into the Long-term Memory core.`,
            { createdNotesCount: createdNoteIds.length },
            hand.id
        );

        return createdNoteIds;
    }

    private async ocrParseImage(imgParams: { imageUrl?: string; fileBytes?: Buffer; fileName?: string; mimeType?: string }, tier: PremiumTier): Promise<any> {
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://ocr-api:8000';
        try {
            let imageBuffer: Buffer;
            let mimeType = imgParams.mimeType || 'image/png';

            if (imgParams.fileBytes) {
                imageBuffer = imgParams.fileBytes;
            } else if (imgParams.imageUrl && imgParams.imageUrl.startsWith('data:')) {
                const [header, base64Data] = imgParams.imageUrl.split(',');
                mimeType = header.split(':')[1].split(';')[0];
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else if (imgParams.imageUrl) {
                const imgRes = await fetch(imgParams.imageUrl);
                imageBuffer = Buffer.from(await imgRes.arrayBuffer());
                mimeType = imgRes.headers.get('content-type') || 'image/png';
            } else {
                throw new Error('No image context provided for OCR');
            }

            const formData = new FormData();
            const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
            const pFileName = imgParams.fileName || `hand.${mimeType.split('/')[1] || 'png'}`;
            formData.append('file', blob, pFileName);

            // Try synchronous endpoint first (eliminates polling overhead)
            try {
                const response = await axios.post(`${ocrServiceUrl}/ocr/sync`, formData, {
                    headers: { 'Connection': 'close' },
                    timeout: 60000 // Ensure we wait for the slow process without dropping
                });

                if (response.data.status === 'success') {
                    console.log(`[OCR_ENGINE] Sync scan complete. Confidence: ${response.data.result.confidence?.total || 0}%. Payload extracted!`);
                    return response.data.result;
                }
                throw new Error(response.data.detail || 'OCR sync failed');
            } catch (syncErr: any) {
                if (syncErr.response?.status === 404 || syncErr.code === 'ECONNRESET') {
                    // Fall down to queue if endpoint missing or connection dead
                } else if (syncErr.response) {
                    throw new Error(syncErr.response.data?.detail || 'OCR sync failed');
                } else {
                    throw syncErr;
                }
            }

            // Fallback: queue + poll (if /ocr/sync not available)
            console.log('[OCR_ENGINE] Sync endpoint unavailable or connection error, falling back to queue+poll...');
            const queueResponse = await axios.post(`${ocrServiceUrl}/ocr`, formData, {
                headers: { 'Connection': 'close' }
            });

            if (queueResponse.data.status === 'success') {
                return queueResponse.data.result;
            }

            const { job_id } = queueResponse.data;
            console.log(`[OCR_ENGINE] Sent visual payload. Job ID: ${job_id}. Waiting for core...`);

            for (let i = 0; i < 30; i++) {
                const poll = await axios.get(`${ocrServiceUrl}/result/${job_id}`, {
                    headers: { 'Connection': 'close' }
                });
                const data = poll.data;
                if (data.status === 'success') {
                    console.log(`[OCR_ENGINE] Scan Complete (Job: ${job_id}). Confidence: ${data.result.confidence?.total || 0}%. Payload extracted!`);
                    return data.result;
                }
                if (data.status === 'error') throw new Error(data.detail);
                await new Promise(r => setTimeout(r, 300));
            }
            throw new Error('OCR Timeout');
        } catch (error) {
            console.error('[HandService] OCR Error:', error);
            return { data: { players: [], actions: { preflop: [], flop: [], turn: [], river: [] }, board: [], pot: 0 }, confidence: { total: 0 } };
        }
    }

    private parseTextHand(rawText: string): ParsedHand {
        return {
            players: [],
            board: [],
            pot: 0,
            actions: { blinds_ante: [], preflop: [], flop: [], turn: [], river: [] }
        };
    }

    private async runAnalysis(parsedData: ParsedHand | null, tier: PremiumTier, userId?: string): Promise<HandAnalysis> {
        const groqKey = process.env.GROQ_API_KEY;
        const aiConfig = userId ? await prisma.userAIConfig.findUnique({ where: { user_id: userId } }) : null;
        const userSettings = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { language: true } }) : null;

        // Perform GTO RAG Step
        let gtoContext = '';
        let gtoWarnings: string[] = [];
        if (parsedData) {
            const enriched = await GtoContextEnricher.enrich(parsedData);
            gtoContext = enriched.gtoContext;
            gtoWarnings = enriched.warnings;
        }

        // NEW: Fetch deep player context to enable TARGETED EXPLOITS in hand analysis
        let playerContext = "";
        if (parsedData?.players && userId) {
            const playerNames = parsedData.players.map(p => p.name).filter(Boolean);
            const profiles = await prisma.player.findMany({
                where: {
                    user_id: userId,
                    name: { in: playerNames, mode: 'insensitive' }
                },
                select: {
                    name: true,
                    playstyle: true,
                    aggression_score: true,
                    ai_profile: true,
                    ai_exploit_strategy: true
                }
            });

            if (profiles.length > 0) {
                playerContext = profiles.map(p =>
                    `[PLAYER: ${p.name}]\n- Style: ${p.playstyle || 'UNKNOWN'}\n- Aggression: ${p.aggression_score || 0}\n- Profile Summary: ${typeof p.ai_profile === 'string' ? p.ai_profile : JSON.stringify(p.ai_profile)}\n- Strategy Override: ${p.ai_exploit_strategy || 'None'}`
                ).join('\n---\n');
            }
        }

        const modelInfo = (aiConfig?.model_name && typeof aiConfig.model_name === 'string')
            ? { model: aiConfig.model_name, provider: aiConfig.model_name.startsWith('gpt-') ? 'openai' : 'openai' as any } // Default to openai for custom models for now
            : getModelForTier(tier);

        const modelName = modelInfo.model;
        const isChatGPT = modelName.startsWith('gpt-') || modelName.startsWith('o1-') || modelName.startsWith('o3-');

        const client = new OpenAI({
            apiKey: isChatGPT ? process.env.OPENAI_API_KEY : (process.env.GROQ_API_KEY || ''),
            baseURL: isChatGPT ? undefined : 'https://api.groq.com/openai/v1'
        });

        const promptSettings = { ...(aiConfig || {}), language: userSettings?.language };
        const prompt = buildHandAnalysisPrompt(aiConfig?.analysis_prompt || undefined, promptSettings as any, playerContext, gtoContext);
        const response = await client.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: JSON.stringify(parsedData) }
            ],
            model: modelName,
            temperature: aiConfig?.temperature ?? 0.7,
            response_format: { type: 'json_object' }
        });

        const rawJson = response.choices[0]?.message?.content || '{}';

        // Verbose Logging for Debugging/Learning Loop
        console.log(`\n[AI_LEARNING_DUMP] Raw Model Output:\n${rawJson}\n`);

        const resultJson = JSON.parse(rawJson);
        if (gtoWarnings.length > 0) {
            resultJson.warnings = [...(resultJson.warnings || []), ...gtoWarnings];
        }

        return resultJson;
    }
}
