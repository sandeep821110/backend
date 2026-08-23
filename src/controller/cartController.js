import Cart from '../models/cartModel.js';
import Product from '../models/productModel.js';
import mongoose from 'mongoose';

// Get user's cart
export const getCart = async (req, res) => {
    try {
        const userId = req.user.id;

        const cart = await Cart.findOne({ user: userId })
            .populate('items.product', 'name price image category sizeQuantity');

        if (!cart) {
            return res.status(200).json({
                success: true,
                data: {
                    user: userId,
                    items: [],
                    totalAmount: 0,
                    totalItems: 0
                }
            });
        }

        res.status(200).json({
            success: true,
            data: cart
        });
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cart',
            error: error.message
        });
    }
};

// Add item to cart
export const addToCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity = 1, size } = req.body;

        // Validate required fields
        if (!productId || !size) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and size are required'
            });
        }

        if (quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be at least 1'
            });
        }

        // Verify product exists and check stock
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Check if size is available and has sufficient stock
        const sizeData = product.sizeQuantity.find(item => item.size === size);
        if (!sizeData) {
            return res.status(400).json({
                success: false,
                message: `Size ${size} not available for this product`
            });
        }

        // Find existing cart
        let cart = await Cart.findOne({ user: userId });
        let totalRequestedQuantity = quantity;

        // If cart exists, check for existing items of same product and size
        if (cart) {
            const existingItem = cart.items.find(
                item => item.product.toString() === productId && 
                        item.size === size.trim()
            );
            
            if (existingItem) {
                totalRequestedQuantity = existingItem.quantity + quantity;
            }
        }

        // Check stock availability
        if (sizeData.quantity < totalRequestedQuantity) {
            return res.status(400).json({
                success: false,
                message: `Insufficient stock for size ${size}. Available: ${sizeData.quantity}, Requested: ${totalRequestedQuantity}`
            });
        }

        const productImage = product.firstImage || '';

        // Proceed with adding to cart
        if (!cart) {
            cart = new Cart({
                user: userId,
                items: [{
                    product: productId,
                    productName: product.name,
                    productImage: productImage,
                    quantity,
                    price: product.price,
                    size: size.trim()
                }]
            });
        } else {
            const existingItemIndex = cart.items.findIndex(
                item => item.product.toString() === productId && 
                        item.size === size.trim()
            );

            if (existingItemIndex > -1) {
                cart.items[existingItemIndex].quantity += quantity;
                cart.items[existingItemIndex].price = product.price;
                cart.items[existingItemIndex].productImage = productImage;
                cart.items[existingItemIndex].productName = product.name;
            } else {
                cart.items.push({
                    product: productId,
                    productName: product.name,
                    productImage: productImage,
                    quantity,
                    price: product.price,
                    size: size.trim()
                });
            }
        }

        await cart.save();
        await cart.populate('items.product', 'name price image category sizeQuantity');

        res.status(201).json({
            success: true,
            message: 'Item added to cart successfully',
            data: cart
        });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add item to cart',
            error: error.message
        });
    }
};

// Update item quantity in cart
export const updateCartItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;
        const { quantity } = req.body;

        if (!quantity || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be at least 1'
            });
        }

        const cart = await Cart.findOne({ user: userId });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const cartItem = cart.items.find(item => item._id.toString() === itemId);
        if (!cartItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        // Check stock availability
        const product = await Product.findById(cartItem.product);
        const sizeData = product.sizeQuantity.find(item => item.size === cartItem.size);
        
        if (!sizeData || sizeData.quantity < quantity) {
            return res.status(400).json({
                success: false,
                message: `Insufficient stock for size ${cartItem.size}. Available: ${sizeData?.quantity || 0}`
            });
        }

        cartItem.quantity = quantity;
        await cart.save();
        await cart.populate('items.product', 'name price image category sizeQuantity');

        res.status(200).json({
            success: true,
            message: 'Cart item updated successfully',
            data: cart
        });
    } catch (error) {
        console.error('Error updating cart item:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cart item',
            error: error.message
        });
    }
};

// Remove item from cart
export const removeFromCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const initialLength = cart.items.length;
        cart.items = cart.items.filter(
            item => item._id.toString() !== itemId
        );

        if (cart.items.length === initialLength) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        await cart.save();

        await cart.populate('items.product', 'name price image category sizeQuantity');

        res.status(200).json({
            success: true,
            message: 'Item removed from cart successfully',
            data: cart
        });
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove item from cart',
            error: error.message
        });
    }
};

// Clear entire cart
export const clearCart = async (req, res) => {
    try {
        const userId = req.user.id;

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        cart.items = [];
        await cart.save();

        res.status(200).json({
            success: true,
            message: 'Cart cleared successfully',
            data: cart
        });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear cart',
            error: error.message
        });
    }
};

// Get cart summary (count and total)
export const getCartSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(200).json({
                success: true,
                data: {
                    totalItems: 0,
                    totalAmount: 0,
                    itemCount: 0
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                totalItems: cart.totalItems,
                totalAmount: cart.totalAmount,
                itemCount: cart.items.length
            }
        });
    } catch (error) {
        console.error('Error fetching cart summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cart summary',
            error: error.message
        });
    }
};

// Check if product with specific size is in cart
export const checkProductInCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;
        const { size } = req.query;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(200).json({
                success: true,
                inCart: false,
                quantity: 0,
                variations: []
            });
        }

        // If size is provided, check for specific variation
        if (size) {
            const cartItem = cart.items.find(
                item => item.product.toString() === productId && 
                        item.size === size
            );

            return res.status(200).json({
                success: true,
                inCart: !!cartItem,
                quantity: cartItem ? cartItem.quantity : 0
            });
        }

        // If no size specified, return all variations of the product in cart
        const productVariations = cart.items.filter(
            item => item.product.toString() === productId
        );

        const variations = productVariations.map(item => ({
            itemId: item._id,
            size: item.size,
            quantity: item.quantity,
            price: item.price
        }));

        res.status(200).json({
            success: true,
            inCart: variations.length > 0,
            totalQuantity: variations.reduce((total, item) => total + item.quantity, 0),
            variations
        });
    } catch (error) {
        console.error('Error checking cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check cart',
            error: error.message
        });
    }
};

// Move cart items to orders
export const cartMovetoOrders = async (req, res) => {
    // ... (your existing implementation)
};
