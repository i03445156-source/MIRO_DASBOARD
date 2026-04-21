from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import httpx
from datetime import datetime, timedelta

app = FastAPI(title="MIRO Stock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "ok", "service": "MIRO Stock API"}

@app.get("/stock")
def get_stock(
    ticker: str = Query(...),
    start:  str = Query(None),
    end:    str = Query(None),
):
    try:
        end_date   = end   or datetime.now().strftime("%Y-%m-%d")
        start_date = start or (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

        df = yf.download(ticker, start=start_date, end=end_date, progress=False, auto_adjust=True)

        if df.empty:
            raise HTTPException(status_code=404, detail=f"{ticker}: 데이터 없음")

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        def clean(series):
            return [round(float(v), 4) if pd.notna(v) else None for v in series]

        return {
            "ticker":  ticker,
            "dates":   df.index.strftime("%Y-%m-%d").tolist(),
            "opens":   clean(df["Open"]),
            "highs":   clean(df["High"]),
            "lows":    clean(df["Low"]),
            "closes":  clean(df["Close"]),
            "volumes": [int(v) if pd.notna(v) else 0 for v in df["Volume"]],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/fred")
def get_fred(
    series_id: str = Query(...),
    limit:     int = Query(60),
):
    """FRED API 프록시 — 브라우저에서 직접 호출 불가한 FRED를 서버 측에서 대신 조회"""
    FRED_KEY = "47d073f722cfe9d92851890505f12c66"
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_KEY}"
        f"&file_type=json&sort_order=desc&limit={limit}"
    )
    try:
        r = httpx.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        obs    = [o for o in data.get("observations", []) if o["value"] != "."]
        obs    = list(reversed(obs))
        dates  = [o["date"] for o in obs]
        values = [float(o["value"]) for o in obs]
        return {"dates": dates, "values": values, "latest": values[-1] if values else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
