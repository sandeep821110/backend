
import jwt from 'jsonwebtoken';
import PhoneUser from '../models/phoneUserModel.js';

export const protectPhoneRoute = async (req, res, next) => {
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

      // Check if token contains phoneNumber
      if (!decoded.phoneNumber) {
        return res.status(401).json({ message: 'Invalid token format' });
      }

      // Get user from the token
      const user = await PhoneUser.findById(decoded.id);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      if (!user.isVerified) {
        return res.status(401).json({ message: 'Account not verified' });
      }

      // Add user info to request
      req.user = {
        id: user._id,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified
      };

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};
