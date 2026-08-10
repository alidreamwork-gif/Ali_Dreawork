const express = require('express');
const fetch = require('node-fetch'); // अगर node-fetch इंस्टॉल न हो, तो ध्यान रखना (या नेटिव fetch यूज़ होगा)
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Порт (Port) सेट करना जो Render ऑटोमैटिक देता है
const PORT = process.env.PORT || 3000;

// बेसिक टेस्ट रूट
app.get('/', (req, res) => {
    sendResponse = "Bot and Payment Server is Running!";
    res.send(sendResponse);
});

// ==========================================
// KwikUPI Payment Link Generator Route
// ==========================================
app.post('/api/create-payment', async (req, res) => {
    const { userId, userPhone, coins, amount } = req.body;
    
    try {
        const response = await fetch('https://api.kwikupi.com/v1/create-order', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_KWIKUPI_API_KEY' // <--- यहाँ अपनी असली KwikUPI API Key डाल देना!
            },
            body: JSON.stringify({
                amount: amount,
                order_id: "ORD_" + Date.now(),
                customer_phone: userPhone,
                callback_url: "https://duoo-bot.onrender.com/api/payment-success"
            })
        });

        const data = await response.json();

        if (data.status === 'success' || data.payment_link) {
            res.json({ payment_url: data.payment_link || data.data.payment_url });
        } else {
            res.status(500).json({ message: data.message || 'Gateway error' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server connection error' });
    }
});

// पेमेंट सक्सेस होने पर यहाँ रिक्वेस्ट आएगी (Webhook)
app.post('/api/payment-success', (req, res) => {
    // यहाँ कॉइन ऑटोमैटिक यूजर को भेजने का लॉजिक आएगा
    console.log("Payment Success Callback Received:", req.body);
    res.status(200).send("Success");
});

// सर्वर स्टार्ट करना
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
