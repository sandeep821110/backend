import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import streamifier from 'streamifier';
import cloudinary from '../config/cloudinary.js';
import Order from '../models/orderModel.js';
import Rider from '../models/riderModel.js';
import { sendEmail } from '../middleware/emailService.js';
import { notifyOrderStatusChange } from './orderTrackingController.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const generateToken = (rider) =>
    jwt.sign(
        { id: rider._id.toString(), email: rider.email, isRider: true },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const riderLogin = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const rider = await Rider.findOne({ email: String(email).toLowerCase().trim() });
        if (!rider || !rider.isActive) {
            return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
        }

        const match = await rider.comparePassword(password);
        if (!match) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        res.json({
            success: true,
            message: 'Login successful',
            token: generateToken(rider),
            rider: { id: rider._id, name: rider.name, email: rider.email, phoneNumber: rider.phoneNumber }
        });
    } catch (error) {
        console.error('[riderLogin]', error.message);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
};

// ---------------------------------------------------------------------------
// Rider order actions
// ---------------------------------------------------------------------------

const buildOrderView = (order) => {
    const o = order.toObject ? order.toObject() : order;
    const isCod = o.paymentMethod === 'COD';
    return {
        _id: o._id,
        orderNumber: o.orderNumber,
        orderStatus: o.orderStatus,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        totalAmount: o.totalAmount,
        amountToCollect: isCod && o.paymentStatus !== 'COMPLETED' ? o.totalAmount : 0,
        estimatedDelivery: o.estimatedDelivery,
        outForDeliveryAt: o.outForDeliveryAt,
        actualDelivery: o.actualDelivery,
        deliverySignature: o.deliverySignature,
        deliveryProof: o.deliveryProof,
        deliveryFailedReason: o.deliveryFailedReason,
        notes: o.notes,
        createdAt: o.createdAt,
        otpSent: Boolean(o.deliveryOtpHash && o.deliveryOtpExpiresAt && new Date(o.deliveryOtpExpiresAt) > new Date()),
        items: (o.items || []).map((i) => ({
            productName: i.productName,
            productImage: i.productImage,
            quantity: i.quantity,
            size: i.size
        })),
        customer: {
            name: o.shippingAddress?.fullName || '',
            phone: o.shippingAddress?.phoneNumber || '',
            email: o.shippingAddress?.email || o.user?.email || '',
            addressLine1: o.shippingAddress?.addressLine1 || '',
            addressLine2: o.shippingAddress?.addressLine2 || '',
            city: o.shippingAddress?.city || '',
            state: o.shippingAddress?.state || '',
            pincode: o.shippingAddress?.pincode || ''
        }
    };
};

export const getAssignedOrders = async (req, res) => {
    try {
        const filter = { rider: req.rider._id };
        if (req.query.status) filter.orderStatus = req.query.status;

        const orders = await Order.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .populate('shippingAddress', 'fullName phoneNumber email addressLine1 addressLine2 city state pincode')
            .populate('user', 'email')
            .select('-deliveryOtpHash -deliveryOtpExpiresAt -__v');

        res.json({ success: true, count: orders.length, orders: orders.map(buildOrderView) });
    } catch (error) {
        console.error('[getAssignedOrders]', error.message);
        res.status(500).json({ success: false, message: 'Could not load assigned orders' });
    }
};

const sendDeliveryOtpEmail = async (to, orderNumber, otp, riderName) => {
    const subject = `Your FLY STORE delivery OTP - Order ${orderNumber}`;
    const text = `Your delivery OTP for order ${orderNumber} is ${otp}. Share it with the delivery partner only after receiving your order.`;
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
      <div style="background:#111;color:#fff;padding:18px 24px">
        <h2 style="margin:0;font-size:18px">FLY STORE</h2>
      </div>
      <div style="padding:24px">
        <p>Hi,</p>
        <p>Your order <strong>${orderNumber}</strong> is out for delivery${riderName ? ` with ${riderName}` : ''}.</p>
        <p style="margin:24px 0;text-align:center">
          <span style="display:inline-block;background:#f4f4f5;border-radius:10px;padding:14px 28px;font-size:28px;letter-spacing:8px;font-weight:bold">${otp}</span>
        </p>
        <p>Share this OTP with the delivery partner <strong>only after you receive your order</strong>. The OTP is valid until end of day.</p>
        <p style="color:#888;font-size:13px">If you did not place this order, please contact support immediately.</p>
      </div>
    </div>`;
    return sendEmail(to, subject, text, html);
};

export const startDelivery = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id)
            .populate('shippingAddress', 'fullName phoneNumber email')
            .populate('user', 'email');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (String(order.rider) !== String(req.rider._id)) {
            return res.status(403).json({ success: false, message: 'This order is not assigned to you' });
        }
        if (!['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(order.orderStatus)) {
            return res.status(400).json({ success: false, message: `Cannot start delivery from status ${order.orderStatus}` });
        }

        // Generate a fresh 6-digit OTP valid until end of day
        const otp = crypto.randomInt(100000, 999999).toString();
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        order.orderStatus = 'OUT_FOR_DELIVERY';
        order.outForDeliveryAt = new Date();
        order.deliveryOtpHash = sha256(otp);
        order.deliveryOtpExpiresAt = endOfDay;
        order.deliveryFailedReason = '';
        await order.save();

        // Email the OTP to the customer (never blocks the response on failure)
        const to = order.shippingAddress?.email || order.user?.email || '';
        let otpEmailed = false;
        if (to) {
            otpEmailed = await sendDeliveryOtpEmail(to, order.orderNumber, otp, req.rider.name);
        }

        try {
            await notifyOrderStatusChange(order._id, 'out_for_delivery', 'On the way', `Out for delivery with ${req.rider.name}`);
        } catch { /* tracking sync is best-effort */ }

        res.json({
            success: true,
            message: 'Order marked out for delivery',
            otpSentTo: otpEmailed ? to : null,
            warning: otpEmailed ? undefined : 'OTP could not be emailed - use signature proof instead'
        });
    } catch (error) {
        console.error('[startDelivery]', error.message);
        res.status(500).json({ success: false, message: 'Could not start delivery' });
    }
};

const uploadSignature = (dataUrl) =>
    new Promise((resolve, reject) => {
        const matches = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl || '');
        if (!matches) return reject(new Error('Invalid signature image format'));
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.length > 3 * 1024 * 1024) return reject(new Error('Signature image too large'));
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'delivery_signatures', resource_type: 'image' },
            (error, result) => (error ? reject(error) : resolve(result.secure_url))
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });

export const completeDelivery = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp, signature } = req.body || {};

        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (String(order.rider) !== String(req.rider._id)) {
            return res.status(403).json({ success: false, message: 'This order is not assigned to you' });
        }
        if (order.orderStatus === 'DELIVERED') {
            return res.status(400).json({ success: false, message: 'Order already delivered' });
        }
        if (order.orderStatus !== 'OUT_FOR_DELIVERY') {
            return res.status(400).json({ success: false, message: 'Start the delivery first (mark it out for delivery)' });
        }

        // Verify OTP when one is pending
        const otpPending = Boolean(order.deliveryOtpHash && order.deliveryOtpExpiresAt && new Date(order.deliveryOtpExpiresAt) > new Date());
        let otpValid = false;
        if (otpPending && otp) {
            otpValid = sha256(otp) === order.deliveryOtpHash;
            if (!otpValid) {
                return res.status(400).json({ success: false, message: 'Incorrect OTP. Ask the customer to check the email.' });
            }
        }

        // Optional signature proof (required only when no valid OTP was given)
        let signatureUrl = '';
        if (signature) {
            try {
                signatureUrl = await uploadSignature(signature);
            } catch (uploadError) {
                return res.status(400).json({ success: false, message: uploadError.message || 'Signature upload failed' });
            }
        }

        if (!otpValid && !signatureUrl) {
            return res.status(400).json({
                success: false,
                message: otpPending
                    ? 'Enter the customer OTP or capture a signature to confirm delivery'
                    : 'Capture the customer signature to confirm delivery'
            });
        }

        order.orderStatus = 'DELIVERED';
        order.actualDelivery = new Date();
        if (order.paymentMethod === 'COD') order.paymentStatus = 'COMPLETED'; // cash collected at door
        if (signatureUrl) order.deliverySignature = signatureUrl;
        order.deliveryProof = [otpValid && 'OTP', signatureUrl && 'SIGNATURE'].filter(Boolean).join('+') || 'SIGNATURE';
        order.deliveryOtpHash = '';
        order.deliveryOtpExpiresAt = null;
        await order.save();

        try {
            await notifyOrderStatusChange(order._id, 'delivered', 'Delivered', 'Order delivered successfully');
        } catch { /* best-effort */ }

        res.json({
            success: true,
            message: order.paymentMethod === 'COD'
                ? `Delivery confirmed. Collect Rs.${order.totalAmount} from the customer.`
                : 'Delivery confirmed.',
            order: buildOrderView(order)
        });
    } catch (error) {
        console.error('[completeDelivery]', error.message);
        res.status(500).json({ success: false, message: 'Could not complete delivery' });
    }
};

export const reportFailedDelivery = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, message: 'A failure reason is required' });
        }

        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (String(order.rider) !== String(req.rider._id)) {
            return res.status(403).json({ success: false, message: 'This order is not assigned to you' });
        }
        if (['DELIVERED', 'CANCELLED'].includes(order.orderStatus)) {
            return res.status(400).json({ success: false, message: `Cannot report a failure on a ${order.orderStatus.toLowerCase()} order` });
        }

        const stamped = `[${new Date().toLocaleString('en-IN')}] Delivery attempt failed: ${String(reason).trim()}`;
        order.deliveryFailedReason = String(reason).trim();
        order.notes = order.notes ? `${order.notes}\n${stamped}` : stamped;
        await order.save();

        res.json({ success: true, message: 'Failed delivery recorded' });
    } catch (error) {
        console.error('[reportFailedDelivery]', error.message);
        res.status(500).json({ success: false, message: 'Could not record failed delivery' });
    }
};

// ---------------------------------------------------------------------------
// Admin management (standard admin auth)
// ---------------------------------------------------------------------------

export const listRiders = async (req, res) => {
    try {
        const riders = await Rider.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, riders });
    } catch (error) {
        console.error('[listRiders]', error.message);
        res.status(500).json({ success: false, message: 'Could not load riders' });
    }
};

export const createRider = async (req, res) => {
    try {
        const { name, email, password, phoneNumber, vehicleNumber } = req.body || {};
        if (!name || !email || !password || String(password).length < 6) {
            return res.status(400).json({ success: false, message: 'Name, email and a 6+ char password are required' });
        }
        const exists = await Rider.findOne({ email: String(email).toLowerCase().trim() });
        if (exists) return res.status(409).json({ success: false, message: 'A rider with this email already exists' });

        const rider = await Rider.create({ name, email, password, phoneNumber, vehicleNumber });
        res.status(201).json({ success: true, message: 'Rider created', rider: { id: rider._id, name, email } });
    } catch (error) {
        console.error('[createRider]', error.message);
        res.status(500).json({ success: false, message: 'Could not create rider' });
    }
};

export const assignRider = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { riderId } = req.body || {};
        if (!riderId) return res.status(400).json({ success: false, message: 'riderId is required' });

        const [order, rider] = await Promise.all([Order.findById(orderId), Rider.findById(riderId)]);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        order.rider = rider._id;
        order.riderAssignedAt = new Date();
        await order.save();

        res.json({ success: true, message: `Order ${order.orderNumber} assigned to ${rider.name}` });
    } catch (error) {
        console.error('[assignRider]', error.message);
        res.status(500).json({ success: false, message: 'Could not assign rider' });
    }
};
