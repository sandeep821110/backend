/**
 * TTL response cache for hot GET endpoints.
 *
 * Production (Redis/Upstash set): entries live in shared cache so EVERY
 * load-balanced instance / cluster worker serves the same cache and
 * invalidations propagate instantly across replicas.
 *
 * Fallback (no Redis / Redis down): identical behaviour with a bounded
 * per-process Map, so local dev and degraded prod still work unchanged.
 */

import redisClient from '../config/redis.js';

const memoryStore = new Map();
const MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || '', 10) || 500;
const KEY_PREFIX = 'flystore:resp-cache:';

export const buildCacheKey = (method, originalUrl) =>
    `${KEY_PREFIX}${method}:${originalUrl}`;

const evictIfNeeded = () => {
    if (memoryStore.size <= MAX_ENTRIES) return;
    const overflow = memoryStore.size - MAX_ENTRIES;
    let evicted = 0;
    for (const key of memoryStore.keys()) {
        if (evicted >= overflow) break;
        memoryStore.delete(key);
        evicted++;
    }
};

const redisReady = () => !!redisClient && (redisClient.status === 'ready' || redisClient.constructor?.name === 'UpstashRedis');

export const cacheMiddleware = (ttlSeconds = 60) => async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.headers.authorization || req.cookies?.access_token) return next();

    const key = buildCacheKey(req.method, req.originalUrl);

    try {
        if (redisReady()) {
            const raw = await redisClient.get(key);
            if (raw) {
                const cached = JSON.parse(raw);
                res.set('X-Cache', 'HIT');
                res.set('Content-Type', cached.contentType || 'application/json');
                return res.status(cached.status || 200).send(cached.body);
            }
        } else {
            const cached = memoryStore.get(key);
            if (cached && cached.expiresAt > Date.now()) {
                res.set('X-Cache', 'HIT');
                res.set('Content-Type', cached.contentType || 'application/json');
                return res.status(cached.status || 200).send(cached.body);
            }
        }
    } catch (err) {
        console.error('[cache] read failed:', err.message);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
            const payload = JSON.stringify({
                status,
                contentType: 'application/json',
                body
            });
            if (redisReady()) {
                redisClient
                    .set(key, payload, 'EX', ttlSeconds)
                    .catch(err => console.error('[cache] write failed:', err.message));
            } else {
                memoryStore.set(key, {
                    expiresAt: Date.now() + ttlSeconds * 1000,
                    status,
                    contentType: 'application/json',
                    body
                });
                evictIfNeeded();
            }
        }
        res.set('X-Cache', 'MISS');
        return originalJson(body);
    };

    next();
};

/**
 * Invalidate cached entries whose key contains ANY of the given path fragments.
 */
export const invalidateCache = (...pathFragments) => {
    if (redisReady()) {
        // For Upstash REST, we use SCAN via the call interface
        const scanAndDelete = async () => {
            let cursor = '0';
            do {
                const result = await redisClient.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 200);
                if (!result) break;
                const [nextCursor, keys] = Array.isArray(result) ? result : [result[0], result[1] || []];
                cursor = nextCursor;

                if (keys && keys.length) {
                    const doomed = pathFragments.length
                        ? keys.filter(k => pathFragments.some(frag => k.includes(frag)))
                        : keys;
                    if (doomed.length) {
                        await redisClient.del(...doomed).catch(() => {});
                    }
                }
            } while (cursor !== '0');
        };
        scanAndDelete().catch(err => console.error('[cache] invalidate failed:', err.message));
        return;
    }

    if (!pathFragments.length) {
        memoryStore.clear();
        return;
    }
    for (const key of [...memoryStore.keys()]) {
        if (pathFragments.some(frag => key.includes(frag))) {
            memoryStore.delete(key);
        }
    }
};
