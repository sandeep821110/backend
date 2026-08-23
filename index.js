import { configDotenv } from "dotenv";
import cluster from "cluster";
import os from "os";
import app from "./app.js";
import { closeRedis } from "./src/config/redis.js";
import { closeRabbit } from "./src/config/rabbitmq.js";
import { startOrderEventsWorker } from "./src/workers/orderEventsWorker.js";

configDotenv();

const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// Cluster mode: automatic in production, force with CLUSTER_MODE=on
const USE_CLUSTER = IS_PRODUCTION || process.env.CLUSTER_MODE === 'on';
// WEB_CONCURRENCY overrides core count; min 1, max 32 workers
const WORKERS = Math.min(
    Math.max(parseInt(process.env.WEB_CONCURRENCY || '', 10) || os.availableParallelism?.() || os.cpus().length, 1),
    32
);

/**
 * CLUSTER MODE: master process forks N workers (one per CPU core).
 * The OS distributes incoming connections across all workers ->
 * true multi-core load balancing with automatic crash recovery.
 * Each worker serves users independently = N x concurrency.
 */
if (USE_CLUSTER && cluster.isPrimary) {
    console.log(`[MASTER ${process.pid}] Starting ${WORKERS} workers (load balancing across ${os.cpus().length} CPU cores)`);

    // Fork initial workers
    for (let i = 0; i < WORKERS; i++) cluster.fork();

    // Respawn crashed workers automatically - keeps capacity under load
    cluster.on('exit', (worker, code, signal) => {
        console.error(`[MASTER] Worker ${worker.process.pid} died (${signal || code}). Respawning...`);
        if (!worker.exitedAfterDisconnect) cluster.fork();
    });

    // Rolling restart: disconnect each worker gracefully, one at a time
    process.on('SIGUSR2', () => {
        console.log('[MASTER] Rolling restart triggered...');
        const workers = Object.values(cluster.workers);
        let i = 0;
        const next = () => {
            if (i >= workers.length) return;
            const w = workers[i++];
            w.send('shutdown');
            setTimeout(next, 500);
            setTimeout(() => { try { w.kill(); } catch {} }, 5000);
        };
        next();
    });

    // Graceful full shutdown: stop accepting new work, then exit
    const masterShutdown = (signal) => {
        console.log(`[MASTER] ${signal} received. Shutting down all workers...`);
        for (const id of Object.keys(cluster.workers)) {
            cluster.workers[id].send('shutdown');
        }
        setTimeout(() => process.exit(0), 8000);
    };
    process.on('SIGTERM', () => masterShutdown('SIGTERM'));
    process.on('SIGINT', () => masterShutdown('SIGINT'));

} else {
    // Single worker (also the dev-mode path)
    // RabbitMQ competing consumer: queue work is load-balanced across
    // every Railway replica and cluster worker automatically.
    startOrderEventsWorker();

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(
          `[WORKER ${process.pid}] Server running in ${IS_PRODUCTION ? 'production' : 'development'} mode on port ${PORT}`
        );
    });

    // Tuned timeouts for high concurrency behind a proxy (nginx/ALB/Vercel)
    server.keepAliveTimeout = 65000;   // > most LB idle timeouts (65s)
    server.headersTimeout = 66000;     // must be > keepAliveTimeout
    server.requestTimeout = 120000;
    server.timeout = 0;                // no socket inactivity kill mid-response

    // Graceful worker shutdown: finish in-flight requests, then close
    // Redis + RabbitMQ connections before exit.
    const shutdown = (signal) => {
        console.log(`[WORKER ${process.pid}] ${signal} received. Closing server gracefully...`);
        server.close(async () => {
            console.log(`[WORKER ${process.pid}] Closed. Draining connections...`);
            await Promise.allSettled([closeRedis(), closeRabbit()]);
            console.log(`[WORKER ${process.pid}] Exiting.`);
            process.exit(0);
        });
        setTimeout(() => {
            console.error(`[WORKER ${process.pid}] Forcing exit.`);
            process.exit(1);
        }, 10000);
    };

    if (IS_PRODUCTION && !cluster.isPrimary) {
        process.on('message', (msg) => {
            if (msg === 'shutdown') shutdown('MASTER_SHUTDOWN');
        });
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
        console.error(`[WORKER ${process.pid}] Unhandled Rejection:`, reason);
    });

    process.on('uncaughtException', (err) => {
        console.error(`[WORKER ${process.pid}] Uncaught Exception:`, err);
        shutdown('UNCAUGHT_EXCEPTION');
    });
}
