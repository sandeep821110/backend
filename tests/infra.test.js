import { createEventEnvelope } from '../src/config/rabbitmq.js';
import { buildCacheKey } from '../src/middleware/cache.js';

describe('createEventEnvelope — RabbitMQ message envelope', () => {
  test('builds a well-formed envelope with all required fields', () => {
    const env = createEventEnvelope('order.created', { orderId: 'abc123' });

    expect(env.type).toBe('order.created');
    expect(env.payload).toEqual({ orderId: 'abc123' });
    expect(env.source).toBe('api');
    expect(env.id).toMatch(/^\d+-[a-z0-9]+$/);
    expect(new Date(env.occurredAt).toString()).not.toBe('Invalid Date');
  });

  test('generates unique ids for consecutive events', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => createEventEnvelope('t', {}).id)
    );
    expect(ids.size).toBe(50);
  });

  test('supports a custom source label', () => {
    const env = createEventEnvelope('user.signup', {}, 'worker');
    expect(env.source).toBe('worker');
  });

  test('envelope is JSON-serializable (broker wire format)', () => {
    const env = createEventEnvelope('order.created', { nested: { ok: true } });
    const roundTrip = JSON.parse(JSON.stringify(env));
    expect(roundTrip).toEqual(env);
  });
});

describe('buildCacheKey — Redis cache key namespacing', () => {
  test('namespaces keys under the app prefix with method + url', () => {
    expect(buildCacheKey('GET', '/api/products')).toBe(
      'flystore:resp-cache:GET:/api/products'
    );
  });

  test('distinguishes different methods and query strings', () => {
    const a = buildCacheKey('GET', '/api/slider/all');
    const b = buildCacheKey('POST', '/api/slider/all');
    const c = buildCacheKey('GET', '/api/slider/all?x=1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
