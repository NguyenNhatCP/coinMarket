import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

const {
  PORT = 3000,
  API_SECRET,
  CMC_API_KEY,
  CHECK_INTERVAL_CRON="0 8 * * *",
  FNG_THRESHOLD = '50',
} = process.env;

if (!API_SECRET) {
  console.error('Missing API_SECRET in .env');
  process.exit(1);
}
if (!CMC_API_KEY) {
  console.error('Missing CMC_API_KEY in .env');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(morgan('tiny'));

const TOKENS_FILE = path.resolve('./tokens.json');
let TOKENS = new Set();

// Load tokens on boot
try {
  if (fs.existsSync(TOKENS_FILE)) {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    TOKENS = new Set(arr);
  }
} catch (e) {
  console.warn('Could not read tokens.json, starting empty.');
}

function persistTokens() {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify([...TOKENS], null, 2));
  } catch (e) {
    console.error('Failed to write tokens.json:', e.message);
  }
}

function requireSecret(req, res, next) {
  const h = req.header('x-api-secret');
  if (!h || h !== API_SECRET) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, count: TOKENS.size }));

// Register Expo token
app.post('/register-token', requireSecret, (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken[')) {
    return res.status(400).json({ error: 'invalid token' });
  }
  TOKENS.add(token);
  persistTokens();
  res.json({ ok: true, count: TOKENS.size });
});

// Unregister (optional)
app.post('/unregister-token', requireSecret, (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });
  TOKENS.delete(token);
  persistTokens();
  res.json({ ok: true, count: TOKENS.size });
});

// Manual trigger for testing
app.post('/test-push', requireSecret, async (req, res) => {
  const { title = 'Test', body = 'Hello from server' } = req.body || {};
  const report = await sendPushToAll({ title, body });
  res.json(report);
});

// Fetch Fear & Greed from CMC
async function fetchFearGreed() {
  const url = 'https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest';
  const res = await fetch(url, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } });
  if (!res.ok) throw new Error(`CMC HTTP ${res.status}`);
  const json = await res.json();
  const value = Number(json?.data?.value);
  if (Number.isNaN(value)) throw new Error('CMC value is NaN');
  return value;
}

async function sendPushToAll({ title, body }) {
  if (TOKENS.size === 0) return { sent: 0, tokens: 0 };

  // Expo limits to 100 per request; we’ll batch just in case
  const batchSize = 100;
  const arr = [...TOKENS];
  let sent = 0;
  for (let i = 0; i < arr.length; i += batchSize) {
    const chunk = arr.slice(i, i + batchSize);
    const payload = chunk.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      priority: 'high',
    }));

    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // Expo returns an array of tickets
    if (!resp.ok) {
      console.error('Expo push error HTTP', resp.status);
      continue;
    }
    const json = await resp.json();
    // You can parse tickets here if you want (not strictly needed to deliver)
    sent += chunk.length;
  }

  return { sent, tokens: TOKENS.size };
}

// Scheduled job
// Scheduled job
cron.schedule(
  CHECK_INTERVAL_CRON,
  async () => {
    try {
      const value = await fetchFearGreed();
      console.log(`[CRON] Fear & Greed index: ${value}`);
      const threshold = Number(FNG_THRESHOLD);

      if (value > 80) {
        const title = '🚀 Extreme Greed Alert';
        const body = `Fear & Greed Index is very high (${value}). Market may be overheated.`;
        const r = await sendPushToAll({ title, body });
        console.log(`[CRON] Pushed (greed) to ${r.sent}/${r.tokens}`);
      } else if (value < 30) {
        const title = '📉 Caution Alert';
        const body = `Fear & Greed Index is below (${value}). Possible market caution.`;
        const r = await sendPushToAll({ title, body });
        console.log(`[CRON] Pushed (fear) to ${r.sent}/${r.tokens}`);
      }
    } catch (e) {
      console.error('[CRON] Error:', e.message);
    }
  },
  {
    timezone: 'Asia/Ho_Chi_Minh', // <-- Set timezone to Vietnam
  }
);


app.listen(PORT, () => {
  console.log(`Push service listening on :${PORT}`);
});
