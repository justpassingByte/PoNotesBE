import { NodeStrategyAdapter } from '../NodeStrategyAdapter';
import { GameNode } from '../GameNode';
import { RangeMath } from '../RangeMath';
import { HandClassGenerator } from '../HandClassGenerator';

/** Helper: create a basic GameNode for testing. */
function makeTestNode(): GameNode {
    const hands = HandClassGenerator.generateAll();
    const map = new Map<string, number>();
    for (const hand of hands) {
        map.set(hand, 1);
    }
    const range = RangeMath.normalize(map);
    return new GameNode({
        range,
        street: 'preflop',
        spotTemplate: 'SRP_IP',
        stackDepth: 'DEEP',
        potState: 'HALF',
    });
}

describe('NodeStrategyAdapter', () => {
    it('maps GameNode to BaselineContext and returns frequencies', () => {
        const node = makeTestNode();
        const freqs = NodeStrategyAdapter.computeStrategy(node);
        expect(freqs).toBeDefined();
        expect(typeof freqs.raise_pct).toBe('number');
        expect(typeof freqs.call_pct).toBe('number');
        expect(typeof freqs.fold_pct).toBe('number');
        expect(freqs.raise_pct + freqs.call_pct + freqs.fold_pct).toBe(100);
    });

    it('returns deterministic results for identical nodes', () => {
        const node1 = makeTestNode();
        const node2 = makeTestNode();
        const freqs1 = NodeStrategyAdapter.computeStrategy(node1);
        const freqs2 = NodeStrategyAdapter.computeStrategy(node2);
        expect(freqs1.raise_pct).toBe(freqs2.raise_pct);
        expect(freqs1.call_pct).toBe(freqs2.call_pct);
        expect(freqs1.fold_pct).toBe(freqs2.fold_pct);
    });
});
