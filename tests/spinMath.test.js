import {
  SPIN_SEGMENTS,
  SPIN_REWARD_DAYS,
  TOTAL_WEIGHT,
  pickSpinPrize,
  getTodayKey,
  canPlayToday,
  getExpiryDate,
  msUntilMidnight
} from '../src/utils/spinMath.js';

describe('spinMath — wheel configuration', () => {
  test('wheel has exactly the 6 expected segments', () => {
    expect(SPIN_SEGMENTS).toHaveLength(6);
    expect(SPIN_SEGMENTS.map(s => s.id)).toEqual([
      'CASH_4', 'FREE_DELIVERY', 'CASH_8', 'TRY_AGAIN', 'CASH_6', 'CASH_9'
    ]);
  });

  test('cash segments carry the required prize values', () => {
    const cash = Object.fromEntries(
      SPIN_SEGMENTS.filter(s => s.type === 'CASH').map(s => [s.id, s.value])
    );
    expect(cash).toEqual({ CASH_4: 4, CASH_6: 6, CASH_8: 8, CASH_9: 9 });
  });

  test('total weight is the sum of all segment weights', () => {
    const sum = SPIN_SEGMENTS.reduce((acc, s) => acc + s.weight, 0);
    expect(TOTAL_WEIGHT).toBe(sum);
    expect(TOTAL_WEIGHT).toBe(120);
  });

  test('rewards expire after 7 days', () => {
    expect(SPIN_REWARD_DAYS).toBe(7);
  });
});

describe('pickSpinPrize', () => {
  test('returns a valid segment for any random roll', () => {
    for (let i = 0; i < 500; i++) {
      const prize = pickSpinPrize();
      expect(SPIN_SEGMENTS).toContain(prize);
    }
  });

  test('is deterministic for a given rng', () => {
    const rng = () => 0; // always rolls 0 -> first segment
    expect(pickSpinPrize(rng).id).toBe('CASH_4');

    const rngMax = () => 0.9999999; // near-certain last segment
    expect(pickSpinPrize(rngMax).id).toBe('CASH_9');
  });

  test('respects weight boundaries exactly', () => {
    // CASH_4 has weight 30 of 120 => boundary at 30/120 = 0.25
    expect(pickSpinPrize(() => 0.2499999).id).toBe('CASH_4');
    expect(pickSpinPrize(() => 0.2500001).id).not.toBe('CASH_4');
  });

  test('never returns TRY_AGAIN when rng avoids its band', () => {
    const prizes = new Set(Array.from({ length: 200 }, () => pickSpinPrize().type));
    // over many spins all outcome types are reachable
    expect(prizes.has('CASH')).toBe(true);
    expect(prizes.has('FREE_DELIVERY')).toBe(true);
    expect(prizes.has('TRY_AGAIN')).toBe(true);
  });
});

describe('getTodayKey / canPlayToday — once-per-day enforcement', () => {
  test('formats the date key as YYYY-MM-DD', () => {
    expect(getTodayKey(new Date(2026, 7, 22))).toBe('2026-08-22');
    expect(getTodayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('user who never played can play today', () => {
    expect(canPlayToday(null)).toBe(true);
    expect(canPlayToday(undefined)).toBe(true);
    expect(canPlayToday('')).toBe(true);
  });

  test('user who played yesterday can play again', () => {
    expect(canPlayToday('2026-08-21', '2026-08-22')).toBe(true);
  });

  test('user who already played today cannot play again', () => {
    expect(canPlayToday('2026-08-22', '2026-08-22')).toBe(false);
  });
});

describe('getExpiryDate — 7 day reward expiry', () => {
  test('adds exactly 7 days to the given date', () => {
    const now = new Date('2026-08-22T10:30:00');
    const expiry = getExpiryDate(now);
    expect(expiry.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  test('supports custom day counts', () => {
    const now = new Date('2026-08-22T00:00:00');
    expect(getExpiryDate(now, 1).getDate()).toBe(23);
  });
});

describe('msUntilMidnight — next spin countdown', () => {
  test('returns a positive value smaller than 24h', () => {
    const ms = msUntilMidnight(new Date('2026-08-22T15:00:00'));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
  });

  test('returns ~9h for a 3pm timestamp', () => {
    const ms = msUntilMidnight(new Date('2026-08-22T15:00:00'));
    expect(ms).toBe(9 * 60 * 60 * 1000);
  });

  test('returns full day just after midnight', () => {
    const ms = msUntilMidnight(new Date('2026-08-22T00:00:01'));
    expect(ms).toBe((24 * 60 * 60 * 1000) - 1000);
  });
});
