// ══════════════════════════════════════════════════════════════════════
//  ai.js  — Gemini API 채팅 (REST API 직접 호출)
// ══════════════════════════════════════════════════════════════════════

import { GEMINI_API_KEY_DEFAULT, ALL_STOCKS } from './config.js';
import { runAnalysis } from './analysis.js';

// 텍스트 생성 모델 폴백 체인 — 429/503/500 발생 시 순서대로 자동 전환
const MODEL_CHAIN = [
  'gemini-2.5-flash',       // primary  (rpm:5,  rpd:20)
  'gemini-3-flash',         // latest   (rpm:5,  rpd:20)
  'gemini-3.1-flash-lite',  // light    (rpm:15, rpd:500)
  'gemma-4-31b',            // open     (rpm:15, rpd:1500)
  'gemma-3-27b',            // fallback (rpm:30, rpd:14400)
];
const RETRYABLE = new Set([429, 500, 503]);
let modelIdx = 0;  // 세션 내 현재 사용 모델 인덱스

function modelApiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function buildSystemPrompt() {
  const today = new Date().toISOString().split('T')[0];
  return `당신은 MIRO 대시보드의 전문 AI-CFO입니다. 티타임 투자 클럽(TT)의 포트폴리오를 관리하며 아래 데이터를 기반으로 종합 투자 보고서와 분석을 제공합니다.

오늘 날짜: ${today}
모든 분석과 보고서는 오늘(${today}) 기준으로 작성하세요. 수익률 비교는 포트폴리오 편입 기준일(2026-03-13) 대비로 계산합니다.

━━━ 티타임 멤버별 포트폴리오 (편입 기준일: 2026-03-13) ━━━

▶ 김승년: 삼성전자(005930.KS) — HBM·AI 반도체 / 롯데케미칼(011170.KS) — 석유화학 밸류주
▶ 정선경: 삼성SDI(006400.KS) — 전고체 배터리 / 휴메딕스(200670.KQ) — HA 필러 성장
▶ 노문재: 현대마린엔진(071970.KS), 한화엔진(082740.KS) — 조선 사이클 / 한화생명(088350.KS) — 밸류업 / NAVER(035420.KS) — 플랫폼
▶ 윤창숙: 효성중공업(298040.KS), LS일렉트릭(010120.KS), HD현대일렉트릭(267260.KS) — 전력기기 AI데이터센터 수혜
▶ 박은기: 메리츠금융지주(138040.KS) — PER 10배 공언 / 한전KPS(051600.KS) — 배당 3.5% / 기아(000270.KS) — 배당 성장
▶ 최명식: 한미반도체(042700.KS) — HBM CoS 본딩 독점 / 메지온(140410.KQ) — 3상 임상 PRV
▶ 김시완: 삼성전자(005930.KS) — HBF 차세대 메모리 / 에이디테크놀로지(200710.KQ) — ASIC 추론AI
▶ 추혜경: 미래에셋증권(006800.KS) — 스페이스X IPO 수혜 / RFHIC(218410.KQ) — GaN 방산
▶ 유정윤: 삼성SDI(006400.KS) — 전고체 / LG화학(051910.KS) — 배터리 소재 / 롯데에너지머티리얼즈(020150.KS) — 동박
▶ 박진애: 현대로템(064350.KS) — 방산 / 두산에너빌리티(034020.KS) — 원전·가스터빈 / 킵스파마(082800.KS) — 영장류 임상
▶ 박지환: 한국카본(017960.KS) — LNG 보냉재 독점 / 에이디테크놀로지(200710.KQ) — ASIC
▶ 이경득: QQQ(나스닥100), VOO(S&P500) — 패시브 인덱스
▶ 이승현: 이더리움(ETH-USD) — ETF 기관수요 / 서클(CRCL) — USDC 스테이블코인 IPO
▶ 이세진: BITX(비트코인 2배 레버리지), COIN(코인베이스)
▶ 장효원: LG화학(051910.KS) — 유가수혜 / 트랜스오션(RIG), 시드릴(SDRL) — 드릴쉽 쇼티지
▶ 하종호: 금호석유화학(011780.KS) — 합성고무 / 옵티코어(049080.KQ) — 광트랜시버 800G
▶ 김은지: 티웨이항공(091810.KS), 메가스터디(072870.KQ), QQQ, SPY, DJT(트루스소셜)
▶ 여동호: 엘앤에프(066970.KS), LS머트리얼즈(417200.KQ), SKC(011790.KS)

━━━ MIRO 대시보드 분석 도구 ━━━
• 수익률 추적기 (기준일 2026-03-13 대비 누적 수익률)
• VaR 리스크 분석 (95%/99% 신뢰수준, MDD 포함)
• 종목 간 상관관계 히트맵
• 마코위츠 최적 포트폴리오 (Monte Carlo 효율적 프론티어)
• Monte Carlo 스트레스 테스트 (252 영업일)
• 기술적 분석: RSI(14), MA20/60/200, 볼린저밴드, 그랜빌 신호
• 4모델 예측: ARIMA · LSTM · Transformer · Prophet (30일)
• 매크로: 환율(Frankfurter), 금리(FRED), 레포·VIX

━━━ 보고서 작성 가이드 ━━━
종합 투자 보고서 요청 시 다음 구조로 작성하세요:
1. **포트폴리오 현황** — 멤버별 테마 및 수익률 흐름 요약
2. **기술적 분석** — RSI, 이동평균 배열, 그랜빌 신호 해석
3. **리스크 평가** — VaR, MDD, 종목 간 상관관계
4. **예측 모델 종합** — ARIMA/LSTM/Transformer/Prophet 컨센서스
5. **투자 의견** — 매수/중립/매도 + 목표가 근거
6. **매크로 체크** — 환율·금리·레포 환경이 포트폴리오에 미치는 영향
7. **주의사항** — 주요 리스크 요인

━━━ 데이터 원칙 ━━━
• 시스템 지시문 하단에 "MIRO 현재 로드된 yfinance 실데이터" 블록이 있으면 그 숫자를 사실로 사용하라. 대시보드가 yfinance에서 직접 수집한 실제 데이터다.
• 해당 블록에 없는 종목의 주가·수익률은 절대 임의로 만들지 말고, 사용자에게 요청하라.
• 예측 모델 수치(ARIMA/LSTM/Transformer/Prophet)가 블록에 있으면 그것을 근거로 투자 의견을 제시하라.

항상 한국어로 답변하고, 투자 책임은 투자자 본인에게 있음을 명시하세요.`;
}

let conversationHistory = [];

// ── 초기화 ─────────────────────────────────────────────────────────

export function initAI() {
  const savedKey = localStorage.getItem('tt_gemini_key') || GEMINI_API_KEY_DEFAULT;
  if (savedKey) {
    localStorage.setItem('tt_gemini_key', savedKey);
    document.getElementById('ai-api-key').value = savedKey;
    enableChat();
  }

  document.getElementById('ai-key-save-btn').addEventListener('click', () => {
    const key = document.getElementById('ai-api-key').value.trim();
    if (!key) return;
    localStorage.setItem('tt_gemini_key', key);
    enableChat();
    appendMessage('bot', '✅ API 키가 저장되었습니다. 이제 질문을 입력하세요.');
  });

  document.getElementById('ai-send-btn').addEventListener('click', sendUserMessage);
  document.getElementById('ai-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserMessage(); }
  });
}

function enableChat() {
  document.getElementById('ai-input').disabled    = false;
  document.getElementById('ai-send-btn').disabled = false;
  document.getElementById('ai-input').placeholder = '>> 종목 분석, 보고서 작성, 포트폴리오 질문...';
}

// ── 메시지 전송 ────────────────────────────────────────────────────

async function sendUserMessage() {
  const input  = document.getElementById('ai-input');
  const text   = input.value.trim();
  if (!text) return;

  const apiKey = localStorage.getItem('tt_gemini_key');
  if (!apiKey) {
    appendMessage('bot', '⚠ API 키를 먼저 입력하고 저장하세요.');
    return;
  }

  input.value    = '';
  input.disabled = true;
  document.getElementById('ai-send-btn').disabled = true;

  appendMessage('user', text);
  const typingId = appendMessage('bot', '<span class="chat-msg-typing">데이터 로딩 중...</span>');

  // 질문에서 종목명 감지 → 백그라운드로 자동 분석 실행
  const detectedStock = Object.keys(ALL_STOCKS).find(name => text.includes(name));
  if (detectedStock && window._ttDashData?.analysis?.stock !== detectedStock) {
    updateMessage(typingId, `<span class="chat-msg-typing">${detectedStock} 실데이터 수집 중...</span>`);
    await runAnalysis(detectedStock).catch(() => {});
  }

  updateMessage(typingId, '<span class="chat-msg-typing">분석 중...</span>');
  conversationHistory.push({ role: 'user', parts: [{ text }] });

  try {
    const { text, model } = await callGeminiAPI(apiKey, conversationHistory);
    const notice = model !== MODEL_CHAIN[0]
      ? `<span style="display:block;font-size:10px;color:#71717a;margin-bottom:6px">↪ ${model} 사용 중 (2.5-flash 과부하 자동 전환)</span>`
      : '';
    updateMessage(typingId, notice + text);
    conversationHistory.push({ role: 'model', parts: [{ text }] });
    if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);
  } catch (e) {
    updateMessage(typingId, `❌ 오류: ${e.message}`);
  } finally {
    input.disabled    = false;
    document.getElementById('ai-send-btn').disabled = false;
    input.focus();
  }
}

// ── 대시보드 실데이터 컨텍스트 빌드 ──────────────────────────────────

function buildDashboardContext() {
  const d = window._ttDashData;
  if (!d) return '';
  const lines = [];

  if (d.analysis) {
    const a = d.analysis;
    const isKR = a.ticker.endsWith('.KS') || a.ticker.endsWith('.KQ');
    const fmt = v => v != null ? (isKR ? Number(v).toLocaleString() + '원' : String(v)) : '--';
    lines.push(`[종목분석] ${a.stock} (${a.ticker}) — 기준: ${a.date}`);
    lines.push(`현재가: ${fmt(a.price)} | RSI(14): ${a.rsi ?? '--'}`);
    lines.push(`MA20: ${fmt(a.ma20)} / MA60: ${fmt(a.ma60)} / MA200: ${fmt(a.ma200)} → ${a.maSignal ?? '--'}`);
    lines.push(`200일선 괴리율: ${a.disparity}% | 그랜빌: ${a.granville}${a.granvilleDesc ? ' — ' + a.granvilleDesc : ''}`);
    lines.push(`30일 예측 (yfinance 실데이터 기반):`);
    lines.push(`  ARIMA: ${fmt(a.predictions.arima.price)} (${a.predictions.arima.pct}%)`);
    lines.push(`  LSTM: ${fmt(a.predictions.lstm.price)} (${a.predictions.lstm.pct}%)`);
    lines.push(`  Transformer: ${fmt(a.predictions.transformer.price)} (${a.predictions.transformer.pct}%)`);
    lines.push(`  Prophet: ${fmt(a.predictions.prophet.price)} (${a.predictions.prophet.pct}%)`);
  }

  if (d.returns?.stocks?.length) {
    lines.push(`[수익률] ${d.returns.member === '__all__' ? '전체 멤버' : d.returns.member} — 기준일: 2026-03-13`);
    d.returns.stocks.forEach(s => lines.push(`  ${s.name} (${s.ticker}): ${s.ret}%`));
  }

  return lines.length
    ? '\n\n━━━ MIRO 현재 로드된 yfinance 실데이터 ━━━\n' + lines.join('\n')
    : '';
}

// ── Gemini REST API 호출 (모델 폴백 포함) ──────────────────────────

async function callGeminiAPI(apiKey, history) {
  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() + buildDashboardContext() }] },
    contents: history,
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };

  let lastError;

  for (let i = modelIdx; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];

    // 네트워크 호출
    let resp;
    try {
      resp = await fetch(`${modelApiUrl(model)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      lastError = networkErr;
      if (i < MODEL_CHAIN.length - 1) {
        console.warn(`[AI] ${model} 네트워크 오류 → ${MODEL_CHAIN[i + 1]} 시도`);
        continue;
      }
      break;
    }

    // 재시도 가능한 HTTP 오류 (429 / 500 / 503)
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      lastError = new Error(err?.error?.message || `HTTP ${resp.status}`);
      if (RETRYABLE.has(resp.status) && i < MODEL_CHAIN.length - 1) {
        console.warn(`[AI] ${model} HTTP ${resp.status} → ${MODEL_CHAIN[i + 1]} 전환`);
        modelIdx = i + 1;
        continue;
      }
      throw lastError;
    }

    // 성공 — 이 모델을 세션에 고정
    modelIdx = i;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '응답 없음';
    return { text, model };
  }

  throw lastError || new Error('사용 가능한 모델 없음');
}

// ── UI 헬퍼 ───────────────────────────────────────────────────────

let msgCounter = 0;

function appendMessage(role, html) {
  const container = document.getElementById('ai-messages');
  const id        = `msg-${++msgCounter}`;
  const div       = document.createElement('div');
  div.id          = id;
  div.className   = role === 'user' ? 'chat-msg-user' : 'chat-msg-bot';
  div.innerHTML   = role === 'bot'
    ? `<span class="text-cyber text-xs">[AI-CFO]</span> ${formatMarkdown(html)}`
    : html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function updateMessage(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span class="text-cyber text-xs">[AI-CFO]</span> ${formatMarkdown(html)}`;
  document.getElementById('ai-messages').scrollTop = 9999;
}

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code style="background:#f4f4f5;padding:1px 4px;border-radius:2px;font-size:11px">$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

window._ttAI = { initAI };
