import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { getGame, publicState } from '@/server/store/gameStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Game snapshot on join/reconnect. The word + choices are returned ONLY to the
// current drawer (so guessers can never read them out of the network tab).
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { code } = await ctx.params;
    const g = await getGame(normalizeRoomCode(code));
    if (!g) return NextResponse.json({ ok: true, game: null });

    const clientId = new URL(req.url).searchParams.get('clientId')?.slice(0, 64) || '';
    const isDrawer = clientId === g.drawerClientId;
    return NextResponse.json({
        ok: true,
        game: publicState(g),
        // drawer-only secrets:
        word: isDrawer ? g.word : null,
        wordChoices: isDrawer && g.status === 'choosing' ? g.wordChoices : null,
    });
}
