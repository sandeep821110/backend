import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const riderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    phoneNumber: {
        type: String,
        default: ''
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    vehicleNumber: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Hash password whenever it changes
riderSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

riderSchema.methods.comparePassword = function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

const Rider = mongoose.model('Rider', riderSchema);

export default Rider;
