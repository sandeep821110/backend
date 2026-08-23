import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false, // Make optional for signup, required for profile update
        trim: true,
        match: /^[a-zA-Z ]+$/
    },
    phoneNumber: {
        type: String,
        required: false, // Make optional for signup, required for profile update
        unique: true,
        sparse: true, // Allow multiple null values
        match: /^[0-9]{10}$/,
        trim: true
    },
    profilePicture: {
        type: String,
        required: false // Add this field
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
    },
    otp: {
        type: Number,
        required: function() {
            return this.otpValidity != null;
        }
    },
    otpValidity: {
        type: Date,
        required: function() {
            return this.otp != null;
        }
    },
    isVerified: {
        type: Boolean,
        required: true,
        default: false
    },
    refreshToken: { 
        type: String, 
        default: null 
    } // store hashed refresh token
}, { timestamps: true });

export default mongoose.model("User", userSchema);
