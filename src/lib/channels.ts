/** Ably channel + event names — the serverless realtime contract. */

export const roomChannel = (code: string) => `room:${code}`;

/** Event names published on a room channel (server → clients, and client presence). */
export const EV = {
    members: 'members',        // presence-derived list (published by server on join/leave hooks) — optional
    playbackSync: 'playback:sync',
    queueUpdated: 'queue:updated',
    voteSkip: 'queue:voteSkip',
    chatMessage: 'chat:message',
    chatTyping: 'chat:typing',       // ephemeral, client-published
    chatReaction: 'chat:reaction',   // ephemeral, client-published
    notice: 'room:notice',
    guestControls: 'room:guestControls',
    hostChanged: 'room:hostChanged',
    importProgress: 'import:progress',
    importComplete: 'import:complete',
    rtcSignal: 'rtc:signal',         // ephemeral, client-published (WebRTC)
} as const;
