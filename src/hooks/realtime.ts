'use client';

/**
 * Ably realtime client.
 *
 * One Realtime connection per tab, authenticated by a short-lived token from
 * /api/ably/token so the Ably key stays server-side.
 *
 * The connection is keyed by ROOM CODE, not by a client-chosen id: the server
 * derives clientId from the signed identity cookie and stamps it into the
 * token request, and Ably rejects any attempt to connect under a different
 * clientId. That is what stops a guest from entering presence as the host.
 */

import * as Ably from 'ably';
import { roomChannel, gameChannel, callChannel } from '@/lib/channels';

let client: Ably.Realtime | null = null;
let currentCode = '';

export function getAbly(code: string): Ably.Realtime {
    if (client && currentCode === code) return client;
    if (client) closeAbly();

    currentCode = code;
    client = new Ably.Realtime({
        authUrl: '/api/ably/token',
        // The server needs the room to scope the token's capability. clientId
        // is deliberately NOT sent — it comes back from the server.
        authParams: { code },
        // Send cookies so the identity cookie reaches the auth endpoint.
        authMethod: 'GET',
        // Recover from brief network blips without a full re-auth storm.
        disconnectedRetryTimeout: 2_000,
        suspendedRetryTimeout: 5_000,
    });
    return client;
}

/** The server-assigned clientId for this connection, or '' before auth. */
export function currentClientId(): string {
    return client?.auth.clientId ?? '';
}

/** Resolve once the connection has authenticated and has an identity. */
export async function waitForIdentity(code: string): Promise<string> {
    const ably = getAbly(code);
    if (ably.auth.clientId) return ably.auth.clientId;
    await ably.connection.once('connected');
    return ably.auth.clientId ?? '';
}

export function getRoomChannel(code: string): Ably.RealtimeChannel {
    return getAbly(code).channels.get(roomChannel(code));
}

/** Dedicated high-frequency channel for drawing strokes. */
export function getGameChannel(code: string): Ably.RealtimeChannel {
    return getAbly(code).channels.get(gameChannel(code));
}

/** WebRTC signalling channel for the call. */
export function getCallChannel(code: string): Ably.RealtimeChannel {
    return getAbly(code).channels.get(callChannel(code));
}

export function closeAbly(): void {
    try { client?.close(); } catch { /* ignore */ }
    client = null;
    currentCode = '';
}
