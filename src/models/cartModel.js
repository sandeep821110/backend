import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    productImage: {
        type: String,
        default: ''
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true
    },
    size: {
        type: String,
        required: true,
        trim: true
    }
}, { _id: true });

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [cartItemSchema],
    totalAmount: {
        type: Number,
        default: 0
    },
    totalItems: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Pre-save middleware to calculate totals
cartSchema.pre('save', function(next) {
    this.totalAmount = this.items.reduce((total, item) => 
        total + (item.price * item.quantity), 0);
    this.totalItems = this.items.reduce((total, item) => 
        total + item.quantity, 0);
    next();
});

// Virtual for calculating discounted total if needed
cartSchema.virtual('discountedTotal').get(function() {
    return this.items.reduce((total, item) => {
        const product = item.product;
        const discount = product?.discount || 0;
        const discountedPrice = item.price * (1 - discount / 100);
        return total + (discountedPrice * item.quantity);
    }, 0);
});

// Every cart operation starts with findOne({ user })
// user field already declares unique: true (implicit index)

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;

