import crypto from 'crypto';

/**
 * Normalize hand data to produce a canonical representation.
 * Strips non-strategic data (player names, timestamps, stakes) 
 * so identical hands produce the same hash regardless of source formatting.
 */
export function normalizeHandInput(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/\r\n/g, '\n')
        // Remove player names (common patterns: @username, quoted names)
        .replace(/@[\w\d_]+/g, 'PLAYER')
        // Remove timestamps (various formats)
        .replace(/\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}(:\d{2})?/g, '')
        // Remove hand IDs
        .replace(/hand\s*#?\s*[\w\d]+/gi, '')
        .replace(/hl\d+/gi, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generate a SHA-256 hash for a canonicalized hand string.
 */
export function generateHandHash(rawInput: string): string {
    const normalized = normalizeHandInput(rawInput);
    return crypto.createHash('sha256').update(normalized).digest('hex');
}
