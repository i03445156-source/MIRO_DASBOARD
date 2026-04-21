// ══════════════════════════════════════════════════════════════════════
//  technical.js  — RSI · MA · Bollinger · MACD · Granville 8법칙
// ══════════════════════════════════════════════════════════════════════

import { fetchOHLC } from './api.js';
import { ALL_STOCKS, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

// ── 지표 계산 ─────────────────────────────────────────────────────

export function calcMA(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1).filter(v => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

export function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  const result = Array(closes.length).fill(null);
  let ema = closes.slice(0, period).filter(v => v != null).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    if (closes[i] == null) { result[i] = null; continue; }
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function calcRSI(closes, period = 14) {
  const result = Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;

  // 초기값
  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = 100 - 100 / (1 + (avgLoss ? avgGain / avgLoss : Infinity));

  for (let i = period + 1; i < closes.length; i++) {
    if (closes[i] == null || closes[i - 1] == null) { result[i] = null; continue; }
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = 100 - 100 / (1 + (avgLoss ? avgGain / avgLoss : Infinity));
  }
  return result;
}

export function calcBollinger(closes, period = 20, k = 2) {
  const ma  = calcMA(closes, period);
  const upper = [], lower = [];
  closes.forEach((_, i) => {
    if (i < period - 1) { upper.push(null); lower.push(null); return; }
    const slice = closes.slice(i - period + 1, i + 1).filter(v => v != null);
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  });
  return { ma, upper, lower };
}

export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast   = calcEMA(closes, fast);
  const emaSlow   = calcEMA(closes, slow);
  const macdLine  = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const signalArr = calcEMA(macdLine.filter(v => v != null), signal);
  // 신호선을 마지막 N개에 맞춰 패딩
  const pad = closes.length - signalArr.length;
  const signalLine = [...Array(pad).fill(null), ...signalArr];
  const histogram  = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

// ── Granville 8법칙 ────────────────────────────────────────────────

export function granvilleSignal(closes, maLongArr) {
  const n = closes.length;
  if (n < 6 || maLongArr.filter(v => v != null).length < 6) return { signal: null, desc: '데이터 부족' };

  const curr = closes[n - 1];
  const prev = closes[n - 2];
  const maL  = maLongArr[n - 1];
  const prevMaL = maLongArr[n - 2];

  if (!curr || !maL) return { signal: null, desc: '유효 데이터 없음' };

  const isRising   = maL > prevMaL;
  const disparity  = ((curr - maL) / maL) * 100;

  // 매수 신호
  if (!isRising && prev < prevMaL && curr > maL)
    return { signal: '매수1 (신규돌파)', type: 'buy', desc: '하락/횡보 기준선을 주가가 상향 돌파 — 강력 반등 신호' };
  if (isRising && prev < prevMaL && curr > maL)
    return { signal: '매수2 (눌림목 회복)', type: 'buy', desc: '상승 추세 중 지지 확인 후 기준선 재돌파' };
  if (isRising && curr > maL && disparity > 0 && disparity < 3 && curr > prev)
    return { signal: '매수3 (추세적 지지)', type: 'buy', desc: '기준선 근방에서 지지 받고 재상승 — 전형적 상승 신호' };
  if (!isRising && disparity < -15)
    return { signal: '매수4 (단기 낙폭과도)', type: 'buy', desc: '이평 과리 거리 과도 → 기술적 반등 가능성' };

  // 매도 신호
  if (isRising && prev > prevMaL && curr < maL)
    return { signal: '매도1 (추세 이탈)', type: 'sell', desc: '상승하는 기준선을 주가 하향 이탈 — 추세 전환 위험' };
  if (!isRising && prev > prevMaL && curr < maL)
    return { signal: '매도2 (반등실패)', type: 'sell', desc: '하락 추세 중 반등 후 재이탈 — 추가 하락 주의' };
  if (isRising && disparity > 20)
    return { signal: '매도4 (단기 과열)', type: 'sell', desc: '이평 대비 단기 급등 — 조정 가능성' };

  return { signal: null, type: 'neutral', desc: `특이 신호 없음 — 현재 이격도 ${disparity.toFixed(1)}%` };
}

// ══════════════════════════════════════════════════════════════════════
//  기술분석 탭 렌더링
// ══════════════════════════════════════════════════════════════════════

export async function runTechnicalAnalysis(stockName, strategy, rsiPeriod) {
  const statusEl = document.getElementById('ta-status');
  statusEl.textContent = '데이터 로딩 중...';

  const ticker = ALL_STOCKS[stockName];
  if (!ticker) { statusEl.textContent = '종목 없음'; return; }

  const [shortPeriod, longPeriod] = strategy.split(',').map(Number);

  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);
  const startStr = startDate.toISOString().split('T')[0];

  const ohlc = await fetchOHLC(ticker, startStr);
  const { dates, closes } = ohlc;

  const maShort = calcMA(closes, shortPeriod);
  const maLong  = calcMA(closes, longPeriod);
  const rsi     = calcRSI(closes, rsiPeriod);
  const { upper: bbUp, lower: bbLow } = calcBollinger(closes, 20);

  // KPI
  const lastRSI   = rsi.filter(v => v != null).slice(-1)[0];
  const lastMaS   = maShort.filter(v => v != null).slice(-1)[0];
  const lastMaL   = maLong.filter(v => v != null).slice(-1)[0];
  const granville = granvilleSignal(closes, maLong);

  document.getElementById('ta-rsi-val').textContent =
    lastRSI ? `${lastRSI.toFixed(1)}${lastRSI >= 70 ? ' ⚠ 과매수' : lastRSI <= 30 ? ' ✓ 과매도' : ''}` : '--';
  document.getElementById('ta-rsi-val').className =
    `kpi-value ${lastRSI >= 70 ? 'text-crimson' : lastRSI <= 30 ? 'text-matrix' : 'text-cyber'}`;

  const isGolden = lastMaS > lastMaL;
  document.getElementById('ta-ma-signal').textContent = isGolden ? '정배열 ▲' : '역배열 ▼';
  document.getElementById('ta-ma-signal').className = `kpi-value ${isGolden ? 'text-matrix' : 'text-crimson'}`;

  document.getElementById('ta-granville').textContent = granville.signal || '신호 없음';
  document.getElementById('ta-granville').className =
    `kpi-value ${granville.type === 'buy' ? 'text-matrix' : granville.type === 'sell' ? 'text-crimson' : 'text-cyber'}`;

  // 신호 배너
  const banner = document.getElementById('ta-signal-banner');
  if (granville.signal) {
    banner.className = `mb-4 p-3 border rounded text-sm signal-${granville.type === 'buy' ? 'buy' : granville.type === 'sell' ? 'sell' : 'neutral'}`;
    banner.textContent = `📡 ${granville.signal} — ${granville.desc}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // ── 가격 차트 ──────────────────────────────────────────────────
  const last180 = dates.length > 360 ? dates.length - 360 : 0;
  const sliceD  = dates.slice(last180);
  const sliceC  = closes.slice(last180);
  const sliceMS = maShort.slice(last180);
  const sliceML = maLong.slice(last180);
  const sliceBU = bbUp.slice(last180);
  const sliceBL = bbLow.slice(last180);

  Plotly.newPlot('chart-ta-price', [
    // Bollinger 밴드 영역
    {
      x: [...sliceD, ...sliceD.slice().reverse()],
      y: [...sliceBU.map(v => v ?? null), ...sliceBL.slice().reverse().map(v => v ?? null)],
      fill: 'toself', fillcolor: 'rgba(0,207,255,0.06)',
      line: { color: 'rgba(0,0,0,0)' }, hoverinfo: 'skip', showlegend: false,
    },
    { x: sliceD, y: sliceBU, mode: 'lines', name: 'BB 상단', line: { color: '#00CFFF', width: 0.8, dash: 'dot' } },
    { x: sliceD, y: sliceBL, mode: 'lines', name: 'BB 하단', line: { color: '#00CFFF', width: 0.8, dash: 'dot' } },
    { x: sliceD, y: sliceC,  mode: 'lines', name: '주가',    line: { color: '#FFFFFF',  width: 1.5 } },
    { x: sliceD, y: sliceMS, mode: 'lines', name: `MA${shortPeriod}`, line: { color: '#FFD700', width: 1.2 } },
    { x: sliceD, y: sliceML, mode: 'lines', name: `MA${longPeriod}`,  line: { color: '#FF6347', width: 2   } },
  ], {
    ...DARK_LAYOUT,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '가격' },
  }, PLOTLY_CONFIG);

  // ── RSI 차트 ──────────────────────────────────────────────────
  const sliceRSI = rsi.slice(last180);
  Plotly.newPlot('chart-ta-rsi', [
    { x: sliceD, y: sliceRSI, mode: 'lines', name: `RSI(${rsiPeriod})`, line: { color: '#7B68EE', width: 1.5 } },
  ], {
    ...DARK_LAYOUT,
    shapes: [
      { type: 'line', x0: sliceD[0], x1: sliceD[sliceD.length - 1], y0: 70, y1: 70, line: { color: '#FF3333', dash: 'dash', width: 1 } },
      { type: 'line', x0: sliceD[0], x1: sliceD[sliceD.length - 1], y0: 30, y1: 30, line: { color: '#00FF41', dash: 'dash', width: 1 } },
    ],
    yaxis: { ...DARK_LAYOUT.yaxis, title: 'RSI', range: [0, 100] },
  }, PLOTLY_CONFIG);

  statusEl.textContent = `완료 — ${stockName}`;
}

window._ttTechnical = { runTechnicalAnalysis };
