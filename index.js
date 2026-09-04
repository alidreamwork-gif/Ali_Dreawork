const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const SELLER_ID = "";
const API_KEY = "DUOOa49Jeyu8Zx7AKei6";

// Cashfree Test (Sandbox) API Credentials
const CASHFREE_APP_ID = "TEST112085181a9848f239327d519a0481580211";
const CASHFREE_SECRET_KEY = "cfsk_ma_test_1430e76879fb27fbeedb82100f7cc46b_3c769f5e";

// Sandbox Test URL for Cashfree Orders
const CASHFREE_API_URL = "https://sandbox.cashfree.com/pg/orders";
// अस्थायी आर्डर स्टोरेज (Order ID से UID और Coins جوड़ने के लिए)
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

// 2. Cashfree Dynamic Payment Order Creation
app.post('/api/create-cashfree-order', async (req, res) => {
    try {
        const { uid, amount, whatsapp } = req.body;
        
        if (!uid || !amount) {
            return res.status(400).json({ success: false, message: "UID and Amount are required" });
        }

        const orderId = "ORD_" + Date.now();
        let coins = 0;
        const amtNum = Math.round(Number(amount));

        // नए प्लान्स के अनुसार कॉइन्स की सटीक वैल्यू
        if (amtNum === 200) coins = 14600;
        else if (amtNum === 300) coins = 21900;
        else if (amtNum === 500) coins = 36500;
        else if (amtNum === 1000) coins = 73000;
        else if (amtNum === 1500) coins = 109500;
        else if (amtNum === 2000) coins = 146000;
        else if (amtNum === 3000) coins = 219000;
        else if (amtNum === 4500) coins = 328500;
        else coins = amtNum * 73; // डिफ़ॉल्ट कैलकुलेशन

        // ऑर्डर को मेमोरी में सेव करें ताकि वेबहुक आने पर UID मिल सके
        activeOrders.set(orderId, { uid: uid.toString().trim(), coins: coins });

        // Render लाइव सर्वर का यूआरएल ऑटोमैटिक कैच करने के लिए
        const hostUrl = `https://${req.get('host')}`;

        const cashfreePayload = {
            order_id: orderId,
            order_amount: Number(amount).toFixed(2),
            order_currency: "INR",
            customer_details: {
                customer_id: uid.toString().trim(),
                customer_phone: whatsapp ? whatsapp.toString() : "9999999999",
                customer_email: `${uid}@ali-store.com`
            },
            order_meta: {
                return_url: `${hostUrl}/?order_id=${orderId}`,
                notify_url: `${hostUrl}/api/cashfree-webhook`
            }
        };

        const cashfreeResponse = await axios.post(CASHFREE_API_URL, cashfreePayload, {
            headers: {
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-api-version': '2022-09-01',
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
            return res.status(500).json({ success: false, message: "Failed to generate payment session" });
        }

    } catch (error) {
        console.error("Cashfree Payment Creation Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during payment creation" });
    }
});

// 3. Helper function to deliver coins
async function deliverCoinsToUser(uid, coins, orderId) {
    const cleanUid = Number(uid);
    const numCoins = Number(coins);

    const signString = `coins=${numCoins}&orderId=${orderId}&sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
    const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

    const payload = {
        sellerId: Number(SELLER_ID),
        uid: cleanUid,
        coins: numCoins,
        orderId: orderId,
        sign: sign
    };

    console.log("Sending Payload to CoinSale API:", payload);

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("API Success Response:", response.data);
        return response.data;
    } catch (error) {
        console.error("Coin Sale Error Response:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Failed to deliver coins" };
    }
}

// 4. Cashfree Webhook Endpoint (Automatic Coin Delivery)
app.post('/api/cashfree-webhook', async (req, res) => {
    try {
        console.log("================== CASHFREE WEBHOOK RECEIVED ==================");
        console.log(JSON.stringify(req.body, null, 2));

        const eventData = req.body;
        
        if (eventData && eventData.data && eventData.data.payment && eventData.data.payment.payment_status === "SUCCESS") {
            const orderId = eventData.data.order.order_id;
            let orderData = activeOrders.get(orderId);

            if (orderData) {
                console.log(`Found order details for ${orderId}: UID = ${orderData.uid}, Coins = ${orderData.coins}`);
                const result = await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);
                console.log("Final Coin Delivery Result:", result);
                
                activeOrders.delete(orderId);
            } else {
                console.log(`Error: Order ID ${orderId} not found in activeOrders memory map!`);
            }
        } else {
            console.log("Webhook received but payment is not successful.");
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
