/**
 * TTL response cache for hot GET endpoints.
 *
 * Production (REDIS_URL set): entries live in shared Redis so EVERY
 * load-balanced instance / cluster worker serves the same cache and
 * invalidations propagate instantly across replicas.
 *
 * Fallback (no Redis / Redis down): identical behaviour with a bounded
 * per-process Map, so local dev and degraded prod still work unchanged.
 */

import redisClient from '../config/redis.js';

const memoryStore = new Map(); // key -> { expiresAt, body, contentType }
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

const redisReady = () => !!redisClient && redisClient.status === 'ready';

/**
 * Middleware factory: caches successful GET responses for `ttlSeconds`.
 * Usage: router.get('/products', cacheMiddleware(60), handler)
 */
export const cacheMiddleware = (ttlSeconds = 60) => async (req, res, next) => {
    // Only cache safe, public reads
    if (req.method !== 'GET') return next();
    if (req.headers.authorization || req.cookies?.token) return next();

    const key = buildCacheKey(req.method, req.originalUrl);

    // ---- HIT? ----
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
        console.error('[cache] read failed:', err.message); // fall through to MISS
    }

    // ---- MISS: capture the JSON response once generated ----
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
 * Call after admin writes: invalidateCache('/api/products').
 * With Redis this clears the cache on ALL instances at once.
 */
export const invalidateCache = (...pathFragments) => {
    if (redisReady()) {
        const pattern = `${KEY_PREFIX}*`;
        const stream = redisClient.scanStream({ match: pattern, count: 200 });
        stream.on('data', async (keys) => {
            if (!keys.length) return;
            const doomed = pathFragments.length
                ? keys.filter(k => pathFragments.some(frag => k.includes(frag)))
                : keys;
            if (doomed.length) redisClient.del(...doomed).catch(() => {});
        });
        stream.on('error', (err) => console.error('[cache] invalidate failed:', err.message));
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
