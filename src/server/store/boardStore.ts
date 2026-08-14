/** Turn-based board-game state in Upstash Redis (one blob per room). */

import { getRedis, ROOM_TTL_SECONDS } from './redis';
import { getGameDef } from '../../lib/games/registry';
import type { BoardGameId, BoardState, Seat } from '../../lib/games/types';

const key = (code: string) => `jr:${code}:board`;

export async function getBoard(code: string): Promise<BoardState | null> {
    return (await getRedis().get<BoardState>(key(code))) ?? null;
}
async function save(code: string, b: BoardState): Promise<void> {
    b.updatedAt = Date.now();
    await getRedis().set(key(code), b, { ex: ROOM_TTL_SECONDS });
}
export async function clearBoard(code: string): Promise<void> {
    await getRedis().del(key(code));
}

export async function createBoard(code: string, gameId: BoardGameId, host: Seat): Promise<BoardState | null> {
    const def = getGameDef(gameId);
    if (!def) return null;
    const b: BoardState = {
        gameId, status: 'waiting', players: [{ ...host, seat: 0 }],
        hostClientId: host.clientId, turnSeat: 0, state: def.createState(def.max),
        winnerSeat: null, draw: false, lastRoll: null, phase: 'lobby', message: '', updatedAt: Date.now(),
    };
    await save(code, b);
    return b;
}

export async function joinBoard(code: string, p: Omit<Seat, 'seat'>): Promise<BoardState | null> {
    const b = await getBoard(code);
    if (!b || b.status !== 'waiting') return b;
    if (b.players.some(x => x.clientId === p.clientId)) return b;   // already in
    const def = getGameDef(b.gameId)!;
    if (b.players.length >= def.max) return b;
    b.players.push({ ...p, seat: b.players.length });
    await save(code, b);
    return b;
}

export async function startBoard(code: string, clientId: string): Promise<BoardState | null> {
    const b = await getBoard(code);
    if (!b || b.status !== 'waiting' || b.hostClientId !== clientId) return null;
    const def = getGameDef(b.gameId)!;
    if (b.players.length < def.min) return null;
    b.state = def.createState(b.players.length);
    b.status = 'playing';
    Object.assign(b, def.startPatch(b));
    await save(code, b);
    return b;
}

export async function moveBoard(code: string, clientId: string, action: Record<string, unknown>): Promise<{ board: BoardState | null; error?: string }> {
    const b = await getBoard(code);
    if (!b) return { board: null, error: 'No game' };
    const me = b.players.find(p => p.clientId === clientId);
    if (!me) return { board: b, error: 'You are not in this game' };
    const def = getGameDef(b.gameId)!;
    const r = def.reduce(b, me.seat, action);
    if (!r.ok) return { board: b, error: r.error };
    Object.assign(b, r.patch);
    await save(code, b);
    return { board: b };
}

export async function restartBoard(code: string, clientId: string): Promise<BoardState | null> {
    const b = await getBoard(code);
    if (!b || b.hostClientId !== clientId) return null;
    const def = getGameDef(b.gameId)!;
    b.state = def.createState(b.players.length);
    b.status = 'playing';
    b.winnerSeat = null; b.draw = false; b.lastRoll = null;
    Object.assign(b, def.startPatch(b));
    await save(code, b);
    return b;
}
