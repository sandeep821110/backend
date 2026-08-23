import mongoose from "mongoose";

const pincodeSchema = new mongoose.Schema({
   pincode: {
        type: String, // Changed to String to handle leading zeros
        required: true,
        unique: true,
        trim: true,
        minlength: 6,
        maxlength: 6,
        validate: {
            validator: function(v) {
                return /^\d{6}$/.test(v); // Validates 6-digit pincode
            },
            message: 'Pincode must be exactly 6 digits'
        }
    },
   
    
    
},{timestamps:true});

// Serviceability lookups always query by pincode
pincodeSchema.index({ pincode: 1 });

const Pincode = mongoose.model('Pincode', pincodeSchema);

export default Pincode;