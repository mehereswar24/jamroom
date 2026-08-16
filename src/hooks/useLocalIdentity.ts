'use client';

/**
 * Local identity = the nickname only.
 *
 * clientId used to be a localStorage UUID that the client sent with every
 * request, and every server-side permission check compared against it. Since
 * the host's id is broadcast to the whole room, any guest could replay it and
 * take over. Identity is now minted and signed by the server (see
 * server/auth/identity.ts) and reaches the client only via the Ably token.
 */

import { useEffect, useState } from 'react';
import { currentClientId, waitForIdentity } from './realtime';

const NICK_KEY = 'jamroom:nickname';

export function getSavedNickname(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(NICK_KEY) ?? '';
}

export function saveNickname(nick: string): void {
    localStorage.setItem(NICK_KEY, nick.trim());
}

export function useLocalIdentity() {
    const [nickname, setNickname] = useState('');
    useEffect(() => {
        setNickname(getSavedNickname());
    }, []);
    return {
        nickname,
        setNickname: (n: string) => { setNickname(n); saveNickname(n); }
    };
}

/**
 * The server-assigned clientId for the room we're connected to.
 * Empty until the Ably connection has authenticated.
 */
export function useRoomIdentity(roomCode: string) {
    const [clientId, setClientId] = useState(currentClientId());

    useEffect(() => {
        if (!roomCode) return;
        let cancelled = false;
        void waitForIdentity(roomCode).then(id => {
            if (!cancelled) setClientId(id);
        });
        return () => { cancelled = true; };
    }, [roomCode]);

    return clientId;
}
