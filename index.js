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

// सक्रिय ऑर्डर्स का मेमोरी स्टोरेज
const activeOrders = new Map();

// रूट पाथ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

// 2. BharatPe Order Initialization
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "UID, Amount, and OrderID are required" });
        }

        let coins = 0;
        const amtNum = Math.round(Number(amount));

        // पैकेज प्लान्स के अनुसार कॉइन्स
        if (amtNum === 200) coins = 14600;
        else if (amtNum === 300) coins = 21900;
        else if (amtNum === 500) coins = 36500;
        else if (amtNum === 1000) coins = 73000;
        else if (amtNum === 1500) coins = 109500;
        else if (amtNum === 2000) coins = 146000;
        else if (amtNum === 3000) coins = 219000;
        else if (amtNum === 4500) coins = 328500;
        else coins = amtNum * 73;

        activeOrders.set(orderId, {
            uid: uid.toString().trim(),
            amount: amtNum,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now()
        });

        console.log(`Order Registered: ${orderId} | UID: ${uid} | Amount: ₹${amtNum} | Coins: ${coins}`);
        return res.json({ success: true, orderId: orderId });
    } catch (error) {
        console.error("Order Creation Error:", error);
        return res.status(500).json({ success: false, message: "Server error creating order" });
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

// 4. Manual UTR Verification Endpoint (वेरिफाई बटन क्लिक करने पर तुरंत डिलीवरी के लिए)
app.post('/api/manual-verify', async (req, res) => {
    try {
        const { orderId, utr } = req.body;
        if (!orderId || !activeOrders.has(orderId)) {
            return res.status(400).json({ success: false, message: "Order not found or expired" });
        }

        const orderData = activeOrders.get(orderId);
        console.log(`Manual UTR Verification: Order ${orderId} | UTR: ${utr} | Delivering ${orderData.coins} Coins to UID: ${orderData.uid}`);

        const result = await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);

        orderData.status = 'PAID';
        orderData.utr = utr;

        return res.json({ success: true, message: "Coins delivered successfully!", result: result });
    } catch (error) {
        console.error("Manual verify error:", error);
        return res.status(500).json({ success: false, message: "Failed to process verification" });
    }
});

// 5. SMS Reader Webhook Endpoint
app.post('/api/sms-webhook', async (req, res) => {
    try {
        console.log("================== SMS WEBHOOK RECEIVED ==================");
        const smsBody = req.body.message || req.body.text || req.body.body || req.body.content || "";
        const sender = req.body.sender || req.body.from || "";

        console.log(`From: ${sender} | Message: ${smsBody}`);

        const amountMatch = smsBody.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        let detectedAmount = 0;
        if (amountMatch) {
            detectedAmount = Math.round(parseFloat(amountMatch[1].replace(/,/g, '')));
        }

        let matchedOrderId = null;
        for (let [orderId, data] of activeOrders.entries()) {
            if (smsBody.includes(orderId)) {
                matchedOrderId = orderId;
                break;
            }
        }

        if (!matchedOrderId && detectedAmount > 0) {
            for (let [orderId, data] of activeOrders.entries()) {
                if (data.status === 'PENDING' && data.amount === detectedAmount) {
                    matchedOrderId = orderId;
                    break;
                }
            }
        }

        if (matchedOrderId) {
            const orderData = activeOrders.get(matchedOrderId);
            console.log(`Payment Verified via SMS: Delivering ${orderData.coins} Coins to UID ${orderData.uid}`);
            
            const deliveryRes = await deliverCoinsToUser(orderData.uid, orderData.coins, matchedOrderId);
            
            orderData.status = 'PAID';
            orderData.deliveryResult = deliveryRes;

            return res.status(200).json({ status: true, message: "Payment processed & coins delivered", orderId: matchedOrderId });
        } else {
            return res.status(200).json({ status: false, message: "No matching pending order" });
        }
    } catch (err) {
        console.error("SMS Webhook Critical Error:", err);
        return res.status(500).json({ status: false, message: "Webhook execution error" });
    }
});

// 6. Status Polling Endpoint
app.get('/api/check-order-status', (req, res) => {
    const { orderId } = req.query;
    if (!orderId || !activeOrders.has(orderId)) {
        return res.json({ status: 'NOT_FOUND' });
    }

    const order = activeOrders.get(orderId);
    return res.json({ status: order.status });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
