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
// संरचना: orderId -> { uid, amount, coins, status: 'PENDING' | 'PAID', createdAt }
const activeOrders = new Map();

// 1. User Verification Endpoint (अपरिवर्तित)
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

// 2. BharatPe Order Initialization (फ्रंटएंड से ऑर्डर रजिस्टर करने के लिए)
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

// 3. Helper function to deliver coins (अपरिवर्तित)
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

// 4. SMS Reader Webhook Endpoint (BharatPe / Bank SMS Forwarder)
app.post('/api/sms-webhook', async (req, res) => {
    try {
        console.log("================== SMS WEBHOOK RECEIVED ==================");
        console.log("Payload:", JSON.stringify(req.body, null, 2));

        // SMS Reader ऍप आमतौर पर 'message', 'text', या 'body' में SMS भेजते हैं
        const smsBody = req.body.message || req.body.text || req.body.body || req.body.content || "";
        const sender = req.body.sender || req.body.from || "";

        console.log(`From: ${sender} | Message: ${smsBody}`);

        // SMS में से क्रेडिट अमाउंट निकालना (उदा. Credited by Rs 200.00 या received Rs.200)
        const amountMatch = smsBody.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        let detectedAmount = 0;
        if (amountMatch) {
            detectedAmount = Math.round(parseFloat(amountMatch[1].replace(/,/g, '')));
        }

        let matchedOrderId = null;

        // पहले चेक करें कि क्या SMS में सीधे Order ID मौजूद है
        for (let [orderId, data] of activeOrders.entries()) {
            if (smsBody.includes(orderId)) {
                matchedOrderId = orderId;
                break;
            }
        }

        // यदि SMS में Order ID नहीं है, तो पेंडिंग ऑर्डर्स में से अमाउंट मैच करें
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
            console.log(`Payment Verified for Order: ${matchedOrderId} | Delivering ${orderData.coins} Coins to UID ${orderData.uid}`);
            
            const deliveryRes = await deliverCoinsToUser(orderData.uid, orderData.coins, matchedOrderId);
            
            orderData.status = 'PAID';
            orderData.deliveryResult = deliveryRes;

            return res.status(200).json({ status: true, message: "Payment processed & coins delivered", orderId: matchedOrderId });
        } else {
            console.log("No matching pending order found for this SMS.");
            return res.status(200).json({ status: false, message: "No matching pending order" });
        }

    } catch (err) {
        console.error("SMS Webhook Critical Error:", err);
        return res.status(500).json({ status: false, message: "Webhook execution error" });
    }
});

// 5. Front-end Status Polling Endpoint (फ्रंटएंड हर 3 सेकंड में पेमेंट स्टेटस चेक करेगा)
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
