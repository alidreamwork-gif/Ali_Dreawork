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
// 💡 बड़े प्लान्स के लिए 4 यूपीआई आईडी (2 Paytm और 2 Super Money - 1:1:1:1 रोटेशन)
// ==========================================
const LARGE_PAYMENT_UPIS = [
    "ali.vasim@superyes",
    "akhtar.84@superyes",
    "paytm.s2zq023@pty",
    "paytm.s2xzdht@pty"
];
let largePaymentIndex = 0;

// सभी प्लान्स की सख्त मैपिंग
const COIN_PLANS = {
    // छोटे प्लान्स (3-Step Rotation: BharatPe, Slice, GPay)
    151: 11000,
    220: 16100,
    330: 24100,
    440: 32100,
    685: 50000,
    1370: 100000,
    1999: 146000,
    
    // नए बड़े प्लान्स (Paytm & Super Money - 4 UPIs Rotation)
    3000: 219000,
    4500: 328500,
    6500: 474500,
    9000: 657000,
    13000: 949000
};

const activeOrders = new Map();
let paiseCounter = 1;
let paymentCounter = 0;
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

// 2. Order Create
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const baseAmt = Math.round(Number(amount));

        if (!COIN_PLANS.hasOwnProperty(baseAmt)) {
            console.warn(`[SECURITY ALERT] अमान्य प्लान: ₹${amount} | UID: ${uid}`);
            return res.status(400).json({ success: false, message: "अमान्य प्लान!" });
        }

        const coins = COIN_PLANS[baseAmt];
        
        const paise = paiseCounter;
        paiseCounter = (paiseCounter % 90) + 1;
        const exactAmount = Number((baseAmt + (paise / 100)).toFixed(2));

        let assignedGateway = 'BHARATPE';
        let selectedLargeUpi = '';

        if (baseAmt >= 3000) {
            assignedGateway = 'LARGE_UPI';
            selectedLargeUpi = LARGE_PAYMENT_UPIS[largePaymentIndex];
            largePaymentIndex = (largePaymentIndex + 1) % LARGE_PAYMENT_UPIS.length;
        } else {
            // 3-Step Rotation: BharatPe, Slice, GPay
            const rotationSequence = ['BHARATPE', 'SLICE', 'GPAY'];
            assignedGateway = rotationSequence[paymentCounter % rotationSequence.length];
            paymentCounter = (paymentCounter + 1) % rotationSequence.length;
        }

        const cleanUid = uid.toString().trim();

        activeOrders.set(orderId, {
            uid: cleanUid,
            baseAmount: baseAmt,
            exactAmount: exactAmount,
            coins: coins,
            status: 'PENDING',
            createdAt: Date.now(),
            gateway: assignedGateway,
            upiUsed: selectedLargeUpi
        });

        console.log(`[ORDER CREATED] ID: ${orderId} | UID: ${cleanUid} | Gateway: ${assignedGateway} | UPI: ${selectedLargeUpi || assignedGateway} | Pay Amount: ₹${exactAmount} | Coins: ${coins}`);
        return res.json({ 
            success: true, 
            orderId: orderId, 
            exactAmount: exactAmount, 
            gateway: assignedGateway,
            largeUpi: selectedLargeUpi || LARGE_PAYMENT_UPIS[0]
        });
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

// फैंसी/स्टाइलिश यूनिकोड कैरेक्टर्स को नॉर्मल टेक्स्ट में बदलने का फंक्शन
function normalizeFancyText(text) {
    if (!text) return "";
    let normalized = "";
    for (let char of text) {
        const code = char.codePointAt(0);
        if (code >= 0x1D400 && code <= 0x1D419) normalized += String.fromCharCode(code - 0x1D400 + 65);
        else if (code >= 0x1D41A && code <= 0x1D433) normalized += String.fromCharCode(code - 0x1D41A + 97);
        else if (code >= 0x1D7CE && code <= 0x1D7D7) normalized += String.fromCharCode(code - 0x1D7CE + 48);
        else if (code >= 0x1D560 && code <= 0x1D579) normalized += String.fromCharCode(code - 0x1D560 + 65);
        else if (code >= 0x1D57A && code <= 0x1D593) normalized += String.fromCharCode(code - 0x1D57A + 97);
        else if (code >= 0x1D7EC && code <= 0x1D7F5) normalized += String.fromCharCode(code - 0x1D7EC + 48);
        else if (code >= 0xFF10 && code <= 0xFF19) normalized += String.fromCharCode(code - 0xFF10 + 48);
        else normalized += char;
    }
    return normalized;
}

// 4. Unified Webhook (Advanced Flexible Amount Parser)
app.post(['/webhook', '/api/sms-webhook', '/api/payment-webhook', '/api/supermoney-webhook'], async (req, res) => {
    try {
        console.log("================== PAYMENT WEBHOOK HIT ==================");
        
        const rawMessage = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        const rawTitle = req.body.title || req.body.not_title || "";

        const messageText = normalizeFancyText(rawMessage);
        const titleText = normalizeFancyText(rawTitle);

        console.log("Notification Message:", messageText);
        console.log("Notification Title:", titleText);

        const combinedText = `${titleText} ${messageText}`;
        if (!combinedText.trim()) return res.status(200).json({ status: false });

        let detectedAmount = 0;
        
        // सभी तरह के फॉर्मेट्स (जैसे 1370.2, 1370.18, 1,370.20) को पकड़ने के लिए फ्लेक्सिबल रेगुलर एक्सप्रेसर
        const cleanStr = combinedText.replace(/[,]/g, '');
        const matches = cleanStr.match(/(\d+\.\d{1,2})/g);

        if (matches && matches.length > 0) {
            // नोटिफिकेशन में जो आखिरी सटीक डेसिमल अमाउंट होगा उसे उठाएगा
            detectedAmount = parseFloat(matches[matches.length - 1]);
        }

        console.log(`[DETECTED AMOUNT] ₹${detectedAmount}`);
        const now = Date.now();

        if (detectedAmount > 0) {
            for (let [ordId, ordData] of activeOrders.entries()) {
                if (ordData.status === 'PENDING') {
                    if ((now - ordData.createdAt) <= ORDER_VALIDITY_MS) {
                        // 0.01 का मार्جن ताकि .2 और .20 पूरी तरह मैच हो सकें
                        if (Math.abs(ordData.exactAmount - detectedAmount) < 0.01) {
                            console.log(`[MATCH FOUND] Order: ${ordId} (UID: ${ordData.uid}) verified with ₹${detectedAmount}`);
                            ordData.status = 'PAID';
                            
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
