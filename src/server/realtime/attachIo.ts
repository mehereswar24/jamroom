import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../lib/events';
import { avatarColorFor, normalizeRoomCode } from '../../lib/ids';
import * as repos from '../db/repos';
import { RoomManager, type RoomState } from '../rooms/RoomManager';
import { startImport, cancelImport } from '../import/importManager';
import { allow } from '../rateLimit';

interface SocketCtx {
    roomCode: string | null;
    clientId: string | null;
    nickname: string;
}

const MAX_CHAT_LEN = 500;
const MAX_NICK_LEN = 24;
const ALLOWED_REACTIONS = new Set(['🔥', '❤️', '🎉', '😂', '😭', '🕺', '👀', '💯']);

export function attachIo(httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents> {
    const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
        cors: { origin: true, credentials: true },
        maxHttpBufferSize: 64 * 1024
    });
    const rooms = new RoomManager(io);

    io.on('connection', (socket) => {
        const ctx: SocketCtx = { roomCode: null, clientId: null, nickname: '' };

        const currentRoom = (): RoomState | null =>
            ctx.roomCode ? rooms.get(ctx.roomCode) : null;

        const requireMember = (): RoomState | null => {
            const room = currentRoom();
            return room && ctx.clientId ? room : null;
        };

        socket.on('sync:ping', ({ t0 }, ack) => {
            if (typeof ack === 'function') ack({ t0, serverTime: Date.now() });
        });

        /* ── room ── */

        socket.on('room:join', (p, ack) => {
            try {
                const code = normalizeRoomCode(String(p?.roomCode ?? ''));
                const nickname = String(p?.nickname ?? '').trim().slice(0, MAX_NICK_LEN);
                const clientId = String(p?.clientId ?? '').trim().slice(0, 64);
                if (!code || !nickname || !clientId) return ack({ ok: false, error: 'Missing nickname or room code' });

                const room = rooms.get(code);
                if (!room) return ack({ ok: false, error: 'Room not found — check the code' });

                // Leave any previous room on this socket
                if (ctx.roomCode && ctx.roomCode !== code) {
                    const prev = rooms.get(ctx.roomCode);
                    if (prev) rooms.leave(prev, socket.id);
                    socket.leave(ctx.roomCode);
                }

                ctx.roomCode = code;
                ctx.clientId = clientId;
                ctx.nickname = nickname;

                const avatarColor = avatarColorFor(clientId);
                repos.upsertMember(code, clientId, nickname, avatarColor);
                socket.join(code);
                rooms.join(room, socket.id, { socketId: socket.id, clientId, nickname, avatarColor });

                ack({
                    ok: true,
                    snapshot: {
                        roomCode: code,
                        roomName: room.name,
                        hostClientId: room.hostClientId,
                        guestControls: room.guestControls,
                        self: { clientId },
                        members: room.connectedMembers(),
                        queue: repos.listQueue(code),
                        playback: { ...room.playback },
                        messages: repos.recentMessages(code),
                        voteSkip: room.voteSkipState(),
                        serverTime: Date.now()
                    }
                });
            } catch (err) {
                console.error('[io] room:join failed:', err);
                ack({ ok: false, error: 'Join failed — try again' });
            }
        });

        socket.on('room:transferHost', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!room.isHost(ctx.clientId!)) return ack({ ok: false, error: 'Only the host can transfer host' });
            if (!room.connectedClientIds().has(p?.clientId)) return ack({ ok: false, error: 'That member is not connected' });
            rooms.setHost(room, p.clientId);
            ack({ ok: true });
        });

        socket.on('room:setGuestControls', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!room.isHost(ctx.clientId!)) return ack({ ok: false, error: 'Host only' });
            room.guestControls = !!p?.enabled;
            repos.setRoomGuestControls(room.code, room.guestControls);
            io.to(room.code).emit('room:guestControls', { enabled: room.guestControls });
            rooms.systemMessage(room, `Guest controls ${room.guestControls ? 'enabled' : 'disabled'}`);
            ack({ ok: true });
        });

        /* ── playback ── */

        const guardControl = (ack: (r: { ok: false; error: string }) => void): RoomState | null => {
            const room = requireMember();
            if (!room) { ack({ ok: false, error: 'Not in a room' }); return null; }
            if (!room.canControl(ctx.clientId!)) { ack({ ok: false, error: 'Host has playback control (ask them to enable guest controls)' }); return null; }
            return room;
        };

        socket.on('playback:play', (ack) => {
            const room = guardControl(ack); if (!room) return;
            rooms.play(room); ack({ ok: true });
        });
        socket.on('playback:pause', (ack) => {
            const room = guardControl(ack); if (!room) return;
            rooms.pause(room); ack({ ok: true });
        });
        socket.on('playback:seek', (p, ack) => {
            const room = guardControl(ack); if (!room) return;
            const pos = Number(p?.positionMs);
            if (!Number.isFinite(pos) || pos < 0) return ack({ ok: false, error: 'Bad position' });
            rooms.seek(room, pos); ack({ ok: true });
        });
        socket.on('playback:skip', (ack) => {
            const room = guardControl(ack); if (!room) return;
            rooms.advance(room, 'skip'); ack({ ok: true });
        });
        socket.on('playback:playItem', (p, ack) => {
            const room = guardControl(ack); if (!room) return;
            const okPlay = rooms.playItem(room, Number(p?.queueItemId));
            ack(okPlay ? { ok: true } : { ok: false, error: 'That track is not playable' });
        });

        socket.on('playback:ended', (p) => {
            const room = requireMember(); if (!room) return;
            const { queueItemId, positionMs } = p ?? {};
            if (room.playback.queueItemId !== queueItemId || !room.playback.isPlaying) return;
            const item = repos.getQueueItem(Number(queueItemId));
            const nearEnd = item?.durationMs ? Math.abs(item.durationMs - Number(positionMs)) < 3000 : false;
            if (room.isHost(ctx.clientId!) || nearEnd) rooms.advance(room, 'ended');
        });

        socket.on('playback:error', (p) => {
            const room = requireMember(); if (!room) return;
            rooms.handleTrackError(room, Number(p?.queueItemId), ctx.clientId!, Number(p?.code) || 0);
        });

        socket.on('playback:duration', (p) => {
            const room = requireMember(); if (!room) return;
            rooms.reportDuration(room, Number(p?.queueItemId), Number(p?.durationMs));
        });

        /* ── queue ── */

        socket.on('queue:add', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!allow(`${socket.id}:qadd`, 1, 8)) return ack({ ok: false, error: 'Slow down a little' });
            const v = p?.video;
            if (!v?.videoId || !v?.title) return ack({ ok: false, error: 'Bad video' });
            const id = repos.addYouTubeItem(room.code, {
                videoId: String(v.videoId).slice(0, 20),
                title: String(v.title).slice(0, 200),
                channel: String(v.channel ?? '').slice(0, 120),
                durationMs: Math.max(0, Number(v.durationMs) || 0),
                thumb: v.thumb ? String(v.thumb).slice(0, 400) : null
            }, ctx.nickname);
            rooms.broadcastQueue(room);
            // Nothing playing? Kick things off.
            if (!room.playback.queueItemId) rooms.advance(room, 'first-add');
            ack({ ok: true, queueItemId: id });
        });

        // Paste any playable link: YouTube URLs become normal synced YouTube
        // items; direct audio/video file URLs play via the synced HTML5 player.
        socket.on('queue:addUrl', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!allow(`${socket.id}:qadd`, 1, 8)) return ack({ ok: false, error: 'Slow down a little' });
            const raw = String(p?.url ?? '').trim().slice(0, 2000);
            if (!raw) return ack({ ok: false, error: 'Paste a link first' });

            const { resolveUrl } = require('../media/resolveUrl');
            void resolveUrl(raw).then((r: import('../media/resolveUrl').ResolvedUrl) => {
                const current = requireMember();
                if (!current) return ack({ ok: false, error: 'Not in a room' });
                if (r.kind === 'error') return ack({ ok: false, error: r.error });
                let id: number;
                let title: string;
                if (r.kind === 'youtube') {
                    id = repos.addYouTubeItem(current.code, r.video, ctx.nickname);
                    title = r.video.title;
                } else {
                    id = repos.addUrlItem(current.code, { url: r.url, title: r.title.slice(0, 200) }, ctx.nickname);
                    title = r.title;
                }
                rooms.broadcastQueue(current);
                if (!current.playback.queueItemId) rooms.advance(current, 'first-add');
                ack({ ok: true, queueItemId: id, title });
            }).catch((err: unknown) => {
                console.error('[io] queue:addUrl failed:', err);
                ack({ ok: false, error: 'Could not resolve that link' });
            });
        });

        socket.on('queue:remove', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            const item = repos.getQueueItem(Number(p?.queueItemId));
            if (!item) return ack({ ok: false, error: 'Not found' });
            const mayRemove = room.isHost(ctx.clientId!) || item.addedBy === ctx.nickname;
            if (!mayRemove) return ack({ ok: false, error: 'Only the host or whoever added it can remove' });
            if (room.playback.queueItemId === item.id) rooms.advance(room, 'removed-current');
            repos.removeQueueItem(item.id);
            rooms.broadcastQueue(room);
            ack({ ok: true });
        });

        socket.on('queue:reorder', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!room.canControl(ctx.clientId!)) return ack({ ok: false, error: 'Host only (or enable guest controls)' });
            const queue = repos.listQueue(room.code);
            const ids = queue.map(q => q.id);
            const from = ids.indexOf(Number(p?.queueItemId));
            const to = Math.max(0, Math.min(ids.length - 1, Number(p?.toIndex)));
            if (from === -1) return ack({ ok: false, error: 'Not found' });
            ids.splice(to, 0, ids.splice(from, 1)[0]);
            repos.reorderQueue(room.code, ids);
            rooms.broadcastQueue(room);
            ack({ ok: true });
        });

        socket.on('queue:shuffle', (ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!room.canControl(ctx.clientId!)) return ack({ ok: false, error: 'Host only (or enable guest controls)' });
            repos.shuffleQueue(room.code, room.playback.queueItemId);
            rooms.broadcastQueue(room);
            rooms.systemMessage(room, `${ctx.nickname} shuffled the room queue 🔀`);
            ack({ ok: true });
        });

        socket.on('queue:voteSkip', (ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!room.playback.queueItemId) return ack({ ok: false, error: 'Nothing is playing' });
            const cid = ctx.clientId!;
            if (room.voteSkip.has(cid)) room.voteSkip.delete(cid);
            else room.voteSkip.add(cid);
            const state = room.voteSkipState();
            if (state.votes >= state.needed) {
                rooms.systemMessage(room, 'Vote passed — skipping track');
                rooms.advance(room, 'vote-skip');
            } else {
                rooms.broadcastVoteSkip(room);
            }
            ack({ ok: true });
        });

        socket.on('queue:fixMatch', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            const item = repos.getQueueItem(Number(p?.queueItemId));
            const v = p?.video;
            if (!item || !v?.videoId) return ack({ ok: false, error: 'Bad request' });
            repos.setItemMatch(item.id, String(v.videoId).slice(0, 20), 'matched', 1);
            // If it's the current (broken) track, restart it with the fixed video
            if (room.playback.queueItemId === item.id) rooms.playItem(room, item.id);
            rooms.broadcastQueue(room);
            ack({ ok: true });
        });

        /* ── import ── */

        socket.on('import:start', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!allow(`${socket.id}:import`, 1 / 30, 2)) return ack({ ok: false, error: 'An import just ran — wait a moment' });
            startImport({
                io, roomCode: room.code, playlistUrl: String(p?.playlistUrl ?? ''),
                clientTracks: p?.clientTracks,
                requestedBy: ctx.nickname,
                onQueueChanged: () => rooms.broadcastQueue(room),
                onSystemMessage: (text) => rooms.systemMessage(room, text),
                onTrackMatched: (queueItemId) => {
                    if (!room.playback.queueItemId) {
                        rooms.playItem(room, queueItemId);
                    }
                }
            }).then(res => ack(res.ok ? { ok: true, importId: res.importId! } : { ok: false, error: res.error! }));
        });

        socket.on('import:cancel', (p, ack) => {
            cancelImport(String(p?.importId ?? ''));
            ack({ ok: true });
        });

        /* ── chat ── */

        socket.on('chat:send', (p, ack) => {
            const room = requireMember();
            if (!room) return ack({ ok: false, error: 'Not in a room' });
            if (!allow(`${socket.id}:chat`, 1.5, 6)) return ack({ ok: false, error: 'Sending too fast' });
            const body = String(p?.body ?? '').trim().slice(0, MAX_CHAT_LEN);
            if (!body) return ack({ ok: false, error: 'Empty message' });
            const msg = repos.insertMessage(room.code, {
                clientId: ctx.clientId, nickname: ctx.nickname, type: 'chat', body
            });
            io.to(room.code).emit('chat:message', { message: msg });
            ack({ ok: true });
        });

        socket.on('chat:typing', (p) => {
            const room = requireMember(); if (!room) return;
            socket.to(room.code).volatile.emit('chat:typing', {
                clientId: ctx.clientId!, nickname: ctx.nickname, isTyping: !!p?.isTyping
            });
        });

        socket.on('chat:react', (p) => {
            const room = requireMember(); if (!room) return;
            if (!allow(`${socket.id}:react`, 3, 10)) return;
            const emoji = ALLOWED_REACTIONS.has(p?.emoji) ? p.emoji : '🔥';
            io.to(room.code).volatile.emit('chat:reaction', {
                clientId: ctx.clientId!, nickname: ctx.nickname, emoji, x: Math.random()
            });
        });

        socket.on('disconnect', () => {
            const room = currentRoom();
            if (room) rooms.leave(room, socket.id);
        });
    });

    return io;
}
