import { NextResponse } from 'next/server';
import { searchYouTube } from '@/server/youtube/search';

export const runtime = 'nodejs';

export async function GET(req: Request) {
    const q = new URL(req.url).searchParams.get('q')?.trim().slice(0, 120);
    if (!q) return NextResponse.json({ ok: false, error: 'Missing query', results: [] }, { status: 400 });
    try {
        const results = await searchYouTube(q, 8);
        return NextResponse.json({ ok: true, results });
    } catch (err) {
        console.error('[api/youtube/search] failed:', err);
        return NextResponse.json({ ok: false, error: 'YouTube search failed', results: [] }, { status: 502 });
    }
}
