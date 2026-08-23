
import express from 'express';
import { 
  registerUser, 
  requestOTP, 
  verifyOTP, 
  updateProfile, 
  getProfile, 
  logout,
  login,
  verifyLoginOTP
} from '../controller/phoneAuthController.js';
import { protectPhoneRoute } from '../middleware/phoneAuthMiddleware.js';


const phoneAuthRouter = express.Router();

// Authentication routes
phoneAuthRouter.post('/register', registerUser);
phoneAuthRouter.post('/verify', verifyOTP);
phoneAuthRouter.post('/login', login);
phoneAuthRouter.post('/verify-login', verifyLoginOTP);

// General OTP route (for backward compatibility)
phoneAuthRouter.post('/request-otp', requestOTP);

// Protected routes
phoneAuthRouter.put('/profile', protectPhoneRoute, updateProfile);
phoneAuthRouter.get('/profile', protectPhoneRoute, getProfile);
phoneAuthRouter.post('/logout', protectPhoneRoute, logout);

export default phoneAuthRouter;
