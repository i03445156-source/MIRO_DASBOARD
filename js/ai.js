// ══════════════════════════════════════════════════════════════════════
//  ai.js  — Gemini API 채팅 (REST API 직접 호출)
// ══════════════════════════════════════════════════════════════════════

import { GEMINI_API_KEY_DEFAULT } from './config.js';

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `당신은 MIRO 대시보드의 전문 AI-CFO입니다. 티타임 투자 클럽(TT)의 포트폴리오를 관리하며 아래 데이터를 기반으로 종합 투자 보고서와 분석을 제공합니다.

━━━ 티타임 멤버별 포트폴리오 (기준일: 2026-03-13) ━━━

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

항상 한국어로 답변하고, 수치는 구체적으로 인용하며, 투자 책임은 투자자 본인에게 있음을 명시하세요.`;

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
  const typingId = appendMessage('bot', '<span class="chat-msg-typing">분석 중...</span>');

  conversationHistory.push({ role: 'user', parts: [{ text }] });

  try {
    const reply = await callGeminiAPI(apiKey, conversationHistory);
    updateMessage(typingId, reply);
    conversationHistory.push({ role: 'model', parts: [{ text: reply }] });
    if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);
  } catch (e) {
    updateMessage(typingId, `❌ 오류: ${e.message}`);
  } finally {
    input.disabled    = false;
    document.getElementById('ai-send-btn').disabled = false;
    input.focus();
  }
}

// ── Gemini REST API 호출 ────────────────────────────────────────────

async function callGeminiAPI(apiKey, history) {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  const resp = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '응답 없음';
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
