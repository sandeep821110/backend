import Wishlist from '../models/wishlistModel.js';
import Product from '../models/productModel.js';

// Get user's wishlist
export const getWishlist = async (req, res) => {
    try {
        const userId = req.user.id;

        const wishlist = await Wishlist.findOne({ user: userId })
            .populate('items.productId', 'name price image category sizeQuantity discount bestSeller rating');

            
        if (!wishlist) {
            return res.status(200).json({
                success: true,
                message: 'Wishlist retrieved successfully',
                data: {
                    items: [],
                    totalItems: 0
                }
            });
        }

        // Map items with complete data
        const itemsWithCompleteData = wishlist.items.map(item => {
            if (item.name && item.price) {
                return item;
            }
            
            const product = item.productId;
            return {
                ...item.toObject(),
                name: product.name,
                price: product.price,
                image: product.image?.[0] || '',
                category: product.category,
                sizeQuantity: product.sizeQuantity,
                discount: product.discount || 0,
                bestSeller: product.bestSeller || false,
                rating: product.rating || 1
            };
        });

        res.status(200).json({
            success: true,
            message: 'Wishlist retrieved successfully',
            data: {
                items: itemsWithCompleteData,
                totalItems: wishlist.items.length
            }
        });
    } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch wishlist',
            error: error.message
        });
    }
};

// Add product to wishlist
export const addToWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.body;

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        let wishlist = await Wishlist.findOne({ user: userId });
        if (!wishlist) {
            wishlist = new Wishlist({
                user: userId,
                items: []
            });
        }

        if (wishlist.hasProduct(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Product already in wishlist'
            });
        }

        const wishlistItem = {
            productId: product._id,
            name: product.name,
            price: product.price,
            image: product.image?.[0] || '',
            category: product.category,
            sizeQuantity: product.sizeQuantity,
            discount: product.discount || 0,
            bestSeller: product.bestSeller || false,
            rating: product.rating || 1
        };

        wishlist.items.push(wishlistItem);
        await wishlist.save();

        res.status(201).json({
            success: true,
            message: 'Product added to wishlist successfully',
            data: {
                item: wishlistItem,
                wishlistCount: wishlist.items.length
            }
        });
    } catch (error) {
        console.error('Error adding to wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add product to wishlist',
            error: error.message
        });
    }
};

// Remove product from wishlist
export const removeFromWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;

        const wishlist = await Wishlist.findOne({ user: userId });

        if (!wishlist) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found'
            });
        }

        const initialLength = wishlist.items.length;
        
        // Remove product from wishlist items array
        wishlist.items = wishlist.items.filter(
            item => item.productId.toString() !== productId
        );

        // Check if the product was actually found and removed
        if (wishlist.items.length === initialLength) {
            return res.status(404).json({
                success: false,
                message: 'Product not found in wishlist'
            });
        }

        await wishlist.save();

        res.status(200).json({
            success: true,
            message: 'Product removed from wishlist successfully',
            data: {
                items: wishlist.items,
                totalItems: wishlist.items.length
            }
        });
    } catch (error) {
        console.error('Error removing from wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove product from wishlist',
            error: error.message
        });
    }
};

// Clear entire wishlist
export const clearWishlist = async (req, res) => {
    try {
        const userId = req.user.id;

        const wishlist = await Wishlist.findOne({ user: userId });

        if (!wishlist) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found'
            });
        }

        wishlist.items = [];
        await wishlist.save();

        res.status(200).json({
            success: true,
            message: 'Wishlist cleared successfully',
            data: {
                items: wishlist.items,
                totalItems: wishlist.items.length
            }
        });
    } catch (error) {
        console.error('Error clearing wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear wishlist',
            error: error.message
        });
    }
};

// Check if product is in wishlist
export const checkProductInWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;

        const wishlist = await Wishlist.findOne({ user: userId });

        if (!wishlist) {
            return res.status(200).json({
                success: true,
                inWishlist: false
            });
        }

        const inWishlist = wishlist.items.some(item => item.productId.toString() === productId);

        res.status(200).json({
            success: true,
            inWishlist
        });
    } catch (error) {
        console.error('Error checking wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check wishlist',
            error: error.message
        });
    }
};

// Get wishlist count
export const getWishlistCount = async (req, res) => {
    try {
        const userId = req.user.id;

        const wishlist = await Wishlist.findOne({ user: userId });

        const count = wishlist ? wishlist.items.length : 0;

        res.status(200).json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Error getting wishlist count:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get wishlist count',
            error: error.message
        });
    }
};
