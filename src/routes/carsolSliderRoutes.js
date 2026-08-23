import express from 'express';
import { 
    createSlider, 
    getAllSliders, 
    getSliderById, 
    updateSlider, 
    deleteSlider 
} from '../controller/carsolSliderImageController.js';
import upload from '../config/multer.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { cacheMiddleware, invalidateCache } from '../middleware/cache.js';

const carsolSliderRoutes = express.Router();

// Slider images are wide banners: keep them large, in their own folder
const sliderUpload = upload('images', 5, { folder: 'carousel_sliders', prefix: 'slider', width: 1920, height: 1080 });

// Bust slider cache after admin writes
const bustSliderCache = (req, res, next) => {
    invalidateCache('/api/slider');
    next();
};

// Create new slider (form-data files under key "images", max 5)
carsolSliderRoutes.post('/create', protect, adminOnly, sliderUpload, bustSliderCache, createSlider);

// Get all sliders - cached (5 min TTL, homepage hotspot)
carsolSliderRoutes.get('/all', cacheMiddleware(300), getAllSliders);

// Get single slider by ID
carsolSliderRoutes.get('/:id', protect, adminOnly, getSliderById);


// Update slider (files optional)
carsolSliderRoutes.put('/update/:id', protect, adminOnly, sliderUpload, bustSliderCache, updateSlider);

// Delete slider
carsolSliderRoutes.delete('/delete/:id', protect, adminOnly, bustSliderCache, deleteSlider);

export default carsolSliderRoutes;