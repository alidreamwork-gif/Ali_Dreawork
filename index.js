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

// 1. आपके 9 आधिकारिक प्लान्स (छेड़छाड़ रोकने के लिए सुरक्षा ताला)
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

// 2. UPI कॉन्फ़िगरेशन
const BHARATPE_CONFIG = {
    name: "BHARATPE",
    vpa: "BHARATPE2Z0P0L0B8I71717@unitype",
    merchantName: "VASIM ALI"
};

const PHONEPE_CONFIG = {
    name: "PHONEPE",
    vpa: "Q908322573@ybl", // <-- यहाँ अपनी असली PhonePe मर्चेंट UPI ID डालें
    merchantName: "VASIM ALI"      // <-- PhonePe Business पर जो नाम दिखता है
};

// 4:1 रोटेशन पूल: 4 बार BharatPe और 1 बार PhonePe (हर 5 ऑर्डर पर ऑटो-रिपीट)
const UPI_ROTATION_POOL = [
    BHARATPE_CONFIG, // 1st Order
    BHARATPE_CONFIG, // 2nd Order
    BHARATPE_CONFIG, // 3rd Order
    BHARATPE_CONFIG, // 4th Order
    PHONEPE_CONFIG   // 5th Order
];

let rotationIndex = 0;

// activeOrders: orderId -> { uid, baseAmount, exactAmount, coins, status, gateway, createdAt }
const activeOrders = new Map();

// यूनिक पैसे असाइन करने के लिए काउंटर (1 से 90 पैसे)
let paiseCounter = 1;

// ऑर्डर की लाइफ: 2 मिनट (120 सेकंड)
const ORDER_VALIDITY_MS = 120 * 1000;

// फैंसी/स्टाइलिश यूनिकोड अंकों (Mathematical Alphanumeric Symbols) को सामान्य 0-9 में बदलना
function normalizeNumbers(str) {
    if (!str) return "";
    return str
        .normalize('NFKD')
        .replace(/[\u{1D7CE}-\u{1D7F5}]/gu, ch => {
            const code = ch.codePointAt(0);
            return String((code - 0x1D7CE) % 10);
        });
}

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

// 2. Order Create Endpoint (4:1 UPI Rotation + Tampering Protection)
app.post('/api/create-order', (req, res) => {
    try {
        const { uid, amount, orderId } = req.body;
        if (!uid || !amount || !orderId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const baseAmt = Math.round(Number(amount));

        // सुरक्षा जांच: केवल लिस्टेड प्लान्स मान्य होंगे
        if (!COIN_PLANS.hasOwnProperty(baseAmt)) {
            console.warn(`[SECURITY ALERT] फर्जी प्लान पकड़ा गया: ₹${amount} | UID: ${uid}`);
            return res.status(400).json({ 
                success: false, 
                message: "अमान्य प्लान! अमाउंट के साथ छेड़छाड़ पकड़ी गई।" 
            });
        }

        const coins = COIN_PLANS[baseAmt];
        
        // 1 से 90 पैसे का डायनामिक असाइनमेंट
        const paise = paiseCounter;
        paiseCounter = (paiseCounter % 90) + 1;

        const exactAmount = Number((baseAmt + (paise / 100)).toFixed(2));

        // 4:1 रोटेशन से गेटवे पिक करना
        const currentUpi = UPI_ROTATION_POOL[rotationIndex];
        rotationIndex = (rotationIndex + 1) % UPI_ROTATION_POOL.length;

        // UPI Intent String तैयार करना
        const upiString = `upi://pay?pa=${currentUpi.vpa}&pn=${encodeURIComponent(currentUpi.merchantName)}&am=${exactAmount}&cu=INR&tn=CoinPurchase`;

        activeOrders.set(orderId, {
            uid: uid.toString().trim(),
            baseAmount: baseAmt,
            exactAmount: exactAmount,
            coins: coins,
            status: 'PENDING',
            gateway: currentUpi.name,
            createdAt: Date.now()
        });

        console.log(`[ORDER CREATED] ID: ${orderId} | Gateway: ${currentUpi.name} | Amount: ₹${exactAmount} | Coins: ${coins}`);

        return res.json({ 
            success: true, 
            orderId: orderId, 
            exactAmount: exactAmount,
            upiString: upiString 
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// 3. Helper: कॉइन ऑटो-क्रेडिट
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

// 4. Webhook (BharatPe और PhonePe Notification Parser)
app.post(['/api/sms-webhook', '/api/payment-webhook'], async (req, res) => {
    try {
        console.log("================== PAYMENT WEBHOOK HIT ==================");
        const rawText = req.body.message || req.body.text || req.body.body || req.body.msg || req.body.key || req.body.content || "";
        console.log("Raw Notification Content:", rawText);

        if (!rawText) return res.status(200).json({ status: false });

        // PhonePe के स्टाइलिश यूनिकोड फ़ॉन्ट को साधारण टेक्स्ट में बदलना
        const cleanText = normalizeNumbers(rawText);
        console.log("Normalized Content:", cleanText);

        let detectedAmount = 0;

        // BharatPe, PhonePe, बैंक SMS सभी से रकम निकालना
        const amtMatch = cleanText.match(/(?:received|credited|payment of|rs\.?|inr)\s*(?:rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i)
                      || cleanText.match(/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)
                      || cleanText.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rupees|rs|inr)/i);

        if (amtMatch) {
            detectedAmount = parseFloat(amtMatch[1].replace(/,/g, ''));
        }

        console.log(`[DETECTED AMOUNT] ₹${detectedAmount}`);
        const now = Date.now();

        if (detectedAmount > 0) {
            for (let [ordId, ordData] of activeOrders.entries()) {
                if (ordData.status === 'PENDING') {
                    if ((now - ordData.createdAt) <= ORDER_VALIDITY_MS) {
                        // पैसे से पैसे का सटीक मिलान
                        if (Math.abs(ordData.exactAmount - detectedAmount) < 0.001) {
                            console.log(`[MATCH FOUND] Order: ${ordId} (${ordData.gateway}) verified with ₹${detectedAmount}`);
                            ordData.status = 'PAID';
                            
                            // तुरंत कॉइन डिलीवर
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
