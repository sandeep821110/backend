
import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';

export const protect = async (req, res, next) => {
  // Try cookie first, then Bearer header. If cookie exists but is invalid,
  // fall back to the Bearer header instead of immediately rejecting.
  let token = null;
  let cookieToken = null;
  let bearerToken = null;

  if (req.cookies?.access_token) {
    cookieToken = req.cookies.access_token;
  }
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    bearerToken = req.headers.authorization.split(' ')[1];
  }

  // Prefer cookie, but fall back to Bearer if cookie fails verification
  if (cookieToken) {
    try {
      const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
      token = cookieToken;
      req._decodedToken = decoded;
    } catch (err) {
      // Cookie token invalid/expired — try Bearer as fallback
      if (bearerToken) {
        token = bearerToken;
      }
    }
  } else if (bearerToken) {
    token = bearerToken;
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    // Verify token (skip if already decoded from cookie above)
    const decoded = req._decodedToken || jwt.verify(token, process.env.JWT_SECRET);

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
      console.warn(`[auth] expired token on ${req.method} ${req.originalUrl} (expiredAt: ${error.expiredAt?.toISOString()})`);
      return res.status(401).json({ message: 'Token expired' });
    }
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Not authorized, token failed' });
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
