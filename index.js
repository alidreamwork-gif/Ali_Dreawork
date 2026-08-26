const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const SELLER_ID = "4851724";
const API_KEY = "DU00a49Jeyu8Zx7AKei6";

app.post('/api/verify-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ code: 400, message: "UID is missing!" });
        }

        const cleanUid = uid.toString().trim();
        
        // Official Documentation Rules:
        // 1. Sort parameters alphabetically: sellerId comes before uid.
        // 2. Concatenate: sellerId=...&uid=...&key=...
        // 3. MD5 hash and convert strictly to UPPERCASE.
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

        console.log(`Checking UID: ${cleanUid}, Sign: ${sign}`);

        // Sending as clean JSON with application/json header as per docs
        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', {
            sellerId: parseInt(SELLER_ID),
            uid: parseInt(cleanUid),
            sign: sign
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("Duoo API Raw Response:", response.data);
        res.json(response.data);

    } catch (error) {
        console.error("API Error Response:", error.response ? error.response.data : error.message);
        res.status(500).json({ 
            code: 500, 
            message: "API Connection Error", 
            details: error.response ? error.response.data : error.message 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
