import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

st.set_page_config(page_title="기술적 분석", layout="wide")

# 1. 데이터 구조 평탄화 (에러 방지 및 종목 매핑)
TEA_TIME_STOCKS = {
    "김승년": {"삼성전자": "005930.KS", "롯데케미칼": "011170.KS"},
    "정선경": {"삼성SDI": "006400.KS", "휴메딕스": "200670.KQ"},
    "노문재": {"현대마린엔진": "071970.KS", "한화엔진": "082740.KS", "한화생명": "088350.KS", "NAVER": "035420.KS"},
    "윤창숙": {"효성중공업": "298040.KS", "LS일렉트릭": "010120.KS", "HD현대일렉트릭": "267260.KS"},
    "박은기": {"메리츠금융": "138040.KS", "한전KPS": "051600.KS", "기아": "000270.KS"},
    "최명식": {"한미반도체": "042700.KS", "메지온": "140410.KQ"},
    "박지환": {"에이디테크놀로지": "200710.KQ"},
    "여동호": {"LS머트리얼즈": "417200.KQ", "SKC": "011790.KS"},
    "장효원": {"LG화학": "051910.KS", "트랜스오션": "RIG", "시드릴": "SDRL"},
    "김현우": {"비나텍": "126340.KQ"},
    "이세진": {"비트코인 레버리지": "BITX", "코인베이스": "COIN"},
    "글로벌/기타": {"QQQ": "QQQ", "VOO": "VOO", "비트코인(BTC)": "BTC-USD", "트루스소셜": "DJT"}
}

# 모든 종목을 '종목명: 티커' 형태로 통합
ALL_STOCKS_MAP = {}
for stocks in TEA_TIME_STOCKS.values():
    ALL_STOCKS_MAP.update(stocks)

st.title("📈 기술적 지표 분석 (RSI & 이동평균선)")
st.markdown("주가의 추세와 과열 여부를 판단하기 위해 **RSI**와 **이동평균선**을 분석합니다.")

# 2. 분석 설정 (사이드바)
st.sidebar.header("⚙️ 분석 설정")
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
# [수정] 사용자가 '사람'이 아닌 '종목'을 직접 고르게 변경
selected_stock = st.sidebar.selectbox("종목 선택", stock_options, index=stock_options.index("삼성전자") if "삼성전자" in stock_options else 0)

rsi_period = st.sidebar.slider("RSI 기간 설정", 5, 30, 14)
ma_short = st.sidebar.number_input("단기 이평선 (일)", value=5)
ma_long = st.sidebar.number_input("장기 이평선 (일)", value=20)

# RSI 계산 함수 (Wilder's Smoothing 방식 권장되나 기존 SMA 방식 유지 후 보강)
def calculate_rsi(data, window=14):
    diff = data.diff(1)
    gain = diff.where(diff > 0, 0)
    loss = -diff.where(diff < 0, 0)
    
    # 지수 이동평균(EWM)을 쓰면 더 정확하지만, 요청하신 로직대로 SMA 사용
    avg_gain = gain.rolling(window=window).mean()
    avg_loss = loss.rolling(window=window).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

if selected_stock:
    ticker = ALL_STOCKS_MAP[selected_stock]
    
    with st.spinner(f'{selected_stock} 데이터를 불러오는 중...'):
        # 기술적 분석을 위해 최근 1년 데이터 로드
        df = yf.download(ticker, period="1y", threads=False)
        
        if not df.empty:
            # [수정] 데이터 추출 방식 안정화
            if 'Close' in df:
                close_prices = df['Close']
            else:
                close_prices = df
            
            # 단일 티커여도 Series가 아닐 경우를 대비
            if isinstance(close_prices, pd.DataFrame):
                close_prices = close_prices.iloc[:, 0]

            # 지표 계산
            df_tech = pd.DataFrame(index=close_prices.index)
            df_tech['Close'] = close_prices
            df_tech['MA_Short'] = close_prices.rolling(window=ma_short).mean()
            df_tech['MA_Long'] = close_prices.rolling(window=ma_long).mean()
            df_tech['RSI'] = calculate_rsi(close_prices, window=rsi_period)
            
            # 3. Plotly 서브플롯 생성
            fig = make_subplots(rows=2, cols=1, shared_xaxes=True, 
                               vertical_spacing=0.1, 
                               subplot_titles=(f'주가 및 이동평균선 ({selected_stock})', 'RSI (Relative Strength Index)'),
                               row_heights=[0.7, 0.3])

            # 상단: 주가 및 이평선
            fig.add_trace(go.Scatter(x=df_tech.index, y=df_tech['Close'], name='종가', line=dict(color='black', width=1.5)), row=1, col=1)
            fig.add_trace(go.Scatter(x=df_tech.index, y=df_tech['MA_Short'], name=f'{ma_short}일선', line=dict(color='orange', width=1)), row=1, col=1)
            fig.add_trace(go.Scatter(x=df_tech.index, y=df_tech['MA_Long'], name=f'{ma_long}일선', line=dict(color='blue', width=1)), row=1, col=1)

            # 하단: RSI
            fig.add_trace(go.Scatter(x=df_tech.index, y=df_tech['RSI'], name='RSI', line=dict(color='purple', width=1.5)), row=2, col=1)
            
            # RSI 기준선 및 영역 (70/30)
            fig.add_hline(y=70, line_dash="dash", line_color="red", row=2, col=1)
            fig.add_hline(y=30, line_dash="dash", line_color="green", row=2, col=1)
            fig.add_hrect(y0=70, y1=100, fillcolor="red", opacity=0.1, row=2, col=1)
            fig.add_hrect(y0=0, y1=30, fillcolor="green", opacity=0.1, row=2, col=1)

            fig.update_layout(height=800, showlegend=True, template="plotly_white",
                              xaxis2_rangeslider_visible=False)
            st.plotly_chart(fig, use_container_width=True)

            # 4. 분석 결과 요약
            current_rsi = df_tech['RSI'].iloc[-1]
            st.divider()
            st.subheader(f"🔍 현재 {selected_stock} 기술적 상태")
            
            c1, c2, c3 = st.columns(3)
            c1.metric("현재 RSI", f"{current_rsi:.2f}")
            
            # 이평선 정배열/역배열 판단 추가
            last_ma_s = df_tech['MA_Short'].iloc[-1]
            last_ma_l = df_tech['MA_Long'].iloc[-1]
            
            if current_rsi >= 70:
                c2.error("상태: 과매수 (Overbought)")
                c3.warning("⚠️ 심리적 고점 영역입니다. 조정 가능성에 유의하세요.")
            elif current_rsi <= 30:
                c2.success("상태: 과매도 (Oversold)")
                c3.info("✅ 심리적 저점 영역입니다. 분할 매수 기회일 수 있습니다.")
            else:
                c2.info("상태: 중립 (Neutral)")
                c3.write("현재 특별한 과열이나 침체 신호가 없습니다.")
            
            # 골든크로스/데드크로스 힌트
            if last_ma_s > last_ma_l:
                st.write(f"💡 현재 **정배열** 상태입니다 ({ma_short}일선 > {ma_long}일선). 단기 추세가 긍정적입니다.")
            else:
                st.write(f"💡 현재 **역배열** 상태입니다 ({ma_short}일선 < {ma_long}일선). 하락 추세가 진행 중일 수 있습니다.")

        else:
            st.error(f"데이터를 불러오지 못했습니다. 티커({ticker})를 확인하세요.")
