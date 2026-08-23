
import Address from '../models/addressModel.js';

// Get all addresses for a user
export const getUserAddresses = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10 } = req.query;

        const addresses = await Address.find({ 
            user: userId, 
            isActive: true 
        })
        .sort({ isDefault: -1, createdAt: -1 }) // Default address first, then by creation date
        .limit(limit * 1)
        .skip((page - 1) * limit);

        const total = await Address.countDocuments({ 
            user: userId, 
            isActive: true 
        });

        res.status(200).json({
            success: true,
            message: 'Addresses retrieved successfully',
            data: {
                addresses,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                totalAddresses: total
            }
        });
    } catch (error) {
        console.error('Error fetching addresses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch addresses',
            error: error.message
        });
    }
};

// Get single address by ID
export const getAddressById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address ID format'
            });
        }

        const address = await Address.findOne({ 
            _id: id, 
            user: userId, 
            isActive: true 
        });

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Address retrieved successfully',
            data: address
        });
    } catch (error) {
        console.error('Error fetching address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch address',
            error: error.message
        });
    }
};

// Add new address
export const addAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            fullName,
            email,  // Add email here
            phoneNumber,
            addressLine1,  // Changed from 'address' to 'addressLine1'
            addressLine2,  // Added this field
            city,
            state,
            pincode,
            landmark,
            type,  // Changed from 'addressType' to 'type'
            isDefault
        } = req.body;

        // Validate required fields - updated field names
        if (!fullName || !phoneNumber || !addressLine1 || !city || !pincode) {
            return res.status(400).json({
                success: false,
                message: 'Full name, phone number, address line 1, city, and pincode are required'
            });
        }

        // Check if this is the user's first address, make it default
        const existingAddressCount = await Address.countDocuments({ 
            user: userId, 
            isActive: true 
        });

        const newAddress = new Address({
            user: userId,
            fullName: fullName.trim(),
            email,
            
            phoneNumber: phoneNumber.trim(),
            addressLine1: addressLine1.trim(),  // Updated field name
            addressLine2: addressLine2?.trim() || '',  // Added this field
            city: city.trim(),
            state: state?.trim() || '',
            pincode: pincode.trim(),
            landmark: landmark?.trim() || '',
       // Changed from 'addressType' to 'type'
            isDefault: existingAddressCount === 0 ? true : (isDefault || false)
        });

        await newAddress.save();

        res.status(201).json({
            success: true,
            message: 'Address added successfully',
            data: newAddress
        });
    } catch (error) {
        console.error('Error adding address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add address',
            error: error.message
        });
    }
};

// Update address
export const updateAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const updateData = req.body;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address ID format'
            });
        }

        const address = await Address.findOne({ 
            _id: id, 
            user: userId, 
            isActive: true 
        });

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        // Update allowed fields
        const allowedUpdates = [
            'fullName', 'email', 'phoneNumber', 'addressLine1', 'addressLine2',
            'city', 'state', 'pincode', 'landmark', 'type', 'isDefault'
        ];

        allowedUpdates.forEach(field => {
            if (updateData[field] !== undefined) {
                if (typeof updateData[field] === 'string') {
                    address[field] = updateData[field].trim();
                } else {
                    address[field] = updateData[field];
                }
            }
        });

        await address.save();

        res.status(200).json({
            success: true,
            message: 'Address updated successfully',
            data: address
        });
    } catch (error) {
        console.error('Error updating address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update address',
            error: error.message
        });
    }
};

// Delete address (soft delete)
export const deleteAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address ID format'
            });
        }

        const address = await Address.findOne({ 
            _id: id, 
            user: userId, 
            isActive: true 
        });

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        // Soft delete using updateOne
        await Address.updateOne(
            { _id: id },
            { isActive: false }
        );

        // If this was the default address, make another address default
        if (address.isDefault) {
            const nextAddress = await Address.findOne({ 
                user: userId, 
                isActive: true,
                _id: { $ne: id }
            }).sort({ createdAt: -1 });

            if (nextAddress) {
                await Address.updateOne(
                    { _id: nextAddress._id },
                    { isDefault: true }
                );
            }
        }

        res.status(200).json({
            success: true,
            message: 'Address deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete address',
            error: error.message
        });
    }
};

// Set default address
export const setDefaultAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address ID format'
            });
        }

        const address = await Address.findOne({ 
            _id: id, 
            user: userId, 
            isActive: true 
        });

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        // Remove default from all other addresses
        await Address.updateMany(
            { user: userId, _id: { $ne: id } },
            { isDefault: false }
        );

        // Set this address as default
        address.isDefault = true;
        await address.save();

        res.status(200).json({
            success: true,
            message: 'Default address updated successfully',
            data: address
        });
    } catch (error) {
        console.error('Error setting default address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to set default address',
            error: error.message
        });
    }
};

// Get default address
export const getDefaultAddress = async (req, res) => {
    try {
        const userId = req.user.id;

        const defaultAddress = await Address.findOne({ 
            user: userId, 
            isDefault: true, 
            isActive: true 
        });

        if (!defaultAddress) {
            return res.status(404).json({
                success: false,
                message: 'No default address found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Default address retrieved successfully',
            data: defaultAddress
        });
    } catch (error) {
        console.error('Error fetching default address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch default address',
            error: error.message
        });
    }
};

// Get addresses by type
export const getAddressesByType = async (req, res) => {
    try {
        const userId = req.user.id;
        const { type } = req.params;

        const addresses = await Address.find({ 
            user: userId, 
            type: type.toUpperCase(), 
            isActive: true 
        }).sort({ isDefault: -1, createdAt: -1 });

        res.status(200).json({
            success: true,
            message: 'Addresses retrieved successfully',
            data: addresses,
            count: addresses.length
        });
    } catch (error) {
        console.error('Error fetching addresses by type:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch addresses by type',
            error: error.message
        });
    }
};

// Get all addresses for admin (with user details)
export const getAllAddresses = async (req, res) => {
    try {
        const { page = 1, limit = 10, userId, city, state, type, pincode } = req.query;

        // Build filter object
        const filter = { isActive: true };
        
        if (userId) {
            // Validate ObjectId for userId
            if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user ID format'
                });
            }
            filter.user = userId;
        }
        
        if (city) {
            filter.city = { $regex: city, $options: 'i' };
        }
        
        if (state) {
            filter.state = { $regex: state, $options: 'i' };
        }
        
        if (type) {
            filter.type = type;
        }

        if (pincode) {
            filter.pincode = pincode;
        }

        const addresses = await Address.find(filter)
            .populate('user', 'name email phone')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Address.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: 'All addresses retrieved successfully',
            data: {
                addresses,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                totalAddresses: total,
                filters: {
                    userId,
                    city,
                    state,
                    type,
                    pincode
                }
            }
        });
    } catch (error) {
        console.error('Error fetching all addresses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch addresses',
            error: error.message
        });
    }
};

// Get any address by ID for admin (with user details)
export const getAddressByIdAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address ID format'
            });
        }

        const address = await Address.findOne({ 
            _id: id, 
            isActive: true 
        }).populate('user', 'name email phone createdAt');

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Address retrieved successfully',
            data: address
        });
    } catch (error) {
        console.error('Error fetching address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch address',
            error: error.message
        });
    }
};
