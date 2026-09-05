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

// सक्रिय ऑर्डर्स: orderId -> { uid, amount, coins, status: 'PENDING' | 'PAID', createdAt }
const activeOrders = new Map();

// BharatPe नोटिफिकेशन्स का इन-मेमोरी स्टोरेज
const receivedNotifications = [];

// ऑर्डर की अधिकतम वैलिडिटी: ठीक 100 सेकंड (100000 ms)
const ORDER_VALIDITY_MS = 100 * 1000;

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

// 2. BharatPe Order Initialization (100s लाइफस्पैन)
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
            createdAt: Date.now() // ऑर्डर बनने का सटीक समय
        });

        console.log(`[ORDER CREATED] ${orderId} | UID: ${uid} | Amount: ₹${amtNum} | Coins: ${coins} | Time: ${new Date().toLocaleTimeString()}`);
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

    console.log("Delivering Coins Payload:", payload);

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Delivery Success:", response.data);
        return response.data;
    } catch (error) {
        console.error("Coin delivery failed:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Delivery failed" };
    }
}

// 4. BharatPe Notification Webhook Endpoint
app.post(['/api/sms-webhook', '/api/payment-webhook'], async (req, res) => {
    try {
        console.log("================== BHARATPE WEBHOOK HIT ==================");
        const text = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        console.log("Notification Content:", text);

        if (!text) {
            return res.status(200).json({ status: false, message: "Empty notification" });
        }

        // 1. अमाउंट निकालना
        let detectedAmount = 0;
        const amtMatch = text.match(/(?:Received\s*)?([\d,]+(?:\.\d{1,2})?)\s*(?:Rupees|Rs|INR)/i) 
                      || text.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (amtMatch) {
            detectedAmount = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')));
        }

        // 2. नाम निकालना
        let detectedSender = "";
        const nameMatch = text.match(/From\s+([^.\n\r]+)/i);
        if (nameMatch) {
            detectedSender = nameMatch[1].replace(/[^a-zA-Z0-9\s]/g, '').trim().toUpperCase();
        }

        const receiveTime = Date.now();
        console.log(`[PAYMENT LOGGED] ₹${detectedAmount} from "${detectedSender}" at ${new Date(receiveTime).toLocaleTimeString()}`);

        if (detectedAmount > 0) {
            receivedNotifications.push({
                amount: detectedAmount,
                senderName: detectedSender,
                rawText: text,
                used: false,
                receivedAt: receiveTime
            });
        }

        return res.status(200).json({ status: true, amount: detectedAmount, sender: detectedSender });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Secure Manual Verify (Strict 100s Window)
app.post('/api/manual-verify', async (req, res) => {
    try {
        const { orderId, senderName } = req.body;
        if (!orderId || !activeOrders.has(orderId)) {
            return res.status(400).json({ success: false, message: "Order session expired. Please create a new order." });
        }

        const orderData = activeOrders.get(orderId);
        const now = Date.now();

        // 1. क्या 100 सेकंड बीत चुके हैं?
        const timePassed = now - orderData.createdAt;
        if (timePassed > ORDER_VALIDITY_MS) {
            activeOrders.delete(orderId);
            return res.status(400).json({ 
                success: false, 
                message: "⏳ 100 सेकंड का समय समाप्त हो गया है! अगर आपने पेमेंट कर दिया है, तो सहायता के लिए WhatsApp (+917776881407) पर संपर्क करें।" 
            });
        }

        const inputName = senderName ? senderName.toString().replace(/[^a-zA-Z0-9\s]/g, '').trim().toUpperCase() : "";
        if (!inputName || inputName.length < 2) {
            return res.status(400).json({ success: false, message: "Please enter your valid Banking Name." });
        }

        console.log(`[VERIFY REQUEST] Order: ${orderId} | Need: ₹${orderData.amount} | Name: "${inputName}" | Elapsed: ${Math.round(timePassed / 1000)}s`);

        // 2. सख्त मिलान: पेमेंट केवल BUY NOW दबाने के बाद आया होना चाहिए
        const matchedIndex = receivedNotifications.findIndex(n => {
            if (n.used) return false;

            // सुरक्षा नियम: पेमेंट ऑर्डर बनने से पहले का नहीं होना चाहिए (सिर्फ 5s का नेटवर्क टॉलरेंस)
            if (n.receivedAt < (orderData.createdAt - 5000)) return false;

            // पेमेंट 100 सेकंड से पुराना न हो
            if ((now - n.receivedAt) > ORDER_VALIDITY_MS) return false;

            // अमाउंट ठीक मेल खाना चाहिए
            if (n.amount !== orderData.amount) return false;

            // नाम मैचिंग
            const notifSender = n.senderName;
            if (!notifSender) return true;

            const nameMatched = notifSender.includes(inputName) || inputName.includes(notifSender) ||
                                inputName.split(" ").some(part => part.length >= 3 && notifSender.includes(part));

            return nameMatched;
        });

        if (matchedIndex === -1) {
            const secLeft = Math.max(0, Math.round((ORDER_VALIDITY_MS - timePassed) / 1000));
            return res.status(400).json({ 
                success: false, 
                message: `❌ Wrong Name or Payment Not Received! ₹${orderData.amount} from "${inputName}" not found yet. (शेष समय: ${secLeft}s)` 
            });
        }

        // पेमेंट प्रमाणित!
        const payment = receivedNotifications[matchedIndex];
        payment.used = true;

        console.log(`[PAYMENT VERIFIED] Delivering ${orderData.coins} Coins to UID: ${orderData.uid}`);
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
    if (!orderId || !activeOrders.has(orderId)) return res.json({ status: 'NOT_FOUND' });
    return res.json({ status: activeOrders.get(orderId).status });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
