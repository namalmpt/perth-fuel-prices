const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

// Load .env.market if it exists
const envFile = path.join(__dirname, '.env.market');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      if (key && !process.env[key]) process.env[key] = vals.join('=');
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3002;

// ── IG API Configuration ──────────────────────────────────────────────
const IG_API_URL = process.env.IG_API_URL || 'https://demo-api.ig.com/gateway/deal';
const IG_API_KEY = process.env.IG_API_KEY || '';
const IG_USERNAME = process.env.IG_USERNAME || '';
const IG_PASSWORD = process.env.IG_PASSWORD || '';

// ── VAPID Push Notification Keys ──────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:test@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ── Market Definitions ────────────────────────────────────────────────
const MARKETS = [
  {
    id: 'asx200',
    name: 'ASX 200',
    epic: process.env.ASX_EPIC || 'IX.D.ASX.MONTH2.IP',
    timezone: 'Australia/Sydney',
    openHourUTC: 0,   // 10:00 AEDT = 00:00 UTC (approx)
    closeHourUTC: 6,   // 16:00 AEDT = 06:00 UTC
  },
  {
    id: 'sp500',
    name: 'S&P 500',
    epic: process.env.SP500_EPIC || 'IX.D.SPTRD.MONTH1.IP',
    timezone: 'America/New_York',
    openHourUTC: 14,  // 09:30 ET = 14:30 UTC
    closeHourUTC: 21, // 16:00 ET = 21:00 UTC
  },
];

// ── State ─────────────────────────────────────────────────────────────
let igSession = { cst: null, securityToken: null, expiresAt: 0 };
let authFailCount = 0;
const AUTH_BACKOFF_MAX = 5; // stop retrying after 5 consecutive failures
const priceCache = new Map();   // epic -> { candles5m, candles1h, candles1d, currentPrice, lastUpdate }
const marketState = new Map();  // epic -> { score, level, signals, lastUpdate }
const alerts = [];
const pushSubscriptions = new Map(); // endpoint -> subscription
let pollingTimer = null;

// ── IG API Authentication ─────────────────────────────────────────────
async function authenticate() {
  const url = new URL(IG_API_URL + '/session');
  const body = JSON.stringify({
    identifier: IG_USERNAME,
    password: IG_PASSWORD,
  });

  console.log(`[IG] Authenticating as ${IG_USERNAME} to ${url.hostname}${url.pathname}`);
  console.log(`[IG] API key: ${IG_API_KEY.slice(0, 8)}...${IG_API_KEY.slice(-4)} (${IG_API_KEY.length} chars)`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json; charset=UTF-8',
        'X-IG-API-KEY': IG_API_KEY,
        'Version': '2',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          igSession.cst = res.headers['cst'];
          igSession.securityToken = res.headers['x-security-token'];
          igSession.expiresAt = Date.now() + 6 * 60 * 60 * 1000; // 6 hours
          authFailCount = 0;
          console.log('[IG] Authenticated successfully');
          resolve(JSON.parse(data));
        } else {
          authFailCount++;
          console.error(`[IG] Auth failed: ${res.statusCode}`, data);
          if (authFailCount >= AUTH_BACKOFF_MAX) {
            console.error('[IG] Too many auth failures. Polling paused. Check your API key and credentials.');
          }
          reject(new Error(`Auth failed: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Auth timeout')); });
    req.write(body);
    req.end();
  });
}

async function ensureAuth() {
  if (!igSession.cst || Date.now() > igSession.expiresAt - 60000) {
    await authenticate();
  }
}

function igFetch(apiPath, version = '3') {
  return new Promise(async (resolve, reject) => {
    try {
      await ensureAuth();
    } catch (e) {
      return reject(e);
    }
    const url = new URL(IG_API_URL + apiPath);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'X-IG-API-KEY': IG_API_KEY,
        'CST': igSession.cst,
        'X-SECURITY-TOKEN': igSession.securityToken,
        'Version': version,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else {
          console.error(`[IG] ${apiPath} failed: ${res.statusCode}`);
          reject(new Error(`IG API ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

// ── Price Data Fetching ───────────────────────────────────────────────
async function fetchCandles(epic, resolution, max = 200) {
  const data = await igFetch(`/prices/${epic}?resolution=${resolution}&max=${max}&pageSize=${max}`, '3');
  if (!data.prices) return [];
  return data.prices.map(p => ({
    timestamp: new Date(p.snapshotTimeUTC || p.snapshotTime).getTime(),
    open: (p.openPrice.bid + p.openPrice.ask) / 2,
    high: (p.highPrice.bid + p.highPrice.ask) / 2,
    low: (p.lowPrice.bid + p.lowPrice.ask) / 2,
    close: (p.closePrice.bid + p.closePrice.ask) / 2,
    volume: p.lastTradedVolume || 0,
  }));
}

async function fetchCurrentPrice(epic) {
  const data = await igFetch(`/markets/${epic}`, '3');
  return {
    bid: data.snapshot.bid,
    ask: data.snapshot.offer,
    mid: (data.snapshot.bid + data.snapshot.offer) / 2,
    high: data.snapshot.high,
    low: data.snapshot.low,
    change: data.snapshot.netChange,
    changePct: data.snapshot.percentageChange,
    marketStatus: data.snapshot.marketStatus,
  };
}

async function searchMarkets(term) {
  const data = await igFetch(`/markets?searchTerm=${encodeURIComponent(term)}`, '1');
  return data.markets || [];
}

async function fetchAndUpdateCandles(epic) {
  const [candles5m, candles1h, candles1d, currentPrice] = await Promise.all([
    fetchCandles(epic, 'MINUTE_5', 200).catch(() => null),
    fetchCandles(epic, 'HOUR', 200).catch(() => null),
    fetchCandles(epic, 'DAY', 200).catch(() => null),
    fetchCurrentPrice(epic).catch(() => null),
  ]);

  const existing = priceCache.get(epic) || {};
  priceCache.set(epic, {
    candles5m: candles5m || existing.candles5m || [],
    candles1h: candles1h || existing.candles1h || [],
    candles1d: candles1d || existing.candles1d || [],
    currentPrice: currentPrice || existing.currentPrice || null,
    lastUpdate: Date.now(),
  });
}

// ── Technical Indicator Functions ─────────────────────────────────────

function calcEMA(data, period) {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { sma.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    sma.push(sum / period);
  }
  return sma;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0, series: [] };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  const last = closes.length - 1;
  return {
    macd: macdLine[last],
    signal: signalLine[last],
    histogram: histogram[last],
    series: macdLine.map((v, i) => ({ macd: v, signal: signalLine[i], histogram: v - signalLine[i] })),
  };
}

function detectMACDDivergence(closes, macdSeries, lookback = 30) {
  if (closes.length < lookback || macdSeries.length < lookback) return { found: false, strength: 0 };
  const len = closes.length;
  const start = len - lookback;

  // Find swing lows in price and MACD
  const priceLows = [];
  const macdLows = [];
  for (let i = start + 2; i < len - 2; i++) {
    if (closes[i] < closes[i - 1] && closes[i] < closes[i - 2] &&
        closes[i] < closes[i + 1] && closes[i] < closes[i + 2]) {
      priceLows.push({ idx: i, val: closes[i] });
    }
    if (macdSeries[i].macd < macdSeries[i - 1].macd && macdSeries[i].macd < macdSeries[i + 1].macd) {
      macdLows.push({ idx: i, val: macdSeries[i].macd });
    }
  }

  // Bullish divergence: price lower low, MACD higher low
  if (priceLows.length >= 2 && macdLows.length >= 2) {
    const pL1 = priceLows[priceLows.length - 2], pL2 = priceLows[priceLows.length - 1];
    const mL1 = macdLows[macdLows.length - 2], mL2 = macdLows[macdLows.length - 1];
    if (pL2.val < pL1.val && mL2.val > mL1.val) {
      const strength = Math.min(1, Math.abs(mL2.val - mL1.val) / (Math.abs(mL1.val) || 1));
      return { found: true, strength };
    }
  }
  return { found: false, strength: 0 };
}

function calcBollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5 };
  const sma = calcSMA(closes, period);
  const last = closes.length - 1;
  const mid = sma[last];
  if (mid === null) return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5 };

  let sumSq = 0;
  for (let i = last - period + 1; i <= last; i++) {
    sumSq += (closes[i] - mid) ** 2;
  }
  const stddev = Math.sqrt(sumSq / period);
  const upper = mid + mult * stddev;
  const lower = mid - mult * stddev;
  const bandwidth = (upper - lower) / mid;
  const percentB = (closes[last] - lower) / (upper - lower || 1);

  // Calculate average bandwidth for squeeze detection
  let avgBandwidth = bandwidth;
  if (closes.length >= period * 2) {
    let bwSum = 0, bwCount = 0;
    for (let i = period; i < closes.length; i++) {
      const s = sma[i];
      if (s === null) continue;
      let sq = 0;
      for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - s) ** 2;
      const sd = Math.sqrt(sq / period);
      bwSum += (s + mult * sd - (s - mult * sd)) / s;
      bwCount++;
    }
    avgBandwidth = bwCount > 0 ? bwSum / bwCount : bandwidth;
  }

  return { upper, middle: mid, lower, bandwidth, percentB, squeeze: bandwidth < avgBandwidth * 0.75 };
}

function calcVolumeSignal(candles, lookback = 20) {
  if (candles.length < lookback) return { spike: false, declining: false, score: 0 };
  const vols = candles.map(c => c.volume);
  const last = vols.length - 1;
  const start = Math.max(0, last - lookback);
  let avgVol = 0;
  for (let i = start; i < last; i++) avgVol += vols[i];
  avgVol /= (last - start);

  const spike = vols[last] > avgVol * 2 ||
    (last >= 1 && vols[last - 1] > avgVol * 2) ||
    (last >= 2 && vols[last - 2] > avgVol * 2);

  let declining = false;
  if (last >= 3) {
    declining = vols[last] < vols[last - 1] && vols[last - 1] < vols[last - 2];
  }

  let score = 0;
  if (spike) score = declining ? 1 : 0.53;
  return { spike, declining, score };
}

function calcSupportLevels(candles1d) {
  if (candles1d.length < 20) return { levels: [], nearSupport: false, score: 0 };
  const closes = candles1d.map(c => c.close);
  const lows = candles1d.map(c => c.low);
  const currentPrice = closes[closes.length - 1];
  const levels = [];

  // 52-week low (approximately 252 trading days)
  const yearLows = lows.slice(-Math.min(252, lows.length));
  const yearLow = Math.min(...yearLows);
  levels.push({ type: '52wk-low', price: yearLow });

  // Round number support
  const roundInterval = currentPrice > 5000 ? 500 : currentPrice > 1000 ? 100 : 50;
  const nearestRound = Math.floor(currentPrice / roundInterval) * roundInterval;
  levels.push({ type: 'round', price: nearestRound });

  // Swing lows (local minima with 5-bar lookback)
  for (let i = 5; i < lows.length - 5; i++) {
    const isSwingLow = lows[i] <= Math.min(...lows.slice(i - 5, i)) &&
                       lows[i] <= Math.min(...lows.slice(i + 1, i + 6));
    if (isSwingLow) levels.push({ type: 'swing', price: lows[i] });
  }

  // Check proximity (within 1%)
  let nearSupport = false;
  let minDist = Infinity;
  for (const lvl of levels) {
    const dist = Math.abs(currentPrice - lvl.price) / currentPrice;
    if (dist < minDist) minDist = dist;
    if (dist < 0.01) nearSupport = true;
  }

  const atYearLow = Math.abs(currentPrice - yearLow) / currentPrice < 0.01;
  let score = 0;
  if (atYearLow) score = 1;
  else if (nearSupport) score = 0.7;
  else if (minDist < 0.02) score = 0.3;

  return { levels, nearSupport, score };
}

function calcROC(closes, period = 10) {
  if (closes.length < period + 1) return 0;
  const last = closes.length - 1;
  return ((closes[last] - closes[last - period]) / closes[last - period]) * 100;
}

function detectMomentumDivergence(closes, period = 10, lookback = 30) {
  if (closes.length < lookback + period) return { found: false, strength: 0 };
  const len = closes.length;
  const start = len - lookback;

  // Calculate ROC series
  const rocSeries = [];
  for (let i = start; i < len; i++) {
    if (i >= period) {
      rocSeries.push({ idx: i, roc: ((closes[i] - closes[i - period]) / closes[i - period]) * 100 });
    }
  }

  // Find swing lows in price and ROC
  const priceLows = [];
  const rocLows = [];
  for (let i = 2; i < rocSeries.length - 2; i++) {
    const ci = rocSeries[i].idx;
    if (closes[ci] < closes[ci - 1] && closes[ci] < closes[ci - 2] &&
        closes[ci] < closes[ci + 1] && closes[ci] < closes[ci + 2]) {
      priceLows.push({ idx: ci, val: closes[ci] });
    }
    if (rocSeries[i].roc < rocSeries[i - 1].roc && rocSeries[i].roc < rocSeries[i + 1].roc) {
      rocLows.push({ idx: ci, val: rocSeries[i].roc });
    }
  }

  if (priceLows.length >= 2 && rocLows.length >= 2) {
    const pL1 = priceLows[priceLows.length - 2], pL2 = priceLows[priceLows.length - 1];
    const rL1 = rocLows[rocLows.length - 2], rL2 = rocLows[rocLows.length - 1];
    if (pL2.val < pL1.val && rL2.val > rL1.val) {
      return { found: true, strength: Math.min(1, Math.abs(rL2.val - rL1.val) / 5) };
    }
  }
  return { found: false, strength: 0 };
}

// ── Composite Bottom Score ────────────────────────────────────────────
function calcBottomScore(candles5m, candles1h, candles1d) {
  const signals = [];
  let totalScore = 0;

  const closes1d = candles1d.map(c => c.close);
  const closes1h = candles1h.map(c => c.close);

  // RSI Daily (weight: 20)
  const rsiDaily = calcRSI(closes1d);
  if (rsiDaily < 20) { totalScore += 20; signals.push({ name: 'RSI Daily', value: rsiDaily.toFixed(1), points: 20, detail: 'Deeply oversold' }); }
  else if (rsiDaily < 30) { totalScore += 15; signals.push({ name: 'RSI Daily', value: rsiDaily.toFixed(1), points: 15, detail: 'Oversold' }); }

  // RSI Hourly (weight: 10)
  const rsiHourly = calcRSI(closes1h);
  if (rsiHourly < 20) { totalScore += 10; signals.push({ name: 'RSI Hourly', value: rsiHourly.toFixed(1), points: 10, detail: 'Deeply oversold' }); }
  else if (rsiHourly < 30) { totalScore += 7; signals.push({ name: 'RSI Hourly', value: rsiHourly.toFixed(1), points: 7, detail: 'Oversold' }); }

  // MACD Divergence (weight: 20)
  const macdDaily = calcMACD(closes1d);
  const macdDivDaily = detectMACDDivergence(closes1d, macdDaily.series);
  if (macdDivDaily.found) { totalScore += 20; signals.push({ name: 'MACD Divergence (Daily)', value: 'Bullish', points: 20, detail: `Strength: ${(macdDivDaily.strength * 100).toFixed(0)}%` }); }
  else {
    const macdHourly = calcMACD(closes1h);
    const macdDivHourly = detectMACDDivergence(closes1h, macdHourly.series);
    if (macdDivHourly.found) { totalScore += 12; signals.push({ name: 'MACD Divergence (Hourly)', value: 'Bullish', points: 12, detail: `Strength: ${(macdDivHourly.strength * 100).toFixed(0)}%` }); }
  }

  // Bollinger Bands (weight: 10)
  const bb = calcBollinger(closes1d);
  if (bb.percentB < 0 && bb.squeeze) { totalScore += 10; signals.push({ name: 'Bollinger Band', value: `%B: ${bb.percentB.toFixed(2)}`, points: 10, detail: 'Below lower band + squeeze' }); }
  else if (bb.percentB < 0) { totalScore += 7; signals.push({ name: 'Bollinger Band', value: `%B: ${bb.percentB.toFixed(2)}`, points: 7, detail: 'Below lower band' }); }

  // Volume Pattern (weight: 15)
  const vol = calcVolumeSignal(candles1d);
  if (vol.spike && vol.declining) { totalScore += 15; signals.push({ name: 'Volume', value: 'Spike + Declining', points: 15, detail: 'Capitulation pattern' }); }
  else if (vol.spike) { totalScore += 8; signals.push({ name: 'Volume', value: 'Spike', points: 8, detail: 'Volume spike detected' }); }

  // Support Levels (weight: 10)
  const support = calcSupportLevels(candles1d);
  if (support.score >= 1) { totalScore += 10; signals.push({ name: 'Support', value: 'At 52wk Low', points: 10, detail: 'Price at 52-week low' }); }
  else if (support.score >= 0.7) { totalScore += 7; signals.push({ name: 'Support', value: 'Near Level', points: 7, detail: 'Near support level' }); }

  // Momentum Divergence (weight: 15)
  const momDiv = detectMomentumDivergence(closes1d);
  if (momDiv.found) { totalScore += 15; signals.push({ name: 'Momentum', value: 'Divergence', points: 15, detail: `Selling deceleration (${(momDiv.strength * 100).toFixed(0)}%)` }); }

  // Determine level
  let level = 'normal';
  if (totalScore >= 76) level = 'strong';
  else if (totalScore >= 51) level = 'alert';
  else if (totalScore >= 26) level = 'watch';

  // Add current indicator values for display
  const indicators = {
    rsiDaily, rsiHourly,
    macd: macdDaily,
    bollinger: bb,
    volume: vol,
    support,
    roc: calcROC(closes1d),
  };

  return { score: Math.min(100, totalScore), level, signals, indicators };
}

// ── Alert Management ──────────────────────────────────────────────────
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

function checkAndAlert(market, score, level, signals) {
  if (level === 'normal') return;

  // Check cooldown
  const recentAlert = alerts.find(a =>
    a.market === market.id &&
    Date.now() - a.timestamp < ALERT_COOLDOWN_MS
  );
  if (recentAlert && score - recentAlert.score < 15) return;

  const cached = priceCache.get(market.epic);
  const alert = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    market: market.id,
    marketName: market.name,
    score,
    level,
    signals,
    price: cached?.currentPrice?.mid || 0,
    acknowledged: false,
  };
  alerts.unshift(alert);
  if (alerts.length > 100) alerts.length = 100;

  console.log(`[ALERT] ${market.name}: Score ${score} (${level}) - ${signals.map(s => s.name).join(', ')}`);

  // Send push notifications
  if (level === 'alert' || level === 'strong') {
    sendPushToAll(alert);
  }
}

async function sendPushToAll(alert) {
  const payload = JSON.stringify({
    title: `${alert.level === 'strong' ? '🔴' : '🟠'} ${alert.marketName} Bottom Signal`,
    body: `Score: ${alert.score}/100 | Price: ${alert.price.toFixed(1)} | ${alert.signals.map(s => s.name).join(', ')}`,
    data: { url: '/market/' },
  });

  const deadEndpoints = [];
  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadEndpoints.push(endpoint);
      }
      console.error('[Push] Error:', err.message);
    }
  }
  deadEndpoints.forEach(ep => pushSubscriptions.delete(ep));
}

// ── Polling Loop ──────────────────────────────────────────────────────
function isMarketHours(market) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (market.openHourUTC < market.closeHourUTC) {
    return utcHour >= market.openHourUTC && utcHour < market.closeHourUTC;
  }
  return utcHour >= market.openHourUTC || utcHour < market.closeHourUTC;
}

function anyMarketOpen() {
  return MARKETS.some(m => isMarketHours(m));
}

async function pollMarkets() {
  if (!IG_API_KEY) {
    console.log('[Poll] No IG API key configured, skipping');
    return;
  }
  if (authFailCount >= AUTH_BACKOFF_MAX) {
    return; // Stop polling on persistent auth failure
  }

  for (const market of MARKETS) {
    try {
      await fetchAndUpdateCandles(market.epic);
      const cached = priceCache.get(market.epic);
      if (cached && cached.candles1d.length > 0) {
        const result = calcBottomScore(cached.candles5m, cached.candles1h, cached.candles1d);
        marketState.set(market.epic, {
          ...result,
          lastUpdate: Date.now(),
        });
        checkAndAlert(market, result.score, result.level, result.signals);
      }
    } catch (err) {
      console.error(`[Poll] Error for ${market.name}:`, err.message);
    }
  }
}

function startPolling() {
  console.log('[Poll] Starting market polling...');
  // Initial fetch
  pollMarkets();

  // Dynamic interval: 60s during market hours, 15min off-hours
  function scheduleNext() {
    const interval = anyMarketOpen() ? 60000 : 15 * 60000;
    pollingTimer = setTimeout(async () => {
      await pollMarkets();
      scheduleNext();
    }, interval);
  }
  scheduleNext();
}

// ── Express Setup ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public', 'market')));

// API: Market status
app.get('/api/market/status', (req, res) => {
  const result = MARKETS.map(m => {
    const state = marketState.get(m.epic) || { score: 0, level: 'normal', signals: [], indicators: {} };
    const cached = priceCache.get(m.epic);
    return {
      id: m.id,
      name: m.name,
      epic: m.epic,
      price: cached?.currentPrice || null,
      score: state.score,
      level: state.level,
      signals: state.signals,
      indicators: state.indicators,
      lastUpdate: state.lastUpdate || null,
      marketOpen: isMarketHours(m),
    };
  });
  res.json({ markets: result });
});

// API: Price history for charts
app.get('/api/market/history/:epic', (req, res) => {
  const cached = priceCache.get(req.params.epic);
  if (!cached) return res.status(404).json({ error: 'No data' });
  res.json({
    candles5m: cached.candles5m,
    candles1h: cached.candles1h,
    candles1d: cached.candles1d,
    lastUpdate: cached.lastUpdate,
  });
});

// API: Alert history
app.get('/api/market/alerts', (req, res) => {
  res.json({ alerts });
});

// API: Acknowledge alert
app.post('/api/market/alerts/:id/ack', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (alert) { alert.acknowledged = true; res.json({ ok: true }); }
  else res.status(404).json({ error: 'Not found' });
});

// API: Push subscription management
app.post('/api/market/subscribe', (req, res) => {
  const sub = req.body;
  if (sub && sub.endpoint) {
    pushSubscriptions.set(sub.endpoint, sub);
    console.log(`[Push] Subscription added (${pushSubscriptions.size} total)`);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'Invalid subscription' });
  }
});

app.delete('/api/market/subscribe', (req, res) => {
  const sub = req.body;
  if (sub && sub.endpoint) {
    pushSubscriptions.delete(sub.endpoint);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'Invalid subscription' });
  }
});

// API: Search IG markets
app.get('/api/market/search', async (req, res) => {
  try {
    const results = await searchMarkets(req.query.term || '');
    res.json({ markets: results.map(m => ({ epic: m.epic, name: m.instrumentName, type: m.instrumentType, status: m.marketStatus })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: VAPID public key
app.get('/api/market/vapid-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

// API: Test alert
app.post('/api/market/test-alert', (req, res) => {
  const testAlert = {
    id: Date.now().toString(36),
    timestamp: Date.now(),
    market: 'test',
    marketName: 'Test Market',
    score: 75,
    level: 'alert',
    signals: [{ name: 'Test Signal', value: 'Test', points: 75, detail: 'This is a test alert' }],
    price: 0,
    acknowledged: false,
  };
  alerts.unshift(testAlert);
  sendPushToAll(testAlert);
  res.json({ ok: true, alert: testAlert });
});

// API: Retry auth (resets backoff and tries again)
app.post('/api/market/retry-auth', async (req, res) => {
  authFailCount = 0;
  igSession = { cst: null, securityToken: null, expiresAt: 0 };
  try {
    await authenticate();
    pollMarkets();
    res.json({ ok: true, message: 'Authenticated successfully' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// API: Connection info
app.get('/api/market/connection', (req, res) => {
  res.json({
    apiUrl: IG_API_URL,
    hasApiKey: !!IG_API_KEY,
    username: IG_USERNAME,
    authenticated: !!igSession.cst && Date.now() < igSession.expiresAt,
    authFailCount,
    authPaused: authFailCount >= AUTH_BACKOFF_MAX,
  });
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'market', 'index.html'));
});

// ── Start Server ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Market Bottom Alert server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`IG API: ${IG_API_URL}`);
  console.log(`Markets: ${MARKETS.map(m => `${m.name} (${m.epic})`).join(', ')}`);
  if (!IG_API_KEY) {
    console.log('\n⚠️  No IG_API_KEY set. Set environment variables to enable live data.');
    console.log('   Required: IG_API_KEY, IG_USERNAME, IG_PASSWORD');
  }
  startPolling();
});
