
import mongoose from "mongoose";
import colors from 'color-name';

// Simple 2-line color converter
const convertToHex = (color) => {
    const rgb = colors[color.toLowerCase()]; return rgb ? `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toUpperCase()}` : (color.startsWith('#') ? color.toUpperCase() : null);
};

const productSchema = new mongoose.Schema({
    productCode :{
        type: String,
        requried :true,
        trim: true

    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        trim: true
    },
    subCategory: {
        type: String,
        required: true,
        trim: true
    },
    // stock: {
    //     type: Number,
    //     required: true,
    //     min: 0
    // },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        default: 1
    },
    image: {
        type: [String],
        required: true
    },
    sizeQuantity: [{
        size: {
            type: String,
            required: true,
            trim: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 0
        }
    }],
    // colors: {
    //     type: [String],
        
    //     required: true
    // },

    brand: {
        type: String,
        required: true,
        trim: true
    },
    reviews: {
        type: [Object],
        required: false,
        default: []
    },
    bestSeller: {
        type: Boolean,
        required: true,
        default: false
    },
    discount: {
        type: Number,
        required: false,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Pre-save middleware to convert colors to hex
productSchema.pre('save', function(next) {
    if (this.isModified('colors')) this.colors = this.colors.map(color => convertToHex(color) || color);
    next();
});

// Virtual field for first image
productSchema.virtual('firstImage').get(function() {
    return this.image && this.image.length > 0 ? this.image[0] : '';
});

// Indexes for catalog browsing, filtering and search at scale
productSchema.index({ category: 1, createdAt: -1 });   // main listing path
productSchema.index({ subCategory: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ name: 1 });                      // search $or branch
productSchema.index({ description: 1 });               // search $or branch
productSchema.index({ bestSeller: 1, createdAt: -1 }); // home page best sellers
productSchema.index({ price: 1 });                     // min/max price filter
productSchema.index({ productCode: 1 });

const Product = mongoose.model('Product', productSchema);
export default Product;