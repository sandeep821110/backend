import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    getWallet,
    createTopupOrder,
    verifyTopup,
    getSpinGameStatus,
    playSpin,
    validateSpinReward
} from '../controller/walletController.js';
import Wallet from '../models/walletModel.js';

const walletRouter = express.Router();

// All wallet routes require authentication
walletRouter.use(protect);

// Admin: list all wallets
walletRouter.get('/admin/all', adminOnly, async (req, res) => {
    try {
        const wallets = await Wallet.find({}).populate('user', 'name email phoneNumber').sort({ updatedAt: -1 });
        res.json({ success: true, wallets, count: wallets.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: get wallet by user ID
walletRouter.get('/admin/user/:userId', adminOnly, async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ user: req.params.userId }).populate('user', 'name email phoneNumber');
        if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found for this user' });
        res.json({ success: true, wallet });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get wallet balance and transaction history
walletRouter.get('/', getWallet);

// Add money to wallet (step 1: create Razorpay order)
walletRouter.post('/topup/create-order', createTopupOrder);

// Add money to wallet (step 2: verify payment & credit)
walletRouter.post('/topup/verify', verifyTopup);

// Daily spin game
walletRouter.get('/spin/status', getSpinGameStatus);
walletRouter.post('/spin/play', playSpin);
walletRouter.post('/spin/validate-coupon', validateSpinReward);

export default walletRouter;
