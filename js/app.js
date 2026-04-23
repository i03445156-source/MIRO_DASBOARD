// ══════════════════════════════════════════════════════════════════════
//  app.js  — 앱 초기화, 탭 라우팅, 이벤트 리스너
// ══════════════════════════════════════════════════════════════════════

import { MEMBERS, ALL_STOCKS, BASE_DATE, COLORS, DARK_LAYOUT, PLOTLY_CONFIG, PYTHON_API_URL } from './config.js';
import { loadReturns, runRiskAnalysis, runPortfolioOptimization } from './portfolio.js';
import { runAnalysis } from './analysis.js';
import { loadMacroTab } from './macro.js';
import { initAI } from './ai.js';
import { loadAndRenderRankings } from './community.js';

// ══════════════════════════════════════════════════════════════════════
//  앱 부트스트랩
// ══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  warmupBackend();
  initHeader();
  initTabs();
  populateSelects();
  initReturnTab();
  initRiskTab();
  initPortfolioTab();
  initAnalysisTab();
  initAI();
});

// Render.com 무료 티어는 15분 비활동 시 슬립 → 페이지 로드 시 미리 깨워둠
function warmupBackend() {
  if (!PYTHON_API_URL || PYTHON_API_URL.includes('YOUR-APP')) return;
  fetch(`${PYTHON_API_URL}/`, { signal: AbortSignal.timeout(15000) })
    .catch(() => {});
}

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
      krxEl.style.color = open ? '#16a34a' : '#a1a1aa';
    }
    if (nyseEl) {
      const open = dow >= 1 && dow <= 5 && (totalMin >= 1410 || totalMin < 360);
      nyseEl.textContent = open ? 'OPEN' : 'CLOSED';
      nyseEl.style.color = open ? '#16a34a' : '#a1a1aa';
    }
  }
  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════════════
//  탭 라우팅
// ══════════════════════════════════════════════════════════════════════

let macroLoaded = false;
let aiReturnsLoaded = false;

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

  // 탭 전환 후 Plotly responsive 재측정 (hidden→visible 시 width 0 문제 해결)
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);

  // 매크로 탭은 처음 열 때만 로드
  if (tabId === 'macro' && !macroLoaded) {
    macroLoaded = true;
    loadMacroTab();
  }

  // AI 탭 열면 전체 멤버 수익률을 백그라운드로 자동 로드 (AI 컨텍스트용)
  if (tabId === 'ai' && !aiReturnsLoaded) {
    aiReturnsLoaded = true;
    loadReturns('__all__').catch(() => {});
  }

  // 랭킹 탭 열릴 때마다 최신 데이터 로드
  if (tabId === 'ranking') {
    loadAndRenderRankings();
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

  // 종목분석 탭 - 전체 종목 드롭다운 + 기본 종목 자동 로드
  fillSelect('ana-stock', stockNames.map(n => ({ value: n, label: `${n}  (${ALL_STOCKS[n]})` })));
  const defaultStock = stockNames.includes('삼성전자') ? '삼성전자' : stockNames[0];
  if (defaultStock) {
    const el = document.getElementById('ana-stock');
    if (el) el.value = defaultStock;
    showLoading(`${defaultStock} 분석 중...`);
    runAnalysis(defaultStock).catch(console.error).finally(hideLoading);
  }
}

function fillSelect(id, items, isMulti = false, defaults = []) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(item =>
    `<option value="${item.value}" ${defaults.includes(item.value) ? 'selected' : ''}>${item.label}</option>`
  ).join('');
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
