'use client';

import { useEffect, useRef } from 'react';
import {
    Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Phone
} from 'lucide-react';
import type { MediaChat, RemotePeer } from '@/hooks/useMediaChat';
import { avatarColorFor } from '@/lib/ids';

export default function CallBar({ call, selfNickname, selfClientId }: {
    call: MediaChat; selfNickname: string; selfClientId: string;
}) {
    if (!call.inCall) {
        return (
            <button
                onClick={call.joinCall}
                className="flex items-center gap-2 text-xs sm:text-sm font-semibold bg-emerald-500/90 hover:bg-emerald-500 text-white rounded-xl sm:rounded-2xl px-3 py-1.5 sm:px-3.5 sm:py-2 transition-all cursor-pointer shadow-sm shrink-0"
                title="Start voice / video chat with the room"
            >
                <Phone size={14} /> <span className="hidden sm:inline">Join Call</span>
            </button>
        );
    }

    const tiles = [
        { clientId: selfClientId, nickname: selfNickname, stream: call.localStream, audio: call.micOn, video: call.camOn, screen: call.screenOn, self: true },
        ...call.peers.map(p => ({ ...p, self: false })),
    ];

    return (
        <div className="glass rounded-2xl border-white/15 p-2.5 sm:p-3 flex flex-col gap-2 shadow-xl bg-black/80 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 px-0.5">
                <span className="text-[11px] font-mono font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE VOICE & VIDEO ({tiles.length})
                </span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-[90vw]">
                {tiles.map(t => (
                    <VideoTile key={t.clientId} peer={t} self={t.self} />
                ))}
            </div>

            <div className="flex items-center justify-center gap-2 pt-1 border-t border-white/10">
                <CtrlButton on={call.micOn} onClick={call.toggleMic}
                    onIcon={<Mic size={15} />} offIcon={<MicOff size={15} />} label="Mic" />
                <CtrlButton on={call.camOn} onClick={call.toggleCam}
                    onIcon={<Video size={15} />} offIcon={<VideoOff size={15} />} label="Camera" />
                <CtrlButton on={call.screenOn} onClick={call.toggleScreen}
                    onIcon={<MonitorUp size={15} />} offIcon={<MonitorX size={15} />} label="Share" accent />
                <button
                    onClick={call.leaveCall}
                    className="flex items-center gap-1 bg-red-500/90 hover:bg-red-500 text-white rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                    title="Leave call"
                >
                    <PhoneOff size={14} /> <span>Leave</span>
                </button>
            </div>

            {call.error && <p className="text-[11px] text-red-300 text-center">{call.error}</p>}
        </div>
    );
}

function CtrlButton({ on, onClick, onIcon, offIcon, label, accent }: {
    on: boolean; onClick: () => void; onIcon: React.ReactNode; offIcon: React.ReactNode; label: string; accent?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            title={label}
            className={`flex items-center justify-center w-11 h-10 rounded-xl transition-colors cursor-pointer border ${
                on
                    ? accent ? 'bg-accent text-white border-accent' : 'bg-white text-black border-white'
                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
            }`}
        >
            {on ? onIcon : offIcon}
        </button>
    );
}

function VideoTile({ peer, self }: { peer: RemotePeer & { self?: boolean }; self: boolean }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const showVideo = peer.video || peer.screen;

    useEffect(() => {
        const el = videoRef.current;
        if (el && peer.stream && el.srcObject !== peer.stream) {
            el.srcObject = peer.stream;
        }
    }, [peer.stream]);

    return (
        <div className="relative shrink-0 w-32 sm:w-44 aspect-video rounded-xl overflow-hidden bg-black/70 border border-white/10">
            {/* Video element is always mounted (carries audio for remote peers); hidden when no video track */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={self}
                className={`w-full h-full object-cover ${showVideo ? '' : 'hidden'} ${peer.screen ? 'object-contain bg-black' : ''} ${self && !peer.screen ? 'scale-x-[-1]' : ''}`}
            />
            {!showVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: avatarColorFor(peer.clientId) }}
                    >
                        {peer.nickname.slice(0, 1).toUpperCase()}
                    </div>
                </div>
            )}

            <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
                <span className="text-[10px] font-medium text-white bg-black/60 rounded px-1.5 py-0.5 truncate max-w-[70%]">
                    {peer.nickname}{self ? ' (you)' : ''}
                </span>
                <span className="flex items-center gap-0.5">
                    {peer.screen && <span className="text-[9px] bg-accent/90 text-white rounded px-1 py-0.5">SCREEN</span>}
                    {!peer.audio && <MicOff size={11} className="text-red-300 bg-black/60 rounded p-0.5 w-4 h-4" />}
                </span>
            </div>
        </div>
    );
}
