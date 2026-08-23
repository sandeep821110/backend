
import express from 'express';
import {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    clearWishlist,
    checkProductInWishlist,
    getWishlistCount
} from '../controller/wishlistController.js';
import { protect } from '../middleware/authMiddleware.js';

const wishlistRouter = express.Router();

// All wishlist routes require authentication
wishlistRouter.use(protect);

// Get user's wishlist
wishlistRouter.get('/', getWishlist);

// Get wishlist count
wishlistRouter.get('/count', getWishlistCount);

// Check if specific product is in wishlist
wishlistRouter.get('/check/:productId', checkProductInWishlist);

// Add product to wishlist
wishlistRouter.post('/add', addToWishlist);

// Remove product from wishlist
wishlistRouter.delete('/remove/:productId', removeFromWishlist);

// Clear entire wishlist
wishlistRouter.delete('/clear', clearWishlist);

export default wishlistRouter;
