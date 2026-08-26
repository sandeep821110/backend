import mongoose from "mongoose";
import crypto from "crypto";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false,
        trim: true
    },
    phoneNumber: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        trim: true
    },
    profilePicture: {
        type: String,
        required: false
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    otp: {
        type: Number,
        required: false
    },
    otpValidity: {
        type: Date,
        required: false
    },
    isVerified: {
        type: Boolean,
        required: true,
        default: false
    },
    refreshToken: {
        type: String,
        default: null
    },
    refreshTokenExpiry: {
        type: Date,
        default: null
    }
}, { timestamps: true });

userSchema.methods.generateRefreshToken = function () {
    const token = crypto.randomBytes(40).toString("hex");
    this.refreshToken = token;
    this.refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    return token;
};

userSchema.methods.clearRefreshToken = function () {
    this.refreshToken = null;
    this.refreshTokenExpiry = null;
};

userSchema.methods.isRefreshTokenValid = function () {
    return this.refreshToken && this.refreshTokenExpiry && this.refreshTokenExpiry > new Date();
};

export default mongoose.model("User", userSchema);
