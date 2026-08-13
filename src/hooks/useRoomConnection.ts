'use client';

/**
 * Owns the socket lifecycle for a room: joins on mount (and on reconnect),
 * subscribes every server event into the zustand store, runs clock sync.
 */

import { useEffect } from 'react';
import { getSocket } from './socket';
import { useRoomStore } from './useRoomStore';

const PING_SAMPLES = 5;
const PING_GAP_MS = 200;
const PING_INTERVAL_MS = 30_000;

export function useRoomConnection(roomCode: string, nickname: string, clientId: string) {
    useEffect(() => {
        if (!roomCode || !nickname || !clientId) return;
        const socket = getSocket();
        const st = useRoomStore.getState();

        let joinTimeout: ReturnType<typeof setTimeout> | null = null;

        const join = () => {
            if (joinTimeout) clearTimeout(joinTimeout);
            
            // Timeout safety: if join ack doesn't arrive in 5s, display error
            joinTimeout = setTimeout(() => {
                if (!useRoomStore.getState().joined && !useRoomStore.getState().joinError) {
                    useRoomStore.getState().setJoinError('Room connection timeout. Click to retry.');
                }
            }, 6000);

            socket.emit('room:join', { roomCode, nickname, clientId }, (res) => {
                if (joinTimeout) clearTimeout(joinTimeout);
                if (res.ok) {
                    useRoomStore.getState().applySnapshot(res.snapshot);
                } else {
                    useRoomStore.getState().setJoinError(res.error || 'Could not join room');
                }
            });
        };

        /** Clock sync: N pings, keep offset from the lowest-RTT sample. */
        const syncClock = async () => {
            let best: { rtt: number; offset: number } | null = null;
            for (let i = 0; i < PING_SAMPLES; i++) {
                await new Promise<void>((resolve) => {
                    const t0 = Date.now();
                    socket.emit('sync:ping', { t0 }, ({ serverTime }) => {
                        const t1 = Date.now();
                        const rtt = t1 - t0;
                        const offset = serverTime - (t0 + rtt / 2);
                        if (!best || rtt < best.rtt) best = { rtt, offset };
                        resolve();
                    });
                    setTimeout(resolve, 1500);   // don't hang on a lost ack
                });
                await new Promise(r => setTimeout(r, PING_GAP_MS));
            }
            if (best) useRoomStore.getState().setClockOffset((best as { offset: number }).offset);
        };

        const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

        const onConnect = () => { join(); void syncClock(); };
        socket.on('connect', onConnect);
        socket.connect();
        join(); // Trigger immediate join attempt
        if (socket.connected) void syncClock();

        socket.on('room:members', (p) => st.setMembers(p.members, p.hostClientId));
        socket.on('room:guestControls', (p) => st.setGuestControls(p.enabled));
        socket.on('room:notice', (p) => {
            st.setNotice(p);
            setTimeout(() => useRoomStore.getState().setNotice(null), 4000);
        });
        socket.on('playback:sync', (p) => st.setPlayback({
            queueItemId: p.queueItemId, videoId: p.videoId, mediaUrl: p.mediaUrl ?? null,
            basePositionMs: p.basePositionMs, baseServerTime: p.baseServerTime, isPlaying: p.isPlaying
        }));
        socket.on('queue:updated', (p) => st.setQueue(p.queue));
        socket.on('queue:voteSkip', (p) => st.setVoteSkip(p));
        socket.on('chat:message', (p) => st.addMessage(p.message));
        socket.on('chat:typing', (p) => {
            st.setTyping(p.clientId, p.nickname, p.isTyping);
            const prev = typingTimeouts.get(p.clientId);
            if (prev) clearTimeout(prev);
            if (p.isTyping) {
                typingTimeouts.set(p.clientId, setTimeout(() => {
                    useRoomStore.getState().setTyping(p.clientId, p.nickname, false);
                }, 4000));
            }
        });
        socket.on('chat:reaction', (p) => st.addReaction(p.emoji, p.x, p.nickname));
        socket.on('import:progress', (p) => st.setImportProgress(p));
        socket.on('import:complete', () => {
            setTimeout(() => useRoomStore.getState().setImportProgress(null), 2500);
        });

        const pingTimer = setInterval(() => { if (socket.connected) void syncClock(); }, PING_INTERVAL_MS);

        return () => {
            clearInterval(pingTimer);
            typingTimeouts.forEach(t => clearTimeout(t));
            socket.off('connect', onConnect);
            socket.off('room:members');
            socket.off('room:guestControls');
            socket.off('room:notice');
            socket.off('playback:sync');
            socket.off('queue:updated');
            socket.off('queue:voteSkip');
            socket.off('chat:message');
            socket.off('chat:typing');
            socket.off('chat:reaction');
            socket.off('import:progress');
            socket.off('import:complete');
        };
    }, [roomCode, nickname, clientId]);
}
