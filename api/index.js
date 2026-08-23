import app from "../app.js";
import connectDb from "../src/config/db.js";

// Vercel serverless entry point.
// All routes are rewritten here via vercel.json; the Express app
// handles them exactly like the self-hosted index.js does.
// Cluster mode / RabbitMQ worker / PORT listening stay in index.js
// (Railway / Render / PM2 deployments) and are intentionally NOT used here.
//
// app.js fires connectDb() without awaiting it - fine for long-lived
// servers, but on a cold lambda the first request would race the
// connection (query buffering timeouts). Await it per invocation;
// connectDb() is idempotent and instant once warm.
export default async function handler(req, res) {
    try {
        await connectDb();
    } catch (error) {
        console.error("[serverless] DB unavailable:", error.message);
        return res.status(503).json({
            success: false,
            message: "Database temporarily unavailable, please retry",
        });
    }
    return app(req, res);
}
