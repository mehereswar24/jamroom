import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';
import { canControl, publishPlayback, publishQueue, publishVoteSkip, voteSkipState, systemMessage } from '@/server/actions';
import { resolveUrl } from '@/server/media/resolveUrl';
import type { VideoCandidate } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const code = normalizeRoomCode(String(body?.code ?? ''));
        const clientId = String(body?.clientId ?? '').slice(0, 64);
        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);
        const action = String(body?.action ?? '');
        const meta = await store.getMeta(code);
        if (!meta) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });

        const autoStartIfIdle = async () => {
            const m = await store.getMeta(code);
            if (m && !m.playback.queueItemId) {
                const pb = await store.computeAdvance(code);
                await publishPlayback(code, pb, 'first-add');
            }
        };

        switch (action) {
            case 'add': {
                const v = body?.video as VideoCandidate;
                if (!v?.videoId || !v?.title) return NextResponse.json({ ok: false, error: 'Bad video' }, { status: 400 });
                const id = await store.addYouTubeItem(code, {
                    videoId: String(v.videoId).slice(0, 20), title: String(v.title).slice(0, 200),
                    channel: String(v.channel ?? '').slice(0, 120), durationMs: Math.max(0, Number(v.durationMs) || 0),
                    thumb: v.thumb ? String(v.thumb).slice(0, 400) : null
                }, nickname);
                await publishQueue(code); await autoStartIfIdle();
                return NextResponse.json({ ok: true, queueItemId: id });
            }
            case 'addUrl': {
                const r = await resolveUrl(String(body?.url ?? '').slice(0, 2000));
                if (r.kind === 'error') return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
                let id: number, title: string;
                if (r.kind === 'youtube') { id = await store.addYouTubeItem(code, r.video, nickname); title = r.video.title; }
                else { id = await store.addUrlItem(code, { url: r.url, title: r.title.slice(0, 200) }, nickname); title = r.title; }
                await publishQueue(code); await autoStartIfIdle();
                return NextResponse.json({ ok: true, queueItemId: id, title });
            }
            case 'remove': {
                const item = await store.getItem(code, Number(body?.queueItemId));
                if (!item) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
                if (!(canControl(meta, clientId) || item.addedBy === nickname))
                    return NextResponse.json({ ok: false, error: 'Only the host or who added it can remove' }, { status: 403 });
                if (meta.playback.queueItemId === item.id) {
                    const pb = await store.computeAdvance(code);
                    await publishPlayback(code, pb, 'removed-current');
                }
                await store.removeItem(code, item.id);
                await publishQueue(code);
                return NextResponse.json({ ok: true });
            }
            case 'reorder': {
                if (!canControl(meta, clientId)) return NextResponse.json({ ok: false, error: 'Host only' }, { status: 403 });
                const ids = (body?.orderedIds as number[]) ?? [];
                await store.reorder(code, ids.map(Number));
                await publishQueue(code);
                return NextResponse.json({ ok: true });
            }
            case 'shuffle': {
                if (!canControl(meta, clientId)) return NextResponse.json({ ok: false, error: 'Host only' }, { status: 403 });
                await store.shuffleUpcoming(code, meta.playback.queueItemId);
                await publishQueue(code);
                await systemMessage(code, `${nickname} shuffled the queue 🔀`);
                return NextResponse.json({ ok: true });
            }
            case 'voteSkip': {
                if (!meta.playback.queueItemId) return NextResponse.json({ ok: false, error: 'Nothing is playing' }, { status: 400 });
                await store.toggleVote(code, clientId);
                const state = await voteSkipState(code);
                if (state.votes >= state.needed) {
                    await systemMessage(code, 'Vote passed — skipping track');
                    const pb = await store.computeAdvance(code);
                    await publishPlayback(code, pb, 'vote-skip');
                    await publishQueue(code);
                    await publishVoteSkip(code);
                } else {
                    await publishVoteSkip(code);
                }
                return NextResponse.json({ ok: true });
            }
            case 'fixMatch': {
                const v = body?.video as VideoCandidate;
                const item = await store.getItem(code, Number(body?.queueItemId));
                if (!item || !v?.videoId) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
                await store.setItemMatch(code, item.id, String(v.videoId).slice(0, 20), 'matched', 1);
                if (meta.playback.queueItemId === item.id) {
                    const pb = await store.playItem(code, item.id);
                    if (pb) await publishPlayback(code, pb, 'fix-match');
                }
                await publishQueue(code);
                return NextResponse.json({ ok: true });
            }
            default:
                return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        console.error('[api/queue] failed:', err);
        return NextResponse.json({ ok: false, error: `Queue action failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
}
