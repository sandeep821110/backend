import userModel from '../models/userModel.js';
import generateOTP from '../utils/otpGenrator.js';
import { sendOTPEmail } from '../middleware/emailService.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh';

const generateAccessToken = (userId, email, isAdmin = false) => {
    const expiresIn = isAdmin ? '1d' : '7d';
    return jwt.sign(
        { id: userId, email, isAdmin, type: 'access' },
        ACCESS_SECRET,
        { expiresIn }
    );
};

const generateRefreshToken = (userId, email) => {
    return jwt.sign(
        { id: userId, email, type: 'refresh' },
        REFRESH_SECRET,
        { expiresIn: '30d' }
    );
};

// ---------------------------------------------------------------------------
// Cookie helpers — httpOnly tokens live here; frontend never reads them.
// Cross-site (frontend domain ≠ backend domain) needs SameSite=None + Secure.
// ---------------------------------------------------------------------------

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const accessCookieOptions = (isAdmin = false) => ({
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    path: '/',
    maxAge: (isAdmin ? 1 : 7) * 24 * 60 * 60 * 1000
});

const refreshCookieOptions = () => ({
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    path: '/api/users/refresh',
    maxAge: 30 * 24 * 60 * 60 * 1000
});

const setAuthCookies = (res, accessToken, refreshToken, isAdmin = false) => {
    res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions(isAdmin));
    if (refreshToken) {
        res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    }
};

const clearAuthCookies = (res) => {
    res.clearCookie(ACCESS_COOKIE, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: IS_PROD ? 'none' : 'lax',
        path: '/'
    });
    res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: IS_PROD ? 'none' : 'lax',
        path: '/api/users/refresh'
    });
};

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

const signUpUser = async (req, res) => {
    const { email } = req.body;

    try {
        if (!email || !/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        let user = await userModel.findOne({ email: email.toLowerCase() });

        if (user && user.isVerified) {
            return res.status(400).json({ message: 'User already exists and is verified' });
        }

        const otp = generateOTP();
        const otpValidity = new Date(Date.now() + 10 * 60 * 1000);

        if (user) {
            user.otp = parseInt(otp);
            user.otpValidity = otpValidity;
            await user.save();
        } else {
            user = new userModel({ email: email.toLowerCase(), isVerified: false });
            user.otp = parseInt(otp);
            user.otpValidity = otpValidity;
            await user.save();
        }

        await sendOTPEmail(email, otp);

        res.status(201).json({ message: 'User created. Please verify your email.' });
    } catch (error) {
        console.error('signUpUser error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Verify OTP (signup verification)
// ---------------------------------------------------------------------------

const verifyOTP = async (req, res) => {
    const { email, otp } = req.body;

    if (!otp) {
        return res.status(400).json({ message: 'OTP is required' });
    }

    try {
        const query = email ? { email: email.toLowerCase(), otp: parseInt(otp) } : { otp: parseInt(otp) };
        const user = await userModel.findOne(query);

        if (!user) {
            return res.status(404).json({ message: 'Invalid OTP' });
        }

        if (!user.otpValidity || user.otpValidity < new Date()) {
            return res.status(400).json({ message: 'OTP expired' });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpValidity = undefined;

        const accessToken = generateAccessToken(user._id, user.email);
        const refreshToken = generateRefreshToken(user._id, user.email);

        user.refreshToken = refreshToken;
        user.refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await user.save();

        setAuthCookies(res, accessToken, refreshToken);

        res.status(200).json({
            message: 'Email verified successfully',
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                email: user.email,
                name: user.name || '',
                isVerified: user.isVerified
            }
        });
    } catch (error) {
        console.error('verifyOTP error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Login — step 1: send OTP, step 2: verify OTP
// ---------------------------------------------------------------------------

const loginUser = async (req, res) => {
    const { email, otp } = req.body;

    try {
        if (otp) {
            // Step 2 — verify OTP
            const user = await userModel.findOne({ email: email?.toLowerCase() });
            if (!user) return res.status(404).json({ message: 'User not found' });
            if (!user.isVerified) return res.status(400).json({ message: 'Email not verified' });
            if (user.otp !== parseInt(otp)) return res.status(400).json({ message: 'Invalid OTP' });
            if (!user.otpValidity || user.otpValidity < new Date()) return res.status(400).json({ message: 'OTP expired' });

            user.otp = undefined;
            user.otpValidity = undefined;

            const accessToken = generateAccessToken(user._id, user.email);
            const refreshToken = generateRefreshToken(user._id, user.email);

            user.refreshToken = refreshToken;
            user.refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await user.save();

            setAuthCookies(res, accessToken, refreshToken);

            return res.status(200).json({
                message: 'Login successful',
                token: accessToken,
                refreshToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name || '',
                    isVerified: user.isVerified
                }
            });
        }

        // Step 1 — send OTP
        const user = await userModel.findOne({ email: email?.toLowerCase() });
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (!user.isVerified) return res.status(400).json({ message: 'Email not verified' });

        const newOtp = generateOTP();
        const otpValidity = new Date(Date.now() + 10 * 60 * 1000);

        user.otp = parseInt(newOtp);
        user.otpValidity = otpValidity;
        await user.save();

        await sendOTPEmail(email, newOtp);

        res.status(200).json({ message: 'OTP sent to your email for login' });
    } catch (error) {
        console.error('loginUser error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Refresh token — called by frontend when access token is about to expire
// ---------------------------------------------------------------------------

const refreshAccessToken = async (req, res) => {
    try {
        const token = req.cookies?.refresh_token || req.body?.refreshToken;

        if (!token) {
            return res.status(401).json({ message: 'No refresh token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, REFRESH_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        const user = await userModel.findById(decoded.id);
        if (!user || user.refreshToken !== token) {
            return res.status(401).json({ message: 'Refresh token revoked' });
        }

        if (user.refreshTokenExpiry && user.refreshTokenExpiry < new Date()) {
            user.clearRefreshToken();
            await user.save();
            return res.status(401).json({ message: 'Refresh token expired' });
        }

        const accessToken = generateAccessToken(user._id, user.email);
        const newRefreshToken = generateRefreshToken(user._id, user.email);

        user.refreshToken = newRefreshToken;
        user.refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await user.save();

        setAuthCookies(res, accessToken, newRefreshToken);

        res.status(200).json({
            message: 'Token refreshed',
            token: accessToken,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        console.error('refreshAccessToken error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Complete profile — called after OTP verification to collect name, phone, etc.
// ---------------------------------------------------------------------------

const completeProfile = async (req, res) => {
    const { name, phoneNumber } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Name is required' });
    }

    try {
        const user = await userModel.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.name = name.trim();

        if (phoneNumber) {
            if (!/^[6-9]\d{9}$/.test(phoneNumber)) {
                return res.status(400).json({ success: false, message: 'Invalid phone number. Must be 10 digits starting with 6-9.' });
            }
            // Check if phone is already taken by another user
            const existing = await userModel.findOne({ phoneNumber, _id: { $ne: user._id } });
            if (existing) {
                return res.status(400).json({ success: false, message: 'Phone number already registered with another account.' });
            }
            user.phoneNumber = phoneNumber;
        }

        user.profileCompleted = true;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile completed successfully',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                phoneNumber: user.phoneNumber || '',
                isVerified: user.isVerified,
                profileCompleted: true
            }
        });
    } catch (error) {
        console.error('completeProfile error:', error);
        if (error.code === 11000 && error.keyPattern?.phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number already registered.' });
        }
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

const logoutUser = async (req, res) => {
    try {
        const token = req.cookies?.refresh_token;
        if (token) {
            const decoded = jwt.verify(token, REFRESH_SECRET).catch(() => null);
            if (decoded) {
                const user = await userModel.findById(decoded.id);
                if (user) {
                    user.clearRefreshToken();
                    await user.save();
                }
            }
        }
    } catch {
        // best-effort — still clear cookies
    }

    clearAuthCookies(res);
    res.status(200).json({ message: 'Logged out successfully' });
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const getProfile = async (req, res) => {
    try {
        const user = await userModel.findById(req.user.id).select('-otp -otpValidity -refreshToken -refreshTokenExpiry');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                name: user.name || '',
                profilePicture: user.profilePicture || '',
                phoneNumber: user.phoneNumber || '',
                isVerified: user.isVerified,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('getProfile error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Admin login
// ---------------------------------------------------------------------------

const adminLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
            return res.status(500).json({ message: 'Server configuration error' });
        }

        if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        const accessToken = generateAccessToken('admin', email, true);
        const refreshToken = generateRefreshToken('admin', email);

        setAuthCookies(res, accessToken, refreshToken, true);

        res.status(200).json({
            message: 'Admin login successful',
            token: accessToken,
            refreshToken,
            user: { id: 'admin', email, isAdmin: true }
        });
    } catch (error) {
        console.error('adminLogin error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Resend OTP
// ---------------------------------------------------------------------------

const resendOtp = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    try {
        if (!/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        const user = await userModel.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ message: 'User not found. Please register first.' });
        if (user.isVerified) return res.status(400).json({ message: 'User is already verified' });

        const otp = generateOTP();
        const otpValidity = new Date(Date.now() + 10 * 60 * 1000);

        user.otp = parseInt(otp);
        user.otpValidity = otpValidity;
        await user.save();

        await sendOTPEmail(email, otp);

        res.status(200).json({
            message: 'OTP resent successfully',
            isVerified: user.isVerified
        });
    } catch (error) {
        console.error('resendOtp error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// Update profile
// ---------------------------------------------------------------------------

const updateProfile = async (req, res) => {
    const { name, profilePicture, phoneNumber } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: 'Name is required' });
    }

    try {
        const user = await userModel.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (!user.isVerified) return res.status(400).json({ success: false, message: 'Please verify your email first' });

        user.name = name;
        if (profilePicture) user.profilePicture = profilePicture;

        if (phoneNumber) {
            if (!/^[0-9]{10}$/.test(phoneNumber)) {
                return res.status(400).json({ success: false, message: 'Invalid phone number format. Please enter 10 digits.' });
            }
            user.phoneNumber = phoneNumber;
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                profilePicture: user.profilePicture || '',
                phoneNumber: user.phoneNumber || '',
                isVerified: user.isVerified,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            }
        });
    } catch (error) {
        console.error('updateProfile error:', error);
        if (error.code === 11000 && error.keyPattern?.phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number already exists.' });
        }
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export {
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
};
