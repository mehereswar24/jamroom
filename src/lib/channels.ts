/** Ably channel + event names — the serverless realtime contract. */

export const roomChannel = (code: string) => `room:${code}`;
/** Dedicated channel for high-frequency game traffic (drawing strokes). */
export const gameChannel = (code: string) => `room:${code}:game`;

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
    gameState: 'game:state',         // Pictionary state machine (server-published)
    gameFeed: 'game:feed',           // guesses / "X guessed it!" (server-published)
    boardState: 'board:state',       // turn-based board games (server-published)
} as const;

/** Events on the dedicated game channel (client-published, ephemeral). */
export const GAME_EV = {
    stroke: 'stroke',        // { pts:[{x,y}], color, size } — a batch of points
    clear: 'clear',
    undo: 'undo',
    resyncReq: 'resyncReq',  // a joiner asks the drawer for the full canvas
    resyncData: 'resyncData',// drawer replies with a chunk of stroke history
} as const;
