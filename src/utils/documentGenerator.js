import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const generateInvoice = async (order, user) => {
    const doc = new PDFDocument();
    const fileName = `invoice_${order.orderNumber}.pdf`;
    const filePath = path.join('uploads', 'invoices', fileName);

    // Ensure directory exists
    fs.mkdirSync(path.join('uploads', 'invoices'), { recursive: true });

    return new Promise((resolve, reject) => {
        doc.pipe(fs.createWriteStream(filePath));

        // Add company logo and header
        doc.fontSize(20).text('INVOICE', { align: 'center' });
        doc.moveDown();

        // Add order details
        doc.fontSize(12)
            .text(`Order Number: ${order.orderNumber}`)
            .text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`)
            .text(`Customer: ${user.name}`)
            .text(`Email: ${user.email}`)
            .moveDown();

        // Add items table
        doc.moveDown()
            .text('Items:', { underline: true });

        order.items.forEach(item => {
            doc.text(`${item.productName} x ${item.quantity} - ₹${item.price * item.quantity}`);
        });

        // Add totals
        doc.moveDown()
            .text(`Subtotal: ₹${order.subtotal}`)
            .text(`Shipping: ₹${order.shippingCharges}`)
            .text(`Total: ₹${order.totalAmount}`);

        doc.end();
        resolve(filePath);
    });
};

export const generateShippingBill = async (order, shippingAddress) => {
    const doc = new PDFDocument();
    const fileName = `shipping_${order.orderNumber}.pdf`;
    const filePath = path.join('uploads', 'shipping', fileName);

    // Ensure directory exists
    fs.mkdirSync(path.join('uploads', 'shipping'), { recursive: true });

    return new Promise((resolve, reject) => {
        doc.pipe(fs.createWriteStream(filePath));

        // Add header
        doc.fontSize(20).text('SHIPPING BILL', { align: 'center' });
        doc.moveDown();

        // Add shipping details
        doc.fontSize(12)
            .text(`Order Number: ${order.orderNumber}`)
            .text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`)
            .moveDown()
            .text('Shipping Address:', { underline: true })
            .text(shippingAddress.name)
            .text(shippingAddress.street)
            .text(`${shippingAddress.city}, ${shippingAddress.state}`)
            .text(`${shippingAddress.country} - ${shippingAddress.zipCode}`)
            .text(`Phone: ${shippingAddress.phone}`)
            .moveDown();

        // Add package details
        doc.text('Package Details:', { underline: true });
        order.items.forEach(item => {
            doc.text(`${item.productName} x ${item.quantity}`);
        });

        doc.moveDown()
            .text(`Total Items: ${order.items.length}`)
            .text(`Shipping Method: Standard Delivery`)
            .text(`Estimated Delivery: ${new Date(order.estimatedDelivery).toLocaleDateString()}`);

        doc.end();
        resolve(filePath);
    });
};