// ---------------------------------------------------------------------------
// Pure spin-game helpers — no DB / framework dependencies so they can be unit
// tested in isolation with Jest.
// ---------------------------------------------------------------------------

export const SPIN_REWARD_DAYS = 7;

export const SPIN_SEGMENTS = [
    { id: 'CASH_4', label: '₹4', type: 'CASH', value: 4, weight: 30 },
    { id: 'FREE_DELIVERY', label: 'Free Delivery', type: 'FREE_DELIVERY', value: 0, weight: 15 },
    { id: 'CASH_8', label: '₹8', type: 'CASH', value: 8, weight: 20 },
    { id: 'TRY_AGAIN', label: 'Try Again', type: 'TRY_AGAIN', value: 0, weight: 15 },
    { id: 'CASH_6', label: '₹6', type: 'CASH', value: 6, weight: 25 },
    { id: 'CASH_9', label: '₹9', type: 'CASH', value: 9, weight: 15 }
];

export const WHEEL_CONFIG = {
    segments: SPIN_SEGMENTS.map(s => ({ id: s.id, label: s.label, type: s.type })),
    rewardDays: SPIN_REWARD_DAYS,
    oneSpinPer: 'DAY'
};

export const TOTAL_WEIGHT = SPIN_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

/**
 * Weighted random prize picker.
 * @param {Function} rng - optional deterministic random source (default Math.random)
 * @returns segment object from SPIN_SEGMENTS
 */
export function pickSpinPrize(rng = Math.random) {
    let roll = rng() * TOTAL_WEIGHT;
    for (const segment of SPIN_SEGMENTS) {
        roll -= segment.weight;
        if (roll < 0) return segment;
    }
    return SPIN_SEGMENTS[SPIN_SEGMENTS.length - 1];
}

/** Local server date key YYYY-MM-DD used for the once-per-day check */
export function getTodayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function canPlayToday(lastPlayDateKey, todayKey = getTodayKey()) {
    return lastPlayDateKey !== todayKey;
}

/** Expiry timestamp exactly N days from now */
export function getExpiryDate(from = new Date(), days = SPIN_REWARD_DAYS) {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Milliseconds remaining until midnight local time (for next-spin countdown) */
export function msUntilMidnight(now = new Date()) {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
}
