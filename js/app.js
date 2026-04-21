// ══════════════════════════════════════════════════════════════════════
//  app.js  — 앱 초기화, 탭 라우팅, 이벤트 리스너
// ══════════════════════════════════════════════════════════════════════

import { MEMBERS, ALL_STOCKS, BASE_DATE, COLORS, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';
import { fetchMultiClose, fetchLatestPrices } from './api.js';
import { loadReturns, runRiskAnalysis, runPortfolioOptimization, cumReturns, pctReturns } from './portfolio.js';
import { runTechnicalAnalysis } from './technical.js';
import { runPredictionModel } from './models.js';
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
  initTechnicalTab();
  initModelsTab();
  initAI();
  loadDashboard();           // 첫 화면 데이터 로드
});

// ══════════════════════════════════════════════════════════════════════
//  헤더 시계
// ══════════════════════════════════════════════════════════════════════

function initHeader() {
  function tick() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
    const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
    const el = document.getElementById('hdr-date');
    if (el) el.textContent = `${dateStr} ${timeStr}`;

    // 시장 상태 (KST 09:00~15:30 / EST 09:30~16:00)
    const h = now.getHours(), m = now.getMinutes();
    const totalMin = h * 60 + m;
    const krxEl  = document.getElementById('hdr-krx');
    const nyseEl = document.getElementById('hdr-nyse');
    const dow = now.getDay();

    if (krxEl) {
      const isKrxOpen = dow >= 1 && dow <= 5 && totalMin >= 540 && totalMin < 930;
      krxEl.textContent = isKrxOpen ? 'OPEN' : 'CLOSED';
      krxEl.className   = isKrxOpen ? 'text-matrix' : 'text-crimson';
    }
    if (nyseEl) {
      // UTC+9 기준 NYSE: 22:30 ~ 05:00 (다음날)
      const utcMin = (h * 60 + m + (now.getTimezoneOffset())) % 1440;
      // 간단히 KST 23:30 ~ 다음날 06:00 으로 근사
      const isNyseOpen = dow >= 1 && dow <= 5 && (totalMin >= 1410 || totalMin < 360);
      nyseEl.textContent = isNyseOpen ? 'OPEN' : 'CLOSED';
      nyseEl.className   = isNyseOpen ? 'text-matrix' : 'text-matrix/40';
    }

    const updEl = document.getElementById('hdr-update');
    if (updEl) updEl.textContent = timeStr;
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

  // 기술분석 탭 - 멤버 + 종목
  const taMemSel = document.getElementById('ta-member');
  fillSelect('ta-member', [{ value: '__all__', label: '전체' }, ...memberNames.map(n => ({ value: n, label: n }))]);
  taMemSel.addEventListener('change', () => updateTaStockSelect(taMemSel.value));
  updateTaStockSelect('__all__');

  // 예측 탭 - 멤버 + 종목
  const modMemSel = document.getElementById('mod-member');
  fillSelect('mod-member', [{ value: '__all__', label: '전체' }, ...memberNames.map(n => ({ value: n, label: n }))]);
  modMemSel.addEventListener('change', () => updateModStockSelect(modMemSel.value));
  updateModStockSelect('__all__');
}

function fillSelect(id, items, isMulti = false, defaults = []) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(item =>
    `<option value="${item.value}" ${defaults.includes(item.value) ? 'selected' : ''}>${item.label}</option>`
  ).join('');
}

function updateTaStockSelect(memberKey) {
  const stocks = memberKey === '__all__'
    ? Object.keys(ALL_STOCKS).sort()
    : Object.keys(MEMBERS[memberKey] || {});
  fillSelect('ta-stock', stocks.map(n => ({ value: n, label: n })));
}

function updateModStockSelect(memberKey) {
  const stocks = memberKey === '__all__'
    ? Object.keys(ALL_STOCKS).sort()
    : Object.keys(MEMBERS[memberKey] || {});
  fillSelect('mod-stock', stocks.map(n => ({ value: n, label: n })));
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
          colorscale: [[0, '#FF3333'], [0.5, '#1a1a1a'], [1, '#00FF41']],
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
//  기술분석 탭
// ══════════════════════════════════════════════════════════════════════

function initTechnicalTab() {
  document.getElementById('ta-run-btn').addEventListener('click', async () => {
    const stock    = document.getElementById('ta-stock').value;
    const strategy = document.getElementById('ta-strategy').value;
    const rsiP     = parseInt(document.getElementById('ta-rsi-period').value) || 14;
    if (!stock) { alert('종목을 선택하세요'); return; }
    showLoading(`${stock} 기술적 분석 중...`);
    try { await runTechnicalAnalysis(stock, strategy, rsiP); }
    catch (e) { console.error(e); }
    finally { hideLoading(); }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  예측 모델 탭
// ══════════════════════════════════════════════════════════════════════

function initModelsTab() {
  document.getElementById('mod-run-btn').addEventListener('click', async () => {
    const stock = document.getElementById('mod-stock').value;
    const days  = parseInt(document.getElementById('mod-days').value) || 30;
    const nSim  = parseInt(document.getElementById('mod-nsim').value) || 500;
    if (!stock) { alert('종목을 선택하세요'); return; }
    showLoading(`${stock} 예측 모델 실행 중 (${nSim}회)...`);
    try { await runPredictionModel(stock, days, nSim); }
    catch (e) { console.error(e); }
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
