
import {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    getCartSummary,
    checkProductInCart,
    cartMovetoOrders // Add this import
} from '../controller/cartController.js';
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';

const cartRouter = express.Router();

// All cart routes require authentication
cartRouter.use(protect);

// Get user's cart
cartRouter.get('/', getCart);

// Get cart summary (count and total)
cartRouter.get('/summary', getCartSummary);

// Check if specific product is in cart (with optional size/color query params)
cartRouter.get('/check/:productId', checkProductInCart);

// Add item to cart
cartRouter.post('/add', addToCart);

// Update item quantity in cart (using itemId for unique identification)
cartRouter.put('/update/:itemId', updateCartItem);

// Remove item from cart (using itemId for unique identification)
cartRouter.delete('/remove/:itemId', removeFromCart);

// Clear entire cart
cartRouter.delete('/clear', clearCart);

// Move cart items to orders
cartRouter.post('/move-to-orders', cartMovetoOrders);

export default cartRouter;
