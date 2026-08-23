import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { riderProtect } from '../middleware/riderAuth.js';
import {
    riderLogin,
    getAssignedOrders,
    startDelivery,
    completeDelivery,
    reportFailedDelivery,
    listRiders,
    createRider,
    assignRider
} from '../controller/riderController.js';

const riderRouter = express.Router();

// Public
riderRouter.post('/login', riderLogin);

// Admin management (standard admin session)
riderRouter.get('/all', protect, adminOnly, listRiders);
riderRouter.post('/create', protect, adminOnly, createRider);
riderRouter.patch('/assign/:orderId', protect, adminOnly, assignRider);

// Rider portal (rider JWT)
riderRouter.use(riderProtect);
riderRouter.get('/orders', getAssignedOrders);
riderRouter.patch('/orders/:id/out-for-delivery', startDelivery);
riderRouter.patch('/orders/:id/complete-delivery', completeDelivery);
riderRouter.patch('/orders/:id/delivery-failed', reportFailedDelivery);

export default riderRouter;
