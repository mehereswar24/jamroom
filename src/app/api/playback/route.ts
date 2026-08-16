import { NextResponse } from 'next/server';
import * as store from '@/server/store/roomStore';
import { canControl, publishPlayback, publishQueue } from '@/server/actions';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';
import type { PlaybackState } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const effectivePos = (p: PlaybackState, now: number) =>
    p.isPlaying ? p.basePositionMs + (now - p.baseServerTime) : p.basePositionMs;

export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, meta, body } = auth;

        const limited = await rateLimit(`playback:${code}:${clientId}`, 120, 60);
        if (limited) return limited;

        const action = String(body?.action ?? '');

        // Track-end + metadata reports don't require control permission.
        const permissionless = action === 'ended' || action === 'duration' || action === 'error';
        if (!permissionless && !canControl(meta, clientId)) {
            return NextResponse.json({ ok: false, error: 'Host has playback control' }, { status: 403 });
        }

        const now = Date.now();
        const p = meta.playback;
        let next: PlaybackState | null = p;

        switch (action) {
            case 'play':
                if (!p.queueItemId) { next = await store.computeAdvance(code); await publishQueue(code); }
                else next = { ...p, basePositionMs: effectivePos(p, now), baseServerTime: now, isPlaying: true };
                break;
            case 'pause':
                next = { ...p, basePositionMs: effectivePos(p, now), baseServerTime: now, isPlaying: false };
                break;
            case 'seek': {
                const pos = Number(body?.positionMs);
                if (!Number.isFinite(pos) || pos < 0) return NextResponse.json({ ok: false, error: 'Bad position' }, { status: 400 });
                next = { ...p, basePositionMs: pos, baseServerTime: now };
                break;
            }
            case 'skip':
                next = await store.computeAdvance(code, { manual: true }); await publishQueue(code); break;
            case 'previous': {
                const r = await store.computePrevious(code);
                if (!r) return NextResponse.json({ ok: false, error: 'Nothing to go back to' }, { status: 400 });
                next = r; break;
            }
            case 'setLoop': {
                const mode = ['off', 'all', 'one'].includes(String(body?.mode)) ? String(body?.mode) as 'off' | 'all' | 'one' : 'off';
                const r = await store.setLoopMode(code, mode);
                if (r) next = r;
                break;
            }
            case 'playItem': {
                const r = await store.playItem(code, Number(body?.queueItemId));
                if (!r) return NextResponse.json({ ok: false, error: 'That track is not playable' }, { status: 400 });
                next = r; break;
            }
            case 'ended': {
                if (p.queueItemId !== Number(body?.queueItemId) || !p.isPlaying) return NextResponse.json({ ok: true });
                const item = await store.getItem(code, Number(body?.queueItemId));
                const nearEnd = item?.durationMs ? Math.abs(item.durationMs - Number(body?.positionMs)) < 3500 : false;
                if (meta.hostClientId === clientId || nearEnd) { next = await store.computeAdvance(code); await publishQueue(code); }
                else return NextResponse.json({ ok: true });
                break;
            }
            case 'duration':
                await store.setItemDuration(code, Number(body?.queueItemId), Number(body?.durationMs));
                await publishQueue(code);
                return NextResponse.json({ ok: true });
            case 'error': {
                // Auto-skip an unplayable track. Host report is authoritative;
                // a non-host report only skips if they're the only one present.
                if (p.queueItemId !== Number(body?.queueItemId)) return NextResponse.json({ ok: true });
                if (meta.hostClientId === clientId) {
                    await store.setItemStatus(code, Number(body?.queueItemId), 'failed');
                    next = await store.computeAdvance(code, { manual: true });
                    await publishQueue(code);
                    break;
                }
                return NextResponse.json({ ok: true });
            }
            default:
                return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }

        if (next && next !== p) await store.setPlayback(code, next);
        await publishPlayback(code, next!, action);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[api/playback] failed:', err);
        return NextResponse.json({ ok: false, error: 'Playback action failed' }, { status: 500 });
    }
}
