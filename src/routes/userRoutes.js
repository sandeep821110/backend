import {
    signUpUser,
    verifyOTP,
    loginUser,
    logoutUser,
    getProfile,
    adminLogin,
    resendOtp,
    updateProfile,
    refreshAccessToken,
    completeProfile
} from '../controller/userController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import User from '../models/userModel.js';
import express from 'express';

const userRouter = express.Router();

// Public routes
userRouter.post('/signup', signUpUser);
userRouter.post('/verify', verifyOTP);
userRouter.post('/resend-otp', resendOtp);
userRouter.post('/login', loginUser);
userRouter.post('/admin/login', adminLogin);

// Token refresh — uses httpOnly refresh_token cookie or body token
userRouter.post('/refresh', refreshAccessToken);

// Admin: list all users
userRouter.get('/admin/all', protect, adminOnly, async (req, res) => {
    try {
        const users = await User.find({}).select('-refreshToken -refreshTokenExpiry -__v').sort({ createdAt: -1 });
        res.json({ success: true, users, count: users.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: get user by ID
userRouter.get('/admin/:id', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-refreshToken -refreshTokenExpiry -__v');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: update user (toggle admin, block, etc.)
userRouter.put('/admin/:id', protect, adminOnly, async (req, res) => {
    try {
        const { isAdmin, isBlocked, isVerified } = req.body;
        const update = {};
        if (typeof isAdmin === 'boolean') update.isAdmin = isAdmin;
        if (typeof isBlocked === 'boolean') update.isBlocked = isBlocked;
        if (typeof isVerified === 'boolean') update.isVerified = isVerified;
        const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-refreshToken -refreshTokenExpiry -__v');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: delete user
userRouter.delete('/admin/:id', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Session check — returns user data including profileCompleted flag
userRouter.get('/session', protect, (req, res) => {
    res.status(200).json({
        success: true,
        user: {
            id: req.user._id || req.user.id,
            email: req.user.email,
            name: req.user.name || '',
            phoneNumber: req.user.phoneNumber || '',
            isAdmin: !!req.user.isAdmin,
            isVerified: req.user.isVerified,
            profileCompleted: !!req.user.profileCompleted
        }
    });
});

// Protected routes
userRouter.get('/profile', protect, getProfile);
userRouter.put('/profile/update', protect, updateProfile);

// Complete profile — post-OTP data collection (name, phone)
userRouter.put('/complete-profile', protect, completeProfile);

// Logout — always clear cookies server-side
userRouter.post('/logout', logoutUser);

export default userRouter;
