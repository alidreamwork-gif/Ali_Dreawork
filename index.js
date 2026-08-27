const crypto = require('crypto');
const axios = require('axios');

const SELLER_ID = "4851724";
const API_KEY = "DU00a49Jeyu8Zx7AKei6";

async function verifyUser(uid) {
    const cleanUid = uid.toString().trim();
    
    // MD5 Signature Generation（sign 拼接逻辑不变）
    const signString = `sellerId=${SELLER_ID}&uid=${cleanUid}&key=${API_KEY}`;
    const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

    // Request Payload / JSON Body
    // 注意：sellerId、uid 必须传数字类型（不带引号），sign 传字符串
    const payload = {
        sellerId: Number(SELLER_ID),
        uid: Number(cleanUid),
        sign: sign,
    };

    // Sending request to Duoo Production API
    const response = await axios.post('https://api.duoo.live/api/finance/v1/getUserInfo', payload, {
        headers: {
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}
