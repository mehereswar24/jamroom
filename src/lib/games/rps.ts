import type { BoardState, GameDef, MoveResult } from './types';

export type Throw = 'rock' | 'paper' | 'scissors';
export interface RpsState {
    throws: (Throw | null)[];   // per seat, current round
    scores: number[];
    target: number;             // first to N round wins
    round: number;
    lastRound: { throws: Throw[]; winnerSeat: number | null } | null;
}

const BEATS: Record<Throw, Throw> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export const RPS: GameDef<RpsState> = {
    id: 'rps', name: 'Rock Paper Scissors', emoji: '✊', min: 2, max: 2, dice: false, simultaneous: true,
    blurb: 'Best of 5. Throw at the same time — no turns.',
    createState: () => ({ throws: [null, null], scores: [0, 0], target: 3, round: 1, lastRound: null }),
    startPatch: () => ({ turnSeat: -1, phase: 'throw', message: '' }),
    reduce(board, seat, action): MoveResult<RpsState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        const t = String(action.throw) as Throw;
        if (!['rock', 'paper', 'scissors'].includes(t)) return { ok: false, error: 'Bad throw' };
        const s = board.state;
        if (s.throws[seat]) return { ok: false, error: 'Already thrown this round' };
        const throws = s.throws.slice();
        throws[seat] = t;

        if (throws.some(x => x === null)) {
            return { ok: true, patch: { state: { ...s, throws }, message: 'Waiting for the other player…' } };
        }
        // both in → resolve
        const [a, b] = throws as Throw[];
        let winnerSeat: number | null = null;
        if (a !== b) winnerSeat = BEATS[a] === b ? 0 : 1;
        const scores = s.scores.slice();
        if (winnerSeat !== null) scores[winnerSeat] += 1;
        const lastRound = { throws: [a, b], winnerSeat };
        if (scores.some(x => x >= s.target)) {
            const gw = scores[0] >= s.target ? 0 : 1;
            return { ok: true, patch: { state: { ...s, throws: [null, null], scores, lastRound }, status: 'done', winnerSeat: gw } };
        }
        return { ok: true, patch: { state: { ...s, throws: [null, null], scores, round: s.round + 1, lastRound }, message: '' } };
    },
};
