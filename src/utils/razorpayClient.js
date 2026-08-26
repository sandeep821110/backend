import Razorpay from 'razorpay';

let _client = null;

function getRazorpayClient() {
    if (_client) return _client;

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        console.error('[razorpay] Missing credentials — RAZORPAY_KEY_ID:', keyId ? 'set' : 'MISSING', 'RAZORPAY_KEY_SECRET:', keySecret ? 'set' : 'MISSING');
        throw new Error(
            'Razorpay credentials are not configured. ' +
            'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment variables.'
        );
    }

    _client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    return _client;
}

// Lazy proxy so module import never throws — first API call validates credentials.
export default {
    get orders()     { return getRazorpayClient().orders; },
    get payments()   { return getRazorpayClient().payments; },
    get refunds()    { return getRazorpayClient().refunds; },
    get subscriptions() { return getRazorpayClient().subscriptions; },
};
