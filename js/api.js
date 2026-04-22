// ══════════════════════════════════════════════════════════════════════
//  api.js  — 데이터 패칭 레이어
//  주식: Python백엔드(HF) → Stooq → corsproxy→Yahoo → allorigins→Yahoo
//  환율: Frankfurter (CORS 허용)  /  금리: FRED → 더미 폴백
// ══════════════════════════════════════════════════════════════════════

import { STOCK_PROXY_URL, SUPABASE_ANON_KEY, FRED_API_KEY, PYTHON_API_URL } from './config.js';

// ── 캐시 (세션 내 중복 요청 방지) ──────────────────────────────────
const _cache = new Map();
function cacheKey(...args) { return args.join('|'); }
function fromCache(key) { const v = _cache.get(key); if (v && Date.now() - v.ts < 300_000) return v.data; return null; }
function toCache(key, data) { _cache.set(key, { data, ts: Date.now() }); }

// ══════════════════════════════════════════════════════════════════════
//  주식 데이터
// ══════════════════════════════════════════════════════════════════════

export async function fetchOHLC(ticker, startDate, endDate = null) {
  const end   = endDate   ? new Date(endDate)   : new Date();
  const start = startDate ? new Date(startDate) : new Date(end - 365 * 86400_000);

  const p1 = Math.floor(start.getTime() / 1000);
  const p2 = Math.floor(end.getTime()   / 1000);
  const ck = cacheKey('ohlc', ticker, p1, p2);

  const cached = fromCache(ck);
  if (cached) return cached;

  const result = await _fetchViaProxy(ticker, p1, p2, '1d');
  toCache(ck, result);
  return result;
}

export async function fetchClose(ticker, startDate, endDate = null) {
  const ohlc = await fetchOHLC(ticker, startDate, endDate);
  return { dates: ohlc.dates, closes: ohlc.closes };
}

// ── Stooq 티커 변환 ─────────────────────────────────────────────────
function _toStooqTicker(ticker) {
  if (ticker.endsWith('.KS') || ticker.endsWith('.KQ'))
    return ticker.replace(/\.(KS|KQ)$/i, '').toLowerCase() + '.kr';
  if (ticker === 'ETH-USD') return 'eth.v';
  if (ticker === 'BTC-USD') return 'btc.v';
  return ticker.toLowerCase() + '.us';
}

function _parseStooqCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2 || lines[1].trim() === '') throw new Error('Stooq: 데이터 없음');
  const clean = v => { const n = parseFloat(v); return isNaN(n) ? null : +n.toFixed(4); };
  const rows = lines.slice(1).map(l => l.split(','));
  return {
    dates:   rows.map(r => r[0]),
    opens:   rows.map(r => clean(r[1])),
    highs:   rows.map(r => clean(r[2])),
    lows:    rows.map(r => clean(r[3])),
    closes:  rows.map(r => clean(r[4])),
    volumes: rows.map(r => parseInt(r[5]) || 0),
  };
}

// ── 데이터 소스 체인 ─────────────────────────────────────────────────
async function _fetchViaProxy(ticker, period1, period2, interval) {
  const st = _toStooqTicker(ticker);
  const d1 = new Date(period1 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  const d2 = new Date(period2 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  const stooqUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(st)}&d1=${d1}&d2=${d2}&i=d`;

  // ① corsproxy.io → Stooq (Stooq은 Yahoo보다 프록시 차단 없음)
  try {
    const resp = await fetch(
      `https://corsproxy.io/?url=${encodeURIComponent(stooqUrl)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) {
      const text = await resp.text();
      if (!text.startsWith('No data') && text.includes(',')) {
        const result = _parseStooqCSV(text);
        if (result.closes.some(v => v !== null)) return result;
      }
    }
  } catch (e) { console.warn('[api] corsproxy→Stooq 실패:', e.message); }

  // ② allorigins.win → Stooq
  try {
    const resp = await fetch(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (resp.ok) {
      const text = await resp.text();
      if (!text.startsWith('No data') && text.includes(',')) {
        const result = _parseStooqCSV(text);
        if (result.closes.some(v => v !== null)) return result;
      }
    }
  } catch (e) { console.warn('[api] allorigins→Stooq 실패:', e.message); }

  // ③ Python 백엔드 (Render.com — 슬립 시 5초 타임아웃 후 스킵)
  if (PYTHON_API_URL && !PYTHON_API_URL.includes('YOUR-APP')) {
    try {
      const s = new Date(period1 * 1000).toISOString().split('T')[0];
      const e = new Date(period2 * 1000).toISOString().split('T')[0];
      const resp = await fetch(
        `${PYTHON_API_URL}/stock?ticker=${encodeURIComponent(ticker)}&start=${s}&end=${e}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (resp.ok) {
        const d = await resp.json();
        return { dates: d.dates, opens: d.opens, highs: d.highs,
                 lows: d.lows, closes: d.closes, volumes: d.volumes };
      }
    } catch { /* Render 슬립 상태 — 다음 소스로 폴백 */ }
  }

  // ④ corsproxy.io → Yahoo Finance
  const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=${interval}`;
  try {
    const resp = await fetch(
      `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) return _parseYahoo(await resp.json());
  } catch {}

  // ④ allorigins.win → Yahoo Finance (최후)
  try {
    const resp = await fetch(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (resp.ok) return _parseYahoo(await resp.json());
  } catch {}

  throw new Error(`${ticker}: 모든 데이터 소스 실패`);
}

function _parseYahoo(raw) {
  const r = raw?.chart?.result?.[0];
  if (!r) throw new Error('Yahoo Finance: 데이터 없음');
  const timestamps = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const clean = arr => arr.map(v => (v == null || isNaN(v) ? null : +v.toFixed(4)));
  return {
    dates:   timestamps.map(t => new Date(t * 1000).toISOString().split('T')[0]),
    opens:   clean(q.open   || []),
    highs:   clean(q.high   || []),
    lows:    clean(q.low    || []),
    closes:  clean(q.close  || []),
    volumes: (q.volume || []).map(v => v ?? 0),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  환율  — Frankfurter (frankfurter.dev — CORS 허용)
// ══════════════════════════════════════════════════════════════════════

const FX_BASE = 'https://api.frankfurter.dev';

export async function fetchFXRates(base = 'USD', targets = ['KRW', 'EUR', 'JPY', 'CNY']) {
  const ck = cacheKey('fx', base, targets.join(','));
  const cached = fromCache(ck);
  if (cached) return cached;

  try {
    const resp = await fetch(`${FX_BASE}/v1/latest?base=${base}&symbols=${targets.join(',')}`,
      { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = await resp.json();
      toCache(ck, data.rates);
      return data.rates;
    }
  } catch {}

  // fallback: frankfurter.app
  try {
    const resp = await fetch(
      `https://api.frankfurter.app/latest?from=${base}&to=${targets.join(',')}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      toCache(ck, data.rates);
      return data.rates;
    }
  } catch {}

  return {};
}

export async function fetchFXHistory(from = 'USD', to = 'KRW', days = 90) {
  const ck = cacheKey('fxhist', from, to, days);
  const cached = fromCache(ck);
  if (cached) return cached;

  const end   = new Date();
  const start = new Date(end - days * 86400_000);
  const endStr   = end.toISOString().split('T')[0];
  const startStr = start.toISOString().split('T')[0];

  try {
    const resp = await fetch(
      `${FX_BASE}/v1/${startStr}..${endStr}?base=${from}&symbols=${to}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const dates  = Object.keys(data.rates).sort();
      const values = dates.map(d => data.rates[d][to]);
      const result = { dates, values };
      toCache(ck, result);
      return result;
    }
  } catch {}

  // fallback: frankfurter.app
  try {
    const resp = await fetch(
      `https://api.frankfurter.app/${startStr}..${endStr}?from=${from}&to=${to}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const dates  = Object.keys(data.rates).sort();
      const values = dates.map(d => data.rates[d][to]);
      const result = { dates, values };
      toCache(ck, result);
      return result;
    }
  } catch {}

  return { dates: [], values: [] };
}

// ══════════════════════════════════════════════════════════════════════
//  금리 / 레포  — FRED API (브라우저 직접 호출 불가 → 더미 폴백)
// ══════════════════════════════════════════════════════════════════════

export async function fetchFRED(seriesId, limit = 60) {
  const ck = cacheKey('fred', seriesId, limit);
  const cached = fromCache(ck);
  if (cached) return cached;

  // FRED는 브라우저에서 CORS 차단 → Python 백엔드로 프록시 시도
  if (PYTHON_API_URL && !PYTHON_API_URL.includes('YOUR-APP')) {
    try {
      const resp = await fetch(
        `${PYTHON_API_URL}/fred?series_id=${seriesId}&limit=${limit}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (resp.ok) {
        const data = await resp.json();
        toCache(ck, data);
        return data;
      }
    } catch { /* Render 슬립 — 더미 폴백 */ }
  }

  // 백엔드 없으면 더미 데이터
  return _fredDummy(seriesId);
}

function _fredDummy(seriesId) {
  const defaults = {
    'FEDFUNDS': 4.33, 'DFF': 4.33, 'SOFR': 4.31, 'IORB': 4.40,
    'GS10': 4.25, 'GS2': 4.10, 'M2SL': 21500, 'VIXCLS': 22.0,
  };
  const val = defaults[seriesId] ?? 0;
  const dates  = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    return d.toISOString().split('T')[0];
  });
  const values = dates.map(() => +(val + (Math.random() - 0.5) * 0.2).toFixed(2));
  return { dates, values, latest: val, isDummy: true };
}

// ══════════════════════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════════════════════

export async function fetchLatestPrices(tickers) {
  const results = {};
  await Promise.allSettled(
    tickers.map(async t => {
      try {
        const { closes, dates } = await fetchClose(t, null, null);
        const validIdx = [...closes].reverse().findIndex(v => v !== null);
        results[t] = validIdx >= 0
          ? { price: closes[closes.length - 1 - validIdx], date: dates[dates.length - 1 - validIdx] }
          : null;
      } catch { results[t] = null; }
    })
  );
  return results;
}

export async function fetchMultiClose(tickers, startDate, endDate = null) {
  const results = {};
  await Promise.allSettled(
    tickers.map(async t => {
      try { results[t] = await fetchClose(t, startDate, endDate); }
      catch (e) { results[t] = null; console.warn(`[api] ${t} fetch error:`, e.message); }
    })
  );
  return results;
}

window._ttApi = { fetchOHLC, fetchClose, fetchFXRates, fetchFXHistory, fetchFRED, fetchLatestPrices, fetchMultiClose };
