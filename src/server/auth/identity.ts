/**
 * Room identity — a signed, httpOnly cookie that binds a clientId to a room.
 *
 * Previously every authorization check compared `meta.hostClientId` against a
 * `clientId` field read straight out of the request body. That value is just a
 * localStorage UUID, and the host's id is broadcast to every member via the
 * `hostChanged` event and presence — so any guest could replay it and take
 * over the room. Identity has to come from something the client cannot choose.
 *
 * No user accounts involved: the server mints an opaque id, signs it together
 * with the room code and an expiry, and stores it in an httpOnly cookie. The
 * client never sees or sets its own id.
 */

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';

const COOKIE_PREFIX = 'jr_id_';
const TTL_SECONDS = 60 * 60 * 24; // rooms expire well before this

function secret(): string {
    const s = process.env.ROOM_IDENTITY_SECRET;
    if (!s || s.length < 32) {
        throw new Error(
            'ROOM_IDENTITY_SECRET is missing or too short (need >= 32 chars). ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    return s;
}

function b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
    return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
}

export interface Identity {
    clientId: string;
    code: string;
    exp: number;
}

/** Build a signed token binding a clientId to one room. */
export function mintToken(clientId: string, code: string): string {
    const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const body = b64url(JSON.stringify({ clientId, code, exp } satisfies Identity));
    return `${body}.${sign(body)}`;
}

/** Verify a token and return its identity, or null if it fails any check. */
export function verifyToken(token: string | undefined, code: string): Identity | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;

    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    if (!safeEqual(mac, sign(body))) return null;

    let parsed: Identity;
    try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }

    if (typeof parsed.clientId !== 'string' || typeof parsed.code !== 'string') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    // A token minted for one room must never authorize action in another.
    if (parsed.code !== code) return null;
    return parsed;
}

const cookieName = (code: string) => `${COOKIE_PREFIX}${code}`;

/**
 * Read the caller's identity for a room, minting one if they have none.
 * Returns the clientId plus whether it was newly issued (so the route can
 * decide to set the cookie on the response).
 */
export async function getOrCreateIdentity(
    code: string
): Promise<{ clientId: string; token: string; isNew: boolean }> {
    const jar = await cookies();
    const existing = verifyToken(jar.get(cookieName(code))?.value, code);
    if (existing) {
        return { clientId: existing.clientId, token: jar.get(cookieName(code))!.value, isNew: false };
    }
    const clientId = randomUUID();
    return { clientId, token: mintToken(clientId, code), isNew: true };
}

/** Read the caller's identity for a room, or null when they have none. */
export async function readIdentity(code: string): Promise<string | null> {
    const jar = await cookies();
    return verifyToken(jar.get(cookieName(code))?.value, code)?.clientId ?? null;
}

/** Attach an identity cookie to a response. */
export function attachIdentity(res: Response, code: string, token: string): Response {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.headers.append(
        'Set-Cookie',
        `${cookieName(code)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure}`
    );
    return res;
}

export { cookieName };
