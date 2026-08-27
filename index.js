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
        
        // 1. Exact MD5 Signature generation from manager's doc
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

        console.log(`Checking UID: ${cleanUid}, Sign: ${sign}`);

        // 2. Exact payload format requested by manager (Number types for sellerId & uid)
        const payload = {
            sellerId: Number(SELLER_ID),
            uid: Number(cleanUid),
            sign: sign,
        };

        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("Duoo API Raw Response:", response.data);
        res.json(response.data);

    } catch (error) {
        console.error("API Error Response:", error.response ? error.response.data : error.message);
        
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
