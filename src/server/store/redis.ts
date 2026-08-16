import { Redis } from '@upstash/redis';

let client: Redis | null = null;
let useMemoryFallback = false;

// Global in-memory storage for zero-config production fallback
const memoryStore = new Map<string, any>();
const memoryLists = new Map<string, any[]>();
const memorySets = new Map<string, Set<any>>();

export interface RedisLike {
    get: <T = any>(k: string) => Promise<T | null>;
    set: (k: string, v: any, opts?: any) => Promise<'OK'>;
    del: (k: string) => Promise<number>;
    exists: (k: string) => Promise<number>;
    incr: (k: string) => Promise<number>;
    incrby: (k: string, by: number) => Promise<number>;
    expire: (k: string, seconds: number) => Promise<number>;
    lrange: <T = any>(k: string, s: number, e: number) => Promise<T[]>;
    rpush: (k: string, v: any) => Promise<number>;
    ltrim: (k: string, s: number, e: number) => Promise<'OK'>;
    smembers: <T = any>(k: string) => Promise<T[]>;
    sadd: (k: string, v: any) => Promise<number>;
    srem: (k: string, v: any) => Promise<number>;
    sismember: (k: string, v: any) => Promise<number>;
}

export function getRedis(): RedisLike {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token && !useMemoryFallback) {
        if (!client) {
            try {
                client = new Redis({ url, token });
            } catch (err) {
                console.warn('[Redis] Connection failed, using in-memory store fallback:', err);
                useMemoryFallback = true;
            }
        }
        if (client) return client as unknown as RedisLike;
    }

    // In-Memory Redis Proxy fallback for zero-config production deployments
    return {
        get: async <T = any>(k: string) => (memoryStore.get(k) as T) ?? null,
        set: async (k: string, v: any) => { memoryStore.set(k, v); return 'OK'; },
        del: async (k: string) => { memoryStore.delete(k); memoryLists.delete(k); memorySets.delete(k); return 1; },
        exists: async (k: string) => (memoryStore.has(k) ? 1 : 0),
        incr: async (k: string) => {
            const cur = (memoryStore.get(k) ?? 0) + 1;
            memoryStore.set(k, cur);
            return cur;
        },
        incrby: async (k: string, by: number) => {
            const cur = (memoryStore.get(k) ?? 0) + by;
            memoryStore.set(k, cur);
            return cur;
        },
        expire: async () => 1,
        lrange: async <T = any>(k: string, s: number, e: number) => {
            const list = (memoryLists.get(k) ?? []) as T[];
            return list.slice(s, e < 0 ? undefined : e + 1);
        },
        rpush: async (k: string, v: any) => {
            const list = memoryLists.get(k) ?? [];
            list.push(v);
            memoryLists.set(k, list);
            return list.length;
        },
        ltrim: async (k: string, s: number, e: number) => {
            const list = memoryLists.get(k) ?? [];
            memoryLists.set(k, list.slice(s, e < 0 ? undefined : e + 1));
            return 'OK';
        },
        smembers: async <T = any>(k: string) => Array.from((memorySets.get(k) ?? []) as Set<T>),
        sadd: async (k: string, v: any) => {
            const set = memorySets.get(k) ?? new Set();
            set.add(v);
            memorySets.set(k, set);
            return 1;
        },
        srem: async (k: string, v: any) => {
            const set = memorySets.get(k) ?? new Set();
            set.delete(v);
            memorySets.set(k, set);
            return 1;
        },
        sismember: async (k: string, v: any) => {
            const set = memorySets.get(k) ?? new Set();
            return set.has(v) ? 1 : 0;
        },
    };
}

// Rooms auto-expire after 24h of inactivity
export const ROOM_TTL_SECONDS = 24 * 60 * 60;
