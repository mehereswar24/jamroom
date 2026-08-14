import type { BoardState, GameDef, MoveResult } from './types';
import { nextSeat } from './types';

export interface TttState { cells: (number | null)[] }   // 9 cells, value = seat

const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

export const TTT: GameDef<TttState> = {
    id: 'ttt', name: 'Tic-Tac-Toe', emoji: '⭕', min: 2, max: 2, dice: false, simultaneous: false,
    blurb: 'Classic 3-in-a-row. First to line up three wins.',
    createState: () => ({ cells: Array(9).fill(null) }),
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    reduce(board, seat, action): MoveResult<TttState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const cell = Number(action.cell);
        const cells = board.state.cells.slice();
        if (!(cell >= 0 && cell < 9) || cells[cell] !== null) return { ok: false, error: 'Bad move' };
        cells[cell] = seat;

        const won = LINES.some(l => l.every(i => cells[i] === seat));
        const full = cells.every(c => c !== null);
        if (won) return { ok: true, patch: { state: { cells }, status: 'done', winnerSeat: seat } };
        if (full) return { ok: true, patch: { state: { cells }, status: 'done', draw: true } };
        return { ok: true, patch: { state: { cells }, turnSeat: nextSeat(seat, board.players.length) } };
    },
};
