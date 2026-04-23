// ══════════════════════════════════════════════════════════════════════
//  community.js  — 분석 결과 자동 저장 + 커뮤니티 랭킹 렌더링
//
//  Supabase SQL Editor에서 아래 SQL을 한 번만 실행하세요:
//  ──────────────────────────────────────────────────────────
//  CREATE TABLE results (
//    id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
//    created_at timestamptz DEFAULT now(),
//    type       text        NOT NULL,   -- 'portfolio' | 'stock'
//    stocks     text[]      NOT NULL,   -- 종목명 배열
//    score      float,                  -- 샤프비율(portfolio) | 4모델 평균 예측%(stock)
//    data       jsonb       NOT NULL    -- 상세 결과
//  );
//  ALTER TABLE results ENABLE ROW LEVEL SECURITY;
//  CREATE POLICY "public read"   ON results FOR SELECT USING (true);
//  CREATE POLICY "public insert" ON results FOR INSERT WITH CHECK (true);
//  ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

import { SUPABASE_URL, SUPABASE_ANON_KEY, DARK_LAYOUT, PLOTLY_CONFIG } from './config.js';

const BASE = `${SUPABASE_URL}/rest/v1/results`;
const AUTH = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

// ── 저장 ──────────────────────────────────────────────────────────────

export async function saveResult(type, stocks, score, data) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(BASE, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ type, stocks, score, data }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (e) {
    console.warn('[community] 저장 실패:', e.message);
  }
}

// ── 불러오기 ───────────────────────────────────────────────────────────

async function fetchRows(type, limit = 500) {
  try {
    const resp = await fetch(
      `${BASE}?type=eq.${type}&order=created_at.desc&limit=${limit}`,
      { headers: AUTH, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ── 메인 ──────────────────────────────────────────────────────────────

export async function loadAndRenderRankings() {
  const statusEl = document.getElementById('rank-status');
  if (statusEl) statusEl.textContent = '집계 중...';

  const [portRows, stockRows] = await Promise.all([
    fetchRows('portfolio', 300),
    fetchRows('stock', 500),
  ]);

  renderPortfolioTop(portRows);
  renderPopularityChart(stockRows);
  renderPredictionTop(stockRows);

  if (statusEl) {
    const total = portRows.length + stockRows.length;
    statusEl.textContent = total
      ? `총 ${total}건 집계 (포트폴리오 ${portRows.length} · 종목분석 ${stockRows.length})`
      : '데이터 없음 — 각 탭에서 분석을 실행하면 자동으로 쌓입니다';
  }
}

// ── 포트폴리오 조합 TOP ────────────────────────────────────────────────

function renderPortfolioTop(rows) {
  document.getElementById('rank-total-port').textContent = `${rows.length}건`;

  // 종목 조합 key 기준으로 최고 샤프비율만 남기기
  const combos = {};
  rows.forEach(r => {
    if (!r.stocks?.length || r.score == null) return;
    const key = [...r.stocks].sort().join('|');
    if (!combos[key] || r.score > combos[key].score) {
      combos[key] = { stocks: r.stocks, score: r.score, data: r.data, count: 0 };
    }
    combos[key].count++;
  });

  const top = Object.values(combos).sort((a, b) => b.score - a.score).slice(0, 10);
  const tbody = document.getElementById('rank-portfolio-body');
  if (!tbody) return;

  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-xs text-matrix/40 py-8">포트폴리오 탭에서 최적화를 실행하면 여기에 쌓입니다</td></tr>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  tbody.innerHTML = top.map((r, i) => {
    const sharpeClass = r.score >= 1.5 ? 'text-green-600' : r.score >= 0.8 ? 'text-gold' : 'text-crimson';
    const retStr = r.data?.ret != null ? `${r.data.ret >= 0 ? '+' : ''}${r.data.ret.toFixed(1)}%` : '--';
    const volStr = r.data?.vol != null ? `${r.data.vol.toFixed(1)}%` : '--';
    const label  = [...r.stocks].sort().join(' · ');
    return `
      <tr class="${i < 3 ? 'font-medium bg-zinc-50/60' : ''}">
        <td class="text-center w-8">${medals[i] ?? i + 1}</td>
        <td class="text-xs leading-relaxed">${label}</td>
        <td class="${sharpeClass} text-right tabular-nums font-bold">${r.score.toFixed(3)}</td>
        <td class="text-right tabular-nums text-xs text-matrix/60">${retStr}</td>
        <td class="text-right text-matrix/40 text-xs">${r.count}회</td>
      </tr>`;
  }).join('');
}

// ── 종목 인기도 차트 ───────────────────────────────────────────────────

function renderPopularityChart(rows) {
  document.getElementById('rank-total-stock').textContent = `${rows.length}건`;

  const counts = {};
  rows.forEach(r => {
    if (r.stocks?.[0]) counts[r.stocks[0]] = (counts[r.stocks[0]] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!sorted.length) return;

  const names  = sorted.map(([k]) => k).reverse();
  const values = sorted.map(([, v]) => v).reverse();
  // 1위는 빨강, 나머지 파랑
  const colors = values.map((_, i) => i === values.length - 1 ? '#dc2626' : '#2563eb');

  Plotly.newPlot('chart-rank-popular', [{
    type: 'bar',
    orientation: 'h',
    x: values,
    y: names,
    marker: { color: colors, opacity: 0.85 },
    text: values.map(v => `${v}회`),
    textposition: 'outside',
    textfont: { size: 10, color: '#09090b' },
    hovertemplate: '%{y}: %{x}회<extra></extra>',
  }], {
    ...DARK_LAYOUT,
    height: Math.max(280, sorted.length * 28 + 40),
    margin: { l: 110, r: 70, t: 10, b: 30 },
    xaxis: { ...DARK_LAYOUT.xaxis, title: '분석 횟수' },
    yaxis: { ...DARK_LAYOUT.yaxis, automargin: true, tickfont: { size: 11 } },
  }, PLOTLY_CONFIG);

  setTimeout(() => {
    const el = document.getElementById('chart-rank-popular');
    if (el && window.Plotly) Plotly.Plots.resize(el);
  }, 150);
}

// ── 예측 수익률 TOP ────────────────────────────────────────────────────

function renderPredictionTop(rows) {
  const groups = {};
  rows.forEach(r => {
    if (!r.stocks?.[0] || r.score == null) return;
    const nm = r.stocks[0];
    if (!groups[nm]) groups[nm] = { scores: [], ticker: r.data?.ticker };
    groups[nm].scores.push(r.score);
  });

  const top = Object.entries(groups)
    .map(([name, g]) => ({
      name,
      ticker: g.ticker ?? '',
      avg: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
      best: Math.max(...g.scores),
      count: g.scores.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  const tbody = document.getElementById('rank-pred-body');
  if (!tbody) return;

  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-xs text-matrix/40 py-8">종목분석 탭에서 분석을 실행하면 여기에 쌓입니다</td></tr>';
    return;
  }

  const icons = ['🔥', '📈', '✨'];
  tbody.innerHTML = top.map((r, i) => {
    const pos = r.avg >= 0;
    const cls = pos ? 'text-green-600' : 'text-crimson';
    return `
      <tr class="${i < 3 ? 'font-medium bg-zinc-50/60' : ''}">
        <td class="text-center w-8">${icons[i] ?? i + 1}</td>
        <td>${r.name} <span class="text-matrix/30 text-xs">${r.ticker}</span></td>
        <td class="${cls} text-right tabular-nums font-bold">${pos ? '+' : ''}${r.avg.toFixed(2)}%</td>
        <td class="text-right tabular-nums text-xs text-matrix/50">${pos ? '+' : ''}${r.best.toFixed(2)}%</td>
        <td class="text-right text-matrix/40 text-xs">${r.count}회</td>
      </tr>`;
  }).join('');
}

window._ttCommunity = { saveResult, loadAndRenderRankings };
