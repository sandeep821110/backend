import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    getWallet,
    createTopupOrder,
    verifyTopup,
    getSpinGameStatus,
    playSpin,
    validateSpinReward
} from '../controller/walletController.js';

const walletRouter = express.Router();

// All wallet routes require authentication
walletRouter.use(protect);

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
