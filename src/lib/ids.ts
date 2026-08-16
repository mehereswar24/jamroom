import { customAlphabet } from 'nanoid';

// No 0/O/1/I/L — codes get read aloud and typed on phones.
const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const ROOM_CODE_LENGTH = 6;

export const newRoomCode = customAlphabet(ROOM_ALPHABET, ROOM_CODE_LENGTH);

/** Normalize user-typed input into a room code, or '' if it cannot be one.
 *  Rejects rather than truncates: silently trimming a longer string would
 *  route the caller into a different, valid room. */
export function normalizeRoomCode(raw: string): string {
    const cleaned = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    return cleaned.length === ROOM_CODE_LENGTH ? cleaned : '';
}

const AVATAR_COLORS = [
    '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e'
];

/** Deterministic color from a clientId so the same person keeps their color. */
export function avatarColorFor(clientId: string): string {
    let h = 0;
    for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function formatDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
}
