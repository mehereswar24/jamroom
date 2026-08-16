import type { GameDef, MoveResult } from './types';
import { nextSeat } from './types';

const EMOJIS = ['🍎', '🚀', '🐱', '🌈', '⭐', '🎸', '🍕', '👻', '🐙', '🔥', '🎲', '🦄'];
const PAIRS = 8;   // 16 cards

export interface MemoryState {
    cards: string[];            // emoji per card index
    matched: (number | null)[]; // owner seat per matched card, else null
    up: number[];               // indices face-up this turn (0..2)
    scores: number[];
}

export const MEMORY: GameDef<MemoryState> = {
    id: 'memory', name: 'Memory Match', emoji: '🃏', min: 2, max: 4, dice: false, simultaneous: false,
    blurb: 'Flip two cards to find pairs. Match to score and go again.',
    createState: (n) => {
        const deck = [...EMOJIS.slice(0, PAIRS), ...EMOJIS.slice(0, PAIRS)];
        for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        return { cards: deck, matched: Array(deck.length).fill(null), up: [], scores: Array(n).fill(0) };
    },
    startPatch: () => ({ turnSeat: 0, phase: 'play', message: '' }),
    // Hide face-down cards so players can't read the layout from the network.
    redact(board) {
        const s = board.state;
        const cards = s.cards.map((c, i) => (s.matched[i] != null || s.up.includes(i)) ? c : '');
        return { ...board, state: { ...s, cards } };
    },
    reduce(board, seat, action): MoveResult<MemoryState> {
        if (board.status !== 'playing') return { ok: false, error: 'Game over' };
        if (seat !== board.turnSeat) return { ok: false, error: 'Not your turn' };
        const i = Number(action.flip);
        const s: MemoryState = { ...board.state, matched: board.state.matched.slice(), up: board.state.up.slice(), scores: board.state.scores.slice() };

        // A leftover mismatched pair is cleared by the next flip.
        if (s.up.length === 2) s.up = [];
        if (!(i >= 0 && i < s.cards.length) || s.matched[i] !== null || s.up.includes(i)) return { ok: false, error: 'Bad card' };
        s.up.push(i);

        if (s.up.length < 2) return { ok: true, patch: { state: s } };

        const [a, b] = s.up;
        if (s.cards[a] === s.cards[b]) {
            s.matched[a] = seat; s.matched[b] = seat; s.scores[seat] += 1; s.up = [];
            if (s.matched.every(x => x !== null)) {
                const max = Math.max(...s.scores);
                const winners = s.scores.filter(x => x === max).length;
                return { ok: true, patch: { state: s, status: 'done', winnerSeat: winners === 1 ? s.scores.indexOf(max) : null, draw: winners > 1 } };
            }
            return { ok: true, patch: { state: s, message: 'Match! Go again.' } };   // same turn
        }
        // mismatch: leave both face-up, pass turn (cleared on next flip)
        return { ok: true, patch: { state: s, turnSeat: nextSeat(seat, board.players.length), message: 'No match' } };
    },
};
