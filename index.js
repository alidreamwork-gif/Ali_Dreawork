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

// अधिकृत 9 प्लान्स की सख्त मैपिंग (Amount -> Coins)
const COIN_PLANS = {
    151: 11000,
    220: 16100,
    330: 24100,
    440: 32100,
    685: 50000,
    1370: 100000,
    1999: 146000,
    3000: 219000,
    4500: 328500
};

// activeOrders: orderId -> { uid, baseAmount, exactAmount, coins, status, createdAt }
const activeOrders = new Map();

// यूनिक पैसे असाइन करने के लिए काउंटर (1 से 90 पैसे)
let paiseCounter = 1;

// ऑर्डर की लाइफ: 2 मिनट (120 सेकंड)
const ORDER_VALIDITY_MS = 120 * 1000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. User Verification
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

// 2. Order Create (छेड़छाड़-सुरक्षित सख्त वैलिडेशन)
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const baseAmt = Math.round(Number(amount));

        // सुरक्षा ताला: अगर अमाउंट इन 9 प्लान्स में नहीं है, तो तुरंत ब्लॉक करें
        if (!COIN_PLANS.hasOwnProperty(baseAmt)) {
            console.warn(`[SECURITY ALERT] फर्जी अमाउंट से छेड़छाड़ पकड़ी गई: ₹${amount} | UID: ${uid}`);
            return res.status(400).json({ 
                success: false, 
                message: "अमान्य प्लान! अमाउंट के साथ छेड़छाड़ पकड़ी गई।" 
            });
        }

        // सही कॉइन संख्या सीधे सर्वर मैपिंग से ली जाएगी
        const coins = COIN_PLANS[baseAmt];
        
        // 1 से 90 पैसे तक डायनामिक असाइनमेंट
        const paise = paiseCounter;
        paiseCounter = (paiseCounter % 90) + 1;

        // सटीक फ्लोटिंग अमाउंट (जैसे 151.01)
        const exactAmount = Number((baseAmt + (paise / 100)).toFixed(2));

        activeOrders.set(orderId, {
            uid: uid.toString().trim(),
            baseAmount: baseAmt,
            exactAmount: exactAmount,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now()
        });

        console.log(`[ORDER CREATED] ID: ${orderId} | Base: ₹${baseAmt} | Pay Amount: ₹${exactAmount} | Coins: ${coins}`);
        return res.json({ success: true, orderId: orderId, exactAmount: exactAmount });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// 3. Helper: कॉइन डिलीवरी
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

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Coins Delivered Successfully:", response.data);
        return response.data;
    } catch (error) {
        console.error("Coin delivery failed:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Delivery failed" };
    }
}

// 4. BharatPe Notification Webhook (सटीक पैसे मैचिंग)
app.post(['/api/sms-webhook', '/api/payment-webhook'], async (req, res) => {
    try {
        console.log("================== BHARATPE WEBHOOK HIT ==================");
        const text = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        console.log("Notification Content:", text);

        if (!text) return res.status(200).json({ status: false });

        // BharatPe नोटिफिकेशन से सटीक फ्लोट अमाउंट निकालना
        let detectedAmount = 0;
        const amtMatch = text.match(/(?:Received\s*)?([\d,]+(?:\.\d{1,2})?)\s*(?:Rupees|Rs|INR)/i) 
                      || text.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (amtMatch) {
            detectedAmount = parseFloat(amtMatch[1].replace(/,/g, ''));
        }

        console.log(`[DETECTED AMOUNT] ₹${detectedAmount}`);
        const now = Date.now();

        if (detectedAmount > 0) {
            for (let [ordId, ordData] of activeOrders.entries()) {
                if (ordData.status === 'PENDING') {
                    if ((now - ordData.createdAt) <= ORDER_VALIDITY_MS) {
                        if (Math.abs(ordData.exactAmount - detectedAmount) < 0.001) {
                            console.log(`[MATCH FOUND] Order: ${ordId} verified with ₹${detectedAmount}`);
                            ordData.status = 'PAID';
                            
                            // तुरंत ऑटोमैटिक कॉइन डिलीवर
                            await deliverCoinsToUser(ordData.uid, ordData.coins, ordId);
                            break;
                        }
                    }
                }
            }
        }

        return res.status(200).json({ status: true, amount: detectedAmount });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Polling Endpoint (फ्रंटएंड हर 2 सेकंड में चेक करेगा)
app.get('/api/check-order-status', (req, res) => {
    const { orderId } = req.query;
    if (!orderId || !activeOrders.has(orderId)) return res.json({ status: 'NOT_FOUND' });
    return res.json({ status: activeOrders.get(orderId).status });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
