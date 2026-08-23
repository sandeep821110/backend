import jwt from 'jsonwebtoken';
import Rider from '../models/riderModel.js';

/**
 * Auth for delivery riders. Tokens carry { id, email, isRider: true } -
 * fully separate from customer (protect) and admin (adminOnly) sessions.
 */
export const riderProtect = async (req, res, next) => {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authorized, no token' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.isRider) {
            return res.status(403).json({ success: false, message: 'Access denied - rider account required' });
        }

        const rider = await Rider.findById(decoded.id);
        if (!rider || !rider.isActive) {
            return res.status(403).json({ success: false, message: 'Rider account inactive or missing' });
        }

        req.rider = rider;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized, token invalid' });
    }
};
