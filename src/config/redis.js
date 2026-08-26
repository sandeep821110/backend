/**
 * Redis client for production (Upstash REST API) and development (ioredis TCP).
 *
 * Priority:
 *   1. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (Upstash REST — serverless-friendly)
 *   2. REDIS_PRIVATE_URL / REDIS_URL                       (ioredis TCP — Railway / self-hosted)
 *   3. No Redis — bounded in-memory fallback (dev mode)
 *
 * Never throws at import time: callers degrade gracefully.
 * Singleton: safe to import from any module.
 */

const UPSTASH_REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const TCP_URL = process.env.REDIS_PRIVATE_URL || process.env.REDIS_URL || '';

// ---------------------------------------------------------------------------
// Upstash REST client (no external dependency needed)
// ---------------------------------------------------------------------------

class UpstashRedis {
    constructor(url, token) {
        this.url = url;
        this.token = token;
        this.status = 'ready';
    }

    async _fetch(command, ...args) {
        const body = JSON.stringify([command, ...args]);
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Upstash ${command} failed (${res.status}): ${text}`);
        }
        return res.json();
    }

    async call(command, ...args) {
        const result = await this._fetch(command, ...args);
        return result.result;
    }

    async ping() {
        const result = await this.call('PING');
        return result === 'PONG' ? 'PONG' : result;
    }

    async get(key) { return this.call('GET', key); }
    async set(key, value, ...args) { return this.call('SET', key, value, ...args); }
    async del(...keys) { return this.call('DEL', ...keys); }

    async scan(cursor, ...args) {
        const result = await this.call('SCAN', cursor, ...args);
        return result;
    }

    disconnect() { this.status = 'closed'; }
    async quit() { this.status = 'closed'; }
}

// ---------------------------------------------------------------------------
// Pick the best available client
// ---------------------------------------------------------------------------

let client = null;

if (UPSTASH_REST_URL && UPSTASH_REST_TOKEN) {
    client = new UpstashRedis(UPSTASH_REST_URL, UPSTASH_REST_TOKEN);
    console.log('[redis] connected via Upstash REST API');
} else if (TCP_URL) {
    try {
        const { default: Redis } = await import('ioredis');
        client = new Redis(TCP_URL, {
            lazyConnect: false,
            maxRetriesPerRequest: 2,
            enableOfflineQueue: true,
            connectTimeout: 10_000,
            retryStrategy: (times) => Math.min(times * 500, 10_000)
        });
        client.on('connect', () => console.log('[redis] connected via TCP'));
        client.on('ready', () => console.log('[redis] ready'));
        client.on('error', (err) => console.error('[redis] error:', err.message));
        client.on('end', () => console.warn('[redis] connection closed'));
        client.on('reconnecting', () => console.log('[redis] reconnecting...'));
    } catch (err) {
        console.warn('[redis] ioredis import failed:', err.message, '— running without Redis');
    }
} else {
    console.warn('[redis] no Redis URL configured — running with in-memory cache');
}

export const isRedisEnabled = () => {
    if (!client) return false;
    return client.status === 'ready' || client instanceof UpstashRedis;
};

export async function redisPing() {
    if (!client) return { ok: false, reason: 'not configured' };
    try {
        if (client instanceof UpstashRedis) {
            const pong = await client.ping();
            return { ok: pong === 'PONG' };
        }
        const pong = await client.ping();
        return { ok: pong === 'PONG' };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

export async function closeRedis() {
    if (!client) return;
    try {
        await client.quit();
    } catch {
        client.disconnect?.();
    }
}

export default client;
