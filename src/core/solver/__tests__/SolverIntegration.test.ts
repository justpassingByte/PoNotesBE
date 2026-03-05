import { SolverEngine } from '../SolverEngine';
import { RangeInitializer } from '../RangeInitializer';
import { NodeStrategyAdapter } from '../NodeStrategyAdapter';
import { RangeMath } from '../RangeMath';
import { HandClassGenerator } from '../HandClassGenerator';
import { GameNode } from '../GameNode';
import type { SolverConfig } from '../SolverEngine';

/** Helper: sum all values in a RangeState. */
function sumRange(range: { get(hand: string): number }): number {
    const hands = HandClassGenerator.generateAll();
    let sum = 0;
    for (const hand of hands) {
        sum += range.get(hand);
    }
    return sum;
}

const DEFAULT_CONFIG: SolverConfig = {
    spot: 'SRP_IP',
    stack: 'DEEP',
    street: 'preflop',
    potState: 'HALF',
};

// ─── Integration: Full Node Split Lifecycle ──────────────────────

describe('Integration: Full Node Split Lifecycle', () => {
    it('initializes GameNode via RangeInitializer with deep stack, preflop', () => {
        const root = SolverEngine.initRoot(DEFAULT_CONFIG);
        expect(root).toBeInstanceOf(GameNode);
        expect(root.range.size).toBe(169);
        expect(Math.abs(sumRange(root.range) - 100)).toBeLessThan(1e-8);
    });

    it('computes strategy via NodeStrategyAdapter', () => {
        const root = SolverEngine.initRoot(DEFAULT_CONFIG);
        const freqs = NodeStrategyAdapter.computeStrategy(root);
        expect(freqs.raise_pct + freqs.call_pct + freqs.fold_pct).toBe(100);
    });

    it('splits range into 3 valid child RangeStates', () => {
        const root = SolverEngine.solveStep(DEFAULT_CONFIG);
        const children = root.children!;

        expect(children).toBeDefined();
        expect(children.raise).toBeInstanceOf(GameNode);
        expect(children.call).toBeInstanceOf(GameNode);
        expect(children.fold).toBeInstanceOf(GameNode);

        for (const child of [children.raise, children.call, children.fold]) {
            // Exactly 169 keys
            expect(child.range.size).toBe(169);

            // No negative values
            for (const [, v] of child.range.entries()) {
                expect(v).toBeGreaterThanOrEqual(0);
            }

            // Sum is either 100 (active branch) or 0 (disabled branch)
            const sum = sumRange(child.range);
            const isHundred = Math.abs(sum - 100) < 1e-8;
            const isZero = Math.abs(sum) < 1e-8;
            expect(isHundred || isZero).toBe(true);
        }
    });

    it('preflop SRP root disables call, but non-root preflop nodes can still call', () => {
        const root = SolverEngine.initRoot(DEFAULT_CONFIG);
        const rootChildren = SolverEngine.expandNode(root);

        const rootCallSum = sumRange(rootChildren.call.range);
        expect(Math.abs(rootCallSum)).toBeLessThan(1e-8);

        const raiseChildren = SolverEngine.expandNode(rootChildren.raise);
        const nonRootCallSum = sumRange(raiseChildren.call.range);
        expect(nonRootCallSum).toBeGreaterThan(0);
    });

    it('child nodes have correct structural metadata', () => {
        const root = SolverEngine.solveStep(DEFAULT_CONFIG);
        const children = root.children!;

        expect(children.raise.actionTaken).toBe('raise');
        expect(children.call.actionTaken).toBe('call');
        expect(children.fold.actionTaken).toBe('fold');

        expect(children.raise.parent).toBe(root);
        expect(children.call.parent).toBe(root);
        expect(children.fold.parent).toBe(root);

        expect(children.raise.street).toBe('preflop');
    });

    it('prevents double expansion', () => {
        const root = SolverEngine.solveStep(DEFAULT_CONFIG);
        expect(() => {
            root.expand({ raise_pct: 33, call_pct: 34, fold_pct: 33 });
        }).toThrow('already been expanded');
    });
});

// ─── Performance ──────────────────────────────────────────────────

describe('Performance', () => {
    it('full solve step completes in < 10ms', () => {
        // Warm up
        SolverEngine.solveStep(DEFAULT_CONFIG);

        const start = performance.now();
        SolverEngine.solveStep(DEFAULT_CONFIG);
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(10);
    });
});
