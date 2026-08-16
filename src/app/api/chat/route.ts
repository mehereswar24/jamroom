import { NextResponse } from 'next/server';
import { EV } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { publish } from '@/server/realtime/publish';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Persisted chat only. Typing indicators + emoji reactions are ephemeral and
// are published by clients straight to the Ably channel (no server round-trip).
export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, body } = auth;

        const limited = await rateLimit(`chat:${code}:${clientId}`, 20, 10);
        if (limited) return limited;

        const nickname = String(body?.nickname ?? 'Guest').slice(0, 24);
        const text = String(body?.body ?? '').trim().slice(0, 500);
        if (!text) return NextResponse.json({ ok: false, error: 'Empty message' }, { status: 400 });

        const msg = await store.addMessage(code, { clientId, nickname, type: 'chat', body: text });
        await publish(code, EV.chatMessage, { message: msg });
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[api/chat] failed:', err);
        return NextResponse.json({ ok: false, error: 'Send failed' }, { status: 500 });
    }
}
