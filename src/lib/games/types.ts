/** Shared turn-based board-game framework (client + server). */

export type BoardGameId = 'ttt' | 'connect4' | 'rps' | 'snakes' | 'ludo';

export interface Seat {
    clientId: string;
    nickname: string;
    seat: number;      // 0..n-1
}

export interface BoardState<S = unknown> {
    gameId: BoardGameId;
    status: 'waiting' | 'playing' | 'done';
    players: Seat[];
    hostClientId: string;
    turnSeat: number;              // whose turn (ignored for simultaneous games)
    state: S;                      // game-specific
    winnerSeat: number | null;
    draw: boolean;
    lastRoll: number | null;       // dice games
    phase: string;                 // e.g. ludo 'roll' | 'move'
    message: string;
    updatedAt: number;
}

export interface MoveResult<S = unknown> {
    ok: boolean;
    error?: string;
    /** Fields to merge into the board (state/turnSeat/winnerSeat/draw/lastRoll/status/phase/message). */
    patch?: Partial<BoardState<S>>;
}

export interface GameDef<S = unknown> {
    id: BoardGameId;
    name: string;
    emoji: string;
    min: number;
    max: number;
    dice: boolean;
    simultaneous: boolean;         // true = no turn order (e.g. RPS)
    blurb: string;
    createState(numPlayers: number): S;
    /** Board fields when the match starts (turnSeat/phase/message). */
    startPatch(board: BoardState<S>): Partial<BoardState<S>>;
    /** Validate + apply an action for `seat`; return a patch to merge. */
    reduce(board: BoardState<S>, seat: number, action: Record<string, unknown>): MoveResult<S>;
}

export const rng6 = () => 1 + Math.floor(Math.random() * 6);
export const nextSeat = (seat: number, n: number) => (seat + 1) % n;
