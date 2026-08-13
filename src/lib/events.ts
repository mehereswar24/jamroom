/** Typed Socket.IO protocol — the compile-time contract between client and server. */

import type {
    ChatMessage, ImportCompletePayload, ImportProgressPayload, Member,
    PlaybackState, QueueItem, RoomSnapshot, VideoCandidate, VoteSkipState
} from './types';

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
    'room:join': (p: { roomCode: string; nickname: string; clientId: string }, ack: Ack<{ snapshot: RoomSnapshot }>) => void;
    'room:transferHost': (p: { clientId: string }, ack: Ack) => void;
    'room:setGuestControls': (p: { enabled: boolean }, ack: Ack) => void;

    'sync:ping': (p: { t0: number }, ack: (res: { t0: number; serverTime: number }) => void) => void;

    'playback:play': (ack: Ack) => void;
    'playback:pause': (ack: Ack) => void;
    'playback:seek': (p: { positionMs: number }, ack: Ack) => void;
    'playback:skip': (ack: Ack) => void;
    'playback:playItem': (p: { queueItemId: number }, ack: Ack) => void;
    'playback:ended': (p: { queueItemId: number; positionMs: number }) => void;
    'playback:error': (p: { queueItemId: number; code: number }) => void;
    'playback:duration': (p: { queueItemId: number; durationMs: number }) => void;

    'queue:add': (p: { video: VideoCandidate }, ack: Ack<{ queueItemId: number }>) => void;
    'queue:addUrl': (p: { url: string }, ack: Ack<{ queueItemId: number; title: string }>) => void;
    'queue:remove': (p: { queueItemId: number }, ack: Ack) => void;
    'queue:reorder': (p: { queueItemId: number; toIndex: number }, ack: Ack) => void;
    'queue:shuffle': (ack: Ack) => void;
    'queue:voteSkip': (ack: Ack) => void;
    'queue:fixMatch': (p: { queueItemId: number; video: VideoCandidate }, ack: Ack) => void;

    'import:start': (p: {
        playlistUrl: string;
        clientTracks?: Array<{
            name: string;
            artist: string;
            durationMs: number;
            albumArt?: string | null;
            spotifyTrackId?: string;
        }>;
    }, ack: Ack<{ importId: string }>) => void;
    'import:cancel': (p: { importId: string }, ack: Ack) => void;

    'chat:send': (p: { body: string }, ack: Ack) => void;
    'chat:typing': (p: { isTyping: boolean }) => void;
    'chat:react': (p: { emoji: string }) => void;
}

export interface ServerToClientEvents {
    'room:members': (p: { members: Member[]; hostClientId: string }) => void;
    'room:notice': (p: { text: string; kind: 'info' | 'warn' | 'error' }) => void;
    'room:guestControls': (p: { enabled: boolean }) => void;

    'playback:sync': (p: PlaybackState & { reason: string }) => void;

    'queue:updated': (p: { queue: QueueItem[] }) => void;
    'queue:voteSkip': (p: VoteSkipState) => void;

    'chat:message': (p: { message: ChatMessage }) => void;
    'chat:typing': (p: { clientId: string; nickname: string; isTyping: boolean }) => void;
    'chat:reaction': (p: { clientId: string; nickname: string; emoji: string; x: number }) => void;

    'import:progress': (p: ImportProgressPayload) => void;
    'import:complete': (p: ImportCompletePayload) => void;
}
