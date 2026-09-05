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

// BharatPe नोटिफिकेशन्स का स्टोरेज
const receivedNotifications = [];

// रूट पेज
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

// 2. BharatPe Order Initialization
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

    console.log("Sending Delivery Payload to Duoo API:", payload);

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Duoo API Response:", response.data);
        return response.data;
    } catch (error) {
        console.error("Coin delivery failed:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Delivery failed" };
    }
}

// 4. BharatPe Notification Webhook Endpoint (सुपर रोबस्ट)
app.post(['/api/sms-webhook', '/api/payment-webhook'], async (req, res) => {
    try {
        console.log("================== BHARATPE WEBHOOK HIT ==================");
        console.log("Raw Payload:", JSON.stringify(req.body, null, 2));

        // ऐप चाहे किसी भी नाम से टेक्स्ट भेजे (message, text, body, msg, key, content)
        const text = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        console.log("Captured Text:", text);

        // 1. अमाउंट निकालना
        let detectedAmount = 0;
        const amtMatch = text.match(/(?:Received\s*)?([\d,]+(?:\.\d{1,2})?)\s*(?:Rupees|Rs|INR)/i) 
                      || text.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (amtMatch) {
            detectedAmount = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')));
        }

        // 2. नाम निकालना (फुल स्टॉप और फालतू कैरेक्टर हटाकर)
        let detectedSender = "";
        const nameMatch = text.match(/From\s+([^.\n\r]+)/i);
        if (nameMatch) {
            detectedSender = nameMatch[1].replace(/[^a-zA-Z0-9\s]/g, '').trim().toUpperCase();
        }

        console.log(`Extracted -> Amount: ₹${detectedAmount} | Sender: "${detectedSender}"`);

        if (detectedAmount > 0) {
            receivedNotifications.push({
                amount: detectedAmount,
                senderName: detectedSender,
                rawText: text,
                used: false,
                receivedAt: Date.now()
            });
            console.log("Payment successfully logged in server memory!");
        }

        return res.status(200).json({ status: true, amount: detectedAmount, sender: detectedSender });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Secure Manual Verify (लचीली नाम मैचिंग)
app.post('/api/manual-verify', async (req, res) => {
    try {
        const { orderId, senderName } = req.body;
        if (!orderId || !activeOrders.has(orderId)) {
            return res.status(400).json({ success: false, message: "Order session expired. Please refresh and try again." });
        }

        // यूजर का इनपुट नाम साफ़ करना
        const inputName = senderName ? senderName.toString().replace(/[^a-zA-Z0-9\s]/g, '').trim().toUpperCase() : "";
        if (!inputName || inputName.length < 2) {
            return res.status(400).json({ success: false, message: "Please enter your valid Banking Name." });
        }

        const orderData = activeOrders.get(orderId);
        const now = Date.now();

        console.log(`Verify Check -> Order: ${orderId} | Need: ₹${orderData.amount} | Name: "${inputName}"`);
        console.log("Currently Available in Server:", JSON.stringify(receivedNotifications, null, 2));

        // मैचिंग लॉजिक
        const matchedIndex = receivedNotifications.findIndex(n => {
            if (n.used) return false;
            // 20 मिनट की वैलिडिटी
            if ((now - n.receivedAt) > 20 * 60 * 1000) return false;
            
            // अमाउंट मैच
            if (n.amount !== orderData.amount) return false;

            // नाम मैच: चाहे पहला नाम डाले (AYAN) या पूरा (AYAN KHAN)
            const notifSender = n.senderName;
            if (!notifSender) return true;

            const nameMatched = notifSender.includes(inputName) || inputName.includes(notifSender) ||
                                inputName.split(" ").some(part => part.length >= 3 && notifSender.includes(part));

            return nameMatched;
        });

        if (matchedIndex === -1) {
            return res.status(400).json({ 
                success: false, 
                message: `❌ Payment not found for ₹${orderData.amount} from "${inputName}". Please wait 5 seconds and retry.` 
            });
        }

        // पेमेंट मैच हो गया!
        const payment = receivedNotifications[matchedIndex];
        payment.used = true;

        console.log(`Payment Verified! Delivering ${orderData.coins} Coins to UID: ${orderData.uid}`);
        const result = await deliverCoinsToUser(orderData.uid, orderData.coins, orderId);

        orderData.status = 'PAID';

        return res.json({ 
            success: true, 
            message: "Payment Verified! Coins successfully delivered.", 
            result: result 
        });

    } catch (error) {
        console.error("Manual verify error:", error);
        return res.status(500).json({ success: false, message: "Server error during verification." });
    }
});

// 6. Polling Endpoint
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
