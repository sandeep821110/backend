import Razorpay from 'razorpay';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Payment from '../models/paymentModel.js';
import Order from '../models/orderModel.js';
import Address from '../models/addressModel.js';
import Cart from '../models/cartModel.js';
import Product from '../models/productModel.js';
import Coupon from '../models/couponModel.js';
import { computeCouponDiscount, isCouponLive } from '../utils/couponMath.js';
import { creditWallet, debitWallet } from './walletController.js';
import {
    validateFreeDeliveryReward,
    consumeFreeDeliveryReward
} from '../services/spinGameService.js';
import razorpayClient from '../utils/razorpayClient.js';

// Initialize Razorpay (shared client)
const razorpay = razorpayClient;

// Utility function to generate order number
const generateOrderNumber = () => {
    return `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
};

// Utility function to generate transaction ID
const generateTransactionId = () => {
    return `TXN${Date.now()}${Math.floor(Math.random() * 10000)}`;
};

// Utility function to validate ObjectId
const isValidObjectId = (id) => {
    return id && id.match(/^[0-9a-fA-F]{24}$/);
};

// Utility function to calculate order totals (with coupon + optional wallet balance + free delivery coupon)
const calculateOrderTotals = async (cartItems, couponCode = null, userId = null, useWalletBalance = false, freeDeliveryCode = null) => {
    const subtotal = cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
    let shippingCharges = subtotal >= 999 ? 0 : 49; // Free shipping above ₹999
    const tax = 0;
    let discount = 0;
    let freeDeliveryApplied = false;

    // Apply spin-game free delivery coupon (validates ownership, usage and 7-day expiry)
    if (freeDeliveryCode && userId) {
        await validateFreeDeliveryReward(userId, freeDeliveryCode);
        shippingCharges = 0;
        freeDeliveryApplied = true;
    }

    // Apply coupon discount if provided
    if (couponCode) {
        const coupon = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            isActive: true,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        });

        if (coupon) {
            if (subtotal >= coupon.minimumPurchase) {
                discount = computeCouponDiscount(coupon, subtotal);

                // FREE_DELIVERY coupon: waive shipping charges
                if (coupon.discountType === 'FREE_DELIVERY') {
                    shippingCharges = 0;
                    freeDeliveryApplied = true;
                }

                // Update usage count
                await Coupon.findByIdAndUpdate(coupon._id, {
                    $inc: { usedCount: 1 }
                });
            }
        }
    }

    let totalAmount = Math.round((subtotal + shippingCharges + tax - discount) * 100) / 100;

    // Apply wallet balance if requested (never more than the payable amount)
    let walletApplied = 0;
    if (useWalletBalance && userId) {
        const Wallet = (await import('../models/walletModel.js')).default;
        const wallet = await Wallet.findOne({ user: userId });
        if (wallet && wallet.balance > 0) {
            walletApplied = Math.min(Math.round(wallet.balance * 100) / 100, totalAmount);
            totalAmount = Math.round((totalAmount - walletApplied) * 100) / 100;
        }
    }

    return {
        subtotal,
        shippingCharges,
        tax,
        discount,
        walletApplied,
        freeDeliveryApplied,
        totalAmount
    };
};

// Validate cart and stock
const validateCartAndStock = async (cart) => {
    if (!cart || cart.items.length === 0) {
        throw new Error('Cart is empty');
    }

    const stockErrors = [];
    for (const item of cart.items) {
        if (!item.product) {
            stockErrors.push(`Product not found for cart item`);
            continue;
        }

        // Check size-specific quantity
        const sizeData = item.product.sizeQuantity.find(sq => sq.size === item.size);
        if (!sizeData) {
            stockErrors.push(`Size ${item.size} not available for ${item.product.name}`);
            continue;
        }

        if (sizeData.quantity < item.quantity) {
            stockErrors.push(
                `Insufficient stock for ${item.product.name} size ${item.size}. Available: ${sizeData.quantity}, Requested: ${item.quantity}`
            );
        }
    }

    if (stockErrors.length > 0) {
        throw new Error(`Stock validation failed: ${stockErrors.join(', ')}`);
    }

    return true;
};

// Validate and get address
const validateAndGetAddress = async (addressId, userId) => {
    let address;
    if (!addressId) {
        address = await Address.findOne({ user: userId, isDefault: true, isActive: true });
        if (!address) {
            throw new Error('No address selected or set as default.');
        }
        return address;
    } else {
        if (!isValidObjectId(addressId)) {
            throw new Error('Invalid address ID format');
        }
        address = await Address.findOne({ _id: addressId, user: userId, isActive: true });
        if (!address) {
            throw new Error('Address not found');
        }
        return address;
    }
};

// Update product stock
const updateProductStock = async (cartItems, session = null) => {
    for (const item of cartItems) {
        const product = await Product.findById(item.product._id);
        if (!product) continue;

        const sizeIndex = product.sizeQuantity.findIndex(sq => sq.size === item.size);
        if (sizeIndex === -1) continue;

        product.sizeQuantity[sizeIndex].quantity -= item.quantity;

        if (session) {
            await product.save({ session });
        } else {
            await product.save();
        }
    }
};

// Clear user cart
const clearUserCart = async (userId) => {
    await Cart.findOneAndUpdate(
        { user: userId },
        { $set: { items: [], totalAmount: 0, totalItems: 0 } }
    );
};

// Remove only specific items from cart (by their _id), keep the rest
const removeCartItems = async (userId, itemIds) => {
    if (!itemIds || itemIds.length === 0) return;
    await Cart.findOneAndUpdate(
        { user: userId },
        { $pull: { items: { _id: { $in: itemIds } } } },
        { new: true }
    );
    // Recalculate totals
    const cart = await Cart.findOne({ user: userId });
    if (cart) {
        cart.totalAmount = cart.items.reduce((t, i) => t + (i.price * i.quantity), 0);
        cart.totalItems = cart.items.reduce((t, i) => t + i.quantity, 0);
        await cart.save();
    }
};

// Filter cart items to only the selected ones (by _id). If no selection provided, use all items (backwards compat).
const filterCartItems = (cartItems, selectedItemIds) => {
    if (!selectedItemIds || !Array.isArray(selectedItemIds) || selectedItemIds.length === 0) {
        return cartItems; // backwards compat: no selection = all items
    }
    return cartItems.filter(item => selectedItemIds.includes(String(item._id)));
};

// Create an order fully paid using wallet balance
const createWalletPaidOrder = async (userId, cart, address, totals, couponCode, freeDeliveryCode = null) => {
    // Debit wallet first (throws if insufficient)
    await debitWallet(userId, totals.walletApplied, {
        source: 'ORDER_PAYMENT',
        description: 'Full order payment via wallet',
        referenceId: 'WALLET_ORDER'
    });

    try {
        const orderNumber = generateOrderNumber();
        const transactionId = generateTransactionId();

        const order = new Order({
            user: userId,
            orderNumber,
            items: cart.items.map(item => ({
                product: item.product._id,
                productName: item.product.name,
                productImage: (item.product.images && item.product.images.length > 0) ? item.product.images[0] : '',
                quantity: item.quantity,
                price: item.price,
                size: item.size || '',
                color: item.color || ''
            })),
            shippingAddress: address._id,
            paymentMethod: 'WALLET',
            paymentStatus: 'COMPLETED',
            orderStatus: 'CONFIRMED',
            ...totals,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            notes: '',
            couponCode: couponCode || null
        });

        await order.save();

        // Consume the free delivery coupon now that the order exists
        if (totals.freeDeliveryApplied && freeDeliveryCode) {
            await consumeFreeDeliveryReward(userId, freeDeliveryCode, order._id);
        }

        const payment = new Payment({
            order: order._id,
            user: userId,
            paymentMethod: 'WALLET',
            amount: totals.totalAmount,
            status: 'COMPLETED',
            transactionId,
            currency: 'INR',
            metadata: {
                couponCode: couponCode || null,
                orderNumber: order.orderNumber,
                walletApplied: totals.walletApplied,
                freeDeliveryApplied: !!totals.freeDeliveryApplied
            }
        });

        await payment.save();

        await updateProductStock(cart.items);
        await clearUserCart(userId);

        return order;
    } catch (error) {
        // Compensate: credit wallet back if order creation failed
        await creditWallet(userId, totals.walletApplied, {
            source: 'REFUND',
            description: 'Wallet restored - order creation failed'
        }).catch(() => {});
        throw error;
    }
};

// Get checkout summary
export const getCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addressId, couponCode, useWalletBalance } = req.body;

        // Get user's cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        // Validate cart and stock
        await validateCartAndStock(cart);

        // Validate address
        const address = await validateAndGetAddress(addressId, userId);

        // Calculate totals (including wallet if requested)
        const totals = await calculateOrderTotals(cart.items, couponCode, userId, !!useWalletBalance);

        // Include current wallet balance for the UI
        const Wallet = (await import('../models/walletModel.js')).default;
        const wallet = await Wallet.findOne({ user: userId });

        res.status(200).json({
            success: true,
            message: 'Checkout summary calculated successfully',
            data: {
                cartItems: cart.items.map(item => ({
                    product: item.product._id,
                    productName: item.product.name,
                    productImage: (item.product.images && item.product.images.length > 0) ? item.product.images[0] : '',
                    quantity: item.quantity,
                    price: item.price,
                    size: item.size || '',
                    color: item.color || '',
                    total: item.price * item.quantity
                })),
                address: {
                    _id: address._id,
                    fullName: address.fullName,
                    phoneNumber: address.phoneNumber,
                    addressLine1: address.addressLine1,
                    addressLine2: address.addressLine2,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode,
                    isDefault: address.isDefault
                },
                pricing: totals,
                walletBalance: wallet ? wallet.balance : 0,
                couponCode: couponCode || null,
                availablePaymentMethods: ['COD', 'RAZORPAY']
            }
        });

    } catch (error) {
        console.error('Error calculating checkout summary:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to calculate checkout summary',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Create Razorpay order for payment (Step 1)
export const createRazorpayOrderForPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addressId, couponCode, useWalletBalance, freeDeliveryCode, selectedItemIds } = req.body;

        // Get user's cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        // Validate cart and stock
        await validateCartAndStock(cart);

        // Filter to only selected items
        const orderItems = filterCartItems(cart.items, selectedItemIds);
        if (orderItems.length === 0) {
            return res.status(400).json({ success: false, message: 'No items selected for checkout' });
        }

        // Validate address
        const address = await validateAndGetAddress(addressId, userId);

        // Calculate totals (including wallet and free delivery coupon if requested)
        // Invalid free-delivery codes fail here BEFORE any payment is taken
        const totals = await calculateOrderTotals(orderItems, couponCode, userId, !!useWalletBalance, freeDeliveryCode || null);

        // If wallet covers the entire amount, complete the order without Razorpay
        if (totals.totalAmount <= 0) {
            const order = await createWalletPaidOrder(userId, { items: orderItems }, address, totals, couponCode, freeDeliveryCode || null);
            return res.status(200).json({
                success: true,
                message: 'Order placed successfully using wallet balance',
                data: {
                    walletFullyPaid: true,
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                    totalAmount: order.totalAmount,
                    walletApplied: totals.walletApplied,
                    orderStatus: order.orderStatus,
                    paymentStatus: order.paymentStatus,
                    estimatedDelivery: order.estimatedDelivery
                }
            });
        }

        // Debit wallet portion up-front so it is reserved for this checkout.
        if (totals.walletApplied > 0) {
            try {
                await debitWallet(userId, totals.walletApplied, {
                    source: 'ORDER_PAYMENT',
                    description: 'Wallet applied towards order',
                    referenceId: `RAZORPAY:${address._id}`
                });
            } catch (walletError) {
                return res.status(400).json({
                    success: false,
                    message: walletError.message || 'Failed to apply wallet balance'
                });
            }
        }

        const tempOrderNumber = `TEMP${Date.now()}${Math.floor(Math.random() * 1000)}`;

        // Create Razorpay order for the REMAINING amount after wallet deduction
        const options = {
            amount: Math.round(totals.totalAmount * 100), // Amount in paise
            currency: 'INR',
            receipt: tempOrderNumber,
            notes: {
                userId: userId,
                tempOrderNumber: tempOrderNumber,
                cartItems: cart.items.length,
                addressId: address._id.toString(),
                couponCode: couponCode || '',
                walletApplied: String(totals.walletApplied)
            }
        };

        let razorpayOrder;
        try {
            razorpayOrder = await razorpay.orders.create(options);
        } catch (rzError) {
            // Compensate: refund the debited wallet if Razorpay order creation fails
            if (totals.walletApplied > 0) {
                await creditWallet(userId, totals.walletApplied, {
                    source: 'REFUND',
                    description: 'Wallet restored - payment initiation failed'
                }).catch(() => {});
            }
            throw rzError;
        }

        res.status(200).json({
            success: true,
            message: 'Razorpay order created successfully',
            data: {
                razorpayOrderId: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                key: process.env.RAZORPAY_KEY_ID,
                orderSummary: totals,
                address: {
                    _id: address._id,
                    fullName: address.fullName,
                    phoneNumber: address.phoneNumber,
                    addressLine1: address.addressLine1,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode
                }
            }
        });

    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        const isConfigIssue = !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET;
        res.status(500).json({
            success: false,
            message: isConfigIssue
                ? 'Payment service is not configured. Please contact support.'
                : (error.message || 'Failed to create payment order'),
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Verify Razorpay payment and create order (Step 2)
export const verifyRazorpayPaymentAndCreateOrder = async (req, res) => {
    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            addressId,
            notes,
            couponCode,
            useWalletBalance,
            freeDeliveryCode,
            selectedItemIds
        } = req.body;

        // Validate required fields
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification data'
            });
        }

        // Idempotency guard: don't create duplicate orders for the same razorpay order
        const existingOrder = await Order.findOne({ razorpayOrderId: razorpay_order_id });
        if (existingOrder && existingOrder.paymentStatus === 'COMPLETED') {
            return res.status(200).json({
                success: true,
                message: 'Order already exists for this payment',
                data: {
                    orderId: existingOrder._id,
                    orderNumber: existingOrder.orderNumber,
                    totalAmount: existingOrder.totalAmount,
                    orderStatus: existingOrder.orderStatus,
                    paymentStatus: existingOrder.paymentStatus,
                    alreadyProcessed: true
                }
            });
        }

        // Verify payment signature
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature - Payment verification failed'
            });
        }

        // Verify payment with Razorpay API
        let paymentDetails;
        try {
            paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
        } catch (razorpayError) {
            console.error('Razorpay API error:', razorpayError);
            return res.status(500).json({
                success: false,
                message: 'Failed to verify payment with Razorpay',
                error: razorpayError.message
            });
        }

        if (paymentDetails.status !== 'captured' && paymentDetails.status !== 'authorized') {
            return res.status(400).json({
                success: false,
                message: `Payment not captured successfully. Status: ${paymentDetails.status}`
            });
        }

        const userId = req.user.id;

        // Get user's cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        // Validate cart and stock
        await validateCartAndStock(cart);

        // Filter to only selected items
        const orderItems = filterCartItems(cart.items, selectedItemIds);

        // Validate address
        const address = await validateAndGetAddress(addressId, userId);

        // Calculate totals (including wallet portion and free delivery coupon used during step 1)
        const totals = await calculateOrderTotals(orderItems, couponCode, userId, !!useWalletBalance, freeDeliveryCode || null);

        // Verify payment amount matches calculated remaining total
        if (paymentDetails.amount !== Math.round(totals.totalAmount * 100)) {
            return res.status(400).json({
                success: false,
                message: 'Payment amount mismatch'
            });
        }

        // Debit the wallet portion now that payment succeeded
        if (totals.walletApplied > 0) {
            try {
                await debitWallet(userId, totals.walletApplied, {
                    source: 'ORDER_PAYMENT',
                    description: `Wallet applied towards order`,
                    referenceId: razorpay_order_id
                });
            } catch (walletError) {
                return res.status(400).json({
                    success: false,
                    message: walletError.message || 'Failed to apply wallet balance'
                });
            }
        }

        const orderNumber = generateOrderNumber();
        const transactionId = generateTransactionId();

        // Create order
        const order = new Order({
            user: userId,
            orderNumber,
            items: orderItems.map(item => ({
                product: item.product._id,
                productName: item.product.name,
                productImage: (item.product.images && item.product.images.length > 0) ? item.product.images[0] : '',
                quantity: item.quantity,
                price: item.price,
                size: item.size || '',
                color: item.color || ''
            })),
            shippingAddress: address._id,
            paymentMethod: totals.walletApplied > 0 ? 'RAZORPAY+WALLET' : 'RAZORPAY',
            paymentStatus: 'COMPLETED',
            orderStatus: 'CONFIRMED',
            ...totals,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            notes: notes && typeof notes === 'string' ? notes : JSON.stringify(notes || ''),
            couponCode: couponCode || null,
            razorpayOrderId: razorpay_order_id
        });

        await order.save();

        // Consume the free delivery coupon now that the order is confirmed
        if (totals.freeDeliveryApplied && freeDeliveryCode) {
            await consumeFreeDeliveryReward(userId, freeDeliveryCode, order._id);
        }

        // Create payment record
        const payment = new Payment({
            order: order._id,
            user: userId,
            paymentMethod: 'RAZORPAY',
            amount: totals.totalAmount,
            status: 'COMPLETED',
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            transactionId: transactionId,
            gateway: 'RAZORPAY',
            paymentDate: new Date(),
            currency: 'INR',
            metadata: {
                couponCode: couponCode || null,
                orderNumber: order.orderNumber,
                walletApplied: totals.walletApplied,
                freeDeliveryApplied: !!totals.freeDeliveryApplied,
                paymentDetails: {
                    method: paymentDetails.method,
                    bank: paymentDetails.bank || null,
                    wallet: paymentDetails.wallet || null,
                    vpa: paymentDetails.vpa || null
                }
            }
        });

        await payment.save();

        // Update product stock for selected items only
        await updateProductStock(orderItems);

        // Remove only purchased items from cart (keep rest)
        const purchasedIds = orderItems.map(i => i._id);
        await removeCartItems(userId, purchasedIds);

        res.status(201).json({
            success: true,
            message: 'Payment verified and order created successfully',
            data: {
                orderId: order._id,
                orderNumber: order.orderNumber,
                totalAmount: order.totalAmount,
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus,
                estimatedDelivery: order.estimatedDelivery,
                paymentId: payment._id,
                transactionId: payment.transactionId,
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id
            }
        });

    } catch (error) {
        console.error('Error in payment verification and order creation:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify payment and create order',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Create COD order
export const createCODOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        let { addressId, couponCode, notes, useWalletBalance, freeDeliveryCode, selectedItemIds } = req.body;

        // Ensure notes is a string
        notes = notes && typeof notes === 'string' ? notes : '';

        // Get user's cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        // Validate cart and stock
        await validateCartAndStock(cart);

        // Filter to only selected items (backwards compat: if no selection, use all)
        const orderItems = filterCartItems(cart.items, selectedItemIds);
        if (orderItems.length === 0) {
            return res.status(400).json({ success: false, message: 'No items selected for checkout' });
        }

        // Validate address
        const address = await validateAndGetAddress(addressId, userId);

        // Calculate totals (including wallet and free delivery coupon if requested)
        // Invalid free-delivery codes fail before the order is created
        const totals = await calculateOrderTotals(orderItems, couponCode, userId, !!useWalletBalance, freeDeliveryCode || null);

        // Debit wallet portion up-front; credit back on failure below
        if (totals.walletApplied > 0) {
            try {
                await debitWallet(userId, totals.walletApplied, {
                    source: 'ORDER_PAYMENT',
                    description: 'Wallet applied towards COD order',
                    referenceId: 'COD_ORDER'
                });
            } catch (walletError) {
                return res.status(400).json({
                    success: false,
                    message: walletError.message || 'Failed to apply wallet balance'
                });
            }
        }

        try {
            const orderNumber = generateOrderNumber();
            const transactionId = generateTransactionId();

            // Create order
            const order = new Order({
                user: userId,
                orderNumber,
                items: orderItems.map(item => ({
                    product: item.product._id,
                    productName: item.product.name,
                    productImage: (item.product.images && item.product.images.length > 0) ? item.product.images[0] : '',
                    quantity: item.quantity,
                    price: item.price,
                    size: item.size || '',
                    color: item.color || ''
                })),
                shippingAddress: address._id,
                paymentMethod: totals.totalAmount <= 0 ? 'WALLET' : 'COD',
                paymentStatus: totals.totalAmount <= 0 ? 'COMPLETED' : 'PENDING',
                orderStatus: 'CONFIRMED',
                ...totals,
                estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                notes: notes,
                couponCode: couponCode || null
            });

            await order.save();

            // Consume the free delivery coupon now that the order exists
            if (totals.freeDeliveryApplied && freeDeliveryCode) {
                await consumeFreeDeliveryReward(userId, freeDeliveryCode, order._id);
            }

            // Create payment record
            const payment = new Payment({
                order: order._id,
                user: userId,
                paymentMethod: totals.totalAmount <= 0 ? 'WALLET' : 'COD',
                amount: totals.totalAmount,
                status: totals.totalAmount <= 0 ? 'COMPLETED' : 'PENDING',
                transactionId: transactionId,
                currency: 'INR',
                metadata: {
                    couponCode: couponCode || null,
                    orderNumber: order.orderNumber,
                    walletApplied: totals.walletApplied,
                    freeDeliveryApplied: !!totals.freeDeliveryApplied
                }
            });

            await payment.save();

            // Update product stock for selected items only
            await updateProductStock(orderItems);

            // Remove only purchased items from cart (keep rest)
            const purchasedIds = orderItems.map(i => i._id);
            await removeCartItems(userId, purchasedIds);

            res.status(201).json({
                success: true,
                message: 'Order placed successfully with Cash on Delivery',
                data: {
                    orderNumber: order.orderNumber,
                    totalAmount: order.totalAmount,
                    walletApplied: totals.walletApplied,
                    payableAmount: totals.totalAmount,
                    paymentMethod: order.paymentMethod,
                    estimatedDelivery: order.estimatedDelivery,
                    paymentId: payment._id,
                    transactionId: payment.transactionId,
                    orderStatus: 'CONFIRMED',
                    addressId: address._id,
                    shippingAddress: address
                }
            });
        } catch (orderError) {
            // Compensate: restore wallet if order creation failed after debit
            if (totals.walletApplied > 0) {
                await creditWallet(userId, totals.walletApplied, {
                    source: 'REFUND',
                    description: 'Wallet restored - COD order failed'
                }).catch(() => {});
            }
            throw orderError;
        }

    } catch (error) {
        console.error('Error creating COD order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create COD order',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Enhanced unified order creation
export const createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        let { addressId, paymentMethod, couponCode, notes, useWalletBalance } = req.body;

        // Ensure notes is a string or empty string
        notes = notes && typeof notes === 'string' ? notes : '';

        // Validate payment method
        if (!paymentMethod || !['COD', 'RAZORPAY'].includes(paymentMethod.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid payment method (COD or RAZORPAY)'
            });
        }

        // Handle different payment methods
        if (paymentMethod.toUpperCase() === 'COD') {
            return createCODOrder(req, res);
        } else if (paymentMethod.toUpperCase() === 'RAZORPAY') {
            // For Razorpay, we'll create a temporary order first
            const cart = await Cart.findOne({ user: userId }).populate('items.product');
            
            // Validate cart and stock
            await validateCartAndStock(cart);

            // Validate address
            const address = await validateAndGetAddress(addressId, userId);

            // Calculate totals (including wallet if requested)
            const totals = await calculateOrderTotals(cart.items, couponCode, userId, !!useWalletBalance);
            const orderNumber = generateOrderNumber();

            // Create temporary order
            const order = new Order({
                user: userId,
                orderNumber,
                items: cart.items.map(item => ({
                    product: item.product._id,
                    productName: item.product.name,
                    productImage: (item.product.images && item.product.images.length > 0) ? item.product.images[0] : '',
                    quantity: item.quantity,
                    price: item.price,
                    size: item.size || '',
                    color: item.color || ''
                })),
                shippingAddress: address._id,
                paymentMethod: 'RAZORPAY',
                paymentStatus: 'PENDING',
                orderStatus: 'PENDING',
                ...totals,
                estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                notes: notes,
                couponCode: couponCode || null
            });

            await order.save();

            // Create payment record
            const payment = new Payment({
                order: order._id,
                user: userId,
                paymentMethod: 'RAZORPAY',
                amount: totals.totalAmount,
                status: 'PENDING',
                currency: 'INR',
                metadata: {
                    couponCode: couponCode || null,
                    orderNumber: order.orderNumber
                }
            });

            await payment.save();

            // Create Razorpay order
            const razorpayOrderData = await createRazorpayOrderForExistingOrder(order, payment);
            
            res.status(201).json({
                success: true,
                message: 'Order created successfully. Proceed with Razorpay payment.',
                data: {
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                    paymentId: payment._id,
                    transactionId: payment.transactionId,
                    ...razorpayOrderData,
                    orderSummary: totals
                }
            });
        }

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create order',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Helper function to create Razorpay order for existing order
const createRazorpayOrderForExistingOrder = async (order, payment) => {
    try {
        const options = {
            amount: Math.round(order.totalAmount * 100), // Ensure integer by rounding
            currency: 'INR',
            receipt: order.orderNumber,
            notes: {
                orderId: order._id.toString(),
                userId: order.user.toString(),
                orderNumber: order.orderNumber,
                paymentId: payment._id.toString()
            }
        };

        const razorpayOrder = await razorpay.orders.create(options);

        // Update payment record with Razorpay order ID
        payment.razorpayOrderId = razorpayOrder.id;
        payment.gateway = 'RAZORPAY';
        await payment.save();

        // Update order with Razorpay order ID
        order.razorpayOrderId = razorpayOrder.id;
        await order.save();

        return {
            razorpayOrderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            key: process.env.RAZORPAY_KEY_ID
        };
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        throw error;
    }
};

// Verify Razorpay payment
export const verifyRazorpayPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            orderId 
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification data'
            });
        }

        // Verify signature
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature'
            });
        }

        // Find order and verify it belongs to user
        const order = await Order.findOne({ 
            _id: orderId, 
            user: req.user.id 
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const cart = await Cart.findOne({ user: req.user.id })
            .populate('items.product')
            .session(session);

        // Validate cart and stock one final time
        await validateCartAndStock(cart);

        // Update product stock
        await updateProductStock(cart.items, session);

        // Update order status
        await Order.findOneAndUpdate(
            { _id: orderId, user: req.user.id },
            {
                orderStatus: 'CONFIRMED',
                paymentStatus: 'COMPLETED'
            },
            { new: true, session }
        );

        // Update payment record
        await Payment.findOneAndUpdate(
            { order: orderId },
            {
                status: 'COMPLETED',
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
                paymentDate: new Date()
            },
            { session }
        );

        // Clear cart
        await Cart.findOneAndUpdate(
            { user: req.user.id },
            { $set: { items: [], totalAmount: 0, totalItems: 0 } },
            { session }
        );

        await session.commitTransaction();

        res.status(200).json({
            success: true,
            message: 'Payment verified and order confirmed successfully',
            data: {
                orderId: order._id,
                orderNumber: order.orderNumber,
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus,
                totalAmount: order.totalAmount
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error verifying payment:', error);
        res.status(500).json({
            success: false,
            message: 'Payment verification failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        session.endSession();
    }
};

// Get payment history
export const getPaymentHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (status) {
            query.status = status.toUpperCase();
        }

        const payments = await Payment.find(query)
            .populate('order', 'orderNumber totalAmount orderStatus createdAt')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Payment.countDocuments(query);

        res.status(200).json({
            success: true,
            data: {
                payments,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                totalPayments: total
            }
        });

    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment history',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Get payment details
export const getPaymentDetails = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const userId = req.user.id;

        const payment = await Payment.findOne({ 
            _id: paymentId, 
            user: userId 
        }).populate('order');

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        res.status(200).json({
            success: true,
            data: payment
        });

    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment details',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Initiate refund
export const initiateRefund = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { amount, reason } = req.body;

        const payment = await Payment.findById(paymentId);

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        if (payment.status !== 'COMPLETED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot refund incomplete payment'
            });
        }

        // Create refund
        const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
            amount: amount ? amount * 100 : payment.amount * 100,
            notes: {
                reason: reason || 'Refund requested',
                orderId: String(payment.order || '')
            }
        });

        // Update payment record using schema-defined fields
        payment.status = 'REFUNDED';
        payment.refundDetails = {
            id: refund.id,
            amount: refund.amount / 100,
            reason: reason || 'Refund requested',
            status: 'PROCESSED',
            date: new Date()
        };
        await payment.save();

        // Credit refunded amount back to user's wallet
        if (payment.user) {
            await creditWallet(payment.user, refund.amount / 100, {
                source: 'REFUND',
                description: 'Refund credited to wallet',
                referenceId: refund.id
            }).catch(err => console.error('Wallet credit on refund failed:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Refund initiated successfully',
            data: {
                refundId: refund.id,
                amount: refund.amount / 100,
                status: 'REFUNDED'
            }
        });

    } catch (error) {
        console.error('Error initiating refund:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate refund',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Admin: Get all payments
export const getAllPayments = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            status, 
            paymentMethod,
            startDate,
            endDate,
            search
        } = req.query;

        const query = {};

        // Filter by status
        if (status) {
            query.status = status.toUpperCase();
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

        // Search by transaction ID or order number
        if (search) {
            const orders = await Order.find({
                orderNumber: { $regex: search, $options: 'i' }
            }).select('_id');
            
            query.$or = [
                { razorpayPaymentId: { $regex: search, $options: 'i' } },
                { razorpayOrderId: { $regex: search, $options: 'i' } },
                { order: { $in: orders.map(o => o._id) } }
            ];
        }

        const payments = await Payment.find(query)
            .populate('user', 'name email phoneNumber')
            .populate('order', 'orderNumber totalAmount orderStatus')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Payment.countDocuments(query);

        res.status(200).json({
            success: true,
            message: 'Payments retrieved successfully',
            data: payments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalPayments: total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching all payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payments',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Admin: Get payment analytics
export const getPaymentAnalytics = async (req, res) => {
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

        const analytics = await Payment.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        paymentMethod: '$paymentMethod'
                    },
                    totalTransactions: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    successfulPayments: {
                        $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
                    },
                    failedPayments: {
                        $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
                    }
                }
            },
            { $sort: { '_id.date': 1 } }
        ]);

        // Get overall statistics
        const overallStats = await Payment.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, '$amount', 0] } },
                    totalTransactions: { $sum: 1 },
                    successRate: {
                        $avg: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
                    },
                    codOrders: {
                        $sum: { $cond: [{ $eq: ['$paymentMethod', 'COD'] }, 1, 0] }
                    },
                    onlineOrders: {
                        $sum: { $cond: [{ $eq: ['$paymentMethod', 'RAZORPAY'] }, 1, 0] }
                    }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            message: 'Payment analytics retrieved successfully',
            data: {
                dailyAnalytics: analytics,
                overallStats: overallStats[0] || {
                    totalRevenue: 0,
                    totalTransactions: 0,
                    successRate: 0,
                    codOrders: 0,
                    onlineOrders: 0
                }
            }
        });
    } catch (error) {
        console.error('Error fetching payment analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment analytics',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Admin: Refund payment
export const refundPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Validate ObjectId
        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment ID format'
            });
        }

        const payment = await Payment.findById(id).populate('order');

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        if (payment.status !== 'COMPLETED') {
            return res.status(400).json({
                success: false,
                message: 'Only completed payments can be refunded'
            });
        }

        if (payment.paymentMethod === 'RAZORPAY' && payment.razorpayPaymentId) {
            try {
                // Create refund in Razorpay
                const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
                    amount: payment.amount * 100, // Amount in paise
                    notes: {
                        reason: reason || 'Refund requested by admin'
                    }
                });

                payment.status = 'REFUNDED';
                payment.refundDetails = {
                    id: refund.id,
                    amount: refund.amount / 100,
                    reason: reason || 'Refund requested by admin',
                    status: 'PROCESSED',
                    date: new Date()
                };
                await payment.save();

                // Credit refunded amount back to user's wallet
                if (payment.user) {
                    await creditWallet(payment.user, refund.amount / 100, {
                        source: 'REFUND',
                        description: 'Admin refund credited to wallet',
                        referenceId: refund.id
                    }).catch(err => console.error('Wallet credit on refund failed:', err.message));
                }

                // Update order payment status
                if (payment.order) {
                    payment.order.paymentStatus = 'REFUNDED';
                    await payment.order.save();
                }

                res.status(200).json({
                    success: true,
                    message: 'Payment refunded successfully',
                    data: {
                        paymentId: payment._id,
                        refundId: refund.id,
                        amount: payment.amount,
                        status: 'REFUNDED'
                    }
                });
            } catch (razorpayError) {
                console.error('Razorpay refund error:', razorpayError);
                res.status(500).json({
                    success: false,
                    message: 'Failed to process refund with Razorpay',
                    error: process.env.NODE_ENV === 'development' ? razorpayError.message : 'Internal server error'
                });
            }
        } else {
            // For COD/Wallet orders, mark as refunded and credit wallet
            payment.status = 'REFUNDED';
            payment.refundDetails = {
                id: `ADMIN_REFUND_${Date.now()}`,
                amount: payment.amount,
                reason: reason || 'Refund processed by admin',
                status: 'PROCESSED',
                date: new Date()
            };
            await payment.save();

            // Credit refunded amount back to user's wallet
            if (payment.user) {
                await creditWallet(payment.user, payment.amount, {
                    source: 'REFUND',
                    description: 'COD order refund credited to wallet',
                    referenceId: String(payment._id)
                }).catch(err => console.error('Wallet credit on refund failed:', err.message));
            }

            // Update order payment status
            if (payment.order) {
                payment.order.paymentStatus = 'REFUNDED';
                await payment.order.save();
            }

            res.status(200).json({
                success: true,
                message: 'Payment refunded successfully',
                data: {
                    paymentId: payment._id,
                    amount: payment.amount,
                    status: 'REFUNDED'
                }
            });
        }
    } catch (error) {
        console.error('Error processing refund:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process refund',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Get payment by ID
export const getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Validate ObjectId
        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment ID format'
            });
        }

        const payment = await Payment.findOne({ _id: id, user: userId })
            .populate('order')
            .populate('user', 'name email phoneNumber');

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Payment retrieved successfully',
            data: payment
        });
    } catch (error) {
        console.error('Error fetching payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Create Razorpay order for payment (before actual payment)
export const createRazorpayOrderForPaymentOld = async (req, res) => {
    try {
        const userId = req.user.id;
        let { addressId, couponCode } = req.body;

        // Get user's cart to calculate amount
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        // Validate cart and stock
        await validateCartAndStock(cart);

        // Validate address
        const address = await validateAndGetAddress(addressId, userId);

        // Calculate totals
        const totals = await calculateOrderTotals(cart.items, couponCode);
        const tempOrderNumber = `TEMP${Date.now()}${Math.floor(Math.random() * 1000)}`;

        // Create Razorpay order
        const options = {
            amount: Math.round(totals.totalAmount * 100), // Ensure integer by rounding
            currency: 'INR',
            receipt: tempOrderNumber,
            notes: {
                userId: userId,
                tempOrderNumber: tempOrderNumber,
                cartItems: cart.items.length,
                addressId: address._id.toString()
            }
        };

        const razorpayOrder = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            message: 'Razorpay order created successfully',
            data: {
                razorpayOrderId: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                key: process.env.RAZORPAY_KEY_ID,
                orderSummary: totals,
                address: {
                    _id: address._id,
                    fullName: address.fullName,
                    phoneNumber: address.phoneNumber,
                    addressLine1: address.addressLine1,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode
                }
            }
        });

    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment order',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// New endpoints for coupon management

// Validate coupon
export const validateCoupon = async (req, res) => {
    try {
        const { code } = req.params;
        // cartTotal can arrive as query param or JSON body
        const rawTotal = req.query.cartTotal ?? req.body?.cartTotal;
        const cartTotal = Number(rawTotal) || 0;

        const coupon = await Coupon.findOne({ code: code.toUpperCase() });

        if (!coupon || !isCouponLive(coupon)) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or expired coupon code'
            });
        }

        if (cartTotal < coupon.minimumPurchase) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase amount of ₹${coupon.minimumPurchase} required`
            });
        }

        const discountAmount = computeCouponDiscount(coupon, cartTotal);

        res.status(200).json({
            success: true,
            message: 'Coupon is valid',
            data: {
                coupon: {
                    code: coupon.code,
                    description: coupon.description,
                    discountType: coupon.discountType,
                    discountValue: coupon.discountValue,
                    discountAmount: discountAmount,
                    minimumPurchase: coupon.minimumPurchase,
                    maximumDiscount: coupon.maximumDiscount,
                    freeDelivery: coupon.discountType === 'FREE_DELIVERY'
                }
            }
        });

    } catch (error) {
        console.error('Error validating coupon:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate coupon',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Admin: Create coupon
export const createCoupon = async (req, res) => {
    try {
        const {
            code,
            description,
            discountType,
            discountValue,
            minimumPurchase,
            maximumDiscount,
            startDate,
            endDate,
            usageLimit,
            applicableCategories
        } = req.body;

        // Validate required fields
        if (!code || !description || !discountType || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // discountValue required for PERCENTAGE and FIXED, but not for FREE_DELIVERY
        if (discountType !== 'FREE_DELIVERY' && (!discountValue || discountValue <= 0)) {
            return res.status(400).json({
                success: false,
                message: 'Discount value is required for percentage and fixed coupons'
            });
        }

        // Check if coupon code already exists
        const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (existingCoupon) {
            return res.status(400).json({
                success: false,
                message: 'Coupon code already exists'
            });
        }

        const coupon = await Coupon.create({
            code: code.toUpperCase(),
            description,
            discountType,
            discountValue,
            minimumPurchase: minimumPurchase || 0,
            maximumDiscount: maximumDiscount || null,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            usageLimit: usageLimit || null,
            applicableCategories: applicableCategories || [],
            // Admin JWTs carry id 'admin' (not an ObjectId) — only link real users
            createdBy: mongoose.isValidObjectId(req.user?.id)
                ? req.user.id
                : null
        });

        res.status(201).json({
            success: true,
            message: 'Coupon created successfully',
            data: coupon
        });

    } catch (error) {
        console.error('Error creating coupon:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create coupon',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Admin: Get all coupons
export const getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find()
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: coupons.length,
            data: coupons
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch coupons',
            error: error.message
        });
    }
};

// Admin: Update coupon
export const updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        // Whitelist editable fields to avoid accidental overwrites / cast errors
        const allowed = [
            'description', 'discountType', 'discountValue', 'minimumPurchase',
            'maximumDiscount', 'startDate', 'endDate', 'usageLimit', 'isActive'
        ];
        if (!id || !mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid coupon id' });
        }

        const updateData = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updateData[key] = req.body[key];
        }
        if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
        if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

        const coupon = await Coupon.findByIdAndUpdate(
            id,
            { ...updateData },
            { new: true, runValidators: true }
        );

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Coupon updated successfully',
            data: coupon
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update coupon',
            error: error.message
        });
    }
};

// Admin: Delete coupon
export const deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findByIdAndDelete(id);

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Coupon deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete coupon',
            error: error.message
        });
    }
};
