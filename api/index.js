import app from "../app.js";

// Vercel serverless entry point.
// All routes are rewritten here via vercel.json; the Express app
// handles them exactly like the self-hosted index.js does.
// Cluster mode / RabbitMQ worker / PORT listening stay in index.js
// (Railway / Render / PM2 deployments) and are intentionally NOT used here.
export default app;
