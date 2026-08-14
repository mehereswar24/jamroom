'use client';

/**
 * Thin fetch helpers for room actions. Each POST hits a serverless route that
 * mutates Upstash Redis and publishes the resulting event to the room's Ably
 * channel — so the caller doesn't need the result to update the UI (the Ably
 * event does that for everyone, including the caller).
 */

import { getClientId, getSavedNickname } from './useLocalIdentity';
import { getRoomChannel } from './realtime';

interface Ack<T = object> { ok: boolean; error?: string; }
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T = object>(path: string, body: Record<string, unknown>): Promise<Result<T>> {
    try {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: getClientId(), nickname: getSavedNickname(), ...body }),
        });
        const j = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
        return j as Result<T>;
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
}

let roomCode = '';
export function setApiRoom(code: string) { roomCode = code; }

/** Publish an ephemeral event (typing, reaction, WebRTC signal) straight to the
 *  room's Ably channel — no server round-trip, no persistence. */
export function publishEphemeral(event: string, data: Record<string, unknown>): void {
    const cid = getClientId();
    if (!roomCode || !cid) return;
    try { void getRoomChannel(cid, roomCode).publish(event, data); } catch { /* ignore */ }
}

export const api = {
    playback: (action: string, extra: Record<string, unknown> = {}) =>
        post('/api/playback', { code: roomCode, action, ...extra }),
    queue: <T = object>(action: string, extra: Record<string, unknown> = {}) =>
        post<T>('/api/queue', { code: roomCode, action, ...extra }),
    room: (action: string, extra: Record<string, unknown> = {}) =>
        post('/api/room', { code: roomCode, action, ...extra }),
    chat: (body: string) => post('/api/chat', { code: roomCode, body }),
    game: <T = object>(action: string, extra: Record<string, unknown> = {}) =>
        post<T>('/api/game', { code: roomCode, action, ...extra }),
    board: <T = object>(action: string, extra: Record<string, unknown> = {}) =>
        post<T>('/api/board', { code: roomCode, action, ...extra }),
    importStart: <T = object>(body: Record<string, unknown>) =>
        post<T>('/api/import/start', { code: roomCode, ...body }),
    importBatch: <T = object>(extra: Record<string, unknown>) =>
        post<T>('/api/import/batch', { code: roomCode, ...extra }),
};

interface ImportStartResult { ids: number[]; total: number; playlistName: string; importId: string; }

/**
 * Drive a chunked import: fetch/insert tracks, then match them in small batches
 * (each a serverless call under the time limit). Progress is published by the
 * server to Ably, so the whole room sees it. Fire-and-forget after start.
 */
export async function driveImport(startBody: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await api.importStart<ImportStartResult>(startBody);
    if (!res.ok) return res;
    const { ids, total, playlistName, importId } = res;
    void (async () => {
        const CHUNK = 12;   // matched concurrently server-side; kept serial here (queue write is per-chunk)
        for (let i = 0; i < ids.length; i += CHUNK) {
            await api.importBatch({ ids: ids.slice(i, i + CHUNK), total, doneBefore: i, playlistName, importId });
        }
    })();
    return { ok: true };
}

export type { Ack };
