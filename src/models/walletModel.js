import mongoose from 'mongoose';

// Round to 2 decimals to avoid floating point drift
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

const walletTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['CREDIT', 'DEBIT'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: [1, 'Amount must be greater than 0']
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    // Source of the transaction
    source: {
        type: String,
        enum: ['TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADMIN_CREDIT', 'CANCELLED_ORDER', 'WALLET_REFUND', 'JACKPOT_WIN', 'JACKPOT_EXPIRED', 'SPIN_WIN', 'SPIN_EXPIRED'],
        default: 'TOPUP'
    },
    referenceId: {
        type: String,
        default: null // orderNumber, razorpayPaymentId, etc.
    },
    razorpayPaymentId: {
        type: String,
        default: null
    },
    razorpayOrderId: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ['PENDING', 'SUCCESS', 'FAILED'],
        default: 'SUCCESS'
    }
}, { timestamps: true });

// Jackpot winnings: money credited from the daily jackpot game.
// This money EXPIRES 7 days after it is won.
const jackpotEntrySchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    wonAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    winningNumber: { type: Number, default: null },
    consumed: { type: Boolean, default: false }
}, { _id: true });

const walletSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    currency: {
        type: String,
        default: 'INR'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    totalAdded: {
        type: Number,
        default: 0
    },
    totalSpent: {
        type: Number,
        default: 0
    },
    totalJackpotWon: {
        type: Number,
        default: 0
    },
    // Daily jackpot game limits
    lastJackpotPlayDate: {
        type: String, // stored as YYYY-MM-DD (server local) for a simple once-per-day check
        default: null
    },
    lastJackpotPlayAt: {
        type: Date,
        default: null
    },
    jackpotWinCount: {
        type: Number,
        default: 0
    },
    jackpotEntries: [jackpotEntrySchema],
    transactions: [walletTransactionSchema]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Keep only last 100 transactions per wallet document to bound size
walletSchema.pre('save', function (next) {
    if (this.transactions && this.transactions.length > 100) {
        this.transactions = this.transactions.slice(-100);
    }
    if (this.jackpotEntries) {
        this.jackpotEntries = this.jackpotEntries.filter(e => new Date(e.expiresAt) > new Date());
    }
    next();
});

// Static helper: get or create wallet for a user
walletSchema.statics.getOrCreateWallet = async function (userId) {
    let wallet = await this.findOne({ user: userId });
    if (!wallet) {
        wallet = await this.create({ user: userId, balance: 0 });
    }
    return wallet;
};

// Instance helper: push a transaction keeping balanceAfter consistent
walletSchema.methods.pushTxn = function (txn) {
    this.transactions.push({ balanceAfter: this.balance, ...txn });
};

/**
 * Expire jackpot winnings older than their 7-day validity.
 * Deducts the expired (still unspent) amount from the balance and logs it.
 * Returns the updated wallet (or the wallet untouched).
 */
walletSchema.methods.expireJackpotWinnings = async function () {
    const now = new Date();
    if (!this.jackpotEntries || this.jackpotEntries.length === 0) {
        // Still clean up stale entries list if any
        return this;
    }

    const expiredEntries = this.jackpotEntries.filter(e => new Date(e.expiresAt) <= now);
    if (expiredEntries.length === 0) return this;

    const expiredTotal = round2(expiredEntries.reduce((sum, e) => sum + (e.amount || 0), 0));

    this.jackpotEntries = this.jackpotEntries.filter(e => new Date(e.expiresAt) > now);

    // Only deduct whatever is actually still in the balance
    const deductible = Math.min(round2(expiredTotal), round2(this.balance));
    this.balance = round2(Math.max(0, this.balance - deductible));

    if (deductible > 0) {
        this.pushTxn({
            type: 'DEBIT',
            amount: deductible,
            source: 'SPIN_EXPIRED',
            description: 'Spin winnings expired (valid 7 days)',
            status: 'SUCCESS'
        });
    }

    await this.save();
    return this;
};

/**
 * Consume jackpot entries FIFO (earliest expiry first) for a debit amount.
 * Called AFTER the main balance debit succeeded. Keeps expiry accounting honest.
 */
walletSchema.methods.consumeJackpotEntries = async function (amountToConsume) {
    let remaining = round2(amountToConsume);
    if (remaining <= 0 || !this.jackpotEntries?.length) return this;

    const sorted = [...this.jackpotEntries].sort(
        (a, b) => new Date(a.expiresAt) - new Date(b.expiresAt)
    );

    const kept = [];
    for (const entry of sorted) {
        const current = round2(entry.amount);
        if (remaining <= 0 || current <= 0) {
            kept.push(entry);
            continue;
        }
        const take = Math.min(current, remaining);
        remaining = round2(remaining - take);
        const left = round2(current - take);
        if (left > 0) {
            kept.push({ ...entry.toObject(), amount: left });
        }
    }

    this.jackpotEntries = kept;
    await this.save();
    return this;
};

const Wallet = mongoose.model('Wallet', walletSchema);

export default Wallet;
