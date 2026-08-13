import { getDb } from './database';
import type { ChatMessage, MatchStatus, QueueItem, VideoCandidate } from '../../lib/types';

/* ── rooms ─────────────────────────────────────────────────────────── */

export interface RoomRow {
    id: string; name: string; host_client_id: string; guest_controls: number;
    current_queue_item_id: number | null; position_ms: number; is_playing: number;
    playback_updated_at: number | null; created_at: number;
}

export function createRoom(code: string, name: string, hostClientId: string): void {
    getDb().prepare(`
        INSERT INTO rooms (id, name, host_client_id, created_at) VALUES (?, ?, ?, ?)
    `).run(code, name, hostClientId, Date.now());
}

export function getRoom(code: string): RoomRow | undefined {
    return getDb().prepare(`SELECT * FROM rooms WHERE id = ?`).get(code) as RoomRow | undefined;
}

export function saveRoomPlayback(code: string, p: {
    currentQueueItemId: number | null; positionMs: number; isPlaying: boolean;
}): void {
    getDb().prepare(`
        UPDATE rooms SET current_queue_item_id = ?, position_ms = ?, is_playing = ?, playback_updated_at = ? WHERE id = ?
    `).run(p.currentQueueItemId, Math.round(p.positionMs), p.isPlaying ? 1 : 0, Date.now(), code);
}

export function setRoomHost(code: string, hostClientId: string): void {
    getDb().prepare(`UPDATE rooms SET host_client_id = ? WHERE id = ?`).run(hostClientId, code);
}

export function setRoomGuestControls(code: string, enabled: boolean): void {
    getDb().prepare(`UPDATE rooms SET guest_controls = ? WHERE id = ?`).run(enabled ? 1 : 0, code);
}

/* ── members ───────────────────────────────────────────────────────── */

export function upsertMember(roomId: string, clientId: string, nickname: string, avatarColor: string): void {
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO members (room_id, client_id, nickname, avatar_color, joined_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id, client_id) DO UPDATE SET nickname = excluded.nickname, last_seen_at = excluded.last_seen_at
    `).run(roomId, clientId, nickname, avatarColor, now, now);
}

export function memberJoinOrder(roomId: string): Array<{ client_id: string; joined_at: number }> {
    return getDb().prepare(`
        SELECT client_id, joined_at FROM members WHERE room_id = ? ORDER BY joined_at ASC
    `).all(roomId) as Array<{ client_id: string; joined_at: number }>;
}

/* ── queue ─────────────────────────────────────────────────────────── */

interface QueueRow {
    id: number; room_id: string; sort_order: number; title: string; artist: string | null;
    duration_ms: number; album_art_url: string | null; source: string;
    spotify_track_id: string | null; youtube_video_id: string | null;
    media_url: string | null;
    match_status: string; match_score: number | null; added_by_nickname: string;
    played_at: number | null; created_at: number;
}

function rowToItem(r: QueueRow): QueueItem {
    return {
        id: r.id, sortOrder: r.sort_order, title: r.title, artist: r.artist,
        durationMs: r.duration_ms, albumArtUrl: r.album_art_url,
        source: r.source as QueueItem['source'], spotifyTrackId: r.spotify_track_id,
        youtubeVideoId: r.youtube_video_id, mediaUrl: r.media_url ?? null,
        matchStatus: r.match_status as MatchStatus,
        matchScore: r.match_score, addedBy: r.added_by_nickname, playedAt: r.played_at
    };
}

export function listQueue(roomId: string): QueueItem[] {
    const rows = getDb().prepare(`
        SELECT * FROM queue_items WHERE room_id = ? ORDER BY sort_order ASC, id ASC
    `).all(roomId) as QueueRow[];
    return rows.map(rowToItem);
}

export function getQueueItem(id: number): QueueItem | undefined {
    const r = getDb().prepare(`SELECT * FROM queue_items WHERE id = ?`).get(id) as QueueRow | undefined;
    return r ? rowToItem(r) : undefined;
}

function nextSortOrder(roomId: string): number {
    const r = getDb().prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM queue_items WHERE room_id = ?`).get(roomId) as { m: number };
    return r.m + 1;
}

export function addYouTubeItem(roomId: string, v: VideoCandidate, addedBy: string): number {
    const info = getDb().prepare(`
        INSERT INTO queue_items (room_id, sort_order, title, artist, duration_ms, album_art_url,
            source, youtube_video_id, match_status, added_by_nickname, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'youtube', ?, 'matched', ?, ?)
    `).run(roomId, nextSortOrder(roomId), v.title, v.channel, v.durationMs, v.thumb, v.videoId, addedBy, Date.now());
    return Number(info.lastInsertRowid);
}

export function addUrlItem(roomId: string, m: { url: string; title: string }, addedBy: string): number {
    const info = getDb().prepare(`
        INSERT INTO queue_items (room_id, sort_order, title, artist, duration_ms, album_art_url,
            source, media_url, match_status, added_by_nickname, created_at)
        VALUES (?, ?, ?, NULL, 0, NULL, 'url', ?, 'matched', ?, ?)
    `).run(roomId, nextSortOrder(roomId), m.title, m.url, addedBy, Date.now());
    return Number(info.lastInsertRowid);
}

/** Direct-URL tracks report their real duration once a client loads metadata. */
export function setItemDuration(id: number, durationMs: number): void {
    getDb().prepare(`UPDATE queue_items SET duration_ms = ? WHERE id = ? AND duration_ms = 0`).run(Math.round(durationMs), id);
}

export function addSpotifyPlaceholder(roomId: string, t: {
    name: string; artist: string; durationMs: number; albumArt: string | null; spotifyTrackId: string;
}, addedBy: string): number {
    const info = getDb().prepare(`
        INSERT INTO queue_items (room_id, sort_order, title, artist, duration_ms, album_art_url,
            source, spotify_track_id, match_status, added_by_nickname, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'spotify', ?, 'needs_review', ?, ?)
    `).run(roomId, nextSortOrder(roomId), t.name, t.artist, t.durationMs, t.albumArt, t.spotifyTrackId, addedBy, Date.now());
    return Number(info.lastInsertRowid);
}

export function setItemMatch(id: number, videoId: string | null, status: MatchStatus, score: number | null): void {
    getDb().prepare(`
        UPDATE queue_items SET youtube_video_id = ?, match_status = ?, match_score = ? WHERE id = ?
    `).run(videoId, status, score, id);
}

export function setItemStatus(id: number, status: MatchStatus): void {
    getDb().prepare(`UPDATE queue_items SET match_status = ? WHERE id = ?`).run(status, id);
}

export function markPlayed(id: number): void {
    getDb().prepare(`UPDATE queue_items SET played_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function removeQueueItem(id: number): void {
    getDb().prepare(`DELETE FROM queue_items WHERE id = ?`).run(id);
}

/** Rewrite sort_order for the whole room queue in one transaction (queues are small). */
export function reorderQueue(roomId: string, orderedIds: number[]): void {
    const d = getDb();
    const upd = d.prepare(`UPDATE queue_items SET sort_order = ? WHERE id = ? AND room_id = ?`);
    d.transaction(() => {
        orderedIds.forEach((id, i) => upd.run(i + 1, id, roomId));
    })();
}

/** Randomize the order of upcoming unplayed tracks in the room queue. */
export function shuffleQueue(roomId: string, currentPlayingId?: number | null): void {
    const queue = listQueue(roomId);
    const unplayed = queue.filter(q => !q.playedAt);
    if (unplayed.length <= 1) return;

    const currentItem = unplayed.find(q => q.id === currentPlayingId);
    const rest = unplayed.filter(q => q.id !== currentPlayingId);

    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }

    const shuffled = currentItem ? [currentItem, ...rest] : rest;
    reorderQueue(roomId, shuffled.map(q => q.id));
}

/* ── messages ──────────────────────────────────────────────────────── */

export function insertMessage(roomId: string, m: {
    clientId: string | null; nickname: string; type: 'chat' | 'system'; body: string;
}): ChatMessage {
    const createdAt = Date.now();
    const info = getDb().prepare(`
        INSERT INTO messages (room_id, client_id, nickname, type, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(roomId, m.clientId, m.nickname, m.type, m.body, createdAt);
    return { id: Number(info.lastInsertRowid), clientId: m.clientId, nickname: m.nickname, type: m.type, body: m.body, createdAt };
}

export function recentMessages(roomId: string, limit = 100): ChatMessage[] {
    const rows = getDb().prepare(`
        SELECT id, client_id, nickname, type, body, created_at FROM messages
        WHERE room_id = ? ORDER BY id DESC LIMIT ?
    `).all(roomId, limit) as Array<{ id: number; client_id: string | null; nickname: string; type: string; body: string; created_at: number }>;
    return rows.reverse().map(r => ({
        id: r.id, clientId: r.client_id, nickname: r.nickname,
        type: r.type as 'chat' | 'system', body: r.body, createdAt: r.created_at
    }));
}

/* ── imports ───────────────────────────────────────────────────────── */

export function createImport(id: string, roomId: string, playlistUrl: string): void {
    getDb().prepare(`
        INSERT INTO imports (id, room_id, playlist_url, created_at) VALUES (?, ?, ?, ?)
    `).run(id, roomId, playlistUrl, Date.now());
}

export function updateImport(id: string, patch: {
    playlistName?: string; total?: number; matched?: number; needsReview?: number; failed?: number; status?: string;
}): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.playlistName !== undefined) { sets.push('playlist_name = ?'); vals.push(patch.playlistName); }
    if (patch.total !== undefined) { sets.push('total = ?'); vals.push(patch.total); }
    if (patch.matched !== undefined) { sets.push('matched = ?'); vals.push(patch.matched); }
    if (patch.needsReview !== undefined) { sets.push('needs_review = ?'); vals.push(patch.needsReview); }
    if (patch.failed !== undefined) { sets.push('failed = ?'); vals.push(patch.failed); }
    if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
    if (!sets.length) return;
    vals.push(id);
    getDb().prepare(`UPDATE imports SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getPlaylistCache(playlistId: string): { playlistName: string; tracks: Array<{ name: string; artist: string; durationMs: number; albumArt?: string | null; spotifyTrackId?: string }> } | null {
    try {
        const row = getDb().prepare('SELECT playlist_name, tracks_json FROM playlist_cache WHERE playlist_id = ?').get(playlistId) as { playlist_name: string; tracks_json: string } | undefined;
        if (!row) return null;
        return {
            playlistName: row.playlist_name || 'Cached Playlist',
            tracks: JSON.parse(row.tracks_json)
        };
    } catch {
        return null;
    }
}

export function setPlaylistCache(playlistId: string, playlistName: string, tracks: Array<{ name: string; artist: string; durationMs: number; albumArt?: string | null; spotifyTrackId?: string }>): void {
    try {
        getDb().prepare(`
            INSERT INTO playlist_cache (playlist_id, playlist_name, tracks_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(playlist_id) DO UPDATE SET
                playlist_name = excluded.playlist_name,
                tracks_json = excluded.tracks_json,
                updated_at = excluded.updated_at
        `).run(playlistId, playlistName, JSON.stringify(tracks), Date.now());
    } catch (err) {
        console.warn('[db] setPlaylistCache failed:', err);
    }
}
