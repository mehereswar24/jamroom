import { NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { EV } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { publish } from '@/server/realtime/publish';
import { publishQueue, publishPlayback } from '@/server/actions';
import { searchYouTube } from '@/server/youtube/search';
import { MATCH_THRESHOLD, normalizeQuery, pickBestMatch } from '@/server/youtube/match';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Match one chunk of already-queued Spotify placeholders to YouTube.
// Searches run concurrently within the chunk; results are written to Redis in a
// single batch (not per-track) to avoid O(n²) rewrites of the whole queue.
export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, body } = auth;

        // Chunks of 24 tracks; this budget covers a ~2000-track playlist per hour.
        const limited = await rateLimit(`importBatch:${code}:${clientId}`, 100, 3600);
        if (limited) return limited;

        const ids = ((body?.ids as number[]) ?? []).map(Number).slice(0, 24);
        const total = Number(body?.total) || 0;
        const doneBefore = Number(body?.doneBefore) || 0;
        const playlistName = String(body?.playlistName ?? 'Playlist');
        const importId = String(body?.importId ?? '');
        if (!ids.length) return NextResponse.json({ ok: true, matched: 0, needsReview: 0, failed: 0 });

        const queue = await store.listQueue(code);
        const byId = new Map(queue.map(q => [q.id, q]));
        const limit = pLimit(4);

        const updates = await Promise.all(ids.map(id => limit(async (): Promise<store.MatchUpdate | null> => {
            const item = byId.get(id);
            if (!item || item.matchStatus === 'matched') return null;
            const track = { artist: item.artist ?? '', title: item.title, durationMs: item.durationMs };
            try {
                let candidates = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try { candidates = await searchYouTube(normalizeQuery(track.artist, track.title), 5); break; }
                    catch { if (attempt === 2) throw new Error('search failed'); await new Promise(r => setTimeout(r, 350 * (attempt + 1))); }
                }
                const best = candidates?.length ? pickBestMatch(candidates, track) : null;
                if (best) {
                    const score = Math.round(best.score * 100) / 100;
                    return { id, videoId: best.candidate.videoId, status: best.score >= MATCH_THRESHOLD ? 'matched' : 'needs_review', score };
                }
                return { id, videoId: null, status: 'failed', score: null };
            } catch {
                return { id, videoId: null, status: 'failed', score: null };
            }
        })));

        const applied = updates.filter((u): u is store.MatchUpdate => !!u);
        let matched = 0, needsReview = 0, failed = 0;
        for (const u of applied) {
            if (u.status === 'matched') matched++; else if (u.status === 'needs_review') needsReview++; else failed++;
        }

        // One read + one write for the whole chunk.
        await store.applyMatches(code, applied);

        // Auto-start on the first playable match if nothing is playing yet.
        const meta = await store.getMeta(code);
        if (meta && !meta.playback.queueItemId) {
            const firstGood = applied.find(u => u.videoId && u.status !== 'failed');
            if (firstGood) {
                const pb = await store.playItem(code, firstGood.id);
                if (pb) await publishPlayback(code, pb, 'import-autostart');
            }
        }

        const done = doneBefore + ids.length;
        await publishQueue(code);
        await publish(code, EV.importProgress, { importId, done, total, playlistName, current: null, lastResult: null });
        if (done >= total) {
            await publish(code, EV.importComplete, { importId, playlistName, matched, needsReview, failed });
        }
        return NextResponse.json({ ok: true, matched, needsReview, failed, done });
    } catch (err) {
        console.error('[api/import/batch] failed:', err);
        return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Batch match failed' }, { status: 500 });
    }
}
