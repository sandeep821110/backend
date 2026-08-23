import express from 'express';
import {
    createOrder,
    createCODOrder,
    verifyRazorpayPaymentAndCreateOrder,
    createRazorpayOrderForPayment,
    getPaymentById,
    getPaymentHistory,
    getPaymentDetails,
    getAllPayments,
    getPaymentAnalytics,
    refundPayment,
    initiateRefund,
    // Coupon related imports
    createCoupon,
    getAllCoupons,
    updateCoupon,
    deleteCoupon,
    validateCoupon
} from '../controller/paymentController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const paymentRouter = express.Router();

// All payment routes require authentication
paymentRouter.use(protect);

// Coupon routes
paymentRouter.get('/coupons/validate/:code', validateCoupon);

// Admin coupon routes
paymentRouter.post('/admin/coupons', adminOnly, createCoupon);
paymentRouter.get('/admin/coupons', adminOnly, getAllCoupons);
paymentRouter.put('/admin/coupons/:id', adminOnly, updateCoupon);
paymentRouter.delete('/admin/coupons/:id', adminOnly, deleteCoupon);

// COD order creation
paymentRouter.post('/cod', createCODOrder);

// Create Razorpay order for payment (step 1)
paymentRouter.post('/create-razorpay-order', createRazorpayOrderForPayment);


// Verify payment and create order (step 2)
paymentRouter.post('/verify-and-create-order', verifyRazorpayPaymentAndCreateOrder);

// Get user's payment history
paymentRouter.get('/history', getPaymentHistory);

// Get payment details by ID
paymentRouter.get('/details/:id', getPaymentDetails);

// Get payment by ID
paymentRouter.get('/:id', getPaymentById);

// Initiate refund (user can request)
paymentRouter.post('/:id/refund', initiateRefund);

// Admin routes
paymentRouter.get('/admin/all', adminOnly, getAllPayments);
paymentRouter.get('/admin/analytics', adminOnly, getPaymentAnalytics);
paymentRouter.post('/admin/:id/refund', adminOnly, refundPayment);

export default paymentRouter;
