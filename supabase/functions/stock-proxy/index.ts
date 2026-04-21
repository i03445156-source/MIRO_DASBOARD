// ══════════════════════════════════════════════════════════════════════
//  Supabase Edge Function: stock-proxy
//  Yahoo Finance API를 서버 사이드에서 호출하여 CORS 문제 우회
//
//  배포:
//    supabase functions deploy stock-proxy
//
//  로컬 테스트:
//    supabase functions serve stock-proxy
// ══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Yahoo Finance 유저 에이전트 풀 (봇 탐지 우회) ─────────────────
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
];
const randUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { ticker, period1, period2, interval = '1d' } = body;

    if (!ticker) {
      return new Response(JSON.stringify({ error: 'ticker is required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Yahoo Finance v8 API 호출 ──────────────────────────────────
    const end    = period2 ?? Math.floor(Date.now() / 1000);
    const start  = period1 ?? (end - 365 * 86400);
    const url    = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
                 + `?period1=${start}&period2=${end}&interval=${interval}&events=div,splits`;

    const yahooResp = await fetch(url, {
      headers: {
        'User-Agent': randUA(),
        'Accept':     'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':    'https://finance.yahoo.com',
      },
    });

    if (!yahooResp.ok) {
      // query2 로 재시도
      const url2 = url.replace('query1', 'query2');
      const retry = await fetch(url2, {
        headers: { 'User-Agent': randUA(), 'Accept': 'application/json' },
      });
      if (!retry.ok) {
        return new Response(
          JSON.stringify({ error: `Yahoo Finance HTTP ${retry.status}` }),
          { status: retry.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      const data2 = await retry.json();
      return new Response(JSON.stringify(data2), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const data = await yahooResp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
