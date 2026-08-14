'use client';

/**
 * DrawCanvas — synced Pictionary canvas.
 *
 * The drawer draws with the pointer; points are normalized 0..1 and published
 * in ~60ms batches to the dedicated game channel. Everyone (drawer + guessers)
 * renders incoming stroke batches, so the picture stays in sync at any size.
 * Late joiners publish a resync request; the drawer replays its history.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Ably from 'ably';
import { Eraser, Paintbrush, RotateCcw, Trash2 } from 'lucide-react';
import { getGameChannel } from '@/hooks/realtime';
import { GAME_EV } from '@/lib/channels';
import type { Point, StrokeMsg } from '@/lib/game';

const COLORS = ['#ffffff', '#111827', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#8b5e3c'];
const SIZES = [0.006, 0.014, 0.03];   // fraction of canvas width

export default function DrawCanvas({ roomCode, clientId, canDraw }: {
    roomCode: string; clientId: string; canDraw: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const drawingRef = useRef(false);
    const lastPtRef = useRef<Point | null>(null);
    const batchRef = useRef<Point[]>([]);
    const historyRef = useRef<StrokeMsg[]>([]);     // drawer keeps the full picture for resync
    const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const [color, setColor] = useState('#ffffff');
    const [size, setSize] = useState(SIZES[1]);
    const [erasing, setErasing] = useState(false);

    /* size the backing store to the element */
    const fitCanvas = useCallback(() => {
        const cvs = canvasRef.current, wrap = wrapRef.current;
        if (!cvs || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cvs.width = Math.max(1, Math.round(rect.width * dpr));
        cvs.height = Math.max(1, Math.round((rect.width * 9 / 16) * dpr));
        cvs.style.height = `${rect.width * 9 / 16}px`;
        const ctx = cvs.getContext('2d');
        if (ctx) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctxRef.current = ctx; }
        redrawAll();
    }, []);

    const drawSegment = (a: Point, b: Point, s: StrokeMsg) => {
        const ctx = ctxRef.current, cvs = canvasRef.current;
        if (!ctx || !cvs) return;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size * cvs.width);
        ctx.beginPath();
        ctx.moveTo(a.x * cvs.width, a.y * cvs.height);
        ctx.lineTo(b.x * cvs.width, b.y * cvs.height);
        ctx.stroke();
    };

    const renderStroke = (s: StrokeMsg) => {
        for (let i = 1; i < s.pts.length; i++) drawSegment(s.pts[i - 1], s.pts[i], s);
        // single-point taps → a dot
        if (s.pts.length === 1) {
            const ctx = ctxRef.current, cvs = canvasRef.current;
            if (ctx && cvs) {
                ctx.fillStyle = s.color;
                ctx.beginPath();
                ctx.arc(s.pts[0].x * cvs.width, s.pts[0].y * cvs.height, Math.max(1, s.size * cvs.width) / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    };

    const clearCanvas = () => {
        const ctx = ctxRef.current, cvs = canvasRef.current;
        if (ctx && cvs) ctx.clearRect(0, 0, cvs.width, cvs.height);
    };
    const redrawAll = () => { clearCanvas(); for (const s of historyRef.current) renderStroke(s); };

    /* ── realtime wiring ── */
    useEffect(() => {
        if (!roomCode || !clientId) return;
        const ch = getGameChannel(clientId, roomCode);

        const onStroke = (m: Ably.Message) => {
            const s = m.data as StrokeMsg;
            historyRef.current.push(s);
            renderStroke(s);
        };
        const onClear = () => { historyRef.current = []; clearCanvas(); };
        const onUndo = () => { historyRef.current.pop(); redrawAll(); };
        const onResyncReq = () => {
            // only the drawer answers, chunked to stay under Ably's 64KB limit
            if (!canDraw) return;
            for (const s of historyRef.current) void ch.publish(GAME_EV.stroke, s);
        };
        ch.subscribe(GAME_EV.stroke, onStroke);
        ch.subscribe(GAME_EV.clear, onClear);
        ch.subscribe(GAME_EV.undo, onUndo);
        ch.subscribe(GAME_EV.resyncReq, onResyncReq);

        // ask for the current picture when we join (guessers only)
        if (!canDraw) void ch.publish(GAME_EV.resyncReq, { by: clientId });

        return () => {
            ch.unsubscribe(GAME_EV.stroke, onStroke);
            ch.unsubscribe(GAME_EV.clear, onClear);
            ch.unsubscribe(GAME_EV.undo, onUndo);
            ch.unsubscribe(GAME_EV.resyncReq, onResyncReq);
        };
    }, [roomCode, clientId, canDraw]);

    useEffect(() => {
        fitCanvas();
        const ro = new ResizeObserver(fitCanvas);
        if (wrapRef.current) ro.observe(wrapRef.current);
        return () => ro.disconnect();
    }, [fitCanvas]);

    /* flush batched points every 60ms while drawing */
    useEffect(() => {
        if (!canDraw) return;
        const ch = getGameChannel(clientId, roomCode);
        flushTimer.current = setInterval(() => {
            if (batchRef.current.length < 1) return;
            const s: StrokeMsg = { pts: batchRef.current, color: erasing ? '#0b0b12' : color, size: erasing ? size * 2.2 : size };
            batchRef.current = lastPtRef.current ? [lastPtRef.current] : [];   // carry last point for continuity
            historyRef.current.push(s);
            void ch.publish(GAME_EV.stroke, s);
        }, 60);
        return () => { if (flushTimer.current) clearInterval(flushTimer.current); };
    }, [canDraw, clientId, roomCode, color, size, erasing]);

    const toNorm = (e: React.PointerEvent): Point => {
        const cvs = canvasRef.current!;
        const rect = cvs.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    const onDown = (e: React.PointerEvent) => {
        if (!canDraw) return;
        drawingRef.current = true;
        const p = toNorm(e);
        lastPtRef.current = p;
        batchRef.current = [p];
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!canDraw || !drawingRef.current) return;
        const p = toNorm(e);
        const last = lastPtRef.current;
        if (last) drawSegment(last, p, { pts: [], color: erasing ? '#0b0b12' : color, size: erasing ? size * 2.2 : size });
        batchRef.current.push(p);
        lastPtRef.current = p;
    };
    const onUp = () => { drawingRef.current = false; lastPtRef.current = null; };

    const publishSimple = (name: string) => { void getGameChannel(clientId, roomCode).publish(name, {}); };
    const doClear = () => { historyRef.current = []; clearCanvas(); publishSimple(GAME_EV.clear); };
    const doUndo = () => { historyRef.current.pop(); redrawAll(); publishSimple(GAME_EV.undo); };

    return (
        <div className="flex flex-col gap-2">
            <div ref={wrapRef} className="relative w-full rounded-2xl overflow-hidden border border-white/15 bg-[#0b0b12]">
                <canvas
                    ref={canvasRef}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerLeave={onUp}
                    className={`block w-full ${canDraw ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
                />
            </div>

            {canDraw && (
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                        {COLORS.map(c => (
                            <button key={c} onClick={() => { setColor(c); setErasing(false); }}
                                className={`w-5 h-5 rounded-full border ${color === c && !erasing ? 'ring-2 ring-white' : 'border-white/20'}`}
                                style={{ backgroundColor: c }} aria-label={`color ${c}`} />
                        ))}
                    </div>
                    <div className="flex items-center gap-1 ml-1">
                        {SIZES.map((s, i) => (
                            <button key={i} onClick={() => { setSize(s); setErasing(false); }}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center ${size === s && !erasing ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`}>
                                <span className="rounded-full bg-white" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setErasing(e => !e)} title="Eraser"
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${erasing ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`}>
                        <Eraser size={14} />
                    </button>
                    <button onClick={doUndo} title="Undo" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center"><RotateCcw size={14} /></button>
                    <button onClick={doClear} title="Clear" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/30 flex items-center justify-center"><Trash2 size={14} /></button>
                    <span className="ml-auto text-[10px] text-white/40 flex items-center gap-1"><Paintbrush size={11} /> you&apos;re drawing</span>
                </div>
            )}
        </div>
    );
}
