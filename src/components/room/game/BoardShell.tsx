'use client';

import { useState } from 'react';
import { ArrowLeft, Crown, Dices, RotateCcw, Users } from 'lucide-react';
import type { BoardHook } from '@/hooks/useBoardGame';
import type { BoardState } from '@/lib/games/types';
import { getGameDef } from '@/lib/games/registry';
import type { TttState } from '@/lib/games/ttt';
import { C4_COLS, C4_ROWS, type C4State } from '@/lib/games/connect4';
import type { RpsState, Throw } from '@/lib/games/rps';
import type { SnakesState } from '@/lib/games/snakes';
import { FINISH, LUDO_MAIN, ludoAbsolute, type LudoState } from '@/lib/games/ludo';

export const SEAT_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308'];

export default function BoardShell({ board, clientId, onBack }: { board: BoardHook; clientId: string; onBack: () => void }) {
    const b = board.board!;
    const def = getGameDef(b.gameId);
    const isHost = b.hostClientId === clientId;
    const me = b.players.find(p => p.clientId === clientId);
    const inGame = !!me;

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-white/10 bg-black/40 flex items-center justify-between gap-2">
                <button onClick={onBack} className="text-white/50 hover:text-white flex items-center gap-1 text-xs"><ArrowLeft size={14} /> Games</button>
                <span className="text-sm font-semibold text-white">{def?.emoji} {def?.name}</span>
                {isHost && b.status !== 'waiting'
                    ? <button onClick={board.restart} className="text-white/50 hover:text-white flex items-center gap-1 text-xs"><RotateCcw size={13} /> Restart</button>
                    : <span className="w-12" />}
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-0">
                {/* players */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                    {b.players.map(p => (
                        <div key={p.clientId} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${b.status === 'playing' && b.turnSeat === p.seat ? 'bg-white/15 ring-1 ring-white/40' : 'bg-white/5'}`}>
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SEAT_COLORS[p.seat] }} />
                            <span className="text-white/90">{p.nickname}{p.clientId === clientId && ' (you)'}</span>
                            {b.winnerSeat === p.seat && <Crown size={12} className="text-amber-300" />}
                        </div>
                    ))}
                </div>

                {b.status === 'waiting' && (
                    <Waiting board={board} inGame={inGame} isHost={isHost} minPlayers={def?.min ?? 2} />
                )}
                {b.message && b.status === 'playing' && <p className="text-center text-xs text-amber-300 mb-2">{b.message}</p>}

                {b.status !== 'waiting' && (
                    <>
                        {b.gameId === 'ttt' && <TicTacToe board={board} />}
                        {b.gameId === 'connect4' && <Connect4 board={board} />}
                        {b.gameId === 'rps' && <Rps board={board} clientId={clientId} />}
                        {b.gameId === 'snakes' && <Snakes board={board} />}
                        {b.gameId === 'ludo' && <Ludo board={board} />}
                    </>
                )}

                {b.status === 'done' && <Result board={b} clientId={clientId} isHost={isHost} onRestart={board.restart} />}
            </div>
        </div>
    );
}

function Waiting({ board, inGame, isHost, minPlayers }: { board: BoardHook; inGame: boolean; isHost: boolean; minPlayers: number }) {
    const b = board.board!;
    const def = getGameDef(b.gameId)!;
    return (
        <div className="text-center py-6 space-y-3">
            <p className="text-sm text-white/70 flex items-center justify-center gap-1.5"><Users size={14} /> {b.players.length}/{def.max} joined · need {minPlayers}+</p>
            {!inGame && b.players.length < def.max && (
                <button onClick={board.join} className="bg-accent hover:bg-accent/90 text-white rounded-xl px-5 py-2 text-sm font-semibold">Join game</button>
            )}
            {isHost && (
                <button onClick={board.start} disabled={b.players.length < minPlayers}
                    className="block mx-auto bg-white text-black hover:bg-slate-200 disabled:opacity-40 rounded-xl px-6 py-2.5 text-sm font-bold">Start</button>
            )}
            {!isHost && inGame && <p className="text-xs text-white/40">Waiting for the host to start…</p>}
        </div>
    );
}

function Result({ board, clientId, isHost, onRestart }: { board: BoardState; clientId: string; isHost: boolean; onRestart: () => void }) {
    const winner = board.winnerSeat != null ? board.players.find(p => p.seat === board.winnerSeat) : null;
    return (
        <div className="text-center py-4 mt-3 border-t border-white/10 space-y-2">
            {board.draw ? <p className="text-lg font-bold text-white/80">It&apos;s a draw!</p>
                : <p className="text-lg font-bold text-white">🏆 {winner?.nickname}{winner?.clientId === clientId && ' (you)'} wins!</p>}
            {isHost && <button onClick={onRestart} className="bg-accent hover:bg-accent/90 text-white rounded-xl px-5 py-2 text-sm font-semibold">Play again</button>}
        </div>
    );
}

/* ── Tic-Tac-Toe ── */
function TicTacToe({ board }: { board: BoardHook }) {
    const b = board.board! as BoardState<TttState>;
    const mark = (seat: number | null) => seat == null ? '' : seat === 0 ? '✕' : '◯';
    return (
        <div className="grid grid-cols-3 gap-1.5 max-w-[240px] mx-auto">
            {b.state.cells.map((c, i) => (
                <button key={i} disabled={!board.isMyTurn || c !== null || b.status !== 'playing'}
                    onClick={() => board.move({ cell: i })}
                    className="aspect-square rounded-xl bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5 border border-white/10 text-3xl font-bold flex items-center justify-center"
                    style={{ color: c === 0 ? SEAT_COLORS[0] : SEAT_COLORS[1] }}>
                    {mark(c)}
                </button>
            ))}
        </div>
    );
}

/* ── Connect 4 ── */
function Connect4({ board }: { board: BoardHook }) {
    const b = board.board! as BoardState<C4State>;
    return (
        <div className="max-w-[300px] mx-auto">
            <div className="grid grid-cols-7 gap-1 bg-blue-900/40 p-1.5 rounded-xl">
                {Array.from({ length: C4_ROWS * C4_COLS }, (_, i) => {
                    const v = b.state.grid[i];
                    return <div key={i} className="aspect-square rounded-full bg-black/40 flex items-center justify-center">
                        {v != null && <span className="w-[80%] h-[80%] rounded-full" style={{ backgroundColor: SEAT_COLORS[v] }} />}
                    </div>;
                })}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-1">
                {Array.from({ length: C4_COLS }, (_, c) => (
                    <button key={c} disabled={!board.isMyTurn || b.status !== 'playing'} onClick={() => board.move({ col: c })}
                        className="py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-xs text-white">▼</button>
                ))}
            </div>
        </div>
    );
}

/* ── Rock Paper Scissors ── */
function Rps({ board, clientId }: { board: BoardHook; clientId: string }) {
    const b = board.board! as BoardState<RpsState>;
    const seat = b.players.find(p => p.clientId === clientId)?.seat ?? -1;
    const myThrow = seat >= 0 ? b.state.throws[seat] : null;
    const icons: Record<Throw, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
    const last = b.state.lastRound;
    return (
        <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-6 text-sm">
                {b.players.map(p => (
                    <div key={p.clientId}>
                        <div className="text-2xl font-bold" style={{ color: SEAT_COLORS[p.seat] }}>{b.state.scores[p.seat]}</div>
                        <div className="text-white/60 text-xs">{p.nickname}</div>
                    </div>
                ))}
            </div>
            {last && <p className="text-xs text-white/60">Last: {icons[last.throws[0]]} vs {icons[last.throws[1]]} — {last.winnerSeat == null ? 'tie' : `${b.players.find(p => p.seat === last.winnerSeat)?.nickname} won`}</p>}
            {seat < 0 ? <p className="text-xs text-white/40">Spectating</p> : b.status !== 'playing' ? null : myThrow
                ? <p className="text-sm text-white/70">You threw {icons[myThrow]} — waiting…</p>
                : <div className="flex items-center justify-center gap-3">
                    {(['rock', 'paper', 'scissors'] as Throw[]).map(t => (
                        <button key={t} onClick={() => board.move({ throw: t })} className="text-4xl hover:scale-125 transition-transform">{icons[t]}</button>
                    ))}
                </div>}
            <p className="text-[11px] text-white/40">First to {b.state.target} wins</p>
        </div>
    );
}

/* ── Snakes & Ladders ── */
function Snakes({ board }: { board: BoardHook }) {
    const b = board.board! as BoardState<SnakesState>;
    // 10x10 boustrophedon, 100 at top-left
    const cells: number[] = [];
    for (let row = 9; row >= 0; row--) {
        const base = row * 10;
        const nums = Array.from({ length: 10 }, (_, i) => base + i + 1);
        cells.push(...(row % 2 === 0 ? nums : nums.reverse()));
    }
    const tokensAt = (n: number) => b.players.filter(p => b.state.pos[p.seat] === n);
    return (
        <div className="max-w-[320px] mx-auto space-y-2">
            <div className="grid grid-cols-10 gap-px bg-white/10 p-px rounded-lg overflow-hidden text-[7px]">
                {cells.map(n => {
                    const toks = tokensAt(n);
                    const isJump = (n in ({ 1: 1, 4: 1, 9: 1, 21: 1, 28: 1, 36: 1, 51: 1, 71: 1, 80: 1 } as Record<number, number>));
                    return <div key={n} className={`aspect-square flex items-center justify-center relative ${isJump ? 'bg-emerald-500/20' : 'bg-black/40'}`}>
                        <span className="text-white/30 absolute top-0 left-0.5">{n}</span>
                        <div className="flex flex-wrap gap-px">{toks.map(t => <span key={t.seat} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SEAT_COLORS[t.seat] }} />)}</div>
                    </div>;
                })}
            </div>
            <div className="flex items-center justify-center gap-3">
                {b.lastRoll != null && <span className="flex items-center gap-1 text-sm text-white/80"><Dices size={16} /> {b.lastRoll}</span>}
                <button disabled={!board.isMyTurn || b.status !== 'playing'} onClick={() => board.move({ type: 'roll' })}
                    className="bg-accent hover:bg-accent/90 disabled:opacity-30 text-white rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-1.5"><Dices size={16} /> Roll</button>
            </div>
        </div>
    );
}

/* ── Ludo ── */
function Ludo({ board }: { board: BoardHook }) {
    const b = board.board! as BoardState<LudoState>;
    // shared loop cells with tokens on them
    const loop: { seat: number; token: number }[][] = Array.from({ length: LUDO_MAIN }, () => []);
    b.state.tokens.forEach((toks, seat) => toks.forEach((rel, token) => {
        const abs = ludoAbsolute(seat, rel);
        if (abs != null) loop[abs].push({ seat, token });
    }));
    const legalForMe = (): number[] => {
        if (!board.isMyTurn || b.phase !== 'move' || b.lastRoll == null) return [];
        const seat = board.mySeat!;
        const roll = b.lastRoll;
        return b.state.tokens[seat].map((rel, t) => ({ rel, t }))
            .filter(({ rel }) => rel === -1 ? roll === 6 : rel !== FINISH && rel + roll <= FINISH)
            .map(({ t }) => t);
    };
    const legal = legalForMe();

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-[repeat(13,1fr)] gap-px bg-white/10 p-px rounded-lg">
                {loop.map((toks, i) => (
                    <div key={i} className="aspect-square bg-black/40 flex items-center justify-center flex-wrap gap-px relative">
                        {[0, 8, 13, 21, 26, 34, 39, 47].includes(i) && <span className="absolute inset-0 bg-white/5" />}
                        {toks.map((tk, j) => <span key={j} className="w-1.5 h-1.5 rounded-full relative" style={{ backgroundColor: SEAT_COLORS[tk.seat] }} />)}
                    </div>
                ))}
            </div>

            {/* per-player token status */}
            <div className="space-y-1.5">
                {b.players.map(p => (
                    <div key={p.clientId} className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: SEAT_COLORS[p.seat] }} />
                        <span className="text-xs text-white/70 w-16 truncate">{p.nickname}</span>
                        <div className="flex gap-1.5">
                            {b.state.tokens[p.seat].map((rel, t) => {
                                const clickable = p.seat === board.mySeat && legal.includes(t);
                                const label = rel === -1 ? '🏠' : rel === FINISH ? '✓' : rel > 50 ? `h${rel - 50}` : `${rel}`;
                                return <button key={t} disabled={!clickable} onClick={() => board.move({ type: 'move', token: t })}
                                    className={`min-w-6 h-6 px-1 rounded text-[10px] font-mono ${clickable ? 'bg-accent text-white ring-1 ring-white' : 'bg-white/10 text-white/60'}`}>{label}</button>;
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-center gap-3">
                {b.lastRoll != null && <span className="flex items-center gap-1 text-sm text-white/80"><Dices size={16} /> {b.lastRoll}</span>}
                <button disabled={!board.isMyTurn || b.phase !== 'roll' || b.status !== 'playing'} onClick={() => board.move({ type: 'roll' })}
                    className="bg-accent hover:bg-accent/90 disabled:opacity-30 text-white rounded-xl px-5 py-2 text-sm font-semibold flex items-center gap-1.5"><Dices size={16} /> Roll</button>
            </div>
        </div>
    );
}
