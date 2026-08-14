'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Crown, Palette, SendHorizonal, Timer, Trophy, Users } from 'lucide-react';
import type { GameHook } from '@/hooks/useGame';
import type { BoardHook } from '@/hooks/useBoardGame';
import { useRoomStore } from '@/hooks/useRoomStore';
import { avatarColorFor } from '@/lib/ids';
import { GAME_LIST } from '@/lib/games/registry';
import type { BoardGameId } from '@/lib/games/types';
import DrawCanvas from './game/DrawCanvas';
import BoardShell from './game/BoardShell';

/** Games hub: routes to a board game, Pictionary, or the picker grid. */
export default function GamesPanel({ game, board, roomCode, clientId }: {
    game: GameHook; board: BoardHook; roomCode: string; clientId: string;
}) {
    const [view, setView] = useState<'hub' | 'pictionary'>('hub');
    const pictionaryActive = !!game.state && game.state.status !== 'idle';

    // A live board game always takes over the panel.
    if (board.board) return <BoardShell board={board} clientId={clientId} onBack={board.exit} />;
    if (view === 'pictionary' || pictionaryActive) {
        return <PictionaryView game={game} roomCode={roomCode} clientId={clientId} onBack={() => setView('hub')} />;
    }
    return (
        <GameHub
            onPickPictionary={() => setView('pictionary')}
            onPickBoard={(id) => board.create(id)}
        />
    );
}

function GameHub({ onPickPictionary, onPickBoard }: { onPickPictionary: () => void; onPickBoard: (id: BoardGameId) => void }) {
    return (
        <div className="h-full overflow-y-auto p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 px-1">Pick a game</p>
            <div className="grid grid-cols-2 gap-2">
                <button onClick={onPickPictionary}
                    className="glass rounded-2xl p-3 text-left hover:bg-white/10 border-white/10 transition-colors">
                    <div className="text-2xl mb-1">🎨</div>
                    <div className="text-sm font-semibold text-white">Doodle &amp; Guess</div>
                    <div className="text-[10px] text-white/50 mt-0.5">Draw &amp; guess · 2+ players</div>
                </button>
                {GAME_LIST.map(g => (
                    <button key={g.id} onClick={() => onPickBoard(g.id)}
                        className="glass rounded-2xl p-3 text-left hover:bg-white/10 border-white/10 transition-colors">
                        <div className="text-2xl mb-1">{g.emoji}</div>
                        <div className="text-sm font-semibold text-white">{g.name}</div>
                        <div className="text-[10px] text-white/50 mt-0.5">{g.min === g.max ? `${g.min} players` : `${g.min}–${g.max} players`}</div>
                    </button>
                ))}
            </div>
            <p className="text-[11px] text-white/30 mt-3 px-1">Music keeps playing while you play. Everyone in the room can join.</p>
        </div>
    );
}

function PictionaryView({ game, roomCode, clientId, onBack }: {
    game: GameHook; roomCode: string; clientId: string; onBack: () => void;
}) {
    const members = useRoomStore(s => s.members);
    const { state } = game;

    if (!state || state.status === 'idle') {
        return <Lobby game={game} playerCount={members.length} onBack={onBack} />;
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* HUD */}
            <div className="px-3 py-2.5 border-b border-white/10 bg-black/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Palette size={15} className="text-accent shrink-0" />
                    <span className="text-xs font-semibold text-white/80 truncate">
                        Round {state.round}/{state.totalRounds}
                    </span>
                </div>
                {state.status === 'drawing' && (
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-white bg-white/10 rounded-lg px-2 py-1">
                        <Timer size={12} className={game.msLeft < 15000 ? 'text-red-400' : 'text-white/60'} />
                        {Math.ceil(game.msLeft / 1000)}s
                    </div>
                )}
                <button onClick={game.endGame} className="text-[10px] text-white/40 hover:text-red-300 shrink-0">End</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-3">
                {state.status === 'choosing' && <Choosing game={game} />}
                {(state.status === 'drawing') && <Playing game={game} roomCode={roomCode} clientId={clientId} />}
                {state.status === 'roundEnd' && <Reveal game={game} />}
                {state.status === 'gameEnd' && <GameOver game={game} clientId={clientId} />}

                <Leaderboard game={game} clientId={clientId} />
            </div>

            {state.status === 'drawing' && !game.isDrawer && <GuessBar game={game} />}
        </div>
    );
}

/* ── Lobby ── */
function Lobby({ game, playerCount, onBack }: { game: GameHook; playerCount: number; onBack: () => void }) {
    const [rounds, setRounds] = useState(6);
    const [drawTime, setDrawTime] = useState(80);
    const finished = game.state?.status === 'gameEnd';
    return (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center relative">
            <button onClick={onBack} className="absolute top-3 left-3 text-white/50 hover:text-white flex items-center gap-1 text-xs"><ArrowLeft size={14} /> Games</button>
            <div className="w-16 h-16 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center">
                <Palette size={30} className="text-accent" />
            </div>
            <div>
                <h3 className="text-lg font-bold text-white">Doodle &amp; Guess</h3>
                <p className="text-xs text-white/50 mt-1 max-w-xs">One person draws, everyone races to guess. Fastest correct guess wins the most points.</p>
            </div>

            <div className="w-full max-w-xs space-y-2.5">
                <label className="flex items-center justify-between text-xs text-white/60">
                    <span>Rounds</span>
                    <select value={rounds} onChange={e => setRounds(+e.target.value)} className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-white text-xs">
                        {[4, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <label className="flex items-center justify-between text-xs text-white/60">
                    <span>Draw time</span>
                    <select value={drawTime} onChange={e => setDrawTime(+e.target.value)} className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-white text-xs">
                        {[60, 80, 100, 120].map(n => <option key={n} value={n}>{n}s</option>)}
                    </select>
                </label>
            </div>

            <button
                onClick={() => game.start({ totalRounds: rounds, drawTimeSec: drawTime })}
                disabled={playerCount < 2}
                className="w-full max-w-xs bg-accent hover:bg-accent/90 disabled:opacity-40 text-white font-semibold rounded-xl py-3 transition-colors"
            >
                {finished ? 'Play again' : 'Start game'}
            </button>
            <p className="text-[11px] text-white/40 flex items-center gap-1.5">
                <Users size={12} /> {playerCount} in room {playerCount < 2 && '· need 2+ to start'}
            </p>
        </div>
    );
}

/* ── Choosing a word ── */
function Choosing({ game }: { game: GameHook }) {
    const { state } = game;
    if (game.isDrawer) {
        return (
            <div className="text-center space-y-3 py-4">
                <p className="text-sm text-white/70">You&apos;re drawing! Pick a word:</p>
                <div className="flex flex-col gap-2">
                    {(game.wordChoices ?? []).map(w => (
                        <button key={w} onClick={() => game.pickWord(w)}
                            className="bg-white/10 hover:bg-accent/30 border border-white/15 hover:border-accent/50 rounded-xl py-2.5 font-semibold text-white capitalize transition-colors">
                            {w}
                        </button>
                    ))}
                    {!game.wordChoices && <p className="text-xs text-white/40">Loading words…</p>}
                </div>
            </div>
        );
    }
    return (
        <div className="text-center py-8 text-sm text-white/60">
            <span className="font-semibold text-white">{state?.drawerNickname}</span> is choosing a word…
        </div>
    );
}

/* ── Drawing / guessing ── */
function Playing({ game, roomCode, clientId }: { game: GameHook; roomCode: string; clientId: string }) {
    const { state } = game;
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-center">
                {game.isDrawer ? (
                    <p className="text-sm">Draw: <span className="font-bold text-accent capitalize text-base">{game.word}</span></p>
                ) : (
                    <p className="font-mono tracking-[0.3em] text-lg text-white">
                        {state?.wordMask} <span className="text-[10px] text-white/40 tracking-normal">({state?.wordLength})</span>
                    </p>
                )}
            </div>
            <DrawCanvas roomCode={roomCode} clientId={clientId} canDraw={game.isDrawer} />
            <GuessFeed game={game} />
        </div>
    );
}

/* ── Guess feed ── */
function GuessFeed({ game }: { game: GameHook }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [game.feed.length]);
    return (
        <div ref={ref} className="max-h-32 overflow-y-auto space-y-1 text-xs">
            {game.feed.slice(-40).map(m => (
                <p key={m.id} className={
                    m.kind === 'correct' ? 'text-emerald-400 font-semibold' :
                    m.kind === 'system' ? 'text-white/40 italic' :
                    'text-white/70'
                }>
                    {m.kind === 'correct' ? `✅ ${m.nickname} guessed it!`
                        : m.kind === 'system' ? m.text
                        : <><span className="text-white/50">{m.nickname}:</span> {m.text}</>}
                </p>
            ))}
        </div>
    );
}

/* ── Guess input (fixed at bottom) ── */
function GuessBar({ game }: { game: GameHook }) {
    const [text, setText] = useState('');
    const [hint, setHint] = useState<string | null>(null);
    const alreadyCorrect = game.state?.correctGuessers.includes(useRoomStore.getState().selfClientId);

    const send = async () => {
        const t = text.trim();
        if (!t) return;
        setText('');
        const r = await game.guess(t);
        if (r.correct) setHint('🎉 Correct!');
        else if (r.close) setHint('So close!');
        else setHint(null);
        setTimeout(() => setHint(null), 1500);
    };

    if (alreadyCorrect) return <div className="p-3 border-t border-white/10 text-center text-xs text-emerald-400 font-semibold">You got it! 🎉 Waiting for the round to end…</div>;
    return (
        <div className="p-3 border-t border-white/10">
            {hint && <p className="text-[11px] text-center mb-1 text-amber-300">{hint}</p>}
            <div className="flex gap-2">
                <input
                    value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Type your guess…" maxLength={60}
                    className="flex-1 bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white"
                />
                <button onClick={send} className="bg-accent hover:bg-accent/90 text-white rounded-xl px-4"><SendHorizonal size={16} /></button>
            </div>
        </div>
    );
}

/* ── Round reveal ── */
function Reveal({ game }: { game: GameHook }) {
    return (
        <div className="text-center py-6 space-y-2">
            <p className="text-xs text-white/50">The word was</p>
            <p className="text-2xl font-bold text-accent capitalize">{game.state?.revealedWord}</p>
            <p className="text-xs text-white/50">{game.state?.correctGuessers.length ?? 0} guessed it · next round starting…</p>
        </div>
    );
}

/* ── Game over ── */
function GameOver({ game, clientId }: { game: GameHook; clientId: string }) {
    const winner = game.state?.players[0];
    return (
        <div className="text-center py-4 space-y-2">
            <Trophy size={32} className="mx-auto text-amber-400" />
            <p className="text-lg font-bold text-white">Game over!</p>
            {winner && <p className="text-sm text-white/70">🏆 <span className="font-semibold capitalize">{winner.nickname}</span> wins with {winner.score} pts</p>}
            <button onClick={() => game.start()} className="mt-2 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl px-5 py-2 text-sm">Play again</button>
            <span className="sr-only">{clientId}</span>
        </div>
    );
}

/* ── Leaderboard ── */
function Leaderboard({ game, clientId }: { game: GameHook; clientId: string }) {
    const players = game.state?.players ?? [];
    if (!players.length) return null;
    return (
        <div className="glass rounded-2xl p-3 border-white/10">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 flex items-center gap-1.5"><Trophy size={11} /> Leaderboard</p>
            <div className="space-y-1">
                {players.map((p, i) => (
                    <div key={p.clientId} className={`flex items-center gap-2 text-sm ${p.clientId === clientId ? 'text-white font-semibold' : 'text-white/70'}`}>
                        <span className="w-4 text-center text-xs text-white/40">{i + 1}</span>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: avatarColorFor(p.clientId) }}>
                            {p.nickname.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate">{p.nickname}{p.clientId === game.state?.drawerClientId && <Crown size={11} className="inline ml-1 text-amber-300" />}</span>
                        <span className="font-mono text-xs">{p.score}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
