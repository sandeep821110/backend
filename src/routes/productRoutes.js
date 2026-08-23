
import express from 'express';
import {
  createProduct,
  updateProduct,
  getAllProducts,
  getProduct,
  deleteProduct,
  updateProductStock
} from '../controller/productController.js';
import upload from '../config/multer.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { cacheMiddleware, invalidateCache } from '../middleware/cache.js';

const productRouter = express.Router();

// Public routes - cached for high traffic (60s TTL)
productRouter.get('/', cacheMiddleware(60), getAllProducts);
productRouter.get('/:id', cacheMiddleware(60), getProduct);

// Protected admin routes (invalidate cache so changes appear instantly)
const bustProductCache = (req, res, next) => {
  invalidateCache('/api/products');
  next();
};

productRouter.post('/', protect, adminOnly, upload('image', 6), bustProductCache, createProduct);
productRouter.put('/:id', protect, adminOnly, upload('image', 6), bustProductCache, updateProduct);
productRouter.delete('/:id', protect, adminOnly, bustProductCache, deleteProduct);
productRouter.patch('/:productId/stock', protect, adminOnly, bustProductCache, updateProductStock);


export default productRouter;
