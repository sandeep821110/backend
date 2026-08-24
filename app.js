import express from 'express';
import cors from 'cors';
import { configDotenv } from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import cookieParser from 'cookie-parser';
import connectDB from './src/config/db.js';
import redisClient, { isRedisEnabled, redisPing } from './src/config/redis.js';
import { isRabbitEnabled } from './src/config/rabbitmq.js';
import { overloadGuard, getLoadStats } from './src/middleware/overload.js';
import userRouter from './src/routes/userRoutes.js';
import productRouter from './src/routes/productRoutes.js';
import pincodeRouter from './src/routes/pincodeRoutes.js';
import cartRouter from './src/routes/cartRoutes.js';
import wishlistRouter from './src/routes/wishlistRoutes.js';
import phoneAuthRouter from './src/routes/phoneAuthRoutes.js';
import paymentRouter from './src/routes/paymentRoutes.js';
import orderRouter from './src/routes/orderRoutes.js';
import addressRouter from './src/routes/addressRoutes.js';
import contactRoute from './src/routes/contactRoute.js';
import dashboardRouter from './src/routes/dashboardRoutes.js';
import orderTrackingRoutes from './src/routes/orderTrackingRoutes.js';
import carsolSliderRoutes from './src/routes/carsolSliderRoutes.js';
import walletRouter from './src/routes/walletRoutes.js';
import riderRouter from './src/routes/riderRoutes.js';

const app = express();

// Connect to database
connectDB();
configDotenv()

// Behind a reverse proxy (Vercel / Render / Railway / Nginx) - needed for correct IPs & HTTPS detection
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// CORS: OPEN by default so any deployed frontend can call the API.
// Set CORS_ORIGINS / CLIENT_ORIGIN to enforce a strict whitelist instead
// (comma-separated, use '*' inside the list to keep it open explicitly).
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_ORIGIN ||
    'https://www.choosemood.in,https://choosemood.in')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, '')) // strip trailing slashes - Origin header never has one
    .filter(Boolean);

const corsOpen = allowedOrigins.length === 0 || allowedOrigins.includes('*');

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (corsOpen || allowedOrigins.includes(origin)) {
            // Reflect the origin (never '*') so credentials stay supported
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'User-Email', 'User-ID']
};

app.use(cors(corsOptions));

// Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Overload guard FIRST (before parsing) so saturated instances shed
// load instantly instead of buffering bodies they can't process.
// Skipped for /health so LBs can always probe the instance.
app.use((req, res, next) => (req.path === '/health' ? next() : overloadGuard(req, res, next)));

// Response compression
app.use(compression());

// Global API rate limiter
// With Redis the counter is SHARED across all load-balanced instances /
// cluster workers, so limits hold no matter which replica serves a request.
const redisStore = isRedisEnabled()
    ? new RedisStore({
          sendCommand: (...args) => redisClient.call(...args)
      })
    : undefined;

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore,
    message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

// Routes
app.use('/api/users', userRouter);
app.use('/api/products', productRouter);
app.use('/api/pincode', pincodeRouter);
app.use('/api/cart', cartRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/phone-auth', phoneAuthRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/orders', orderRouter);
app.use('/api/addresses', addressRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/riders', riderRouter);
app.use('/api/contact', contactRoute);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/order-tracking', orderTrackingRoutes);
app.use('/api/slider', carsolSliderRoutes);

// Health check route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'API is running successfully!',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', async (req, res) => {
    const [redis] = await Promise.all([redisPing()]);
    const healthy = true; // API itself is up if this handler runs
    res.status(200).json({
        success: healthy,
        status: 'healthy',
        uptime: process.uptime(),
        pid: process.pid,
        load: getLoadStats(),
        subsystems: {
            redis: redis.ok ? 'connected' : (redis.reason === 'not configured' ? 'disabled' : 'degraded'),
            rabbitmq: isRabbitEnabled() ? 'connected' : 'disabled'
        }
    });
});

// 404 handler (must be registered after all routes, before error handler)
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);

    if (err.message && err.message.includes('not allowed by CORS')) {
        return res.status(403).json({ success: false, message: 'CORS policy: origin not allowed' });
    }

    if (err.type === 'entity.too.large' || err.statusCode === 413) {
        return res.status(413).json({ success: false, message: 'Request body too large' });
    }

    if (err.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: err.message });
    }

    if (err.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    res.status(err.status || 500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

export default app;
