/**
 * Order events worker.
 *
 * Runs inside every API process; RabbitMQ's competing-consumers pattern
 * distributes queue work across all Railway replicas / cluster workers.
 *
 * Extend the switch below with real side effects (emails, analytics,
 * invoice generation) as needed — failures never affect the HTTP path.
 */

import { consumeEvents } from '../config/rabbitmq.js';

export function startOrderEventsWorker() {
    return consumeEvents('order-worker', ['order.created'], async (envelope) => {
        const { payload } = envelope;
        console.log(
            `[order-worker] order.created -> id=${payload?.orderId || 'n/a'}` +
            ` total=${payload?.total ?? 'n/a'} payment=${payload?.paymentMethod || 'n/a'}`
        );
        // TODO: plug in transactional email / SMS / analytics here
    });
}
