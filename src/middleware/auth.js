import jwt from 'jsonwebtoken';

export const protect = (req, res, next) => {
  try {
    let token = null;
    const cookieToken = req.cookies?.access_token;
    const bearerToken = req.headers.authorization?.startsWith('Bearer') && req.headers.authorization.split(' ')[1];

    // Try cookie first; if it fails, fall back to Bearer header
    if (cookieToken) {
      try {
        const payload = jwt.verify(cookieToken, process.env.JWT_SECRET);
        token = cookieToken;
        req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
      } catch (err) {
        // Cookie invalid — try Bearer
        if (bearerToken) {
          const payload = jwt.verify(bearerToken, process.env.JWT_SECRET);
          token = bearerToken;
          req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
        }
      }
    } else if (bearerToken) {
      const payload = jwt.verify(bearerToken, process.env.JWT_SECRET);
      token = bearerToken;
      req.user = { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
    }

    if (!token || !req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};