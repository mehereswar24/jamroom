'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@/lib/events';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** Singleton socket — same origin as the page, so tunnel URLs just work. */
export function getSocket(): AppSocket {
    if (!socket) {
        socket = io({ transports: ['websocket', 'polling'] });
    }
    return socket;
}
