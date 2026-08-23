
import userModel from '../models/userModel.js';
import generateOTP from '../utils/otpGenrator.js';
import { sendOTPEmail } from '../middleware/emailService.js';
import jwt from 'jsonwebtoken';

// Helper function to generate JWT token with different expiry for admin
const generateToken = (userId, email, isAdmin = false) => {
  const expiresIn = isAdmin ? '1d' : '7d'; // Admin tokens expire in 1 day, user tokens in 7 days
  
  return jwt.sign(
    { id: userId, email, isAdmin },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

// Cookie-based session: JWT lives in an httpOnly cookie the JS cannot read.
// Cross-site (Vercel frontend -> Vercel backend) requires SameSite=None + Secure,
// so that combination is only used when the app runs in production over HTTPS.
const AUTH_COOKIE = 'access_token';

const authCookieOptions = (isAdmin = false) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: (isAdmin ? 1 : 7) * 24 * 60 * 60 * 1000 // matches token: admin 1d, user 7d
});

const setAuthCookie = (res, token, isAdmin = false) => {
  res.cookie(AUTH_COOKIE, token, authCookieOptions(isAdmin));
};

// Signup user
const signUpUser = async (req, res) => {
    const { email } = req.body;

    try {
        // Validate email format
        if (!email.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Check if user already exists
        let user = await userModel.findOne({ email: email });
        
        if (user) {
            // If user exists and is verified
            if (user.isVerified) {
                return res.status(400).json({ message: "User already exists and is verified" });
            }
            
            // If user exists but is not verified, regenerate and resend OTP
            const otp = generateOTP();
            const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

            // Update existing user with new OTP
            user.otp = parseInt(otp);
            user.otpValidity = otpValidity;
            await user.save();

            // Send OTP email
            await sendOTPEmail(email, otp);

            return res.status(200).json({ 
                message: "User exists but not verified. New OTP sent to your email." 
            });
        }

        // Create new user if doesn't exist
        user = new userModel({
            email,
            isVerified: false
        });

        await user.save();

        // Generate OTP
        const otp = generateOTP();
        const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

        // Update user with OTP
        user.otp = parseInt(otp);
        user.otpValidity = otpValidity;
        await user.save();

        // Send OTP email
        await sendOTPEmail(email, otp);

        res.status(201).json({ message: "User created. Please verify your email." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// Verify OTP
const verifyOTP = async (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        return res.status(400).json({ message: "OTP is required" });
    }

    try {
        const user = await userModel.findOne({ otp: parseInt(otp) });
        if (!user) {
            return res.status(404).json({ message: "Invalid OTP" });
        }

        if (!user.otpValidity || user.otpValidity < new Date()) {
            return res.status(400).json({ message: "OTP expired" });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpValidity = undefined;
        await user.save();

        // Generate JWT token after successful verification
        const token = generateToken(user._id, user.email);
        setAuthCookie(res, token);

        res.status(200).json({ 
            message: "Email verified successfully",
            token,
            user: {
                id: user._id,
                email: user.email,
                isVerified: user.isVerified
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// Login user
const loginUser = async (req, res) => {
    const { email, otp } = req.body;

    try {
        // If OTP is provided, verify it for login
        if (otp) {
            const user = await userModel.findOne({ email });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (!user.isVerified) {
                return res.status(400).json({ message: "Email not verified" });
            }

            if (user.otp !== parseInt(otp)) {
                return res.status(400).json({ message: "Invalid OTP" });
            }

            if (!user.otpValidity || user.otpValidity < new Date()) {
                return res.status(400).json({ message: "OTP expired" });
            }

            // Clear OTP after successful login
            user.otp = undefined;
            user.otpValidity = undefined;
            await user.save();

            // Generate JWT token
            const token = generateToken(user._id, user.email);
            setAuthCookie(res, token);

            return res.status(200).json({
                message: "Login successful",
                token,
                user: {
                    id: user._id,
                    email: user.email,
                    isVerified: user.isVerified
                }
            });
        } 
        // If only email is provided, send OTP for login
        else {
            const user = await userModel.findOne({ email });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (!user.isVerified) {
                return res.status(400).json({ message: "Email not verified" });
            }

            // Generate new OTP for login
            const otp = generateOTP();
            const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

            user.otp = parseInt(otp);
            user.otpValidity = otpValidity;
            await user.save();

            // Send OTP email
            await sendOTPEmail(email, otp);

            res.status(200).json({ message: "OTP sent to your email for login" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// Logout user
const logoutUser = async (req, res) => {
    // Clear the httpOnly session cookie (client also drops its localStorage copy)
    res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined, httpOnly: true });
    res.status(200).json({ message: "Logged out successfully" });
};

// Get user profile
const getProfile = async (req, res) => {
    try {
        // Get user ID from the authenticated token (req.user is set by protect middleware)
        const user = await userModel.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
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
        console.error('Error in getProfile:', error);
        res.status(500).json({ 
            success: false,
            message: "Server error" 
        });
    }
};

// Admin login
const adminLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // Validate environment variables
        if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
            console.error('Admin credentials not configured in environment variables');
            return res.status(500).json({ message: "Server configuration error" });
        }

        // Check admin credentials
        const isAdmin = email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD;
        
        if (!isAdmin) {
            console.log('Failed admin login attempt for email:', email);
            return res.status(401).json({ message: "Invalid admin credentials" });
        }
        
        // Generate admin JWT token (valid for 1 day only)
        const token = generateToken('admin', email, true);
        setAuthCookie(res, token, true);
        
        console.log('Admin login successful for:', email);
        
        res.status(200).json({
            message: "Admin login successful",
            token,
            user: {
                id: 'admin',
                email,
                isAdmin: true
            },
            tokenExpiry: '1d',
            loginTime: new Date().toISOString()
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: "Server error" });
    }
};


const resendOtp = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    try {
        // Validate email format
        if (!email.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Find user by email
        const user = await userModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found. Please register first." });
        }

        // If user is already verified, inform them
        if (user.isVerified) {
            return res.status(400).json({ message: "User is already verified" });
        }

        // ✅ THIS PART HANDLES YOUR REQUIREMENT:
        // If user exists but is not verified (isVerified: false), 
        // generate new OTP and send for verification
        const otp = generateOTP();
        const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

        // Update user with new OTP
        user.otp = parseInt(otp);
        user.otpValidity = otpValidity;
        await user.save();

        // Send OTP email for verification
        await sendOTPEmail(email, otp);

        res.status(200).json({ 
            message: "OTP resent successfully to your email for verification",
            isVerified: user.isVerified
        });
    } catch (error) {
        console.error('Error in resendOtp:', error);
        res.status(500).json({ message: "Server error" });
    }
};



const updateProfile = async (req, res) => {
    const { name, profilePicture, phoneNumber } = req.body;
    
    // Validate required fields
    if (!name) {
        return res.status(400).json({ 
            success: false,
            message: "Name is required" 
        });
    }

    try {
        // Get user ID from the authenticated token (req.user is set by protect middleware)
        const user = await userModel.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: "User not found" 
            });
        }

        // Check if user is verified
        if (!user.isVerified) {
            return res.status(400).json({ 
                success: false,
                message: "Please verify your email first" 
            });
        }

        // Update user profile fields
        user.name = name;
        
        if (profilePicture) {
            user.profilePicture = profilePicture;
        }
        
        if (phoneNumber) {
            // Validate phone number format (10 digits)
            if (!phoneNumber.match(/^[0-9]{10}$/)) {
                return res.status(400).json({ 
                    success: false,
                    message: "Invalid phone number format. Please enter 10 digits." 
                });
            }
            user.phoneNumber = phoneNumber;
        }

        // Save the updated user
        await user.save();

        res.status(200).json({
            success: true,
            message: "Profile updated successfully",
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
        console.error('Error in updateProfile:', error);
        
        // Handle duplicate phone number error
        if (error.code === 11000 && error.keyPattern?.phoneNumber) {
            return res.status(400).json({ 
                success: false,
                message: "Phone number already exists. Please use a different number." 
            });
        }
        
        res.status(500).json({ 
            success: false,
            message: "Server error" 
        });
    }
};
export { signUpUser, verifyOTP, loginUser, logoutUser, getProfile, adminLogin, resendOtp, updateProfile }
