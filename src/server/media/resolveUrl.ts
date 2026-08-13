/**
 * Resolve a user-pasted URL into something the room can play.
 *
 *  - YouTube links (watch / youtu.be / shorts / music.youtube / embed / live)
 *    → resolved to a normal YouTube queue item via youtube-sr metadata.
 *  - Direct audio/video file URLs from any host (archive.org, catbox, a
 *    static server…) → played through the synced HTML5 player.
 *  - Anything else (Vimeo/SoundCloud/Spotify page links…) → clear error.
 */

import YouTube from 'youtube-sr';
import type { VideoCandidate } from '../../lib/types';

export type ResolvedUrl =
    | { kind: 'youtube'; video: VideoCandidate }
    | { kind: 'media'; url: string; title: string }
    | { kind: 'error'; error: string };

const YT_HOSTS = /(^|\.)((youtube\.com)|(youtu\.be)|(youtube-nocookie\.com))$/i;
const MEDIA_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|webm|mov)(\?|#|$)/i;

export function extractYouTubeId(u: URL): string | null {
    const host = u.hostname.replace(/^www\.|^m\.|^music\./i, '');
    if (!YT_HOSTS.test(host)) return null;
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const path = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/);
    return path ? path[2] : null;
}

function titleFromUrl(u: URL): string {
    const base = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    const cleaned = base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+.-]+/g, ' ').trim();
    return cleaned || u.hostname;
}

/** Block link-resolver requests to the server's own network (SSRF guard). */
function isPrivateHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        const [a, b] = h.split('.').map(Number);
        return a === 10 || a === 127 || a === 0
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254);
    }
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}

export async function resolveUrl(raw: string): Promise<ResolvedUrl> {
    let u: URL;
    try {
        u = new URL(raw.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
        return { kind: 'error', error: 'That does not look like a valid link' };
    }
    if (isPrivateHost(u.hostname)) {
        return { kind: 'error', error: 'Links to private/local addresses are not allowed' };
    }

    /* YouTube page link → normal synced YouTube item */
    const ytId = extractYouTubeId(u);
    if (ytId) {
        try {
            const v = await YouTube.getVideo(`https://www.youtube.com/watch?v=${ytId}`);
            return {
                kind: 'youtube',
                video: {
                    videoId: v.id ?? ytId,
                    title: v.title ?? 'YouTube video',
                    channel: v.channel?.name ?? '',
                    durationMs: v.duration ?? 0,
                    thumb: v.thumbnail?.url ?? null
                }
            };
        } catch {
            // Metadata fetch failed — still queue it; duration unknown.
            return {
                kind: 'youtube',
                video: { videoId: ytId, title: 'YouTube video', channel: '', durationMs: 0, thumb: null }
            };
        }
    }

    /* Obvious media file extension → direct play */
    if (MEDIA_EXT_RE.test(u.pathname + u.search)) {
        return { kind: 'media', url: u.href, title: titleFromUrl(u) };
    }

    /* Extensionless link: sniff the Content-Type without downloading the body */
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        let res = await fetch(u.href, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
        if (!res.ok || !res.headers.get('content-type')) {
            // Some hosts reject HEAD — retry as a range GET for the first byte
            res = await fetch(u.href, {
                method: 'GET', redirect: 'follow', signal: ctrl.signal,
                headers: { Range: 'bytes=0-0' }
            });
        }
        clearTimeout(timer);
        const type = (res.headers.get('content-type') ?? '').toLowerCase();
        if (res.ok && (type.startsWith('audio/') || type.startsWith('video/'))) {
            return { kind: 'media', url: u.href, title: titleFromUrl(u) };
        }
    } catch { /* fall through to error */ }

    return {
        kind: 'error',
        error: 'Only YouTube links and direct audio/video file links (.mp3, .mp4, .webm…) are supported. Page links from other platforms (Vimeo, SoundCloud…) cannot be synced.'
    };
}
