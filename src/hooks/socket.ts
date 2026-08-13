'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@/lib/events';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * Singleton socket — same origin as the page, so tunnel/prod URLs just work.
 *
 * Transport order is deliberate: start with HTTP long-polling (which succeeds
 * through virtually every proxy, CDN, and tunnel), then transparently upgrade
 * to WebSocket once connected. Forcing websocket-first is what made prod hang
 * on "Connecting…": if the WebSocket upgrade is blocked and socket.io v4.8's
 * `tryAllTransports` is left at its default (false), the client never falls
 * back to polling. `tryAllTransports: true` additionally makes it try every
 * transport on each attempt rather than giving up after the first fails.
 */
export function getSocket(): AppSocket {
    if (!socket) {
        socket = io({
            transports: ['polling', 'websocket'],
            tryAllTransports: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 500,
            reconnectionDelayMax: 4000,
            timeout: 10_000,
        });
    }
    return socket;
}
