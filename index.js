const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname)); // ताकि तुम्हारी HTML फाइलें भी चलती रहें

const SELLER_ID = "4851724";
const API_KEY = "DU00a49Jeyu8Zx7AKei6";

// यूजर वेरीफाई करने का एपीआई राउट
app.post('/api/verify-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ code: 400, message: "UID is missing!" });
        }

        const cleanUid = uid.toString().trim();
        const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
        const sign = crypto.createHash('md5').update(signString).digest('hex');

        // सीधे Duoo API को रिक्वेस्ट भेज रहे हैं
        const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', {
            sellerId: parseInt(SELLER_ID),
            uid: parseInt(cleanUid),
            sign: sign
        });

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ code: 500, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
