import contactModel from "../models/contactModel.js";

const createMessage = async (req, res) => {
    const { name, email, phoneNumber, subject, message } = req.body;
    
    try {
        // Validation
        if (!name || !email || !phoneNumber || !subject || !message) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Create new message
        const newMessage = new contactModel({
            name,
            email,
            phoneNumber,
            subject,
            message
        });

        await newMessage.save();

        res.status(201).json({ message: "Message sent successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to send message" });
    }
};

const getAllMessage = async (req, res) => {
    try {
        const messages = await contactModel.find({});
        res.status(200).json(messages);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch messages" });
    }
};

const getMessageById = async (req, res) => {
    try {
        const message = await contactModel.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }
        res.status(200).json(message);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch message" });
    }
};

const deleteMessage = async (req, res) => {
    try {
        const message = await contactModel.findByIdAndDelete(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }
        res.status(200).json({ message: "Message deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to delete message" });
    }
};

export { createMessage, getAllMessage, getMessageById, deleteMessage };
