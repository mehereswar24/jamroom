'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Tv,
  Play,
  Pause,
  Link as LinkIcon,
  Volume2,
  VolumeX,
  AlertCircle
} from 'lucide-react';
import { api } from '@/hooks/api';
import { useRoomStore } from '@/hooks/useRoomStore';

interface WatchPartyTheaterProps {
  canControl: boolean;
  selfNickname: string;
}

// Public demo clips. The previous gtv-videos-bucket sample URLs went private and
// now 403 for anonymous callers, which silently killed every preset here.
const DEMO_CLIPS = [
  { name: '🎬 Sintel (trailer)', url: 'https://media.w3.org/2010/05/sintel/trailer.mp4' },
  { name: '🍿 Sintel (720p)', url: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4' },
  { name: '🐰 Big Buck Bunny', url: 'https://media.w3.org/2010/05/bunny/movie.mp4' },
  { name: '▶️ YouTube sample', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }
] as const;

const FALLBACK_CLIP = DEMO_CLIPS[0].url;

function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export default function WatchPartyTheater({ canControl }: WatchPartyTheaterProps) {
  const playback = useRoomStore(s => s.playback);

  const [videoUrl, setVideoUrl] = useState<string>(FALLBACK_CLIP);
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>('Demo clip — Sintel (trailer)');
  const [inputUrl, setInputUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(playback.isPlaying || false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [needUserGesture, setNeedUserGesture] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Apply room playback state from Ably to the <video> element. This drives the
  // external system only — `isPlaying` is kept in step by the element's own
  // play/pause events below, so we never setState synchronously in the effect.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || youtubeId) return;

    if (Math.abs(el.currentTime - playback.basePositionMs / 1000) > 1.5) {
      el.currentTime = playback.basePositionMs / 1000;
    }
    if (playback.isPlaying && el.paused) {
      void el.play().catch(() => setNeedUserGesture(true));
    } else if (!playback.isPlaying && !el.paused) {
      el.pause();
    }
  }, [playback, youtubeId]);

  // Safely update & play video element whenever videoUrl changes
  useEffect(() => {
    if (!youtubeId && videoRef.current) {
      videoRef.current.src = videoUrl;
      videoRef.current.load();
      const p = videoRef.current.play();
      if (p !== undefined) {
        p.then(() => {
          setNeedUserGesture(false);
        }).catch(() => {
          // Autoplay policy restriction — show tap overlay
          setNeedUserGesture(true);
        });
      }
    }
  }, [videoUrl, youtubeId]);

  const playStreamInWebsite = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;

    setIsLoadingStream(true);
    setNeedUserGesture(false);
    setLoadError(null);

    const ytId = extractYoutubeId(trimmed);
    if (ytId) {
      setYoutubeId(ytId);
      setActiveTitle(`YouTube (${ytId})`);
      setIsLoadingStream(false);
      setIsPlaying(true);
      void api.playback('play');
      return;
    }

    setYoutubeId(null);

    try {
      const res = await fetch(`/api/stream/proxy?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();

      if (!res.ok) {
        // Don't silently swap in a demo clip — say why this link can't play.
        setLoadError(data.message || 'That link could not be resolved into a playable stream.');
        setIsLoadingStream(false);
        setIsPlaying(false);
        return;
      }

      setActiveTitle(data.title || 'Direct video stream');
      setVideoUrl(data.streamUrl || trimmed);
    } catch {
      setLoadError('Could not reach the stream resolver.');
      setIsLoadingStream(false);
      setIsPlaying(false);
      return;
    }

    setIsLoadingStream(false);
    setIsPlaying(true);
    void api.playback('play');
  };

  const handleLoadCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    playStreamInWebsite(inputUrl.trim());
    setInputUrl('');
  };

  const handlePlayToggle = () => {
    setNeedUserGesture(false);
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (videoRef.current && !youtubeId) {
      if (nextState) void videoRef.current.play().catch(() => {});
      else videoRef.current.pause();
    }
    void api.playback(nextState ? 'play' : 'pause');
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekSecs = Number(e.target.value);
    setCurrentTime(seekSecs);
    if (videoRef.current && !youtubeId) {
      videoRef.current.currentTime = seekSecs;
    }
    void api.playback('seek', { positionMs: Math.round(seekSecs * 1000) });
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-black/95 rounded-3xl border border-white/10 overflow-hidden relative shadow-2xl">
      {/* Top Header */}
      <div className="bg-[#0c0e14] px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 shadow-md">
            <Tv size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-xs sm:text-sm text-white tracking-wide">
                SYNCHRONIZED THEATER
              </h3>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {youtubeId ? 'YouTube' : 'Direct video'}
              </span>
            </div>
            <p className="text-[11px] text-white/50 truncate max-w-[280px]">
              {activeTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Main Video Stage Container (video element is ALWAYS mounted to prevent null refs) */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[300px] group">
        {youtubeId ? (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&enablejsapi=1`}
            title={activeTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            autoPlay={isPlaying}
            playsInline
            controls={false}
            onError={() => {
              // Retrying the same src here used to loop forever once the old
              // sample bucket started 403ing. Try the known-good clip once,
              // then surface the failure instead of hiding it.
              if (videoUrl !== FALLBACK_CLIP) {
                setVideoUrl(FALLBACK_CLIP);
                setActiveTitle('Source failed to load — playing demo clip instead');
              } else {
                setIsPlaying(false);
                setLoadError('This video could not be played. Direct video files work; DRM-protected services do not.');
              }
            }}
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentTime(videoRef.current.currentTime);
                setDuration(videoRef.current.duration || 0);
              }
            }}
            onPlay={() => {
              setIsPlaying(true);
              setNeedUserGesture(false);
            }}
            onPause={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />
        )}

        {/* Playback failure notice */}
        {loadError && !youtubeId && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/90 backdrop-blur-sm px-8 text-center">
            <AlertCircle size={28} className="text-amber-400" />
            <p className="text-xs text-white/80 max-w-sm leading-relaxed">{loadError}</p>
            <button
              onClick={() => {
                setLoadError(null);
                setVideoUrl(FALLBACK_CLIP);
                setActiveTitle('Demo clip — Sintel (trailer)');
              }}
              className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 text-[11px] font-semibold cursor-pointer transition-all"
            >
              Back to demo clip
            </button>
          </div>
        )}

        {/* Play Overlay if browser blocked unmuted autoplay */}
        {needUserGesture && !youtubeId && !loadError && (
          <button
            onClick={handlePlayToggle}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/75 backdrop-blur-sm cursor-pointer group"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.5)] group-hover:scale-110 transition-transform">
              <Play size={28} className="fill-slate-950 ml-1" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-white bg-black/60 px-3.5 py-1.5 rounded-full border border-white/20">
              Tap to Play Video & Audio
            </span>
          </button>
        )}

        {/* Live Synchronized Room Badge Overlay */}
        <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-3 py-1 rounded-xl border border-white/10 flex items-center gap-2 text-[11px] pointer-events-none z-10">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-white">ROOM PLAYBACK SYNCED</span>
        </div>
      </div>

      {/* Input Bar for Loading Any Video Stream */}
      <div className="bg-[#0c0e14] px-4 py-2 border-t border-white/10 flex items-center gap-2">
        <form onSubmit={handleLoadCustomUrl} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <LinkIcon size={14} className="absolute left-3 text-white/40" />
            <input
              type="text"
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="Paste a YouTube link or a direct video file URL (.mp4 / .webm)..."
              className="w-full pl-9 pr-3 py-1.5 bg-black/60 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500 font-medium"
            />
          </div>
          <button
            type="submit"
            disabled={isLoadingStream}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow transition-all cursor-pointer active:scale-95 whitespace-nowrap disabled:opacity-50"
          >
            {isLoadingStream ? 'Loading...' : 'Play in Room'}
          </button>
        </form>
      </div>

      {/* Demo clip shortcuts */}
      <div className="bg-[#0a0c10] px-4 py-1.5 border-t border-white/10 flex items-center gap-2 overflow-x-auto no-scrollbar text-[11px]">
        <span className="text-white/40 font-semibold uppercase text-[10px] tracking-wider shrink-0">Demo clips:</span>
        {DEMO_CLIPS.map(preset => (
          <button
            key={preset.name}
            onClick={() => playStreamInWebsite(preset.url)}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white shrink-0 cursor-pointer transition-all font-medium"
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Streaming-service note */}
      <div className="bg-[#0a0c10] px-4 py-1.5 border-t border-white/10 flex items-start gap-1.5 text-[10px] text-white/40 leading-relaxed">
        <AlertCircle size={12} className="text-white/30 shrink-0 mt-0.5" />
        <span>
          Netflix, JioHotstar and Prime Video are DRM-protected and block embedding, so no website can play
          them in-page. Start those in your own tab.
        </span>
      </div>

      {/* Synchronized Playback Control Bar */}
      <div className="bg-[#08090d] px-4 py-2.5 border-t border-white/10 flex items-center justify-between gap-4">
        {/* Play/Pause Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayToggle}
            disabled={!canControl}
            className="w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center font-bold shadow-md cursor-pointer transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canControl ? (isPlaying ? 'Pause for the room' : 'Play for the room') : 'Only the host can control playback'}
          >
            {isPlaying ? <Pause size={18} className="fill-slate-950" /> : <Play size={18} className="fill-slate-950 ml-0.5" />}
          </button>
        </div>

        {/* Synchronized Scrubber Bar */}
        <div className="flex-1 flex items-center gap-2 text-[11px] font-mono text-white/60">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            disabled={!canControl}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
          />
          <span>{formatTime(duration)}</span>
        </div>

        {/* Volume Control (local only — not synced) */}
        <div className="flex items-center gap-2 text-white/60">
          <button
            onClick={() => {
              const nextMuted = !isMuted;
              setIsMuted(nextMuted);
              if (videoRef.current) videoRef.current.muted = nextMuted;
            }}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {isMuted || volume === 0 ? <VolumeX size={16} className="text-red-400" /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={e => {
              const v = Number(e.target.value);
              setVolume(v);
              setIsMuted(false);
              if (videoRef.current) {
                videoRef.current.volume = v;
                videoRef.current.muted = false;
              }
            }}
            className="w-16 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>
      </div>
    </div>
  );
}
