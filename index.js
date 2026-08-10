require('dotenv').config();
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(express.static('.'));

// यह लाइन तेरी index.html वेबसाइट को ब्राउज़र पर दिखाएगी
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/api/pay', async (req, res) => {
    try {
        const { amount, userId } = req.body;
        const response = await axios.post('https://kwikupi.com/api/create-payment', {
            amount: amount,
            order_id: 'ORD_' + Date.now(),
            customer_name: userId,
            redirect_url: 'https://yourwebsite.com/success.html'
        }, {
            headers: {
                'X-API-KEY': process.env.KWIKUPI_KEY,
                'X-API-SECRET': process.env.KWIKUPI_SECRET,
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, payment_url: response.data.payment_url });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Payment initiation failed' });
    }
});

app.post('/api/webhook', async (req, res) => {
    const { status, customer_name, amount } = req.body;

    if (status === 'SUCCESS' || status === 'COMPLETED') {
        console.log(`Payment Verified! User: ${customer_name}, Amount: ${amount}`);
        
        let coinsToSend = 0;
        if (amount == 200) coinsToSend = 14600;
        else if (amount == 300) coinsToSend = 21900;
        else if (amount == 500) coinsToSend = 36500;

        if (coinsToSend > 0) {
            transferCoinsOnDuoo(customer_name, coinsToSend);
        }
    }
    res.sendStatus(200);
});

async function transferCoinsOnDuoo(targetUserId, coins) {
    console.log(`[BOT] Starting coin transfer of ${coins} to ID: ${targetUserId}`);
    
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        await page.goto('https://agent.duoo.live/#/login');
        
        await page.waitForSelector('input[type="text"]', { timeout: 10000 });
        await page.type('input[type="text"]', process.env.DUOO_USER);
        await page.type('input[type="password"]', process.env.DUOO_PASS);
        await page.click('button[type="submit"]');

        await page.waitForTimeout(3000);
        await page.goto('https://agent.duoo.live/#/coin/management');
        await page.waitForSelector('.coins-sale-btn');
        await page.click('.coins-sale-btn');

        await page.type('#customer_id_input', targetUserId);
        await page.type('#coins_quantity_input', coins.toString());

        await page.click('#submit_transfer_btn');
        console.log(`[SUCCESS] Transferred ${coins} coins to ${targetUserId}!`);

    } catch (err) {
        console.error('[ERROR] Automation failed:', err.message);
    } finally {
        await browser.close();
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));