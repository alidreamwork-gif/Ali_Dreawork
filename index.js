const express = require('express');
const axios = require('axios');
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
        
        // Duoo Sign Generation
        const crypto = require('crypto');
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

// 2. KwikUPI Dynamic Payment Order Creation (API Integration)
app.post('/api/create-kwikupi-order', async (req, res) => {
    try {
        const { uid, amount, whatsapp } = req.body;
        
        if (!uid || !amount) {
            return res.status(400).json({ success: false, message: "UID and Amount are required" });
        }

        const orderId = "ORD_" + Date.now();

        // KwikUPI Create Payment API Request (अनुसार वीडियो डॉक्यूमेंटेशन)
        const kwikResponse = await axios.post('https://kwikupi.com/api/create-payment', {
            amount: parseFloat(amount).toFixed(2),
            order_id: orderId,
            customer_name: uid.toString(), // यहाँ यूजर की ID पास हो रही है ताकि वेबहुक में वापस मिले
            customer_email: `${uid}@duoo.live`,
            redirect_url: `https://duoo-bot.onrender.com/`
        }, {
            headers: {
                'X-API-KEY': 'pk_live_5n5Ipy5CauIlzMCT5UhkNpbe',    // 🔴 यहाँ अपनी KwikUPI Public Key डालें
                'X-API-SECRET': 'sk_live_07yLG7sfCWnzgVfFbRyVXtkrYrFvMxrhqjkJiTRlMYNREaWh', // 🔴 यहाँ अपनी KwikUPI Secret Key डालें
                'Content-Type': 'application/json'
            }
        });

        if (kwikResponse.data && kwikResponse.data.payment_page) {
            return res.json({
                success: true,
                payment_url: kwikResponse.data.payment_page,
                order_id: orderId
            });
        } else {
            return res.status(500).json({ success: false, message: "Failed to generate payment URL" });
        }

    } catch (error) {
        console.error("Payment Creation Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during payment creation" });
    }
});

// 3. Helper function to deliver coins to Duoo
async function deliverCoinsToUser(uid, coins, orderId) {
    const cleanUid = Number(uid);
    const numCoins = Number(coins);
    const crypto = require('crypto');

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

// 4. KwikUPI Webhook Endpoint (Automatic Coin Delivery)
app.post('/api/kwikupi-webhook', async (req, res) => {
    try {
        console.log("Webhook Received from KwikUPI:", req.body);

        const { status, order_id, customer_name, amount, payment_id, txid } = req.body;

        if (status === "TXN_SUCCESS" || status === "success" || status === "SUCCESS" || req.body.success === true) {
            const uid = customer_name; // यहाँ से वही UID मिल जाएगी जो हमने आर्डर बनाते समय भेजी थी
            let coins = 0;
            const targetOrderId = payment_id || txid || order_id || ("ORD_" + Date.now());

            if (uid) {
                const amtNum = Number(amount);
                if (amtNum === 10) coins = 730;
                else if (amtNum === 200) coins = 14600;
                else if (amtNum === 300) coins = 21900;
                else if (amtNum === 500) coins = 36500;
                else if (amtNum === 1000) coins = 73000;
                else if (amtNum === 1500) coins = 109500;
                else coins = Math.round(amtNum * 73);

                console.log(`Delivering ${coins} coins to User UID: ${uid} (Order: ${targetOrderId})`);
                const result = await deliverCoinsToUser(uid, coins, targetOrderId);
                console.log("Coin Delivery Result:", result);
            }
        }

        return res.status(200).json({ status: true, message: "Webhook processed" });
    } catch (err) {
        console.error("Webhook Error:", err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
