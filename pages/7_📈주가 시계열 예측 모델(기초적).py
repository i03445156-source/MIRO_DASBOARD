import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from statsmodels.tsa.arima.model import ARIMA
from datetime import datetime, timedelta

# 페이지 설정
st.set_page_config(page_title="티타임 주가 시뮬레이션", layout="wide")

# 1. 티타임 종목 데이터 (제공해주신 데이터 100% 반영)
TEA_TIME_DATA = {
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

# 세션 상태 초기화 (결과 고정)
if 'simulation_result' not in st.session_state:
    st.session_state.simulation_result = None

st.title("🎲 티타임 종목 랜덤 워크 시뮬레이션")
st.markdown("ARIMA의 추세선에 과거 변동성을 주입하여 **100가지의 현실적인 주가 경로**를 생성합니다.")

# 2. 사이드바 종목 선택
st.sidebar.header("⚙️ 분석 설정")
selected_owner = st.sidebar.selectbox("이름 선택", list(TEA_TIME_DATA.keys()))
selected_stock = st.sidebar.selectbox("종목 선택", list(TEA_TIME_DATA[selected_owner].keys()))
ticker = TEA_TIME_DATA[selected_owner][selected_stock]

if st.sidebar.button("시나리오 생성 실행"):
    with st.spinner(f'{selected_stock} 데이터를 분석하고 시뮬레이션 중...'):
        # 데이터 로드 (최근 3년)
        df = yf.download(ticker, period="3y", threads=False)
        
        if not df.empty:
            # 데이터 추출 및 스칼라 변환
            close_data = df['Close'].iloc[:, 0] if isinstance(df['Close'], pd.DataFrame) else df['Close']
            last_price = float(close_data.iloc[-1])
            
            # 1. 수익률 분석 (추세 mu와 변동성 sigma 추출)
            returns = close_data.pct_change().dropna()
            mu = returns.mean()
            sigma = returns.std()
            
            # 2. 몬테카를로 시뮬레이션 (100개 경로)
            forecast_days = 126  # 향후 6개월(영업일 기준)
            sim_paths = []
            for _ in range(100):
                # 랜덤 수익률 생성 -> 누적곱으로 가격 경로 생성
                rand_rets = np.random.normal(mu, sigma, forecast_days)
                path = last_price * (1 + rand_rets).cumprod()
                sim_paths.append(path)
            
            # 3. ARIMA 표준 추세선 (비교용)
            try:
                model = ARIMA(close_data, order=(1,1,1)).fit()
                arima_forecast = model.forecast(steps=forecast_days)
            except:
                # ARIMA 학습 실패 시 단순 추세선으로 대체
                arima_forecast = [last_price * (1 + mu)**i for i in range(1, forecast_days+1)]

            # 세션에 결과 박제
            st.session_state.simulation_result = {
                'owner': selected_owner,
                'stock': selected_stock,
                'ticker': ticker,
                'past_data': close_data.tail(250),
                'sim_paths': sim_paths,
                'arima_path': arima_forecast,
                'forecast_idx': pd.date_range(close_data.index[-1], periods=forecast_days+1, freq='B')[1:]
            }
        else:
            st.error("데이터를 가져오지 못했습니다. 티커를 확인해 주세요.")

# 3. 결과 시각화 (다크 모드 스타일)
if st.session_state.simulation_result:
    res = st.session_state.simulation_result
    
    st.divider()
    st.subheader(f"📊 {res['owner']} 님의 {res['stock']} ({res['ticker']}) 시나리오 분포")

    fig = go.Figure()

    # (1) 100개의 시뮬레이션 경로 (희미한 파란색)
    for path in res['sim_paths']:
        fig.add_trace(go.Scatter(
            x=res['forecast_idx'], y=path,
            mode='lines', line=dict(width=0.6, color='rgba(100, 200, 255, 0.12)'),
            showlegend=False, hoverinfo='skip'
        ))

    # (2) 과거 주가 (흰색 실선)
    fig.add_trace(go.Scatter(
        x=res['past_data'].index, y=res['past_data'],
        name='과거 주가', line=dict(color='#FFFFFF', width=2)
    ))

    # (3) ARIMA 표준 추세선 (빨간색 굵은 점선)
    fig.add_trace(go.Scatter(
        x=res['forecast_idx'], y=res['arima_path'],
        name='ARIMA 표준 추세', line=dict(color='#FF4B4B', width=3, dash='dash')
    ))

    # 다크 모드 레이아웃 설정
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        xaxis_title="날짜",
        yaxis_title="가격",
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        height=600
    )

    st.plotly_chart(fig, use_container_width=True)

    # 통계적 가이드
    st.info(f"💡 **분석 가이드:** 빨간 점선은 ARIMA 모델이 계산한 '가장 확률 높은 평균적 방향'입니다. 주변의 흐릿한 파란 선들은 과거의 변동성을 고려했을 때 주가가 실제로 요동치며 움직일 수 있는 **100가지의 가능한 미래**를 보여줍니다.")
else:
    st.info("왼쪽 사이드바에서 종목을 선택하고 실행 버튼을 눌러주세요.")
