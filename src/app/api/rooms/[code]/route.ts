import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { getRoom } from '@/server/db/repos';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code } = await ctx.params;
    const room = getRoom(normalizeRoomCode(code));
    if (!room) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });
    return NextResponse.json({ ok: true, code: room.id, name: room.name });
}
