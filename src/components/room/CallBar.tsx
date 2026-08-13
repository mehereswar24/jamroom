'use client';

import { useEffect, useRef, useState } from 'react';
import {
    Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Phone, GripHorizontal, Maximize, Minimize
} from 'lucide-react';
import type { MediaChat, RemotePeer } from '@/hooks/useMediaChat';
import { avatarColorFor } from '@/lib/ids';

export default function CallBar({ call, selfNickname, selfClientId }: {
    call: MediaChat; selfNickname: string; selfClientId: string;
}) {
    const [pos, setPos] = useState({ x: 20, y: 80 });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const onFSChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', onFSChange);
        return () => document.removeEventListener('fullscreenchange', onFSChange);
    }, []);

    const toggleFullscreen = () => {
        if (!cardRef.current) return;
        if (!document.fullscreenElement) {
            cardRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => setIsFullscreen(true));
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => setIsFullscreen(false));
        }
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (isFullscreen) return;
        isDraggingRef.current = true;
        dragOffsetRef.current = {
            x: e.clientX - pos.x,
            y: e.clientY - pos.y
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current || isFullscreen) return;
        const newX = Math.max(10, Math.min(window.innerWidth - 200, e.clientX - dragOffsetRef.current.x));
        const newY = Math.max(10, Math.min(window.innerHeight - 150, e.clientY - dragOffsetRef.current.y));
        setPos({ x: newX, y: newY });
    };

    const onPointerUp = (e: React.PointerEvent) => {
        isDraggingRef.current = false;
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    };

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
        <>
            {/* Header Status Button */}
            <button
                onClick={call.leaveCall}
                className="flex items-center gap-1.5 text-xs font-semibold bg-red-500/90 hover:bg-red-500 text-white rounded-xl sm:rounded-2xl px-2.5 py-1.5 sm:px-3 sm:py-2 transition-all cursor-pointer shadow-sm shrink-0"
                title="Leave Voice/Video Call"
            >
                <PhoneOff size={13} />
                <span>In Call ({tiles.length})</span>
            </button>

            {/* Standalone Movable, Resizable & Fullscreen Picture-in-Picture Call Card */}
            <div
                ref={cardRef}
                style={isFullscreen ? { left: 0, top: 0, width: '100vw', height: '100vh' } : { left: `${pos.x}px`, top: `${pos.y}px` }}
                className={
                    isFullscreen
                        ? 'fixed inset-0 w-screen h-screen z-[9999] bg-slate-950 p-4 sm:p-6 flex flex-col gap-4 shadow-2xl overflow-hidden'
                        : 'fixed z-[100] glass rounded-2xl border-white/20 p-3 flex flex-col gap-2.5 shadow-[0_25px_60px_rgba(0,0,0,0.9)] bg-black/90 backdrop-blur-2xl resize overflow-auto min-w-[280px] min-h-[160px] max-w-[95vw] max-h-[80vh] group select-none'
                }
            >
                {/* Header Handle - Drag Anywhere / Fullscreen Bar */}
                <div
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className={`flex items-center justify-between gap-2 border-b border-white/10 pb-2 px-1 shrink-0 ${
                        isFullscreen ? '' : 'cursor-grab active:cursor-grabbing hover:text-white'
                    }`}
                >
                    <span className="text-[11px] sm:text-xs font-mono font-bold tracking-wider text-emerald-400 flex items-center gap-2">
                        {!isFullscreen && <GripHorizontal size={16} className="text-white/70" />}
                        <span>{isFullscreen ? 'FULLSCREEN CALL STAGE' : 'DRAG CALL ANYWHERE'} ({tiles.length})</span>
                    </span>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleFullscreen}
                            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                            title={isFullscreen ? 'Exit Fullscreen' : 'Open Fullscreen'}
                        >
                            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                            <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                        </button>
                    </div>
                </div>

                <div className={`flex items-center gap-3 overflow-x-auto pb-1 flex-1 min-h-0 ${
                    isFullscreen ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4 overflow-y-auto' : ''
                }`}>
                    {tiles.map(t => (
                        <VideoTile key={t.clientId} peer={t} self={t.self} isFullscreen={isFullscreen} />
                    ))}
                </div>

                <div className="flex items-center justify-center gap-3 pt-2 border-t border-white/10 shrink-0">
                    <CtrlButton on={call.micOn} onClick={call.toggleMic}
                        onIcon={<Mic size={16} />} offIcon={<MicOff size={16} />} label="Mic" />
                    <CtrlButton on={call.camOn} onClick={call.toggleCam}
                        onIcon={<Video size={16} />} offIcon={<VideoOff size={16} />} label="Camera" />
                    <CtrlButton on={call.screenOn} onClick={call.toggleScreen}
                        onIcon={<MonitorUp size={16} />} offIcon={<MonitorX size={16} />} label="Share" accent />
                    <button
                        onClick={call.leaveCall}
                        className="flex items-center gap-1.5 bg-red-500/90 hover:bg-red-500 text-white rounded-xl px-4 py-2 text-xs font-semibold transition-colors cursor-pointer"
                        title="Leave call"
                    >
                        <PhoneOff size={15} /> <span>Leave Call</span>
                    </button>
                </div>

                {call.error && <p className="text-[11px] text-red-300 text-center shrink-0">{call.error}</p>}
            </div>
        </>
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

function VideoTile({ peer, self, isFullscreen }: { peer: RemotePeer & { self?: boolean }; self: boolean; isFullscreen?: boolean }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const showVideo = peer.video || peer.screen;

    useEffect(() => {
        const el = videoRef.current;
        if (el && peer.stream && el.srcObject !== peer.stream) {
            el.srcObject = peer.stream;
        }
    }, [peer.stream]);

    return (
        <div className={`relative rounded-2xl overflow-hidden bg-black/80 border border-white/15 ${
            isFullscreen ? 'w-full h-full min-h-[220px] aspect-video' : 'shrink-0 w-32 sm:w-44 aspect-video'
        }`}>
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
                        className={`rounded-full flex items-center justify-center font-bold text-white shadow-lg ${
                            isFullscreen ? 'w-16 h-16 text-xl' : 'w-11 h-11 text-sm'
                        }`}
                        style={{ backgroundColor: avatarColorFor(peer.clientId) }}
                    >
                        {peer.nickname.slice(0, 1).toUpperCase()}
                    </div>
                </div>
            )}

            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-medium text-white bg-black/60 backdrop-blur-md rounded-lg px-2 py-0.5 truncate max-w-[75%]">
                    {peer.nickname}{self ? ' (you)' : ''}
                </span>
                <span className="flex items-center gap-1">
                    {peer.screen && <span className="text-[9px] bg-accent/90 text-white rounded px-1.5 py-0.5 font-bold">SCREEN</span>}
                    {!peer.audio && <MicOff size={13} className="text-red-300 bg-black/60 rounded p-0.5 w-4.5 h-4.5" />}
                </span>
            </div>
        </div>
    );
}
