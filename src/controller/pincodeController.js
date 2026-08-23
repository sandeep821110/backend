import Pincode from "../models/pincodeModel.js";
const addPincode = async (req, res) => {
    const { pincode } = req.body;

    try {
        
        // Validate pincode format
        if (!pincode.match(/^[0-9]{6}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pincode format'
            });
        }

        // Check if pincode already exists
        const existingPincode = await Pincode.findOne({ pincode });
        if (existingPincode) {
            return res.status(400).json({
                success: false,
                message: 'Pincode already exists'
            });
        }

        // Create new pincode
        const newPincode = new Pincode({ pincode });
        await newPincode.save();

        return res.status(201).json({
            success: true,
            message: 'Pincode added successfully',
            pincode: newPincode
        });

    } catch (error) {
        
    }
}

const deletePincode = async (req, res) => {
    const { id } = req.params;
    try {

        // Validate ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pincode ID format'
            });
        }

        // Delete pincode
        await Pincode.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Pincode deleted successfully'
        });
        
    } catch (error) {
        
    }

}

const getPincode = async (req, res) => {
    const { pincode } = req.params;
    try {
        // Validate pincode format
        if (!pincode.match(/^[0-9]{6}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pincode format'
            });
        }

        // Find pincode
        const pincodeDocument = await Pincode.findOne({ pincode });
        if (!pincodeDocument) {
            return res.status(404).json({
                success: false,
                message: 'Pincode not found'
            });
        }

        return res.status(200).json({
            success: true,
            pincode: pincodeDocument
        });
        
    } catch (error) {
        
    }
}

const getAllPincode = async (req, res) => {
    try {

        // Find all pincodes
        const pincodes = await Pincode.find({});

        return res.status(200).json({
            success: true,
            data: pincodes,
            count: pincodes.length,
            message: 'Found all pincodes'
        });
        
    } catch (error) {
        
    }
}

export {
    addPincode,
    deletePincode,
    getPincode,
    getAllPincode
}