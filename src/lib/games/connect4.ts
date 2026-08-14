import type { BoardState, GameDef, MoveResult } from './types';
import { nextSeat } from './types';

export const C4_ROWS = 6, C4_COLS = 7;
export interface C4State { grid: (number | null)[] }   // ROWS*COLS, row-major, [r*COLS+c]

const at = (g: (number | null)[], r: number, c: number) =>
    (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS) ? undefined : g[r * C4_COLS + c];

function wins(g: (number | null)[], seat: number): boolean {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
        if (g[r * C4_COLS + c] !== seat) continue;
        for (const [dr, dc] of dirs) {
            if ([1, 2, 3].every(k => at(g, r + dr * k, c + dc * k) === seat)) return true;
        }
    }
    return false;
}

export const CONNECT4: GameDef<C4State> = {
    id: 'connect4', name: 'Connect 4', emoji: '🔵', min: 2, max: 2, dice: false, simultaneous: false,
    blurb: 'Drop discs, connect four in a row — across, down, or diagonally.',
    createState: () => ({ grid: Array(C4_ROWS * C4_COLS).fill(null) }),
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    reduce(board, seat, action): MoveResult<C4State> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const col = Number(action.col);
        if (!(col >= 0 && col < C4_COLS)) return { ok: false, error: 'Bad column' };
        const grid = board.state.grid.slice();
        let row = -1;
        for (let r = C4_ROWS - 1; r >= 0; r--) if (grid[r * C4_COLS + col] === null) { row = r; break; }
        if (row < 0) return { ok: false, error: 'Column full' };
        grid[row * C4_COLS + col] = seat;

        if (wins(grid, seat)) return { ok: true, patch: { state: { grid }, status: 'done', winnerSeat: seat } };
        if (grid.every(c => c !== null)) return { ok: true, patch: { state: { grid }, status: 'done', draw: true } };
        return { ok: true, patch: { state: { grid }, turnSeat: nextSeat(seat, board.players.length) } };
    },
};
