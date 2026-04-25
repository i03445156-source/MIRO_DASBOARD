// ══════════════════════════════════════════════════════════════════════
//  macro.js  — 환율 · 금리 · 레포 · VIX
//  Frankfurter API (환율, 무료/키 불필요)
//  FRED API (금리/레포, 무료/키 필요)
// ══════════════════════════════════════════════════════════════════════

import { fetchFXRates, fetchFXHistory, fetchFRED } from './api.js';
import { DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

const BOK_RATE = 2.75; // 2026년 기준 수동 업데이트

// ══════════════════════════════════════════════════════════════════════
//  매크로 탭 초기 로드
// ══════════════════════════════════════════════════════════════════════

export async function loadMacroTab(days = null) {
  const period = days || 90;
  await Promise.allSettled([
    loadFXSection(period),
    loadRatesSection(period),
    loadRepoSection(period),
  ]);
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
