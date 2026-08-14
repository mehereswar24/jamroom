/**
 * gameStore — Pictionary state in Upstash Redis (one JSON blob per room).
 * The secret `word`/`wordChoices` live here but are stripped by publicState()
 * before anything is broadcast.
 */

import { getRedis, ROOM_TTL_SECONDS } from './redis';
import {
    DEFAULT_DRAW_TIME, DEFAULT_ROUNDS, DRAWER_PER_GUESSER, GamePlayer, PublicGameState,
    maskFor, normalizeGuess, levenshtein, pickWordChoices, scoreForGuess
} from '../../lib/game';

export interface GameStateInternal {
    status: PublicGameState['status'];
    round: number;
    totalRounds: number;
    drawTimeSec: number;
    turnOrder: string[];
    drawerClientId: string | null;
    word: string | null;
    wordChoices: string[] | null;
    roundEndsAt: number | null;
    correctGuessers: string[];
    roundToken: number;
    revealedWord: string | null;
    scores: Record<string, number>;
    names: Record<string, string>;
}

const key = (code: string) => `jr:${code}:game`;

async function save(code: string, g: GameStateInternal): Promise<void> {
    await getRedis().set(key(code), g, { ex: ROOM_TTL_SECONDS });
}

export async function getGame(code: string): Promise<GameStateInternal | null> {
    return (await getRedis().get<GameStateInternal>(key(code))) ?? null;
}

function playersOf(g: GameStateInternal): GamePlayer[] {
    const ids = new Set([...Object.keys(g.scores), ...Object.keys(g.names), ...g.turnOrder]);
    return [...ids]
        .map(clientId => ({ clientId, nickname: g.names[clientId] ?? 'Guest', score: g.scores[clientId] ?? 0 }))
        .sort((a, b) => b.score - a.score);
}

/** Broadcast-safe view — never includes the word or the choices. */
export function publicState(g: GameStateInternal): PublicGameState {
    return {
        status: g.status,
        round: g.round,
        totalRounds: g.totalRounds,
        drawTimeSec: g.drawTimeSec,
        drawerClientId: g.drawerClientId,
        drawerNickname: g.drawerClientId ? (g.names[g.drawerClientId] ?? 'Guest') : null,
        wordMask: g.word ? maskFor(g.word) : '',
        wordLength: g.word ? g.word.replace(/ /g, '').length : 0,
        roundEndsAt: g.roundEndsAt,
        correctGuessers: g.correctGuessers,
        roundToken: g.roundToken,
        revealedWord: g.status === 'roundEnd' || g.status === 'gameEnd' ? g.revealedWord : null,
        players: playersOf(g),
    };
}

function rememberNames(g: GameStateInternal, names: Record<string, string>): void {
    for (const [id, n] of Object.entries(names)) if (n) g.names[id] = n.slice(0, 24);
}

function beginChoosing(g: GameStateInternal): void {
    const idx = (g.round - 1) % g.turnOrder.length;
    g.drawerClientId = g.turnOrder[idx] ?? null;
    g.status = 'choosing';
    g.word = null;
    g.revealedWord = null;
    g.roundEndsAt = null;
    g.correctGuessers = [];
    g.wordChoices = pickWordChoices(Math.random, 3);
    g.roundToken += 1;
}

export async function startGame(code: string, opts: {
    turnOrder: string[]; names: Record<string, string>; totalRounds?: number; drawTimeSec?: number;
}): Promise<GameStateInternal | null> {
    if (opts.turnOrder.length < 2) return null;   // need at least 2 players
    const g: GameStateInternal = {
        status: 'choosing', round: 1,
        totalRounds: Math.max(2, Math.min(20, opts.totalRounds ?? DEFAULT_ROUNDS)),
        drawTimeSec: Math.max(30, Math.min(180, opts.drawTimeSec ?? DEFAULT_DRAW_TIME)),
        turnOrder: opts.turnOrder,
        drawerClientId: opts.turnOrder[0], word: null, wordChoices: null,
        roundEndsAt: null, correctGuessers: [], roundToken: 0, revealedWord: null,
        scores: {}, names: {},
    };
    rememberNames(g, opts.names);
    beginChoosing(g);
    g.round = 1;   // beginChoosing bumped token but not round
    await save(code, g);
    return g;
}

export async function pickWord(code: string, clientId: string, word: string): Promise<GameStateInternal | null> {
    const g = await getGame(code);
    if (!g || g.status !== 'choosing' || g.drawerClientId !== clientId) return null;
    if (!g.wordChoices?.includes(word)) return null;
    g.word = word;
    g.wordChoices = null;
    g.status = 'drawing';
    g.roundEndsAt = Date.now() + g.drawTimeSec * 1000;
    g.correctGuessers = [];
    await save(code, g);
    return g;
}

export interface GuessResult {
    game: GameStateInternal;
    correct: boolean;
    close: boolean;
    points: number;
    allGuessed: boolean;
}

export async function applyGuess(code: string, clientId: string, nickname: string, text: string): Promise<GuessResult | null> {
    const g = await getGame(code);
    if (!g || g.status !== 'drawing' || !g.word) return null;
    rememberNames(g, { [clientId]: nickname });
    if (clientId === g.drawerClientId || g.correctGuessers.includes(clientId)) {
        return { game: g, correct: false, close: false, points: 0, allGuessed: false };
    }
    const guess = normalizeGuess(text);
    const answer = normalizeGuess(g.word);
    if (guess === answer) {
        const remaining = (g.roundEndsAt ?? Date.now()) - Date.now();
        const points = scoreForGuess(remaining, g.drawTimeSec);
        g.scores[clientId] = (g.scores[clientId] ?? 0) + points;
        g.correctGuessers.push(clientId);
        const nonDrawers = g.turnOrder.filter(id => id !== g.drawerClientId);
        const allGuessed = nonDrawers.length > 0 && nonDrawers.every(id => g.correctGuessers.includes(id));
        await save(code, g);
        return { game: g, correct: true, close: false, points, allGuessed };
    }
    const close = answer.length > 3 && levenshtein(guess, answer) <= Math.max(1, Math.floor(answer.length / 6));
    await save(code, g);   // persist name
    return { game: g, correct: false, close, points: 0, allGuessed: false };
}

/** drawing → roundEnd: reveal word, award the drawer. Idempotent on roundToken. */
export async function advanceRound(code: string, roundToken: number): Promise<GameStateInternal | null> {
    const g = await getGame(code);
    if (!g || g.status !== 'drawing' || g.roundToken !== roundToken) return null;
    if (g.drawerClientId) {
        g.scores[g.drawerClientId] = (g.scores[g.drawerClientId] ?? 0) + DRAWER_PER_GUESSER * g.correctGuessers.length;
    }
    g.revealedWord = g.word;
    g.status = 'roundEnd';
    g.roundEndsAt = null;
    await save(code, g);
    return g;
}

/** roundEnd → next choosing (or gameEnd). Idempotent on roundToken. */
export async function nextRound(code: string, roundToken: number): Promise<GameStateInternal | null> {
    const g = await getGame(code);
    if (!g || g.status !== 'roundEnd' || g.roundToken !== roundToken) return null;
    if (g.round >= g.totalRounds) {
        g.status = 'gameEnd';
        g.drawerClientId = null;
        await save(code, g);
        return g;
    }
    g.round += 1;
    beginChoosing(g);
    await save(code, g);
    return g;
}

export async function endGame(code: string): Promise<GameStateInternal | null> {
    const g = await getGame(code);
    if (!g) return null;
    g.status = 'gameEnd';
    g.roundEndsAt = null;
    g.word = null; g.wordChoices = null;
    await save(code, g);
    return g;
}
