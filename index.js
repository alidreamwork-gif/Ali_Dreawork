const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// KwikUPI Payment Integration
app.post('/api/create-payment', async (req, res) => {
    const { userId, userPhone, coins, amount } = req.body;
    
    try {
        const response = await fetch('https://kwikupi.com/api/v1/create-order', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer sk_live_07yLG7sfCWnzgVfFbRyVXtkrYfVzMxrhqjkJITRIMYNREaWh' // तेरी सीक्रेट की यहाँ लगा दी है
            },
            body: JSON.stringify({
                amount: amount,
                order_id: "ORD_" + Date.now(),
                customer_phone: userPhone,
                redirect_url: "https://duoo-bot.onrender.com/"
            })
        });

        const data = await response.json();

        if (data.status === true || data.status === 'success' || data.payment_url) {
            res.json({ payment_url: data.payment_url || data.data.payment_url });
        } else {
            res.status(500).json({ message: data.message || 'Gateway error' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server connection error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
