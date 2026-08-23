import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  createOrderTracking,
  getTrackingByNumber,
  updateTrackingStatus,
  getUserTrackings,
  adminGetAllTrackings,
  deleteTracking,
  addDeliveryAttempt,
  updateTrackingDetails,
  getUserTrackingByOrderId,
  getTrackingByOrderNumber
} from '../controller/orderTrackingController.js';

const router = express.Router();

// Public
router.get('/track/:trackingNumber', getTrackingByNumber);

// Protected user
router.get('/my-orders', protect, getUserTrackings);
router.get('/my-orders/:orderId', protect, getUserTrackingByOrderId);

// Admin
router.post('/', protect, adminOnly, createOrderTracking);            // create tracking
router.put('/status/:trackingNumber', protect, adminOnly, updateTrackingStatus); // update status
router.put('/attempt/:trackingNumber', protect, adminOnly, addDeliveryAttempt); // add delivery attempt
router.put('/details/:trackingNumber', protect, adminOnly, updateTrackingDetails); // update details
router.get('/', protect, adminOnly, adminGetAllTrackings);           // list all (admin)
router.delete('/:trackingNumber', protect, adminOnly, deleteTracking); // delete
router.get('/by-order/:orderNumber', protect, getTrackingByOrderNumber); // or public if desired
// ...existing code...

export default router;    