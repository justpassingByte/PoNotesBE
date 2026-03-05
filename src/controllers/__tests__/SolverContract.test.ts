import type { Request, Response } from 'express';
import { SolverController } from '../SolverController';
import { SolverEngine } from '../../core/solver/SolverEngine';

jest.mock('../../core/solver/SolverEngine', () => ({
    SolverEngine: {
        solve: jest.fn(),
    },
}));

const mockSolve = SolverEngine.solve as jest.MockedFunction<typeof SolverEngine.solve>;

function makeRes(): Response {
    const res = {} as Response;
    (res.status as unknown) = jest.fn().mockReturnValue(res);
    (res.json as unknown) = jest.fn().mockReturnValue(res);
    return res;
}

describe('SolverController Contract', () => {
    beforeEach(() => {
        mockSolve.mockReset();
        mockSolve.mockReturnValue({
            AA: { raise: 0.7, call: 0.3, fold: 0 },
        } as any);
    });

    it('maps alias spot + numeric stack and returns direct per-hand response data', async () => {
        const req = {
            body: {
                spot: '3BET_IP',
                stack: '100',
                street: 'flop',
                shapingMode: 'balanced',
                villainType: 'NEUTRAL',
                board: {
                    suitedness: 'RAINBOW',
                    pairedStatus: 'UNPAIRED',
                    highCardTier: 'ACE_HIGH',
                    connectivity: 'CONNECTED',
                },
            },
        } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(mockSolve).toHaveBeenCalledWith(expect.objectContaining({
            spot: '3BP_IP',
            stack: 'DEEP',
            street: 'flop',
            board: expect.objectContaining({ connectivity: 'CONNECTED' }),
        }));

        expect((res.json as unknown as jest.Mock).mock.calls[0][0]).toEqual({
            success: true,
            data: {
                AA: { raise: 0.7, call: 0.3, fold: 0 },
            },
        });
    });

    it('maps legacy connectivity DISCONNECTED -> DRY', async () => {
        const req = {
            body: {
                spot: 'SRP_IP',
                stack: '80',
                street: 'turn',
                board: {
                    suitedness: 'RAINBOW',
                    pairedStatus: 'UNPAIRED',
                    highCardTier: 'KING_HIGH',
                    connectivity: 'DISCONNECTED',
                },
            },
        } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(mockSolve).toHaveBeenCalledWith(expect.objectContaining({
            board: expect.objectContaining({ connectivity: 'DRY' }),
        }));
    });

    it('maps legacy connectivity SEMI_CONNECTED -> CONNECTED', async () => {
        const req = {
            body: {
                spot: 'SRP_IP',
                stack: '80',
                street: 'turn',
                board: {
                    suitedness: 'TWO_TONE',
                    pairedStatus: 'UNPAIRED',
                    highCardTier: 'QUEEN_HIGH',
                    connectivity: 'SEMI_CONNECTED',
                },
            },
        } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(mockSolve).toHaveBeenCalledWith(expect.objectContaining({
            board: expect.objectContaining({ connectivity: 'CONNECTED' }),
        }));
    });

    it('accepts VERY_CONNECTED connectivity', async () => {
        const req = {
            body: {
                spot: 'SRP_IP',
                stack: '80',
                street: 'turn',
                board: {
                    suitedness: 'TWO_TONE',
                    pairedStatus: 'UNPAIRED',
                    highCardTier: 'KING_HIGH',
                    connectivity: 'VERY_CONNECTED',
                },
            },
        } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(mockSolve).toHaveBeenCalled();
    });

    it('returns 400 for unknown spot values', async () => {
        const req = { body: { spot: 'RFI_BTN', stack: '100' } } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockSolve).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid stack values', async () => {
        const req = { body: { spot: 'SRP_IP', stack: 'very-deep-ish' } } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockSolve).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid postflop board connectivity', async () => {
        const req = {
            body: {
                spot: 'SRP_IP',
                stack: '80',
                street: 'turn',
                board: {
                    suitedness: 'RAINBOW',
                    pairedStatus: 'UNPAIRED',
                    highCardTier: 'KING_HIGH',
                    connectivity: 'INVALID_CONNECTIVITY',
                },
            },
        } as Request;
        const res = makeRes();

        await SolverController.solve(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockSolve).not.toHaveBeenCalled();
    });
});
