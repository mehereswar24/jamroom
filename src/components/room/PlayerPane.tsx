'use client';

import { useEffect, useRef, useState } from 'react';
import {
    Disc3, ExternalLink, GripHorizontal, Headphones, Maximize, Maximize2, Minimize, Minimize2, Move, Pause, Pin, PinOff, Play, SkipForward, ThumbsDown, Volume2, VolumeX, Wifi, ZoomIn, ZoomOut
} from 'lucide-react';
import { getSocket } from '@/hooks/socket';
import { useRoomStore } from '@/hooks/useRoomStore';
import { useSyncedPlayer } from '@/hooks/useSyncedPlayer';
import { formatDuration } from '@/lib/ids';

const REACTIONS = [
    { emoji: '🔥', key: '1' },
    { emoji: '❤️', key: '2' },
    { emoji: '🎉', key: '3' },
    { emoji: '😂', key: '4' },
    { emoji: '😭', key: '5' },
    { emoji: '🕺', key: '6' },
    { emoji: '👀', key: '7' },
    { emoji: '💯', key: '8' }
];

export default function PlayerPane() {
    const { containerRef, audioJoined, joinAudio, struggling, volume, setVolume } = useSyncedPlayer();
    const playback = useRoomStore(s => s.playback);
    const queue = useRoomStore(s => s.queue);
    const voteSkip = useRoomStore(s => s.voteSkip);
    const selfClientId = useRoomStore(s => s.selfClientId);
    const hostClientId = useRoomStore(s => s.hostClientId);
    const guestControls = useRoomStore(s => s.guestControls);
    const reactions = useRoomStore(s => s.reactions);
    const removeReaction = useRoomStore(s => s.removeReaction);

    const canControl = selfClientId === hostClientId || guestControls;
    const current = queue.find(q => q.id === playback.queueItemId) ?? null;
    const votedSkip = voteSkip.voters.includes(selfClientId);

    /* Floating & Draggable Card State */
    const [isFloating, setIsFloating] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [cardWidth, setCardWidth] = useState(480);
    const [pos, setPos] = useState({ x: 20, y: 80 });
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const stageWrapperRef = useRef<HTMLDivElement | null>(null);

    const zoomIn = () => setCardWidth(w => Math.min(960, w + 80));
    const zoomOut = () => setCardWidth(w => Math.max(320, w - 80));

    const toggleFullscreen = () => {
        if (!stageWrapperRef.current) return;
        if (!document.fullscreenElement) {
            stageWrapperRef.current.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (!isFloating) return;
        isDraggingRef.current = true;
        dragOffsetRef.current = {
            x: e.clientX - pos.x,
            y: e.clientY - pos.y
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current) return;
        const newX = Math.max(10, Math.min(window.innerWidth - 200, e.clientX - dragOffsetRef.current.x));
        const newY = Math.max(10, Math.min(window.innerHeight - 150, e.clientY - dragOffsetRef.current.y));
        setPos({ x: newX, y: newY });
    };

    const onPointerUp = (e: React.PointerEvent) => {
        isDraggingRef.current = false;
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    };

    /* Smooth progress readout */
    const [posMs, setPosMs] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setPosMs(useRoomStore.getState().effectivePos()), 400);
        return () => clearInterval(t);
    }, []);

    /* Keyboard shortcuts for reactions (1-8 keys) */
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const idx = parseInt(e.key, 10) - 1;
            if (idx >= 0 && idx < REACTIONS.length) {
                getSocket().emit('chat:react', { emoji: REACTIONS[idx].emoji });
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const seekBarRef = useRef<HTMLDivElement | null>(null);
    const onSeekClick = (e: React.MouseEvent) => {
        if (!canControl || !current?.durationMs || !seekBarRef.current) return;
        const rect = seekBarRef.current.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        getSocket().emit('playback:seek', { positionMs: Math.round(frac * current.durationMs) }, () => {});
    };

    const emitControl = (ev: 'playback:play' | 'playback:pause' | 'playback:skip') =>
        getSocket().emit(ev, () => {});

    return (
        <div className="flex flex-col gap-3 min-h-0">
            {/* Top Bar with Stage Title & Fullscreen Control */}
            <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-white/50">
                    <Disc3 size={16} className="text-white/70 animate-spin-vinyl" />
                    <span>STAGE PLAYER</span>
                </div>
                <div className="flex items-center gap-1.5">
                    {/* Fullscreen Toggle */}
                    <button
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                        title="Toggle Fullscreen Video"
                    >
                        <Maximize size={14} />
                        <span className="hidden sm:inline">Fullscreen</span>
                    </button>
                </div>
            </div>

            {/* Main Video/Audio Player Shell */}
            <div ref={stageWrapperRef} className="relative glass rounded-3xl overflow-hidden aspect-video max-h-[54vh] bg-black/80 border border-white/10 shadow-2xl">
                <div ref={containerRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />

                {/* Floating Emoji Reactions Layer */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                    {reactions.map(r => (
                        <span
                            key={r.id}
                            onAnimationEnd={() => removeReaction(r.id)}
                            className="reaction-float absolute bottom-8 text-4xl filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
                            style={{ left: `${8 + r.x * 80}%` }}
                        >
                            {r.emoji}
                        </span>
                    ))}
                </div>

                {!playback.videoId && !playback.mediaUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40 bg-gradient-to-b from-black/40 to-black/80">
                        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                            <Headphones size={32} className="text-accent" />
                        </div>
                        <p className="text-sm font-medium text-white/70">Room queue is empty</p>
                        <p className="text-xs text-white/40">Search a song or import a playlist in the queue panel →</p>
                    </div>
                )}

                {!audioJoined && (playback.videoId || playback.mediaUrl) && (
                    <button
                        onClick={joinAudio}
                        className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-md group transition-all cursor-pointer"
                    >
                        <span className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center group-hover:scale-110 shadow-[0_0_50px_rgba(255,255,255,0.4)] transition-all">
                            <Volume2 size={34} className="text-black" />
                        </span>
                        <div className="text-center">
                            <span className="text-xl font-bold font-heading uppercase block text-white tracking-wider">Tap to Join Audio Stream</span>
                            <span className="text-xs text-white/60 mt-1 block">Drop in in zero-latency sync with room listeners</span>
                        </div>
                    </button>
                )}

                {struggling && audioJoined && (
                    <div className="absolute top-4 left-4 z-30 flex items-center gap-2 text-xs bg-amber-500/20 border border-amber-500/40 rounded-full px-3.5 py-1.5 text-amber-300 backdrop-blur-md">
                        <Wifi size={13} className="animate-pulse" /> Re-syncing playback stream…
                    </div>
                )}
            </div>

            {/* Now Playing Bar + Controls */}
            <div className="glass rounded-3xl p-3.5 sm:p-5 border-white/10">
                <div className="flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
                    {/* Album Art with Vinyl Spin Effect */}
                    <div className="relative shrink-0">
                        {current?.albumArtUrl ? (
                            <div className="relative group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={current.albumArtUrl}
                                    alt=""
                                    className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border border-white/15 shadow-md ${playback.isPlaying ? 'animate-spin-vinyl' : ''}`}
                                />
                                <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
                            </div>
                        ) : (
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                                <Disc3 size={22} className="text-white/30" />
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-[140px]">
                        <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm sm:text-base truncate text-white">{current?.title ?? 'Nothing playing'}</p>
                            {/* Audio Equalizer animation when playing */}
                            {playback.isPlaying && current && (
                                <div className="flex items-end gap-0.5 h-4 shrink-0 px-1.5 py-0.5 rounded bg-white/10 border border-white/20">
                                    <span className="w-1 bg-white rounded-full eq-bar-1" />
                                    <span className="w-1 bg-white rounded-full eq-bar-2" />
                                    <span className="w-1 bg-white rounded-full eq-bar-3" />
                                    <span className="w-1 bg-white rounded-full eq-bar-4" />
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-white/50 truncate mt-0.5">{current?.artist ?? 'Add something to the queue to get started'}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                        {/* Vote Skip Button */}
                        {current && (
                            <button
                                onClick={() => getSocket().emit('queue:voteSkip', () => {})}
                                title={votedSkip ? 'Withdraw skip vote' : 'Vote to skip'}
                                className={`flex items-center gap-1 text-xs font-medium rounded-xl sm:rounded-2xl px-2.5 sm:px-3.5 py-2 sm:py-2.5 border transition-all cursor-pointer ${
                                    votedSkip
                                        ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                                        : 'border-white/10 bg-white/5 hover:bg-white/10 text-white/60'
                                }`}
                            >
                                <ThumbsDown size={14} />
                                <span>{voteSkip.votes > 0 ? `${voteSkip.votes}/${voteSkip.needed}` : 'Skip'}</span>
                            </button>
                        )}

                        {/* Playback Controls */}
                        {canControl ? (
                            <>
                                <button
                                    onClick={() => emitControl(playback.isPlaying ? 'playback:pause' : 'playback:play')}
                                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white hover:bg-slate-200 active:scale-95 flex items-center justify-center shadow-[0_0_25px_rgba(255,255,255,0.4)] transition-all cursor-pointer text-black"
                                    title={playback.isPlaying ? 'Pause for room' : 'Play for room'}
                                >
                                    {playback.isPlaying ? <Pause size={18} className="fill-black text-black" /> : <Play size={18} className="ml-0.5 fill-black text-black" />}
                                </button>
                                <button
                                    onClick={() => emitControl('playback:skip')}
                                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center transition-all cursor-pointer text-white"
                                    title="Skip Track"
                                >
                                    <SkipForward size={16} />
                                </button>
                            </>
                        ) : (
                            <span className="text-[11px] text-white/40 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/5" title="Ask the host for controls permissions">
                                🔒 Host Only
                            </span>
                        )}
                    </div>
                </div>

                {/* Progress Bar & Seek Scrub */}
                <div className="mt-4 flex items-center gap-3">
                    <span className="text-[11px] font-mono tabular-nums text-white/40 w-10 text-right">{formatDuration(posMs)}</span>
                    <div
                        ref={seekBarRef}
                        onClick={onSeekClick}
                        className={`flex-1 h-2 rounded-full bg-white/10 relative overflow-hidden transition-all ${
                            canControl && current ? 'cursor-pointer hover:h-2.5' : ''
                        }`}
                        title={canControl ? 'Click to seek for everyone' : undefined}
                    >
                        <div
                            className="absolute inset-y-0 left-0 bg-white rounded-full transition-all shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                            style={{ width: current?.durationMs ? `${Math.min(100, (posMs / current.durationMs) * 100)}%` : '0%' }}
                        />
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-white/40 w-10">{current ? formatDuration(current.durationMs) : '0:00'}</span>

                    {/* Local Volume Control */}
                    <div className="hidden sm:flex items-center gap-2.5 ml-3 pl-3 border-l border-white/10">
                        <button onClick={() => setVolume(volume > 0 ? 0 : 80)} className="text-white/50 hover:text-white transition-colors cursor-pointer">
                            {volume === 0 || !audioJoined ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                        <input
                            type="range" min={0} max={100} value={volume}
                            onChange={e => setVolume(Number(e.target.value))}
                            className="w-20 accent-violet-500 cursor-pointer"
                        />
                    </div>
                </div>

                {/* Interactive Emoji Burst Bar */}
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-1 overflow-x-auto">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-white/30 hidden sm:inline">
                        Reactions:
                    </span>
                    <div className="flex items-center gap-1.5 flex-1 justify-around sm:justify-start">
                        {REACTIONS.map(r => (
                            <button
                                key={r.emoji}
                                onClick={() => getSocket().emit('chat:react', { emoji: r.emoji })}
                                title={`Reaction ${r.emoji} (Press ${r.key})`}
                                className="group relative text-xl hover:scale-125 active:scale-95 transition-transform px-2 py-1 rounded-xl hover:bg-white/10 cursor-pointer"
                            >
                                <span>{r.emoji}</span>
                                <span className="absolute -bottom-1 right-0.5 text-[8px] font-mono text-white/20 group-hover:text-accent font-bold">
                                    {r.key}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
