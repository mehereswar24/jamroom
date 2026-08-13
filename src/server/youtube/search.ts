/**
 * YouTube search adapter — keyless scraping via youtube-sr (no Data API quota).
 * Playback itself always happens in the official IFrame embed. This file is the
 * single swap point if the scraping lib ever breaks.
 *
 * Resilience: long-lived Node processes accumulate poisoned keep-alive sockets
 * to YouTube (undici reuses a connection YouTube closed → every fetch throws
 * "fetch failed" while a fresh process works). On that error we swap in a fresh
 * global dispatcher (new connection pool) and retry.
 */

import YouTube from 'youtube-sr';
import { Agent, setGlobalDispatcher } from 'undici';
import type { VideoCandidate } from '../../lib/types';

function freshDispatcher(): void {
    setGlobalDispatcher(new Agent({
        keepAliveTimeout: 5_000,
        keepAliveMaxTimeout: 10_000,
        connections: 4
    }));
}
freshDispatcher();

function isConnectionError(err: unknown): boolean {
    return err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
        `${err.message} ${err.cause instanceof Error ? err.cause.message : ''}`
    );
}

async function rawSearch(query: string, limit: number): Promise<VideoCandidate[]> {
    const results = await YouTube.search(query, { limit, type: 'video', safeSearch: false });
    return results
        .filter(v => v?.id)
        .map(v => ({
            videoId: v.id!,
            title: v.title ?? '',
            channel: v.channel?.name ?? '',
            durationMs: (v.duration ?? 0),           // youtube-sr reports ms
            thumb: v.thumbnail?.url ?? null
        }));
}

export async function searchYouTube(query: string, limit = 6): Promise<VideoCandidate[]> {
    try {
        return await rawSearch(query, limit);
    } catch (err) {
        if (!isConnectionError(err)) throw err;
        // Poisoned pool: rebuild the dispatcher and retry on fresh sockets.
        freshDispatcher();
        return rawSearch(query, limit);
    }
}
