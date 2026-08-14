import type { BoardState, GameDef, MoveResult } from './types';
import { nextSeat, rng6 } from './types';

export interface SnakesState { pos: number[] }   // per player, 0..100

// Classic-ish board. from → to (ladders go up, snakes go down).
export const JUMPS: Record<number, number> = {
    1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,   // ladders
    16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78, // snakes
};

export const SNAKES: GameDef<SnakesState> = {
    id: 'snakes', name: 'Snakes & Ladders', emoji: '🐍', min: 2, max: 4, dice: true, simultaneous: false,
    blurb: 'Roll the die, climb ladders, dodge snakes. First to 100 wins.',
    createState: (n) => ({ pos: Array(n).fill(0) }),
    startPatch: () => ({ turnSeat: 0, phase: 'roll', lastRoll: null, message: '' }),
    reduce(board, seat, action): MoveResult<SnakesState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        if (String(action.type) !== 'roll') return { ok: false, error: 'Roll the die' };

        const roll = rng6();
        const pos = board.state.pos.slice();
        let p = pos[seat] + roll;
        if (p > 100) p = pos[seat];          // need exact 100 — overshoot stays
        if (JUMPS[p] !== undefined) p = JUMPS[p];
        pos[seat] = p;

        if (p === 100) return { ok: true, patch: { state: { pos }, lastRoll: roll, status: 'done', winnerSeat: seat } };
        // roll of 6 grants another turn
        const turnSeat = roll === 6 ? seat : nextSeat(seat, board.players.length);
        return { ok: true, patch: { state: { pos }, lastRoll: roll, turnSeat, message: roll === 6 ? 'Rolled a 6 — go again!' : '' } };
    },
};
