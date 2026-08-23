
import mongoose from "mongoose";
import { configDotenv } from "dotenv";

configDotenv();

let handlersAttached = false;
let connectPromise = null;

const connectDb = async () => {
    // Already connected - instant return (warm serverless invocations).
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    // Connect in progress (readyState 2): await the SAME promise instead of
    // returning early, otherwise callers race the handshake.
    if (!connectPromise) {
        connectPromise = doConnect().catch((error) => {
            connectPromise = null; // allow retry on next request
            throw error;
        });
    }
    return connectPromise;
};

const doConnect = async () => {
    const isProduction = process.env.NODE_ENV === 'production';

    await mongoose.connect(process.env.MONGODB_URI, {
        // Connection pool sizing: more concurrent users handled per worker.
        maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '', 10) || (isProduction ? 50 : 20),
        minPoolSize: 5,                       // keep warm connections ready
        maxIdleTimeMS: 30000,                 // recycle idle connections after 30s
        serverSelectionTimeoutMS: 10000,      // fail fast if DB unreachable
        socketTimeoutMS: 45000,
        family: 4,                            // prefer IPv4 (faster DNS on some hosts)
    });

    console.log(`MongoDB connected [pid:${process.pid}] pool=${mongoose.connection.db.options.maxPoolSize ?? 'auto'}`);

    // Resilience: reconnect automatically on network blips
    if (!handlersAttached) {
        handlersAttached = true;
        mongoose.connection.on('disconnected', () => {
            console.error(`MongoDB disconnected [pid:${process.pid}] - driver will auto-reconnect`);
        });
        mongoose.connection.on('reconnected', () => {
            console.log(`MongoDB reconnected [pid:${process.pid}]`);
        });
    }

    return mongoose.connection;
};

export default connectDb;
