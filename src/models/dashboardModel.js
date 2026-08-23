
import mongoose from "mongoose";

const dashboardSchema = new mongoose.Schema({
    // Date for which this dashboard data is recorded
    date: {
        type: Date,
        required: true,
        unique: true,
        default: () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return today;
        }
    },
    
    // Sales Metrics
    sales: {
        totalRevenue: {
            type: Number,
            default: 0,
            min: 0
        },
        totalOrders: {
            type: Number,
            default: 0,
            min: 0
        },
        averageOrderValue: {
            type: Number,
            default: 0,
            min: 0
        },
        completedOrders: {
            type: Number,
            default: 0,
            min: 0
        },
        cancelledOrders: {
            type: Number,
            default: 0,
            min: 0
        },
        pendingOrders: {
            type: Number,
            default: 0,
            min: 0
        }
    },

    // Product Metrics
    products: {
        totalProducts: {
            type: Number,
            default: 0,
            min: 0
        },
        outOfStockProducts: {
            type: Number,
            default: 0,
            min: 0
        },
        lowStockProducts: {
            type: Number,
            default: 0,
            min: 0
        },
        newProductsAdded: {
            type: Number,
            default: 0,
            min: 0
        },
        bestSellingProducts: [{
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product'
            },
            productName: String,
            quantitySold: {
                type: Number,
                default: 0
            },
            revenue: {
                type: Number,
                default: 0
            }
        }]
    },

    // User Metrics
    users: {
        totalUsers: {
            type: Number,
            default: 0,
            min: 0
        },
        newUsers: {
            type: Number,
            default: 0,
            min: 0
        },
        activeUsers: {
            type: Number,
            default: 0,
            min: 0
        },
        returningUsers: {
            type: Number,
            default: 0,
            min: 0
        }
    },

    // Cart & Wishlist Metrics
    engagement: {
        totalCarts: {
            type: Number,
            default: 0,
            min: 0
        },
        abandonedCarts: {
            type: Number,
            default: 0,
            min: 0
        },
        cartConversionRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        totalWishlists: {
            type: Number,
            default: 0,
            min: 0
        },
        wishlistToCartConversion: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        }
    },

    // Category Performance
    categoryPerformance: [{
        category: {
            type: String,
            required: true
        },
        totalSales: {
            type: Number,
            default: 0,
            min: 0
        },
        totalOrders: {
            type: Number,
            default: 0,
            min: 0
        },
        revenue: {
            type: Number,
            default: 0,
            min: 0
        }
    }],

    // Payment Metrics
    payments: {
        totalTransactions: {
            type: Number,
            default: 0,
            min: 0
        },
        successfulPayments: {
            type: Number,
            default: 0,
            min: 0
        },
        failedPayments: {
            type: Number,
            default: 0,
            min: 0
        },
        codOrders: {
            type: Number,
            default: 0,
            min: 0
        },
        onlinePayments: {
            type: Number,
            default: 0,
            min: 0
        },
        paymentSuccessRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        }
    },

    // Traffic & Performance
    traffic: {
        totalVisits: {
            type: Number,
            default: 0,
            min: 0
        },
        uniqueVisitors: {
            type: Number,
            default: 0,
            min: 0
        },
        bounceRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        averageSessionDuration: {
            type: Number,
            default: 0,
            min: 0
        }
    },

    // Inventory Alerts
    alerts: {
        lowStockAlerts: [{
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product'
            },
            productName: String,
            currentStock: Number,
            threshold: Number
        }],
        outOfStockAlerts: [{
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product'
            },
            productName: String,
            lastStockDate: Date
        }]
    },

    // Monthly/Yearly Aggregates (for historical data)
    aggregates: {
        monthlyRevenue: {
            type: Number,
            default: 0
        },
        monthlyOrders: {
            type: Number,
            default: 0
        },
        yearlyRevenue: {
            type: Number,
            default: 0
        },
        yearlyOrders: {
            type: Number,
            default: 0
        }
    },

    // System Health
    system: {
        totalStorageUsed: {
            type: Number,
            default: 0
        },
        apiResponseTime: {
            type: Number,
            default: 0
        },
        errorRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
dashboardSchema.index({ date: -1 });
dashboardSchema.index({ 'sales.totalRevenue': -1 });
dashboardSchema.index({ 'products.bestSellingProducts.quantitySold': -1 });

// Virtual for growth rate calculation
dashboardSchema.virtual('growthRate').get(function() {
    // This would be calculated by comparing with previous period
    return {
        revenueGrowth: 0, // Percentage growth in revenue
        orderGrowth: 0,   // Percentage growth in orders
        userGrowth: 0     // Percentage growth in users
    };
});

// Static method to get dashboard data for a specific date range
dashboardSchema.statics.getDateRangeData = function(startDate, endDate) {
    return this.find({
        date: {
            $gte: startDate,
            $lte: endDate
        }
    }).sort({ date: -1 });
};

// Static method to get latest dashboard data
dashboardSchema.statics.getLatest = function() {
    return this.findOne().sort({ date: -1 });
};

// Method to calculate conversion rates
dashboardSchema.methods.calculateConversionRates = function() {
    const cartConversion = this.engagement.totalCarts > 0 
        ? ((this.sales.completedOrders / this.engagement.totalCarts) * 100).toFixed(2)
        : 0;
    
    const paymentSuccess = this.payments.totalTransactions > 0
        ? ((this.payments.successfulPayments / this.payments.totalTransactions) * 100).toFixed(2)
        : 0;

    return {
        cartToOrderConversion: cartConversion,
        paymentSuccessRate: paymentSuccess
    };
};

const Dashboard = mongoose.model('Dashboard', dashboardSchema);

export default Dashboard;
