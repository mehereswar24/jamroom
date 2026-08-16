'use client';

/**
 * useMediaChat — peer-to-peer voice/video/screen-share for a room.
 *
 * Topology: full mesh. The Socket.IO connection is the signaling channel;
 * media flows browser↔browser (no media server). Fine for a friends-sized
 * room (~2-6 people); beyond that a mesh gets heavy on upload bandwidth.
 *
 * Each peer link uses the WHATWG "perfect negotiation" pattern (polite /
 * impolite by clientId comparison) so simultaneous offers never deadlock.
 * Every link is created with one audio + one video transceiver up front, so
 * turning mic/cam/screen on and off is a cheap replaceTrack() with no
 * renegotiation — only the initial connect and ICE need signaling.
 *
 * Video model: one video slot per person. Starting a screen share swaps your
 * camera track for the screen track (your tile shows a "screen" badge);
 * everyone else keeps their own camera. Cam + screen at the same time from
 * one person is intentionally not supported.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Ably from 'ably';
import { getCallChannel as getRoomCallChannel } from './realtime';
import { getSavedNickname } from './useLocalIdentity';
import type { RtcPeer, RtcSignalData } from '@/lib/types';

const ICE_SERVERS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // Optional TURN for tricky NATs / mobile — set NEXT_PUBLIC_TURN_URL etc.
    ...(process.env.NEXT_PUBLIC_TURN_URL ? [{
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL
    } as RTCIceServer] : [])
];

interface PeerLink {
    pc: RTCPeerConnection;
    polite: boolean;
    makingOffer: boolean;
    audioSender: RTCRtpSender;
    videoSender: RTCRtpSender;
    stream: MediaStream;
}

export interface RemotePeer {
    clientId: string;
    nickname: string;
    stream: MediaStream | null;
    audio: boolean;
    video: boolean;
    screen: boolean;
}

export interface MediaChat {
    inCall: boolean;
    micOn: boolean;
    camOn: boolean;
    screenOn: boolean;
    error: string | null;
    localStream: MediaStream | null;
    peers: RemotePeer[];
    joinCall: () => Promise<void>;
    leaveCall: () => void;
    toggleMic: () => Promise<void>;
    toggleCam: () => Promise<void>;
    toggleScreen: () => Promise<void>;
}

export function useMediaChat(selfClientId: string, roomCode: string): MediaChat {
    const [inCall, setInCall] = useState(false);
    const [micOn, setMicOn] = useState(false);
    const [camOn, setCamOn] = useState(false);
    const [screenOn, setScreenOn] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [peers, setPeers] = useState<RemotePeer[]>([]);

    const links = useRef(new Map<string, PeerLink>());
    const micTrack = useRef<MediaStreamTrack | null>(null);
    const videoTrack = useRef<MediaStreamTrack | null>(null);   // camera OR screen
    const localStreamRef = useRef<MediaStream>(null as unknown as MediaStream);
    const inCallRef = useRef(false);
    const presenceRef = useRef<Record<string, RtcPeer>>({});

    if (!localStreamRef.current && typeof window !== 'undefined') {
        localStreamRef.current = new MediaStream();
    }

    // Dedicated Ably channel for the call: its presence = who's in the call,
    // and 'signal' messages carry the WebRTC offers/answers/ICE.
    const callChannelRef = useRef<Ably.RealtimeChannel | null>(null);
    const getCallChannel = useCallback((): Ably.RealtimeChannel | null => {
        if (!callChannelRef.current && selfClientId && roomCode) {
            callChannelRef.current = getRoomCallChannel(roomCode);
        }
        return callChannelRef.current;
    }, [selfClientId, roomCode]);

    const sendSignal = useCallback((to: string, data: RtcSignalData) => {
        const ch = getCallChannel();
        if (ch) void ch.publish('signal', { to, from: selfClientId, data });
    }, [getCallChannel, selfClientId]);

    const screenActiveRef = useRef(false);
    const emitState = useCallback(() => {
        const ch = getCallChannel();
        if (!ch) return;
        void ch.presence.update({
            nickname: getSavedNickname(),
            audio: !!micTrack.current && micTrack.current.enabled,
            video: !!videoTrack.current && !screenActiveRef.current,
            screen: screenActiveRef.current
        });
    }, [getCallChannel]);

    const refreshPeersState = useCallback(() => {
        const list: RemotePeer[] = [];
        for (const [clientId, p] of Object.entries(presenceRef.current)) {
            if (clientId === selfClientId) continue;
            const link = links.current.get(clientId);
            list.push({
                clientId, nickname: p.nickname, stream: link?.stream ?? null,
                audio: p.audio, video: p.video, screen: p.screen
            });
        }
        setPeers(list);
    }, [selfClientId]);

    /* ── build a peer link with perfect negotiation ── */
    const createLink = useCallback((peerId: string): PeerLink => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const polite = selfClientId > peerId;   // deterministic, symmetric
        const stream = new MediaStream();

        // Stable transceivers: connect once, then toggles are pure replaceTrack.
        const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
        if (micTrack.current) void audioTx.sender.replaceTrack(micTrack.current);
        if (videoTrack.current) void videoTx.sender.replaceTrack(videoTrack.current);

        const link: PeerLink = { pc, polite, makingOffer: false, audioSender: audioTx.sender, videoSender: videoTx.sender, stream };

        pc.onnegotiationneeded = async () => {
            try {
                link.makingOffer = true;
                await pc.setLocalDescription();
                sendSignal(peerId, { description: pc.localDescription!.toJSON() as RtcSignalData['description'] });
            } catch (err) {
                console.error('[rtc] negotiation error', err);
            } finally {
                link.makingOffer = false;
            }
        };
        pc.onicecandidate = ({ candidate }) => {
            if (candidate && candidate.candidate) {
                sendSignal(peerId, {
                    candidate: {
                        candidate: candidate.candidate,
                        sdpMid: candidate.sdpMid ?? null,
                        sdpMLineIndex: candidate.sdpMLineIndex ?? null
                    }
                });
            }
        };
        pc.ontrack = ({ track }) => {
            stream.addTrack(track);
            track.onended = () => { try { stream.removeTrack(track); } catch { /* ignore */ } };
            refreshPeersState();
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { /* ignore */ } }
            if (pc.connectionState === 'closed') closeLink(peerId);
        };

        links.current.set(peerId, link);
        return link;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selfClientId, refreshPeersState]);

    const closeLink = useCallback((peerId: string) => {
        const link = links.current.get(peerId);
        if (!link) return;
        try { link.pc.close(); } catch { /* ignore */ }
        links.current.delete(peerId);
        refreshPeersState();
    }, [refreshPeersState]);

    /* ── call-channel presence + signaling in ── */
    useEffect(() => {
        const ch = getCallChannel();
        if (!ch) return;

        const rebuildPresence = async () => {
            try {
                const members = await ch.presence.get();
                presenceRef.current = Object.fromEntries(
                    members.filter(m => m.clientId).map(m => {
                        const d = (m.data ?? {}) as Partial<RtcPeer>;
                        return [m.clientId!, {
                            clientId: m.clientId!, nickname: d.nickname ?? 'Guest',
                            audio: !!d.audio, video: !!d.video, screen: !!d.screen
                        } as RtcPeer];
                    })
                );
                if (inCallRef.current) {
                    const ids = new Set(members.map(m => m.clientId));
                    for (const m of members) {
                        if (m.clientId && m.clientId !== selfClientId && !links.current.has(m.clientId)) createLink(m.clientId);
                    }
                    for (const id of [...links.current.keys()]) if (!ids.has(id)) closeLink(id);
                }
                refreshPeersState();
            } catch { /* ignore */ }
        };

        const onPresence = () => { void rebuildPresence(); };
        ch.presence.subscribe(['enter', 'leave', 'update', 'present'], onPresence);

        const onSignal = async (msg: Ably.Message) => {
            if (!inCallRef.current) return;
            const { to, from, data } = (msg.data ?? {}) as { to: string; from: string; data: RtcSignalData };
            if (to !== selfClientId || from === selfClientId) return;
            let link = links.current.get(from);
            if (!link) link = createLink(from);
            const { pc } = link;
            try {
                if (data.description) {
                    const desc = data.description as RTCSessionDescriptionInit;
                    const offerCollision = desc.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable');
                    if (!link.polite && offerCollision) return;   // impolite side ignores colliding offers
                    await pc.setRemoteDescription(desc);
                    if (desc.type === 'offer') {
                        await pc.setLocalDescription();
                        sendSignal(from, { description: pc.localDescription!.toJSON() as RtcSignalData['description'] });
                    }
                } else if (data.candidate) {
                    try { await pc.addIceCandidate(data.candidate as RTCIceCandidateInit); } catch { /* ignore late candidates */ }
                }
            } catch (err) {
                console.error('[rtc] signal handling error', err);
            }
        };
        ch.subscribe('signal', onSignal);

        return () => {
            try { ch.presence.unsubscribe(onPresence); } catch { /* ignore */ }
            try { ch.unsubscribe('signal', onSignal); } catch { /* ignore */ }
        };
    }, [selfClientId, getCallChannel, sendSignal, createLink, closeLink, refreshPeersState]);

    /* ── local media helpers ── */

    // replaceTrack does NOT trigger renegotiation, and a transceiver that was
    // negotiated with no track sits at direction "recvonly" — so a camera/screen
    // turned on later never actually flows to peers until we renegotiate. Force
    // an offer (perfect-negotiation-safe) whenever we add/replace a sending track.
    const renegotiate = async (peerId: string, link: PeerLink) => {
        try {
            if (link.makingOffer || link.pc.signalingState !== 'stable') return;
            link.makingOffer = true;
            await link.pc.setLocalDescription();
            sendSignal(peerId, { description: link.pc.localDescription!.toJSON() as RtcSignalData['description'] });
        } catch (err) {
            console.error('[rtc] renegotiate error', err);
        } finally {
            link.makingOffer = false;
        }
    };

    const setVideoOnLinks = (track: MediaStreamTrack | null) => {
        for (const [peerId, link] of links.current.entries()) {
            void link.videoSender.replaceTrack(track).then(() => renegotiate(peerId, link));
        }
    };
    const setAudioOnLinks = (track: MediaStreamTrack | null) => {
        for (const [peerId, link] of links.current.entries()) {
            void link.audioSender.replaceTrack(track).then(() => renegotiate(peerId, link));
        }
    };

    const rebuildLocalStream = () => {
        const s = new MediaStream();
        if (micTrack.current) s.addTrack(micTrack.current);
        if (videoTrack.current) s.addTrack(videoTrack.current);
        localStreamRef.current = s;
        setLocalStream(s);
    };

    const joinCall = useCallback(async () => {
        setError(null);
        try {
            // Start with the mic on — that's the point of "joining".
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micTrack.current = stream.getAudioTracks()[0] ?? null;
            if (micTrack.current) micTrack.current.enabled = true;
            setMicOn(true);
            rebuildLocalStream();
            setAudioOnLinks(micTrack.current);
            inCallRef.current = true;
            setInCall(true);
            const ch = getCallChannel();
            if (ch) {
                await ch.presence.enter({ nickname: getSavedNickname(), audio: true, video: false, screen: false });
                const members = await ch.presence.get();
                for (const m of members) {
                    if (m.clientId && m.clientId !== selfClientId && !links.current.has(m.clientId)) createLink(m.clientId);
                }
                refreshPeersState();
            }
        } catch {
            setError('Could not access your microphone. Check browser permissions.');
        }
    }, [selfClientId, getCallChannel, createLink, refreshPeersState]);

    const leaveCall = useCallback(() => {
        try { getCallChannel()?.presence.leave(); } catch { /* ignore */ }
        inCallRef.current = false;
        for (const id of [...links.current.keys()]) closeLink(id);
        micTrack.current?.stop(); micTrack.current = null;
        videoTrack.current?.stop(); videoTrack.current = null;
        screenActiveRef.current = false;
        localStreamRef.current = new MediaStream();
        setLocalStream(null);
        setInCall(false); setMicOn(false); setCamOn(false); setScreenOn(false);
        setPeers([]);
    }, [closeLink, getCallChannel]);

    const toggleMic = useCallback(async () => {
        if (!micTrack.current) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                micTrack.current = s.getAudioTracks()[0] ?? null;
                setAudioOnLinks(micTrack.current);
            } catch { setError('Microphone unavailable'); return; }
        } else {
            micTrack.current.enabled = !micTrack.current.enabled;
        }
        setMicOn(!!micTrack.current?.enabled);
        rebuildLocalStream();
        emitState();
    }, [emitState]);

    const toggleCam = useCallback(async () => {
        if (screenActiveRef.current) return;   // stop screen share first
        if (videoTrack.current) {
            videoTrack.current.stop();
            videoTrack.current = null;
            setVideoOnLinks(null);
            setCamOn(false);
        } else {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
                videoTrack.current = s.getVideoTracks()[0] ?? null;
                setVideoOnLinks(videoTrack.current);
                setCamOn(true);
            } catch { setError('Camera unavailable'); return; }
        }
        rebuildLocalStream();
        emitState();
    }, [emitState]);

    const toggleScreen = useCallback(async () => {
        if (screenActiveRef.current) {
            videoTrack.current?.stop();
            videoTrack.current = null;
            screenActiveRef.current = false;
            setVideoOnLinks(null);
            setScreenOn(false);
            rebuildLocalStream();
            emitState();
            return;
        }
        try {
            const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            // Turning on screen replaces the camera track (single video slot).
            videoTrack.current?.stop();
            videoTrack.current = s.getVideoTracks()[0] ?? null;
            screenActiveRef.current = true;
            setCamOn(false);
            setScreenOn(true);
            setVideoOnLinks(videoTrack.current);
            rebuildLocalStream();
            emitState();
            // The browser's own "Stop sharing" ends the track — revert cleanly.
            if (videoTrack.current) {
                videoTrack.current.onended = () => {
                    videoTrack.current = null;
                    screenActiveRef.current = false;
                    setVideoOnLinks(null);
                    setScreenOn(false);
                    rebuildLocalStream();
                    emitState();
                };
            }
        } catch { /* user cancelled the picker */ }
    }, [emitState]);

    /* Leave the call when the room unmounts */
    useEffect(() => () => { if (inCallRef.current) leaveCall(); }, [leaveCall]);

    return { inCall, micOn, camOn, screenOn, error, localStream, peers, joinCall, leaveCall, toggleMic, toggleCam, toggleScreen };
}
