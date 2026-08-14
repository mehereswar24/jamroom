import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { getBoard } from '@/server/store/boardStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Current board on join/reconnect.
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code } = await ctx.params;
    return NextResponse.json({ ok: true, board: await getBoard(normalizeRoomCode(code)) });
}
