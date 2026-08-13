/**
 * roomStore — all room state in Upstash Redis (serverless-native replacement
 * for the sqlite repos + in-memory RoomManager).
 *
 * Keys (per room CODE):
 *   jr:{CODE}:meta      hash-ish JSON  — name, host, guestControls, playback
 *   jr:{CODE}:queue     JSON array     — queue items (array order is authoritative)
 *   jr:{CODE}:seq       counter        — INCR for queue item ids
 *   jr:{CODE}:messages  Redis list     — chat history (trimmed to last 100)
 *   jr:{CODE}:votes     Redis set      — clientIds who voted to skip
 */

import { getRedis, ROOM_TTL_SECONDS } from './redis';
import type { ChatMessage, PlaybackState, QueueItem, VideoCandidate } from '../../lib/types';

const K = {
    meta: (c: string) => `jr:${c}:meta`,
    queue: (c: string) => `jr:${c}:queue`,
    seq: (c: string) => `jr:${c}:seq`,
    messages: (c: string) => `jr:${c}:messages`,
    votes: (c: string) => `jr:${c}:votes`,
};

export interface RoomMeta {
    code: string;
    name: string;
    hostClientId: string;
    guestControls: boolean;
    playback: PlaybackState;
    createdAt: number;
}

const emptyPlayback = (loopMode: PlaybackState['loopMode'] = 'off'): PlaybackState => ({
    queueItemId: null, videoId: null, mediaUrl: null,
    basePositionMs: 0, baseServerTime: Date.now(), isPlaying: false, loopMode
});

async function touch(code: string): Promise<void> {
    const r = getRedis();
    await Promise.all([
        r.expire(K.meta(code), ROOM_TTL_SECONDS),
        r.expire(K.queue(code), ROOM_TTL_SECONDS),
        r.expire(K.seq(code), ROOM_TTL_SECONDS),
        r.expire(K.messages(code), ROOM_TTL_SECONDS),
        r.expire(K.votes(code), ROOM_TTL_SECONDS),
    ]);
}

/* ── room meta ── */

export async function createRoom(code: string, name: string, hostClientId: string): Promise<void> {
    const meta: RoomMeta = { code, name, hostClientId, guestControls: false, playback: emptyPlayback(), createdAt: Date.now() };
    await getRedis().set(K.meta(code), meta, { ex: ROOM_TTL_SECONDS });
}

export async function getMeta(code: string): Promise<RoomMeta | null> {
    const m = await getRedis().get<RoomMeta>(K.meta(code));
    return m ?? null;
}

async function saveMeta(meta: RoomMeta): Promise<void> {
    await getRedis().set(K.meta(meta.code), meta, { ex: ROOM_TTL_SECONDS });
}

export async function roomExists(code: string): Promise<boolean> {
    return (await getRedis().exists(K.meta(code))) === 1;
}

export async function setHost(code: string, hostClientId: string): Promise<RoomMeta | null> {
    const meta = await getMeta(code);
    if (!meta) return null;
    meta.hostClientId = hostClientId;
    await saveMeta(meta);
    return meta;
}

export async function setGuestControls(code: string, enabled: boolean): Promise<void> {
    const meta = await getMeta(code);
    if (!meta) return;
    meta.guestControls = enabled;
    await saveMeta(meta);
}

export async function setPlayback(code: string, playback: PlaybackState): Promise<void> {
    const meta = await getMeta(code);
    if (!meta) return;
    meta.playback = playback;
    await saveMeta(meta);
}

/* ── queue ── */

export async function listQueue(code: string): Promise<QueueItem[]> {
    const q = await getRedis().get<QueueItem[]>(K.queue(code));
    return (q ?? []).map((it, i) => ({ ...it, sortOrder: i }));
}

async function saveQueue(code: string, items: QueueItem[]): Promise<void> {
    await getRedis().set(K.queue(code), items, { ex: ROOM_TTL_SECONDS });
}

async function nextId(code: string): Promise<number> {
    const id = await getRedis().incr(K.seq(code));
    await getRedis().expire(K.seq(code), ROOM_TTL_SECONDS);
    return id;
}

export async function getItem(code: string, id: number): Promise<QueueItem | undefined> {
    return (await listQueue(code)).find(q => q.id === id);
}

export async function addYouTubeItem(code: string, v: VideoCandidate, addedBy: string): Promise<number> {
    const id = await nextId(code);
    const items = await listQueue(code);
    items.push({
        id, sortOrder: items.length, title: v.title, artist: v.channel,
        durationMs: v.durationMs, albumArtUrl: v.thumb, source: 'youtube',
        spotifyTrackId: null, youtubeVideoId: v.videoId, mediaUrl: null,
        matchStatus: 'matched', matchScore: 1, addedBy, playedAt: null
    });
    await saveQueue(code, items);
    return id;
}

export async function addUrlItem(code: string, m: { url: string; title: string }, addedBy: string): Promise<number> {
    const id = await nextId(code);
    const items = await listQueue(code);
    items.push({
        id, sortOrder: items.length, title: m.title, artist: null,
        durationMs: 0, albumArtUrl: null, source: 'url',
        spotifyTrackId: null, youtubeVideoId: null, mediaUrl: m.url,
        matchStatus: 'matched', matchScore: 1, addedBy, playedAt: null
    });
    await saveQueue(code, items);
    return id;
}

export interface SpotifyPlaceholder {
    name: string; artist: string; durationMs: number; albumArt: string | null; spotifyTrackId: string;
}

/** Bulk-insert import placeholders in one write. Returns the new item ids in order. */
export async function addSpotifyPlaceholders(code: string, tracks: SpotifyPlaceholder[], addedBy: string): Promise<number[]> {
    const start = await getRedis().incrby(K.seq(code), tracks.length);
    await getRedis().expire(K.seq(code), ROOM_TTL_SECONDS);
    const firstId = start - tracks.length + 1;
    const items = await listQueue(code);
    const ids: number[] = [];
    tracks.forEach((t, i) => {
        const id = firstId + i;
        ids.push(id);
        items.push({
            id, sortOrder: items.length, title: t.name, artist: t.artist,
            durationMs: t.durationMs, albumArtUrl: t.albumArt, source: 'spotify',
            spotifyTrackId: t.spotifyTrackId, youtubeVideoId: null, mediaUrl: null,
            matchStatus: 'needs_review', matchScore: null, addedBy, playedAt: null
        });
    });
    await saveQueue(code, items);
    return ids;
}

export async function setItemMatch(code: string, id: number, videoId: string | null, status: QueueItem['matchStatus'], score: number | null): Promise<void> {
    const items = await listQueue(code);
    const it = items.find(q => q.id === id);
    if (!it) return;
    it.youtubeVideoId = videoId; it.matchStatus = status; it.matchScore = score;
    await saveQueue(code, items);
}

export interface MatchUpdate { id: number; videoId: string | null; status: QueueItem['matchStatus']; score: number | null; }

/** Apply a whole batch of match results in ONE read + ONE write (avoids the
 *  O(n²) per-track rewrite of the full queue array). */
export async function applyMatches(code: string, updates: MatchUpdate[]): Promise<QueueItem[]> {
    const items = await listQueue(code);
    const byId = new Map(items.map(i => [i.id, i]));
    for (const u of updates) {
        const it = byId.get(u.id);
        if (!it) continue;
        it.youtubeVideoId = u.videoId; it.matchStatus = u.status; it.matchScore = u.score;
    }
    await saveQueue(code, items);
    return items;
}

export async function setItemStatus(code: string, id: number, status: QueueItem['matchStatus']): Promise<void> {
    const items = await listQueue(code);
    const it = items.find(q => q.id === id);
    if (!it) return;
    it.matchStatus = status;
    await saveQueue(code, items);
}

export async function setItemDuration(code: string, id: number, durationMs: number): Promise<void> {
    const items = await listQueue(code);
    const it = items.find(q => q.id === id);
    if (!it || it.durationMs > 0) return;
    it.durationMs = Math.round(durationMs);
    await saveQueue(code, items);
}

export async function removeItem(code: string, id: number): Promise<void> {
    const items = (await listQueue(code)).filter(q => q.id !== id);
    await saveQueue(code, items);
}

export async function reorder(code: string, orderedIds: number[]): Promise<void> {
    const items = await listQueue(code);
    const byId = new Map(items.map(i => [i.id, i]));
    const next = orderedIds.map(id => byId.get(id)).filter((x): x is QueueItem => !!x);
    // Append any items not named in orderedIds (safety)
    for (const it of items) if (!orderedIds.includes(it.id)) next.push(it);
    await saveQueue(code, next);
}

export async function markPlayed(code: string, id: number): Promise<void> {
    const items = await listQueue(code);
    const it = items.find(q => q.id === id);
    if (it) { it.playedAt = Date.now(); await saveQueue(code, items); }
}

export async function shuffleUpcoming(code: string, currentId: number | null): Promise<void> {
    const items = await listQueue(code);
    const played = items.filter(q => q.playedAt && q.id !== currentId);
    const current = items.find(q => q.id === currentId);
    const rest = items.filter(q => !q.playedAt && q.id !== currentId);
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    await saveQueue(code, [...played, ...(current ? [current] : []), ...rest]);
}

/* ── playback advance (server-authoritative next-track selection) ── */

const playable = (q: QueueItem) => q.matchStatus !== 'failed' && (q.youtubeVideoId || q.mediaUrl);

export async function computeAdvance(code: string, opts?: { manual?: boolean }): Promise<PlaybackState> {
    const meta = await getMeta(code);
    if (!meta) return emptyPlayback();
    const loop = meta.playback.loopMode ?? 'off';
    const curId = meta.playback.queueItemId;

    // Loop one: replay the same track (only on natural end, not manual skip).
    if (loop === 'one' && !opts?.manual && curId) {
        const cur = await getItem(code, curId);
        if (cur && playable(cur)) {
            const pb: PlaybackState = { queueItemId: cur.id, videoId: cur.youtubeVideoId, mediaUrl: cur.mediaUrl, basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true, loopMode: loop };
            await setPlayback(code, pb);
            return pb;
        }
    }

    if (curId) await markPlayed(code, curId);
    const fresh = await listQueue(code);
    const curIdx = fresh.findIndex(q => q.id === curId);
    let next = fresh.slice(curIdx + 1).find(playable)
        ?? (curIdx === -1 ? fresh.find(q => playable(q) && !q.playedAt) : undefined);
    // Loop all: wrap to the first playable track when the queue runs out.
    if (!next && loop === 'all') next = fresh.find(playable);

    const playback: PlaybackState = next
        ? { queueItemId: next.id, videoId: next.youtubeVideoId, mediaUrl: next.mediaUrl, basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true, loopMode: loop }
        : emptyPlayback(loop);
    await setPlayback(code, playback);
    await clearVotes(code);
    return playback;
}

export async function computePrevious(code: string): Promise<PlaybackState | null> {
    const meta = await getMeta(code);
    if (!meta) return null;
    const items = await listQueue(code);
    const curIdx = items.findIndex(q => q.id === meta.playback.queueItemId);
    // Nearest playable item before the current one; else restart current.
    const prev = curIdx > 0 ? [...items.slice(0, curIdx)].reverse().find(playable) : undefined;
    const target = prev ?? (curIdx >= 0 ? items[curIdx] : undefined);
    if (!target || !playable(target)) return null;
    const pb: PlaybackState = { queueItemId: target.id, videoId: target.youtubeVideoId, mediaUrl: target.mediaUrl, basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true, loopMode: meta.playback.loopMode ?? 'off' };
    await setPlayback(code, pb);
    await clearVotes(code);
    return pb;
}

export async function setLoopMode(code: string, mode: 'off' | 'all' | 'one'): Promise<PlaybackState | null> {
    const meta = await getMeta(code);
    if (!meta) return null;
    meta.playback = { ...meta.playback, loopMode: mode };
    await saveMeta(meta);
    return meta.playback;
}

export async function playItem(code: string, id: number): Promise<PlaybackState | null> {
    const it = await getItem(code, id);
    if (!it || !playable(it)) return null;
    const meta = await getMeta(code);
    const playback: PlaybackState = {
        queueItemId: it.id, videoId: it.youtubeVideoId, mediaUrl: it.mediaUrl,
        basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true,
        loopMode: meta?.playback.loopMode ?? 'off'
    };
    await setPlayback(code, playback);
    await clearVotes(code);
    return playback;
}

/* ── messages ── */

export async function addMessage(code: string, m: { clientId: string | null; nickname: string; type: 'chat' | 'system'; body: string }): Promise<ChatMessage> {
    const msg: ChatMessage = { id: Date.now() + Math.floor(Math.random() * 1000), ...m, createdAt: Date.now() };
    const r = getRedis();
    await r.rpush(K.messages(code), JSON.stringify(msg));
    await r.ltrim(K.messages(code), -100, -1);
    await r.expire(K.messages(code), ROOM_TTL_SECONDS);
    return msg;
}

export async function recentMessages(code: string): Promise<ChatMessage[]> {
    const raw = await getRedis().lrange(K.messages(code), -100, -1);
    return raw.map(x => (typeof x === 'string' ? JSON.parse(x) : x) as ChatMessage);
}

/* ── vote skip ── */

export async function toggleVote(code: string, clientId: string): Promise<void> {
    const r = getRedis();
    const has = await r.sismember(K.votes(code), clientId);
    if (has) await r.srem(K.votes(code), clientId);
    else await r.sadd(K.votes(code), clientId);
    await r.expire(K.votes(code), ROOM_TTL_SECONDS);
}

export async function getVotes(code: string): Promise<string[]> {
    return (await getRedis().smembers(K.votes(code))) as string[];
}

export async function clearVotes(code: string): Promise<void> {
    await getRedis().del(K.votes(code));
}

export { touch };
