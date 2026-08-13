/** Shared domain types — imported by both client and server. No Node deps here. */

export type MatchStatus = 'matched' | 'needs_review' | 'failed';

export interface Member {
    clientId: string;
    nickname: string;
    avatarColor: string;
    connected: boolean;
}

export interface QueueItem {
    id: number;
    sortOrder: number;
    title: string;
    artist: string | null;
    durationMs: number;
    albumArtUrl: string | null;
    source: 'youtube' | 'spotify' | 'url';
    spotifyTrackId: string | null;
    youtubeVideoId: string | null;
    /** Direct audio/video file URL for source='url' items (played via HTML5). */
    mediaUrl: string | null;
    matchStatus: MatchStatus;
    matchScore: number | null;
    addedBy: string;
    playedAt: number | null;
}

/**
 * The playback timeline primitive. Effective position at time t (server clock):
 *   isPlaying ? basePositionMs + (t - baseServerTime) : basePositionMs
 */
export interface PlaybackState {
    queueItemId: number | null;
    videoId: string | null;
    /** Set instead of videoId for direct-URL (HTML5) tracks. */
    mediaUrl: string | null;
    basePositionMs: number;
    baseServerTime: number;
    isPlaying: boolean;
}

export interface ChatMessage {
    id: number;
    clientId: string | null;
    nickname: string;
    type: 'chat' | 'system';
    body: string;
    createdAt: number;
}

export interface VideoCandidate {
    videoId: string;
    title: string;
    channel: string;
    durationMs: number;
    thumb: string | null;
}

export interface VoteSkipState {
    votes: number;
    needed: number;
    voters: string[];       // clientIds
}

export interface RoomSnapshot {
    roomCode: string;
    roomName: string;
    hostClientId: string;
    guestControls: boolean;
    self: { clientId: string };
    members: Member[];
    queue: QueueItem[];
    playback: PlaybackState;
    messages: ChatMessage[];
    voteSkip: VoteSkipState;
    serverTime: number;
}

/* WebRTC call presence + signaling (structural shapes so this stays DOM-free
 * on the server; the client casts to RTCSessionDescriptionInit / RTCIceCandidateInit). */
export interface RtcPeer {
    clientId: string;
    nickname: string;
    audio: boolean;
    video: boolean;
    screen: boolean;
}

export interface RtcSignalData {
    description?: { type: string; sdp?: string };
    candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null;
}

export interface ImportProgressPayload {
    importId: string;
    done: number;
    total: number;
    playlistName: string;
    current: { title: string; artist: string } | null;
    lastResult: { queueItemId: number; status: MatchStatus; score: number | null } | null;
}

export interface ImportCompletePayload {
    importId: string;
    playlistName: string;
    matched: number;
    needsReview: number;
    failed: number;
}
