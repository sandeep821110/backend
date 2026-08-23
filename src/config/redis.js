/**
 * Redis client for Railway production.
 *
 * - Connects via REDIS_URL / REDIS_PRIVATE_URL (injected by the Railway Redis
 *   plugin). When absent (local dev), the app runs fully without Redis.
 * - Never throws at import time: callers degrade gracefully to in-memory mode.
 * - Singleton: safe to import from any module; all workers share nothing, but
 *   each process opens one pooled connection.
 */

import Redis from 'ioredis';

export const redisUrl =
    process.env.REDIS_PRIVATE_URL || process.env.REDIS_URL || '';

let client = null;

if (redisUrl) {
    client = new Redis(redisUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: true,
        connectTimeout: 10_000,
        retryStrategy: (times) => Math.min(times * 500, 10_000)
    });

    client.on('connect', () => console.log('[redis] connected'));
    client.on('ready', () => console.log('[redis] ready'));
    client.on('error', (err) => console.error('[redis] error:', err.message));
    client.on('end', () => console.warn('[redis] connection closed'));

    // A crashed Redis must never take the API down
    client.on('reconnecting', () => console.log('[redis] reconnecting...'));
} else {
    console.warn('[redis] REDIS_URL not set — running with in-memory cache');
}

export const isRedisEnabled = () => !!client && client.status === 'ready';

/** Await-able ping used by the /health endpoint */
export async function redisPing() {
    if (!client) return { ok: false, reason: 'not configured' };
    try {
        const pong = await client.ping();
        return { ok: pong === 'PONG' };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

/** Close cleanly on shutdown */
export async function closeRedis() {
    if (!client) return;
    try {
        await client.quit();
    } catch {
        client.disconnect();
    }
}

export default client;
