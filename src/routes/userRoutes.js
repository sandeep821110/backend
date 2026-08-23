
import { signUpUser, verifyOTP, loginUser, logoutUser, getProfile, adminLogin, resendOtp, updateProfile } from '../controller/userController.js';
import { protect } from '../middleware/authMiddleware.js';
import express from 'express';
const userRouter = express.Router();

userRouter.post('/signup', signUpUser);
userRouter.post('/verify', verifyOTP);
userRouter.post('/resend-otp',resendOtp)
userRouter.post('/login', loginUser);
userRouter.post('/admin/login', adminLogin);
userRouter.post('/logout', logoutUser);
userRouter.get('/profile', protect, getProfile);
userRouter.put('/profile/update', protect, updateProfile);


export default userRouter;
