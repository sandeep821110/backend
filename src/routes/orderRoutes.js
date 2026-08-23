
import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    createOrder,
    getUserOrders,
    getOrderById,
    getOrderByNumber,
    cancelOrder,
    getOrderStats,
    getAllOrders,
    updateOrderStatus,
    getOrderAnalytics,
    // Add these new imports
    getOrderByIdAdmin,
    bulkUpdateOrderStatus,
    getOrdersByDateRange,
    getOrdersByStatus,
    exportOrders,
    addOrderTracking,
    updateOrderTracking,
    refundOrder,
    getOrderTimeline,
    confirmOrder, // Add this new import
    deleteOrderAdmin
} from '../controller/orderController.js';

const orderRouter = express.Router();

// User routes (require authentication)
orderRouter.use(protect);

// Create new order
orderRouter.post('/', createOrder);

// Get user's orders with pagination and filters
orderRouter.get('/', getUserOrders);

// Get user's order statistics
orderRouter.get('/stats', getOrderStats);

// Get order by order number
orderRouter.get('/number/:orderNumber', getOrderByNumber);

// Get single order by ID
orderRouter.get('/:id', getOrderById);

// Cancel order
orderRouter.patch('/:id/cancel', cancelOrder);

// Get order timeline/history
orderRouter.get('/:id/timeline', getOrderTimeline);

// Admin routes (require authentication + admin privileges)
orderRouter.get('/admin/all', adminOnly, getAllOrders);
orderRouter.get('/admin/analytics', adminOnly, getOrderAnalytics);
orderRouter.get('/admin/:id', adminOnly, getOrderByIdAdmin);
orderRouter.patch('/admin/:id/status', adminOnly, updateOrderStatus);
orderRouter.delete('/admin/:id', adminOnly, deleteOrderAdmin);

// Additional admin functionalities
orderRouter.get('/admin/date-range', adminOnly, getOrdersByDateRange);
orderRouter.get('/admin/status/:status', adminOnly, getOrdersByStatus);
orderRouter.post('/admin/bulk-update', adminOnly, bulkUpdateOrderStatus);
orderRouter.get('/admin/export', adminOnly, exportOrders);

// Order tracking management
orderRouter.post('/admin/:id/tracking', adminOnly, addOrderTracking);
orderRouter.patch('/admin/:id/tracking', adminOnly, updateOrderTracking);

// Refund management
orderRouter.post('/admin/:id/refund', adminOnly, refundOrder);

// Add this route in your router setup
// router.put('/confirm/:id', protect, adminOnly, confirmOrder);

export default orderRouter;
