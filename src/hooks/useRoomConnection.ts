'use client';

/**
 * Ably-backed room connection: loads the snapshot, enters presence, subscribes
 * to room events, runs clock sync, and drives client-side host handoff.
 */

import { useEffect } from 'react';
import type * as Ably from 'ably';
import { EV } from '@/lib/channels';
import { avatarColorFor } from '@/lib/ids';
import { getRoomChannel } from './realtime';
import { setApiRoom, api } from './api';
import { useRoomStore } from './useRoomStore';
import type { Member } from '@/lib/types';

const CLOCK_SAMPLES = 4;

export function useRoomConnection(roomCode: string, nickname: string, clientId: string) {
    useEffect(() => {
        if (!roomCode || !nickname || !clientId) return;
        setApiRoom(roomCode);
        const st = useRoomStore.getState();
        const channel = getRoomChannel(roomCode);
        const joinedAt = Date.now();
        let disposed = false;
        let currentHost = '';

        const loadSnapshot = async () => {
            try {
                const res = await fetch(`/api/rooms/${roomCode}?clientId=${encodeURIComponent(clientId)}`);
                const j = await res.json();
                if (disposed) return;
                if (j.ok) { currentHost = j.snapshot.hostClientId; useRoomStore.getState().applySnapshot(j.snapshot); }
                else useRoomStore.getState().setJoinError(j.error || 'Room not found');
            } catch {
                if (!disposed) useRoomStore.getState().setJoinError('Could not reach the room. Retry.');
            }
        };

        const syncClock = async () => {
            let best: { rtt: number; offset: number } | null = null;
            for (let i = 0; i < CLOCK_SAMPLES; i++) {
                const t0 = Date.now();
                try {
                    const { t } = await fetch('/api/time').then(r => r.json());
                    const t1 = Date.now();
                    const rtt = t1 - t0;
                    const offset = t - (t0 + rtt / 2);
                    if (!best || rtt < best.rtt) best = { rtt, offset };
                } catch { /* ignore */ }
                await new Promise(r => setTimeout(r, 150));
            }
            if (best && !disposed) useRoomStore.getState().setClockOffset(best.offset);
        };

        const refreshMembers = async () => {
            try {
                const members = await channel.presence.get();
                if (disposed) return;
                const byId = new Map<string, Member>();
                for (const m of members) {
                    if (!m.clientId) continue;
                    const d = (m.data ?? {}) as { nickname?: string; avatarColor?: string; joinedAt?: number };
                    byId.set(m.clientId, {
                        clientId: m.clientId, nickname: d.nickname ?? 'Guest',
                        avatarColor: d.avatarColor ?? avatarColorFor(m.clientId), connected: true
                    });
                }
                const list = [...byId.values()];
                useRoomStore.getState().setMembers(list, currentHost || useRoomStore.getState().hostClientId);

                // Client-driven host handoff: if the host isn't present and I'm the
                // earliest-joined member here, claim host (server verifies).
                const host = useRoomStore.getState().hostClientId;
                const hostPresent = members.some(m => m.clientId === host);
                if (!hostPresent && members.length) {
                    const eldest = [...members].sort((a, b) =>
                        (((a.data as { joinedAt?: number })?.joinedAt ?? 0) - ((b.data as { joinedAt?: number })?.joinedAt ?? 0)))[0];
                    if (eldest?.clientId === clientId) {
                        const r = await api.room('claimHost');
                        if (r.ok && 'hostClientId' in r && typeof r.hostClientId === 'string') currentHost = r.hostClientId;
                    }
                }
            } catch { /* ignore */ }
        };

        // Event subscriptions
        const sub = <T,>(ev: string, fn: (data: T, msg: Ably.Message) => void) =>
            channel.subscribe(ev, (msg) => fn(msg.data as T, msg));

        sub(EV.playbackSync, (p: { queueItemId: number | null; videoId: string | null; mediaUrl: string | null; basePositionMs: number; baseServerTime: number; isPlaying: boolean }) =>
            st.setPlayback({ queueItemId: p.queueItemId, videoId: p.videoId, mediaUrl: p.mediaUrl ?? null, basePositionMs: p.basePositionMs, baseServerTime: p.baseServerTime, isPlaying: p.isPlaying }));
        // The queue is too big for Ably; the ping just tells us to re-pull it
        // over HTTP. Debounce so a burst of import updates coalesces into one fetch.
        let queueFetchTimer: ReturnType<typeof setTimeout> | null = null;
        const pullQueue = () => {
            if (queueFetchTimer) clearTimeout(queueFetchTimer);
            queueFetchTimer = setTimeout(async () => {
                try {
                    const j = await fetch(`/api/rooms/${roomCode}/queue`).then(r => r.json());
                    if (!disposed && j.ok) useRoomStore.getState().setQueue(j.queue);
                } catch { /* ignore */ }
            }, 300);
        };
        sub(EV.queueUpdated, () => pullQueue());
        sub(EV.voteSkip, (p: { votes: number; needed: number; voters: string[] }) => st.setVoteSkip(p));
        sub(EV.chatMessage, (p: { message: never }) => st.addMessage(p.message));
        sub(EV.notice, (p: { text: string; kind: 'info' | 'warn' | 'error' }) => {
            st.setNotice(p);
            setTimeout(() => useRoomStore.getState().setNotice(null), 4000);
        });
        sub(EV.guestControls, (p: { enabled: boolean }) => st.setGuestControls(p.enabled));
        sub(EV.hostChanged, (p: { hostClientId: string }) => {
            currentHost = p.hostClientId;
            useRoomStore.getState().setMembers(useRoomStore.getState().members, p.hostClientId);
        });
        sub(EV.importProgress, (p: never) => st.setImportProgress(p));
        sub(EV.importComplete, () => setTimeout(() => useRoomStore.getState().setImportProgress(null), 2500));

        // Ephemeral, client-published events (ignore our own echoes where noise)
        channel.subscribe(EV.chatTyping, (msg) => {
            if (msg.clientId === clientId) return;
            const d = msg.data as { nickname: string; isTyping: boolean };
            st.setTyping(msg.clientId!, d.nickname, d.isTyping);
        });
        channel.subscribe(EV.chatReaction, (msg) => {
            const d = msg.data as { emoji: string; x: number; nickname: string };
            st.addReaction(d.emoji, d.x, d.nickname);
        });

        // Presence
        const presenceData = { nickname, avatarColor: avatarColorFor(clientId), joinedAt };
        channel.presence.subscribe(['enter', 'leave', 'update', 'present'], () => { void refreshMembers(); });
        void channel.presence.enter(presenceData).then(() => refreshMembers());

        void loadSnapshot();
        void syncClock();
        const clockTimer = setInterval(() => { void syncClock(); }, 30_000);

        return () => {
            disposed = true;
            clearInterval(clockTimer);
            try { channel.presence.leave(); } catch { /* ignore */ }
            channel.unsubscribe();
            channel.presence.unsubscribe();
        };
    }, [roomCode, nickname, clientId]);
}
