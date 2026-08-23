import mongoose from "mongoose";

const carsolSliderImageSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    subtitle: {
        type: String,
        default: ''
    },
    description: {
        type: String,
        default: ''
    },
    link: {
        type: String,
        default: ''
    },
    images: { // changed to plural for clarity
        type: [String],
        required: true,
        validate: [
            {
                validator: function(arr) {
                    return Array.isArray(arr) && arr.length > 0 && arr.every(img => typeof img === 'string' && img.trim() !== '');
                },
                message: 'Images array is required and must have at least one valid image string.'
            },
            {
                validator: function(arr) {
                    return Array.isArray(arr) && arr.length <= 5;
                },
                message: 'A slider can have a maximum of 5 images.'
            }
        ]
    }
});

const CarsolSliderImage = mongoose.model("CarsolSliderImage", carsolSliderImageSchema);


export default CarsolSliderImage;