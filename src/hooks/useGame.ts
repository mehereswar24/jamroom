'use client';

/**
 * useGame — Pictionary client state.
 *
 * Subscribes to `game:state` + `game:feed` on the main room channel (server-
 * published, authoritative), and exposes actions that call /api/game. The
 * drawer's secret word/choices are pulled separately from the drawer-only GET
 * so they never travel over the broadcast channel.
 *
 * Stroke sync (the drawing itself) is handled in DrawCanvas over the dedicated
 * game channel — this hook only owns game STATE.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Ably from 'ably';
import { EV } from '@/lib/channels';
import { getRoomChannel } from './realtime';
import { api } from './api';
import type { GameFeedMsg, PublicGameState } from '@/lib/game';

export interface GameHook {
    state: PublicGameState | null;
    feed: GameFeedMsg[];
    word: string | null;          // drawer-only
    wordChoices: string[] | null; // drawer-only
    isDrawer: boolean;
    msLeft: number;
    start: (opts?: { totalRounds?: number; drawTimeSec?: number }) => void;
    pickWord: (w: string) => void;
    guess: (text: string) => Promise<{ correct: boolean; close?: boolean }>;
    endGame: () => void;
    refreshDrawerSecret: () => void;
}

export function useGame(roomCode: string, clientId: string): GameHook {
    const [state, setState] = useState<PublicGameState | null>(null);
    const [feed, setFeed] = useState<GameFeedMsg[]>([]);
    const [word, setWord] = useState<string | null>(null);
    const [wordChoices, setWordChoices] = useState<string[] | null>(null);
    const [msLeft, setMsLeft] = useState(0);
    const offsetRef = useRef(0);   // reuse room clock offset if available later; 0 is fine

    const isDrawer = !!state && state.drawerClientId === clientId;

    const refreshDrawerSecret = useCallback(async () => {
        try {
            const j = await fetch(`/api/rooms/${roomCode}/game?clientId=${encodeURIComponent(clientId)}`).then(r => r.json());
            if (j.ok) {
                setWord(j.word ?? null);
                setWordChoices(j.wordChoices ?? null);
                if (j.game) setState(j.game);
            }
        } catch { /* ignore */ }
    }, [roomCode, clientId]);

    /* subscribe to game state + feed on the main channel */
    useEffect(() => {
        if (!roomCode || !clientId) return;
        const channel = getRoomChannel(clientId, roomCode);
        let disposed = false;

        const onState = (msg: Ably.Message) => {
            const s = msg.data as PublicGameState;
            setState(s);
            // If I'm the drawer, pull my secret word/choices for the new phase.
            if (s.drawerClientId === clientId && (s.status === 'choosing' || s.status === 'drawing')) {
                void refreshDrawerSecret();
            } else {
                setWord(null); setWordChoices(null);
            }
        };
        const onFeed = (msg: Ably.Message) => {
            const m = msg.data as GameFeedMsg;
            setFeed(f => [...f.slice(-80), m]);
        };
        channel.subscribe(EV.gameState, onState);
        channel.subscribe(EV.gameFeed, onFeed);

        // initial pull
        void refreshDrawerSecret();

        return () => {
            disposed = true;
            channel.unsubscribe(EV.gameState, onState);
            channel.unsubscribe(EV.gameFeed, onFeed);
            void disposed;
        };
    }, [roomCode, clientId, refreshDrawerSecret]);

    /* countdown + client-driven round advance when the timer runs out */
    useEffect(() => {
        if (!state) { setMsLeft(0); return; }
        const tick = () => {
            if (state.status === 'drawing' && state.roundEndsAt) {
                const left = state.roundEndsAt - (Date.now() + offsetRef.current);
                setMsLeft(Math.max(0, left));
                if (left <= 0) {
                    // any client nudges the server; it's idempotent on roundToken
                    void api.game('advance', { roundToken: state.roundToken });
                }
            } else {
                setMsLeft(0);
            }
        };
        tick();
        const t = setInterval(tick, 250);
        return () => clearInterval(t);
    }, [state]);

    /* auto-advance from the reveal screen to the next round after a beat */
    useEffect(() => {
        if (state?.status !== 'roundEnd') return;
        const t = setTimeout(() => { void api.game('next', { roundToken: state.roundToken }); }, 4500);
        return () => clearTimeout(t);
    }, [state?.status, state?.roundToken]);

    const start = useCallback((opts?: { totalRounds?: number; drawTimeSec?: number }) => {
        void api.game('start', { totalRounds: opts?.totalRounds, drawTimeSec: opts?.drawTimeSec });
    }, []);
    const pickWord = useCallback((w: string) => { void api.game('pickWord', { word: w }); }, []);
    const guess = useCallback(async (text: string) => {
        const r = await api.game<{ correct?: boolean; close?: boolean }>('guess', { text });
        return { correct: !!(r.ok && r.correct), close: r.ok ? r.close : false };
    }, []);
    const endGame = useCallback(() => { void api.game('end'); }, []);

    return { state, feed, word, wordChoices, isDrawer, msLeft, start, pickWord, guess, endGame, refreshDrawerSecret };
}
