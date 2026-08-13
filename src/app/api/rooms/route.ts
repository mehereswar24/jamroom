import { NextResponse } from 'next/server';
import { newRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const name = String(body?.name ?? 'Listening room').trim().slice(0, 60) || 'Listening room';
        const hostClientId = String(body?.clientId ?? '').trim().slice(0, 64);
        if (!hostClientId) return NextResponse.json({ ok: false, error: 'Missing clientId' }, { status: 400 });

        let code = newRoomCode();
        for (let i = 0; i < 10 && await store.roomExists(code); i++) code = newRoomCode();
        await store.createRoom(code, name, hostClientId);
        return NextResponse.json({ ok: true, code });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[api/rooms] create failed:', msg);
        return NextResponse.json({ ok: false, error: `Could not create room: ${msg}` }, { status: 500 });
    }
}
