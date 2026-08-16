import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { EV } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { publish } from '@/server/realtime/publish';
import { publishQueue, publishPlayback, systemMessage } from '@/server/actions';
import { fetchPlaylist, parsePlaylistId } from '@/server/spotify/spotifyClient';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Phase 1 of import: fetch the whole playlist (fast) and insert placeholders.
// Matching happens in /api/import/batch, driven by the client (chunked to stay
// under the serverless time limit).
export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, body } = auth;

        // Each import fans out into a Spotify fetch plus hundreds of YouTube
        // searches, so this is the most expensive route in the app.
        const limited = await rateLimit(`import:${code}:${clientId}`, 5, 3600);
        if (limited) return limited;

        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);

        // Two sources: a Spotify playlist URL, or a client-provided track list
        // (the "paste songs" tab).
        let playlistName = 'Playlist';
        let tracks: Array<{ name: string; artist: string; durationMs: number; albumArt: string | null; spotifyTrackId: string }> = [];

        const clientTracks = body?.clientTracks as Array<{ name: string; artist?: string; durationMs?: number }> | undefined;
        if (clientTracks?.length) {
            playlistName = String(body?.playlistName ?? 'Pasted songs').slice(0, 80);
            tracks = clientTracks.slice(0, 1000).map(t => ({
                name: String(t.name).slice(0, 200), artist: String(t.artist ?? '').slice(0, 120),
                durationMs: Number(t.durationMs) || 0, albumArt: null, spotifyTrackId: ''
            }));
        } else {
            const playlistId = parsePlaylistId(String(body?.playlistUrl ?? ''));
            if (!playlistId) return NextResponse.json({ ok: false, error: 'That does not look like a Spotify playlist link' }, { status: 400 });
            try {
                const playlist = await fetchPlaylist(playlistId);
                playlistName = playlist.name;
                tracks = playlist.tracks.map(t => ({ name: t.name, artist: t.artist, durationMs: t.durationMs, albumArt: t.albumArt, spotifyTrackId: t.spotifyTrackId }));
            } catch (err) {
                return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Spotify fetch failed' }, { status: 400 });
            }
        }
        if (!tracks.length) return NextResponse.json({ ok: false, error: 'No importable tracks' }, { status: 400 });

        const ids = await store.addSpotifyPlaceholders(code, tracks, nickname);

        const importId = randomUUID();
        await publishQueue(code);
        await systemMessage(code, `${nickname} is importing “${playlistName}” (${tracks.length} tracks)…`);
        await publish(code, EV.importProgress, {
            importId, done: 0, total: ids.length, playlistName, current: null, lastResult: null
        });
        void publishPlayback; // (batch triggers auto-start on first match)

        return NextResponse.json({ ok: true, importId, playlistName, ids, total: ids.length });
    } catch (err) {
        console.error('[api/import/start] failed:', err);
        return NextResponse.json({ ok: false, error: `Import failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
}
