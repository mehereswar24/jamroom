import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import * as store from '@/server/store/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight queue pull — clients call this after a `queue:updated` ping,
// since the full queue is too large to push through Ably.
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code } = await ctx.params;
    const queue = await store.listQueue(normalizeRoomCode(code));
    return NextResponse.json({ ok: true, queue });
}
