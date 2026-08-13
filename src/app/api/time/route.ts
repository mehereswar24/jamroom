import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server clock for playback drift-correction offset.
export function GET() {
    return NextResponse.json({ t: Date.now() });
}
