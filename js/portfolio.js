// ══════════════════════════════════════════════════════════════════════
//  portfolio.js  — 수익률, VaR, 마코위츠 최적화
// ══════════════════════════════════════════════════════════════════════

import { fetchMultiClose } from './api.js';
import { MEMBERS, BASE_DATE, ALL_STOCKS, COLORS, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

// ── 유틸 ──────────────────────────────────────────────────────────
export function pctReturns(closes) {
  return closes.map((v, i) => i === 0 ? 0 : (closes[i - 1] ? (v - closes[i - 1]) / closes[i - 1] : 0));
}
export function cumReturns(closes) {
  const base = closes[0] || 1;
  return closes.map(v => ((v - base) / base) * 100);
}
export function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
export function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1 || 1));
}
function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function matVec(M, v) { return M.map(row => dot(row, v)); }

// ── 정규 역CDF (Beasley-Springer-Moro 근사) ─────────────────────
function normInv(p) {
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];
  const sign = p < 0.5 ? -1 : 1;
  const t = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
  return sign * (t - (a[0] + a[1] * t + a[2] * t ** 2) / (1 + b[0] * t + b[1] * t ** 2 + b[2] * t ** 3));
}

// ══════════════════════════════════════════════════════════════════════
//  수익률 탭
// ══════════════════════════════════════════════════════════════════════

export async function loadReturns(memberKey) {
  const statusEl = document.getElementById('ret-status');
  statusEl.textContent = '데이터 로딩 중...';

  // 조회 대상 종목 결정
  let stocksMap = {};
  if (memberKey === '__all__') {
    Object.values(MEMBERS).forEach(s => Object.assign(stocksMap, s));
  } else {
    stocksMap = MEMBERS[memberKey] || {};
  }

  const tickers = Object.values(stocksMap);
  const names   = Object.keys(stocksMap);

  const multiData = await fetchMultiClose(tickers, BASE_DATE);
  const traces = [];

  // 수익률 테이블 데이터
  const tableRows = [];

  tickers.forEach((ticker, i) => {
    const d = multiData[ticker];
    if (!d || !d.closes.length) return;

    const validCloses = d.closes.filter(v => v !== null);
    const validDates  = d.dates.filter((_, j) => d.closes[j] !== null);
    if (!validCloses.length) return;

    const cr = cumReturns(validCloses);
    const lastRet = cr[cr.length - 1];

    traces.push({
      x: validDates, y: cr,
      mode: 'lines', name: names[i],
      line: { color: COLORS[i % COLORS.length], width: 1.5 },
    });
    tableRows.push({ name: names[i], ticker, ret: lastRet });
  });

  // 차트
  Plotly.newPlot('chart-returns', traces, {
    ...DARK_LAYOUT,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '수익률 (%)' },
    xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
  }, PLOTLY_CONFIG);

  // 테이블
  tableRows.sort((a, b) => b.ret - a.ret);
  const tbl = document.getElementById('returns-table');
  tbl.innerHTML = `
    <table class="data-table">
      <thead><tr><th>순위</th><th>종목</th><th>티커</th><th>수익률</th></tr></thead>
      <tbody>
        ${tableRows.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${r.name}</td>
            <td class="text-matrix/50">${r.ticker}</td>
            <td class="${r.ret >= 0 ? 'ret-pos' : 'ret-neg'}">${r.ret.toFixed(2)}%</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  statusEl.textContent = `${traces.length}개 종목 로드 완료`;
}

// ══════════════════════════════════════════════════════════════════════
//  리스크 탭  (VaR)
// ══════════════════════════════════════════════════════════════════════

export async function runRiskAnalysis(selectedNames, investmentMW, confLevel) {
  const statusEl = document.getElementById('risk-status');
  statusEl.textContent = '분석 중...';

  const tickers = selectedNames.map(n => ALL_STOCKS[n]);
  const startDate = new Date(); startDate.setFullYear(startDate.getFullYear() - 1);
  const startStr  = startDate.toISOString().split('T')[0];

  const multiData = await fetchMultiClose(tickers, startStr);

  // 일별 수익률 행렬
  const retMatrix = [];
  const validNames = [];

  tickers.forEach((ticker, i) => {
    const d = multiData[ticker];
    if (!d || d.closes.length < 10) return;
    const rets = pctReturns(d.closes.filter(v => v !== null)).slice(1);
    if (rets.length < 10) return;
    retMatrix.push(rets);
    validNames.push(selectedNames[i]);
  });

  if (!retMatrix.length) { statusEl.textContent = '데이터 없음'; return; }

  // 동일 비중 포트폴리오 수익률
  const minLen = Math.min(...retMatrix.map(r => r.length));
  const trimmed = retMatrix.map(r => r.slice(-minLen));
  const portRets = Array.from({ length: minLen }, (_, i) =>
    trimmed.reduce((s, r) => s + r[i], 0) / trimmed.length
  );

  const portMean = mean(portRets);
  const portStd  = std(portRets);
  const investKRW = investmentMW * 10000;

  // VaR (정규분포 파라메트릭)
  const zScore = normInv(1 - confLevel) * -1; // positive z
  const varPct   = zScore * portStd;
  const varValue = investKRW * varPct;

  // MDD
  let peak = -Infinity, mdd = 0, cum = 1;
  portRets.forEach(r => {
    cum *= (1 + r);
    if (cum > peak) peak = cum;
    const dd = (peak - cum) / peak;
    if (dd > mdd) mdd = dd;
  });

  // KPI 업데이트
  document.getElementById('risk-vol').textContent  = `${(portStd * 100).toFixed(2)}%`;
  document.getElementById('risk-var').textContent  = `${Math.round(varValue).toLocaleString()}원 (${(varPct*100).toFixed(2)}%)`;
  document.getElementById('risk-mdd').textContent  = `${(mdd * 100).toFixed(2)}%`;

  // var-dist resize (단일 종목도 포함)
  setTimeout(() => {
    const el = document.getElementById('chart-var-dist');
    if (el && window.Plotly) Plotly.Plots.resize(el);
  }, 300);

  // 히스토그램
  Plotly.newPlot('chart-var-dist', [
    {
      x: portRets.map(v => v * 100),
      type: 'histogram', nbinsx: 50,
      marker: { color: '#2563eb', opacity: 0.6 },
      name: '수익률 분포',
    }
  ], {
    ...DARK_LAYOUT,
    height: 288,
    margin: { l: 55, r: 20, t: 10, b: 50 },
    shapes: [{
      type: 'line',
      x0: -varPct * 100, x1: -varPct * 100,
      y0: 0, y1: 1, yref: 'paper',
      line: { color: '#dc2626', width: 2, dash: 'dash' },
    }],
    annotations: [{
      x: -varPct * 100, y: 0.9, yref: 'paper',
      text: `VaR ${(confLevel*100).toFixed(0)}%`,
      font: { color: '#dc2626', size: 10 },
      showarrow: false,
    }],
  }, PLOTLY_CONFIG);

  // 상관관계 히트맵 (종목 2개 이상)
  if (validNames.length >= 2) {
    const corrMatrix = validNames.map((_, i) =>
      validNames.map((__, j) => {
        const ri = trimmed[i], rj = trimmed[j];
        const mi = mean(ri), mj = mean(rj);
        const si = std(ri),  sj = std(rj);
        const cov = ri.reduce((s, v, k) => s + (v - mi) * (rj[k] - mj), 0) / ri.length;
        return si && sj ? cov / (si * sj) : (i === j ? 1 : 0);
      })
    );

    Plotly.newPlot('chart-corr', [{
      z: corrMatrix,
      x: validNames, y: validNames,
      type: 'heatmap',
      colorscale: [
        [0, '#1d4ed8'], [0.5, '#f8fafc'], [1, '#dc2626']
      ],
      zmin: -1, zmax: 1,
      text: corrMatrix.map(row => row.map(v => v.toFixed(2))),
      texttemplate: '%{text}',
      textfont: { size: 9, color: '#09090b' },
    }], {
      ...DARK_LAYOUT,
      height: 288,
      margin: { l: 90, r: 20, t: 10, b: 90 },
    }, PLOTLY_CONFIG);

    // 상관 히트맵 resize — 300ms + 600ms 이중 보장
    setTimeout(() => {
      const el = document.getElementById('chart-corr');
      if (el && window.Plotly) Plotly.Plots.resize(el);
    }, 300);
    setTimeout(() => {
      const el = document.getElementById('chart-corr');
      if (el && window.Plotly) Plotly.Plots.resize(el);
    }, 700);
  }

  statusEl.textContent = `완료 (${validNames.length}개 종목)`;
}

// ══════════════════════════════════════════════════════════════════════
//  포트폴리오 최적화  (Markowitz Monte Carlo 효율적 프론티어)
// ══════════════════════════════════════════════════════════════════════

export async function runPortfolioOptimization(selectedNames, rfRate, nSim) {
  const statusEl = document.getElementById('port-status');
  statusEl.textContent = '최적화 중...';

  const tickers   = selectedNames.map(n => ALL_STOCKS[n]);
  const startDate = new Date(); startDate.setFullYear(startDate.getFullYear() - 1);
  const startStr  = startDate.toISOString().split('T')[0];

  const multiData = await fetchMultiClose(tickers, startStr);

  const retMatrix = [];
  const validNames = [];

  tickers.forEach((ticker, i) => {
    const d = multiData[ticker];
    if (!d) return;
    const rets = pctReturns(d.closes.filter(v => v !== null)).slice(1);
    if (rets.length < 20) return;
    retMatrix.push(rets);
    validNames.push(selectedNames[i]);
  });

  if (validNames.length < 2) { statusEl.textContent = '종목 2개 이상 필요'; return; }

  const n    = validNames.length;
  const minL = Math.min(...retMatrix.map(r => r.length));
  const R    = retMatrix.map(r => r.slice(-minL));

  // 연율화 평균 수익률
  const meanRets = R.map(r => mean(r) * 252);

  // 공분산 행렬 (연율화)
  const covMat = R.map((ri, i) =>
    R.map((rj, j) => {
      const mi = meanRets[i] / 252, mj = meanRets[j] / 252;
      return R[i].reduce((s, v, k) => s + (v - mi) * (R[j][k] - mj), 0) / (minL - 1) * 252;
    })
  );

  // Monte Carlo 시뮬레이션
  const results = [];
  for (let s = 0; s < nSim; s++) {
    // 랜덤 비중 생성 (Dirichlet 근사)
    const raw  = Array.from({ length: n }, () => -Math.log(Math.random()));
    const sum  = raw.reduce((a, b) => a + b, 0);
    const w    = raw.map(v => v / sum);

    const pRet = dot(w, meanRets);
    const pVar = w.reduce((s, wi, i) =>
      s + w.reduce((ss, wj, j) => ss + wi * wj * covMat[i][j], 0), 0
    );
    const pStd = Math.sqrt(Math.max(pVar, 0));
    const sharpe = pStd ? (pRet - rfRate / 100) / pStd : 0;

    results.push({ w, pRet, pStd, sharpe });
  }

  // 최적 (최고 샤프)
  const best = results.reduce((a, b) => b.sharpe > a.sharpe ? b : a);

  // KPI
  document.getElementById('port-sharpe').textContent = best.sharpe.toFixed(3);
  document.getElementById('port-ret').textContent    = `${(best.pRet * 100).toFixed(2)}%`;
  document.getElementById('port-vol').textContent    = `${(best.pStd * 100).toFixed(2)}%`;

  // 효율적 프론티어 산점도
  Plotly.newPlot('chart-frontier', [
    {
      x: results.map(r => r.pStd * 100),
      y: results.map(r => r.pRet * 100),
      mode: 'markers',
      type: 'scatter',
      marker: {
        size: 4,
        color: results.map(r => r.sharpe),
        colorscale: [[0,'#dbeafe'],[0.5,'#2563eb'],[1,'#1e3a8a']],
        colorbar: { title: 'Sharpe', tickfont: { size: 9 } },
        opacity: 0.7,
      },
      name: '포트폴리오',
    },
    {
      x: [best.pStd * 100],
      y: [best.pRet * 100],
      mode: 'markers',
      type: 'scatter',
      marker: { size: 14, color: '#dc2626', symbol: 'star' },
      name: '최적 포트폴리오',
    }
  ], {
    ...DARK_LAYOUT,
    height: 320,
    xaxis: { ...DARK_LAYOUT.xaxis, title: '변동성 (%)' },
    yaxis: { ...DARK_LAYOUT.yaxis, title: '기대수익률 (%)' },
    margin: { l: 55, r: 20, t: 10, b: 50 },
  }, PLOTLY_CONFIG);

  // 최적 비중 파이차트
  const weightData = validNames.map((name, i) => ({ name, weight: best.w[i] }))
    .filter(d => d.weight > 0.005)
    .sort((a, b) => b.weight - a.weight);

  Plotly.newPlot('chart-weights', [{
    labels: weightData.map(d => d.name),
    values: weightData.map(d => d.weight),
    type: 'pie',
    hole: 0.35,
    marker: { colors: COLORS },
    textfont: { size: 10, color: '#09090b' },
    textinfo: 'label+percent',
  }], {
    ...DARK_LAYOUT,
    height: 320,
    margin: { l: 20, r: 20, t: 20, b: 20 },
    showlegend: false,
  }, PLOTLY_CONFIG);

  setTimeout(() => {
    ['chart-frontier', 'chart-weights'].forEach(id => {
      const el = document.getElementById(id);
      if (el && window.Plotly) Plotly.Plots.resize(el);
    });
  }, 150);

  // 비중 테이블
  document.getElementById('weights-table').innerHTML = `
    <table class="data-table">
      <thead><tr><th>종목</th><th>비중</th></tr></thead>
      <tbody>
        ${weightData.map(d => `
          <tr><td>${d.name}</td><td>${(d.weight * 100).toFixed(2)}%</td></tr>
        `).join('')}
      </tbody>
    </table>`;

  // Monte Carlo 스트레스 테스트 — Box-Muller 정규분포, 날짜 x축
  const portDailyRets = Array.from({ length: minL }, (_, day) =>
    best.w.reduce((s, wi, i) => s + wi * R[i][day], 0)
  );
  const mu    = mean(portDailyRets);
  const sigma = std(portDailyRets);

  // Box-Muller: 균일분포 → 표준정규분포
  function randNormal() {
    let u, v;
    do { u = Math.random(); v = Math.random(); } while (u === 0);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // 미래 영업일 날짜 생성 (253개)
  const mcDates = [];
  const d0 = new Date();
  for (let i = 0; mcDates.length < 253; i++) {
    const d = new Date(d0);
    d.setDate(d0.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) mcDates.push(d.toISOString().split('T')[0]);
  }

  const N_PATHS = 80;
  const mcPaths = [];
  for (let i = 0; i < N_PATHS; i++) {
    let val = 100;
    const path = [val];
    for (let d = 0; d < 252; d++) {
      val *= Math.exp(mu - 0.5 * sigma ** 2 + sigma * randNormal());
      path.push(Math.max(val, 0.01));
    }
    mcPaths.push(path);
  }

  const mcMean = mcDates.map((_, d) => mean(mcPaths.map(p => p[d])));

  // 퍼센타일 밴드 (10th–90th)
  const pct10 = mcDates.map((_, d) => {
    const vals = mcPaths.map(p => p[d]).sort((a, b) => a - b);
    return vals[Math.floor(N_PATHS * 0.1)];
  });
  const pct90 = mcDates.map((_, d) => {
    const vals = mcPaths.map(p => p[d]).sort((a, b) => a - b);
    return vals[Math.floor(N_PATHS * 0.9)];
  });

  // 예금 기준선
  const savingsLine = mcDates.map((_, i) => 100 * Math.pow(1 + 0.035, i / 252));

  const mcTraces = [
    // 90th 퍼센타일 경계 (채우기용 상단)
    {
      x: mcDates, y: pct90,
      mode: 'lines', line: { color: 'transparent' },
      name: '90th', showlegend: false,
    },
    // 10th 퍼센타일 + fillto 90th
    {
      x: mcDates, y: pct10,
      mode: 'lines', name: '10~90th 구간',
      fill: 'tonexty', fillcolor: 'rgba(37,99,235,0.10)',
      line: { color: 'rgba(37,99,235,0.3)', width: 1 },
    },
    // 평균 경로
    {
      x: mcDates, y: mcMean,
      mode: 'lines', name: '평균 경로',
      line: { color: '#09090b', width: 2.5 },
    },
    // 예금 기준선
    {
      x: mcDates, y: savingsLine,
      mode: 'lines', name: '연 3.5% 예금',
      line: { color: '#64748b', dash: 'dash', width: 1.5 },
    },
  ];

  Plotly.newPlot('chart-montecarlo', mcTraces, {
    ...DARK_LAYOUT,
    height: 288,
    yaxis: { ...DARK_LAYOUT.yaxis, title: '수익률 (100 기준)' },
    xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜', type: 'date', tickformat: '%Y-%m' },
    margin: { l: 60, r: 20, t: 10, b: 50 },
  }, PLOTLY_CONFIG);

  setTimeout(() => {
    const el = document.getElementById('chart-montecarlo');
    if (el && window.Plotly) Plotly.Plots.resize(el);
  }, 300);

  statusEl.textContent = `완료 — 최적 샤프 ${best.sharpe.toFixed(3)}`;
}

window._ttPortfolio = { loadReturns, runRiskAnalysis, runPortfolioOptimization };
