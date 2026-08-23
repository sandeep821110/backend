import Order from '../models/orderModel.js';
import Payment from '../models/paymentModel.js';
import Product from '../models/productModel.js';
import Cart from '../models/cartModel.js';
import Address from '../models/addressModel.js';
import OrderTracking from '../models/orderTrackingModel.js';
import { notifyOrderStatusChange } from './orderTrackingController.js';
import {
    validateFreeDeliveryReward,
    consumeFreeDeliveryReward
} from '../services/spinGameService.js';
import mongoose from 'mongoose';

// Generate unique order number
const generateOrderNumber = () => {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `ORD${timestamp}${random}`;
};

// Update utility function for stock management
const updateProductStock = async (items, operation = 'decrease', session = null) => {
    try {
        for (const item of items) {
            const product = await Product.findById(item.product);
            if (!product) {
                console.error(`Product not found: ${item.product}`);
                continue;
            }

            const sizeIndex = product.sizeQuantity.findIndex(
                sq => sq.size === item.size
            );

            if (sizeIndex === -1) {
                console.error(`Size ${item.size} not found for product: ${item.product}`);
                continue;
            }

            const increment = operation === 'decrease' ? -item.quantity : item.quantity;
            product.sizeQuantity[sizeIndex].quantity += increment;

            if (session) {
                await product.save({ session });
            } else {
                await product.save();
            }

            console.log(`Stock updated for ${product.name} size ${item.size}: ${operation} by ${item.quantity}. New stock: ${product.sizeQuantity[sizeIndex].quantity}`);
        }
    } catch (error) {
        console.error('Error updating product stock:', error);
        throw error;
    }
};

// Create new order
export const createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user.id;
        const { shippingAddressId, paymentMethod, couponCode, freeDeliveryCode } = req.body;

        // Validate free delivery coupon early (invalid codes abort before anything is written)
        let freeDeliveryApplied = false;
        if (freeDeliveryCode) {
            await validateFreeDeliveryReward(userId, freeDeliveryCode);
            freeDeliveryApplied = true;
        }

        // Get user's cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        // Verify shipping address
        const shippingAddress = await Address.findOne({
            _id: shippingAddressId,
            user: userId,
            isActive: true
        });
        if (!shippingAddress) {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: 'Invalid shipping address'
            });
        }

        // Check stock availability for all items
        for (const item of cart.items) {
            const sizeData = item.product.sizeQuantity.find(
                sq => sq.size === item.size
            );
            
            if (!sizeData || sizeData.quantity < item.quantity) {
                await session.abortTransaction();
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.product.name} size ${item.size}. Available: ${sizeData?.quantity || 0}, Requested: ${item.quantity}`
                });
            }
        }

        // Calculate totals
        const subtotal = cart.totalAmount;
        const shippingCharges = freeDeliveryApplied ? 0 : 30;
        const tax = 0;
        const totalAmount = subtotal + shippingCharges;

        // Create order
        const order = new Order({
            user: userId,
            orderNumber: generateOrderNumber(),
            items: cart.items.map(item => ({
                product: item.product._id,
                productName: item.product.name,
                productImage: item.product.firstImage || '',
                quantity: item.quantity,
                price: item.price,
                size: item.size
            })),
            shippingAddress: shippingAddressId,
            paymentMethod,
            subtotal,
            shippingCharges,
            tax,
            totalAmount,
            couponCode,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });

        await order.save({ session });

        // Update product stock
        await updateProductStock(cart.items, 'decrease', session);

        // Clear cart
        await Cart.findOneAndUpdate(
            { user: userId },
            { $set: { items: [], totalAmount: 0, totalItems: 0 } },
            { session }
        );

        await session.commitTransaction();

        // Consume the free delivery coupon now that the order is committed
        if (freeDeliveryApplied && freeDeliveryCode) {
            try {
                await consumeFreeDeliveryReward(userId, freeDeliveryCode, order._id);
            } catch (rewardError) {
                console.error('Failed to consume free delivery coupon:', rewardError.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: { order }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error: error.message
        });
    } finally {
        session.endSession();
    }
};

// Get all orders for a user
export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10, status } = req.query;

        const query = { user: userId };
        if (status) {
            query.orderStatus = status.toUpperCase();
        }

        const orders = await Order.find(query)
            .populate('items.product', 'name price image category')
            .populate('shippingAddress')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments(query);

        res.status(200).json({
            success: true,
            message: 'Orders retrieved successfully',
            data: orders,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalOrders: total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

// Get single order by ID
export const getOrderById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID format'
            });
        }

        const order = await Order.findOne({ _id: id, user: userId })
            .populate('items.product', 'name price image category brand')
            .populate('shippingAddress')
            .populate('user', 'name email phoneNumber');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Get payment details
        const payment = await Payment.findOne({ order: id });

        res.status(200).json({
            success: true,
            message: 'Order retrieved successfully',
            data: {
                order,
                payment
            }
        });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order',
            error: error.message
        });
    }
};

// Get order by order number
export const getOrderByNumber = async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderNumber } = req.params;

        const order = await Order.findOne({ orderNumber, user: userId })
            .populate('items.product', 'name price image category brand')
            .populate('shippingAddress')
            .populate('user', 'name email phoneNumber');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Get payment details
        const payment = await Payment.findOne({ order: order._id });

        res.status(200).json({
            success: true,
            message: 'Order retrieved successfully',
            data: {
                order,
                payment
            }
        });
    } catch (error) {
        console.error('Error fetching order by number:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order',
            error: error.message
        });
    }
};

// Cancel order
export const cancelOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { reason } = req.body;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID format'
            });
        }

        const order = await Order.findOne({ _id: id, user: userId });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Check if order can be cancelled
        if (!['PLACED', 'CONFIRMED'].includes(order.orderStatus)) {
            return res.status(400).json({
                success: false,
                message: 'Order cannot be cancelled at this stage'
            });
        }

        // Update order status
        order.orderStatus = 'CANCELLED';
        order.notes = reason ? `Cancelled: ${reason}` : 'Cancelled by user';
        await order.save();

        // Restore product stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: item.quantity } }
            );
        }

        // Update payment status if paid
        if (order.paymentStatus === 'PAID') {
            const payment = await Payment.findOne({ order: id });
            if (payment) {
                payment.status = 'REFUNDED';
                await payment.save();
            }
        }

        res.status(200).json({
            success: true,
            message: 'Order cancelled successfully',
            data: order
        });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel order',
            error: error.message
        });
    }
};

// Get order statistics for user
export const getOrderStats = async (req, res) => {
    try {
        const userId = req.user.id;

        const stats = await Order.aggregate([
            { $match: { user: userId } },
            {
                $group: {
                    _id: '$orderStatus',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' }
                }
            }
        ]);

        const totalOrders = await Order.countDocuments({ user: userId });
        const totalSpent = await Order.aggregate([
            { $match: { user: userId, paymentStatus: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        res.status(200).json({
            success: true,
            message: 'Order statistics retrieved successfully',
            data: {
                totalOrders,
                totalSpent: totalSpent[0]?.total || 0,
                statusBreakdown: stats
            }
        });
    } catch (error) {
        console.error('Error fetching order stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order statistics',
            error: error.message
        });
    }
};

// Admin: Get all orders
export const getAllOrders = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            status, 
            paymentStatus, 
            paymentMethod,
            startDate,
            endDate,
            search
        } = req.query;

        const query = {};

        // Filter by status
        if (status) {
            query.orderStatus = status.toUpperCase();
        }

        // Filter by payment status
        if (paymentStatus) {
            query.paymentStatus = paymentStatus.toUpperCase();
        }

        // Filter by payment method
        if (paymentMethod) {
            query.paymentMethod = paymentMethod.toUpperCase();
        }

        // Filter by date range
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                query.createdAt.$lte = new Date(endDate);
            }
        }

        // Search by order number or user details
        if (search) {
            query.$or = [
                { orderNumber: { $regex: search, $options: 'i' } },
                { trackingNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const orders = await Order.find(query)
            .populate('user', 'name email phoneNumber')
            .populate('items.product', 'name price image category')
            .populate('shippingAddress')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments(query);

        res.status(200).json({
            success: true,
            message: 'Orders retrieved successfully',
            data: orders,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalOrders: total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching all orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

// Admin: Update order status
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderStatus, trackingNumber, notes } = req.body;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID format'
            });
        }

        const validStatuses = ['PLACED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
        
        if (orderStatus && !validStatuses.includes(orderStatus.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order status'
            });
        }

        const order = await Order.findById(id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Update order fields
        if (orderStatus) {
            order.orderStatus = orderStatus.toUpperCase();
        }

        if (trackingNumber) {
            order.trackingNumber = trackingNumber;
        }

        if (notes) {
            order.notes = notes;
        }

        // Set delivery date if status is DELIVERED
        if (orderStatus && orderStatus.toUpperCase() === 'DELIVERED') {
            order.actualDelivery = new Date();
        }

        await order.save();

        res.status(200).json({
            success: true,
            message: 'Order status updated successfully',
            data: order
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error: error.message
        });
    }
};

// Admin: Get order analytics
export const getOrderAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const matchStage = {};
        if (startDate || endDate) {
            matchStage.createdAt = {};
            if (startDate) {
                matchStage.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                matchStage.createdAt.$lte = new Date(endDate);
            }
        }

        const analytics = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    statusBreakdown: {
                        $push: '$orderStatus'
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.status(200).json({
            success: true,
            message: 'Order analytics retrieved successfully',
            data: analytics
        });
    } catch (error) {
        console.error('Error fetching order analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order analytics',
            error: error.message
        });
    }
};

// Export orders to CSV/JSON
export const exportOrders = async (req, res) => {
    try {
        const { 
            format = 'json', 
            startDate, 
            endDate, 
            status, 
            paymentStatus 
        } = req.query;

        // Build filter
        const filter = {};
        
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }
        
        if (status) filter.orderStatus = status.toUpperCase();
        if (paymentStatus) filter.paymentStatus = paymentStatus.toUpperCase();

        const orders = await Order.find(filter)
            .populate('user', 'name email')
            .populate('shippingAddress')
            .populate('items.product', 'name price')
            .sort({ createdAt: -1 });

        if (format === 'csv') {
            // Convert to CSV format
            const csvData = orders.map(order => ({
                orderNumber: order.orderNumber,
                customerName: order.user?.name || '',
                customerEmail: order.user?.email || '',
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                totalAmount: order.totalAmount,
                createdAt: order.createdAt.toISOString(),
                itemsCount: order.items.length
            }));

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
            
            // Simple CSV conversion (you might want to use a proper CSV library)
            const csvHeaders = Object.keys(csvData[0] || {}).join(',');
            const csvRows = csvData.map(row => Object.values(row).join(','));
            const csvContent = [csvHeaders, ...csvRows].join('\n');
            
            return res.send(csvContent);
        }

        // Default JSON format
        res.status(200).json({
            success: true,
            message: 'Orders exported successfully',
            data: orders,
            count: orders.length,
            exportedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error exporting orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export orders',
            error: error.message
        });
    }
};

// Get order by ID for admin (with all details)
export const getOrderByIdAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID format'
            });
        }

        const order = await Order.findById(id)
            .populate('user', 'name email phone')
            .populate('shippingAddress')
            .populate('items.product');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Order retrieved successfully',
            data: order
        });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order',
            error: error.message
        });
    }
};

// Get orders by date range
export const getOrdersByDateRange = async (req, res) => {
    try {
        const { startDate, endDate, page = 1, limit = 10 } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        const filter = {
            createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            }
        };

        const orders = await Order.find(filter)
            .populate('user', 'name email')
            .populate('shippingAddress')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: 'Orders retrieved successfully',
            data: {
                orders,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                totalOrders: total,
                dateRange: { startDate, endDate }
            }
        });
    } catch (error) {
        console.error('Error fetching orders by date range:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

// Get orders by status
export const getOrdersByStatus = async (req, res) => {
    try {
        const { status } = req.params;
        const { page = 1, limit = 10 } = req.query;

        const validStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
        
        if (!validStatuses.includes(status.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order status'
            });
        }

        const orders = await Order.find({ orderStatus: status.toUpperCase() })
            .populate('user', 'name email')
            .populate('shippingAddress')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments({ orderStatus: status.toUpperCase() });

        res.status(200).json({
            success: true,
            message: `Orders with status ${status} retrieved successfully`,
            data: {
                orders,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                totalOrders: total,
                status: status.toUpperCase()
            }
        });
    } catch (error) {
        console.error('Error fetching orders by status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

// Bulk update order status
export const bulkUpdateOrderStatus = async (req, res) => {
    try {
        const { orderIds, newStatus } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order IDs array is required'
            });
        }

        const validStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
        
        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order status'
            });
        }

        const result = await Order.updateMany(
            { _id: { $in: orderIds } },
            { 
                orderStatus: newStatus,
                updatedAt: new Date()
            }
        );

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} orders updated successfully`,
            data: {
                modifiedCount: result.modifiedCount,
                newStatus
            }
        });
    } catch (error) {
        console.error('Error bulk updating orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update orders',
            error: error.message
        });
    }
};

// Add order tracking
export const addOrderTracking = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber, carrier, estimatedDelivery } = req.body;

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number is required'
            });
        }

        const order = await Order.findById(id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        order.trackingNumber = trackingNumber;
        if (carrier) order.carrier = carrier;
        if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery);
        
        await order.save();

        res.status(200).json({
            success: true,
            message: 'Tracking information added successfully',
            data: order
        });
    } catch (error) {
        console.error('Error adding tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add tracking information',
            error: error.message
        });
    }
};

// Update order tracking
export const updateOrderTracking = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber, carrier, estimatedDelivery } = req.body;

        const order = await Order.findById(id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (trackingNumber) order.trackingNumber = trackingNumber;
        if (carrier) order.carrier = carrier;
        if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery);
        
        await order.save();

        res.status(200).json({
            success: true,
            message: 'Tracking information updated successfully',
            data: order
        });
    } catch (error) {
        console.error('Error updating tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update tracking information',
            error: error.message
        });
    }
};

// Refund order
export const refundOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { refundAmount, reason } = req.body;

        const order = await Order.findById(id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (order.paymentStatus === 'REFUNDED') {
            return res.status(400).json({
                success: false,
                message: 'Order is already refunded'
            });
        }

        // Update order status
        order.paymentStatus = 'REFUNDED';
        order.orderStatus = 'CANCELLED';
        order.notes = reason ? `Refunded: ${reason}` : 'Refunded by admin';
        
        await order.save();

        // Update payment record if exists
        const payment = await Payment.findOne({ order: id });
        if (payment) {
            payment.status = 'REFUNDED';
            payment.refundAmount = refundAmount || order.totalAmount;
            await payment.save();
        }

        res.status(200).json({
            success: true,
            message: 'Order refunded successfully',
            data: order
        });
    } catch (error) {
        console.error('Error refunding order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refund order',
            error: error.message
        });
    }
};

// Get order timeline
export const getOrderTimeline = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({
            _id: id,
            user: userId
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Create timeline based on order status and timestamps
        const timeline = [
            {
                status: 'PENDING',
                timestamp: order.createdAt,
                description: 'Order placed successfully'
            }
        ];

        // Add more timeline events based on your order status flow
        if (order.orderStatus !== 'PENDING') {
            timeline.push({
                status: order.orderStatus,
                timestamp: order.updatedAt,
                description: `Order ${order.orderStatus.toLowerCase()}`
            });
        }

        res.status(200).json({
            success: true,
            message: 'Order timeline retrieved successfully',
            data: {
                orderNumber: order.orderNumber,
                currentStatus: order.orderStatus,
                timeline
            }
        });
    } catch (error) {
        console.error('Error fetching order timeline:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order timeline',
            error: error.message
        });
    }
};

// Function to handle order confirmation and stock update
export const confirmOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Check if order is already confirmed
        if (order.orderStatus !== 'PLACED') {
            return res.status(400).json({
                success: false,
                message: 'Order cannot be confirmed at this stage'
            });
        }

        // Update order status
        order.orderStatus = 'CONFIRMED';
        order.confirmedAt = new Date();
        await order.save();

        // Update product stock (if not already done during order creation)
        await updateProductStock(order.items, 'decrease');

        // update tracking (non-blocking failure safe)
        try {
          await notifyOrderStatusChange(order._id, 'order_confirmed', 'Warehouse', 'Order confirmed');
        } catch (err) {
          console.error('Order tracking update failed:', err.message);
        }

        res.status(200).json({
            success: true,
            message: 'Order confirmed and stock updated successfully',
            data: order
        });
    } catch (error) {
        console.error('Error confirming order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to confirm order',
            error: error.message
        });
    }
};

// Admin: permanently delete any order and its related records
export const deleteOrderAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID'
            });
        }

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        await Promise.all([
            OrderTracking.deleteMany({ $or: [{ orderId: id }, { orders: id }] }),
            Payment.deleteMany({ order: id })
        ]);

        await Order.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: `Order ${order.orderNumber || order._id} deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete order',
            error: error.message
        });
    }
};
