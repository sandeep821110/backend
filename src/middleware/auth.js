import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_SECRET;

export const protect = (req, res, next) => {
    try {
        let token = null;

        const cookieToken = req.cookies?.access_token;
        const bearerToken = req.headers.authorization?.startsWith('Bearer')
            ? req.headers.authorization.split(' ')[1]
            : null;

        // Try cookie first, then Bearer
        if (cookieToken) {
            try {
                const payload = jwt.verify(cookieToken, ACCESS_SECRET);
                token = cookieToken;
                req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
            } catch (err) {
                if (bearerToken) {
                    const payload = jwt.verify(bearerToken, ACCESS_SECRET);
                    token = bearerToken;
                    req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
                }
            }
        } else if (bearerToken) {
            const payload = jwt.verify(bearerToken, ACCESS_SECRET);
            token = bearerToken;
            req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
        }

        if (!token || !req.user) {
            return res.status(401).json({ success: false, message: 'Not authenticated', code: 'NO_TOKEN' });
        }

        return next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ success: false, message: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }
};
