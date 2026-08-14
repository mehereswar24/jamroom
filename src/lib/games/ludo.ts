import type { BoardState, GameDef, MoveResult } from './types';
import { nextSeat, rng6 } from './types';

/**
 * Ludo. Per-player relative token positions:
 *   -1        in base (yard)
 *   0..50     main track (51 shared cells from this player's start)
 *   51..55    home column (private, 5 cells)
 *   56        finished (needs an exact landing)
 * Captures happen only on the main track and not on safe squares.
 */
export interface LudoState { tokens: number[][] }   // tokens[player][0..3]

export const LUDO_MAIN = 52;
const START_OFFSET = (p: number) => p * 13;
const SAFE_ABS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);   // start + star squares
export const FINISH = 56;

/** Absolute cell (0..51) on the shared loop for a main-track relative position. */
export function ludoAbsolute(seat: number, rel: number): number | null {
    if (rel < 0 || rel > 50) return null;   // base or home column → not on shared loop
    return (START_OFFSET(seat) + rel) % LUDO_MAIN;
}

function legalTokens(state: LudoState, seat: number, roll: number): number[] {
    const mine = state.tokens[seat];
    const out: number[] = [];
    mine.forEach((rel, t) => {
        if (rel === -1) { if (roll === 6) out.push(t); return; }
        if (rel === FINISH) return;
        if (rel + roll <= FINISH) out.push(t);
    });
    return out;
}

export const LUDO: GameDef<LudoState> = {
    id: 'ludo', name: 'Ludo', emoji: '🎲', min: 2, max: 4, dice: true, simultaneous: false,
    blurb: 'Race 4 tokens home. Roll a 6 to start, capture rivals, land home exactly.',
    createState: (n) => ({ tokens: Array.from({ length: n }, () => [-1, -1, -1, -1]) }),
    startPatch: () => ({ turnSeat: 0, phase: 'roll', lastRoll: null, message: 'Roll to start' }),
    reduce(board, seat, action): MoveResult<LudoState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const n = board.players.length;
        const type = String(action.type);

        if (type === 'roll') {
            if (board.phase !== 'roll') return { ok: false, error: 'Already rolled' };
            const roll = rng6();
            const legal = legalTokens(board.state, seat, roll);
            if (legal.length === 0) {
                // nothing to move — pass (a 6 with no move still passes)
                return { ok: true, patch: { lastRoll: roll, turnSeat: nextSeat(seat, n), phase: 'roll', message: 'No move — turn passes' } };
            }
            return { ok: true, patch: { lastRoll: roll, phase: 'move', message: 'Pick a token to move' } };
        }

        if (type === 'move') {
            if (board.phase !== 'move' || board.lastRoll == null) return { ok: false, error: 'Roll first' };
            const roll = board.lastRoll;
            const t = Number(action.token);
            const legal = legalTokens(board.state, seat, roll);
            if (!legal.includes(t)) return { ok: false, error: 'Illegal token' };

            const tokens = board.state.tokens.map(row => row.slice());
            const rel = tokens[seat][t];
            const newRel = rel === -1 ? 0 : rel + roll;
            tokens[seat][t] = newRel;

            // capture: only on the main track and not on a safe square
            let captured = false;
            const abs = ludoAbsolute(seat, newRel);
            if (abs !== null && !SAFE_ABS.has(abs)) {
                for (let p = 0; p < n; p++) {
                    if (p === seat) continue;
                    tokens[p].forEach((r, i) => {
                        if (ludoAbsolute(p, r) === abs) { tokens[p][i] = -1; captured = true; }
                    });
                }
            }
            const finishedToken = newRel === FINISH;
            const won = tokens[seat].every(r => r === FINISH);
            if (won) return { ok: true, patch: { state: { tokens }, status: 'done', winnerSeat: seat } };

            const again = roll === 6 || captured || finishedToken;
            return {
                ok: true,
                patch: {
                    state: { tokens }, phase: 'roll',
                    turnSeat: again ? seat : nextSeat(seat, n),
                    lastRoll: null,
                    message: again ? 'Bonus roll!' : '',
                },
            };
        }

        return { ok: false, error: 'Unknown action' };
    },
};
