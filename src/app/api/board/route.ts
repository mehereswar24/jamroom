import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { EV } from '@/lib/channels';
import * as board from '@/server/store/boardStore';
import * as store from '@/server/store/roomStore';
import { publish } from '@/server/realtime/publish';
import type { BoardGameId, BoardState } from '@/lib/games/types';
import { getGameDef } from '@/lib/games/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const code = normalizeRoomCode(String(body?.code ?? ''));
        const clientId = String(body?.clientId ?? '').slice(0, 64);
        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);
        const action = String(body?.action ?? '');
        if (!(await store.roomExists(code))) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });

        const push = (b: BoardState | null) => (b ? publish(code, EV.boardState, b) : Promise.resolve());

        switch (action) {
            case 'create': {
                const gameId = String(body?.gameId) as BoardGameId;
                if (!getGameDef(gameId)) return NextResponse.json({ ok: false, error: 'Unknown game' }, { status: 400 });
                const b = await board.createBoard(code, gameId, { clientId, nickname, seat: 0 });
                await push(b);
                return NextResponse.json({ ok: true });
            }
            case 'join': {
                const b = await board.joinBoard(code, { clientId, nickname });
                await push(b);
                return NextResponse.json({ ok: true });
            }
            case 'start': {
                const b = await board.startBoard(code, clientId);
                if (!b) return NextResponse.json({ ok: false, error: 'Cannot start (host only, need enough players)' }, { status: 400 });
                await push(b);
                return NextResponse.json({ ok: true });
            }
            case 'move': {
                const { board: b, error } = await board.moveBoard(code, clientId, (body?.move ?? {}) as Record<string, unknown>);
                if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
                await push(b);
                return NextResponse.json({ ok: true });
            }
            case 'restart': {
                const b = await board.restartBoard(code, clientId);
                await push(b);
                return NextResponse.json({ ok: true });
            }
            case 'exit': {
                // host closes the game back to the hub
                const b = await board.getBoard(code);
                if (b && b.hostClientId === clientId) {
                    await board.clearBoard(code);
                    await publish(code, EV.boardState, null);
                }
                return NextResponse.json({ ok: true });
            }
            default:
                return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        console.error('[api/board] failed:', err);
        return NextResponse.json({ ok: false, error: `Board action failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
}
