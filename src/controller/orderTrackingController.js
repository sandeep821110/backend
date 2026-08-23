// controllers/orderTrackingController.js

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import OrderTracking from "../models/orderTrackingModel.js";
import Order from "../models/orderModel.js";
import Address from "../models/addressModel.js";
import debug from "debug";
const log = debug("app:orderTracking");

const STATUS_ENUM = [
  "order_placed",
  "order_confirmed",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
];

const VALID_TRANSITIONS = {
  order_placed: ["order_confirmed", "cancelled"],
  order_confirmed: ["processing", "packed", "shipped", "cancelled"],
  processing: ["packed", "shipped", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  returned: [],
};

// helper: normalize a tracking document and guard against undefined arrays/objects
const normalizeTracking = (trackingDoc) => {
  try {
    const t = trackingDoc && typeof trackingDoc.toObject === "function"
      ? trackingDoc.toObject()
      : (trackingDoc || {});

    // ensure arrays/objects exist
    t.orderSnapshots = Array.isArray(t.orderSnapshots) ? t.orderSnapshots : [];
    t.trackingHistory = Array.isArray(t.trackingHistory) ? t.trackingHistory : [];
    t.deliveryAttempts = Array.isArray(t.deliveryAttempts) ? t.deliveryAttempts : [];

    t.orderSnapshots = t.orderSnapshots.map(snapshot => {
      const s = (snapshot && typeof snapshot === 'object') ? { ...snapshot } : {};
      s.orderProducts = s.orderProducts && typeof s.orderProducts === 'object' ? s.orderProducts : {};
      s.orderProducts.products = Array.isArray(s.orderProducts.products) ? s.orderProducts.products : [];
      s.orderProducts.totals = s.orderProducts.totals && typeof s.orderProducts.totals === 'object' ? s.orderProducts.totals : {};

      // safe reduce: compute itemsTotal from products array
      const productsArr = Array.isArray(s.orderProducts.products) ? s.orderProducts.products : [];
      s.orderProducts.totals.itemsTotal = Number(
        productsArr.reduce((sum, it) => {
          const qty = Number(it?.qty ?? it?.quantity ?? 1) || 0;
          const price = Number(it?.price ?? 0) || 0;
          return sum + price * qty;
        }, 0)
      );

      s.orderProducts.totals.shipping = Number(s.orderProducts.totals.shipping ?? 0) || 0;
      s.orderProducts.totals.tax = Number(s.orderProducts.totals.tax ?? 0) || 0;
      s.orderProducts.totals.discount = Number(s.orderProducts.totals.discount ?? 0) || 0;
      s.orderProducts.totals.grandTotal = Number(
        s.orderProducts.totals.grandTotal ??
        (s.orderProducts.totals.itemsTotal + s.orderProducts.totals.shipping + s.orderProducts.totals.tax - s.orderProducts.totals.discount)
      ) || 0;

      s.items = Array.isArray(s.items) ? s.items : [];
      return s;
    });

    return t;
  } catch (err) {
    log("normalizeTracking error: %O", err);
    // return minimal safe object so listing doesn't break
    return {
      _id: trackingDoc && (trackingDoc._id || trackingDoc.id) || null,
      trackingNumber: trackingDoc?.trackingNumber || null,
      status: trackingDoc?.status || null,
      orderSnapshots: [],
      trackingHistory: Array.isArray(trackingDoc?.trackingHistory) ? trackingDoc.trackingHistory : []
    };
  }
};

// CREATE OrderTracking (Admin)
export const createOrderTracking = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const { orderId, deliveryInstructions, carrier, estimatedDeliveryDate, currentLocation } = req.body || {};
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: "Valid orderId is required" });
  }

  const order = await Order.findById(orderId).populate("shippingAddress").populate("user").lean();
  if (!order) return res.status(404).json({ success: false, message: "Order not found" });

  const already = await OrderTracking.findOne({ orders: order._id });
  if (already) return res.status(409).json({ success: false, message: "Tracking already exists for this order", data: already });

  // create a lightweight snapshot compatible with orderSnapshotSchema
  const orderSnapshot = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    orderProducts: {
      products: (order.items || []).map(i => ({
        productId: i.product,
        sku: i.sku || undefined,
        name: i.productName || i.name || '',
        variant: i.variant || i.size || '',
        qty: i.quantity || i.qty || 1,
        price: i.price || 0,
        tax: i.tax || 0,
        weight: i.weight,
        image: i.productImage || (i.product && i.product.firstImage) || ''
      })),
      totals: {
        itemsTotal: (order.items || []).reduce((sum, it) => {
          const qty = Number(it?.quantity ?? it?.qty ?? 1) || 0;
          const price = Number(it?.price ?? 0) || 0;
          return sum + price * qty;
        }, 0),
        shipping: Number(order.shippingCharges ?? order.shipping ?? 0) || 0,
        tax: Number(order.tax ?? 0) || 0,
        discount: Number(order.discount ?? 0) || 0,
        grandTotal: Number(order.totalAmount ?? order.total ?? 0) || 0
      }
    },
    items: order.items || [],
    user: order.user ? { userId: order.user._id, name: order.user.name, email: order.user.email } : undefined,
    createdAt: order.createdAt || new Date()
  };

  let addressSnapshot;
  if (order.shippingAddress) {
    addressSnapshot = {
      addressId: order.shippingAddress._id,
      fullName: order.shippingAddress.fullName,
      addressLine1: order.shippingAddress.addressLine1,
      addressLine2: order.shippingAddress.addressLine2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      phoneNumber: order.shippingAddress.phoneNumber
    };
  }

  try {
    const trackingNumber = await OrderTracking.generateTrackingNumber(order._id);

    const doc = {
      orders: [order._id],
      orderSnapshots: [orderSnapshot],
      user: order.user?._id || req.user._id,
      shippingAddress: order.shippingAddress?._id,
      shippingAddressSnapshot: addressSnapshot,
      trackingNumber,
      deliveryInstructions,
      carrier: carrier && typeof carrier === 'string' ? { name: carrier } : (carrier || undefined),
      estimatedDeliveryDate: estimatedDeliveryDate ? new Date(estimatedDeliveryDate) : undefined,
      currentLocation,
      status: "order_placed",
      trackingHistory: [{ status: "order_placed", location: currentLocation || "Warehouse", description: "Order tracking created", timestamp: new Date() }],
      isActive: true
    };

    const tracking = await OrderTracking.create(doc);
    const populated = await tracking.populate([{ path: "orders", select: "orderNumber totalAmount items user" }, { path: "shippingAddress" }]);
    return res.status(201).json({ success: true, data: normalizeTracking(populated) });
  } catch (err) {
    log("createOrderTracking error %O", err);
    if (err.code === 11000) return res.status(409).json({ success: false, message: "Duplicate tracking generated, try again" });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET Tracking by trackingNumber (Public)
export const getTrackingByNumber = asyncHandler(async (req, res) => {
  const { trackingNumber } = req.params;
  if (!trackingNumber) return res.status(400).json({ success: false, message: "trackingNumber required" });

  const tracking = await OrderTracking.findOne({ trackingNumber }).populate([
    { path: "orders", select: "orderNumber totalAmount items user" },
    { path: "shippingAddress" }
  ]);

  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found" });

  res.json({ success: true, data: normalizeTracking(tracking) });
});

// UPDATE Tracking Status (Admin)
export const updateTrackingStatus = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const { trackingNumber } = req.params;
  const { status, location, description } = req.body || {};

  if (!trackingNumber) return res.status(400).json({ success: false, message: "trackingNumber required" });
  if (!status || !STATUS_ENUM.includes(status)) return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${STATUS_ENUM.join(", ")}` });

  const tracking = await OrderTracking.findOne({ trackingNumber });
  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found" });

  const currentStatus = tracking.status || (Array.isArray(tracking.trackingHistory) && tracking.trackingHistory.length ? tracking.trackingHistory[tracking.trackingHistory.length - 1].status : "order_placed");
  const allowed = VALID_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: `Invalid status transition from ${currentStatus} to ${status}`, allowedTransitions: allowed });
  }

  tracking.status = status;
  if (location) tracking.currentLocation = location;

  tracking.trackingHistory.push({
    status,
    location: location || tracking.currentLocation || "Unknown",
    description: description || "",
    timestamp: new Date()
  });

  if (status === "delivered") tracking.actualDeliveryDate = new Date();
  if (["cancelled", "returned"].includes(status)) tracking.isActive = false;

  await tracking.save();

  const populated = await tracking.populate([{ path: "orders", select: "orderNumber totalAmount user" }, { path: "shippingAddress" }]);
  res.json({ success: true, data: normalizeTracking(populated), nextAllowedTransitions: VALID_TRANSITIONS[status] || [] });
});

// Get user trackings (authenticated)
export const getUserTrackings = asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  const userOrders = await Order.find({ user: req.user._id }).select("_id");
  const orderIds = userOrders.map((o) => o._id);
  if (!orderIds.length) return res.json({ success: true, data: [], pagination: { page, limit, total: 0 } });

  const query = { orders: { $in: orderIds } };
  if (req.query.status) query.status = req.query.status;

  const [items, total] = await Promise.all([
    OrderTracking.find(query)
      .populate([{ path: "orders", select: "orderNumber totalAmount" }, { path: "shippingAddress" }])
      .sort("-createdAt")
      .skip(skip)
      .limit(limit),
    OrderTracking.countDocuments(query),
  ]);

  res.json({ success: true, data: (items || []).map(normalizeTracking), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// Admin: list all trackings
export const adminGetAllTrackings = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.orderId && mongoose.Types.ObjectId.isValid(req.query.orderId)) filter.orders = req.query.orderId;

  const [items, total] = await Promise.all([
    // use lean() to return plain objects (safer and faster)
    OrderTracking.find(filter)
      .populate([{ path: "orders", select: "orderNumber totalAmount user" }, { path: "shippingAddress" }])
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .lean(),
    OrderTracking.countDocuments(filter),
  ]);

  // defensively normalize each item and avoid whole-request failure
  const safeItems = (items || []).map(it => {
    try { return normalizeTracking(it); }
    catch (e) {
      log("adminGetAllTrackings normalize error for id %s: %O", it?._id || it?.id, e);
      return { _id: it?._id || it?.id || null, trackingNumber: it?.trackingNumber || null };
    }
  });

  res.json({ success: true, data: safeItems, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// Admin: delete tracking
export const deleteTracking = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const { trackingNumber } = req.params;
  const tracking = await OrderTracking.findOneAndDelete({ trackingNumber });
  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found" });

  res.json({ success: true, message: "Tracking deleted" });
});

// Admin: add delivery attempt
export const addDeliveryAttempt = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const { trackingNumber } = req.params;
  const { status, reason, nextAttemptDate } = req.body || {};

  if (!trackingNumber) return res.status(400).json({ success: false, message: "trackingNumber required" });

  const validStatuses = ["successful", "failed", "rescheduled"];
  if (!status || !validStatuses.includes(status)) return res.status(400).json({ success: false, message: `Invalid attempt status. Allowed: ${validStatuses.join(", ")}` });

  const tracking = await OrderTracking.findOne({ trackingNumber });
  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found" });

  tracking.deliveryAttempts.push({ status, reason, nextAttemptDate: nextAttemptDate ? new Date(nextAttemptDate) : undefined, timestamp: new Date() });
  await tracking.save();

  const populated = await tracking.populate([{ path: "orders", select: "orderNumber totalAmount user" }, { path: "shippingAddress" }]);
  res.json({ success: true, data: normalizeTracking(populated) });
});

// Admin: update tracking details
export const updateTrackingDetails = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });

  const { trackingNumber } = req.params;
  const { carrier, estimatedDeliveryDate, deliveryInstructions } = req.body || {};

  if (!trackingNumber) return res.status(400).json({ success: false, message: "trackingNumber required" });

  const tracking = await OrderTracking.findOne({ trackingNumber });
  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found" });

  if (carrier) {
    if (carrier.name) tracking.carrier.name = carrier.name;
    if (carrier.contactNumber) tracking.carrier.contactNumber = carrier.contactNumber;
  }

  if (estimatedDeliveryDate) tracking.estimatedDeliveryDate = new Date(estimatedDeliveryDate);
  if (deliveryInstructions !== undefined) tracking.deliveryInstructions = deliveryInstructions;

  await tracking.save();
  const populated = await tracking.populate([{ path: "orders", select: "orderNumber totalAmount user" }, { path: "shippingAddress" }]);
  res.json({ success: true, data: normalizeTracking(populated) });
});

// User: get tracking by order id
export const getUserTrackingByOrderId = asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });

  const { orderId } = req.params;
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, message: "Valid orderId required" });

  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: "Order not found or not owned by user" });

  const tracking = await OrderTracking.findOne({ orders: orderId }).populate([{ path: "orders", select: "orderNumber totalAmount items" }, { path: "shippingAddress" }]);
  if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found for this order" });

  res.json({ success: true, data: normalizeTracking(tracking) });
});

// find by orderNumber
export const getTrackingByOrderNumber = asyncHandler(async (req, res) => {
  const { orderNumber } = req.params;
  if (!orderNumber) return res.status(400).json({ success: false, message: 'orderNumber required' });

  const order = await Order.findOne({ orderNumber }).select('_id user');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const tracking = await OrderTracking.findOne({ orders: order._id }).populate([{ path: 'orders', select: 'orderNumber totalAmount items user' }, { path: 'shippingAddress' }]);
  if (!tracking) return res.status(404).json({ success: false, message: 'Tracking not found for this orderNumber' });

  res.json({ success: true, data: normalizeTracking(tracking) });
});

// internal notifyOrderStatusChange
export const notifyOrderStatusChange = async (orderId, status, location = undefined, description = undefined) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Invalid orderId');
  if (!status || !STATUS_ENUM.includes(status)) throw new Error(`Invalid status: ${status}`);

  const tracking = await OrderTracking.findOne({ orders: orderId });
  if (!tracking) return null;

  const currentStatus = tracking.status || (Array.isArray(tracking.trackingHistory) && tracking.trackingHistory.length ? tracking.trackingHistory[tracking.trackingHistory.length - 1].status : 'order_placed');
  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(status)) throw new Error(`Invalid transition from ${currentStatus} to ${status}`);

  tracking.status = status;
  if (location) tracking.currentLocation = location;

  tracking.trackingHistory.push({ status, location: location || tracking.currentLocation || 'Unknown', description: description || '', timestamp: new Date() });
  if (status === 'delivered') tracking.actualDeliveryDate = new Date();
  if (['cancelled', 'returned'].includes(status)) tracking.isActive = false;

  await tracking.save();
  return tracking;
};
