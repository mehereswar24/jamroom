'use client';

/**
 * Dual synced player + the follower loop.
 *
 * Two backends behind one sync algorithm:
 *   - YouTube IFrame player for youtube-sourced tracks
 *   - a hidden-until-active HTML5 <video> element for direct-URL tracks
 *     (mp3/mp4/webm… from any host) — it plays audio files fine too
 *
 * Both start MUTED so autoplay is allowed; a full-pane overlay asks for one
 * tap ("join audio") which unmutes — and doubles as the user gesture that
 * lets all future track changes autoplay.
 *
 * Every second: drift = playerPos - effectivePos(serverNow). Outside the
 * dead-zone → hard seek (with lead). Suppressed while buffering / right
 * after our own seek so corrections don't ping-pong.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from './socket';
import { useRoomStore } from './useRoomStore';

/* Minimal typings for the IFrame API surface we use */
interface YTPlayer {
    loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    setVolume(v: number): void;
    getVolume(): number;
    getCurrentTime(): number;
    getPlayerState(): number;
    destroy(): void;
}
declare global {
    interface Window {
        YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
        onYouTubeIframeAPIReady?: () => void;
    }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

const DRIFT_HARD_MS = 1200;
const DRIFT_PAUSED_MS = 500;
const SEEK_LEAD_MS = 250;
const SEEK_SUPPRESS_MS = 2000;
const STRUGGLE_WINDOW_MS = 10_000;
const STRUGGLE_SEEKS = 3;
const STRUGGLE_DRIFT_MS = 3000;

let apiPromise: Promise<void> | null = null;
function loadIframeApi(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.YT?.Player) return Promise.resolve();
    if (!apiPromise) {
        apiPromise = new Promise<void>((resolve) => {
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(tag);
        });
    }
    return apiPromise;
}

export function useSyncedPlayer() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const ytWrapRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const mediaRef = useRef<HTMLVideoElement | null>(null);
    const [playerReady, setPlayerReady] = useState(false);
    const [audioJoined, setAudioJoined] = useState(false);
    const [struggling, setStruggling] = useState(false);
    const [volume, setVolumeState] = useState(80);

    const loadedVideoRef = useRef<string | null>(null);
    const loadedMediaRef = useRef<string | null>(null);
    const lastSeekAtRef = useRef(0);
    const recentSeeksRef = useRef<number[]>([]);
    const audioJoinedRef = useRef(false);
    const volumeRef = useRef(80);
    const reportedEndForRef = useRef<number | null>(null);

    /** Which backend the room's current track uses. */
    const activeKind = (): 'yt' | 'html5' | null => {
        const p = useRoomStore.getState().playback;
        return p.videoId ? 'yt' : p.mediaUrl ? 'html5' : null;
    };

    const showBackend = useCallback((kind: 'yt' | 'html5' | null) => {
        if (ytWrapRef.current) ytWrapRef.current.style.display = kind === 'yt' ? 'block' : 'none';
        if (mediaRef.current) mediaRef.current.style.display = kind === 'html5' ? 'block' : 'none';
    }, []);

    /* Create both players once */
    useEffect(() => {
        let disposed = false;
        const container = containerRef.current;
        if (!container) return;

        /* HTML5 element (works for audio and video files) */
        const media = document.createElement('video');
        media.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;background:#000';
        media.playsInline = true;
        media.preload = 'auto';
        media.muted = true;
        // Deliberately NO crossOrigin attribute: we never read pixel/sample
        // data, and CORS mode would make hosts without ACAO headers (most
        // random third-party sites) refuse to load at all.
        media.addEventListener('ended', () => {
            const st = useRoomStore.getState();
            if (st.playback.queueItemId && st.playback.mediaUrl
                && reportedEndForRef.current !== st.playback.queueItemId) {
                reportedEndForRef.current = st.playback.queueItemId;
                getSocket().emit('playback:ended', {
                    queueItemId: st.playback.queueItemId,
                    positionMs: media.currentTime * 1000
                });
            }
        });
        media.addEventListener('error', () => {
            const st = useRoomStore.getState();
            if (st.playback.queueItemId && st.playback.mediaUrl) {
                getSocket().emit('playback:error', { queueItemId: st.playback.queueItemId, code: 2 });
            }
        });
        media.addEventListener('loadedmetadata', () => {
            const st = useRoomStore.getState();
            if (st.playback.queueItemId && st.playback.mediaUrl && Number.isFinite(media.duration)) {
                getSocket().emit('playback:duration', {
                    queueItemId: st.playback.queueItemId,
                    durationMs: media.duration * 1000
                });
            }
        });
        container.appendChild(media);
        mediaRef.current = media;

        /* YouTube IFrame player inside its own wrapper */
        const ytWrap = document.createElement('div');
        ytWrap.style.cssText = 'position:absolute;inset:0;display:none';
        container.appendChild(ytWrap);
        ytWrapRef.current = ytWrap;

        void loadIframeApi().then(() => {
            if (disposed || playerRef.current || !window.YT) return;
            const el = document.createElement('div');
            ytWrap.appendChild(el);
            playerRef.current = new window.YT.Player(el, {
                width: '100%', height: '100%',
                playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3 },
                events: {
                    onReady: () => {
                        playerRef.current?.mute();     // muted → autoplay allowed pre-gesture
                        playerRef.current?.setVolume(volumeRef.current);
                        setPlayerReady(true);
                    },
                    onStateChange: (e: { data: number }) => {
                        const st = useRoomStore.getState();
                        if (e.data === STATE.ENDED && st.playback.queueItemId && st.playback.videoId
                            && reportedEndForRef.current !== st.playback.queueItemId) {
                            reportedEndForRef.current = st.playback.queueItemId;
                            getSocket().emit('playback:ended', {
                                queueItemId: st.playback.queueItemId,
                                positionMs: (playerRef.current?.getCurrentTime() ?? 0) * 1000
                            });
                        }
                    },
                    onError: (e: { data: number }) => {
                        const st = useRoomStore.getState();
                        if (st.playback.queueItemId && st.playback.videoId) {
                            getSocket().emit('playback:error', { queueItemId: st.playback.queueItemId, code: e.data });
                        }
                    }
                }
            });
        });

        return () => {
            disposed = true;
            playerRef.current?.destroy();
            playerRef.current = null;
            media.remove();
            ytWrap.remove();
            mediaRef.current = null;
            ytWrapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const noteSeek = useCallback(() => {
        const now = Date.now();
        lastSeekAtRef.current = now;
        recentSeeksRef.current = [...recentSeeksRef.current.filter(t => now - t < STRUGGLE_WINDOW_MS), now];
        setStruggling(recentSeeksRef.current.length >= STRUGGLE_SEEKS);
    }, []);

    /* ── track loading per backend ── */

    const loadCurrent = useCallback((startMs: number, autoplay: boolean) => {
        const st = useRoomStore.getState();
        const { videoId, mediaUrl } = st.playback;
        reportedEndForRef.current = null;
        recentSeeksRef.current = [];
        if (videoId && playerRef.current) {
            loadedVideoRef.current = videoId;
            loadedMediaRef.current = null;
            mediaRef.current?.pause();
            showBackend('yt');
            playerRef.current.loadVideoById({ videoId, startSeconds: startMs / 1000 });
            if (!autoplay) setTimeout(() => playerRef.current?.pauseVideo(), 400);
            lastSeekAtRef.current = Date.now();
        } else if (mediaUrl && mediaRef.current) {
            loadedMediaRef.current = mediaUrl;
            loadedVideoRef.current = null;
            playerRef.current?.pauseVideo();
            showBackend('html5');
            const el = mediaRef.current;
            el.src = mediaUrl;
            el.currentTime = startMs / 1000;
            el.muted = !audioJoinedRef.current;
            el.volume = volumeRef.current / 100;
            if (autoplay) void el.play().catch(() => { /* gesture fallback handles it */ });
            lastSeekAtRef.current = Date.now();
        }
    }, [showBackend]);

    /* ── follower loop ── */
    useEffect(() => {
        const tick = () => {
            const st = useRoomStore.getState();
            const { playback } = st;
            const kind = activeKind();

            if (!kind) {
                loadedVideoRef.current = null;
                loadedMediaRef.current = null;
                if (playerRef.current?.getPlayerState?.() === STATE.PLAYING) playerRef.current.pauseVideo();
                mediaRef.current?.pause();
                showBackend(null);
                return;
            }

            /* Wrong/missing track loaded → load it */
            const needsLoad = kind === 'yt'
                ? loadedVideoRef.current !== playback.videoId
                : loadedMediaRef.current !== playback.mediaUrl;
            if (needsLoad) {
                if (kind === 'yt' && !playerRef.current) return;   // YT api still booting
                loadCurrent(st.effectivePos(), playback.isPlaying);
                return;
            }

            if (Date.now() - lastSeekAtRef.current < SEEK_SUPPRESS_MS) return;

            const target = st.effectivePos();
            let actual: number;
            let isBuffering: boolean;
            let isPlayingNow: boolean;

            if (kind === 'yt') {
                const player = playerRef.current;
                if (!player) return;
                const s = player.getPlayerState();
                if (s === STATE.BUFFERING || s === STATE.UNSTARTED) return;
                actual = player.getCurrentTime() * 1000;
                isBuffering = false;
                isPlayingNow = s === STATE.PLAYING;
            } else {
                const el = mediaRef.current;
                if (!el) return;
                if (el.seeking || el.readyState < 2) return;
                actual = el.currentTime * 1000;
                isBuffering = false;
                isPlayingNow = !el.paused && !el.ended;
            }
            void isBuffering;

            const drift = actual - target;

            if (!playback.isPlaying) {
                if (isPlayingNow) (kind === 'yt' ? playerRef.current?.pauseVideo() : mediaRef.current?.pause());
                if (Math.abs(drift) > DRIFT_PAUSED_MS) {
                    if (kind === 'yt') playerRef.current?.seekTo(target / 1000, true);
                    else if (mediaRef.current) mediaRef.current.currentTime = target / 1000;
                    lastSeekAtRef.current = Date.now();
                }
                return;
            }

            if (!isPlayingNow) {
                if (kind === 'yt') playerRef.current?.playVideo();
                else void mediaRef.current?.play().catch(() => { /* needs gesture */ });
                return;
            }

            const threshold = recentSeeksRef.current.length >= STRUGGLE_SEEKS ? STRUGGLE_DRIFT_MS : DRIFT_HARD_MS;
            if (Math.abs(drift) > threshold) {
                if (kind === 'yt') playerRef.current?.seekTo((target + SEEK_LEAD_MS) / 1000, true);
                else if (mediaRef.current) mediaRef.current.currentTime = (target + SEEK_LEAD_MS) / 1000;
                noteSeek();
            } else if (recentSeeksRef.current.every(t => Date.now() - t > STRUGGLE_WINDOW_MS)) {
                if (recentSeeksRef.current.length) recentSeeksRef.current = [];
                setStruggling(false);
            }
        };
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [loadCurrent, noteSeek, showBackend]);

    /* React immediately to playback changes (don't wait for the next tick) */
    const playback = useRoomStore(s => s.playback);
    useEffect(() => {
        const kind = playback.videoId ? 'yt' : playback.mediaUrl ? 'html5' : null;
        if (!kind) { showBackend(null); return; }
        const st = useRoomStore.getState();

        const needsLoad = kind === 'yt'
            ? loadedVideoRef.current !== playback.videoId
            : loadedMediaRef.current !== playback.mediaUrl;
        if (needsLoad) {
            if (kind === 'yt' && !playerReady) return;   // will load on ready via loop
            loadCurrent(st.effectivePos(), playback.isPlaying);
            return;
        }

        const target = st.effectivePos();
        if (kind === 'yt') {
            const player = playerRef.current;
            if (!player) return;
            player.seekTo(target / 1000, true);
            lastSeekAtRef.current = Date.now();
            if (playback.isPlaying) player.playVideo(); else player.pauseVideo();
        } else {
            const el = mediaRef.current;
            if (!el) return;
            el.currentTime = target / 1000;
            lastSeekAtRef.current = Date.now();
            if (playback.isPlaying) void el.play().catch(() => { /* needs gesture */ });
            else el.pause();
        }
    }, [playback, playerReady, loadCurrent, showBackend]);

    const joinAudio = useCallback(() => {
        audioJoinedRef.current = true;
        setAudioJoined(true);
        playerRef.current?.unMute();
        playerRef.current?.setVolume(volumeRef.current);
        if (mediaRef.current) {
            mediaRef.current.muted = false;
            mediaRef.current.volume = volumeRef.current / 100;
        }
        // Fallback: if even muted autoplay was blocked, this click is the gesture.
        const st = useRoomStore.getState();
        if (!st.playback.isPlaying) return;
        if (st.playback.videoId) {
            const player = playerRef.current;
            if (!player) return;
            if (loadedVideoRef.current !== st.playback.videoId || player.getPlayerState() === STATE.UNSTARTED) {
                loadCurrent(st.effectivePos(), true);
            }
            player.playVideo();
        } else if (st.playback.mediaUrl && mediaRef.current) {
            if (loadedMediaRef.current !== st.playback.mediaUrl) loadCurrent(st.effectivePos(), true);
            void mediaRef.current.play().catch(() => { /* ignore */ });
        }
    }, [loadCurrent]);

    const setVolume = useCallback((v: number) => {
        setVolumeState(v);
        volumeRef.current = v;
        playerRef.current?.setVolume(v);
        if (v > 0 && audioJoinedRef.current) playerRef.current?.unMute();
        if (mediaRef.current) {
            mediaRef.current.volume = v / 100;
            if (v > 0 && audioJoinedRef.current) mediaRef.current.muted = false;
        }
    }, []);

    return { containerRef, playerReady, audioJoined, joinAudio, struggling, volume, setVolume };
}
