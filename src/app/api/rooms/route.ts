import { NextResponse } from 'next/server';
import { newRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';
import { mintToken, attachIdentity } from '@/server/auth/identity';
import { rateLimit, clientAddress } from '@/server/rateLimit';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        // Unauthenticated by nature — creating a room is how you get an
        // identity — so limit by address.
        const limited = await rateLimit(`create:${clientAddress(req)}`, 10, 3600);
        if (limited) return limited;

        const body = await req.json().catch(() => ({}));
        const name = String(body?.name ?? 'Listening room').trim().slice(0, 60) || 'Listening room';

        // The creator's id is minted server-side; it is never taken from the
        // request, so nobody can create a room already owned by someone else.
        const hostClientId = randomUUID();

        let code = newRoomCode();
        for (let i = 0; i < 10 && await store.roomExists(code); i++) code = newRoomCode();
        await store.createRoom(code, name, hostClientId);

        const res = NextResponse.json({ ok: true, code, clientId: hostClientId });
        return attachIdentity(res, code, mintToken(hostClientId, code));
    } catch (err) {
        // Detail to the log, not the caller: this used to return the raw
        // exception message, exposing Upstash/Redis internals.
        console.error('[api/rooms] create failed:', err);
        return NextResponse.json(
            { ok: false, error: 'Could not create room. Please try again.' },
            { status: 500 }
        );
    }
}
