'use client';

/**
 * Ably realtime client (replaces the Socket.IO singleton).
 *
 * One Realtime connection per tab, authenticated by a short-lived token from
 * /api/ably/token so the Ably key stays server-side. Room membership uses Ably
 * presence; room events arrive on the `room:{CODE}` channel.
 */

import * as Ably from 'ably';
import { roomChannel, gameChannel } from '@/lib/channels';

let client: Ably.Realtime | null = null;

export function getAbly(clientId: string): Ably.Realtime {
    if (client) return client;
    client = new Ably.Realtime({
        authUrl: '/api/ably/token',
        authParams: { clientId },
        clientId,
        // Recover from brief network blips without a full re-auth storm.
        disconnectedRetryTimeout: 2_000,
        suspendedRetryTimeout: 5_000,
    });
    return client;
}

export function getRoomChannel(clientId: string, code: string): Ably.RealtimeChannel {
    return getAbly(clientId).channels.get(roomChannel(code));
}

/** Dedicated high-frequency channel for drawing strokes. */
export function getGameChannel(clientId: string, code: string): Ably.RealtimeChannel {
    return getAbly(clientId).channels.get(gameChannel(code));
}

export function closeAbly(): void {
    try { client?.close(); } catch { /* ignore */ }
    client = null;
}
