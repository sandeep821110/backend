/**
 * OVERLOAD GUARD (load shedding)
 * ------------------------------
 * Lets one instance survive traffic spikes instead of collapsing:
 *   - counts in-flight requests per worker
 *   - samples event-loop lag continuously
 *   - when saturated, rejects NEW requests instantly with 503 +
 *     Retry-After so clients/backoffs kick in while existing
 *     requests finish - keeping latency bounded for everyone else
 *
 * Thresholds are env-tunable; defaults suit a 1GB RAM container.
 */

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '', 10) || 200;
const LAG_THRESHOLD_MS = parseInt(process.env.MAX_EVENT_LOOP_LAG_MS || '', 10) || 250;
const SAMPLE_INTERVAL_MS = 500;

const load = {
    active: 0,
    totalHandled: 0,
    rejected: 0,
    eventLoopLagMs: 0,
};

// --- event loop lag sampling -------------------------------------------
let lastSample = process.hrtime.bigint();

setInterval(() => {
    const now = process.hrtime.bigint();
    // scheduled gap vs real gap = how long the loop was blocked
    load.eventLoopLagMs = Number(now - lastSample - BigInt(SAMPLE_INTERVAL_MS * 1e6)) / 1e6;
    if (load.eventLoopLagMs < 0) load.eventLoopLagMs = 0;
    lastSample = now;
}, SAMPLE_INTERVAL_MS).unref();

// --- public helpers ------------------------------------------------------

export function isSaturated() {
    return load.active >= MAX_CONCURRENT || load.eventLoopLagMs > LAG_THRESHOLD_MS;
}

export function getLoadStats() {
    return { ...load, maxConcurrent: MAX_CONCURRENT, lagThresholdMs: LAG_THRESHOLD_MS };
}

// --- middleware ----------------------------------------------------------

export function overloadGuard(req, res, next) {
    if (!isSaturated()) {
        load.active += 1;
        res.on('finish', () => {
            load.active = Math.max(load.active - 1, 0);
            load.totalHandled += 1;
        });
        return next();
    }

    load.rejected += 1;
    res.set('Retry-After', '2');
    res.set('Connection', 'close');
    console.error(
        `[overload] shedding ${req.method} ${req.originalUrl} | active=${load.active} lag=${load.eventLoopLagMs.toFixed(0)}ms`
    );
    res.status(503).json({
        success: false,
        message: 'Server is at capacity, please retry shortly',
    });
}
