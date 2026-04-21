// ══════════════════════════════════════════════════════════════════════
//  ai.js  — Gemini API 채팅 (google.generativeai 대신 REST API 사용)
//  GitHub Pages에서 직접 Gemini REST API 호출
// ══════════════════════════════════════════════════════════════════════

import { GEMINI_API_KEY_DEFAULT } from './config.js';

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `당신은 TT 포트폴리오의 전문 AI-CFO입니다.
티 타임 멤버들의 포트폴리오를 관리하며 다음 분석 도구를 보유합니다:
- 수익률 추적기 (기준일: 2026-03-13)
- VaR 리스크 분석
- 마코위츠 최적 포트폴리오
- RSI/이동평균 기술적 분석
- GARCH Monte Carlo 예측
- 환율/금리/레포 매크로 지표

투자 분석, 리스크 평가, 종목 추천, 시장 현황 등을 전문적이고 간결하게 답변하세요.
한국어로 답변하되 전문 용어는 영문 병기하세요.`;

let conversationHistory = [];

// ── 초기화 ─────────────────────────────────────────────────────────

export function initAI() {
  // localStorage 저장 키 없으면 config 기본값 사용
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
  document.getElementById('ai-input').placeholder = '>> 투자 질문을 입력하세요...';
}

// ── 메시지 전송 ────────────────────────────────────────────────────

async function sendUserMessage() {
  const input = document.getElementById('ai-input');
  const text  = input.value.trim();
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
    // 히스토리 최대 20개 유지
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
      maxOutputTokens: 1024,
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

// 간단한 마크다운 → HTML 변환
function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code style="background:#1a1a1a;padding:1px 4px;border-radius:2px">$1</code>')
    .replace(/\n/g, '<br>');
}

window._ttAI = { initAI };
