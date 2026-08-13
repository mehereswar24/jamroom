import { Redis } from '@upstash/redis';

let client: Redis | null = null;

export function getRedis(): Redis {
    if (client) return client;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        throw new Error('Upstash Redis is not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    }
    client = new Redis({ url, token });
    return client;
}

// Rooms auto-expire after 24h of inactivity (every write refreshes the TTL).
export const ROOM_TTL_SECONDS = 24 * 60 * 60;
