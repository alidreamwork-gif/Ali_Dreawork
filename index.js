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
            return res.status(400).json({ status: 400, message: "UID is missing!" });
        }

        const cleanUid = uid.toString().trim();
        
        // Exact rule from Duoo doc: 
        // 1. Alphabetical sorting: sellerId first, then uid.
        // 2. Format: sellerId=VALUE&uid=VALUE&key=API_KEY
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

        console.log(`Checking UID: ${cleanUid}, SignString: ${signString}, Sign: ${sign}`);

        // Sending values strictly as strings/integers matching official doc example
        const requestPayload = {
            sellerId: parseInt(SELLER_ID, 10),
            uid: parseInt(cleanUid, 10),
            sign: sign
        };

        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', requestPayload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("Duoo API Raw Response:", response.data);
        res.json(response.data);

    } catch (error) {
        console.error("API Error Response:", error.response ? error.response.data : error.message);
        
        // If Duoo returns 400 with a message, forward it safely to frontend
        if (error.response && error.response.data) {
            return res.status(200).json(error.response.data);
        }

        res.status(500).json({ 
            status: 400, 
            message: "User not found or invalid ID!" 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
