/**
 * Pure coupon discount math — no DB dependencies (unit tested with Jest).
 */

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Compute the discount a coupon gives on a subtotal.
 * @param {{discountType:'PERCENTAGE'|'FIXED'|'FREE_DELIVERY', discountValue:number, maximumDiscount?:number|null}} coupon
 * @param {number} subtotal
 * @returns {number} rounded discount amount
 */
export function computeCouponDiscount(coupon, subtotal) {
    if (!coupon || typeof subtotal !== 'number' || !(subtotal > 0)) return 0;

    // FREE_DELIVERY coupons give ₹0 price discount — shipping is handled separately
    if (coupon.discountType === 'FREE_DELIVERY') return 0;

    let discount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
        discount = Math.min(
            (subtotal * coupon.discountValue) / 100,
            coupon.maximumDiscount || Infinity
        );
    } else {
        discount = Math.min(coupon.discountValue || 0, subtotal);
    }

    if (!isFinite(discount) || discount < 0) discount = 0;
    return round2(discount);
}

/**
 * Whether the coupon is currently valid against its own date window,
 * active flag and global usage limit. Does NOT check minimumPurchase
 * (that depends on the cart).
 */
export function isCouponLive(coupon, now = new Date()) {
    if (!coupon) return false;
    const startOk = !coupon.startDate || new Date(coupon.startDate) <= now;
    const endOk = !coupon.endDate || new Date(coupon.endDate) >= now;
    const limitOk = !coupon.usageLimit || coupon.usedCount < coupon.usageLimit;
    return !!coupon.isActive && startOk && endOk && limitOk;
}
