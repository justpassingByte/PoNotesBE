import * as fs from 'fs';
import * as path from 'path';

interface GTOKnowledge {
    systemPrompt: string;
    simpleModePrompt: string;
    advancedModePrompt: string;
    preflopRanges: Record<string, any>;
    postflopCbet: Record<string, any>;
    betSizing: Record<string, any>;
    decisionTrees: Record<string, any>;
}

let cachedKnowledge: GTOKnowledge | null = null;

/**
 * Load all GTO knowledge files from disk and cache them in memory.
 * Called once at startup; subsequent calls return cached data.
 */
function loadKnowledge(): GTOKnowledge {
    if (cachedKnowledge) return cachedKnowledge;

    const gtoDir = path.join(__dirname, 'gto');
    const promptsDir = path.join(__dirname, 'prompts');

    const readFile = (filePath: string): string => {
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            console.warn(`[GTO] Failed to load ${filePath}:`, err);
            return '';
        }
    };

    const readJSON = (filePath: string): Record<string, any> => {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
            console.warn(`[GTO] Failed to load ${filePath}:`, err);
            return {};
        }
    };

    cachedKnowledge = {
        systemPrompt: readFile(path.join(promptsDir, 'gto-system-prompt.txt')),
        simpleModePrompt: readFile(path.join(promptsDir, 'simple-mode.txt')),
        advancedModePrompt: readFile(path.join(promptsDir, 'advanced-mode.txt')),
        preflopRanges: readJSON(path.join(gtoDir, 'preflop-ranges.json')),
        postflopCbet: readJSON(path.join(gtoDir, 'postflop-cbet.json')),
        betSizing: readJSON(path.join(gtoDir, 'bet-sizing.json')),
        decisionTrees: readJSON(path.join(gtoDir, 'decision-trees.json')),
    };

    console.log('[GTO] Knowledge loaded successfully');
    return cachedKnowledge;
}

/**
 * Build a GTO-enriched system prompt based on position, stack size, and analysis mode.
 */
export function getGTOPrompt(position: string, stackSize: number, mode: string): string {
    const k = loadKnowledge();

    // Determine stack bucket
    const stackBucket = stackSize <= 30 ? '25bb' : stackSize <= 65 ? '50bb' : '100bb';
    const positionLabel = position === 'IP' ? 'In Position' : 'Out of Position';

    // Build position-specific range context
    let rangeContext = '';
    if (k.preflopRanges?.positions) {
        const positions = k.preflopRanges.positions;
        // For IP, show BTN/CO ranges; for OOP, show BB/SB ranges
        if (position === 'IP') {
            const btn = positions.BTN;
            const co = positions.CO;
            if (btn) rangeContext += `  BTN open range (${stackBucket}): ${btn.open_range?.[stackBucket] || 'N/A'} (~${btn.open_pct?.[stackBucket] || '?'}%)\n`;
            if (co) rangeContext += `  CO open range (${stackBucket}): ${co.open_range?.[stackBucket] || 'N/A'} (~${co.open_pct?.[stackBucket] || '?'}%)\n`;
        } else {
            const bb = positions.BB;
            const sb = positions.SB;
            if (bb) rangeContext += `  BB defend vs BTN (${stackBucket}): ${bb.defend_vs_btn?.[stackBucket] || 'N/A'} (~${bb.defend_pct?.[stackBucket] || '?'}%)\n`;
            if (sb) rangeContext += `  SB 3bet vs BTN: ${sb['3bet_vs_btn'] || 'N/A'}\n`;
        }
    }

    // Build c-bet context based on position
    let cbetContext = '';
    if (k.postflopCbet) {
        const cbetData = position === 'IP' ? k.postflopCbet.ip_cbet : k.postflopCbet.oop_cbet;
        if (cbetData) {
            cbetContext = `\nC-Bet Strategy (${positionLabel}):\n`;
            for (const [texture, data] of Object.entries(cbetData)) {
                const d = data as Record<string, any>;
                cbetContext += `  ${texture}: ${d.frequency || '?'}% freq, sizing ${d.sizing || 'N/A'}\n`;
            }
        }
    }

    // Build sizing context for current stack depth
    let sizingContext = '';
    if (k.betSizing?.preflop_sizing?.open_raise?.[stackBucket]) {
        const open = k.betSizing.preflop_sizing.open_raise[stackBucket];
        sizingContext += `\nPreflop sizing (${stackBucket}): Open ${open.sizing}\n`;
    }
    if (k.betSizing?.preflop_sizing?.['3bet']) {
        const threeBet = k.betSizing.preflop_sizing['3bet'][position === 'IP' ? 'ip' : 'oop'];
        if (threeBet) sizingContext += `3bet sizing (${positionLabel}): ${threeBet.sizing}\n`;
    }

    // Mode-specific instructions
    const modePrompt = mode === 'advanced' ? k.advancedModePrompt : k.simpleModePrompt;

    // Assemble the full GTO prompt
    return `${k.systemPrompt}

CONTEXT FOR THIS ANALYSIS:
Position: ${positionLabel}
Effective Stack: ${stackSize}bb (${stackBucket} bucket)

Position-Relevant Ranges:
${rangeContext || '  Standard GTO ranges apply\n'}
${cbetContext}
${sizingContext}
${modePrompt}`;
}

/**
 * Force reload of GTO knowledge (useful for development/testing).
 */
export function reloadKnowledge(): void {
    cachedKnowledge = null;
    loadKnowledge();
}
