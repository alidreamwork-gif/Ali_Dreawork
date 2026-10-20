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

// अधिकृत प्लान्स की सख्त मैपिंग (Amount -> Coins) - इसमें ₹20 का टेस्ट प्लान भी शामिल है
const COIN_PLANS = {
    20: 1400,     // टेस्टिंग प्लान
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

// activeOrders: orderId -> { uid, baseAmount, exactAmount, coins, status, createdAt, gateway }
const activeOrders = new Map();

// यूनिक पैसे असाइन करने के लिए काउंटर (1 से 90 पैसे)
let paiseCounter = 1;

// 3:1 सर्कुलेशन काउंटर (छोटे अमाउंट्स के लिए BharatPe और Google Pay)
let paymentCounter = 0;

// ऑर्डर की लाइफ: 5 मिनट (300 सेकंड)
const ORDER_VALIDITY_MS = 300 * 1000;

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

// 2. Order Create (छोटे अमाउंट के लिए QR और ₹2000+ बड़े अमाउंट के लिए Super Money)
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const baseAmt = Math.round(Number(amount));

        if (!COIN_PLANS.hasOwnProperty(baseAmt)) {
            console.warn(`[SECURITY ALERT] फर्जी अमाउंट से छेड़छाड़ पकड़ी गई: ₹${amount} | UID: ${uid}`);
            return res.status(400).json({ 
                success: false, 
                message: "अमान्य प्लान! अमाउंट के साथ छेड़छाड़ पकड़ी गई।" 
            });
        }

        const coins = COIN_PLANS[baseAmt];
        
        const paise = paiseCounter;
        paiseCounter = (paiseCounter % 90) + 1;

        const exactAmount = Number((baseAmt + (paise / 100)).toFixed(2));

        // गेटवे चयन लॉजिक: ₹2000 या उससे अधिक के लिए 'SUPER_MONEY', बाकी के लिए 3:1 (BHARATPE / GPAY)
        let assignedGateway = 'BHARATPE';
        if (baseAmt >= 2000) {
            assignedGateway = 'SUPER_MONEY';
        } else {
            paymentCounter = (paymentCounter + 1) % 4;
            assignedGateway = paymentCounter === 0 ? 'GPAY' : 'BHARATPE';
        }

        const cleanUid = uid.toString().trim();

        activeOrders.set(orderId, {
            uid: cleanUid,
            baseAmount: baseAmt,
            exactAmount: exactAmount,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now(),
            gateway: assignedGateway
        });

        console.log(`[ORDER CREATED] ID: ${orderId} | UID: ${cleanUid} | Gateway: ${assignedGateway} | Base: ₹${baseAmt} | Pay Amount: ₹${exactAmount} | Coins: ${coins}`);
        return res.json({ success: true, orderId: orderId, exactAmount: exactAmount, gateway: assignedGateway });
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

// 4. Unified Webhook (सभी गेटवे के लिए)
app.post(['/api/sms-webhook', '/api/payment-webhook'], async (req, res) => {
    try {
        console.log("================== PAYMENT WEBHOOK HIT ==================");
        
        const messageText = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        const titleText = req.body.title || req.body.not_title || "";

        console.log("Notification Message:", messageText);
        console.log("Notification Title:", titleText);

        const combinedText = `${titleText} ${messageText}`;
        if (!combinedText.trim()) return res.status(200).json({ status: false });

        let detectedAmount = 0;
        const amtMatch = combinedText.match(/(?:[₹]|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i) 
                      || combinedText.match(/(?:Received\s*)?([\d,]+(?:\.\d{1,2})?)\s*(?:Rupees|Rs|INR)/i);
                      
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
                            console.log(`[MATCH FOUND] Order: ${ordId} (UID: ${ordData.uid}) verified with ₹${detectedAmount}`);
                            ordData.status = 'PAID';
                            
                            await deliverCoinsToUser(ordData.uid, ordData.coins, ordId);
                            break;
                        }
                    }
                }
            }
        }

        return res.json({ status: true, amount: detectedAmount });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

// 5. Polling Endpoint
app.get('/api/check-order-status', (req, res) => {
    const { orderId } = req.query;
    if (!orderId || !activeOrders.has(orderId)) return res.json({ status: 'NOT_FOUND' });
    return res.json({ status: activeOrders.get(orderId).status });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
