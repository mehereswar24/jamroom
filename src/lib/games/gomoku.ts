import type { GameDef, MoveResult } from './types';
import { nextSeat } from './types';

export const GOMOKU_SIZE = 15;
export interface GomokuState { grid: (number | null)[] }   // SIZE*SIZE

const idx = (r: number, c: number) => r * GOMOKU_SIZE + c;
const inB = (r: number, c: number) => r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE;

function wins(g: (number | null)[], r: number, c: number, seat: number): boolean {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let count = 1;
        for (const s of [1, -1]) {
            let rr = r + dr * s, cc = c + dc * s;
            while (inB(rr, cc) && g[idx(rr, cc)] === seat) { count++; rr += dr * s; cc += dc * s; }
        }
        if (count >= 5) return true;
    }
    return false;
}

export const GOMOKU: GameDef<GomokuState> = {
    id: 'gomoku', name: 'Gomoku', emoji: '⚫', min: 2, max: 2, dice: false, simultaneous: false,
    blurb: 'Five in a row on a 15×15 board — place a stone anywhere.',
    createState: () => ({ grid: Array(GOMOKU_SIZE * GOMOKU_SIZE).fill(null) }),
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    reduce(board, seat, action): MoveResult<GomokuState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const r = Number(action.r), c = Number(action.c);
        if (!inB(r, c)) return { ok: false, error: 'Off board' };
        const grid = board.state.grid.slice();
        if (grid[idx(r, c)] !== null) return { ok: false, error: 'Taken' };
        grid[idx(r, c)] = seat;
        if (wins(grid, r, c, seat)) return { ok: true, patch: { state: { grid }, status: 'done', winnerSeat: seat } };
        if (grid.every(x => x !== null)) return { ok: true, patch: { state: { grid }, status: 'done', draw: true } };
        return { ok: true, patch: { state: { grid }, turnSeat: nextSeat(seat, board.players.length) } };
    },
};
