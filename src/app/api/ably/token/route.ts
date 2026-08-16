import { NextResponse } from 'next/server';
import Ably from 'ably';
import { normalizeRoomCode } from '@/lib/ids';
import { roomCapability } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { getOrCreateIdentity, attachIdentity } from '@/server/auth/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mints a short-lived Ably token scoped to ONE room.
 *
 * This endpoint used to call createTokenRequest({ clientId }) with no
 * capability and no room code, so the token inherited the root key's full
 * wildcard capability: any anonymous caller could subscribe to every room's
 * channel, read all chat and presence, and publish forged hostChanged /
 * playbackSync events into rooms they had never joined. It also took clientId
 * straight from the query string, allowing impersonation in presence.
 *
 * Now: the room must exist, the capability is pinned to that room's two
 * channels, and clientId comes from the signed identity cookie.
 */
export async function GET(req: Request) {
    const key = process.env.ABLY_API_KEY;
    if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 });

    const code = normalizeRoomCode(new URL(req.url).searchParams.get('code') ?? '');
    if (!code) return NextResponse.json({ error: 'Room code required' }, { status: 400 });
    if (!(await store.roomExists(code))) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const { clientId, token, isNew } = await getOrCreateIdentity(code);

    const rest = new Ably.Rest({ key });
    try {
        const tokenRequest = await rest.auth.createTokenRequest({
            clientId,
            // Pinned to this room's channels only — see roomCapability().
            capability: roomCapability(code),
            ttl: 60 * 60 * 1000, // 1 hour
        });
        // Ably's SDK expects the bare token request object back from authUrl.
        const res = NextResponse.json(tokenRequest);
        return isNew ? attachIdentity(res, code, token) : res;
    } catch (err) {
        console.error('[api/ably/token] failed:', err);
        return NextResponse.json({ error: 'Could not create token' }, { status: 500 });
    }
}
