
import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';

export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if token is expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (decoded.exp < currentTime) {
        return res.status(401).json({ message: 'Token expired' });
      }

      // Get user from the token
      if (decoded.isAdmin) {
        req.user = { 
          id: 'admin', 
          email: decoded.email, 
          isAdmin: true,
          tokenExpiry: new Date(decoded.exp * 1000)
        };
      } else {
        req.user = await userModel.findById(decoded.id).select('-otp -otpValidity');
        if (!req.user) {
          return res.status(401).json({ message: 'User not found' });
        }
      }

      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // Normal client state (idle session) - log concisely, no stack
        console.warn(`[auth] expired token on ${req.method} ${req.originalUrl} (expiredAt: ${error.expiredAt?.toISOString()})`);
        return res.status(401).json({ message: 'Token expired' });
      }
      console.error('Token verification error:', error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    // Additional check for admin token expiry
    if (req.user.tokenExpiry && new Date() > req.user.tokenExpiry) {
      return res.status(401).json({ message: 'Admin token expired' });
    }
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};
