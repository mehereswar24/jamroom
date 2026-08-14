/** Shared Pictionary types, scoring, and word list (client + server). */

export type GameStatus = 'idle' | 'choosing' | 'drawing' | 'roundEnd' | 'gameEnd';

/** Public game state — safe to broadcast. NEVER contains the secret word. */
export interface PublicGameState {
    status: GameStatus;
    round: number;
    totalRounds: number;
    drawTimeSec: number;
    drawerClientId: string | null;
    drawerNickname: string | null;
    wordMask: string;          // e.g. "_ _ _ _" (word length only)
    wordLength: number;
    roundEndsAt: number | null;
    correctGuessers: string[]; // clientIds who guessed it this round
    roundToken: number;
    revealedWord: string | null; // only set during 'roundEnd' / 'gameEnd'
    players: GamePlayer[];       // leaderboard (sorted desc)
}

export interface GamePlayer {
    clientId: string;
    nickname: string;
    score: number;
}

export interface Point { x: number; y: number }   // normalized 0..1

export interface StrokeMsg {
    pts: Point[];
    color: string;
    size: number;      // normalized (fraction of canvas width)
}

/** A game-feed line (guesses + system notices). */
export interface GameFeedMsg {
    id: number;
    clientId: string | null;
    nickname: string;
    kind: 'guess' | 'correct' | 'close' | 'system';
    text: string;      // empty for 'correct' (word stays secret)
}

/* ── scoring ── */
export const GUESS_BASE = 100;
export const GUESS_SPEED_BONUS = 150;   // × fraction of time remaining
export const DRAWER_PER_GUESSER = 50;
export const DEFAULT_ROUNDS = 6;
export const DEFAULT_DRAW_TIME = 80;    // seconds

export function scoreForGuess(msRemaining: number, drawTimeSec: number): number {
    const frac = Math.max(0, Math.min(1, msRemaining / (drawTimeSec * 1000)));
    return Math.round(GUESS_BASE + GUESS_SPEED_BONUS * frac);
}

export function maskFor(word: string): string {
    return word.split('').map(c => (c === ' ' ? '  ' : '_')).join(' ');
}

/** Normalize a guess/word for comparison. */
export function normalizeGuess(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance (small words) — for "so close!" hints. */
export function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
        let prev = dp[0]; dp[0] = j;
        for (let i = 1; i <= m; i++) {
            const tmp = dp[i];
            dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
            prev = tmp;
        }
    }
    return dp[m];
}

/** Word list, three difficulty tiers. Kept short but varied. */
export const WORDS = {
    easy: ['cat', 'dog', 'sun', 'tree', 'house', 'car', 'fish', 'star', 'apple', 'ball',
        'hat', 'book', 'moon', 'cloud', 'flower', 'boat', 'cake', 'clock', 'door', 'shoe',
        'key', 'cup', 'bird', 'heart', 'smile', 'pizza', 'snake', 'chair', 'phone', 'eye',
        'hand', 'foot', 'nose', 'egg', 'leaf', 'kite', 'drum', 'bell', 'frog', 'bee'],
    medium: ['guitar', 'rocket', 'castle', 'rainbow', 'penguin', 'camera', 'bridge', 'volcano',
        'dragon', 'robot', 'island', 'ladder', 'anchor', 'compass', 'lantern', 'igloo',
        'cactus', 'windmill', 'skeleton', 'umbrella', 'dolphin', 'tornado', 'pyramid',
        'scarecrow', 'telescope', 'mermaid', 'wizard', 'campfire', 'lighthouse', 'jellyfish',
        'butterfly', 'snowman', 'treasure', 'parachute', 'hammock', 'waterfall', 'fireworks',
        'sandcastle', 'astronaut', 'unicorn'],
    hard: ['procrastinate', 'gravity', 'photosynthesis', 'democracy', 'nightmare', 'invisible',
        'earthquake', 'metamorphosis', 'constellation', 'stethoscope', 'kaleidoscope',
        'hourglass', 'quicksand', 'labyrinth', 'chandelier', 'silhouette', 'avalanche',
        'hibernation', 'camouflage', 'thermometer', 'boomerang', 'escalator', 'gargoyle',
        'marionette', 'periscope', 'stalactite', 'wheelbarrow', 'xylophone', 'trampoline',
        'harmonica'],
} as const;

/** Pick n distinct random word choices across tiers (index-seeded for testability upstream). */
export function pickWordChoices(rng: () => number, n = 3): string[] {
    const pool = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
    const chosen = new Set<string>();
    while (chosen.size < n) chosen.add(pool[Math.floor(rng() * pool.length)]);
    return [...chosen];
}
