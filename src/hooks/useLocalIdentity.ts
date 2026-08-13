'use client';

import { useEffect, useState } from 'react';

const NICK_KEY = 'jamroom:nickname';
const CLIENT_KEY = 'jamroom:clientId';

export function getClientId(): string {
    if (typeof window === 'undefined') return '';
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
}

export function getSavedNickname(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(NICK_KEY) ?? '';
}

export function saveNickname(nick: string): void {
    localStorage.setItem(NICK_KEY, nick.trim());
}

export function useLocalIdentity() {
    const [nickname, setNickname] = useState('');
    const [clientId, setClientId] = useState('');
    useEffect(() => {
        setNickname(getSavedNickname());
        setClientId(getClientId());
    }, []);
    return {
        nickname, clientId,
        setNickname: (n: string) => { setNickname(n); saveNickname(n); }
    };
}
