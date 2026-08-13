/** Simple token buckets keyed by an arbitrary string (socket.id + action). */

interface Bucket { tokens: number; lastRefill: number; }

const buckets = new Map<string, Bucket>();

export function allow(key: string, ratePerSec: number, burst: number): boolean {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: burst, lastRefill: now }; buckets.set(key, b); }
    b.tokens = Math.min(burst, b.tokens + ((now - b.lastRefill) / 1000) * ratePerSec);
    b.lastRefill = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
}

// Periodic cleanup so long-lived servers don't accumulate dead buckets.
setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, b] of buckets) if (b.lastRefill < cutoff) buckets.delete(k);
}, 5 * 60_000).unref();
