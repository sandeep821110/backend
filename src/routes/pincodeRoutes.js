import { 
    addPincode,
    getAllPincode,
    getPincode,
    deletePincode
} from '../controller/pincodeController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import express from 'express';
const pincodeRouter = express.Router();

// Public routes (no authentication required)
pincodeRouter.get('/:pincode', getPincode); // Get pincode details by number

// Protected routes (authentication required)
pincodeRouter.get('/', getAllPincode); // Get all pincodes with filters and pagination

// Admin only routes (authentication + admin privileges required)
pincodeRouter.post('/', protect, adminOnly, addPincode); // Add new pincode
pincodeRouter.delete('/:id', protect, adminOnly, deletePincode); // Delete pincode

export default pincodeRouter;
