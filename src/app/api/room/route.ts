import { NextResponse } from 'next/server';
import { EV } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { getPresence } from '@/server/realtime/presence';
import { publish } from '@/server/realtime/publish';
import { systemMessage } from '@/server/actions';
import { authenticate, isResponse } from '@/server/auth/requireIdentity';
import { rateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How long the host must be absent from presence before another member can
// claim the room, so a brief disconnect cannot be raced.
const HOST_CLAIM_GRACE_MS = 15_000;

export async function POST(req: Request) {
    try {
        const auth = await authenticate(req);
        if (isResponse(auth)) return auth;
        const { code, clientId, meta, body } = auth;

        const limited = await rateLimit(`room:${code}:${clientId}`, 30, 60);
        if (limited) return limited;

        const action = String(body?.action ?? '');

        const publishHost = async (hostClientId: string, nick: string) => {
            await publish(code, EV.hostChanged, { hostClientId });
            await systemMessage(code, `${nick} is now the host`);
        };

        switch (action) {
            case 'setGuestControls': {
                if (meta.hostClientId !== clientId) return NextResponse.json({ ok: false, error: 'Host only' }, { status: 403 });
                const enabled = !!body?.enabled;
                await store.setGuestControls(code, enabled);
                await publish(code, EV.guestControls, { enabled });
                await systemMessage(code, `Guest controls ${enabled ? 'enabled' : 'disabled'}`);
                return NextResponse.json({ ok: true });
            }
            case 'transferHost': {
                if (meta.hostClientId !== clientId) return NextResponse.json({ ok: false, error: 'Host only' }, { status: 403 });
                const target = String(body?.targetClientId ?? '').slice(0, 64);
                const present = await getPresence(code);
                const t = present.find(m => m.clientId === target);
                if (!t) return NextResponse.json({ ok: false, error: 'That member is not connected' }, { status: 400 });
                await store.setHost(code, target);
                await publishHost(target, t.nickname);
                return NextResponse.json({ ok: true });
            }
            case 'claimHost': {
                // A client claims host when it believes the current host has left.
                // Server verifies the host is actually absent, then grants it.
                const present = await getPresence(code);
                if (present.some(m => m.clientId === meta.hostClientId)) {
                    await store.clearHostAbsence(code);
                    return NextResponse.json({ ok: true, hostClientId: meta.hostClientId }); // host still here
                }
                const claimer = present.find(m => m.clientId === clientId);
                if (!claimer) return NextResponse.json({ ok: false, error: 'Not present' }, { status: 400 });

                // Require the host to have been gone for a grace period, so a
                // transient disconnect does not hand the room to whoever polls first.
                const absentSince = await store.markHostAbsent(code);
                if (Date.now() - absentSince < HOST_CLAIM_GRACE_MS) {
                    return NextResponse.json({
                        ok: false,
                        error: 'Waiting to see if the host reconnects',
                        retryInMs: HOST_CLAIM_GRACE_MS - (Date.now() - absentSince),
                    }, { status: 409 });
                }

                await store.setHost(code, clientId);
                await store.clearHostAbsence(code);
                await publishHost(clientId, claimer.nickname);
                return NextResponse.json({ ok: true, hostClientId: clientId });
            }
            default:
                return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        console.error('[api/room] failed:', err);
        return NextResponse.json({ ok: false, error: 'Room action failed' }, { status: 500 });
    }
}
