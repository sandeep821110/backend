
import Dashboard from '../models/dashboardModel.js';
import Product from '../models/productModel.js';
import Cart from '../models/cartModel.js';
import Wishlist from '../models/wishlistModel.js';
import User from '../models/userModel.js';

// Get current dashboard data
export const getDashboardData = async (req, res) => {
    try {
        const { period = 'today' } = req.query;
        let startDate, endDate;

        // Calculate date range based on period
        const now = new Date();
        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear() + 1, 0, 1);
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        }

        const dashboardData = await Dashboard.getDateRangeData(startDate, endDate);

        if (!dashboardData || dashboardData.length === 0) {
            // Generate fresh dashboard data if none exists
            const freshData = await generateDashboardData();
            return res.status(200).json({
                success: true,
                data: freshData,
                message: 'Dashboard data generated'
            });
        }

        // Aggregate data for the period
        const aggregatedData = aggregateDashboardData(dashboardData);

        res.status(200).json({
            success: true,
            data: aggregatedData,
            period
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard data',
            error: error.message
        });
    }
};

// Generate real-time dashboard data
export const generateDashboardData = async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get existing dashboard data for today or create new
        let dashboard = await Dashboard.findOne({ date: today });
        
        if (!dashboard) {
            dashboard = new Dashboard({ date: today });
        }

        // Calculate product metrics
        const totalProducts = await Product.countDocuments();
        const outOfStockProducts = await Product.countDocuments({ stock: 0 });
        const lowStockProducts = await Product.countDocuments({ 
            stock: { $gt: 0, $lte: 10 } 
        });

        // Calculate user metrics
        const totalUsers = await User.countDocuments();
        const todayStart = new Date(today);
        const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        const newUsers = await User.countDocuments({
            createdAt: { $gte: todayStart, $lt: todayEnd }
        });

        // Calculate cart metrics
        const totalCarts = await Cart.countDocuments();
        const totalWishlists = await Wishlist.countDocuments();

        // Update dashboard data
        dashboard.products.totalProducts = totalProducts;
        dashboard.products.outOfStockProducts = outOfStockProducts;
        dashboard.products.lowStockProducts = lowStockProducts;
        
        dashboard.users.totalUsers = totalUsers;
        dashboard.users.newUsers = newUsers;
        
        dashboard.engagement.totalCarts = totalCarts;
        dashboard.engagement.totalWishlists = totalWishlists;

        // Generate low stock alerts
        const lowStockItems = await Product.find({ 
            stock: { $gt: 0, $lte: 10 } 
        }).select('name stock');
        
        dashboard.alerts.lowStockAlerts = lowStockItems.map(item => ({
            productId: item._id,
            productName: item.name,
            currentStock: item.stock,
            threshold: 10
        }));

        // Generate out of stock alerts
        const outOfStockItems = await Product.find({ stock: 0 }).select('name updatedAt');
        
        dashboard.alerts.outOfStockAlerts = outOfStockItems.map(item => ({
            productId: item._id,
            productName: item.name,
            lastStockDate: item.updatedAt
        }));

        await dashboard.save();
        return dashboard;
    } catch (error) {
        console.error('Error generating dashboard data:', error);
        throw error;
    }
};

// Get dashboard summary for quick overview
export const getDashboardSummary = async (req, res) => {
    try {
        const latestDashboard = await Dashboard.getLatest();
        
        if (!latestDashboard) {
            const freshData = await generateDashboardData();
            return res.status(200).json({
                success: true,
                data: {
                    totalRevenue: freshData.sales.totalRevenue,
                    totalOrders: freshData.sales.totalOrders,
                    totalProducts: freshData.products.totalProducts,
                    totalUsers: freshData.users.totalUsers,
                    lowStockAlerts: freshData.alerts.lowStockAlerts.length,
                    outOfStockAlerts: freshData.alerts.outOfStockAlerts.length
                }
            });
        }

        const summary = {
            totalRevenue: latestDashboard.sales.totalRevenue,
            totalOrders: latestDashboard.sales.totalOrders,
            totalProducts: latestDashboard.products.totalProducts,
            totalUsers: latestDashboard.users.totalUsers,
            lowStockAlerts: latestDashboard.alerts.lowStockAlerts.length,
            outOfStockAlerts: latestDashboard.alerts.outOfStockAlerts.length,
            conversionRates: latestDashboard.calculateConversionRates()
        };

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard summary',
            error: error.message
        });
    }
};

// Get analytics data for charts and graphs
export const getAnalytics = async (req, res) => {
    try {
        const { type = 'sales', period = 'week' } = req.query;
        
        let startDate, endDate;
        const now = new Date();
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear() + 1, 0, 1);
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
        }

        const analyticsData = await Dashboard.find({
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        let responseData = {};

        switch (type) {
            case 'sales':
                responseData = analyticsData.map(item => ({
                    date: item.date,
                    revenue: item.sales.totalRevenue,
                    orders: item.sales.totalOrders,
                    averageOrderValue: item.sales.averageOrderValue
                }));
                break;
            case 'products':
                responseData = analyticsData.map(item => ({
                    date: item.date,
                    totalProducts: item.products.totalProducts,
                    outOfStock: item.products.outOfStockProducts,
                    lowStock: item.products.lowStockProducts
                }));
                break;
            case 'users':
                responseData = analyticsData.map(item => ({
                    date: item.date,
                    totalUsers: item.users.totalUsers,
                    newUsers: item.users.newUsers,
                    activeUsers: item.users.activeUsers
                }));
                break;
            default:
                responseData = analyticsData;
        }

        res.status(200).json({
            success: true,
            data: responseData,
            type,
            period
        });
    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch analytics data',
            error: error.message
        });
    }
};

// Get inventory alerts
export const getInventoryAlerts = async (req, res) => {
    try {
        const latestDashboard = await Dashboard.getLatest();
        
        if (!latestDashboard) {
            return res.status(200).json({
                success: true,
                data: {
                    lowStockAlerts: [],
                    outOfStockAlerts: []
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                lowStockAlerts: latestDashboard.alerts.lowStockAlerts,
                outOfStockAlerts: latestDashboard.alerts.outOfStockAlerts
            }
        });
    } catch (error) {
        console.error('Error fetching inventory alerts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory alerts',
            error: error.message
        });
    }
};

// Refresh dashboard data manually
export const refreshDashboardData = async (req, res) => {
    try {
        const freshData = await generateDashboardData();
        
        res.status(200).json({
            success: true,
            message: 'Dashboard data refreshed successfully',
            data: freshData
        });
    } catch (error) {
        console.error('Error refreshing dashboard data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refresh dashboard data',
            error: error.message
        });
    }
};

// Helper function to aggregate dashboard data
const aggregateDashboardData = (data) => {
    if (!data || data.length === 0) {
        return {
            totalRevenue: 0,
            totalOrders: 0,
            totalProducts: 0,
            totalUsers: 0,
            lowStockAlerts: 0,
            outOfStockAlerts: 0
        };
    }

    return data.reduce((acc, item) => {
        acc.totalRevenue += item.sales.totalRevenue || 0;
        acc.totalOrders += item.sales.totalOrders || 0;
        acc.totalProducts = item.products.totalProducts || 0; // Use latest count, not sum
        acc.totalUsers = item.users.totalUsers || 0; // Use latest count, not sum
        acc.lowStockAlerts += item.alerts.lowStockAlerts.length || 0;
        acc.outOfStockAlerts += item.alerts.outOfStockAlerts.length || 0;
        return acc;
    }, {
        totalRevenue: 0,
        totalOrders: 0,
        totalProducts: 0,
        totalUsers: 0,
        lowStockAlerts: 0,
        outOfStockAlerts: 0
    });
};
