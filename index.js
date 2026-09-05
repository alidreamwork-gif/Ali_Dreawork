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

// सक्रिय ऑर्डर्स: orderId -> { uid, amount, coins, status: 'PENDING' | 'PAID' }
const activeOrders = new Map();

// बैंक/BharatPe SMS से आए असली पेमेंट्स का स्टोरेज: utr -> { amount, used: false, receivedAt }
const receivedPayments = new Map();

// 1. User Verification Endpoint
app.post('/api/verify-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ status: 400, message: "UID is missing!" });
        
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
        if (error.response && error.response.data) return res.status(200).json(error.response.data);
        return res.status(500).json({ status: 400, message: "User not found or invalid ID!" });
    }
});

// 2. BharatPe Order Create
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const amtNum = Math.round(Number(amount));
        let coins = amtNum * 73;

        if (amtNum === 200) coins = 14600;
        else if (amtNum === 300) coins = 21900;
        else if (amtNum === 500) coins = 36500;
        else if (amtNum === 1000) coins = 73000;
        else if (amtNum === 1500) coins = 109500;
        else if (amtNum === 2000) coins = 146000;
        else if (amtNum === 3000) coins = 219000;
        else if (amtNum === 4500) coins = 328500;

        activeOrders.set(orderId, {
            uid: uid.toString().trim(),
            amount: amtNum,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now()
        });

        console.log(`Order Created: ${orderId} | UID: ${uid} | Amount: ₹${amtNum} | Coins: ${coins}`);
        return res.json({ success: true, orderId: orderId });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
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

    console.log("Sending Delivery Payload to Duoo:", payload);

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error("Coin delivery failed:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Delivery failed" };
    }
}

// 4. SMS Reader Webhook Endpoint (बैंक का SMS आते ही UTR और Amount रजिस्टर होगा)
app.post('/api/sms-webhook', async (req, res) => {
    try {
        console.log("================== SMS WEBHOOK RECEIVED ==================");
        const smsBody = req.body.message || req.body.text || req.body.body || req.body.content || "";
        console.log("Incoming SMS:", smsBody);

        // क्रेडिट अमाउंट निकालना
        const amountMatch = smsBody.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        let detectedAmount = 0;
        if (amountMatch) {
            detectedAmount = Math.round(parseFloat(amountMatch[1].replace(/,/g, '')));
        }

        // 12-अंकों का UPI UTR / RRN निकालना
        const utrMatch = smsBody.match(/(?:upi(?:\/|\s*ref(?:\s*no)?[:\.\s]*)?|rrn[:\.\s]*|ref(?:\s*no)?[:\.\s]*)([0-9]{12})/i);
        let detectedUtr = null;
        if (utrMatch) {
            detectedUtr = utrMatch[1];
        } else {
            // बैकअप: कोई भी 12 अंकों का सीधा नंबर
            const raw12 = smsBody.match(/\b([0-9]{12})\b/);
            if (raw12) detectedUtr = raw12[1];
        }

        if (detectedUtr && detectedAmount > 0) {
            receivedPayments.set(detectedUtr, {
                amount: detectedAmount,
                used: false,
                receivedAt: Date.now()
            });
            console.log(`Verified Bank Payment Saved: UTR: ${detectedUtr} | Amount: ₹${detectedAmount}`);
        }

        // अगर SMS में सीधे Order ID आ रही हो, तो ऑटो-डिलीवर भी कर दें
        for (let [orderId, data] of activeOrders.entries()) {
            if (smsBody.includes(orderId) && data.status === 'PENDING') {
                await deliverCoinsToUser(data.uid, data.coins, orderId);
                data.status = 'PAID';
                break;
            }
        }

        return res.status(200).json({ status: true, message: "SMS logged" });
    } catch (err) {
        console.error("SMS webhook error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Secure Manual Verify (नकली UTR को ब्लॉक करेगा)
app.post('/api/manual-verify', async (req, res) => {
    try {
        const { orderId, utr } = req.body;
        if (!orderId || !activeOrders.has(orderId)) {
            return res.status(400).json({ success: false, message: "Session expired or Order not found." });
        }

        const cleanUtr = utr ? utr.toString().trim() : "";
        if (!cleanUtr || cleanUtr.length !== 12 || !/^\d+$/.test(cleanUtr)) {
            return res.status(400).json({ success: false, message: "Wrong UTR format! Please enter a valid 12-digit UPI UTR number." });
        }

        const orderData = activeOrders.get(orderId);

        // चेक करें कि क्या यह UTR असली बैंक SMS में आया है?
        if (!receivedPayments.has(cleanUtr)) {
            return res.status(400).json({ 
                success: false, 
                message: "Wrong UPI UTR ID! No successful payment found for this UTR yet. Please wait 10 seconds and try again." 
            });
        }

        const payment = receivedPayments.get(cleanUtr);

        // चेक करें कि क्या UTR पहले ही किसी ऑर्डर में इस्तेमाल हो चुका है?
        if (payment.used) {
            return res.status(400).json({ 
                success: false, 
                message: "This UTR ID has already been used and redeemed!" 
            });
        }

        // चेक करें कि क्या पेमेंट का अमाउंट ऑर्डर के अमाउंट से मैच करता है?
        if (payment.amount < orderData.amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Payment amount mismatch! Received ₹${payment.amount}, but plan cost is ₹${orderData.amount}.` 
            });
        }

        // असली पेमेंट कन्फर्म होने पर ही कॉइन डिलीवर करें
        console.log(`Legitimate Payment Verified! Delivering ${orderData.coins} Coins to UID: ${orderData.uid} for UTR: ${cleanUtr}`);
        const deliveryResult = await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);

        // UTR को Used मार्क करें ताकि दोबारा इस्तेमाल न हो
        payment.used = true;
        orderData.status = 'PAID';
        orderData.utr = cleanUtr;

        return res.json({ success: true, message: "Payment Verified! Coins successfully delivered.", result: deliveryResult });
    } catch (error) {
        console.error("Manual verify error:", error);
        return res.status(500).json({ success: false, message: "Internal server verification error" });
    }
});

// 6. Check Order Status
app.get('/api/check-order-status', (req, res) => {
    const { orderId } = req.query;
    if (!orderId || !activeOrders.has(orderId)) return res.json({ status: 'NOT_FOUND' });
    return res.json({ status: activeOrders.get(orderId).status });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
