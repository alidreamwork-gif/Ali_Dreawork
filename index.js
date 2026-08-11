const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Port setup for Render
const PORT = process.env.PORT || 3000;

// यह सीधा तुम्हारी वेबसाइट (index.html) को स्क्रीन पर दिखाएगा
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

// Webhook for payment success
app.post('/api/payment-success', (req, res) => {
    console.log("Payment Success Callback Received:", req.body);
    res.status(200).send("Success");
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
