const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const SELLER_ID = "4851724";
const API_KEY = "DUOOa49Jeyu8Zx7AKei6";

// Cashfree Test Environment Credentials (सैंडबॉक्स / टेस्ट मोड की डिटेल्स यहाँ डालें)
const CASHFREE_APP_ID = "TEST112085181a9848f239327d519a0481580211"; // आपकी टेस्ट App ID
const CASHFREE_SECRET_KEY = "cfsk_ma_test_15ea0d321db59035bc010a90d1621a9f_1bfcaa53"; // आपकी टेस्ट Secret Key
// Cashfree Sandbox API URL for creating orders
const CASHFREE_API_URL = "https://sandbox.cashfree.com/pg/orders";

const activeOrders = new Map();

// 1. User Verification Endpoint
app.post('/api/verify-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ status: 400, message: "UID is missing!" });
        }
        const cleanUid = uid.toString().trim();
        
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

        const payload = {
            sellerId: Number(SELLER_ID),
            uid: Number(cleanUid),
            sign: sign
        };

        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        return res.json(response.data);
    } catch (error) {
        console.error("API Error Response:", error.response ? error.response.data : error.message);
        if (error.response && error.response.data) {
            return res.status(200).json(error.response.data);
        }
        return res.status(500).json({ status: 400, message: "User not found or invalid ID!" });
    }
});

// 2. Cashfree Payment Order Creation Endpoint (Test Mode)
app.post('/api/create-payment', async (req, res) => {
    try {
        const { uid, amount, whatsapp, cart } = req.body;
        
        if (!uid || !amount) {
            return res.status(400).json({ success: false, message: "UID and Amount are required" });
        }

        const orderId = "ORD_" + Date.now();
        let totalPages = 0;

        if (cart) {
            for (let key in cart) {
                totalPages += cart[key].pages * cart[key].qty;
            }
        }
        if (totalPages === 0) {
            totalPages = Number(amount) * 73;
        }

        activeOrders.set(orderId, { uid: uid.toString().trim(), pages: totalPages });

        const hostUrl = `https://${req.get('host')}`;

        // Cashfree Order Payload Structure
        const cashfreePayload = {
            order_id: orderId,
            order_amount: Number(amount).toFixed(2),
            order_currency: "INR",
            customer_details: {
                customer_id: uid.toString().trim(),
                customer_name: "Customer " + uid,
                customer_email: `${uid}@ali-store.com`,
                customer_phone: whatsapp ? whatsapp.toString() : "9999999999"
            },
            order_meta: {
                return_url: `${hostUrl}/?order_id=${orderId}`
            }
        };

        const cashfreeResponse = await axios.post(CASHFREE_API_URL, cashfreePayload, {
            headers: {
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-api-version': '2023-08-01',
                'Content-Type': 'application/json'
            }
        });

        if (cashfreeResponse.data && cashfreeResponse.data.payment_session_id) {
            return res.json({
                success: true,
                payment_session_id: cashfreeResponse.data.payment_session_id,
                order_id: orderId
            });
        } else {
            return res.status(500).json({ success: false, message: "Failed to generate Cashfree payment session" });
        }

    } catch (error) {
        console.error("Cashfree Payment Creation Error:", error.response?.data || error.message);
        const errorMsg = error.response?.data?.message || error.response?.data?.error || "Internal server error during payment creation";
        return res.status(500).json({ success: false, message: errorMsg });
    }
});

// 3. Helper function to deliver items/pages
async function deliverItemsToUser(uid, pages, orderId) {
    const cleanUid = Number(uid);
    const numPages = Number(pages);

    const signString = `coins=${numPages}&orderId=${orderId}&sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
    const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

    const payload = {
        sellerId: Number(SELLER_ID),
        uid: cleanUid,
        coins: numPages,
        orderId: orderId,
        sign: sign
    };

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error("Delivery Error Response:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Failed to deliver items" };
    }
}

// 4. Cashfree Webhook Endpoint
app.post('/api/kwik-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        
        // Cashfree webhook structure handling
        const eventType = eventData.type;
        const orderDataPayload = eventData.data?.order;

        if (eventType === "PAYMENT_SUCCESS_WEBHOOK" || (orderDataPayload && orderDataPayload.order_status === "PAID")) {
            const orderId = orderDataPayload.order_id;
            let orderData = activeOrders.get(orderId);

            if (orderData) {
                await deliverItemsToUser(orderData.uid, orderData.pages, orderId);
                activeOrders.delete(orderId);
            }
        }
        return res.status(200).json({ status: true, message: "Webhook processed successfully" });
    } catch (err) {
        console.error("Webhook Critical Error:", err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
