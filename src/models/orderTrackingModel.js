import mongoose from "mongoose";

const trackingHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
    enum: [
      "order_placed",
      "order_confirmed",
      "processing",
      "packed",
      "shipped",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "returned",
    ],
  },
  location: { type: String, required: true },
  description: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const deliveryAttemptSchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
    enum: ["successful", "failed", "rescheduled"],
  },
  reason: { type: String },
  nextAttemptDate: { type: Date },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const orderProductSnapshotSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  sku: { type: String },
  name: { type: String },
  variant: { type: String },
  qty: { type: Number, default: 1 },
  price: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  weight: { type: Number },
  image: { type: String },
}, { _id: false });

const orderProductsSchema = new mongoose.Schema({
  products: { type: [orderProductSnapshotSchema], default: [] },
  totals: {
    itemsTotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
  }
}, { _id: false });

const orderSnapshotSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  orderNumber: { type: String },
  orderProducts: { type: orderProductsSchema, default: () => ({}) },
  items: { type: Array, default: [] },
  user: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String },
    email: { type: String },
  },
  paymentMethod: { type: String },
  status: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({
  addressId: { type: mongoose.Schema.Types.ObjectId, ref: "Address" },
  fullName: String,
  addressLine1: String,
  addressLine2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  phoneNumber: String,
}, { _id: false });

const orderTrackingSchema = new mongoose.Schema({
  orders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true }],
  orderSnapshots: { type: [orderSnapshotSchema], default: [] },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  trackingNumber: { type: String, required: true, unique: true, minlength: 6, maxlength: 64, trim: true },
  status: {
    type: String,
    enum: [
      "order_placed",
      "order_confirmed",
      "processing",
      "packed",
      "shipped",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "returned",
    ],
    default: "order_placed",
  },
  shippingAddress: { type: mongoose.Schema.Types.ObjectId, ref: "Address" },
  shippingAddressSnapshot: { type: addressSnapshotSchema },
  deliveryInstructions: { type: String, trim: true },
  carrier: {
    name: { type: String, trim: true },
    contactNumber: { type: String, trim: true }
  },
  estimatedDeliveryDate: { type: Date },
  actualDeliveryDate: { type: Date },
  currentLocation: { type: String, trim: true },
  trackingHistory: { type: [trackingHistorySchema], default: [] },
  deliveryAttempts: { type: [deliveryAttemptSchema], default: [] },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// generate tracking number
orderTrackingSchema.statics.generateTrackingNumber = async function (orderId) {
  if (!orderId) throw new Error("Order ID required for tracking number");
  const raw = String(orderId);
  const orderRef = raw.replace(/[^A-Z0-9]/ig, "0").toUpperCase().slice(-6).padStart(6, "0");
  let attempts = 0;
  while (attempts < 6) {
    const timestamp = Date.now().toString().slice(-6);
    const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const candidate = `TRK-${orderRef}-${timestamp}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.findOne({ trackingNumber: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
    // small delay
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error("Failed to generate unique tracking number");
};

orderTrackingSchema.index({ user: 1, shippingAddress: 1 });
orderTrackingSchema.index({ trackingNumber: 1 }, { unique: true });

orderTrackingSchema.pre("save", function (next) {
  if (this.isNew && (!this.trackingHistory || !this.trackingHistory.length)) {
    this.trackingHistory = [{
      status: this.status || "order_placed",
      location: this.currentLocation || "Warehouse",
      description: "Order tracking initiated",
      timestamp: new Date(),
    }];
  }
  next();
});

const OrderTracking = mongoose.model("OrderTracking", orderTrackingSchema);
export default OrderTracking;