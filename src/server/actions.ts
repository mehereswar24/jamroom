/** Shared helpers for the serverless room-action routes. */

import { EV } from '../lib/channels';
import type { PlaybackState, VoteSkipState } from '../lib/types';
import { publish } from './realtime/publish';
import { presenceCount } from './realtime/presence';
import * as store from './store/roomStore';
import type { RoomMeta } from './store/roomStore';

export function canControl(meta: RoomMeta, clientId: string): boolean {
    return meta.guestControls || meta.hostClientId === clientId;
}

export async function publishPlayback(code: string, playback: PlaybackState, reason: string): Promise<void> {
    await publish(code, EV.playbackSync, { ...playback, reason });
}

export async function publishQueue(code: string): Promise<void> {
    await publish(code, EV.queueUpdated, { queue: await store.listQueue(code) });
}

export async function voteSkipState(code: string): Promise<VoteSkipState> {
    const votes = await store.getVotes(code);
    const present = Math.max(1, await presenceCount(code));
    return { votes: votes.length, needed: Math.max(1, Math.ceil(present / 2)), voters: votes };
}

export async function publishVoteSkip(code: string): Promise<void> {
    await publish(code, EV.voteSkip, await voteSkipState(code));
}

export async function systemMessage(code: string, body: string): Promise<void> {
    const msg = await store.addMessage(code, { clientId: null, nickname: 'system', type: 'system', body });
    await publish(code, EV.chatMessage, { message: msg });
}

export async function notice(code: string, text: string, kind: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
    await publish(code, EV.notice, { text, kind });
}
