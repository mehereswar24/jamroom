/** Publish an event to a room's Ably channel from a serverless function (REST). */

import Ably from 'ably';
import { roomChannel } from '../../lib/channels';

let rest: Ably.Rest | null = null;

function getRest(): Ably.Rest {
    if (rest) return rest;
    const key = process.env.ABLY_API_KEY;
    if (!key) throw new Error('Ably is not configured — set ABLY_API_KEY');
    rest = new Ably.Rest({ key });
    return rest;
}

export async function publish(code: string, event: string, data: unknown): Promise<void> {
    await getRest().channels.get(roomChannel(code)).publish(event, data);
}

/** Publish several events to one room channel in a single call. */
export async function publishBatch(code: string, msgs: Array<{ name: string; data: unknown }>): Promise<void> {
    await getRest().channels.get(roomChannel(code)).publish(msgs);
}
