// ══════════════════════════════════════════════════════════════════════
//  analysis.js  — 종목 선택 → 200일 차트 → 4모델 예측 → AI 보고서
// ══════════════════════════════════════════════════════════════════════

import { fetchOHLC } from './api.js';
import { ALL_STOCKS, DARK_LAYOUT, PLOTLY_CONFIG, GEMINI_API_KEY_DEFAULT } from './config.js';
import { calcMA, calcRSI, calcBollinger, granvilleSignal } from './technical.js';

// ── 통계 유틸 ─────────────────────────────────────────────────────

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}
function logReturns(closes) {
  return closes.map((v, i) => i === 0 ? 0 : Math.log(v / closes[i - 1])).slice(1);
}
function linReg(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0);
  const den = x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}
function businessDays(lastDate, n) {
  const dates = [], d = new Date(lastDate);
  while (dates.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// ══════════════════════════════════════════════════════════════════════
//  Model 1 — ARIMA(1,1,0)  : 평균 회귀형 단기 예측
//  AR(1) on log-differences.  phi > 0 → 추세 지속, phi < 0 → 회귀
// ══════════════════════════════════════════════════════════════════════
function forecastARIMA(closes, days) {
  const d = logReturns(closes);
  const mu = mean(d);

  // Yule-Walker: phi = Cov(d_t, d_{t-1}) / Var(d_t)
  const n = d.length;
  const cov = d.slice(1).reduce((s, v, i) => s + (v - mu) * (d[i] - mu), 0) / n;
  const vr  = d.reduce((s, v) => s + (v - mu) ** 2, 0) / n;
  const phi = vr ? Math.min(Math.max(cov / vr, -0.9), 0.9) : 0;

  const result = [];
  let price = closes[closes.length - 1];
  let prev  = d[d.length - 1];

  for (let t = 0; t < days; t++) {
    const r = mu + phi * (prev - mu);
    price = price * Math.exp(r);
    result.push(price);
    prev = r;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  Model 2 — LSTM  : EWA 기반 추세 추종 + 메모리 감쇠
//  단기 EWA(cell state)와 장기 추세를 가중 결합, 시간이 지날수록 감쇠
// ══════════════════════════════════════════════════════════════════════
function forecastLSTM(closes, days, span = 20) {
  const ret = logReturns(closes);
  const alpha = 2 / (span + 1);

  // Short-term EWA (cell state)
  let ewa = ret[0];
  for (let i = 1; i < ret.length; i++) ewa = alpha * ret[i] + (1 - alpha) * ewa;

  // Long-term trend EWA
  const la = 2 / (60 + 1);
  let lEwa = ret[0];
  for (let i = 1; i < ret.length; i++) lEwa = la * ret[i] + (1 - la) * lEwa;

  const result = [];
  let price = closes[closes.length - 1];
  let h = ewa;       // hidden state
  let c = lEwa;      // cell state (long-term memory)
  const recVol = std(ret.slice(-span));

  for (let t = 0; t < days; t++) {
    // forget gate: dampen memory over time
    const fg = 0.88 + 0.08 * Math.exp(-t / 15);
    // output: blend of short/long memory
    const r  = 0.65 * h + 0.35 * c;
    price = price * Math.exp(r);
    result.push(price);
    h = fg * h;
    c = 0.97 * c;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  Model 3 — Transformer  : 패턴 유사도 기반 어텐션 예측
//  최근 10일 패턴을 과거 전체와 코사인 유사도로 비교 → softmax 가중 예측
// ══════════════════════════════════════════════════════════════════════
function forecastTransformer(closes, days) {
  const ret = logReturns(closes);
  const n   = ret.length;
  const K   = 10; // query window

  const query = ret.slice(-K);

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // Collect historical windows with at least `days` future returns
  const candidates = [];
  for (let i = K; i <= n - days; i++) {
    const window = ret.slice(i - K, i);
    const score  = cosine(query, window);
    const future = ret.slice(i, i + days);
    candidates.push({ score, future });
  }

  if (!candidates.length) return forecastARIMA(closes, days); // fallback

  // Softmax attention (temperature = 8)
  const maxS  = Math.max(...candidates.map(c => c.score));
  const exps  = candidates.map(c => Math.exp((c.score - maxS) * 8));
  const sumE  = exps.reduce((a, b) => a + b, 0);
  const ws    = exps.map(v => v / sumE);

  // Weighted average future returns
  const fRet = Array.from({ length: days }, (_, t) =>
    candidates.reduce((s, c, i) => s + ws[i] * (c.future[t] ?? 0), 0)
  );

  const result = [];
  let price = closes[closes.length - 1];
  for (const r of fRet) { price = price * Math.exp(r); result.push(price); }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  Model 4 — Prophet  : 추세 + 주간 계절성 분해
//  최근 60일 OLS 추세 + 요일별 평균 수익률 보정
// ══════════════════════════════════════════════════════════════════════
function forecastProphet(closes, dates, days) {
  const n = closes.length;
  const logP = closes.map(v => Math.log(v));

  // Piecewise linear trend: fit on last 60 days
  const win = Math.min(60, n);
  const X = Array.from({ length: win }, (_, i) => i);
  const Y = logP.slice(-win);
  const { slope } = linReg(X, Y);

  // Weekly seasonality: average log-return by day-of-week
  const dowSum   = Array(7).fill(0);
  const dowCount = Array(7).fill(0);
  dates.forEach((d, i) => {
    if (i === 0) return;
    const dow = new Date(d).getDay();
    dowSum[dow]   += logP[i] - logP[i - 1];
    dowCount[dow] += 1;
  });
  const dowMu   = dowSum.map((v, i) => dowCount[i] ? v / dowCount[i] : 0);
  const overall = mean(dowMu.filter((_, i) => dowCount[i] > 0));
  const dowAdj  = dowMu.map(v => v - overall);

  // Residual noise floor
  const residuals = logP.slice(-win).map((v, i) => v - (logP[n - win] + slope * i));
  const resStd = std(residuals);

  const fcDates = businessDays(new Date(dates[dates.length - 1]), days);
  const result  = [];
  let price = closes[closes.length - 1];

  for (let t = 0; t < days; t++) {
    const dow    = new Date(fcDates[t]).getDay();
    const r      = slope + dowAdj[dow] * 0.4;
    price = price * Math.exp(r);
    result.push(price);
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  AI 보고서  (Gemini)
// ══════════════════════════════════════════════════════════════════════
async function generateReport(data, ticker) {
  const el = document.getElementById('ana-report-content');
  if (!el) return;
  el.innerHTML = '<span class="text-white/30 animate-pulse">보고서 생성 중...</span>';

  const apiKey = localStorage.getItem('tt_gemini_key') || GEMINI_API_KEY_DEFAULT;
  if (!apiKey) {
    el.innerHTML = '<span class="text-white/30">Gemini API 키가 필요합니다. AI-CFO 탭에서 설정하세요.</span>';
    return;
  }

  const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
  const fmtP = v => isKR ? Math.round(v).toLocaleString() + '원' : v.toFixed(2) + 'USD';
  const fmtPct = v => `${((v / data.lastClose - 1) * 100).toFixed(1)}%`;

  const avgPred = mean([data.arima, data.lstm, data.transformer, data.prophet]);
  const allUp   = [data.arima, data.lstm, data.transformer, data.prophet].every(v => v > data.lastClose);
  const allDown = [data.arima, data.lstm, data.transformer, data.prophet].every(v => v < data.lastClose);

  const prompt = `당신은 전문 주식 분석가입니다. 아래 데이터를 기반으로 ${data.stockName}의 투자 분석 보고서를 한국어로 작성하세요.

[기술적 분석]
현재가: ${fmtP(data.lastClose)}
RSI(14): ${data.rsi?.toFixed(1) ?? 'N/A'} ${data.rsi >= 70 ? '(과매수)' : data.rsi <= 30 ? '(과매도)' : '(중립)'}
이동평균 배열: ${data.maSignal}
200일 이동평균: ${fmtP(data.ma200)} | 이격도: ${data.disparity.toFixed(1)}%
그랜빌 신호: ${data.granville.signal || '특이 신호 없음'} — ${data.granville.desc}

[30일 예측 모델 결과]
ARIMA    : ${fmtP(data.arima)} (${fmtPct(data.arima)})
LSTM     : ${fmtP(data.lstm)} (${fmtPct(data.lstm)})
Transformer: ${fmtP(data.transformer)} (${fmtPct(data.transformer)})
Prophet  : ${fmtP(data.prophet)} (${fmtPct(data.prophet)})
4모델 평균: ${fmtP(avgPred)} (${fmtPct(avgPred)})
방향 합의: ${allUp ? '4모델 모두 상승 예측' : allDown ? '4모델 모두 하락 예측' : '모델별 의견 분산'}

다음 형식으로 250자 이내로 간결하게 작성하세요:

**현황** (1~2문장 — 현재가 기준 기술적 상태)
**예측 종합** (1~2문장 — 4개 모델의 방향성과 신뢰도)
**투자 의견** (매수 / 중립 / 매도 + 핵심 근거 1문장)
**주의** (리스크 1문장)

※ 본 분석은 AI 시뮬레이션 기반이며 투자 판단 책임은 투자자 본인에게 있습니다.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const json = await resp.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '보고서 생성 실패';

    el.innerHTML = text
      .replace(/\*\*(.+?)\*\*/g, '<span class="text-white font-semibold">$1</span>')
      .split('\n')
      .map(line => line.trim() ? `<p class="mb-2 text-white/75 text-sm leading-relaxed">${line}</p>` : '')
      .join('');
  } catch (e) {
    el.innerHTML = `<span class="text-white/30">보고서 생성 오류: ${e.message}</span>`;
  }
}

// ══════════════════════════════════════════════════════════════════════
//  메인 분석 실행
// ══════════════════════════════════════════════════════════════════════
export async function runAnalysis(stockName) {
  const statusEl = document.getElementById('ana-status');
  const setStatus = t => { if (statusEl) statusEl.textContent = t; };
  const setEl = (id, text, cls = null) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== null) el.className = `kpi-value ${cls}`;
  };

  setStatus('데이터 로딩 중...');

  const ticker = ALL_STOCKS[stockName];
  if (!ticker) { setStatus('알 수 없는 종목'); return; }

  // Fetch ~400 calendar days (≥200 trading days)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 420);
  const startStr = startDate.toISOString().split('T')[0];

  const ohlc = await fetchOHLC(ticker, startStr);
  const allCloses = ohlc.closes.filter(v => v !== null);
  const allDates  = ohlc.dates.filter((_, i) => ohlc.closes[i] !== null);

  if (allCloses.length < 60) { setStatus('데이터 부족 (최소 60일 필요)'); return; }

  // Use last 200 trading days
  const closes = allCloses.slice(-200);
  const dates  = allDates.slice(-200);

  setStatus('기술적 지표 계산 중...');

  // ── 기술적 지표 계산 ─────────────────────────────────────────────
  const ma20  = calcMA(closes, 20);
  const ma60  = calcMA(closes, 60);
  // MA200 needs full history, then slice last 200
  const ma200full = calcMA(allCloses, 200);
  const ma200 = ma200full.slice(-200);

  const rsi = calcRSI(closes, 14);
  const { upper: bbUp, lower: bbLow } = calcBollinger(closes, 20);
  const granville = granvilleSignal(closes, ma200);

  const lastClose = closes[closes.length - 1];
  const lastRSI   = rsi.filter(v => v != null).slice(-1)[0];
  const lastMA20  = ma20.filter(v => v != null).slice(-1)[0];
  const lastMA60  = ma60.filter(v => v != null).slice(-1)[0];
  const lastMA200 = ma200.filter(v => v != null).slice(-1)[0];
  const disparity = lastMA200 ? ((lastClose - lastMA200) / lastMA200 * 100) : 0;
  const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
  const fmtP = v => v != null ? (isKR ? Math.round(v).toLocaleString() : v.toFixed(2)) : '--';

  // ── KPI 업데이트 ──────────────────────────────────────────────────
  setEl('ana-price', fmtP(lastClose));
  setEl('ana-rsi',
    lastRSI ? `${lastRSI.toFixed(1)}${lastRSI >= 70 ? ' ▲과매수' : lastRSI <= 30 ? ' ▼과매도' : ''}` : '--',
    lastRSI >= 70 ? 'text-crimson' : lastRSI <= 30 ? 'text-matrix' : ''
  );
  setEl('ana-ma-signal',
    lastMA20 != null && lastMA60 != null ? (lastMA20 > lastMA60 ? '정배열 ▲' : '역배열 ▼') : '--',
    lastMA20 > lastMA60 ? 'text-matrix' : 'text-crimson'
  );
  setEl('ana-disparity', `${disparity.toFixed(1)}%`,
    Math.abs(disparity) > 15 ? 'text-crimson' : ''
  );
  setEl('ana-granville',
    granville.signal || '관망',
    granville.type === 'buy' ? 'text-matrix' : granville.type === 'sell' ? 'text-crimson' : 'text-cyber'
  );

  // ── 그랜빌 신호 배너 ─────────────────────────────────────────────
  const banner = document.getElementById('ana-signal-banner');
  if (banner) {
    if (granville.signal) {
      const type = granville.type === 'buy' ? 'buy' : granville.type === 'sell' ? 'sell' : 'neutral';
      banner.className = `mb-4 p-3 border rounded text-sm signal-${type}`;
      banner.textContent = `📡 그랜빌 ${granville.signal} — ${granville.desc}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  // ── 200일 주가 차트 ───────────────────────────────────────────────
  const bbFill = {
    x: [...dates, ...dates.slice().reverse()],
    y: [...bbUp.map(v => v ?? null), ...bbLow.slice().reverse().map(v => v ?? null)],
    fill: 'toself', fillcolor: 'rgba(37,99,235,0.05)',
    line: { color: 'transparent' }, hoverinfo: 'skip', showlegend: false,
  };
  Plotly.newPlot('chart-ana-price', [
    bbFill,
    { x: dates, y: bbUp,   mode: 'lines', name: 'BB상단', line: { color: 'rgba(100,116,139,0.4)', width: 0.8, dash: 'dot' } },
    { x: dates, y: bbLow,  mode: 'lines', name: 'BB하단', line: { color: 'rgba(100,116,139,0.4)', width: 0.8, dash: 'dot' } },
    { x: dates, y: ma20,   mode: 'lines', name: 'MA20',  line: { color: '#94a3b8', width: 1.2 } },
    { x: dates, y: ma60,   mode: 'lines', name: 'MA60',  line: { color: '#64748b', width: 1.4 } },
    { x: dates, y: ma200,  mode: 'lines', name: 'MA200', line: { color: '#1e293b', width: 2, dash: 'dash' } },
    { x: dates, y: closes, mode: 'lines', name: '주가',  line: { color: '#09090b', width: 2 } },
  ], {
    ...DARK_LAYOUT,
    height: 288,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '주가' },
    margin: { l: 60, r: 20, t: 10, b: 40 },
  }, PLOTLY_CONFIG);

  // ── RSI 차트 ──────────────────────────────────────────────────────
  Plotly.newPlot('chart-ana-rsi', [
    { x: dates, y: rsi, mode: 'lines', name: 'RSI(14)', line: { color: '#2563eb', width: 1.5 } },
  ], {
    ...DARK_LAYOUT,
    shapes: [
      { type: 'line', x0: dates[0], x1: dates[dates.length - 1], y0: 70, y1: 70, line: { color: '#dc2626', dash: 'dash', width: 1 } },
      { type: 'line', x0: dates[0], x1: dates[dates.length - 1], y0: 30, y1: 30, line: { color: '#16a34a', dash: 'dash', width: 1 } },
    ],
    yaxis: { ...DARK_LAYOUT.yaxis, title: 'RSI', range: [0, 100] },
    margin: { l: 60, r: 20, t: 8, b: 35 },
    height: 160,
  }, PLOTLY_CONFIG);

  // ── 4개 모델 예측 ─────────────────────────────────────────────────
  setStatus('예측 모델 실행 중...');
  const FDAYS = 30;
  const fcDates = businessDays(new Date(dates[dates.length - 1]), FDAYS);

  const arima = forecastARIMA(closes, FDAYS);
  const lstm  = forecastLSTM(closes, FDAYS);
  const trans = forecastTransformer(closes, FDAYS);
  const prop  = forecastProphet(closes, dates, FDAYS);

  // 예측 KPI
  const pFmt = v => `${fmtP(v)} (${((v / lastClose - 1) * 100).toFixed(1)}%)`;
  const pCls = v => v > lastClose ? 'text-matrix text-sm' : v < lastClose ? 'text-crimson text-sm' : 'text-sm';
  setEl('pred-arima', pFmt(arima[FDAYS - 1]), pCls(arima[FDAYS - 1]));
  setEl('pred-lstm',  pFmt(lstm[FDAYS - 1]),  pCls(lstm[FDAYS - 1]));
  setEl('pred-trans', pFmt(trans[FDAYS - 1]), pCls(trans[FDAYS - 1]));
  setEl('pred-prop',  pFmt(prop[FDAYS - 1]),  pCls(prop[FDAYS - 1]));

  // 예측 차트: 최근 60일 + 30일 예측
  const histN  = 60;
  const hDates = dates.slice(-histN);
  const hClose = closes.slice(-histN);
  const anchor = [dates[dates.length - 1]];
  const aprice = [lastClose];

  Plotly.newPlot('chart-ana-pred', [
    { x: hDates, y: hClose, mode: 'lines', name: '실제 주가', line: { color: '#09090b', width: 2 } },
    { x: anchor.concat(fcDates), y: aprice.concat(arima), mode: 'lines', name: 'ARIMA',
      line: { color: '#2563eb', width: 2, dash: 'solid' } },
    { x: anchor.concat(fcDates), y: aprice.concat(lstm), mode: 'lines', name: 'LSTM',
      line: { color: '#16a34a', width: 2, dash: 'dash' } },
    { x: anchor.concat(fcDates), y: aprice.concat(trans), mode: 'lines', name: 'Transformer',
      line: { color: '#d97706', width: 2, dash: 'dot' } },
    { x: anchor.concat(fcDates), y: aprice.concat(prop), mode: 'lines', name: 'Prophet',
      line: { color: '#7c3aed', width: 2, dash: 'dashdot' } },
    { x: [dates[dates.length - 1], dates[dates.length - 1]],
      y: [Math.min(...hClose) * 0.96, Math.max(...hClose) * 1.04],
      mode: 'lines', showlegend: false, line: { color: '#d1d5db', dash: 'dot', width: 1 } },
  ], {
    ...DARK_LAYOUT,
    height: 288,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '주가' },
    margin: { l: 60, r: 20, t: 10, b: 40 },
  }, PLOTLY_CONFIG);

  // ── AI 보고서 ─────────────────────────────────────────────────────
  setStatus('AI 보고서 생성 중...');
  await generateReport({
    stockName, lastClose,
    rsi: lastRSI,
    maSignal: lastMA20 > lastMA60 ? '정배열' : '역배열',
    disparity, granville, ma200: lastMA200,
    arima: arima[FDAYS - 1],
    lstm:  lstm[FDAYS - 1],
    transformer: trans[FDAYS - 1],
    prophet: prop[FDAYS - 1],
  }, ticker);

  setStatus(`완료 — ${stockName} (${dates[dates.length - 1]})`);
}
