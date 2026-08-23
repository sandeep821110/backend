import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'RAZORPAY', 'UPI', 'CARD', 'NET_BANKING', 'WALLET'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED', 'PROCESSING'],
        default: 'PENDING'
    },
    razorpayDetails: {
        paymentId: { type: String, default: '' },
        orderId: { type: String, default: '' },
        signature: { type: String, default: '' }
    },
    upiDetails: {
        transactionId: { type: String, default: '' },
        vpa: { type: String, default: '' }
    },
    refundDetails: {
        id: { type: String, default: '' },
        amount: { type: Number, default: 0, min: 0 },
        reason: { type: String, default: '' },
        status: {
            type: String,
            enum: ['PENDING', 'PROCESSED', 'FAILED'],
            default: 'PENDING'
        },
        date: { type: Date }
    },
    transactionId: {
        type: String,
        unique: true,
        sparse: true
    },
    gateway: {
        type: String,
        enum: ['RAZORPAY', 'PAYU', 'STRIPE', 'MANUAL'],
        default: 'RAZORPAY'
    },
    currency: {
        type: String,
        default: 'INR'
    },
    paymentDate: {
        type: Date
    },
    failureReason: {
        type: String,
        default: ''
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    attempts: [{
        date: { type: Date, default: Date.now },
        status: { type: String, enum: ['SUCCESS', 'FAILED'] },
        reason: String
    }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better performance
paymentSchema.index({ user: 1, status: 1 });
paymentSchema.index({ order: 1 }, { unique: true });
paymentSchema.index({ 'razorpayDetails.paymentId': 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ createdAt: -1 });

// Generate unique transaction ID
paymentSchema.pre('save', function(next) {
    if (!this.transactionId) {
        const timestamp = Date.now().toString();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        this.transactionId = `TXN${timestamp}${random}`;
    }
    if (this.status === 'COMPLETED' && !this.paymentDate) {
        this.paymentDate = new Date();
    }
    next();
});

// Virtual for payment status text
paymentSchema.virtual('statusText').get(function() {
    const statusMap = {
        'PENDING': 'Payment Pending',
        'COMPLETED': 'Payment Successful',
        'FAILED': 'Payment Failed',
        'REFUNDED': 'Payment Refunded',
        'CANCELLED': 'Payment Cancelled',
        'PROCESSING': 'Payment Processing'
    };
    return statusMap[this.status] || this.status;
});

// Instance methods
paymentSchema.methods.markAsCompleted = async function(paymentDetails = {}) {
    this.status = 'COMPLETED';
    this.paymentDate = new Date();
    Object.assign(this.metadata, paymentDetails);
    return this.save();
};

paymentSchema.methods.markAsFailed = async function(reason) {
    this.status = 'FAILED';
    this.failureReason = reason;
    this.attempts.push({
        date: new Date(),
        status: 'FAILED',
        reason
    });
    return this.save();
};

paymentSchema.methods.initiateRefund = async function(amount, reason) {
    if (amount > this.amount) {
        throw new Error('Refund amount cannot be greater than payment amount');
    }
    this.refundDetails = {
        amount,
        reason,
        status: 'PENDING',
        date: new Date()
    };
    return this.save();
};

// Static methods
paymentSchema.statics.findByTransactionId = function(transactionId) {
    return this.findOne({ transactionId });
};

paymentSchema.statics.findPendingPayments = function() {
    return this.find({ status: 'PENDING' });
};

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
