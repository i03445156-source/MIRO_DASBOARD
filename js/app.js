// ══════════════════════════════════════════════════════════════════════
//  app.js  — 앱 초기화, 탭 라우팅, 이벤트 리스너
// ══════════════════════════════════════════════════════════════════════

import { MEMBERS, ALL_STOCKS, BASE_DATE, COLORS, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';
import { fetchMultiClose, fetchLatestPrices } from './api.js';
import { loadReturns, runRiskAnalysis, runPortfolioOptimization, cumReturns, pctReturns } from './portfolio.js';
import { runAnalysis } from './analysis.js';
import { loadMacroTab } from './macro.js';
import { initAI } from './ai.js';

// ══════════════════════════════════════════════════════════════════════
//  앱 부트스트랩
// ══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initTabs();
  populateSelects();
  initReturnTab();
  initRiskTab();
  initPortfolioTab();
  initAnalysisTab();
  initAI();
  loadDashboard();
});

// ══════════════════════════════════════════════════════════════════════
//  헤더 시계
// ══════════════════════════════════════════════════════════════════════

function initHeader() {
  function tick() {
    const now = new Date();
    const el = document.getElementById('hdr-date');
    if (el) el.textContent = now.toLocaleString('ko-KR', { hour12: false });

    const h = now.getHours(), m = now.getMinutes(), dow = now.getDay();
    const totalMin = h * 60 + m;

    const krxEl  = document.getElementById('hdr-krx');
    const nyseEl = document.getElementById('hdr-nyse');
    if (krxEl) {
      const open = dow >= 1 && dow <= 5 && totalMin >= 540 && totalMin < 930;
      krxEl.textContent = open ? 'OPEN' : 'CLOSED';
      krxEl.className   = open ? 'text-white' : 'text-white/30';
    }
    if (nyseEl) {
      const open = dow >= 1 && dow <= 5 && (totalMin >= 1410 || totalMin < 360);
      nyseEl.textContent = open ? 'OPEN' : 'CLOSED';
      nyseEl.className   = open ? 'text-white' : 'text-white/30';
    }
  }
  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════════════
//  탭 라우팅
// ══════════════════════════════════════════════════════════════════════

let macroLoaded = false;

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));

  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  const sec = document.getElementById(`tab-${tabId}`);
  if (btn) btn.classList.add('active');
  if (sec) sec.classList.remove('hidden');

  // 매크로 탭은 처음 열 때만 로드
  if (tabId === 'macro' && !macroLoaded) {
    macroLoaded = true;
    loadMacroTab();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Select 박스 채우기
// ══════════════════════════════════════════════════════════════════════

function populateSelects() {
  const memberNames = Object.keys(MEMBERS);
  const stockNames  = Object.keys(ALL_STOCKS).sort();

  // 수익률 탭 - 멤버 선택
  fillSelect('ret-member', [{ value: '__all__', label: '전체보기' }, ...memberNames.map(n => ({ value: n, label: n }))]);

  // 리스크 탭 - 종목 멀티셀렉트
  fillSelect('risk-stocks', stockNames.map(n => ({ value: n, label: `${n} (${ALL_STOCKS[n]})` })), true);

  // 포트폴리오 탭 - 종목 멀티셀렉트 (기본값 4개)
  fillSelect('port-stocks', stockNames.map(n => ({ value: n, label: `${n} (${ALL_STOCKS[n]})` })), true, ['삼성전자', '기아', 'NAVER', 'QQQ']);

  // 종목분석 탭 - 전체 종목 드롭다운
  fillSelect('ana-stock', stockNames.map(n => ({ value: n, label: `${n} (${ALL_STOCKS[n]})` })));
}

function fillSelect(id, items, isMulti = false, defaults = []) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(item =>
    `<option value="${item.value}" ${defaults.includes(item.value) ? 'selected' : ''}>${item.label}</option>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════════════
//  대시보드 탭 — 전체 현황 로드
// ══════════════════════════════════════════════════════════════════════

async function loadDashboard() {
  showLoading('대시보드 데이터 로딩 중...');
  try {
    // 전체 종목 최신가 + 기준일 가격
    const allTickers  = Object.values(ALL_STOCKS);
    const multiData   = await fetchMultiClose(Object.values(ALL_STOCKS).slice(0, 30), BASE_DATE);

    // 멤버 카드 렌더링
    const memberCardsEl = document.getElementById('member-cards');
    memberCardsEl.innerHTML = '';
    let allReturns = [];

    Object.entries(MEMBERS).forEach(([member, stocks]) => {
      const card = document.createElement('div');
      card.className = 'member-card';

      let memberRetSum = 0, memberCount = 0;
      let stockRows = '';

      Object.entries(stocks).forEach(([name, ticker]) => {
        const d = multiData[ticker];
        if (!d || !d.closes.length) {
          stockRows += `<div class="stock-row"><span>${name}</span><span class="text-matrix/30">N/A</span></div>`;
          return;
        }
        const validCloses = d.closes.filter(v => v !== null);
        if (validCloses.length < 2) return;
        const ret = ((validCloses[validCloses.length - 1] - validCloses[0]) / validCloses[0]) * 100;
        const cls = ret >= 0 ? 'ret-pos' : 'ret-neg';
        const sign = ret >= 0 ? '+' : '';
        stockRows += `<div class="stock-row"><span>${name}</span><span class="${cls}">${sign}${ret.toFixed(1)}%</span></div>`;
        memberRetSum += ret; memberCount++;
        allReturns.push({ name, ticker, ret, member });
      });

      const memberAvg = memberCount ? memberRetSum / memberCount : 0;
      const avgCls = memberAvg >= 0 ? 'text-matrix' : 'text-crimson';
      const avgSign = memberAvg >= 0 ? '+' : '';

      card.innerHTML = `
        <div class="member-name">👤 ${member}</div>
        <div class="text-xs ${avgCls} mb-2">평균: ${avgSign}${memberAvg.toFixed(1)}%</div>
        ${stockRows}
      `;
      memberCardsEl.appendChild(card);
    });

    // KPI 업데이트
    if (allReturns.length) {
      const totalAvg = allReturns.reduce((s, r) => s + r.ret, 0) / allReturns.length;
      const top      = [...allReturns].sort((a, b) => b.ret - a.ret)[0];
      const bot      = [...allReturns].sort((a, b) => a.ret - b.ret)[0];

      const setKPI = (id, val, cls) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = val; if (cls) el.className = `kpi-value ${cls}`; }
      };
      setKPI('kpi-total-return', `${totalAvg >= 0 ? '+' : ''}${totalAvg.toFixed(2)}%`, totalAvg >= 0 ? 'text-matrix' : 'text-crimson');
      setKPI('kpi-top-stock', `${top.name} +${top.ret.toFixed(1)}%`);
      setKPI('kpi-bot-stock', `${bot.name} ${bot.ret.toFixed(1)}%`);
      setKPI('kpi-members', Object.keys(MEMBERS).length + '명');

      // 히트맵 (전종목 수익률)
      const sorted = [...allReturns].sort((a, b) => b.ret - a.ret).slice(0, 25);
      Plotly.newPlot('chart-heatmap', [{
        x: sorted.map(r => r.name),
        y: sorted.map(r => r.ret),
        type: 'bar',
        marker: {
          color: sorted.map(r => r.ret),
          colorscale: [[0, '#444444'], [0.5, '#111111'], [1, '#ffffff']],
          cmin: Math.min(...sorted.map(r => r.ret)),
          cmax: Math.max(...sorted.map(r => r.ret)),
        },
        text: sorted.map(r => `${r.ret.toFixed(1)}%`),
        textposition: 'outside',
        textfont: { size: 9 },
      }], {
        ...DARK_LAYOUT,
        yaxis: { ...DARK_LAYOUT.yaxis, title: '수익률 (%)' },
        margin: { l: 50, r: 20, t: 20, b: 80 },
        xaxis: { ...DARK_LAYOUT.xaxis, tickangle: -35, tickfont: { size: 9 } },
      }, PLOTLY_CONFIG);
    }

  } catch (e) {
    console.error('[dashboard] load error:', e);
    document.getElementById('member-cards').innerHTML =
      `<div class="card text-crimson text-xs">데이터 로드 실패: ${e.message}<br>Supabase Edge Function 설정 확인 필요</div>`;
  } finally {
    hideLoading();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  수익률 탭
// ══════════════════════════════════════════════════════════════════════

function initReturnTab() {
  document.getElementById('ret-load-btn').addEventListener('click', async () => {
    const member = document.getElementById('ret-member').value;
    showLoading('수익률 로딩 중...');
    try { await loadReturns(member); }
    catch (e) { console.error(e); }
    finally { hideLoading(); }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  리스크 탭
// ══════════════════════════════════════════════════════════════════════

function initRiskTab() {
  document.getElementById('risk-run-btn').addEventListener('click', async () => {
    const sel = [...document.getElementById('risk-stocks').selectedOptions].map(o => o.value);
    if (sel.length < 2) { alert('종목을 2개 이상 선택하세요'); return; }
    const inv  = parseFloat(document.getElementById('risk-investment').value) || 1000;
    const conf = parseFloat(document.getElementById('risk-conf').value) || 0.95;
    showLoading('리스크 분석 중...');
    try { await runRiskAnalysis(sel, inv, conf); }
    catch (e) { console.error(e); }
    finally { hideLoading(); }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  포트폴리오 탭
// ══════════════════════════════════════════════════════════════════════

function initPortfolioTab() {
  document.getElementById('port-run-btn').addEventListener('click', async () => {
    const sel = [...document.getElementById('port-stocks').selectedOptions].map(o => o.value);
    if (sel.length < 2) { alert('종목을 2개 이상 선택하세요'); return; }
    const rf   = parseFloat(document.getElementById('port-rf').value) || 3.5;
    const nSim = parseInt(document.getElementById('port-nsim').value) || 2000;
    showLoading('포트폴리오 최적화 중...');
    try { await runPortfolioOptimization(sel, rf, nSim); }
    catch (e) { console.error(e); }
    finally { hideLoading(); }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  종목분석 탭
// ══════════════════════════════════════════════════════════════════════

function initAnalysisTab() {
  document.getElementById('ana-run-btn').addEventListener('click', async () => {
    const stock = document.getElementById('ana-stock').value;
    if (!stock) { alert('종목을 선택하세요'); return; }
    showLoading(`${stock} 분석 중...`);
    try { await runAnalysis(stock); }
    catch (e) { console.error(e); document.getElementById('ana-status').textContent = `오류: ${e.message}`; }
    finally { hideLoading(); }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  로딩 오버레이
// ══════════════════════════════════════════════════════════════════════

function showLoading(msg = '로딩 중...') {
  const el = document.getElementById('loading-overlay');
  const mg = document.getElementById('loading-msg');
  if (el) el.classList.remove('hidden');
  if (mg) mg.textContent = msg;
}
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('hidden');
}

window._ttApp = { switchTab, showLoading, hideLoading };
