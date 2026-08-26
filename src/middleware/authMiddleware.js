import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';

const ACCESS_SECRET = process.env.JWT_SECRET;

export const protect = async (req, res, next) => {
    let token = null;

    // 1. Try httpOnly cookie first (primary mechanism)
    if (req.cookies?.access_token) {
        token = req.cookies.access_token;
    }

    // 2. Fallback: Bearer header (for phone-auth, rider, or non-cookie clients)
    if (!token && req.headers.authorization?.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            message: 'Not authorized, no token',
            code: 'NO_TOKEN'
        });
    }

    try {
        const decoded = jwt.verify(token, ACCESS_SECRET);

        if (decoded.isAdmin) {
            req.user = {
                id: 'admin',
                email: decoded.email,
                isAdmin: true,
                tokenExpiry: new Date(decoded.exp * 1000)
            };
            return next();
        }

        req.user = await userModel.findById(decoded.id).select('-otp -otpValidity -refreshToken -refreshTokenExpiry');
        if (!req.user) {
            return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                message: 'Token expired',
                code: 'TOKEN_EXPIRED',
                expiredAt: error.expiredAt?.toISOString()
            });
        }
        console.error('Token verification error:', error.message);
        return res.status(401).json({ message: 'Not authorized, token failed', code: 'TOKEN_INVALID' });
    }
};

export const adminOnly = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        if (req.user.tokenExpiry && new Date() > req.user.tokenExpiry) {
            return res.status(401).json({ message: 'Admin token expired', code: 'TOKEN_EXPIRED' });
        }
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};
