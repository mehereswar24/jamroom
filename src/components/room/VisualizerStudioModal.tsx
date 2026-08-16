'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Activity, Sparkles, Disc3 } from 'lucide-react';

interface VisualizerStudioModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTitle?: string;
    currentArtist?: string;
    isPlaying?: boolean;
}

export default function VisualizerStudioModal({
    isOpen,
    onClose,
    currentTitle = 'JamRoom Audio Spectrum',
    currentArtist = 'Live Room Stream',
    isPlaying = false
}: VisualizerStudioModalProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [mode, setMode] = useState<'bars' | 'waveform' | 'particles'>('bars');

    useEffect(() => {
        if (!isOpen) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            if (!canvas.parentElement) return;
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;

            const width = canvas.width;
            const height = canvas.height;

            ctx.clearRect(0, 0, width, height);

            // Dark background gradient
            const bgGradient = ctx.createRadialGradient(
                width / 2,
                height / 2,
                50,
                width / 2,
                height / 2,
                Math.max(width, height)
            );
            bgGradient.addColorStop(0, '#090d16');
            bgGradient.addColorStop(1, '#030509');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);

            // Simulated reactive spectrum data
            const dataArray = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                dataArray[i] = isPlaying ? Math.floor(Math.random() * 180 + 40) : 20;
            }

            if (mode === 'bars') {
                const barWidth = (width / dataArray.length) * 1.8;
                let x = 0;

                for (let i = 0; i < dataArray.length; i++) {
                    const barHeight = (dataArray[i] / 255) * (height * 0.6);

                    const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
                    gradient.addColorStop(0, '#10b981');
                    gradient.addColorStop(0.5, '#06b6d4');
                    gradient.addColorStop(1, '#8b5cf6');

                    ctx.fillStyle = gradient;
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = '#10b981';

                    ctx.beginPath();
                    ctx.roundRect(x, height - barHeight - 40, barWidth - 4, barHeight + 40, [8, 8, 0, 0]);
                    ctx.fill();

                    x += barWidth + 4;
                }
            } else if (mode === 'waveform') {
                ctx.beginPath();
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#06b6d4';
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#06b6d4';

                const sliceWidth = width / dataArray.length;
                let x = 0;

                for (let i = 0; i < dataArray.length; i++) {
                    const v = dataArray[i] / 128.0;
                    const y = (v * height) / 2;

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                    x += sliceWidth;
                }

                ctx.lineTo(width, height / 2);
                ctx.stroke();
            } else if (mode === 'particles') {
                const centerX = width / 2;
                const centerY = height / 2;

                ctx.shadowBlur = 25;
                ctx.shadowColor = '#10b981';

                for (let i = 0; i < dataArray.length; i++) {
                    const angle = (i / dataArray.length) * Math.PI * 2;
                    const radius = 90 + (dataArray[i] / 255) * 110;

                    const px = centerX + Math.cos(angle) * radius;
                    const py = centerY + Math.sin(angle) * radius;

                    ctx.beginPath();
                    ctx.arc(px, py, 6 + (dataArray[i] / 255) * 8, 0, Math.PI * 2);
                    ctx.fillStyle = i % 2 === 0 ? '#10b981' : '#a855f7';
                    ctx.fill();
                }
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isOpen, mode, isPlaying]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex flex-col justify-between p-4 sm:p-8 animate-fadeIn">
            {/* Top Bar */}
            <div className="flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <Activity className="w-5 h-5 text-emerald-400 animate-pulse" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
                            <span>{currentTitle}</span>
                        </h3>
                        <p className="text-xs text-white/50">{currentArtist}</p>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-white/5 border border-white/10 rounded-2xl p-1 text-xs">
                        <button
                            onClick={() => setMode('bars')}
                            className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                                mode === 'bars' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-white/60 hover:text-white'
                            }`}
                        >
                            Equalizer
                        </button>
                        <button
                            onClick={() => setMode('waveform')}
                            className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                                mode === 'waveform' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-white/60 hover:text-white'
                            }`}
                        >
                            Waveform
                        </button>
                        <button
                            onClick={() => setMode('particles')}
                            className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                                mode === 'particles' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-white/60 hover:text-white'
                            }`}
                        >
                            Particles
                        </button>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-2 text-white/60 hover:text-white rounded-xl bg-white/10 border border-white/10 transition-all cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="relative flex-1 my-4 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                <canvas ref={canvasRef} className="w-full h-full block" />
            </div>

            {/* Footer Info */}
            <div className="flex items-center justify-between text-xs text-white/40 z-10 font-mono">
                <span>Real-Time Web Audio Visualizer</span>
                <span>Mode: {mode.toUpperCase()}</span>
            </div>
        </div>
    );
}
