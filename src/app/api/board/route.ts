import { NextResponse } from 'next/server';
import { EV } from '@/lib/channels';
import * as board from '@/server/store/boardStore';
import { publish } from '@/server/realtime/publish';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';
import type { BoardGameId, BoardState } from '@/lib/games/types';
import { getGameDef } from '@/lib/games/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, body } = auth;

        const limited = await rateLimit(`board:${code}:${clientId}`, 120, 60);
        if (limited) return limited;

        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);
        const action = String(body?.action ?? '');

        const redacted = (b: BoardState): BoardState => {
            const def = getGameDef(b.gameId);
            return def?.redact ? def.redact(b) : b;
        };
        const push = (b: BoardState | null) => (b ? publish(code, EV.boardState, redacted(b)) : Promise.resolve());

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
                // Allows host or players to leave/clear the board game back to the hub
                const b = await board.getBoard(code);
                if (b) {
                    if (b.hostClientId === clientId) {
                        await board.clearBoard(code);
                        await publish(code, EV.boardState, null);
                    } else {
                        b.players = b.players.filter(p => p.clientId !== clientId);
                        if (b.players.length === 0) {
                            await board.clearBoard(code);
                            await publish(code, EV.boardState, null);
                        } else {
                            await publish(code, EV.boardState, redacted(b));
                        }
                    }
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
