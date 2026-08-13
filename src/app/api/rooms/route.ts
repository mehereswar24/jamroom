import { NextResponse } from 'next/server';
import { newRoomCode } from '@/lib/ids';
import { createRoom, getRoom } from '@/server/db/repos';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const name = String(body?.name ?? 'Listening room').trim().slice(0, 60) || 'Listening room';
        const hostClientId = String(body?.clientId ?? '').trim().slice(0, 64);
        if (!hostClientId) return NextResponse.json({ ok: false, error: 'Missing clientId' }, { status: 400 });

        let code = newRoomCode();
        let attempts = 0;
        while (attempts < 10 && getRoom(code)) {
            code = newRoomCode();
            attempts++;
        }
        createRoom(code, name, hostClientId);
        return NextResponse.json({ ok: true, code });
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[api/rooms] create failed:', errorMsg);
        return NextResponse.json({ ok: false, error: `Could not create room: ${errorMsg}` }, { status: 500 });
    }
}
