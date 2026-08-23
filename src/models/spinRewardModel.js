import mongoose from 'mongoose';

const spinRewardSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['FREE_DELIVERY'],
        default: 'FREE_DELIVERY'
    },
    source: {
        type: String,
        enum: ['SPIN'],
        default: 'SPIN'
    },
    wonAt: {
        type: Date,
        default: Date.now
    },
    // Reward must be used within 7 days of winning
    expiresAt: {
        type: Date,
        required: true
    },
    used: {
        type: Boolean,
        default: false
    },
    usedAt: {
        type: Date,
        default: null
    },
    usedOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null
    }
}, { timestamps: true });

spinRewardSchema.index({ user: 1, used: 1, expiresAt: 1 });
spinRewardSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Human-friendly unique code, e.g. FLYFREE-7K2M9Q
spinRewardSchema.statics.generateCode = function () {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let rand = '';
    for (let i = 0; i < 6; i++) {
        rand += chars[Math.floor(Math.random() * chars.length)];
    }
    return `FLYFREE-${rand}`;
};

// A reward is usable only if unused and not expired
spinRewardSchema.methods.isActive = function () {
    return !this.used && new Date(this.expiresAt) > new Date();
};

// Atomically mark a reward as used for an order.
// Returns the updated reward or null when it was already used/expired/not found.
spinRewardSchema.statics.markUsed = async function (code, userId, orderId) {
    return this.findOneAndUpdate(
        {
            code: String(code).toUpperCase(),
            user: userId,
            used: false,
            expiresAt: { $gt: new Date() }
        },
        {
            $set: { used: true, usedAt: new Date(), usedOrderId: orderId || null }
        },
        { new: true }
    );
};

// Find a still-valid (unused, unexpired) reward for a user by code
spinRewardSchema.statics.findActiveByCode = function (code, userId) {
    return this.findOne({
        code: String(code).toUpperCase(),
        user: userId,
        used: false,
        expiresAt: { $gt: new Date() }
    });
};

const SpinReward = mongoose.model('SpinReward', spinRewardSchema);

export default SpinReward;
