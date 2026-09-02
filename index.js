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

// Kwik API Credentials (फ्रंटएंड और बैकएंड दोनों के लिए синх्रनाइज्ड)
const KWIK_API_KEY = "pk_live_5n5lpy5CaullzMCT5UhkNpbe";
const KWIK_API_SECRET = "sk_live_07yLG7sfCWnzgVfBryVXtKrYfVMxrhqjkJITRIMYNREaWh";
const KWIK_API_URL = "https://kwikupi.com/api/create-payment";

// अस्थायी आर्डर स्टोरेज (Order ID से UID और Coins जोड़ने के लिए)
const activeOrders = new Map();

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

// 2. Kwik Dynamic Payment Order Creation
app.post('/api/create-payment', async (req, res) => {
    try {
        const { uid, amount, whatsapp } = req.body;
        
        if (!uid || !amount) {
            return res.status(400).json({ success: false, message: "UID and Amount are required" });
        }

        const orderId = "ORD_" + Date.now();
        let pages = 0;
        const amtNum = Math.round(Number(amount));

        // प्लान्स के अनुसार पेजेज (Pages) की सटीक वैल्यू
        if (amtNum === 200) pages = 14600;
        else if (amtNum === 300) pages = 21900;
        else if (amtNum === 500) pages = 36500;
        else if (amtNum === 1000) pages = 73000;
        else if (amtNum === 1500) pages = 109500;
        else if (amtNum === 2000) pages = 146000;
        else if (amtNum === 3000) pages = 219000;
        else if (amtNum === 4500) pages = 328500;
        else pages = amtNum * 73;

        // ऑर्डर को मेमोरी में सेव करें ताकि वेबहुक/रिडायरेक्ट आने पर UID मिल सके
        activeOrders.set(orderId, { uid: uid.toString().trim(), pages: pages });

        const hostUrl = `https://${req.get('host')}`;

        const kwikPayload = {
            amount: Number(amount).toFixed(2),
            order_id: orderId,
            customer_name: "User " + uid,
            customer_email: `${uid}@ali-store.com`,
            customer_phone: whatsapp ? whatsapp.toString() : "9999999999",
            redirect_url: `${hostUrl}/?order_id=${orderId}`
        };

        const kwikResponse = await axios.post(KWIK_API_URL, kwikPayload, {
            headers: {
                'X-API-KEY': KWIK_API_KEY,
                'X-API-SECRET': KWIK_API_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (kwikResponse.data && (kwikResponse.data.payment_url || kwikResponse.data.payment_link || kwikResponse.data.url)) {
            return res.json({
                success: true,
                payment_url: kwikResponse.data.payment_url || kwikResponse.data.payment_link || kwikResponse.data.url,
                order_id: orderId
            });
        } else {
            return res.status(500).json({ success: false, message: "Failed to generate Kwik payment link" });
        }

    } catch (error) {
        console.error("Kwik Payment Creation Error:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Internal server error during payment creation" });
    }
});

// 3. Helper function to deliver items/coins
async function deliverItemsToUser(uid, pages, orderId) {
    const cleanUid = Number(uid);
    const numPages = Number(pages);

    const signString = `coins=${numPages}&orderId=${orderId}&sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
    const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

    const payload = {
        sellerId: Number(SELLER_ID),
        uid: cleanUid,
        coins: numPages,
        orderId: orderId,
        sign: sign
    };

    console.log("Sending Payload to API:", payload);

    try {
        const response = await axios.post('https://api.duoo.live/api/finance/v1/coinSale', payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("API Success Response:", response.data);
        return response.data;
    } catch (error) {
        console.error("Delivery Error Response:", error.response ? error.response.data : error.message);
        return error.response ? error.response.data : { status: 400, message: "Failed to deliver items" };
    }
}

// 4. Kwik Webhook / Callback Endpoint
app.post('/api/kwik-webhook', async (req, res) => {
    try {
        console.log("================== KWIK WEBHOOK RECEIVED ==================");
        console.log(JSON.stringify(req.body, null, 2));

        const eventData = req.body;
        
        // चेक करें कि पेमेंट सफल है या नहीं (गेटवे फॉर्मेट के अनुसार)
        if (eventData && (eventData.status === "SUCCESS" || eventData.payment_status === "SUCCESS" || eventData.success === true)) {
            const orderId = eventData.order_id;
            let orderData = activeOrders.get(orderId);

            if (orderData) {
                console.log(`Found order details for ${orderId}: UID = ${orderData.uid}, Pages = ${orderData.pages}`);
                const result = await deliverItemsToUser(orderData.uid, orderData.pages, orderId);
                console.log("Final Delivery Result:", result);
                
                activeOrders.delete(orderId);
            } else {
                console.log(`Error: Order ID ${orderId} not found in activeOrders memory map!`);
            }
        } else {
            console.log("Webhook received but payment is not successful.");
        }

        return res.status(200).json({ status: true, message: "Webhook processed successfully" });
    } catch (err) {
        console.error("Webhook Critical Error:", err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
