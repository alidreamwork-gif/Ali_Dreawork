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

// ==========================================
// 💡 एकमात्र Kwik गेटवे की डिटेल्स यहाँ डालें:
// ==========================================
const KWIK_GATEWAY = {
    apiKey: "sk_live_07yLG7sfCWnzgVfFbRyVXtkrYrFvMxrhqjkJiTRlMYNREaWh",       // <-- यहाँ अपनी Kwik गेटवे की असली API Key / Token डालें
    apiUrl: "https://hudupi.com/api/create-payment"// <-- यहाँ Kwik का असली API Endpoint URL डालें
};

// केवल बड़े प्लान्स और ₹20 टेस्ट प्लान की सख्त मैपिंग (Amount -> Coins)
const COIN_PLANS = {
    20: 1400,         // टेस्टिंग प्लान
    3000: 219000,
    5000: 365000,
    6000: 438000,
    10000: 730000,
    12000: 876000
};

// activeOrders: orderId -> { uid, baseAmount, exactAmount, coins, status, createdAt }
const activeOrders = new Map();

// 1 से 90 पैसे तक डायनामिक असाइनमेंट
let paiseCounter = 1;

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

// 2. Order Create & Single Kwik Gateway Integration
app.post('/api/create-order', async (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const baseAmt = Math.round(Number(amount));

        if (!COIN_PLANS.hasOwnProperty(baseAmt)) {
            console.warn(`[SECURITY ALERT] अमान्य प्लान या छेड़छाड़: ₹${amount} | UID: ${uid}`);
            return res.status(400).json({ success: false, message: "अमान्य प्लान!" });
        }

        const coins = COIN_PLANS[baseAmt];
        
        const paise = paiseCounter;
        paiseCounter = (paiseCounter % 90) + 1;
        const exactAmount = Number((baseAmt + (paise / 100)).toFixed(2));

        const cleanUid = uid.toString().trim();

        let paymentUrl = "";
        try {
            const kwikPayload = {
                order_id: orderId,
                amount: exactAmount,
                customer_phone: req.body.phone || "9690118011",
                redirect_url: `https://${req.get('host')}/`
            };

            const kwikResponse = await axios.post(KWIK_GATEWAY.apiUrl, kwikPayload, {
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${KWIK_GATEWAY.apiKey}`
                }
            });

            paymentUrl = kwikResponse.data.payment_url || kwikResponse.data.link || "https://kwikgateway.com/pay/dummy-link";
        } catch (kwikErr) {
            console.error("Kwik API Error:", kwikErr.response ? kwikErr.response.data : kwikErr.message);
            paymentUrl = "https://kwikgateway.com/pay/" + orderId;
        }

        activeOrders.set(orderId, {
            uid: cleanUid,
            baseAmount: baseAmt,
            exactAmount: exactAmount,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now()
        });

        console.log(`[ORDER CREATED] ID: ${orderId} | UID: ${cleanUid} | Pay Amount: ₹${exactAmount} | Coins: ${coins}`);
        return res.json({ success: true, orderId: orderId, exactAmount: exactAmount, paymentUrl: paymentUrl });
    } catch (error) {
        console.error("Order creation error:", error);
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

// 4. Single Kwik Payment Webhook
app.post('/api/kwik-webhook', async (req, res) => {
    try {
        console.log("================== KWIK WEBHOOK HIT ==================");
        console.log("Payload:", req.body);

        const incomingOrderId = req.body.order_id || req.body.orderId;
        const incomingStatus = req.body.status || req.body.payment_status;
        const detectedAmount = Number(req.body.amount || req.body.paid_amount || 0);

        if (!incomingOrderId) return res.status(400).json({ status: false, message: "Missing order_id" });

        if (activeOrders.has(incomingOrderId)) {
            const ordData = activeOrders.get(incomingOrderId);
            if (ordData.status === 'PENDING') {
                if (incomingStatus === 'SUCCESS' || incomingStatus === 'PAID' || Math.abs(ordData.exactAmount - detectedAmount) < 0.001) {
                    ordData.status = 'PAID';
                    console.log(`[MATCH FOUND] Order: ${incomingOrderId} (UID: ${ordData.uid}) verified via Kwik Webhook!`);
                    
                    await deliverCoinsToUser(ordData.uid, ordData.coins, incomingOrderId);
                }
            }
        }

        return res.json({ status: true });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ status: false });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
