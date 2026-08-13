/**
 * Spotify playlist reader. Three paths, in order:
 *
 *   1. Official Web API with client-credentials — works fully only for apps
 *      with extended quota (new dev-mode apps get 403 on /tracks since 2025).
 *   2. Embed page + pathfinder GraphQL — the embed page at
 *      open.spotify.com/embed/playlist/{id} carries an anonymous accessToken
 *      in its __NEXT_DATA__; that token is authorized for Spotify's internal
 *      api-partner.spotify.com pathfinder API, which paginates the FULL track
 *      list (offset/limit). This is the path that fixes the ~100-track cap.
 *   3. Embed page trackList alone — capped at ~100 tracks, last resort.
 */

export interface SpotifyTrack {
    name: string;
    artist: string;         // primary artist
    artists: string[];
    durationMs: number;
    albumArt: string | null;
    spotifyTrackId: string;
}

export interface SpotifyPlaylist {
    name: string;
    total: number;
    tracks: SpotifyTrack[];
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Persisted-query hash for the web player's fetchPlaylist operation. If
// Spotify rotates it, path 2 falls back to path 3 (and logs) — update the
// hash from the web player's network tab if that happens.
const PATHFINDER_FETCH_PLAYLIST_HASH = 'b39f62e9b566aa849b1780927de1450f47e02c54abf1e66e513f96e849591e41';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function parsePlaylistId(input: string): string | null {
    const url = input.trim();
    const m = url.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/)
        ?? url.match(/^spotify:playlist:([A-Za-z0-9]+)$/)
        ?? (/^[A-Za-z0-9]{22}$/.test(url) ? [url, url] : null);
    return m ? m[1] : null;
}

export async function fetchPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    // Path 1: official API (only complete for extended-quota apps)
    try {
        const viaApi = await fetchViaOfficialApi(playlistId);
        if (viaApi) return viaApi;
    } catch (err) {
        console.warn('[spotify] official API path failed:', err instanceof Error ? err.message : err);
    }

    // Paths 2 & 3 share the embed page fetch
    const embed = await fetchEmbedPage(playlistId);

    try {
        const viaPathfinder = await fetchViaPathfinder(playlistId, embed.accessToken, embed.name);
        if (viaPathfinder.tracks.length > 0) return viaPathfinder;
    } catch (err) {
        console.warn('[spotify] pathfinder path failed, using embed trackList:', err instanceof Error ? err.message : err);
    }

    const tracks = embed.tracks;
    if (!tracks.length) throw new Error('Spotify returned no tracks for this playlist — is it public?');
    console.warn(`[spotify] embed fallback returned ${tracks.length} tracks (embed caps ~100)`);
    return { name: embed.name, total: tracks.length, tracks };
}

/* ── Path 1: official Web API ─────────────────────────────────────── */

let cachedApiToken: { token: string; expiresAt: number } | null = null;

async function getClientCredentialsToken(): Promise<string | null> {
    if (cachedApiToken && Date.now() < cachedApiToken.expiresAt - 60_000) return cachedApiToken.token;
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return null;
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    if (!res.ok) return null;
    const j = await res.json() as { access_token: string; expires_in: number };
    cachedApiToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return cachedApiToken.token;
}

/** Returns null when this app's quota tier can't page the track list. */
async function fetchViaOfficialApi(playlistId: string): Promise<SpotifyPlaylist | null> {
    const token = await getClientCredentialsToken();
    if (!token) return null;
    const headers = { 'Authorization': `Bearer ${token}` };

    const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks(total)`, { headers });
    if (metaRes.status === 404) {
        throw new Error('Playlist not found. Note: Spotify-made playlists (Top 50, editorial mixes) are blocked for third-party apps — user-created public playlists work.');
    }
    if (!metaRes.ok) return null;
    const meta = await metaRes.json() as { name: string; tracks: { total: number } };
    const total = meta.tracks?.total ?? 0;

    const tracks: SpotifyTrack[] = [];
    for (let offset = 0; offset < total; offset += 100) {
        const res = await fetch(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=items(track(id,name,duration_ms,artists(name),album(images)))`,
            { headers }
        );
        if (!res.ok) return null;      // 403 for dev-mode apps → try pathfinder
        const page = await res.json() as {
            items: Array<{ track: { id: string | null; name: string; duration_ms: number; artists: Array<{ name: string }>; album: { images: Array<{ url: string }> } } | null }>;
        };
        for (const it of page.items ?? []) {
            const t = it?.track;
            if (!t?.name) continue;
            tracks.push({
                name: t.name,
                artist: t.artists?.[0]?.name ?? '',
                artists: (t.artists ?? []).map(a => a.name),
                durationMs: t.duration_ms || 0,
                albumArt: t.album?.images?.at(-1)?.url ?? t.album?.images?.[0]?.url ?? null,
                spotifyTrackId: t.id ?? ''
            });
        }
        if (!page.items?.length) break;
    }
    return tracks.length ? { name: meta.name || 'Spotify playlist', total: tracks.length, tracks } : null;
}

/* ── Embed page: anonymous token + capped trackList ───────────────── */

interface EmbedPage {
    accessToken: string | null;
    name: string;
    tracks: SpotifyTrack[];
}

async function fetchEmbedPage(playlistId: string): Promise<EmbedPage> {
    const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
        headers: { 'User-Agent': BROWSER_UA }
    });
    if (!res.ok) throw new Error(`Spotify embed fetch failed (HTTP ${res.status}) — is the playlist public?`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('Could not read the playlist from Spotify (embed layout changed)');

    let data: unknown;
    try { data = JSON.parse(m[1]); } catch {
        throw new Error('Could not parse the playlist from Spotify (embed data invalid)');
    }
    const d = data as {
        props?: { pageProps?: { state?: { data?: { entity?: {
            name?: string; title?: string;
            coverArt?: { sources?: Array<{ url: string }> };
            trackList?: Array<{ title?: string; subtitle?: string; duration?: number; uri?: string }>;
        } } } } };
    };
    const entity = d?.props?.pageProps?.state?.data?.entity ?? {};
    const tokenMatch = JSON.stringify(data).match(/"accessToken":"([^"]+)"/);

    const coverArt = entity.coverArt?.sources?.[0]?.url ?? null;
    const tracks: SpotifyTrack[] = (entity.trackList ?? [])
        .filter(t => t?.title)
        .map(t => {
            const artists = (t.subtitle ?? '').split(',').map(s => s.trim()).filter(Boolean);
            return {
                name: t.title!,
                artist: artists[0] ?? '',
                artists,
                durationMs: t.duration ?? 0,
                albumArt: coverArt,
                spotifyTrackId: t.uri?.split(':').pop() ?? ''
            };
        });

    return {
        accessToken: tokenMatch ? tokenMatch[1] : null,
        name: entity.name ?? entity.title ?? 'Spotify playlist',
        tracks
    };
}

/* ── Path 2: pathfinder GraphQL pagination (full track list) ──────── */

interface PathfinderItem {
    itemV2?: {
        data?: {
            __typename?: string;
            uri?: string;
            name?: string;
            trackDuration?: { totalMilliseconds?: number };
            albumOfTrack?: {
                artists?: { items?: Array<{ profile?: { name?: string } }> };
                coverArt?: { sources?: Array<{ url: string; width?: number }> };
            };
        };
    };
}

async function fetchViaPathfinder(playlistId: string, accessToken: string | null, name: string): Promise<SpotifyPlaylist> {
    if (!accessToken) throw new Error('no embed access token');
    const headers = { 'User-Agent': BROWSER_UA, 'Authorization': `Bearer ${accessToken}` };
    const tracks: SpotifyTrack[] = [];
    let total = Infinity;

    for (let offset = 0; offset < total && offset < 5000; offset += 100) {
        const variables = encodeURIComponent(JSON.stringify({ uri: `spotify:playlist:${playlistId}`, offset, limit: 100 }));
        const extensions = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: PATHFINDER_FETCH_PLAYLIST_HASH } }));
        const res = await fetch(
            `https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist&variables=${variables}&extensions=${extensions}`,
            { headers }
        );
        if (!res.ok) throw new Error(`pathfinder HTTP ${res.status} at offset ${offset}`);
        const j = await res.json() as {
            data?: { playlistV2?: { name?: string; content?: { totalCount?: number; items?: PathfinderItem[] } } };
        };
        const content = j?.data?.playlistV2?.content;
        if (!content?.items) throw new Error(`pathfinder returned no items at offset ${offset}`);
        total = content.totalCount ?? total;
        name = j?.data?.playlistV2?.name ?? name;

        for (const item of content.items) {
            const t = item?.itemV2?.data;
            if (!t || t.__typename !== 'Track' || !t.name) continue;
            const artists = (t.albumOfTrack?.artists?.items ?? [])
                .map(a => a.profile?.name ?? '')
                .filter(Boolean);
            const sources = t.albumOfTrack?.coverArt?.sources ?? [];
            const smallest = [...sources].sort((a, b) => (a.width ?? 999) - (b.width ?? 999))[0];
            tracks.push({
                name: t.name,
                artist: artists[0] ?? '',
                artists,
                durationMs: t.trackDuration?.totalMilliseconds ?? 0,
                albumArt: smallest?.url ?? null,
                spotifyTrackId: t.uri?.split(':').pop() ?? ''
            });
        }
        if (!content.items.length) break;
        await sleep(150);       // polite pacing between pages
    }

    console.log(`[spotify] pathfinder fetched ${tracks.length}/${Number.isFinite(total) ? total : '?'} tracks`);
    return { name, total: tracks.length, tracks };
}
