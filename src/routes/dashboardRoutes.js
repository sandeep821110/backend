
import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    getDashboardData,
    getDashboardSummary,
    getAnalytics,
    getInventoryAlerts,
    refreshDashboardData,
    generateDashboardData
} from '../controller/dashboardController.js';

const dashboardRouter = express.Router();

// Apply authentication and admin protection to all dashboard routes
dashboardRouter.use(protect);
dashboardRouter.use(adminOnly);

// Dashboard overview routes
dashboardRouter.get('/', getDashboardData);
dashboardRouter.get('/summary', getDashboardSummary);

// Analytics and reporting routes
dashboardRouter.get('/analytics', getAnalytics);
dashboardRouter.get('/inventory-alerts', getInventoryAlerts);

// Data management routes
dashboardRouter.post('/refresh', refreshDashboardData);
dashboardRouter.post('/generate', async (req, res) => {
    try {
        const data = await generateDashboardData();
        res.status(200).json({
            success: true,
            message: 'Dashboard data generated successfully',
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to generate dashboard data',
            error: error.message
        });
    }
});

export default dashboardRouter;
