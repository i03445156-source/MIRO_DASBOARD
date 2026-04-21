// ══════════════════════════════════════════════════════════════════════
//  macro.js  — 환율 · 금리 · 레포 · VIX
//  Frankfurter API (환율, 무료/키 불필요)
//  FRED API (금리/레포, 무료/키 필요)
// ══════════════════════════════════════════════════════════════════════

import { fetchFXRates, fetchFXHistory, fetchFRED } from './api.js';
import { DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

// ── 한국은행 기준금리 (고정값 — ECOS API 없이도 표시) ───────────────
// FRED 키 없을 때 fallback
const BOK_RATE = 2.75; // 2026년 기준 수동 업데이트

// ══════════════════════════════════════════════════════════════════════
//  매크로 탭 초기 로드
// ══════════════════════════════════════════════════════════════════════

export async function loadMacroTab() {
  await Promise.allSettled([
    loadFXSection(),
    loadRatesSection(),
    loadRepoSection(),
  ]);
}

// ── 환율 ─────────────────────────────────────────────────────────────

async function loadFXSection() {
  try {
    // 현재 환율 (USD 기준)
    const rates = await fetchFXRates('USD', ['KRW', 'EUR', 'JPY', 'CNY']);
    const usdkrw = rates['KRW'];
    const eurkrw = usdkrw / rates['EUR'];
    const jpykrw = (usdkrw / rates['JPY']) * 100;
    const cnykrw = usdkrw / rates['CNY'];

    setText('fx-usdkrw', `${usdkrw.toFixed(0)}원`);
    setText('fx-eurkrw', `${eurkrw.toFixed(0)}원`);
    setText('fx-jpykrw', `${jpykrw.toFixed(2)}원`);
    setText('fx-cnykrw', `${cnykrw.toFixed(0)}원`);

    // 환율 추이 차트 (USD/KRW 90일)
    const fxHist = await fetchFXHistory('USD', 'KRW', 90);
    Plotly.newPlot('chart-fx-trend', [
      {
        x: fxHist.dates, y: fxHist.values,
        mode: 'lines', name: 'USD/KRW',
        line: { color: '#ffffff', width: 1.8 },
        fill: 'tozeroy', fillcolor: 'rgba(255,255,255,0.04)',
      }
    ], {
      ...DARK_LAYOUT,
      yaxis: { ...DARK_LAYOUT.yaxis, title: 'KRW' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
    }, PLOTLY_CONFIG);

  } catch (e) {
    console.error('[macro] FX error:', e);
    setTextAll(['fx-usdkrw', 'fx-eurkrw', 'fx-jpykrw', 'fx-cnykrw'], '불러오기 실패');
  }
}

// ── 금리 ─────────────────────────────────────────────────────────────

async function loadRatesSection() {
  try {
    const [fedFunds, us10y, us2y] = await Promise.all([
      fetchFRED('FEDFUNDS', 60),
      fetchFRED('GS10',     60),
      fetchFRED('GS2',      60),
    ]);

    setText('rate-fed',    `${fedFunds.latest?.toFixed(2) ?? '--'}%`);
    setText('rate-bok',    `${BOK_RATE}%`);
    setText('rate-us10y',  `${us10y.latest?.toFixed(2)   ?? '--'}%`);
    setText('rate-kr10y',  '조회 중...');

    // 금리 추이 차트
    const traces = [
      { x: fedFunds.dates, y: fedFunds.values, name: 'Fed Funds', line: { color: '#ffffff', width: 2 } },
      { x: us10y.dates,    y: us10y.values,    name: 'US 10Y',    line: { color: '#aaaaaa', width: 1.5 } },
      { x: us2y.dates,     y: us2y.values,     name: 'US 2Y',     line: { color: '#777777', width: 1.5, dash: 'dash' } },
    ].map(t => ({ ...t, mode: 'lines' }));

    traces.push({
      x: [fedFunds.dates[0], fedFunds.dates[fedFunds.dates.length - 1]],
      y: [BOK_RATE, BOK_RATE],
      mode: 'lines', name: `한국 기준금리 (${BOK_RATE}%)`,
      line: { color: '#cccccc', dash: 'dot', width: 1.5 },
    });

    Plotly.newPlot('chart-rates', traces, {
      ...DARK_LAYOUT,
      yaxis: { ...DARK_LAYOUT.yaxis, title: '금리 (%)' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
    }, PLOTLY_CONFIG);

    if (fedFunds.isDummy) {
      annotateChart('chart-rates', '⚠ FRED API 키 미설정 — 임시 데이터');
    }

  } catch (e) {
    console.error('[macro] Rates error:', e);
  }
}

// ── 레포 · 단기자금 ───────────────────────────────────────────────

async function loadRepoSection() {
  try {
    const [sofr, iorb, m2] = await Promise.all([
      fetchFRED('SOFR',  60),
      fetchFRED('IORB',  60),
      fetchFRED('M2SL',  24),
    ]);

    // VIX는 Yahoo Finance 에서 가져오기
    let vixStr = '--';
    try {
      const vixHist = await fetchFRED('VIXCLS', 5);
      const vixVal = vixHist.latest;
      vixStr = vixVal ? vixVal.toFixed(2) : '--';
      setText('macro-vix', vixStr);
      colorKPI('macro-vix', vixVal, 20, 30);
    } catch { setText('macro-vix', '--'); }

    setText('repo-sofr', `${sofr.latest?.toFixed(2)   ?? '--'}%`);
    setText('repo-iorb', `${iorb.latest?.toFixed(2)   ?? '--'}%`);
    setText('macro-m2',  m2.latest ? `$${(m2.latest / 1000).toFixed(1)}T` : '--');

    // 레포 차트
    const traces = [
      { x: sofr.dates, y: sofr.values, name: 'SOFR',       line: { color: '#ffffff', width: 2 } },
      { x: iorb.dates, y: iorb.values, name: 'IORB (기준)', line: { color: '#aaaaaa', width: 1.5, dash: 'dash' } },
    ].map(t => ({ ...t, mode: 'lines' }));

    Plotly.newPlot('chart-repo', traces, {
      ...DARK_LAYOUT,
      yaxis: { ...DARK_LAYOUT.yaxis, title: '금리 (%)' },
      xaxis: { ...DARK_LAYOUT.xaxis, title: '날짜' },
    }, PLOTLY_CONFIG);

    if (sofr.isDummy) {
      annotateChart('chart-repo', '⚠ FRED API 키 미설정 — 임시 데이터');
    }

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
  el.className = `kpi-value ${val >= dangerThresh ? 'text-crimson' : val >= warnThresh ? 'text-gold' : 'text-matrix'}`;
}

function annotateChart(divId, text) {
  const layout = {
    annotations: [{
      text, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper',
      font: { color: '#FFD700', size: 10 }, showarrow: false,
    }]
  };
  Plotly.relayout(divId, layout).catch(() => {});
}

window._ttMacro = { loadMacroTab };
