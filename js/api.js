// ══════════════════════════════════════════════════════════════════════
//  api.js  — 데이터 패칭 레이어
//  Yahoo Finance → Supabase Edge Function 프록시 경유
//  매크로 데이터: Frankfurter (환율), FRED (금리/레포)
// ══════════════════════════════════════════════════════════════════════

import { STOCK_PROXY_URL, SUPABASE_ANON_KEY, FRED_API_KEY } from './config.js';

// ── 캐시 (세션 내 중복 요청 방지) ──────────────────────────────────
const _cache = new Map();
function cacheKey(...args) { return args.join('|'); }
function fromCache(key) { const v = _cache.get(key); if (v && Date.now() - v.ts < 300_000) return v.data; return null; }
function toCache(key, data) { _cache.set(key, { data, ts: Date.now() }); }

// ══════════════════════════════════════════════════════════════════════
//  주식 데이터  (Supabase Edge Function → Yahoo Finance)
// ══════════════════════════════════════════════════════════════════════

/**
 * fetchOHLC(ticker, startDate, endDate)
 * → { dates: string[], opens, highs, lows, closes, volumes }
 *
 * startDate / endDate : 'YYYY-MM-DD'  (endDate 생략 시 오늘)
 */
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

/** 주가 시계열만 필요할 때 편의 함수 */
export async function fetchClose(ticker, startDate, endDate = null) {
  const ohlc = await fetchOHLC(ticker, startDate, endDate);
  return { dates: ohlc.dates, closes: ohlc.closes };
}

// ── 실제 Edge Function 호출 ─────────────────────────────────────────
async function _fetchViaProxy(ticker, period1, period2, interval) {
  const headers = {
    'Content-Type': 'application/json',
    ...(SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_ANON_KEY'
      ? { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY }
      : {}),
  };

  // Supabase 미설정 → Yahoo Finance 직접 시도 (CORS 허용 여부에 따라)
  const useProxy = SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_ANON_KEY';

  let raw;
  if (useProxy) {
    const resp = await fetch(STOCK_PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticker, period1, period2, interval }),
    });
    raw = await resp.json();
  } else {
    // 직접 Yahoo Finance 시도 (일부 환경에서 CORS 문제 발생 가능)
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=${interval}&events=div,splits`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    raw = await resp.json();
  }

  return _parseYahoo(raw);
}

function _parseYahoo(raw) {
  const r = raw?.chart?.result?.[0];
  if (!r) throw new Error('Yahoo Finance: 데이터 없음');

  const timestamps = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const dates  = timestamps.map(t => new Date(t * 1000).toISOString().split('T')[0]);
  const opens  = q.open   || [];
  const highs  = q.high   || [];
  const lows   = q.low    || [];
  const closes = q.close  || [];
  const volumes = q.volume || [];

  // NaN 정리
  const clean = arr => arr.map(v => (v == null || isNaN(v) ? null : +v.toFixed(4)));
  return {
    dates,
    opens:   clean(opens),
    highs:   clean(highs),
    lows:    clean(lows),
    closes:  clean(closes),
    volumes: volumes.map(v => v ?? 0),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  환율  — Frankfurter API (무료, CORS 허용)
// ══════════════════════════════════════════════════════════════════════

/** 현재 환율: 기준 통화 → 대상 통화 목록 */
export async function fetchFXRates(base = 'USD', targets = ['KRW', 'EUR', 'JPY', 'CNY']) {
  const ck = cacheKey('fx', base, targets.join(','));
  const cached = fromCache(ck);
  if (cached) return cached;

  const url = `https://api.frankfurter.app/latest?from=${base}&to=${targets.join(',')}`;
  const resp = await fetch(url);
  const data = await resp.json();
  toCache(ck, data.rates);
  return data.rates;
}

/** 환율 시계열 (최근 N일) */
export async function fetchFXHistory(from = 'USD', to = 'KRW', days = 90) {
  const ck = cacheKey('fxhist', from, to, days);
  const cached = fromCache(ck);
  if (cached) return cached;

  const end   = new Date();
  const start = new Date(end - days * 86400_000);
  const endStr   = end.toISOString().split('T')[0];
  const startStr = start.toISOString().split('T')[0];

  const url = `https://api.frankfurter.app/${startStr}..${endStr}?from=${from}&to=${to}`;
  const resp = await fetch(url);
  const data = await resp.json();

  const dates  = Object.keys(data.rates).sort();
  const values = dates.map(d => data.rates[d][to]);
  const result = { dates, values };
  toCache(ck, result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  금리 / 레포  — FRED API
// ══════════════════════════════════════════════════════════════════════

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * FRED 시계열 조회
 * seriesId 예: 'FEDFUNDS' | 'DFF' | 'SOFR' | 'IORB' | 'GS10' | 'M2SL'
 */
export async function fetchFRED(seriesId, limit = 60) {
  if (!FRED_API_KEY || FRED_API_KEY === 'YOUR_FRED_API_KEY') {
    console.warn('FRED_API_KEY 미설정 — 더미 데이터 반환');
    return _fredDummy(seriesId);
  }

  const ck = cacheKey('fred', seriesId, limit);
  const cached = fromCache(ck);
  if (cached) return cached;

  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  const resp = await fetch(url);
  const data = await resp.json();

  const obs    = (data.observations || []).filter(o => o.value !== '.').reverse();
  const dates  = obs.map(o => o.date);
  const values = obs.map(o => parseFloat(o.value));
  const result = { dates, values, latest: values[values.length - 1] };
  toCache(ck, result);
  return result;
}

function _fredDummy(seriesId) {
  const defaults = {
    'FEDFUNDS': 5.33, 'DFF': 5.33, 'SOFR': 5.31, 'IORB': 5.40,
    'GS10': 4.25, 'GS2': 4.80, 'M2SL': 21000, 'VIXCLS': 18.5,
  };
  const val = defaults[seriesId] ?? 0;
  const dates  = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    return d.toISOString().split('T')[0];
  });
  const values = dates.map(() => val + (Math.random() - 0.5) * 0.1);
  return { dates, values, latest: val, isDummy: true };
}

// ══════════════════════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════════════════════

/** 여러 티커의 최신 종가만 빠르게 가져오기 */
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

/** 복수 티커 병렬 조회 */
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

// window에 노출 (비모듈 스크립트에서도 접근 가능하도록)
window._ttApi = { fetchOHLC, fetchClose, fetchFXRates, fetchFXHistory, fetchFRED, fetchLatestPrices, fetchMultiClose };