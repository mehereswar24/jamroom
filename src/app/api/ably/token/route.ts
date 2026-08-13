import { NextResponse } from 'next/server';
import Ably from 'ably';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mints a short-lived Ably token for a client (keeps ABLY_API_KEY server-side).
export async function GET(req: Request) {
    const key = process.env.ABLY_API_KEY;
    if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 });

    const clientId = new URL(req.url).searchParams.get('clientId')?.slice(0, 64) || 'anon';
    const rest = new Ably.Rest({ key });
    try {
        const tokenRequest = await rest.auth.createTokenRequest({ clientId });
        return NextResponse.json(tokenRequest);
    } catch (err) {
        console.error('[api/ably/token] failed:', err);
        return NextResponse.json({ error: 'Could not create token' }, { status: 500 });
    }
}
