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
import { lookup } from 'dns/promises';
import { isIP } from 'net';
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

/**
 * SSRF guard.
 *
 * The previous version pattern-matched the hostname string only, which three
 * things walked straight through: a domain whose DNS record points at
 * 127.0.0.1 or 169.254.169.254; a public URL that 302s to an internal address
 * (redirects were followed without re-checking); and non-dotted-quad literals
 * like http://2130706433/, which the dotted-quad regex never matched.
 *
 * So: resolve the name, check every returned address, and re-check on each
 * redirect hop.
 */

/** True when an IP literal sits in a range we must never fetch from. */
function isPrivateAddress(ip: string): boolean {
    const v = isIP(ip);

    if (v === 4) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254)   // cloud metadata
            || (a === 100 && b >= 64 && b <= 127)  // CGNAT
            || a >= 224;                   // multicast + reserved
    }

    if (v === 6) {
        const h = ip.toLowerCase().replace(/^\[|\]$/g, '');
        if (h === '::1' || h === '::') return true;
        // IPv4-mapped (::ffff:127.0.0.1) must be judged on the v4 address.
        const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
        if (mapped) return isPrivateAddress(mapped[1]);
        return h.startsWith('fc') || h.startsWith('fd')     // unique-local
            || h.startsWith('fe8') || h.startsWith('fe9')   // link-local
            || h.startsWith('fea') || h.startsWith('feb');
    }

    return false;
}

/** Resolve a hostname and reject if ANY returned address is private. */
async function hostIsSafe(hostname: string): Promise<boolean> {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')
        || h.endsWith('.localhost') || h.endsWith('.home.arpa')) return false;

    // Literal address: judge it directly, no DNS involved.
    if (isIP(h)) return !isPrivateAddress(h);

    try {
        const records = await lookup(h, { all: true });
        if (!records.length) return false;
        return !records.some(r => isPrivateAddress(r.address));
    } catch {
        return false; // unresolvable -> not fetchable anyway
    }
}

const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 6000;

/**
 * Fetch with manual redirect handling, re-validating the host at every hop.
 * `redirect: 'follow'` would let a public URL bounce us into the private
 * network after the initial check had already passed.
 */
async function safeFetch(
    start: URL,
    method: 'HEAD' | 'GET',
    headers: Record<string, string> = {}
): Promise<Response | null> {
    let current = start;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const res = await fetch(current.href, {
                method,
                redirect: 'manual',
                signal: ctrl.signal,
                headers,
            });

            if (res.status < 300 || res.status >= 400) {
                return res.ok || res.headers.get('content-type') ? res : null;
            }

            const location = res.headers.get('location');
            if (!location) return null;

            const next = new URL(location, current);
            if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
            if (!(await hostIsSafe(next.hostname))) return null;
            current = next;
        }
        return null; // too many redirects
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function resolveUrl(raw: string): Promise<ResolvedUrl> {
    let u: URL;
    try {
        u = new URL(raw.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
        return { kind: 'error', error: 'That does not look like a valid link' };
    }
    if (!(await hostIsSafe(u.hostname))) {
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
        const res = await safeFetch(u, 'HEAD')
            // Some hosts reject HEAD — retry as a range GET for the first byte
            ?? await safeFetch(u, 'GET', { Range: 'bytes=0-0' });
        const type = (res?.headers.get('content-type') ?? '').toLowerCase();
        if (res?.ok && (type.startsWith('audio/') || type.startsWith('video/'))) {
            return { kind: 'media', url: res.url || u.href, title: titleFromUrl(u) };
        }
    } catch { /* fall through to error */ }

    return {
        kind: 'error',
        error: 'Only YouTube links and direct audio/video file links (.mp3, .mp4, .webm…) are supported. Page links from other platforms (Vimeo, SoundCloud…) cannot be synced.'
    };
}
