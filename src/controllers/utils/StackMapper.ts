import type { StackDepthBucket } from '../../core/solver/strategic/types';

const CANONICAL_STACKS = new Set<StackDepthBucket>([
    'SHORT',
    'MEDIUM',
    'DEEP',
    'VERY_DEEP',
]);

function bucketizeStack(bb: number): StackDepthBucket {
    // UI mapping contract:
    // <40 => SHORT, 40-80 => MEDIUM, 80-150 => DEEP, >150 => VERY_DEEP
    if (bb < 40) return 'SHORT';
    if (bb <= 80) return 'MEDIUM';
    if (bb <= 150) return 'DEEP';
    return 'VERY_DEEP';
}

export function mapStack(rawStack: unknown): StackDepthBucket | null {
    if (typeof rawStack === 'number' && Number.isFinite(rawStack) && rawStack > 0) {
        return bucketizeStack(rawStack);
    }

    if (typeof rawStack !== 'string') {
        return null;
    }

    const trimmed = rawStack.trim();
    if (!trimmed) {
        return null;
    }

    const upper = trimmed.toUpperCase() as StackDepthBucket;
    if (CANONICAL_STACKS.has(upper)) {
        return upper;
    }

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }

    return bucketizeStack(numeric);
}
