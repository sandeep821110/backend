import Wallet from '../models/walletModel.js';
import SpinReward from '../models/spinRewardModel.js';
import {
    SPIN_REWARD_DAYS,
    SPIN_SEGMENTS,
    WHEEL_CONFIG,
    pickSpinPrize,
    getTodayKey,
    canPlayToday,
    getExpiryDate,
    msUntilMidnight
} from '../utils/spinMath.js';

// ---------------------------------------------------------------------------
// Spin game configuration lives in utils/spinMath.js (pure, unit-tested).
// Wheel has 6 segments. Cash prizes are credited to the wallet and expire
// 7 days after winning if not spent. FREE_DELIVERY issues a single-use coupon
// that also expires in 7 days. TRY_AGAIN awards nothing.
// ---------------------------------------------------------------------------

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

// --------------------------- DB orchestration ---------------------------

/**
 * Play the daily spin game for a user.
 * Enforces one spin per day, credits cash prizes with a 7-day expiry and
 * creates free-delivery coupons. Returns everything the client needs.
 */
export async function playSpinGame(userId, now = new Date()) {
    const wallet = await Wallet.getOrCreateWallet(userId);

    // Auto-expire any winnings older than 7 days before checking eligibility
    await wallet.expireJackpotWinnings();

    const todayKey = getTodayKey(now);
    if (!canPlayToday(wallet.lastJackpotPlayDate, todayKey)) {
        const err = new Error('You already spun the wheel today. Come back tomorrow!');
        err.status = 429;
        throw err;
    }

    const prize = pickSpinPrize();

    // Record the play regardless of outcome so it is strictly once per day
    wallet.lastJackpotPlayDate = todayKey;
    wallet.lastJackpotPlayAt = now;

    let couponCode = null;

    if (prize.type === 'CASH') {
        const amount = round2(prize.value);
        const expiresAt = getExpiryDate(now);

        wallet.balance = round2(wallet.balance + amount);
        wallet.totalJackpotWon = round2((wallet.totalJackpotWon || 0) + amount);
        wallet.jackpotWinCount = (wallet.jackpotWinCount || 0) + 1;
        wallet.jackpotEntries.push({ amount, wonAt: now, expiresAt });

        wallet.pushTxn({
            type: 'CREDIT',
            amount,
            source: 'SPIN_WIN',
            description: `Spin game win ₹${amount} (valid ${SPIN_REWARD_DAYS} days)`,
            status: 'SUCCESS'
        });
    } else if (prize.type === 'FREE_DELIVERY') {
        couponCode = SpinReward.generateCode();
        await SpinReward.create({
            user: userId,
            code: couponCode,
            wonAt: now,
            expiresAt: getExpiryDate(now)
        });
    }

    await wallet.save();

    return {
        prize: {
            id: prize.id,
            label: prize.label,
            type: prize.type,
            value: prize.value,
            couponCode
        },
        wallet: {
            balance: round2(wallet.balance)
        },
        playedAt: now,
        nextPlayAvailableAt: new Date(new Date(now).setHours(24, 0, 0, 0))
    };
}

/** Status payload: whether the user can spin right now + their live coupons */
export async function getSpinStatus(userId) {
    const wallet = await Wallet.getOrCreateWallet(userId);
    await wallet.expireJackpotWinnings();

    const activeRewards = await SpinReward.find({
        user: userId,
        used: false,
        expiresAt: { $gt: new Date() }
    }).sort({ expiresAt: 1 }).lean();

    return {
        canPlay: canPlayToday(wallet.lastJackpotPlayDate),
        lastPlayedAt: wallet.lastJackpotPlayAt,
        nextPlayInMs: canPlayToday(wallet.lastJackpotPlayDate) ? 0 : msUntilMidnight(),
        wheel: WHEEL_CONFIG,
        activeRewards: activeRewards.map(r => ({
            code: r.code,
            type: r.type,
            wonAt: r.wonAt,
            expiresAt: r.expiresAt
        }))
    };
}

/**
 * Validate a free-delivery coupon at checkout time (does NOT consume it).
 * Throws with a user-facing message when invalid.
 */
export async function validateFreeDeliveryReward(userId, code) {
    if (!code) {
        const err = new Error('Free delivery coupon code is required');
        err.status = 400;
        throw err;
    }
    const reward = await SpinReward.findActiveByCode(code, userId);
    if (!reward) {
        const err = new Error('Invalid or expired free delivery coupon');
        err.status = 400;
        throw err;
    }
    return reward;
}

/** Consume the coupon after an order was created successfully */
export async function consumeFreeDeliveryReward(userId, code, orderId) {
    const reward = await SpinReward.markUsed(code, userId, orderId);
    if (!reward) {
        const err = new Error('Free delivery coupon could not be applied');
        err.status = 400;
        throw err;
    }
    return reward;
}
