import type { GameDef, MoveResult } from './types';
import { nextSeat } from './types';

// N×N boxes → (N+1)×(N+1) dots.
export const DOTS_N = 4;
export interface DotsState {
    h: boolean[];       // horizontal edges: (N+1) rows × N  → [r*N + c], r in 0..N, c in 0..N-1
    v: boolean[];       // vertical edges:   N rows × (N+1) → [r*(N+1) + c], r in 0..N-1, c in 0..N
    boxes: (number | null)[];   // N*N owner
}

const H = (r: number, c: number) => r * DOTS_N + c;
const V = (r: number, c: number) => r * (DOTS_N + 1) + c;

function boxComplete(s: DotsState, r: number, c: number): boolean {
    return s.h[H(r, c)] && s.h[H(r + 1, c)] && s.v[V(r, c)] && s.v[V(r, c + 1)];
}

export const DOTS: GameDef<DotsState> = {
    id: 'dots', name: 'Dots & Boxes', emoji: '🔲', min: 2, max: 2, dice: false, simultaneous: false,
    blurb: 'Draw lines; complete a box to claim it and go again. Most boxes wins.',
    createState: () => ({
        h: Array((DOTS_N + 1) * DOTS_N).fill(false),
        v: Array(DOTS_N * (DOTS_N + 1)).fill(false),
        boxes: Array(DOTS_N * DOTS_N).fill(null),
    }),
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    reduce(board, seat, action): MoveResult<DotsState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const dir = String(action.dir), r = Number(action.r), c = Number(action.c);
        const s: DotsState = { h: board.state.h.slice(), v: board.state.v.slice(), boxes: board.state.boxes.slice() };

        if (dir === 'h') {
            if (!(r >= 0 && r <= DOTS_N && c >= 0 && c < DOTS_N) || s.h[H(r, c)]) return { ok: false, error: 'Bad edge' };
            s.h[H(r, c)] = true;
        } else if (dir === 'v') {
            if (!(r >= 0 && r < DOTS_N && c >= 0 && c <= DOTS_N) || s.v[V(r, c)]) return { ok: false, error: 'Bad edge' };
            s.v[V(r, c)] = true;
        } else return { ok: false, error: 'Bad direction' };

        // claim any boxes newly completed by this edge → extra turn
        let claimed = 0;
        for (let br = 0; br < DOTS_N; br++) for (let bc = 0; bc < DOTS_N; bc++) {
            if (s.boxes[br * DOTS_N + bc] === null && boxComplete(s, br, bc)) { s.boxes[br * DOTS_N + bc] = seat; claimed++; }
        }
        if (s.boxes.every(x => x !== null)) {
            const a = s.boxes.filter(x => x === 0).length, b = s.boxes.filter(x => x === 1).length;
            return { ok: true, patch: { state: s, status: 'done', winnerSeat: a === b ? null : (a > b ? 0 : 1), draw: a === b } };
        }
        return { ok: true, patch: { state: s, turnSeat: claimed ? seat : nextSeat(seat, board.players.length), message: claimed ? 'Box! Go again.' : '' } };
    },
};
