const axios = require('axios');
const dayjs = require('dayjs');

// =====================
// CONFIG
// =====================
const CMC_API_KEY = 'a7a6f04f-9834-4a12-8b4f-71239ce1ae80';
const CMC_FEAR_GREED_URL = 'https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest';

// Mailjet API
const MAILJET_API_KEY = '84249403dd0ab0340ca715e99024f9c4';
const MAILJET_SECRET_KEY = 'a8ff391bde5d6062bc30722799540e00';

// Email Config
const EMAIL_FROM = 'ducnhat1708@gmail.com';
const EMAIL_TO = 'ducnhat171998@gmail.com';

// =====================
// FORMAT DATE
// =====================
function formatDate(isoString) {
  return dayjs(isoString).format('DD/MM/YYYY HH:mm:ss');
}

// =====================
// FETCH FEAR & GREED DATA
// =====================
async function fetchFearGreedData() {
  try {
    const response = await axios.get(CMC_FEAR_GREED_URL, {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }
    });

    const data = response.data.data;
    return {
      value: data.value,
      classification: data.value_classification,
      updatedTime: formatDate(data.update_time)
    };
  } catch (error) {
    console.error('Error fetching Fear & Greed data:', error.message);
    return null;
  }
}

// =====================
// SEND EMAIL USING MAILJET API
// =====================
async function sendEmailViaMailjetApi(value, classification, updatedTime) {
  try {
    const res = await axios.post(
      'https://api.mailjet.com/v3.1/send',
      {
        Messages: [
          {
            From: { Email: EMAIL_FROM, Name: 'Fear & Greed Bot' },
            To: [{ Email: EMAIL_TO }],
            Subject: `Fear & Greed Index Update - ${value}`,
            TextPart: `Fear & Greed Index: ${value} (${classification}). Updated: ${updatedTime}`,
            HTMLPart: `
              <h2>🔥 Fear & Greed Index Update</h2>
              <p><b>Value:</b> ${value}</p>
              <p><b>Classification:</b> ${classification}</p>
              <p><b>Updated:</b> ${updatedTime}</p>
              <p><a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank">View Chart</a></p>
            `
          }
        ]
      },
      {
        auth: {
          username: MAILJET_API_KEY,
          password: MAILJET_SECRET_KEY
        }
      }
    );
    console.log('Mailjet API email sent:', res.data);
  } catch (error) {
    console.error('Error sending email via Mailjet API:', error.response?.data || error.message);
  }
}

// =====================
// MAIN FUNCTION
// =====================
async function notifyFearGreed() {
  const data = await fetchFearGreedData();
  if (!data) {
    console.error('No Fear & Greed data fetched.');
    return;
  }
  await sendEmailViaMailjetApi(data.value, data.classification, data.updatedTime);
  console.log('Fear & Greed notification email sent successfully.');
}

// Run once
notifyFearGreed();
