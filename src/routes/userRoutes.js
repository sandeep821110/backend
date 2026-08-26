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
import { protect } from '../middleware/authMiddleware.js';
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
