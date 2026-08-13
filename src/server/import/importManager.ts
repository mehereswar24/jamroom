/** Spotify playlist import job: fetch tracks → insert placeholders → match on YouTube with progress events. */

import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../lib/events';
import * as repos from '../db/repos';
import { fetchPlaylist, parsePlaylistId } from '../spotify/spotifyClient';
import { searchYouTube } from '../youtube/search';
import { MATCH_THRESHOLD, normalizeQuery, pickBestMatch } from '../youtube/match';

type Io = Server<ClientToServerEvents, ServerToClientEvents>;

const activeImports = new Map<string, { cancelled: boolean }>();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function cancelImport(importId: string): void {
    const job = activeImports.get(importId);
    if (job) job.cancelled = true;
}

export async function startImport(args: {
    io: Io;
    roomCode: string;
    playlistUrl: string;
    requestedBy: string;
    clientTracks?: Array<{
        name: string;
        artist: string;
        durationMs: number;
        albumArt?: string | null;
        spotifyTrackId?: string;
    }>;
    onQueueChanged: () => void;
    onSystemMessage: (text: string) => void;
    onTrackMatched?: (queueItemId: number) => void;
}): Promise<{ ok: boolean; importId?: string; error?: string }> {
    const playlistId = parsePlaylistId(args.playlistUrl);
    if (!playlistId) return { ok: false, error: 'That does not look like a Spotify playlist link' };

    let playlistName = 'Spotify Playlist';
    let tracksToImport: Array<{
        name: string;
        artist: string;
        durationMs: number;
        albumArt?: string | null;
        spotifyTrackId?: string;
    }> = [];

    if (args.clientTracks && args.clientTracks.length > 0) {
        tracksToImport = args.clientTracks;
    } else {
        try {
            const fetched = await fetchPlaylist(playlistId);
            playlistName = fetched.name;
            tracksToImport = fetched.tracks;
        } catch (err: unknown) {
            return { ok: false, error: err instanceof Error ? err.message : 'Spotify fetch failed' };
        }
    }

    if (!tracksToImport.length) return { ok: false, error: 'That playlist has no importable tracks' };

    const importId = randomUUID();
    activeImports.set(importId, { cancelled: false });
    repos.createImport(importId, args.roomCode, args.playlistUrl);
    repos.updateImport(importId, { playlistName, total: tracksToImport.length });

    // Insert all placeholders up-front so the playlist appears in the queue immediately.
    const rows = tracksToImport.map(t => ({
        track: t,
        queueItemId: repos.addSpotifyPlaceholder(args.roomCode, {
            name: t.name, artist: t.artist, durationMs: t.durationMs,
            albumArt: t.albumArt ?? null, spotifyTrackId: t.spotifyTrackId ?? ''
        }, args.requestedBy)
    }));
    args.onQueueChanged();
    args.onSystemMessage(`${args.requestedBy} added playlist “${playlistName}” (${tracksToImport.length} tracks)…`);

    // Match asynchronously in parallel — ack returns immediately, matching completes in seconds.
    void runMatching(importId, playlistName, rows, args);

    return { ok: true, importId };
}

async function runMatching(
    importId: string,
    playlistName: string,
    rows: Array<{ track: { name: string; artist: string; durationMs: number }; queueItemId: number }>,
    args: { io: Io; roomCode: string; requestedBy: string; onQueueChanged: () => void; onSystemMessage: (text: string) => void; onTrackMatched?: (queueItemId: number) => void }
): Promise<void> {
    const job = activeImports.get(importId)!;
    // Concurrency 3 is the sweet spot: 5 concurrent searches trip YouTube's
    // connection refusals on large imports ("fetch failed" batches) even with
    // the dispatcher-reset recovery in searchYouTube; serial is needlessly slow.
    const limit = pLimit(3);
    let done = 0, matched = 0, needsReview = 0, failed = 0;
    let autoStartedFirst = false;

    const emitProgress = (current: { title: string; artist: string } | null, lastResult: { queueItemId: number; status: 'matched' | 'needs_review' | 'failed'; score: number | null } | null) => {
        args.io.to(args.roomCode).emit('import:progress', {
            importId, done, total: rows.length, playlistName, current, lastResult
        });
    };

    await Promise.all(rows.map(row => limit(async () => {
        if (job.cancelled) return;
        const { track, queueItemId } = row;
        emitProgress({ title: track.name, artist: track.artist }, null);
        let status: 'matched' | 'needs_review' | 'failed' = 'failed';
        let score: number | null = null;
        try {
            await sleep(120 + Math.random() * 150);
            let candidates = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    candidates = await searchYouTube(normalizeQuery(track.artist, track.name), 5);
                    break;
                } catch (err) {
                    if (attempt === 2) throw err;
                    await sleep(500 * (attempt + 1) + Math.random() * 300);
                }
            }
            const best = candidates?.length
                ? pickBestMatch(candidates, { artist: track.artist, title: track.name, durationMs: track.durationMs })
                : null;
            if (best) {
                score = Math.round(best.score * 100) / 100;
                status = best.score >= MATCH_THRESHOLD ? 'matched' : 'needs_review';
                repos.setItemMatch(queueItemId, best.candidate.videoId, status, score);

                // Auto-start playback on the very first matched track if nothing is playing!
                if (!autoStartedFirst && args.onTrackMatched) {
                    autoStartedFirst = true;
                    args.onTrackMatched(queueItemId);
                }
            } else {
                repos.setItemMatch(queueItemId, null, 'failed', null);
            }
        } catch (err) {
            console.error('[import] match failed for', track.name, err instanceof Error ? err.message : err);
            repos.setItemMatch(queueItemId, null, 'failed', null);
        }
        done++;
        if (status === 'matched') matched++;
        else if (status === 'needs_review') needsReview++;
        else failed++;
        emitProgress(null, { queueItemId, status, score });
    })));

    const finalStatus = job.cancelled ? 'cancelled' : 'done';
    repos.updateImport(importId, { matched, needsReview, failed, status: finalStatus });
    activeImports.delete(importId);
    args.onQueueChanged();
    args.io.to(args.roomCode).emit('import:complete', { importId, playlistName, matched, needsReview, failed });
}
