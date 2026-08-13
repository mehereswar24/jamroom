'use client';

import { create } from 'zustand';
import type {
    ChatMessage, ImportProgressPayload, Member, PlaybackState,
    QueueItem, RoomSnapshot, VoteSkipState
} from '@/lib/types';

export interface FloatingReaction {
    id: number;
    emoji: string;
    x: number;          // 0..1 horizontal origin
    nickname: string;
}

interface RoomStore {
    joined: boolean;
    joinError: string | null;
    roomCode: string;
    roomName: string;
    hostClientId: string;
    guestControls: boolean;
    selfClientId: string;
    members: Member[];
    queue: QueueItem[];
    playback: PlaybackState;
    messages: ChatMessage[];
    voteSkip: VoteSkipState;
    clockOffset: number;                 // serverTime - clientTime
    typing: Record<string, string>;      // clientId -> nickname
    importProgress: ImportProgressPayload | null;
    reactions: FloatingReaction[];
    notice: { text: string; kind: 'info' | 'warn' | 'error' } | null;

    applySnapshot: (s: RoomSnapshot) => void;
    setJoinError: (e: string | null) => void;
    setMembers: (members: Member[], hostClientId: string) => void;
    setGuestControls: (enabled: boolean) => void;
    setPlayback: (p: PlaybackState) => void;
    setQueue: (q: QueueItem[]) => void;
    setVoteSkip: (v: VoteSkipState) => void;
    addMessage: (m: ChatMessage) => void;
    setClockOffset: (o: number) => void;
    setTyping: (clientId: string, nickname: string, isTyping: boolean) => void;
    setImportProgress: (p: ImportProgressPayload | null) => void;
    addReaction: (emoji: string, x: number, nickname: string) => void;
    removeReaction: (id: number) => void;
    setNotice: (n: RoomStore['notice']) => void;
    serverNow: () => number;
    effectivePos: () => number;
}

let reactionSeq = 1;

export const useRoomStore = create<RoomStore>((set, get) => ({
    joined: false,
    joinError: null,
    roomCode: '',
    roomName: '',
    hostClientId: '',
    guestControls: false,
    selfClientId: '',
    members: [],
    queue: [],
    playback: { queueItemId: null, videoId: null, mediaUrl: null, basePositionMs: 0, baseServerTime: 0, isPlaying: false },
    messages: [],
    voteSkip: { votes: 0, needed: 1, voters: [] },
    clockOffset: 0,
    typing: {},
    importProgress: null,
    reactions: [],
    notice: null,

    applySnapshot: (s) => set({
        joined: true,
        joinError: null,
        roomCode: s.roomCode,
        roomName: s.roomName,
        hostClientId: s.hostClientId,
        guestControls: s.guestControls,
        selfClientId: s.self.clientId,
        members: s.members,
        queue: s.queue,
        playback: s.playback,
        messages: s.messages,
        voteSkip: s.voteSkip,
        // Rough offset immediately from the join ack; ping sampling refines it.
        clockOffset: s.serverTime - Date.now()
    }),
    setJoinError: (joinError) => set({ joinError }),
    setMembers: (members, hostClientId) => set({ members, hostClientId }),
    setGuestControls: (guestControls) => set({ guestControls }),
    setPlayback: (playback) => set({ playback }),
    setQueue: (queue) => set({ queue }),
    setVoteSkip: (voteSkip) => set({ voteSkip }),
    addMessage: (m) => set(st => ({ messages: [...st.messages.slice(-300), m] })),
    setClockOffset: (clockOffset) => set({ clockOffset }),
    setTyping: (clientId, nickname, isTyping) => set(st => {
        const typing = { ...st.typing };
        if (isTyping) typing[clientId] = nickname; else delete typing[clientId];
        return { typing };
    }),
    setImportProgress: (importProgress) => set({ importProgress }),
    addReaction: (emoji, x, nickname) => set(st => ({
        reactions: [...st.reactions.slice(-30), { id: reactionSeq++, emoji, x, nickname }]
    })),
    removeReaction: (id) => set(st => ({ reactions: st.reactions.filter(r => r.id !== id) })),
    setNotice: (notice) => set({ notice }),

    serverNow: () => Date.now() + get().clockOffset,
    effectivePos: () => {
        const { playback } = get();
        if (!playback.queueItemId) return 0;
        return playback.isPlaying
            ? playback.basePositionMs + (get().serverNow() - playback.baseServerTime)
            : playback.basePositionMs;
    }
}));
