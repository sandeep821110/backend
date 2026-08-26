import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    discountType: {
        type: String,
        enum: ['PERCENTAGE', 'FIXED', 'FREE_DELIVERY'],
        required: true
    },
    discountValue: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    minimumPurchase: {
        type: Number,
        default: 0
    },
    maximumDiscount: {
        type: Number,
        default: null
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    usageLimit: {
        type: Number,
        default: null
    },
    usedCount: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    applicableCategories: [{
        type: String,
        ref: 'Category'
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true
});

// Indexes
couponSchema.index({ startDate: 1, endDate: 1 });
couponSchema.index({ isActive: 1 });

const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;