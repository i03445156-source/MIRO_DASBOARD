from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional

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
    ticker: str = Query(..., description="Yahoo Finance 티커 (예: 005930.KS, AAPL, ETH-USD)"),
    start:  str = Query(None, description="시작일 YYYY-MM-DD"),
    end:    str = Query(None, description="종료일 YYYY-MM-DD (기본: 오늘)"),
):
    try:
        end_date   = end   or datetime.now().strftime("%Y-%m-%d")
        start_date = start or (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

        df = yf.download(
            ticker,
            start=start_date,
            end=end_date,
            progress=False,
            auto_adjust=True,
        )

        if df.empty:
            raise HTTPException(status_code=404, detail=f"{ticker}: 데이터 없음")

        # yfinance가 MultiIndex를 반환하는 경우 flatten
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
