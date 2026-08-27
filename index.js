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

// 1. User Verification Endpoint
app.post('/api/verify-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ status: 400, message: "UID is missing!" });
        }

        const cleanUid = uid.toString().trim();
        
        // MD5 Signature Generation for User Info
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

        console.log(`Checking UID: ${cleanUid}, Sign: ${sign}`);

        const payload = {
            sellerId: Number(SELLER_ID),
            uid: Number(cleanUid),
            sign: sign
        };

        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("Duoo API Raw Response:", response.data);
        return res.json(response.data);

    } catch (error) {
        console.error("API Error Response:", error.response ? error.response.data : error.message);
        
        if (error.response && error.response.data) {
            return res.status(200).json(error.response.data);
        }

        return res.status(500).json({ 
            status: 400, 
            message: "User not found or invalid ID!" 
        });
    }
});

// 2. Helper function to deliver coins using Coin Sale API (Sorted parameters as per docs: coins, orderId, sellerId, uid)
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

// 3. Payment Success Endpoint (Called when gateway redirects back after successful payment)
app.get('/api/payment-success', async (req, res) => {
    try {
        const { uid, coins, orderId } = req.query;
        
        const finalOrderId = orderId || "ORD_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

        if (!uid || !coins) {
            return res.status(400).send("<h3>❌ Missing parameters for coin delivery!</h3>");
        }

        console.log(`Processing coin delivery -> UID: ${uid}, Coins: ${coins}, OrderID: ${finalOrderId}`);

        // Call Duoo Coin Sale API
        const result = await deliverCoinsToUser(uid, coins, finalOrderId);
        
        if (result.status === 200) {
            res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0f19; color: #fff; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <h2 style="color: #10b981;">✅ Payment Successful & Coins Delivered!</h2>
                    <p>Successfully added <b>${coins} Coins</b> to User ID: <b>${uid}</b></p>
                    <p style="font-size: 12px; color: #9ca3af;">Transaction ID: ${result.transactionId}</p>
                    <br>
                    <a href="/" style="background: #f3ba2f; color: #000; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 5px;">Back to Home</a>
                </div>
            `);
        } else {
            res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0f19; color: #fff; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <h2 style="color: #ef4444;">❌ Coin Delivery Failed</h2>
                    <p>Payment was received, but Duoo server returned: <b>${result.message}</b></p>
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
