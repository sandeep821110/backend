import crypto from 'crypto';
import Wallet from '../models/walletModel.js';
import {
    playSpinGame,
    getSpinStatus,
    validateFreeDeliveryReward
} from '../services/spinGameService.js';

// ---------- Shared wallet helpers (used by payment controller too) ----------

/**
 * Credit money to a user's wallet (atomic $inc + push transaction).
 * Returns updated wallet document.
 */
export const creditWallet = async (userId, amount, { source = 'ADMIN_CREDIT', description = '', referenceId = null, razorpayPaymentId = null, razorpayOrderId = null } = {}) => {
    if (!amount || amount <= 0) {
        throw new Error('Credit amount must be greater than 0');
    }

    const roundedAmount = Math.round(amount * 100) / 100;

    const wallet = await Wallet.findOneAndUpdate(
        { user: userId },
        {
            $inc: {
                balance: roundedAmount,
                ...(source === 'TOPUP' ? { totalAdded: roundedAmount } : {})
            },
            $push: {
                transactions: {
                    type: 'CREDIT',
                    amount: roundedAmount,
                    balanceAfter: 0, // recalculated below
                    source,
                    description,
                    referenceId,
                    razorpayPaymentId,
                    razorpayOrderId,
                    status: 'SUCCESS'
                }
            }
        },
        { new: true, upsert: true }
    );

    // Fix balanceAfter on the last transaction
    if (wallet.transactions.length > 0) {
        const lastTxn = wallet.transactions[wallet.transactions.length - 1];
        lastTxn.balanceAfter = wallet.balance;
        await wallet.save();
    }

    return wallet;
};

/**
 * Debit money from a user's wallet. Fails if insufficient balance.
 * Uses a conditional update so concurrent checkouts cannot overdraw.
 */
export const debitWallet = async (userId, amount, { source = 'ORDER_PAYMENT', description = '', referenceId = null } = {}) => {
    if (!amount || amount <= 0) {
        throw new Error('Debit amount must be greater than 0');
    }

    const roundedAmount = Math.round(amount * 100) / 100;

    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet || wallet.balance < roundedAmount) {
        throw new Error(`Insufficient wallet balance. Available: ₹${wallet ? wallet.balance.toFixed(2) : '0.00'}, Required: ₹${roundedAmount.toFixed(2)}`);
    }

    // Atomic guard against race conditions: only debit if balance is still enough
    const updatedWallet = await Wallet.findOneAndUpdate(
        { user: userId, balance: { $gte: roundedAmount } },
        {
            $inc: {
                balance: -roundedAmount,
                totalSpent: roundedAmount
            },
            $push: {
                transactions: {
                    type: 'DEBIT',
                    amount: roundedAmount,
                    balanceAfter: 0,
                    source,
                    description,
                    referenceId,
                    status: 'SUCCESS'
                }
            }
        },
        { new: true }
    );

    if (!updatedWallet) {
        throw new Error('Insufficient wallet balance');
    }

    if (updatedWallet.transactions.length > 0) {
        const lastTxn = updatedWallet.transactions[updatedWallet.transactions.length - 1];
        lastTxn.balanceAfter = updatedWallet.balance;
        await updatedWallet.save();
    }

    return updatedWallet;
};

// ---------- Route controllers ----------

// Get wallet balance + transaction history
export const getWallet = async (req, res) => {
    try {
        const userId = req.user.id;
        const wallet = await Wallet.getOrCreateWallet(userId);

        // Auto-expire spin winnings that passed their 7-day validity
        await wallet.expireJackpotWinnings();

        const transactions = [...wallet.transactions].reverse().slice(0, 50);

        res.status(200).json({
            success: true,
            data: {
                balance: wallet.balance,
                currency: wallet.currency,
                isActive: wallet.isActive,
                totalAdded: wallet.totalAdded,
                totalSpent: wallet.totalSpent,
                transactions
            }
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch wallet'
        });
    }
};

// Spin game: eligibility + wheel config + active coupons
export const getSpinGameStatus = async (req, res) => {
    try {
        const status = await getSpinStatus(req.user.id);
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        console.error('Error fetching spin status:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch spin game status'
        });
    }
};

// Spin game: play once per day
export const playSpin = async (req, res) => {
    try {
        const result = await playSpinGame(req.user.id);
        const wallet = await Wallet.findOne({ user: req.user.id });

        res.status(200).json({
            success: true,
            message:
                result.prize.type === 'CASH'
                    ? `Congratulations! You won ₹${result.prize.value}`
                    : result.prize.type === 'FREE_DELIVERY'
                        ? 'You won a Free Delivery Coupon!'
                        : 'Better luck next time',
            data: {
                prize: result.prize,
                balance: wallet ? wallet.balance : result.wallet.balance,
                playedAt: result.playedAt,
                nextPlayAvailableAt: result.nextPlayAvailableAt,
                canPlayAgain: false
            }
        });
    } catch (error) {
        const status = error.status || 500;
        if (status === 500) console.error('Error playing spin game:', error);
        res.status(status).json({
            success: false,
            message: error.message || 'Failed to play spin game'
        });
    }
};

// Free delivery coupon: validate at checkout (preview only, not consumed)
export const validateSpinReward = async (req, res) => {
    try {
        const { code } = req.body;
        await validateFreeDeliveryReward(req.user.id, code);
        res.status(200).json({
            success: true,
            message: 'Free delivery coupon applied — shipping is on us!',
            data: { type: 'FREE_DELIVERY', freeDelivery: true }
        });
    } catch (error) {
        const status = error.status || 500;
        if (status === 500) console.error('Error validating spin reward:', error);
        res.status(status).json({
            success: false,
            message: error.message || 'Invalid coupon'
        });
    }
};

// Step 1: Create Razorpay order for adding money to wallet
export const createTopupOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        let { amount } = req.body;
        amount = Number(amount);

        if (!amount || isNaN(amount) || amount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum top-up amount is ₹10'
            });
        }
        if (amount > 50000) {
            return res.status(400).json({
                success: false,
                message: 'Maximum top-up amount is ₹50,000'
            });
        }

        const amountInPaise = Math.round(amount * 100);
        const receipt = `WALLET_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const { default: razorpayInstance } = await import('../utils/razorpayClient.js');
        const razorpayOrder = await razorpayInstance.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt,
            notes: {
                purpose: 'WALLET_TOPUP',
                userId: String(userId)
            }
        });

        // Mark a pending transaction on the wallet for traceability
        const wallet = await Wallet.getOrCreateWallet(userId);
        wallet.transactions.push({
            type: 'CREDIT',
            amount,
            balanceAfter: wallet.balance,
            source: 'TOPUP',
            description: `Wallet top-up initiated (${razorpayOrder.id})`,
            razorpayOrderId: razorpayOrder.id,
            status: 'PENDING'
        });
        await wallet.save();

        res.status(200).json({
            success: true,
            message: 'Top-up order created',
            data: {
                razorpayOrderId: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                key: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (error) {
        console.error('Error creating top-up order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create top-up order'
        });
    }
};

// Step 2: Verify Razorpay payment and credit the wallet
export const verifyTopup = async (req, res) => {
    try {
        const userId = req.user.id;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification data'
            });
        }

        // Idempotency: skip if this payment was already credited
        const existing = await Wallet.findOne({
            user: userId,
            'transactions': {
                $elemMatch: { razorpayPaymentId: razorpay_payment_id, status: 'SUCCESS' }
            }
        });
        if (existing) {
            return res.status(200).json({
                success: true,
                message: 'Wallet already credited for this payment',
                data: { balance: existing.balance, alreadyProcessed: true }
            });
        }

        // Verify signature
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature - verification failed'
            });
        }

        // Fetch payment details to confirm amount & order id match
        const { default: razorpayInstance } = await import('../utils/razorpayClient.js');
        const paymentDetails = await razorpayInstance.payments.fetch(razorpay_payment_id);

        if (paymentDetails.order_id !== razorpay_order_id) {
            return res.status(400).json({ success: false, message: 'Payment/order mismatch' });
        }
        if (paymentDetails.status !== 'captured' && paymentDetails.status !== 'authorized') {
            return res.status(400).json({ success: false, message: `Payment not successful. Status: ${paymentDetails.status}` });
        }

        const amount = paymentDetails.amount / 100;

        // Mark pending txn as SUCCESS / remove it, then credit
        const walletBefore = await Wallet.getOrCreateWallet(userId);
        walletBefore.transactions = walletBefore.transactions.filter(
            t => !(t.razorpayOrderId === razorpay_order_id && t.status === 'PENDING')
        );
        await walletBefore.save();

        const wallet = await creditWallet(userId, amount, {
            source: 'TOPUP',
            description: 'Wallet top-up via Razorpay',
            referenceId: razorpay_payment_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpayOrderId: razorpay_order_id
        });

        res.status(200).json({
            success: true,
            message: `₹${amount.toFixed(2)} added to wallet successfully`,
            data: { balance: wallet.balance }
        });
    } catch (error) {
        console.error('Error verifying top-up:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify top-up'
        });
    }
};
