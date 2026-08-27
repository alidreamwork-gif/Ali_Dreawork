const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const SELLER_ID = "4851724";
const API_KEY = "DUOOa49Jeyu8Zx7AKei6";

// अस्थायी आर्डर स्टोरेज
const pendingOrders = new Map();

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

// 2. Register order mapping
app.post('/api/register-order', (req, res) => {
    const { orderId, uid, coins } = req.body;
    if (orderId && uid) {
        pendingOrders.set(orderId, { uid, coins });
        setTimeout(() => pendingOrders.delete(orderId), 3600000);
        return res.json({ status: true });
    }
    return res.status(400).json({ status: false });
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

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error("Coin Sale Error:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Failed to deliver coins" };
    }
}

// 4. KwikUPI Webhook Endpoint (Updated to handle Fix-Link payload)
app.post('/api/kwikupi-webhook', async (req, res) => {
    try {
        console.log("Webhook Received from KwikUPI:", req.body);

        const { status, order_id, txid, amount, customer_name, customer_phone, custom_order_id } = req.body;

        if (status === "success" || status === "SUCCESS" || req.body.success === true) {
            let uid = null;
            let coins = 0;
            const targetOrderId = custom_order_id || order_id || txid || ("ORD_" + Date.now());

            // तरीका 1: चेक करें कि क्या हमारे पास pendingOrders में यह आर्डर सेव है
            if (order_id && pendingOrders.has(order_id)) {
                const orderData = pendingOrders.get(order_id);
                uid = orderData.uid;
                coins = orderData.coins;
                pendingOrders.delete(order_id);
            } 
            else if (custom_order_id && pendingOrders.has(custom_order_id)) {
                const orderData = pendingOrders.get(custom_order_id);
                uid = orderData.uid;
                coins = orderData.coins;
                pendingOrders.delete(custom_order_id);
            }

            // तरीका 2: अगर KwikUPI ने fixed link भेजा है और customer_name में UID है
            if (!uid && customer_name && !isNaN(customer_name)) {
                uid = customer_name.trim();
            }

            // तरीका 3: अमाउंट से कॉइन कैलकुलेट करें (अगर कॉइन पहले सेट नहीं थे)
            if (uid && (!coins || coins === 0)) {
                const amtNum = Number(amount);
                if (amtNum === 10) coins = 730;
                else if (amtNum === 200) coins = 14600;
                else if (amtNum === 300) coins = 21900;
                else if (amtNum === 500) coins = 36500;
                else if (amtNum === 1000) coins = 73000;
                else if (amtNum === 1500) coins = 109500;
                else coins = Math.round(amtNum * 73); // डिफ़ॉल्ट कैलकुलेशन
            }

            if (uid && coins > 0) {
                console.log(`Webhook Processing -> Delivering ${coins} coins to UID: ${uid} (Order: ${targetOrderId})`);
                const result = await deliverCoinsToUser(uid, coins, targetOrderId);
                console.log("Duoo Coin Delivery Result via Webhook:", result);
            } else {
                console.log("Webhook Warning: Could not find UID or Coins. Data received:", req.body);
            }
        }

        return res.status(200).json({ status: true, message: "Webhook processed" });
    } catch (err) {
        console.error("Webhook Error:", err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
});

// 5. Payment Success Redirect Endpoint
app.get('/api/payment-success', async (req, res) => {
    try {
        const { uid, coins, orderId } = req.query;
        const finalOrderId = orderId || "ORD_" + Date.now();

        if (!uid || !coins) {
            return res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0f19; color: #fff; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <h2 style="color: #f3ba2f;">⏳ Payment Received!</h2>
                    <p>Your payment is being processed and coins will be added to your Duoo ID shortly.</p>
                    <br>
                    <a href="/" style="background: #f3ba2f; color: #000; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 5px;">Back to Home</a>
                </div>
            `);
        }

        console.log(`Processing redirect coin delivery -> UID: ${uid}, Coins: ${coins}, OrderID: ${finalOrderId}`);

        const result = await deliverCoinsToUser(uid, coins, finalOrderId);
        
        if (result.status === 200 || result.success === true) {
            res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0f19; color: #fff; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <h2 style="color: #10b981;">✅ Payment Successful & Coins Delivered!</h2>
                    <p>Successfully added <b>${coins} Coins</b> to User ID: <b>${uid}</b></p>
                    <br>
                    <a href="/" style="background: #f3ba2f; color: #000; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 5px;">Back to Home</a>
                </div>
            `);
        } else {
            res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0f19; color: #fff; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <h2 style="color: #ef4444;">❌ Coin Delivery Notice</h2>
                    <p>Payment was received! If coins are not reflected instantly, please contact support with your User ID: <b>${uid}</b></p>
                    <br>
                    <a href="/" style="background: #f3ba2f; color: #000; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 5px;">Back to Home</a>
                </div>
            `);
        }
    } catch (err) {
        console.error("Payment Success Route Error:", err);
        res.status(500).send("Internal Server Error during coin delivery.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const timeZoneStr = "Asia/Kolkata";
    const currentTimeStr = new Date().toLocaleString("en-US", { timeZone: timeZoneStr });
    console.log(`Server running on port ${PORT} at ${currentTimeStr}`);
});
