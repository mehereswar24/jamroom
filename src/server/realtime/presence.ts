/** Read a room's live membership from Ably presence (server-side, via REST). */

import Ably from 'ably';
import { roomChannel } from '../../lib/channels';
import type { Member } from '../../lib/types';

let rest: Ably.Rest | null = null;
function getRest(): Ably.Rest {
    if (rest) return rest;
    const key = process.env.ABLY_API_KEY;
    if (!key) throw new Error('Ably is not configured — set ABLY_API_KEY');
    rest = new Ably.Rest({ key });
    return rest;
}

export interface PresenceData {
    nickname: string;
    avatarColor: string;
    joinedAt: number;
}

export async function getPresence(code: string): Promise<Member[]> {
    try {
        const page = await getRest().channels.get(roomChannel(code)).presence.get({ limit: 100 });
        const byClient = new Map<string, Member>();
        for (const m of page.items) {
            const d = (m.data ?? {}) as Partial<PresenceData>;
            if (!m.clientId) continue;
            byClient.set(m.clientId, {
                clientId: m.clientId,
                nickname: d.nickname ?? 'Guest',
                avatarColor: d.avatarColor ?? '#888',
                connected: true
            });
        }
        return [...byClient.values()];
    } catch {
        return [];
    }
}

export async function presenceCount(code: string): Promise<number> {
    return (await getPresence(code)).length;
}
