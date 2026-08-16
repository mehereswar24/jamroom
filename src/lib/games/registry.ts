import type { BoardGameId, GameDef } from './types';
import { TTT } from './ttt';
import { CONNECT4 } from './connect4';
import { RPS } from './rps';
import { SNAKES } from './snakes';
import { LUDO } from './ludo';
import { GOMOKU } from './gomoku';
import { REVERSI } from './reversi';
import { DOTS } from './dots';
import { MEMORY } from './memory';
import { HANGMAN } from './hangman';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAMES: Record<BoardGameId, GameDef<any>> = {
    ttt: TTT, connect4: CONNECT4, gomoku: GOMOKU, reversi: REVERSI, dots: DOTS,
    memory: MEMORY, rps: RPS, snakes: SNAKES, ludo: LUDO, hangman: HANGMAN,
};

export const GAME_LIST = Object.values(GAMES).map(g => ({
    id: g.id, name: g.name, emoji: g.emoji, min: g.min, max: g.max, blurb: g.blurb,
}));

export function getGameDef(id: string): GameDef | null {
    return (GAMES as Record<string, GameDef>)[id] ?? null;
}
