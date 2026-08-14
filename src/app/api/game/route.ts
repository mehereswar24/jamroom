import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { EV } from '@/lib/channels';
import { publicState } from '@/server/store/gameStore';
import * as game from '@/server/store/gameStore';
import * as store from '@/server/store/roomStore';
import { getPresence } from '@/server/realtime/presence';
import { publish } from '@/server/realtime/publish';
import type { GameFeedMsg } from '@/lib/game';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const feedId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const code = normalizeRoomCode(String(body?.code ?? ''));
        const clientId = String(body?.clientId ?? '').slice(0, 64);
        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);
        const action = String(body?.action ?? '');
        if (!(await store.roomExists(code))) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });

        const pushState = (g: game.GameStateInternal) => publish(code, EV.gameState, publicState(g));
        const pushFeed = (m: Omit<GameFeedMsg, 'id'>) => publish(code, EV.gameFeed, { id: feedId(), ...m });

        switch (action) {
            case 'start': {
                const members = await getPresence(code);
                if (members.length < 2) return NextResponse.json({ ok: false, error: 'Need at least 2 players in the room to start' }, { status: 400 });
                const names: Record<string, string> = {};
                for (const m of members) names[m.clientId] = m.nickname;
                const g = await game.startGame(code, {
                    turnOrder: members.map(m => m.clientId), names,
                    totalRounds: Number(body?.totalRounds) || undefined,
                    drawTimeSec: Number(body?.drawTimeSec) || undefined,
                });
                if (!g) return NextResponse.json({ ok: false, error: 'Could not start game' }, { status: 400 });
                await pushState(g);
                await pushFeed({ clientId: null, nickname: 'game', kind: 'system', text: `${nickname} started Doodle & Guess!` });
                return NextResponse.json({ ok: true });
            }
            case 'pickWord': {
                const word = String(body?.word ?? '');
                const g = await game.pickWord(code, clientId, word);
                if (!g) return NextResponse.json({ ok: false, error: 'Cannot pick that word' }, { status: 400 });
                await pushState(g);
                return NextResponse.json({ ok: true });
            }
            case 'guess': {
                const text = String(body?.text ?? '').slice(0, 60).trim();
                if (!text) return NextResponse.json({ ok: false, error: 'Empty guess' }, { status: 400 });
                const r = await game.applyGuess(code, clientId, nickname, text);
                if (!r) return NextResponse.json({ ok: false, error: 'No active round' }, { status: 400 });
                if (r.correct) {
                    await pushFeed({ clientId, nickname, kind: 'correct', text: '' });   // word stays secret
                    await pushState(r.game);
                    if (r.allGuessed) {
                        const ended = await game.advanceRound(code, r.game.roundToken);
                        if (ended) { await pushState(ended); await pushFeed({ clientId: null, nickname: 'game', kind: 'system', text: `Everyone guessed it! The word was "${ended.revealedWord}".` }); }
                    }
                    return NextResponse.json({ ok: true, correct: true, points: r.points });
                }
                // wrong guess is shown to everyone; "close" hint is private to the guesser
                await pushFeed({ clientId, nickname, kind: 'guess', text });
                return NextResponse.json({ ok: true, correct: false, close: r.close });
            }
            case 'advance': {
                const g = await game.advanceRound(code, Number(body?.roundToken));
                if (g) { await pushState(g); await pushFeed({ clientId: null, nickname: 'game', kind: 'system', text: `Time! The word was "${g.revealedWord}".` }); }
                return NextResponse.json({ ok: true });
            }
            case 'next': {
                const g = await game.nextRound(code, Number(body?.roundToken));
                if (g) await pushState(g);
                return NextResponse.json({ ok: true });
            }
            case 'end': {
                const g = await game.endGame(code);
                if (g) { await pushState(g); await pushFeed({ clientId: null, nickname: 'game', kind: 'system', text: `${nickname} ended the game.` }); }
                return NextResponse.json({ ok: true });
            }
            default:
                return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        console.error('[api/game] failed:', err);
        return NextResponse.json({ ok: false, error: `Game action failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
}
