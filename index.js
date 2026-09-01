const express = require('express');
const app = express();

app.use(express.json());

// 1. Cashfree Order Creation Route with notify_url
app.post('/api/create-cashfree-order', async (req, res) => {
    try {
        const { uid, amount, whatsapp } = req.body;

        // Cashfree Order Request Payload
        const orderData = {
            order_amount: amount,
            order_currency: "INR",
            customer_details: {
                customer_id: uid,
                customer_phone: whatsapp
            },
            // Cashfree को आटोमैटिक पेमेंट कन्फर्मेशन भेजने के लिए notify_url जोड़ा गया है
            order_meta: {
                notify_url: "https://ali-dreamwork-digital-store.onrender.com/api/cashfree-webhook"
            }
        };

        // यहाँ आपकी Cashfree API कॉल करने का कोड आएगा (Axios या Fetch के जरिए)
        // उदाहरण के लिए मान लेते हैं कि आपको cashfree_response मिला है जिसमें payment_session_id है:
        // const cashfreeResponse = await callCashfreeAPI(orderData);

        // टेस्टिंग/डेमो रिस्पॉन्स (इसे अपने असली कैशफ्री एपीआई रिस्पॉन्स से बदल लें):
        const mockPaymentSessionId = "session_test_123456789"; 

        res.json({
            success: true,
            payment_session_id: mockPaymentSessionId
        });

    } catch (error) {
        console.error("Order creation error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Cashfree Webhook Route (Payment Success होने पर यहाँ रिक्वेस्ट आएगी)
app.post('/api/cashfree-webhook', async (req, res) => {
    try {
        const eventData = req.body;

        // चेक करें कि पेमेंट सफल हुआ या नहीं
        if (
            eventData &&
            eventData.data &&
            eventData.data.payment &&
            eventData.data.payment.payment_status === "SUCCESS"
        ) {
            const customerId = eventData.data.customer_details.customer_id;
            const orderAmount = eventData.data.order.order_amount;

            // 🟢 यहाँ डेटाबेस (Database) अपडेट करने का कोड लिखें
            // उदाहरण: यूजर आईडी (customerId) के हिसाब से उनके अकाउंट में कॉइंस या ई-बुक्स जोड़ें।
            console.log(`Payment Successful! User ID: ${customerId}, Amount: ${orderAmount}`);
        }

        return res.status(200).send("Webhook received successfully");
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

// सर्वर स्टार्ट करने के लिए (यदि पोर्ट सेट है)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
