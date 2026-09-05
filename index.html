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

// सक्रिय ऑर्डर्स का मेमोरी मैप
const activeOrders = new Map();

// BharatPe से आए हालिया पेमेंट्स का स्टोरेज
const recentCredits = [];

// रूट पेज
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

// 2. BharatPe Order Create
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "UID, Amount, and OrderID are required" });
        }

        let coins = 0;
        const amtNum = Math.round(Number(amount));

        // पैकेज अनुसार कॉइन्स
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

// 4. BharatPe Notification Webhook Endpoint (नया मैचिंग लॉजिक)
app.post('/api/sms-webhook', async (req, res) => {
    try {
        console.log("================== BHARATPE NOTIFICATION RECEIVED ==================");
        console.log("Raw Payload:", JSON.stringify(req.body, null, 2));

        const text = req.body.message || req.body.text || req.body.body || req.body.title || req.body.content || "";
        console.log("Notification Text:", text);

        // "Received 200.00 Rupees" से अमाउंट पकड़ना
        const amtMatch = text.match(/Received\s*([\d,]+(?:\.\d{1,2})?)\s*(?:Rupees|Rs|INR)/i) 
                      || text.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        
        let detectedAmount = 0;
        if (amtMatch) {
            detectedAmount = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')));
        }

        console.log(`Detected Payment Amount: ₹${detectedAmount}`);

        if (detectedAmount > 0) {
            recentCredits.push({
                amount: detectedAmount,
                used: false,
                receivedAt: Date.now(),
                raw: text
            });

            // पेंडिंग ऑर्डर से ऑटो-मैच
            for (let [orderId, orderData] of activeOrders.entries()) {
                if (orderData.status === 'PENDING' && orderData.amount === detectedAmount) {
                    console.log(`Auto-matching Payment of ₹${detectedAmount} for Order: ${orderId} (UID: ${orderData.uid})`);
                    await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);
                    orderData.status = 'PAID';
                    break;
                }
            }
        }

        return res.status(200).json({ status: true, detectedAmount: detectedAmount });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Manual Verify Button (वेबसाइट पर बटन दबाने पर तुरंत मैच करेगा)
app.post('/api/manual-verify', async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId || !activeOrders.has(orderId)) {
            return res.status(400).json({ success: false, message: "Order session expired. Please try again." });
        }

        const orderData = activeOrders.get(orderId);

        if (orderData.status === 'PAID') {
            return res.json({ success: true, message: "Payment already confirmed & coins delivered!" });
        }

        const now = Date.now();
        // पिछले 10 मिनट में आया ₹200/अमाउंट ढूंढना
        const validPaymentIndex = recentCredits.findIndex(p => 
            !p.used && 
            p.amount === orderData.amount && 
            (now - p.receivedAt) < 10 * 60 * 1000
        );

        if (validPaymentIndex === -1) {
            return res.status(400).json({ 
                success: false, 
                message: `₹${orderData.amount} का पेमेंट अभी रिसीव नहीं हुआ है। कृपया 5-10 सेकंड रुकें और दोबारा दबाएं।` 
            });
        }

        const matchedPayment = recentCredits[validPaymentIndex];
        matchedPayment.used = true;

        console.log(`Manual Verify Confirmed! Delivering ${orderData.coins} Coins to UID: ${orderData.uid}`);
        const result = await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);

        orderData.status = 'PAID';

        return res.json({ success: true, message: "Payment Verified! Coins successfully delivered.", result: result });
    } catch (error) {
        console.error("Manual verify error:", error);
        return res.status(500).json({ success: false, message: "Server error during verification" });
    }
});

// 6. Polling Endpoint (फ्रंटएंड स्टेटस चेक)
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
