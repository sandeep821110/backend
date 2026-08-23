/**
 * RabbitMQ event bus for Railway production.
 *
 * - Connects via RABBITMQ_URL (Railway "RabbitMQ" template injects it).
 * - Topic exchange `flystore.events`: producers publish fire-and-forget,
 *   consumers use competing-queues so work is load-balanced across
 *   replicas / cluster workers automatically.
 * - Fully optional in development: every helper becomes a no-op when the
 *   URL is missing or the broker is unreachable — API requests NEVER fail
 *   because of messaging.
 */

import amqplib from 'amqplib';

const RABBITMQ_URL =
    process.env.RABBITMQ_URL ||
    process.env.CLOUDAMQP_URL ||
    '';

export const EXCHANGE = 'flystore.events';

let connection = null;
let channel = null;
let connecting = null; // dedupe concurrent connect attempts

export const isRabbitEnabled = () => !!channel;

/** Build a consistent, traceable event envelope (pure — unit tested) */
export function createEventEnvelope(type, payload, source = 'api') {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        type,
        source,
        occurredAt: new Date().toISOString(),
        payload
    };
}

async function connect() {
    if (!RABBITMQ_URL) {
        console.warn('[rabbitmq] RABBITMQ_URL not set — events disabled');
        return null;
    }
    if (connecting) return connecting;

    connecting = (async () => {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();
            await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

            connection.on('error', (err) => console.error('[rabbitmq] connection error:', err.message));
            connection.on('close', () => {
                console.warn('[rabbitmq] connection closed — will retry on next use');
                channel = null;
                connection = null;
                connecting = null;
                setTimeout(() => connect().catch(() => {}), 5000);
            });

            console.log('[rabbitmq] connected');
            return channel;
        } catch (err) {
            console.error('[rabbitmq] connect failed:', err.message, '— continuing without MQ');
            channel = null;
            connecting = null;
            // Retry quietly in the background so prod recovers after broker restart
            setTimeout(() => connect().catch(() => {}), 10000);
            return null;
        }
    })();

    return connecting;
}

// Kick off an initial background connection attempt
connect();

/**
 * Publish an event. Fire-and-forget: resolves false instead of throwing.
 * @param {string} type   e.g. 'order.created'
 * @param {object} payload
 */
export async function publishEvent(type, payload) {
    if (!channel) {
        await connect();
        if (!channel) return false;
    }
    try {
        const envelope = createEventEnvelope(type, payload);
        return channel.publish(
            EXCHANGE,
            type,
            Buffer.from(JSON.stringify(envelope)),
            { persistent: true, contentType: 'application/json' }
        );
    } catch (err) {
        console.error(`[rabbitmq] publish '${type}' failed:`, err.message);
        return false;
    }
}

/**
 * Consume events matching binding patterns (competing consumer).
 * @param {string} queue     durable queue name, e.g. 'order-worker'
 * @param {string[]} bindings e.g. ['order.created']
 * @param {(envelope)=>Promise<void>} handler
 */
export async function consumeEvents(queue, bindings, handler) {
    if (!channel) {
        await connect();
        if (!channel) return false;
    }
    try {
        await channel.assertQueue(queue, { durable: true });
        for (const pattern of bindings) {
            await channel.bindQueue(queue, EXCHANGE, pattern);
        }
        await channel.prefetch(1); // fair dispatch across instances

        channel.consume(queue, async (msg) => {
            if (!msg) return;
            try {
                const envelope = JSON.parse(msg.content.toString());
                await handler(envelope);
                channel.ack(msg);
            } catch (err) {
                console.error(`[rabbitmq] handler failed for ${queue}:`, err.message);
                channel.nack(msg, false, false); // drop poison messages (DLQ can be added later)
            }
        });

        console.log(`[rabbitmq] worker listening on queue '${queue}' [${bindings.join(', ')}]`);
        return true;
    } catch (err) {
        console.error(`[rabbitmq] consume setup failed for ${queue}:`, err.message);
        return false;
    }
}

/** Close cleanly on shutdown */
export async function closeRabbit() {
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
    } catch { /* already closed */ }
    channel = null;
    connection = null;
}

export default { publishEvent, consumeEvents, closeRabbit, isRabbitEnabled };
