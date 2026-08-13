'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Dices, Disc3, Flame, KeyRound, ListMusic, MessageCircle, Radio, Sparkles, Users, Zap } from 'lucide-react';
import { useLocalIdentity } from '@/hooks/useLocalIdentity';
import { normalizeRoomCode } from '@/lib/ids';

const COOL_NICKNAMES = [
    'DJ Synth', 'VibeMaster', 'ElectroPulse', 'AstroBeat', 'NeonRider',
    'CyberGroove', 'SoundWave', 'SonicDrifter', 'BassDrop', 'EchoPulse'
];

export default function Landing() {
    const router = useRouter();
    const { nickname, clientId, setNickname } = useLocalIdentity();
    const [joinCode, setJoinCode] = useState('');
    const [busy, setBusy] = useState<'create' | 'join' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'create' | 'join'>('create');

    const generateRandomNick = () => {
        const rand = COOL_NICKNAMES[Math.floor(Math.random() * COOL_NICKNAMES.length)];
        setNickname(rand);
        setError(null);
    };

    const needName = (): boolean => {
        if (nickname.trim()) return false;
        setError('Please pick or generate a DJ nickname to start');
        return true;
    };

    const createRoom = async () => {
        if (needName()) return;
        setBusy('create'); setError(null);
        try {
            const res = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, name: `${nickname.trim()}'s Cyber Studio` })
            });
            const j = await res.json();
            if (!j.ok) throw new Error(j.error || 'Could not create room');
            router.push(`/room/${j.code}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create room');
            setBusy(null);
        }
    };

    const joinRoom = async () => {
        if (needName()) return;
        const code = normalizeRoomCode(joinCode);
        if (code.length < 4) { setError('Enter a valid 4+ character room code'); return; }
        setBusy('join'); setError(null);
        try {
            const res = await fetch(`/api/rooms/${code}`);
            if (!res.ok) throw new Error('Room not found — check the code');
            router.push(`/room/${code}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Join failed');
            setBusy(null);
        }
    };

    const pasteCode = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const cleaned = text.split('/room/').pop() || text;
            setJoinCode(normalizeRoomCode(cleaned));
            setError(null);
        } catch {
            setError('Could not read clipboard');
        }
    };

    return (
        <main className="h-screen w-full max-h-screen overflow-hidden flex flex-col items-center justify-between p-3 sm:p-5 lg:p-6 relative z-10">
            {/* Top Bar / Live Metrics Ticker */}
            <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/5 border border-white/15 backdrop-blur-md text-[11px] font-semibold text-white/80 shrink-0">
                <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                <span className="font-heading uppercase tracking-widest text-[9px]">Real-Time WebRTC Sync</span>
                <span className="text-white/30">•</span>
                <span className="text-white font-mono">0ms Delay</span>
            </div>

            <div className="w-full max-w-4xl flex-1 flex flex-col justify-center py-2 min-h-0">
                {/* Hero Title Section */}
                <div className="text-center mb-4 sm:mb-6 shrink-0">
                    <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-white/10 border border-white/20 p-0.5 shadow-[0_0_30px_rgba(255,255,255,0.12)] mb-2">
                        <div className="w-full h-full bg-[#0a0a0c] rounded-[14px] flex items-center justify-center">
                            <Disc3 className="text-white animate-spin-vinyl" size={24} />
                        </div>
                    </div>

                    <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-heading uppercase bg-gradient-to-b from-white via-slate-200 to-slate-400 bg-clip-text text-transparent filter drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                        JamRoom
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto mt-1 font-medium leading-normal">
                        Synchronized audio rooms for you & your friends. Import Spotify playlists, search YouTube, and vibe in zero-latency sync.
                    </p>

                    {/* Live Equalizer Spectrum Preview Visualizer */}
                    <div className="flex items-end justify-center gap-1 h-4 mt-2">
                        {[12, 20, 10, 24, 16, 26, 12, 20, 22, 14, 18, 8].map((h, i) => (
                            <span
                                key={i}
                                className="w-1 rounded-full bg-white/70 animate-pulse"
                                style={{ height: `${h}px`, animationDelay: `${i * 0.15}s` }}
                            />
                        ))}
                    </div>
                </div>

                {/* Main Interactive Deck */}
                <div className="grid lg:grid-cols-[1.1fr_1fr] gap-4 sm:gap-6 items-stretch">
                    {/* Primary Action Card */}
                    <div className="glass rounded-2xl p-4 sm:p-5 relative overflow-hidden border-white/20 flex flex-col justify-between">
                        <div>
                            {/* Tab Switcher */}
                            <div className="flex p-1 rounded-xl bg-black/60 border border-white/10 mb-4">
                                <button
                                    onClick={() => setMode('create')}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                        mode === 'create'
                                            ? 'bg-white text-black shadow'
                                            : 'text-white/50 hover:text-white'
                                    }`}
                                >
                                    <Radio size={14} /> <span>Create Room</span>
                                </button>
                                <button
                                    onClick={() => setMode('join')}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                        mode === 'join'
                                            ? 'bg-white text-black shadow'
                                            : 'text-white/50 hover:text-white'
                                    }`}
                                >
                                    <KeyRound size={14} /> <span>Join Room</span>
                                </button>
                            </div>

                            {/* Profile Input */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] font-heading font-bold uppercase tracking-widest text-white/60">
                                        Your DJ Nickname
                                    </label>
                                    <button
                                        onClick={generateRandomNick}
                                        type="button"
                                        className="text-[11px] text-white/80 hover:text-white flex items-center gap-1 font-semibold transition-colors cursor-pointer"
                                    >
                                        <Dices size={12} /> Randomize
                                    </button>
                                </div>
                                <input
                                    value={nickname}
                                    onChange={e => { setNickname(e.target.value); setError(null); }}
                                    onKeyDown={e => e.key === 'Enter' && (mode === 'create' ? createRoom() : joinRoom())}
                                    placeholder="e.g. SoundWave"
                                    maxLength={24}
                                    className="w-full bg-black/70 border border-white/20 rounded-xl px-3.5 py-2.5 text-sm font-semibold placeholder:text-white/20 outline-none focus:border-white focus:ring-1 focus:ring-white/30 transition-all text-white"
                                />
                            </div>

                            {mode === 'create' ? (
                                <button
                                    onClick={createRoom}
                                    disabled={busy !== null}
                                    className="w-full neon-btn-primary py-3 rounded-xl font-heading font-bold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <Zap size={16} />
                                    {busy === 'create' ? 'Launching Studio…' : 'Launch Room'}
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-[10px] font-heading font-bold uppercase tracking-widest text-white/60 block mb-1">
                                            Enter Room Code
                                        </label>
                                        <div className="relative">
                                            <input
                                                value={joinCode}
                                                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(null); }}
                                                onKeyDown={e => e.key === 'Enter' && joinRoom()}
                                                placeholder="ROOM CODE"
                                                maxLength={8}
                                                className="w-full bg-black/70 border border-white/20 rounded-xl px-3.5 py-2.5 font-mono font-bold tracking-[0.25em] text-center text-base uppercase outline-none focus:border-white focus:ring-1 focus:ring-white/30 transition-all text-white"
                                            />
                                            <button
                                                onClick={pasteCode}
                                                type="button"
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] bg-white/10 hover:bg-white/20 rounded-md text-white/70 transition-colors font-sans"
                                            >
                                                Paste
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={joinRoom}
                                        disabled={busy !== null}
                                        className="w-full neon-btn-primary py-3 rounded-xl font-heading font-bold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <span>Enter Studio Room</span>
                                        <ArrowRight size={16} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="mt-3 p-2.5 rounded-xl bg-white/5 border border-white/20 text-white text-[11px] font-semibold flex items-center gap-2">
                                <Flame size={14} className="shrink-0 text-white" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>

                    {/* Features Showcase Column */}
                    <div className="flex flex-col justify-between gap-2.5">
                        {[
                            {
                                icon: Users,
                                title: '0ms WebRTC Audio Sync',
                                desc: 'Precision playback sync across all listeners in zero-latency sync.'
                            },
                            {
                                icon: ListMusic,
                                title: 'Spotify & YouTube Engine',
                                desc: 'Import 600+ track Spotify playlists or search YouTube tracks live.'
                            },
                            {
                                icon: MessageCircle,
                                title: 'Real-Time Emoji Reactions',
                                desc: 'Interactive chat feed with floating particle emoji bursts over the stage.'
                            }
                        ].map((f, i) => (
                            <div key={f.title} className="glass-interactive rounded-2xl p-3.5 flex items-center gap-3 border-white/15 flex-1">
                                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0 shadow">
                                    <f.icon size={18} className="text-white" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-heading font-bold text-xs sm:text-sm text-white truncate">{f.title}</h3>
                                    <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{f.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bottom Subtle Footer */}
            <div className="text-[10px] text-white/30 font-mono tracking-widest uppercase shrink-0">
                JamRoom Studio • Synchronized Cyber Audio
            </div>
        </main>
    );
}
