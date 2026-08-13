import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness probe for hosting platforms (Railway/Render/Fly healthchecks).
export function GET() {
    return NextResponse.json({ ok: true, service: 'jamroom', ts: Date.now() });
}
