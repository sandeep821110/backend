import mongoose from 'mongoose';

const wishlistItemSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    sizeQuantity: [{
        size: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 0
        }
    }],
    discount: {
        type: Number,
        default: 0
    },
    bestSeller: {
        type: Boolean,
        default: false
    },
    rating: {
        type: Number,
        default: 1,
        min: 1,
        max: 5
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
}, { 
    _id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
}); 

// Add virtual for total stock
wishlistItemSchema.virtual('totalStock').get(function() {
    return this.sizeQuantity.reduce((total, item) => total + item.quantity, 0);
});

// Add virtual for available sizes
wishlistItemSchema.virtual('availableSizes').get(function() {
    return this.sizeQuantity
        .filter(item => item.quantity > 0)
        .map(item => item.size);
});

const wishlistSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [wishlistItemSchema]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Add virtual for total items
wishlistSchema.virtual('totalItems').get(function() {
    return this.items.length;
});

// Add methods
wishlistSchema.methods.hasProduct = function(productId) {
    return this.items.some(item => item.productId.toString() === productId);
};

wishlistSchema.methods.addProduct = function(product) {
    if (!this.hasProduct(product._id)) {
        this.items.push({
            productId: product._id,
            name: product.name,
            price: product.price,
            image: product.image[0] || '',
            category: product.category,
            sizeQuantity: product.sizeQuantity,
            discount: product.discount,
            bestSeller: product.bestSeller,
            rating: product.rating
        });
    }
    return this;
};

// Create indexes for better performance
wishlistSchema.index({ user: 1, 'items.productId': 1 });
wishlistSchema.index({ updatedAt: -1 });

const Wishlist = mongoose.model('Wishlist', wishlistSchema);

export default Wishlist;
