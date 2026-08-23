import e from "express";
import { createMessage, deleteMessage, getAllMessage, getMessageById } from "../controller/contactCntroller.js";
import { protect, adminOnly } from "../middleware/authMiddleware.js";

const contactRoute = e.Router();

contactRoute.post('/',createMessage);
contactRoute.get('/:id', protect, adminOnly, getMessageById)

contactRoute.get('/', protect, adminOnly, getAllMessage)

contactRoute.delete('/del', protect, adminOnly, deleteMessage);

export default contactRoute;