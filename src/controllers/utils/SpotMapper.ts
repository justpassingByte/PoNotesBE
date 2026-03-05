import type { SpotTemplateBucket } from '../../core/solver/strategic/types';

const SPOT_ALIAS_MAP: Record<string, SpotTemplateBucket> = {
    '3BET_IP': '3BP_IP',
    '3BET_OOP': '3BP_OOP',
    '4BET_IP': '4BP_IP',
    '4BET_OOP': '4BP_OOP',
};

const CANONICAL_SPOTS = new Set<SpotTemplateBucket>([
    'LIMPED_IP',
    'LIMPED_OOP',
    'SRP_IP',
    'SRP_OOP',
    '3BP_IP',
    '3BP_OOP',
    '4BP_IP',
    '4BP_OOP',
]);

export function mapSpot(rawSpot: unknown): SpotTemplateBucket | null {
    if (typeof rawSpot !== 'string') {
        return null;
    }

    const normalized = rawSpot.trim().toUpperCase();
    const mapped = SPOT_ALIAS_MAP[normalized] ?? (normalized as SpotTemplateBucket);
    return CANONICAL_SPOTS.has(mapped) ? mapped : null;
}

