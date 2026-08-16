import type { BoardState, GameDef, MoveResult } from './types';
import { nextSeat } from './types';

const WORDS = ['guitar', 'rocket', 'penguin', 'volcano', 'diamond', 'library', 'octopus', 'compass',
    'jupiter', 'cactus', 'harmony', 'trumpet', 'glacier', 'lantern', 'network', 'pyramid',
    'blanket', 'thunder', 'whistle', 'meadow', 'voyage', 'anchor', 'orbit', 'saffron'];
const MAX_LIVES = 6;

export interface HangmanState {
    word: string;          // SECRET — stripped by redact() before broadcast
    masked: string;        // e.g. "_ a _ _"
    guessed: string[];
    wrong: string[];
    lives: number;
}

const mask = (word: string, guessed: string[]) =>
    word.split('').map(ch => (guessed.includes(ch) ? ch : '_')).join(' ');

export const HANGMAN: GameDef<HangmanState> = {
    id: 'hangman', name: 'Hangman', emoji: '🔤', min: 1, max: 6, dice: false, simultaneous: false,
    blurb: 'Guess the hidden word letter by letter before you run out of lives.',
    createState: () => {
        const word = WORDS[Math.floor(Math.random() * WORDS.length)];
        return { word, masked: mask(word, []), guessed: [], wrong: [], lives: MAX_LIVES };
    },
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    redact(board) {
        return { ...board, state: { ...board.state, word: '' } };
    },
    reduce(board, seat, action): MoveResult<HangmanState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const letter = String(action.letter ?? '').toLowerCase();
        if (!/^[a-z]$/.test(letter)) return { ok: false, error: 'Pick a letter' };
        const s = board.state;
        if (s.guessed.includes(letter)) return { ok: false, error: 'Already guessed' };

        const guessed = [...s.guessed, letter];
        const hit = s.word.includes(letter);
        const wrong = hit ? s.wrong : [...s.wrong, letter];
        const lives = hit ? s.lives : s.lives - 1;
        const masked = mask(s.word, guessed);
        const next: HangmanState = { ...s, guessed, wrong, lives, masked };

        if (!masked.includes('_')) return { ok: true, patch: { state: next, status: 'done', winnerSeat: seat } };
        if (lives <= 0) return { ok: true, patch: { state: { ...next, masked: s.word.split('').join(' ') }, status: 'done', winnerSeat: null, message: `Out of lives! The word was "${s.word}".` } };
        const turnSeat = hit ? seat : nextSeat(seat, board.players.length);   // correct → keep going
        return { ok: true, patch: { state: next, turnSeat, message: hit ? 'Nice — go again' : '' } };
    },
};
