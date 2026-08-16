import type { BoardState, GameDef, MoveResult } from './types';

export const R_SIZE = 8;
export interface ReversiState { grid: (number | null)[] }   // 64

const idx = (r: number, c: number) => r * R_SIZE + c;
const inB = (r: number, c: number) => r >= 0 && r < R_SIZE && c >= 0 && c < R_SIZE;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Cells that would flip if `seat` plays (r,c). Empty = illegal move. */
function flips(g: (number | null)[], r: number, c: number, seat: number): number[] {
    if (g[idx(r, c)] !== null) return [];
    const opp = 1 - seat;
    const out: number[] = [];
    for (const [dr, dc] of DIRS) {
        const line: number[] = [];
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc) && g[idx(rr, cc)] === opp) { line.push(idx(rr, cc)); rr += dr; cc += dc; }
        if (line.length && inB(rr, cc) && g[idx(rr, cc)] === seat) out.push(...line);
    }
    return out;
}
const hasMove = (g: (number | null)[], seat: number) => {
    for (let r = 0; r < R_SIZE; r++) for (let c = 0; c < R_SIZE; c++) if (flips(g, r, c, seat).length) return true;
    return false;
};

export function reversiInitial(): ReversiState {
    const grid: (number | null)[] = Array(64).fill(null);
    grid[idx(3, 3)] = 0; grid[idx(4, 4)] = 0; grid[idx(3, 4)] = 1; grid[idx(4, 3)] = 1;
    return { grid };
}
export const reversiLegal = flips;

export const REVERSI: GameDef<ReversiState> = {
    id: 'reversi', name: 'Reversi', emoji: '⚪', min: 2, max: 2, dice: false, simultaneous: false,
    blurb: 'Othello — outflank to flip discs. Most discs at the end wins.',
    createState: () => reversiInitial(),
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    reduce(board, seat, action): MoveResult<ReversiState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const r = Number(action.r), c = Number(action.c);
        const grid = board.state.grid.slice();
        const flip = flips(grid, r, c, seat);
        if (!flip.length) return { ok: false, error: 'Illegal move' };
        grid[idx(r, c)] = seat;
        for (const i of flip) grid[i] = seat;

        const finish = (): MoveResult<ReversiState> => {
            const a = grid.filter(x => x === 0).length, b = grid.filter(x => x === 1).length;
            return { ok: true, patch: { state: { grid }, status: 'done', winnerSeat: a === b ? null : (a > b ? 0 : 1), draw: a === b } };
        };
        const other = 1 - seat;
        if (grid.every(x => x !== null)) return finish();
        if (hasMove(grid, other)) return { ok: true, patch: { state: { grid }, turnSeat: other, message: '' } };
        if (hasMove(grid, seat)) return { ok: true, patch: { state: { grid }, turnSeat: seat, message: `${board.players.find(p => p.seat === other)?.nickname} has no move — you go again` } };
        return finish();
    },
};
