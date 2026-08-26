
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
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import Cart from '../models/cartModel.js';
import User from '../models/userModel.js';

const cartRouter = express.Router();

// All cart routes require authentication
cartRouter.use(protect);

// Admin: list all carts
cartRouter.get('/admin/all', adminOnly, async (req, res) => {
    try {
        const carts = await Cart.find({}).populate('user', 'name email phoneNumber').populate('items.product', 'name images price').sort({ updatedAt: -1 });
        res.json({ success: true, carts, count: carts.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: get cart by user ID
cartRouter.get('/admin/user/:userId', adminOnly, async (req, res) => {
    try {
        const cart = await Cart.findOne({ user: req.params.userId }).populate('user', 'name email phoneNumber').populate('items.product', 'name images price sizeQuantity');
        if (!cart) return res.status(404).json({ success: false, message: 'Cart not found for this user' });
        res.json({ success: true, cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

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
