/** Scoring to pick the right YouTube video for a Spotify track. */

import type { VideoCandidate } from '../../lib/types';

const NOISE_RE = /\b(feat\.?|ft\.?)\s+[^([\-]+|[([][^)\]]*(remaster(ed)?|deluxe|bonus|edition|version)[^)\]]*[)\]]|-\s*remaster(ed)?\s*\d{0,4}/gi;
const PENALTY_RE = /\b(live|cover|reaction|sped\s*up|slowed|8d|nightcore|remix|karaoke|instrumental|lyrics?\s+video)\b/i;

export function normalizeQuery(artist: string, title: string): string {
    const cleaned = `${artist} ${title}`.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
    return `${cleaned} audio`;
}

function tokens(s: string): Set<string> {
    return new Set(
        s.toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1)
    );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let hit = 0;
    for (const t of a) if (b.has(t)) hit++;
    return hit / a.size;
}

export function scoreCandidate(
    c: VideoCandidate,
    track: { artist: string; title: string; durationMs: number }
): number {
    // Duration proximity — strongest disambiguator (15s window)
    const durationScore = track.durationMs > 0 && c.durationMs > 0
        ? Math.max(0, 1 - Math.abs(c.durationMs - track.durationMs) / 15_000)
        : 0.3;

    // Title token overlap vs "artist title"
    const wanted = tokens(`${track.artist} ${track.title}`);
    const got = tokens(`${c.channel} ${c.title}`);
    const overlap = tokenOverlap(wanted, got);

    // Channel/officialness
    let channelScore = 0.4;
    const ch = c.channel.toLowerCase();
    const t = c.title.toLowerCase();
    if (ch.endsWith(' - topic')) channelScore = 1;
    else if (/official (audio|video|music video)/.test(t)) channelScore = 0.9;
    else if (ch.includes(track.artist.toLowerCase().slice(0, 12))) channelScore = 0.75;

    // Penalize live/cover/etc when the source title doesn't ask for it
    const sourceHasVariant = PENALTY_RE.test(track.title);
    const candidateHasVariant = PENALTY_RE.test(c.title);
    const penalty = !sourceHasVariant && candidateHasVariant ? 0.35 : 0;

    return Math.max(0, 0.5 * durationScore + 0.3 * overlap + 0.2 * channelScore - penalty);
}

export function pickBestMatch(
    candidates: VideoCandidate[],
    track: { artist: string; title: string; durationMs: number }
): { candidate: VideoCandidate; score: number } | null {
    let best: { candidate: VideoCandidate; score: number } | null = null;
    for (const c of candidates) {
        const score = scoreCandidate(c, track);
        if (!best || score > best.score) best = { candidate: c, score };
    }
    return best;
}

export const MATCH_THRESHOLD = 0.55;
