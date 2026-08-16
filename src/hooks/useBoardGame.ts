'use client';

/** Client state for turn-based board games: subscribes to board:state, exposes actions. */

import { useCallback, useEffect, useState } from 'react';
import type * as Ably from 'ably';
import { EV } from '@/lib/channels';
import { getRoomChannel } from './realtime';
import { api } from './api';
import type { BoardGameId, BoardState } from '@/lib/games/types';

export interface BoardHook {
    board: BoardState | null;
    mySeat: number | null;
    isMyTurn: boolean;
    create: (gameId: BoardGameId) => void;
    join: () => void;
    start: () => void;
    move: (move: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
    restart: () => void;
    exit: () => void;
}

export function useBoardGame(roomCode: string, clientId: string): BoardHook {
    const [board, setBoard] = useState<BoardState | null>(null);

    useEffect(() => {
        if (!roomCode || !clientId) return;
        const channel = getRoomChannel(roomCode);
        let disposed = false;
        const onState = (msg: Ably.Message) => setBoard((msg.data as BoardState | null) ?? null);
        channel.subscribe(EV.boardState, onState);
        // initial load
        fetch(`/api/rooms/${roomCode}/board`).then(r => r.json()).then(j => { if (!disposed && j.ok) setBoard(j.board); }).catch(() => {});
        return () => { disposed = true; channel.unsubscribe(EV.boardState, onState); };
    }, [roomCode, clientId]);

    const mySeat = board?.players.find(p => p.clientId === clientId)?.seat ?? null;
    const isMyTurn = !!board && board.status === 'playing' && (board.turnSeat === mySeat || board.turnSeat === -1);

    const create = useCallback((gameId: BoardGameId) => { void api.board('create', { gameId }); }, []);
    const join = useCallback(() => { void api.board('join'); }, []);
    const start = useCallback(() => { void api.board('start'); }, []);
    const restart = useCallback(() => { void api.board('restart'); }, []);
    const exit = useCallback(() => { void api.board('exit'); }, []);
    const move = useCallback(async (m: Record<string, unknown>) => {
        const r = await api.board('move', { move: m });
        return { ok: r.ok, error: r.ok ? undefined : r.error };
    }, []);

    return { board, mySeat, isMyTurn, create, join, start, move, restart, exit };
}
