
import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    addAddress,
    getUserAddresses,
    getAddressById,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    getAllAddresses,
    getAddressByIdAdmin
} from '../controller/addressController.js';

const addressRouter = express.Router();

// All address routes require authentication
addressRouter.use(protect);

// Get all user addresses
addressRouter.get('/', getUserAddresses);

// Add new address
addressRouter.post('/', addAddress);


// Get single address by ID
addressRouter.get('/:id', getAddressById);

// Update address
addressRouter.put('/:id', updateAddress);

// Delete address (soft delete)
addressRouter.delete('/:id', deleteAddress);

// Set address as default
addressRouter.patch('/:id/default', setDefaultAddress);

// Admin routes (require authentication + admin privileges)
addressRouter.get('/admin/all', adminOnly, getAllAddresses);
addressRouter.get('/admin/:id', adminOnly, getAddressByIdAdmin);

export default addressRouter;
