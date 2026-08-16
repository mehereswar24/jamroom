/**
 * Route-level helper: resolve the caller's room + verified clientId.
 *
 * Every mutating route goes through this instead of reading body.clientId,
 * which was attacker-controlled and made every permission check decorative.
 */

import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';
import type { RoomMeta } from '@/server/store/roomStore';
import { readIdentity } from './identity';

export interface AuthedRequest {
    code: string;
    clientId: string;
    meta: RoomMeta;
    body: Record<string, unknown>;
}

/**
 * Returns either the authenticated context, or a Response to return as-is.
 * Callers do: `const a = await authenticate(req); if ('status' in a) return a;`
 */
export async function authenticate(req: Request): Promise<AuthedRequest | NextResponse> {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = normalizeRoomCode(String(body?.code ?? ''));
    if (!code) {
        return NextResponse.json({ ok: false, error: 'Room code required' }, { status: 400 });
    }

    const meta = await store.getMeta(code);
    if (!meta) {
        return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });
    }

    const clientId = await readIdentity(code);
    if (!clientId) {
        return NextResponse.json(
            { ok: false, error: 'Join the room before acting in it' },
            { status: 401 }
        );
    }

    return { code, clientId, meta, body };
}

/** Narrowing helper so routes can tell the two outcomes apart. */
export function isResponse(x: AuthedRequest | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
