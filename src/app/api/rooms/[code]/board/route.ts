import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { getBoard } from '@/server/store/boardStore';
import { getGameDef } from '@/lib/games/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Current board on join/reconnect (secrets stripped via the game's redact()).
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code } = await ctx.params;
    const b = await getBoard(normalizeRoomCode(code));
    const def = b ? getGameDef(b.gameId) : null;
    return NextResponse.json({ ok: true, board: b && def?.redact ? def.redact(b) : b });
}
