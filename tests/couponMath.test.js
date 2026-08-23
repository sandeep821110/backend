import { computeCouponDiscount, isCouponLive } from '../src/utils/couponMath.js';

describe('couponMath', () => {
    describe('computeCouponDiscount', () => {
        test('PERCENTAGE coupon computes percent of subtotal', () => {
            const coupon = { discountType: 'PERCENTAGE', discountValue: 25 };
            expect(computeCouponDiscount(coupon, 1000)).toBe(250);
        });

        test('PERCENTAGE respects maximumDiscount cap', () => {
            const coupon = { discountType: 'PERCENTAGE', discountValue: 50, maximumDiscount: 100 };
            expect(computeCouponDiscount(coupon, 1000)).toBe(100);
        });

        test('PERCENTAGE without cap can exceed fixed values', () => {
            const coupon = { discountType: 'PERCENTAGE', discountValue: 50 };
            expect(computeCouponDiscount(coupon, 1000)).toBe(500);
        });

        test('FIXED coupon gives flat amount', () => {
            const coupon = { discountType: 'FIXED', discountValue: 200 };
            expect(computeCouponDiscount(coupon, 1000)).toBe(200);
        });

        test('FIXED never exceeds subtotal', () => {
            const coupon = { discountType: 'FIXED', discountValue: 500 };
            expect(computeCouponDiscount(coupon, 300)).toBe(300);
        });

        test('discount never below zero for weird inputs', () => {
            const coupon = { discountType: 'FIXED', discountValue: -50 };
            expect(computeCouponDiscount(coupon, 300)).toBe(0);
        });

        test('rounds to two decimals', () => {
            const coupon = { discountType: 'PERCENTAGE', discountValue: 15 };
            expect(computeCouponDiscount(coupon, 333)).toBe(49.95);
        });

        test('returns 0 for missing coupon or non-positive subtotal', () => {
            expect(computeCouponDiscount(null, 100)).toBe(0);
            expect(computeCouponDiscount({ discountType: 'FIXED', discountValue: 10 }, 0)).toBe(0);
            expect(computeCouponDiscount({ discountType: 'FIXED', discountValue: 10 }, -5)).toBe(0);
        });
    });

    describe('isCouponLive', () => {
        const now = new Date('2026-06-15T12:00:00Z');

        test('active coupon inside date window is live', () => {
            const coupon = {
                isActive: true,
                startDate: new Date('2026-06-01'),
                endDate: new Date('2026-06-30'),
                usedCount: 5,
                usageLimit: 100
            };
            expect(isCouponLive(coupon, now)).toBe(true);
        });

        test('inactive coupon is not live', () => {
            const coupon = { isActive: false, startDate: '2026-06-01', endDate: '2026-06-30' };
            expect(isCouponLive(coupon, now)).toBe(false);
        });

        test('expired coupon is not live', () => {
            const coupon = { isActive: true, startDate: '2026-05-01', endDate: '2026-06-10' };
            expect(isCouponLive(coupon, now)).toBe(false);
        });

        test('not-yet-started coupon is not live', () => {
            const coupon = { isActive: true, startDate: '2026-07-01', endDate: '2026-08-01' };
            expect(isCouponLive(coupon, now)).toBe(false);
        });

        test('exhausted usage limit is not live', () => {
            const coupon = { isActive: true, startDate: '2026-06-01', endDate: '2026-06-30', usedCount: 10, usageLimit: 10 };
            expect(isCouponLive(coupon, now)).toBe(false);
        });

        test('null usage limit means unlimited uses', () => {
            const coupon = { isActive: true, startDate: '2026-06-01', endDate: '2026-06-30', usedCount: 9999, usageLimit: null };
            expect(isCouponLive(coupon, now)).toBe(true);
        });
    });
});
