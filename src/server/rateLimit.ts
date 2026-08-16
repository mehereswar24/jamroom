/**
 * Fixed-window rate limiting on Upstash Redis.
 *
 * No route had any limit: /api/ably/token minted unlimited tokens, and
 * /api/import/* fanned out into YouTube and Spotify calls. Every dependency
 * here is a metered free tier, so this is a cost control as much as an
 * availability one.
 *
 * Redis is already a dependency, and the counters are per-window keys with a
 * TTL, so they cost one INCR and expire themselves.
 */

import { NextResponse } from 'next/server';
import { getRedis } from './store/redis';

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetInSeconds: number;
}

/**
 * Consume one unit against `key`. Returns null when allowed, or a 429
 * response when the limit is exhausted.
 */
export async function rateLimit(
    key: string,
    limit: number,
    windowSeconds: number
): Promise<NextResponse | null> {
    const result = await check(key, limit, windowSeconds);
    if (result.allowed) return null;

    return NextResponse.json(
        { ok: false, error: 'Slow down a moment and try again.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(result.resetInSeconds),
                'X-RateLimit-Limit': String(limit),
                'X-RateLimit-Remaining': '0',
            },
        }
    );
}

export async function check(
    key: string,
    limit: number,
    windowSeconds: number
): Promise<RateLimitResult> {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const bucket = `jr:rl:${key}:${window}`;

    try {
        const r = getRedis();
        const hits = await r.incr(bucket);
        if (hits === 1) await r.expire(bucket, windowSeconds);
        const resetInSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
        return {
            allowed: hits <= limit,
            remaining: Math.max(0, limit - hits),
            resetInSeconds,
        };
    } catch (err) {
        // A limiter outage must not take the app down with it.
        console.error('[rateLimit] backend unavailable, allowing request:', err);
        return { allowed: true, remaining: limit, resetInSeconds: windowSeconds };
    }
}

/** Best-effort client address for limiting unauthenticated routes. */
export function clientAddress(req: Request): string {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return req.headers.get('x-real-ip') ?? 'unknown';
}
