// ══════════════════════════════════════════════════════════════════════
//  models.js  — Monte Carlo (GARCH-style) 시뮬레이션
//  Python의 GARCH+ARIMA, Prophet, LSTM/Transformer를
//  순수 JS 근사 구현으로 재현합니다.
// ══════════════════════════════════════════════════════════════════════

import { fetchOHLC } from './api.js';
import { ALL_STOCKS, COLORS, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

// ── 통계 유틸 ─────────────────────────────────────────────────────

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1 || 1));
}

// Box-Muller 정규분포 샘플링
function randNorm(mu = 0, sigma = 1) {
  const u1 = Math.random(), u2 = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── 변동성 클러스터링 (GARCH(1,1) 근사) ─────────────────────────
function garchVolatility(returns, omega, alpha, beta) {
  const variances = [std(returns) ** 2];
  for (let i = 1; i < returns.length; i++) {
    const v = omega + alpha * returns[i - 1] ** 2 + beta * variances[i - 1];
    variances.push(Math.max(v, 1e-8));
  }
  return variances;
}

// GARCH 파라미터 간단 추정 (moment-matching)
function estimateGARCH(returns) {
  const retVar  = std(returns) ** 2;
  const alpha   = 0.09;
  const beta    = 0.85;
  const omega   = retVar * (1 - alpha - beta);
  return { omega: Math.max(omega, 1e-8), alpha, beta };
}

// ── AR(1) 드리프트 추정 ─────────────────────────────────────────
function estimateAR1(returns) {
  const n = returns.length;
  const y = returns.slice(1);
  const x = returns.slice(0, n - 1);
  const mx = mean(x), my = mean(y);
  const covXY = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / n;
  const varX  = x.reduce((s, v) => s + (v - mx) ** 2, 0) / n;
  const phi   = varX ? covXY / varX : 0;
  return Math.min(Math.max(phi, -0.99), 0.99);
}

// ══════════════════════════════════════════════════════════════════════
//  예측 모델 탭 렌더링
// ══════════════════════════════════════════════════════════════════════

export async function runPredictionModel(stockName, forecastDays, nSim) {
  const statusEl = document.getElementById('mod-status');
  statusEl.textContent = '데이터 로딩 중...';

  const ticker = ALL_STOCKS[stockName];
  if (!ticker) { statusEl.textContent = '종목 없음'; return; }

  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);
  const startStr = startDate.toISOString().split('T')[0];

  const ohlc = await fetchOHLC(ticker, startStr);
  const closes = ohlc.closes.filter(v => v !== null);
  const dates  = ohlc.dates.filter((_, i) => ohlc.closes[i] !== null);

  if (closes.length < 60) { statusEl.textContent = '데이터 부족'; return; }

  statusEl.textContent = '모델 실행 중...';

  // ── 로그 수익률 계산 ──────────────────────────────────────────
  const logRets = closes.map((v, i) =>
    i === 0 ? 0 : Math.log(v / closes[i - 1])
  ).slice(1);

  const lastPrice = closes[closes.length - 1];
  const mu        = mean(logRets);
  const sigma     = std(logRets);

  // ── GARCH 파라미터 ────────────────────────────────────────────
  const { omega, alpha, beta } = estimateGARCH(logRets);
  const phi = estimateAR1(logRets);
  const variances = garchVolatility(logRets, omega, alpha, beta);
  const lastVar   = variances[variances.length - 1];

  // ── 예측 날짜 생성 (영업일) ────────────────────────────────────
  const lastDate = new Date(dates[dates.length - 1]);
  const forecastDates = [];
  let d = new Date(lastDate);
  while (forecastDates.length < forecastDays) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) forecastDates.push(d.toISOString().split('T')[0]);
  }

  // ── Monte Carlo シミュレーション ──────────────────────────────
  const allPaths = [];

  for (let s = 0; s < nSim; s++) {
    let price  = lastPrice;
    let prevRet = logRets[logRets.length - 1];
    let curVar  = lastVar;
    const path = [];

    for (let t = 0; t < forecastDays; t++) {
      // GARCH 변동성 업데이트
      curVar = omega + alpha * prevRet ** 2 + beta * curVar;
      const volT = Math.sqrt(Math.max(curVar, 1e-8));

      // AR(1) 드리프트
      const driftT = mu + phi * prevRet;

      // 로그 수익률 샘플링
      const retT = randNorm(driftT, volT);
      prevRet    = retT;
      price      = price * Math.exp(retT);
      path.push(price);
    }
    allPaths.push(path);
  }

  // ── 통계 계산 ──────────────────────────────────────────────────
  const meanPath  = forecastDates.map((_, t) => mean(allPaths.map(p => p[t])));
  const p5Path    = forecastDates.map((_, t) => percentile(allPaths.map(p => p[t]), 5));
  const p25Path   = forecastDates.map((_, t) => percentile(allPaths.map(p => p[t]), 25));
  const p75Path   = forecastDates.map((_, t) => percentile(allPaths.map(p => p[t]), 75));
  const p95Path   = forecastDates.map((_, t) => percentile(allPaths.map(p => p[t]), 95));
  const finalPrices = allPaths.map(p => p[forecastDays - 1]);

  const meanFinal  = mean(finalPrices);
  const predVol    = std(finalPrices) / lastPrice * 100;

  // ── KPI ──────────────────────────────────────────────────────
  const fmt = v => typeof v === 'number' && !isNaN(v)
    ? (ticker.endsWith('.KS') || ticker.endsWith('.KQ') ? v.toFixed(0) : v.toFixed(2))
    : '--';

  document.getElementById('mod-curr').textContent  = fmt(lastPrice);
  document.getElementById('mod-mean').textContent  = `${fmt(meanFinal)} (${((meanFinal/lastPrice-1)*100).toFixed(1)}%)`;
  document.getElementById('mod-vol').textContent   = `${predVol.toFixed(1)}%`;

  // ── 경로 차트 ──────────────────────────────────────────────────
  const histSlice = Math.max(0, closes.length - 120);
  const histDates = dates.slice(histSlice);
  const histClose = closes.slice(histSlice);

  const pathTraces = [];

  // Monte Carlo 경로 (50개만 표시)
  allPaths.slice(0, 50).forEach(path => {
    pathTraces.push({
      x: forecastDates, y: path, mode: 'lines',
      line: { color: 'rgba(0,207,255,0.07)', width: 0.6 }, showlegend: false,
    });
  });

  // 신뢰 구간 영역
  pathTraces.push({
    x: [...forecastDates, ...forecastDates.slice().reverse()],
    y: [...p95Path, ...p5Path.slice().reverse()],
    fill: 'toself', fillcolor: 'rgba(0,207,255,0.08)',
    line: { color: 'rgba(0,0,0,0)' }, name: '90% 구간', showlegend: true,
  });
  pathTraces.push({
    x: [...forecastDates, ...forecastDates.slice().reverse()],
    y: [...p75Path, ...p25Path.slice().reverse()],
    fill: 'toself', fillcolor: 'rgba(0,207,255,0.16)',
    line: { color: 'rgba(0,0,0,0)' }, name: '50% 구간', showlegend: true,
  });

  // 과거 주가
  pathTraces.push({
    x: histDates, y: histClose, mode: 'lines', name: '과거 주가',
    line: { color: '#AAAAAA', width: 1.5 },
  });
  // 평균 예측 경로
  pathTraces.push({
    x: forecastDates, y: meanPath, mode: 'lines', name: 'GARCH 평균 예측',
    line: { color: '#FFD700', width: 3 },
  });

  Plotly.newPlot('chart-mc-paths', pathTraces, {
    ...DARK_LAYOUT,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '주가' },
  }, PLOTLY_CONFIG);

  // ── 최종일 분포 히스토그램 ─────────────────────────────────────
  Plotly.newPlot('chart-mc-dist', [{
    x: finalPrices,
    type: 'histogram', nbinsx: 50,
    marker: { color: '#00CFFF', opacity: 0.75 },
    name: '예측 분포',
  }, {
    x: [lastPrice, lastPrice], y: [0, 1],
    mode: 'lines', yaxis: 'y2', name: '현재가',
    line: { color: '#FF3333', dash: 'dash', width: 2 },
  }], {
    ...DARK_LAYOUT,
    xaxis: { ...DARK_LAYOUT.xaxis, title: '예측 가격' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false },
  }, PLOTLY_CONFIG);

  // ── 로그수익률 + 변동성 ────────────────────────────────────────
  const rolVol = logRets.map((_, i) => {
    if (i < 20) return null;
    const slice = logRets.slice(i - 20, i);
    return std(slice) * Math.sqrt(252) * 100;
  });

  Plotly.newPlot('chart-mc-vol', [
    { x: dates.slice(1), y: logRets.map(v => v * 100), mode: 'lines', name: '일별 수익률(%)', line: { color: '#00FF41', width: 0.8 }, yaxis: 'y1' },
    { x: dates.slice(1), y: rolVol, mode: 'lines', name: '20일 롤링 변동성(연율, %)', line: { color: '#FFD700', width: 1.5 }, yaxis: 'y2' },
  ], {
    ...DARK_LAYOUT,
    yaxis:  { ...DARK_LAYOUT.yaxis, title: '일별 수익률 (%)' },
    yaxis2: { ...DARK_LAYOUT.yaxis, title: '연율 변동성 (%)', overlaying: 'y', side: 'right' },
  }, PLOTLY_CONFIG);

  statusEl.textContent = `완료 — ${nSim}회 시뮬레이션`;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

window._ttModels = { runPredictionModel };
