import { NextResponse } from 'next/server';
import { normalizeRoomCode } from '@/lib/ids';
import { EV } from '@/lib/channels';
import * as store from '@/server/store/roomStore';
import { getPresence } from '@/server/realtime/presence';
import { publish } from '@/server/realtime/publish';
import { systemMessage } from '@/server/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const code = normalizeRoomCode(String(body?.code ?? ''));
        const clientId = String(body?.clientId ?? '').slice(0, 64);
        const action = String(body?.action ?? '');
        const meta = await store.getMeta(code);
        if (!meta) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404 });

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
                    return NextResponse.json({ ok: true, hostClientId: meta.hostClientId }); // host still here
                }
                const claimer = present.find(m => m.clientId === clientId);
                if (!claimer) return NextResponse.json({ ok: false, error: 'Not present' }, { status: 400 });
                await store.setHost(code, clientId);
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
