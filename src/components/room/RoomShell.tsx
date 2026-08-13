'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Crown, Disc3, ListMusic, MessageCircle, Settings, Users } from 'lucide-react';
import { useLocalIdentity } from '@/hooks/useLocalIdentity';
import { useRoomConnection } from '@/hooks/useRoomConnection';
import { useRoomStore } from '@/hooks/useRoomStore';
import { getSocket } from '@/hooks/socket';
import PlayerPane from './PlayerPane';
import QueuePanel from './QueuePanel';
import ChatPanel from './ChatPanel';

export default function RoomShell({ roomCode }: { roomCode: string }) {
    const { nickname, clientId, setNickname } = useLocalIdentity();
    const [draftName, setDraftName] = useState('');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || !clientId) return <CenterNote text="Initializing session…" />;
    if (!nickname.trim()) {
        return (
            <main className="flex-1 flex items-center justify-center px-6 py-12">
                <div className="glass rounded-3xl p-8 w-full max-w-sm border border-white/10 shadow-2xl">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center">
                            <Disc3 className="text-accent animate-spin-vinyl" size={22} />
                        </div>
                        <div>
                            <h1 className="font-bold text-lg text-white">Join Room</h1>
                            <p className="text-xs text-white/50 font-mono tracking-wider">{roomCode}</p>
                        </div>
                    </div>
                    <label className="text-[11px] uppercase font-bold tracking-widest text-accent">Pick your nickname</label>
                    <input
                        autoFocus
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && draftName.trim() && setNickname(draftName)}
                        maxLength={24}
                        placeholder="e.g. Mehereswar"
                        className="mt-2 w-full bg-black/40 border border-white/15 rounded-2xl px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 transition-all"
                    />
                    <button
                        onClick={() => draftName.trim() && setNickname(draftName)}
                        className="mt-4 w-full bg-accent hover:bg-accent/90 active:scale-[0.99] rounded-2xl py-3 font-semibold text-white shadow-[0_0_25px_rgba(139,92,246,0.3)] transition-all cursor-pointer"
                    >
                        Join Room
                    </button>
                </div>
            </main>
        );
    }
    return <ConnectedRoom roomCode={roomCode} nickname={nickname} clientId={clientId} />;
}

function ConnectedRoom({ roomCode, nickname, clientId }: { roomCode: string; nickname: string; clientId: string }) {
    useRoomConnection(roomCode, nickname, clientId);
    const joined = useRoomStore(s => s.joined);
    const joinError = useRoomStore(s => s.joinError);
    const roomName = useRoomStore(s => s.roomName);
    const members = useRoomStore(s => s.members);
    const hostClientId = useRoomStore(s => s.hostClientId);
    const selfClientId = useRoomStore(s => s.selfClientId);
    const guestControls = useRoomStore(s => s.guestControls);
    const notice = useRoomStore(s => s.notice);
    const [tab, setTab] = useState<'queue' | 'chat'>('queue');
    const [copied, setCopied] = useState(false);
    const [hostMenuOpen, setHostMenuOpen] = useState(false);

    const isHost = selfClientId === hostClientId;

    const copyInvite = async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/room/${roomCode}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (joinError) {
        return (
            <CenterNote text={joinError}>
                <Link href="/" className="mt-2 text-accent hover:underline text-sm font-medium">← Back to home</Link>
            </CenterNote>
        );
    }
    if (!joined) return <CenterNote text="Connecting to synced audio room…" />;

    return (
        <main className="flex-1 flex flex-col max-w-[1440px] w-full mx-auto px-4 lg:px-6 py-4 gap-4 min-h-0 lg:h-[calc(100vh-24px)] lg:max-h-[calc(100vh-24px)] overflow-hidden">
            {/* Room Shell Header Bar */}
            <header className="relative z-50 glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-white/10 shadow-lg">
                <div className="flex items-center gap-3.5 min-w-0">
                    <Link href="/" className="flex items-center gap-2.5 group">
                        <div className="w-9 h-9 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center group-hover:border-accent transition-colors">
                            <Disc3 className="text-accent group-hover:rotate-180 transition-transform duration-700" size={20} />
                        </div>
                        <span className="font-bold tracking-tight text-base sm:text-lg bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                            JamRoom
                        </span>
                    </Link>
                    <div className="h-5 w-px bg-white/10 hidden sm:block" />
                    <div className="flex items-center gap-2 truncate">
                        <span className="text-sm font-semibold text-white/90 truncate max-w-[180px] sm:max-w-[260px]">
                            {roomName}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                        </span>
                    </div>

                    <button
                        onClick={copyInvite}
                        className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 rounded-xl px-3 py-1.5 font-mono tracking-widest transition-all cursor-pointer text-white/80"
                        title="Copy invite link to clipboard"
                    >
                        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        <span>{roomCode}</span>
                        {copied && <span className="text-[10px] text-emerald-400 font-sans tracking-normal ml-1">Copied!</span>}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    {/* Active Member Avatar Stack */}
                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-2xl px-3 py-1.5">
                        <Users size={14} className="text-white/40" />
                        <div className="flex -space-x-2">
                            {members.slice(0, 6).map(m => (
                                <div
                                    key={m.clientId}
                                    title={`${m.nickname}${m.clientId === hostClientId ? ' (Host)' : ''}`}
                                    className="relative w-7 h-7 rounded-full border-2 border-slate-950 flex items-center justify-center text-[10px] font-bold shadow"
                                    style={{ backgroundColor: m.avatarColor }}
                                >
                                    {m.nickname.slice(0, 1).toUpperCase()}
                                    {m.clientId === hostClientId && (
                                        <Crown size={10} className="absolute -top-1.5 -right-1 text-amber-300 drop-shadow" />
                                    )}
                                </div>
                            ))}
                            {members.length > 6 && (
                                <div className="w-7 h-7 rounded-full border-2 border-slate-950 bg-white/10 flex items-center justify-center text-[10px] font-semibold text-white/70">
                                    +{members.length - 6}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Host Controls Menu Button */}
                    {isHost && (
                        <div className="relative">
                            <button
                                onClick={() => setHostMenuOpen(o => !o)}
                                className="flex items-center gap-1.5 text-xs font-semibold bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent-foreground rounded-2xl px-3.5 py-2 transition-all cursor-pointer"
                            >
                                <Settings size={14} />
                                <span>Host Controls</span>
                            </button>
                            {hostMenuOpen && (
                                <HostMenu
                                    close={() => setHostMenuOpen(false)}
                                    guestControls={guestControls}
                                    members={members.filter(m => m.clientId !== selfClientId)}
                                />
                            )}
                        </div>
                    )}
                </div>
            </header>

            {notice && (
                <div className={`flex items-center gap-2.5 text-xs sm:text-sm rounded-2xl px-4 py-3 glass border ${
                    notice.kind === 'warn' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10' :
                    notice.kind === 'error' ? 'text-red-300 border-red-500/30 bg-red-500/10' :
                    'text-white/80 border-white/10'
                }`}>
                    <AlertTriangle size={15} className="shrink-0" /> <span>{notice.text}</span>
                </div>
            )}

            {/* Room Main Grid: Player Pane + Side Panel (Queue & Chat) */}
            <div className="flex-1 grid lg:grid-cols-[1fr_390px] gap-4 min-h-0">
                <PlayerPane />

                <div className="flex flex-col glass rounded-3xl border-white/10 overflow-hidden min-h-[440px] lg:min-h-0 shadow-2xl">
                    {/* Queue / Chat Tabs */}
                    <div className="flex border-b border-white/10 bg-black/30 p-1">
                        {([['queue', 'Queue', ListMusic], ['chat', 'Chat', MessageCircle]] as const).map(([key, label, Icon]) => (
                            <button
                                key={key}
                                onClick={() => setTab(key)}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                                    tab === key
                                        ? 'text-white bg-white/10 border border-white/10 shadow-sm'
                                        : 'text-white/40 hover:text-white/80'
                                }`}
                            >
                                <Icon size={16} /> <span>{label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 min-h-0 bg-black/20">
                        {tab === 'queue' ? <QueuePanel /> : <ChatPanel />}
                    </div>
                </div>
            </div>
        </main>
    );
}

function HostMenu({ close, guestControls, members }: {
    close: () => void;
    guestControls: boolean;
    members: Array<{ clientId: string; nickname: string }>;
}) {
    const toggleGuestControls = () => {
        const next = !guestControls;
        useRoomStore.getState().setGuestControls(next);
        getSocket().emit('room:setGuestControls', { enabled: next }, () => {});
    };

    return (
        <>
            <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]" onClick={close} />
            <div className="absolute right-0 top-12 z-[100] glass rounded-2xl p-3.5 w-80 shadow-2xl bg-[#0a0a0c]/98 border border-white/25">
                <div className="text-[10px] font-heading font-bold uppercase tracking-widest text-white/70 px-1 pb-2 flex items-center justify-between">
                    <span>Host Controls</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white font-mono">HOST</span>
                </div>
                
                <button
                    onClick={toggleGuestControls}
                    className="w-full text-left p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer flex items-center justify-between gap-3 group"
                >
                    <div>
                        <div className="font-semibold text-xs text-white group-hover:text-pink-300 transition-colors">
                            Guest Permissions
                        </div>
                        <span className="block text-[11px] text-white/50 mt-0.5 leading-tight">
                            {guestControls ? 'Everyone can play, pause & skip' : 'Only host can control playback'}
                        </span>
                    </div>

                    {/* Toggle Switch */}
                    <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center shrink-0 ${guestControls ? 'bg-gradient-to-r from-purple-600 to-pink-500 justify-end' : 'bg-white/15 justify-start'}`}>
                        <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                    </div>
                </button>

                {members.length > 0 && (
                    <>
                        <div className="h-px bg-white/10 my-3" />
                        <div className="text-[10px] font-heading font-bold uppercase tracking-widest text-white/40 px-1 pb-1.5">
                            Pass Host Role
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {members.map(m => (
                                <button
                                    key={m.clientId}
                                    onClick={() => {
                                        getSocket().emit('room:transferHost', { clientId: m.clientId }, () => {});
                                        close();
                                    }}
                                    className="w-full text-left text-xs px-3 py-2 rounded-xl hover:bg-purple-500/20 border border-transparent hover:border-purple-500/30 transition-all flex items-center justify-between cursor-pointer"
                                >
                                    <span className="font-medium text-white">{m.nickname}</span>
                                    <Crown size={14} className="text-amber-400 shrink-0" />
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </>
    );
}

function CenterNote({ text, children }: { text: string; children?: React.ReactNode }) {
    return (
        <main className="flex-1 flex flex-col items-center justify-center gap-3 text-white/60 min-h-[60vh]">
            <Disc3 className="text-accent animate-spin-vinyl" size={32} />
            <p className="text-sm font-medium">{text}</p>
            {children}
        </main>
    );
}
