// Fetches SPCX price data from Yahoo Finance's chart API and merges it into
// data/history.json, which is the site's database. Runs locally and in CI.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SYMBOL = "SPCX";
const OUT = new URL("../data/history.json", import.meta.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) spcx-tracker/1.0";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

// Intraday points older than this are dropped; daily candles are kept forever.
const INTRADAY_KEEP_DAYS = 60;

async function chart(params, attempt = 0) {
  const host = HOSTS[attempt % HOSTS.length];
  const url = `https://${host}/v8/finance/chart/${SYMBOL}?${params}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.description || "empty result");
    return result;
  } catch (err) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      return chart(params, attempt + 1);
    }
    throw err;
  }
}

const r2 = n => (n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100);

function mergeSeries(existing, incoming) {
  const byTs = new Map(existing.map(row => [row[0], row]));
  for (const row of incoming) byTs.set(row[0], row);
  return [...byTs.values()].sort((a, b) => a[0] - b[0]);
}

// Yahoo returns several sub-daily candles per date for young listings, and the
// current day's candle gets a fresh timestamp on every fetch. Collapse to one
// OHLC candle per exchange-local trading day, keyed by date, so the daily
// series stays clean across runs.
function collapseDaily(rows, gmtoffset) {
  const byDay = new Map();
  for (const [ts, o, h, l, c, v] of rows) {
    const day = Math.floor((ts + gmtoffset) / 86400);
    const cur = byDay.get(day);
    if (!cur) byDay.set(day, [ts, o, h, l, c, v]);
    else {
      cur[2] = Math.max(cur[2] ?? h, h ?? cur[2]);
      cur[3] = Math.min(cur[3] ?? l, l ?? cur[3]);
      cur[4] = c;
      cur[5] += v;
    }
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

function mergeDaily(existing, incoming, gmtoffset) {
  const byDay = new Map();
  for (const row of [...existing, ...collapseDaily(incoming, gmtoffset)]) {
    byDay.set(Math.floor((row[0] + gmtoffset) / 86400), row);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

function rowsFromResult(result, mode) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    rows.push(
      mode === "daily"
        ? [ts[i], r2(q.open?.[i]), r2(q.high?.[i]), r2(q.low?.[i]), r2(q.close[i]), q.volume?.[i] ?? 0]
        : [ts[i], r2(q.close[i]), q.volume?.[i] ?? 0]
    );
  }
  return rows;
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { daily: [], intraday: [] };
const seeding = prev.intraday.length === 0;

// Daily candles since IPO; intraday at 5m. On first run pull the whole month
// Yahoo allows; steady-state runs only need the last few days to fill gaps.
const [daily, intra] = await Promise.all([
  chart("range=max&interval=1d"),
  chart(`range=${seeding ? "1mo" : "5d"}&interval=5m&includePrePost=true`),
]);

const meta = intra.meta || daily.meta || {};
const cutoff = Math.floor(Date.now() / 1000) - INTRADAY_KEEP_DAYS * 86400;

const data = {
  symbol: SYMBOL,
  name: meta.longName || prev.name || SYMBOL,
  currency: meta.currency || "USD",
  exchange: meta.fullExchangeName || prev.exchange || "",
  updated: Math.floor(Date.now() / 1000),
  meta: {
    price: r2(meta.regularMarketPrice),
    previousClose: r2(meta.chartPreviousClose ?? meta.previousClose),
    dayHigh: r2(meta.regularMarketDayHigh),
    dayLow: r2(meta.regularMarketDayLow),
    volume: meta.regularMarketVolume ?? null,
    fiftyTwoWeekHigh: r2(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: r2(meta.fiftyTwoWeekLow),
    firstTradeDate: meta.firstTradeDate ?? prev.meta?.firstTradeDate ?? null,
    marketTime: meta.regularMarketTime ?? null,
    gmtoffset: meta.gmtoffset ?? -14400,
    tradingPeriods: meta.currentTradingPeriod ?? prev.meta?.tradingPeriods ?? null,
  },
  daily: mergeDaily(prev.daily, rowsFromResult(daily, "daily"), meta.gmtoffset ?? -14400),
  intraday: mergeSeries(prev.intraday, rowsFromResult(intra, "intraday")).filter(r => r[0] >= cutoff),
};

// Yahoo's chartPreviousClose is relative to the requested range, not to the
// last session — derive the true previous close from our own daily candles.
if (data.daily.length >= 2) {
  data.meta.previousClose = data.daily[data.daily.length - 2][4];
}

writeFileSync(OUT, JSON.stringify(data));
console.log(
  `${SYMBOL} $${data.meta.price} | daily candles: ${data.daily.length} | ` +
  `intraday points: ${data.intraday.length}${seeding ? " (seeded)" : ""}`
);
