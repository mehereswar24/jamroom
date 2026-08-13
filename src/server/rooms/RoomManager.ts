/**
 * RoomManager — in-memory authoritative state for live rooms, lazily hydrated
 * from SQLite. The playback timeline is the pair (basePositionMs, baseServerTime):
 *   effectivePos(t) = isPlaying ? basePositionMs + (t - baseServerTime) : basePositionMs
 * Control events rebase the pair; there is no server tick loop.
 */

import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../lib/events';
import type { Member, PlaybackState, QueueItem, VoteSkipState } from '../../lib/types';
import * as repos from '../db/repos';

type Io = Server<ClientToServerEvents, ServerToClientEvents>;

export interface ConnectedMember {
    socketId: string;
    clientId: string;
    nickname: string;
    avatarColor: string;
}

const HOST_GRACE_MS = 15_000;
const EMPTY_ROOM_EVICT_MS = 5 * 60_000;
const SNAPSHOT_INTERVAL_MS = 15_000;
const END_TIMER_SLACK_MS = 4_000;
const ERROR_REPORT_WINDOW_MS = 5_000;

export class RoomState {
    readonly code: string;
    name: string;
    hostClientId: string;
    guestControls: boolean;
    playback: PlaybackState = { queueItemId: null, videoId: null, mediaUrl: null, basePositionMs: 0, baseServerTime: Date.now(), isPlaying: false };
    /** socketId → member. One clientId may have several sockets (tabs); dedupe for display. */
    sockets = new Map<string, ConnectedMember>();
    voteSkip = new Set<string>();
    /** clientId → media flags for everyone currently in the WebRTC call. */
    rtcPeers = new Map<string, { audio: boolean; video: boolean; screen: boolean }>();
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
    private evictTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSnapshotAt = 0;
    private errorReports = new Map<number, { clientIds: Set<string>; firstAt: number }>();

    constructor(row: repos.RoomRow) {
        this.code = row.id;
        this.name = row.name;
        this.hostClientId = row.host_client_id;
        this.guestControls = !!row.guest_controls;
        // Restart resume: come back PAUSED at the saved position.
        const item = row.current_queue_item_id ? repos.getQueueItem(row.current_queue_item_id) : undefined;
        if (item) {
            this.playback = {
                queueItemId: item.id,
                videoId: item.youtubeVideoId,
                mediaUrl: item.mediaUrl,
                basePositionMs: row.position_ms || 0,
                baseServerTime: Date.now(),
                isPlaying: false
            };
        }
    }

    effectivePos(t = Date.now()): number {
        return this.playback.isPlaying
            ? this.playback.basePositionMs + (t - this.playback.baseServerTime)
            : this.playback.basePositionMs;
    }

    connectedMembers(): Member[] {
        const byClient = new Map<string, Member>();
        for (const m of this.sockets.values()) {
            byClient.set(m.clientId, {
                clientId: m.clientId, nickname: m.nickname, avatarColor: m.avatarColor, connected: true
            });
        }
        return [...byClient.values()];
    }

    connectedClientIds(): Set<string> {
        return new Set([...this.sockets.values()].map(m => m.clientId));
    }

    socketIdsForClient(clientId: string): string[] {
        return [...this.sockets.entries()].filter(([, m]) => m.clientId === clientId).map(([sid]) => sid);
    }

    nicknameFor(clientId: string): string {
        return [...this.sockets.values()].find(m => m.clientId === clientId)?.nickname ?? 'Guest';
    }

    isHost(clientId: string): boolean { return clientId === this.hostClientId; }

    canControl(clientId: string): boolean { return this.guestControls || this.isHost(clientId); }

    voteSkipState(): VoteSkipState {
        const connected = this.connectedClientIds();
        // Drop votes from people who left
        for (const v of [...this.voteSkip]) if (!connected.has(v)) this.voteSkip.delete(v);
        return {
            votes: this.voteSkip.size,
            needed: Math.max(1, Math.ceil(connected.size / 2)),
            voters: [...this.voteSkip]
        };
    }

    /* ── timers (managed by RoomManager) ── */
    setEndTimer(t: ReturnType<typeof setTimeout> | null): void {
        if (this.endTimer) clearTimeout(this.endTimer);
        this.endTimer = t;
    }
    setHostGraceTimer(t: ReturnType<typeof setTimeout> | null): void {
        if (this.hostGraceTimer) clearTimeout(this.hostGraceTimer);
        this.hostGraceTimer = t;
    }
    setEvictTimer(t: ReturnType<typeof setTimeout> | null): void {
        if (this.evictTimer) clearTimeout(this.evictTimer);
        this.evictTimer = t;
    }

    maybeSnapshot(force = false): void {
        const now = Date.now();
        if (!force && now - this.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
        this.lastSnapshotAt = now;
        repos.saveRoomPlayback(this.code, {
            currentQueueItemId: this.playback.queueItemId,
            positionMs: this.effectivePos(now),
            isPlaying: this.playback.isPlaying
        });
    }

    reportError(queueItemId: number, clientId: string): { hostReported: boolean; ratio: number } {
        const now = Date.now();
        let rec = this.errorReports.get(queueItemId);
        if (!rec || now - rec.firstAt > ERROR_REPORT_WINDOW_MS) {
            rec = { clientIds: new Set(), firstAt: now };
            this.errorReports.set(queueItemId, rec);
        }
        rec.clientIds.add(clientId);
        const connected = Math.max(1, this.connectedClientIds().size);
        return { hostReported: rec.clientIds.has(this.hostClientId), ratio: rec.clientIds.size / connected };
    }

    clearErrorReports(): void { this.errorReports.clear(); }
}

export class RoomManager {
    private rooms = new Map<string, RoomState>();
    constructor(private io: Io) {}

    get(code: string): RoomState | null {
        const existing = this.rooms.get(code);
        if (existing) return existing;
        const row = repos.getRoom(code);
        if (!row) return null;
        const state = new RoomState(row);
        this.rooms.set(code, state);
        return state;
    }

    private broadcastSync(room: RoomState, reason: string): void {
        this.io.to(room.code).emit('playback:sync', { ...room.playback, reason });
        room.maybeSnapshot(true);
        this.armEndTimer(room);
    }

    broadcastMembers(room: RoomState): void {
        this.io.to(room.code).emit('room:members', {
            members: room.connectedMembers(), hostClientId: room.hostClientId
        });
    }

    broadcastQueue(room: RoomState): void {
        this.io.to(room.code).emit('queue:updated', { queue: repos.listQueue(room.code) });
    }

    broadcastVoteSkip(room: RoomState): void {
        this.io.to(room.code).emit('queue:voteSkip', room.voteSkipState());
    }

    broadcastRtcPeers(room: RoomState): void {
        const peers = [...room.rtcPeers.entries()].map(([clientId, flags]) => ({
            clientId, nickname: room.nicknameFor(clientId), ...flags
        }));
        this.io.to(room.code).emit('rtc:peers', { peers });
    }

    /** Relay a signaling message to every socket of one client. */
    relayRtcSignal(room: RoomState, toClientId: string, fromClientId: string, data: import('../../lib/types').RtcSignalData): void {
        for (const sid of room.socketIdsForClient(toClientId)) {
            this.io.to(sid).emit('rtc:signal', { from: fromClientId, data });
        }
    }

    /** Drop a client from the call (on explicit leave or disconnect). */
    rtcRemove(room: RoomState, clientId: string): void {
        if (room.rtcPeers.delete(clientId)) this.broadcastRtcPeers(room);
    }

    systemMessage(room: RoomState, body: string): void {
        const msg = repos.insertMessage(room.code, { clientId: null, nickname: 'system', type: 'system', body });
        this.io.to(room.code).emit('chat:message', { message: msg });
    }

    notice(room: RoomState, text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
        this.io.to(room.code).emit('room:notice', { text, kind });
    }

    /* ── playback controls (all permission-checked by callers) ── */

    play(room: RoomState): void {
        if (!room.playback.queueItemId) { this.advance(room, 'auto-start'); return; }
        const now = Date.now();
        room.playback.basePositionMs = room.effectivePos(now);
        room.playback.baseServerTime = now;
        room.playback.isPlaying = true;
        this.broadcastSync(room, 'play');
    }

    pause(room: RoomState): void {
        const now = Date.now();
        room.playback.basePositionMs = room.effectivePos(now);
        room.playback.baseServerTime = now;
        room.playback.isPlaying = false;
        this.broadcastSync(room, 'pause');
    }

    seek(room: RoomState, positionMs: number): void {
        const item = room.playback.queueItemId ? repos.getQueueItem(room.playback.queueItemId) : undefined;
        const max = item?.durationMs || Number.MAX_SAFE_INTEGER;
        room.playback.basePositionMs = Math.max(0, Math.min(positionMs, max));
        room.playback.baseServerTime = Date.now();
        this.broadcastSync(room, 'seek');
    }

    /** Advance to the next playable item after the current one (or first unplayed). */
    advance(room: RoomState, reason: string): void {
        const queue = repos.listQueue(room.code);
        if (room.playback.queueItemId) {
            repos.markPlayed(room.playback.queueItemId);
        }
        const playable = (q: typeof queue[number]) => q.matchStatus !== 'failed' && (q.youtubeVideoId || q.mediaUrl);
        const curIdx = queue.findIndex(q => q.id === room.playback.queueItemId);
        const after = queue.slice(curIdx + 1);
        const next = after.find(playable)
            ?? (curIdx === -1 ? queue.find(q => playable(q) && !q.playedAt) : undefined);

        room.voteSkip.clear();
        room.clearErrorReports();

        if (!next) {
            room.playback = { queueItemId: null, videoId: null, mediaUrl: null, basePositionMs: 0, baseServerTime: Date.now(), isPlaying: false };
            this.broadcastSync(room, `${reason}:queue-end`);
            this.broadcastQueue(room);
            this.broadcastVoteSkip(room);
            return;
        }
        room.playback = {
            queueItemId: next.id, videoId: next.youtubeVideoId, mediaUrl: next.mediaUrl,
            basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true
        };
        this.broadcastSync(room, reason);
        this.broadcastQueue(room);
        this.broadcastVoteSkip(room);
    }

    playItem(room: RoomState, queueItemId: number): boolean {
        const item = repos.getQueueItem(queueItemId);
        if (!item || item.matchStatus === 'failed' || (!item.youtubeVideoId && !item.mediaUrl)) return false;
        room.voteSkip.clear();
        room.clearErrorReports();
        room.playback = {
            queueItemId: item.id, videoId: item.youtubeVideoId, mediaUrl: item.mediaUrl,
            basePositionMs: 0, baseServerTime: Date.now(), isPlaying: true
        };
        this.broadcastSync(room, 'play-item');
        this.broadcastVoteSkip(room);
        return true;
    }

    /** Fallback so the room never stalls if the host tab dies mid-track. */
    private armEndTimer(room: RoomState): void {
        room.setEndTimer(null);
        if (!room.playback.isPlaying || !room.playback.queueItemId) return;
        const item = repos.getQueueItem(room.playback.queueItemId);
        if (!item || !item.durationMs) return;
        const remaining = item.durationMs - room.effectivePos() + END_TIMER_SLACK_MS;
        if (remaining <= 0) { this.advance(room, 'end-timer'); return; }
        room.setEndTimer(setTimeout(() => {
            if (room.playback.queueItemId === item.id && room.playback.isPlaying) {
                this.advance(room, 'end-timer');
            }
        }, remaining));
    }

    /** Direct-URL tracks have unknown duration until a client loads metadata. */
    reportDuration(room: RoomState, queueItemId: number, durationMs: number): void {
        if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 6 * 3600_000) return;
        const item = repos.getQueueItem(queueItemId);
        if (!item || item.durationMs > 0) return;
        repos.setItemDuration(queueItemId, durationMs);
        this.broadcastQueue(room);
        if (room.playback.queueItemId === queueItemId) this.armEndTimer(room);
    }

    handleTrackError(room: RoomState, queueItemId: number, clientId: string, code: number): void {
        if (room.playback.queueItemId !== queueItemId) return;
        const { hostReported, ratio } = room.reportError(queueItemId, clientId);
        if (hostReported || ratio >= 0.5) {
            const item = repos.getQueueItem(queueItemId);
            repos.setItemStatus(queueItemId, 'failed');
            this.systemMessage(room, `Skipped “${item?.title ?? 'track'}” — video unavailable (code ${code})`);
            this.notice(room, `Track unavailable, skipping…`, 'warn');
            this.advance(room, 'error-skip');
        }
    }

    /* ── membership / host lifecycle ── */

    join(room: RoomState, socketId: string, m: ConnectedMember): void {
        room.setEvictTimer(null);
        const wasConnected = room.connectedClientIds().has(m.clientId);
        room.sockets.set(socketId, m);
        if (m.clientId === room.hostClientId) room.setHostGraceTimer(null);

        // Host safeguard: if current host is disconnected, assign host to active member
        if (!room.connectedClientIds().has(room.hostClientId) && room.sockets.size > 0) {
            this.setHost(room, m.clientId);
        }

        if (!wasConnected) {
            this.systemMessage(room, `${m.nickname} joined`);
        }
        this.broadcastMembers(room);
        this.broadcastVoteSkip(room);
    }

    leave(room: RoomState, socketId: string): void {
        const m = room.sockets.get(socketId);
        if (!m) return;
        room.sockets.delete(socketId);
        const stillConnected = room.connectedClientIds().has(m.clientId);
        if (!stillConnected) {
            this.systemMessage(room, `${m.nickname} left`);
            this.rtcRemove(room, m.clientId);   // drop from the call if they were in it
            if (m.clientId === room.hostClientId) {
                room.setHostGraceTimer(setTimeout(() => this.transferHostToEldest(room), HOST_GRACE_MS));
            }
        }
        this.broadcastMembers(room);
        this.broadcastVoteSkip(room);

        if (room.sockets.size === 0) {
            room.maybeSnapshot(true);
            room.setEvictTimer(setTimeout(() => {
                room.maybeSnapshot(true);
                room.setEndTimer(null);
                this.rooms.delete(room.code);
            }, EMPTY_ROOM_EVICT_MS));
        }
    }

    private transferHostToEldest(room: RoomState): void {
        const connected = room.connectedClientIds();
        if (connected.has(room.hostClientId) || connected.size === 0) return;
        const order = repos.memberJoinOrder(room.code).filter(m => connected.has(m.client_id));
        const next = order[0];
        if (!next) return;
        this.setHost(room, next.client_id);
    }

    setHost(room: RoomState, clientId: string): void {
        room.hostClientId = clientId;
        repos.setRoomHost(room.code, clientId);
        const nick = [...room.sockets.values()].find(s => s.clientId === clientId)?.nickname ?? 'someone';
        this.systemMessage(room, `${nick} is now the host`);
        this.broadcastMembers(room);
    }
}
