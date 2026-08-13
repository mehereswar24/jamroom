import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';
import { getPresence } from '@/server/realtime/presence';
import { voteSkipState } from '@/server/actions';
import type { RoomSnapshot } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Full room snapshot for a client that just (re)joined.
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code: raw } = await ctx.params;
    const code = normalizeRoomCode(raw);
    const meta = await store.getMeta(code);
    if (!meta) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });

    const clientId = new URL(req.url).searchParams.get('clientId')?.slice(0, 64) || '';
    const [queue, messages, members, vote] = await Promise.all([
        store.listQueue(code), store.recentMessages(code), getPresence(code), voteSkipState(code)
    ]);
    await store.touch(code);

    const snapshot: RoomSnapshot = {
        roomCode: code,
        roomName: meta.name,
        hostClientId: meta.hostClientId,
        guestControls: meta.guestControls,
        self: { clientId },
        members,
        queue,
        playback: meta.playback,
        messages,
        voteSkip: vote,
        serverTime: Date.now()
    };
    return NextResponse.json({ ok: true, snapshot });
}
