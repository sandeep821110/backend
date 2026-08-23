
import PhoneUser from '../models/phoneUserModel.js';
import generateOTP from '../utils/otpGenrator.js';
import { sendOTPMessage } from '../services/twilioService.js'; // Updated import
import jwt from 'jsonwebtoken';

// Helper function to generate JWT token
const generateToken = (userId, phoneNumber) => {
  return jwt.sign(
    { id: userId, phoneNumber },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Helper function to validate Indian phone number
const validatePhoneNumber = (phoneNumber) => {
  // Indian phone numbers are 10 digits, optionally with country code +91
  // Valid formats: 9876543210, +919876543210, 919876543210
  
  // Remove any non-digit characters except the plus sign at the beginning
  let cleaned = phoneNumber.replace(/(?!^\+)\D/g, '');
  
  // Check if it's a valid Indian phone number
  if (cleaned.startsWith('+91')) {
    // Format: +91XXXXXXXXXX (should be 12 chars total)
    return cleaned.length === 13 && /^\+91[6-9]\d{9}$/.test(cleaned);
  } else if (cleaned.startsWith('91')) {
    // Format: 91XXXXXXXXXX (should be 12 chars total)
    return cleaned.length === 12 && /^91[6-9]\d{9}$/.test(cleaned);
  } else {
    // Format: XXXXXXXXXX (should be 10 chars total)
    return cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned);
  }
};

const registerUser = async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }
    
    // Check if user already exists
    const user = await PhoneUser.findOne({ phoneNumber });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    // Send OTP via SMS
    await sendOTPMessage(phoneNumber, otp);

    // Create new user in the database
    const newUser = new PhoneUser({
      phoneNumber,
      otp: parseInt(otp),
      otpValidity,
      isVerified: false
    });
    
    await newUser.save();

    // Generate JWT token
    const token = generateToken(newUser._id, newUser.phoneNumber);

    res.json({ 
      message: 'OTP sent successfully. Please verify your phone number.',
      token 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update the requestOTP function to handle mock responses
const requestOTP = async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }
    
    // Check if user exists
    let user = await PhoneUser.findOne({ phoneNumber });
    const isNewUser = !user;
    
    // Generate OTP
    const otp = generateOTP();
    const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    // Send OTP via SMS service
    const smsResponse = await sendOTPMessage(phoneNumber, otp);
    
    // For development with trial accounts, log the OTP
    if (process.env.NODE_ENV === 'development' || smsResponse.mock) {
      console.log(`DEVELOPMENT OTP for ${phoneNumber}: ${otp}`);
    }

    if (isNewUser) {
      // Create new user
      user = new PhoneUser({
        phoneNumber,
        otp: parseInt(otp),
        otpValidity,
        isVerified: false
      });
    } else {
      // Update existing user with new OTP
      user.otp = parseInt(otp);
      user.otpValidity = otpValidity;
    }
    
    await user.save();

    res.status(200).json({ 
      message: `OTP sent successfully to ${phoneNumber}`,
      isNewUser,
      // Include the OTP in development mode for testing
      ...(process.env.NODE_ENV === 'development' && { otp })
    });
  } catch (error) {
    console.error('Error in requestOTP:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Verify OTP function
const verifyOTP = async (req, res) => {
  const { phoneNumber, otp, name, email, profilePicture } = req.body;

  try {
    // Find user by phone number
    const user = await PhoneUser.findOne({ phoneNumber });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify OTP
    if (user.otp !== parseInt(otp)) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Check OTP validity
    if (!user.otpValidity || user.otpValidity < new Date()) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    // Mark user as verified
    user.isVerified = true;
    
    // Update user profile with provided data
    if (name) {
      user.name = name;
      console.log(`Updated name to: ${name}`);
    }
    
    if (email) {
      user.email = email;
      console.log(`Updated email to: ${email}`);
    }
    
    if (profilePicture) {
      user.profilePicture = profilePicture;
      console.log(`Updated profile picture`);
    }
    
    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpValidity = undefined;
    
    // Save the updated user data
    await user.save();
    console.log(`User data saved successfully for ${phoneNumber}`);

    // Generate JWT token
    const token = generateToken(user._id, user.phoneNumber);

    res.status(200).json({
      message: 'Phone number verified successfully',
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name || '',
        email: user.email || '',
        profilePicture: user.profilePicture || '',
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Error in verifyOTP:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  const { name, email, profilePicture } = req.body;
  
  try {
    const user = await PhoneUser.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (name) user.name = name;
    if (email) user.email = email;
    if (profilePicture) user.profilePicture = profilePicture;
    
    await user.save();
    
    res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name || '',
        email: user.email || '',
        profilePicture: user.profilePicture || '',
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const user = await PhoneUser.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.status(200).json({
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name || '',
        email: user.email || '',
        profilePicture: user.profilePicture || '',
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Logout user
const logout = async (req, res) => {
  // Since JWT is stateless, we can't invalidate the token on the server side
  // The client should remove the token from storage
  res.status(200).json({ message: 'Logged out successfully' });
};

// Login user - request OTP for login
const login = async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }
    
    // Check if user exists
    const user = await PhoneUser.findOne({ phoneNumber });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found. Please register first.' });
    }
    
    // Generate OTP
    const otp = generateOTP();
    const otpValidity = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    // Send OTP via SMS service
    const smsResponse = await sendOTPMessage(phoneNumber, otp);
    
    // For development with trial accounts, log the OTP
    if (process.env.NODE_ENV === 'development' || smsResponse?.mock) {
      console.log(`LOGIN OTP for ${phoneNumber}: ${otp}`);
    }

    // Update user with new OTP
    user.otp = parseInt(otp);
    user.otpValidity = otpValidity;
    await user.save();

    res.status(200).json({ 
      message: `OTP sent successfully to ${phoneNumber} for login`,
      // Include the OTP in development mode for testing
      ...(process.env.NODE_ENV === 'development' && { otp })
    });
  } catch (error) {
    console.error('Error in login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Verify login OTP
const verifyLoginOTP = async (req, res) => {
  const { phoneNumber, otp } = req.body;

  try {
    // Find user by phone number
    const user = await PhoneUser.findOne({ phoneNumber });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify OTP
    if (user.otp !== parseInt(otp)) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Check OTP validity
    if (!user.otpValidity || user.otpValidity < new Date()) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(401).json({ 
        message: 'Account not verified. Please complete registration first.',
        needsRegistration: true
      });
    }
    
    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpValidity = undefined;
    
    // Save the updated user data
    await user.save();

    // Generate JWT token
    const token = generateToken(user._id, user.phoneNumber);

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name || '',
        email: user.email || '',
        profilePicture: user.profilePicture || '',
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Error in verifyLoginOTP:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export { registerUser, requestOTP, verifyOTP, updateProfile, getProfile, logout, login, verifyLoginOTP };
