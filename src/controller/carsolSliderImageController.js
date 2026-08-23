import streamifier from 'streamifier';
import cloudinary from '../config/cloudinary.js';
import CarsolSliderImage from '../models/carsolSliderImage.js';
import { deleteCloudinaryImages } from '../utils/cloudinaryUtils.js';

// helper to resolve an uploaded file to a Cloudinary URL
// NOTE: with CloudinaryStorage multer has ALREADY uploaded the file,
// so file.path is a Cloudinary URL and must NOT be re-uploaded.
const uploadFileToCloudinary = async (file) => {
    // CloudinaryStorage / disk storage both expose .path
    if (file.path && /^https?:\/\//.test(file.path)) {
        return file.path;
    }

    // local disk path -> upload to Cloudinary
    if (file.path) {
        const result = await cloudinary.uploader.upload(file.path, { folder: 'carousel_sliders' });
        return result.secure_url;
    }

    // raw memory buffer fallback (memoryStorage)
    if (file.buffer) {
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'carousel_sliders' },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result.secure_url);
                }
            );
            streamifier.createReadStream(file.buffer).pipe(stream);
        });
    }

    throw new Error('Unsupported file format for upload');
};

const MAX_SLIDER_IMAGES = 5;

// Create new carousel slider
export const createSlider = async (req, res) => {
    try {
        const { name, link } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        // collect images: uploaded files or images field (array of urls)
        const images = [];

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const url = await uploadFileToCloudinary(file);
                images.push(url);
            }
        }

        if (req.body.images) {
            let bodyImages = req.body.images;
            if (typeof bodyImages === 'string') {
                try { bodyImages = JSON.parse(bodyImages); } catch (e) { /* leave as string */ }
            }
            if (Array.isArray(bodyImages)) {
                for (const url of bodyImages) {
                    if (typeof url === 'string' && url.trim()) images.push(url.trim());
                }
            }
        }

        if (!images.length) {
            return res.status(400).json({ success: false, message: 'At least one image is required' });
        }

        const newSlider = await CarsolSliderImage.create({
            name,
            subtitle: req.body.subtitle || '',
            description: req.body.description || '',
            link: link || '',
            images: images.slice(0, MAX_SLIDER_IMAGES)
        });

        res.status(201).json({ success: true, slider: newSlider });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all sliders
export const getAllSliders = async (req, res) => {
    try {
        const sliders = await CarsolSliderImage.find();

        res.status(200).json({
            success: true,
            count: sliders.length,
            sliders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get single slider by ID
export const getSliderById = async (req, res) => {
    try {
        const slider = await CarsolSliderImage.findById(req.params.id);

        if (!slider) {
            return res.status(404).json({
                success: false,
                message: "Slider not found"
            });
        }

        res.status(200).json({
            success: true,
            slider
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update slider
export const updateSlider = async (req, res) => {
    try {
        const slider = await CarsolSliderImage.findById(req.params.id);
        if (!slider) {
            return res.status(404).json({ success: false, message: "Slider not found" });
        }

        // If new files uploaded -> delete old cloud images (if any) and upload new ones
        let newImages = [];

        if (req.files && req.files.length > 0) {
            // attempt to delete old images from cloudinary (utility should handle URLs)
            try { await deleteCloudinaryImages(slider.images); } catch (_) { /* ignore deletion errors */ }

            for (const file of req.files) {
                const url = await uploadFileToCloudinary(file);
                newImages.push(url);
            }
        } else if (req.body.images) {
            // client provided images array
            let bodyImages = req.body.images;
            if (typeof bodyImages === 'string') {
                try { bodyImages = JSON.parse(bodyImages); } catch (e) { /* ignore parse error */ }
            }
            if (Array.isArray(bodyImages)) {
                for (const url of bodyImages) {
                    if (typeof url === 'string' && url.trim()) newImages.push(url.trim());
                }
            }
        }

        if (req.body.name) slider.name = req.body.name;
        if (req.body.subtitle !== undefined) slider.subtitle = req.body.subtitle;
        if (req.body.description !== undefined) slider.description = req.body.description;
        if (req.body.link !== undefined) slider.link = req.body.link;
        if (newImages.length) slider.images = newImages.slice(0, MAX_SLIDER_IMAGES);

        await slider.save();

        res.status(200).json({ success: true, slider });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete slider
export const deleteSlider = async (req, res) => {
    try {
        const slider = await CarsolSliderImage.findById(req.params.id);

        if (!slider) {
            return res.status(404).json({ success: false, message: "Slider not found" });
        }

        // delete images from Cloudinary if utility available
        try { await deleteCloudinaryImages(slider.images); } catch (_) { /* ignore */ }

        await CarsolSliderImage.findByIdAndDelete(req.params.id);

        res.status(200).json({ success: true, message: "Slider deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};