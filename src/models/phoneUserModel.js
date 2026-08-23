
import mongoose from "mongoose";

const phoneUserSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
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
    name: {
        type: String,
        trim: true
    },
    profilePicture: {
        type: String
    }
}, { timestamps: true });

const PhoneUser = mongoose.model('PhoneUser', phoneUserSchema);
export default PhoneUser;
