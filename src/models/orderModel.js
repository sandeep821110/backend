import mongoose from 'mongoose';
import { publishEvent } from '../config/rabbitmq.js';

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    productImage: {
        type: String,
        default: ''
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true
    },
    size: {
        type: String,
        required: true,
        trim: true
    }
});

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    items: [orderItemSchema],
    shippingAddress: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'RAZORPAY', 'UPI', 'WALLET', 'RAZORPAY+WALLET'],
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
        default: 'PENDING'
    },
    razorpayOrderId: {
        type: String,
        default: ''
    },
    orderStatus: {
        type: String,
        enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
        default: 'PENDING'
    },
    subtotal: {
        type: Number,
        required: true
    },
    shippingCharges: {
        type: Number,
        default: 0
    },
    tax: {
        type: Number,
        default: 0
    },
    discount: {
        type: Number,
        default: 0
    },
    walletApplied: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true
    },
    estimatedDelivery: {
        type: Date
    },
    actualDelivery: {
        type: Date
    },
    notes: {
        type: String,
        default: ''
    },
    couponCode: {
        type: String,
        default: null
    },
    trackingNumber: {
        type: String,
        default: ''
    },
    cancelReason: {
        type: String,
        default: ''
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create indexes
orderSchema.index({ user: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ createdAt: -1 });

// Virtual for calculating total items
orderSchema.virtual('totalItems').get(function() {
    return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for calculating discounted total
orderSchema.virtual('discountedTotal').get(function() {
    const subtotalWithDiscount = this.subtotal - this.discount;
    return subtotalWithDiscount + this.shippingCharges + this.tax;
});

// ---------------------------------------------------------------------------
// Publish 'order.created' to RabbitMQ whenever a NEW order is persisted.
// One hook covers every creation path (COD, Razorpay, wallet, admin).
// Fire-and-forget: messaging problems never affect the HTTP response.
// ---------------------------------------------------------------------------

orderSchema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next();
});

orderSchema.post('save', function (doc) {
    if (!doc.wasNew) return;
    publishEvent('order.created', {
        orderId: doc._id?.toString(),
        orderNumber: doc.orderNumber,
        userId: doc.user?.toString?.() || doc.user,
        paymentMethod: doc.paymentMethod,
        paymentStatus: doc.paymentStatus,
        total: doc.total ?? doc.subtotal,
        itemCount: Array.isArray(doc.items) ? doc.items.length : 0
    }).catch(() => {});
});

const Order = mongoose.model('Order', orderSchema);

export default Order;
