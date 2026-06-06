// ══════════════════════════════════════════════════════════════════════
//  macro.js  — 환율 · 금리 · 레포 · VIX
//  Frankfurter API (환율, 무료/키 불필요)
//  FRED API (금리/레포, 무료/키 필요)
// ══════════════════════════════════════════════════════════════════════

import { fetchFXRates, fetchFXHistory, fetchFRED, fetchClose } from './api.js';
import { DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

const BOK_RATE = 2.75; // 2026년 기준 수동 업데이트

const INDICES = [
  { ticker: '^KS11', name: 'KOSPI',   id: 'kospi',  decimals: 0 },
  { ticker: '^KQ11', name: 'KOSDAQ',  id: 'kosdaq', decimals: 2 },
  { ticker: '^IXIC', name: 'NASDAQ',  id: 'nasdaq', decimals: 0 },
  { ticker: '^GSPC', name: 'S&P 500', id: 'sp500',  decimals: 0 },
  { ticker: '^N225', name: 'Nikkei',  id: 'nikkei', decimals: 0 },
];
const IDX_COLORS = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626'];

// ══════════════════════════════════════════════════════════════════════
//  매크로 탭 초기 로드
// ══════════════════════════════════════════════════════════════════════

export async function loadMacroTab(days = null) {
  const period = days || 90;
  await Promise.allSettled([
    loadIndicesSection(period),
    loadFXSection(period),
    loadRatesSection(period),
    loadRepoSection(period),
  ]);
}

// ── 글로벌 주요 지수 ──────────────────────────────────────────────

async function loadIndicesSection(days = 90) {
  const bufStart = new Date();
  bufStart.setDate(bufStart.getDate() - days - 10);
  const startStr = bufStart.toISOString().split('T')[0];

  const results = await Promise.allSettled(
    INDICES.map(idx => fetchClose(idx.ticker, startStr))
  );

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days);
  const periodStartStr = periodStart.toISOString().split('T')[0];

  const traces = [];

  results.forEach((res, i) => {
    const idx  = INDICES[i];
    const valEl = document.getElementById(`idx-${idx.id}`);
    const chgEl = document.getElementById(`idx-${idx.id}-chg`);

    if (res.status === 'fulfilled' && res.value?.closes?.length >= 2) {
      const { dates, closes } = res.value;

      const validPairs = closes.reduce((acc, v, j) => {
        if (v !== null) acc.push({ d: dates[j], v });
        return acc;
      }, []);

      if (validPairs.length >= 2) {
        const last = validPairs[validPairs.length - 1].v;
        const prev = validPairs[validPairs.length - 2].v;
        const changePct = (last - prev) / prev * 100;

        if (valEl) valEl.textContent = last.toLocaleString('en-US', { maximumFractionDigits: idx.decimals });
        if (chgEl) {
          const sign = changePct >= 0 ? '+' : '';
          chgEl.textContent = `${sign}${changePct.toFixed(2)}%`;
          chgEl.style.color = changePct >= 0 ? '#16a34a' : '#dc2626';
        }
      }

      // 정규화 차트용 (기간 내 데이터만)
      const periodPairs = validPairs.filter(p => p.d >= periodStartStr);
      if (periodPairs.length >= 2) {
        const base = periodPairs[0].v;
        traces.push({
          x: periodPairs.map(p => p.d),
          y: periodPairs.map(p => +((p.v / base * 100).toFixed(2))),
          mode: 'lines',
          name: idx.name,
          line: { color: IDX_COLORS[i], width: 2 },
        });
      }
    } else {
      if (valEl) valEl.textContent = '오류';
      if (chgEl) { chgEl.textContent = '--'; chgEl.style.color = ''; }
    }
  });

  if (traces.length > 0) {
    const chartEl = document.getElementById('chart-indices');
    Plotly.newPlot('chart-indices', traces, {
      ...DARK_LAYOUT,
      height: 220,
      width: chartEl ? chartEl.clientWidth || undefined : undefined,
      yaxis: { ...DARK_LAYOUT.yaxis, title: '지수 (기준=100)' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
      margin: { l: 60, r: 20, t: 10, b: 50 },
      legend: { orientation: 'h', y: -0.35, font: { size: 10 } },
    }, PLOTLY_CONFIG);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
  }
}

// ── 환율 ─────────────────────────────────────────────────────────────

async function loadFXSection(days = 90) {
  try {
    const rates = await fetchFXRates('USD', ['KRW', 'EUR', 'JPY', 'CNY']);
    const usdkrw = rates['KRW'];
    const eurkrw = usdkrw / rates['EUR'];
    const jpykrw = (usdkrw / rates['JPY']) * 100;
    const cnykrw = usdkrw / rates['CNY'];

    setText('fx-usdkrw', `${usdkrw.toFixed(0)}원`);
    setText('fx-eurkrw', `${eurkrw.toFixed(0)}원`);
    setText('fx-jpykrw', `${jpykrw.toFixed(2)}원`);
    setText('fx-cnykrw', `${cnykrw.toFixed(0)}원`);

    // 환율 추이 차트 (USD/KRW)
    const fxHist = await fetchFXHistory('USD', 'KRW', days);

    if (!fxHist.dates.length) throw new Error('FX 데이터 없음');

    const titleEl = document.getElementById('chart-fx-trend')?.closest('.card')?.querySelector('.card-title');
    if (titleEl) titleEl.textContent = `환율 추이 (USD/KRW ${days}일)`;

    const fxEl = document.getElementById('chart-fx-trend');
    Plotly.newPlot('chart-fx-trend', [
      {
        x: fxHist.dates, y: fxHist.values,
        mode: 'lines', name: 'USD/KRW',
        line: { color: '#2563eb', width: 2 },
        fill: 'tozeroy', fillcolor: 'rgba(37,99,235,0.08)',
      }
    ], {
      ...DARK_LAYOUT,
      height: 220,
      width: fxEl ? fxEl.clientWidth || undefined : undefined,
      yaxis: { ...DARK_LAYOUT.yaxis, title: 'KRW' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
      margin: { l: 60, r: 20, t: 10, b: 40 },
    }, PLOTLY_CONFIG);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

  } catch (e) {
    console.error('[macro] FX error:', e);
    setTextAll(['fx-usdkrw', 'fx-eurkrw', 'fx-jpykrw', 'fx-cnykrw'], '불러오기 실패');
  }
}

// ── 금리 ─────────────────────────────────────────────────────────────

async function loadRatesSection(days = 90) {
  try {
    const monthLimit = Math.max(Math.ceil(days / 30) + 3, 12);
    const [fedFunds, us10y, us2y] = await Promise.all([
      fetchFRED('FEDFUNDS', monthLimit),
      fetchFRED('GS10',     monthLimit),
      fetchFRED('GS2',      monthLimit),
    ]);

    setText('rate-fed',   `${fedFunds.latest?.toFixed(2) ?? '--'}%`);
    setText('rate-bok',   `${BOK_RATE}%`);
    setText('rate-us10y', `${us10y.latest?.toFixed(2)   ?? '--'}%`);

    const traces = [
      { x: fedFunds.dates, y: fedFunds.values, name: 'Fed Funds', line: { color: '#09090b', width: 2 } },
      { x: us10y.dates,    y: us10y.values,    name: 'US 10Y',    line: { color: '#2563eb', width: 1.5 } },
      { x: us2y.dates,     y: us2y.values,     name: 'US 2Y',     line: { color: '#64748b', width: 1.5, dash: 'dash' } },
    ].map(t => ({ ...t, mode: 'lines' }));

    traces.push({
      x: [fedFunds.dates[0], fedFunds.dates[fedFunds.dates.length - 1]],
      y: [BOK_RATE, BOK_RATE],
      mode: 'lines', name: `한국 기준금리 (${BOK_RATE}%)`,
      line: { color: '#16a34a', dash: 'dot', width: 1.5 },
    });

    const ratesEl = document.getElementById('chart-rates');
    Plotly.newPlot('chart-rates', traces, {
      ...DARK_LAYOUT,
      height: 220,
      width: ratesEl ? ratesEl.clientWidth || undefined : undefined,
      yaxis: { ...DARK_LAYOUT.yaxis, title: '금리 (%)' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
      margin: { l: 55, r: 20, t: 10, b: 40 },
    }, PLOTLY_CONFIG);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    if (fedFunds.isDummy) annotateChart('chart-rates', '⚠ FRED API 키 미설정 — 임시 데이터');

  } catch (e) {
    console.error('[macro] Rates error:', e);
  }
}

// ── 레포 · 단기자금 ───────────────────────────────────────────────

async function loadRepoSection(days = 90) {
  try {
    const dailyLimit  = Math.max(days, 30);
    const monthLimit  = Math.max(Math.ceil(days / 30) + 3, 12);
    const [sofr, iorb, m2] = await Promise.all([
      fetchFRED('SOFR',  dailyLimit),
      fetchFRED('IORB',  dailyLimit),
      fetchFRED('M2SL',  monthLimit),
    ]);

    try {
      const vixHist = await fetchFRED('VIXCLS', dailyLimit);
      const vixVal = vixHist.latest;
      setText('macro-vix', vixVal ? vixVal.toFixed(2) : '--');
      colorKPI('macro-vix', vixVal, 20, 30);
    } catch { setText('macro-vix', '--'); }

    setText('repo-sofr', `${sofr.latest?.toFixed(2) ?? '--'}%`);
    setText('repo-iorb', `${iorb.latest?.toFixed(2) ?? '--'}%`);
    setText('macro-m2',  m2.latest ? `$${(m2.latest / 1000).toFixed(1)}T` : '--');

    const traces = [
      { x: sofr.dates, y: sofr.values, name: 'SOFR',       line: { color: '#09090b', width: 2 } },
      { x: iorb.dates, y: iorb.values, name: 'IORB (기준)', line: { color: '#2563eb', width: 1.5, dash: 'dash' } },
    ].map(t => ({ ...t, mode: 'lines' }));

    const repoEl = document.getElementById('chart-repo');
    Plotly.newPlot('chart-repo', traces, {
      ...DARK_LAYOUT,
      height: 220,
      width: repoEl ? repoEl.clientWidth || undefined : undefined,
      yaxis: { ...DARK_LAYOUT.yaxis, title: '금리 (%)' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
      margin: { l: 55, r: 20, t: 10, b: 40 },
    }, PLOTLY_CONFIG);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    if (sofr.isDummy) annotateChart('chart-repo', '⚠ FRED API 키 미설정 — 임시 데이터');

  } catch (e) {
    console.error('[macro] Repo error:', e);
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────────

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setTextAll(ids, val) { ids.forEach(id => setText(id, val)); }

function colorKPI(id, val, warnThresh, dangerThresh) {
  const el = document.getElementById(id);
  if (!el || val == null) return;
  el.className = `kpi-value ${val >= dangerThresh ? 'text-crimson' : val >= warnThresh ? 'text-gold' : ''}`;
}

function annotateChart(divId, text) {
  Plotly.relayout(divId, {
    annotations: [{
      text, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper',
      font: { color: '#d97706', size: 10 }, showarrow: false,
    }]
  }).catch(() => {});
}

window._ttMacro = { loadMacroTab };
