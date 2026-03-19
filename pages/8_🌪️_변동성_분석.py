import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from arch import arch_model
from datetime import datetime, timedelta

st.set_page_config(page_title="GARCH 변동성 분석", layout="wide")

# 1. 데이터 구조 평탄화 (생략 없이 동일 유지)
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

ALL_STOCKS_MAP = {}
for stocks in TEA_TIME_STOCKS.values():
    ALL_STOCKS_MAP.update(stocks)

if 'garch_result' not in st.session_state:
    st.session_state.garch_result = None

st.title("🌪️ GARCH 기반 변동성 및 경로 시뮬레이션")
st.markdown("ARIMA의 선형적 예측을 넘어, 시장의 **'공포와 광기(변동성)'**를 반영한 모델입니다.")

# 3. 분석 설정
st.sidebar.header("⚙️ GARCH 설정")
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
selected_stock = st.sidebar.selectbox("종목 선택", stock_options, index=0)
p = st.sidebar.slider("GARCH p (변동성 전이)", 1, 5, 1)
q = st.sidebar.slider("GARCH q (충격 민감도)", 1, 5, 1)

if st.sidebar.button("GARCH 분석 및 시뮬레이션 실행"):
    ticker_symbol = ALL_STOCKS_MAP[selected_stock]
    with st.spinner(f'{selected_stock} 분석 중...'):
        df = yf.download(ticker_symbol, period="3y", threads=False)
        if not df.empty:
            # [수정] 데이터 프레임 구조에 따른 종가 추출 안정화
            close_data = df['Close']
            if isinstance(close_data, pd.DataFrame):
                close_data = close_data.iloc[:, 0]
            
            returns = 100 * close_data.pct_change().dropna()

            # 4. GARCH 모델 피팅
            model = arch_model(returns, vol='Garch', p=p, q=q, dist='normal')
            res = model.fit(disp='off')
            
            # 5. 변동성 예측 및 시뮬레이션
            forecast_steps = 30 
            forecasts = res.forecast(horizon=forecast_steps)
            
            # [핵심 수정] last_price를 확실하게 scalar(숫자)로 변환
            last_price = float(close_data.iloc[-1])
            
            # GARCH 기반 조건부 변동성 추출
            daily_vols = np.sqrt(forecasts.variance.values[-1, :])
            
            sim_paths = []
            for _ in range(100): 
                # GARCH 변동성을 표준편차로 사용하는 정규분포 수익률 생성
                rand_rets = np.random.normal(0, daily_vols) / 100
                # 숫자 * 배열 연산으로 인덱스 에러 원천 차단
                path = last_price * (1 + rand_rets).cumprod()
                sim_paths.append(path)

            st.session_state.garch_result = {
                'name': selected_stock,
                'returns': returns,
                'conditional_vol': res.conditional_volatility,
                'forecast_vol': daily_vols,
                'sim_paths': sim_paths,
                'last_price': last_price
            }

# 4. 결과 시각화
if st.session_state.garch_result:
    result = st.session_state.garch_result
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("📊 리스크 추이 (Conditional Volatility)")
        fig_vol = go.Figure()
        fig_vol.add_trace(go.Scatter(x=result['returns'].index, y=result['conditional_vol'], 
                                     name='변동성', line=dict(color='orange', width=1)))
        fig_vol.update_layout(title="과거 변동성 군집 현상 분석", template="plotly_white", height=450)
        st.plotly_chart(fig_vol, use_container_width=True)

    with col2:
        st.subheader("🎲 리스크 반영 시나리오 (30일)")
        fig_sim = go.Figure()
        # 미래 날짜 생성 (오늘부터 영업일 기준 30일)
        future_idx = pd.date_range(start=datetime.now(), periods=30, freq='B')
        
        for path in result['sim_paths']:
            fig_sim.add_trace(go.Scatter(x=future_idx, y=path, mode='lines', 
                                         line=dict(width=1), opacity=0.15, showlegend=False))
        
        avg_path = np.mean(result['sim_paths'], axis=0)
        fig_sim.add_trace(go.Scatter(x=future_idx, y=avg_path, name='평균 시나리오', 
                                     line=dict(color='red', width=3)))
        
        fig_sim.update_layout(title="GARCH 변동성 주입 몬테카를로 결과", template="plotly_white", height=450)
        st.plotly_chart(fig_sim, use_container_width=True)

    st.divider()
    curr_vol = result['conditional_vol'].iloc[-1]
    st.metric("현재 연환산 변동성 (Risk Index)", f"{curr_vol * np.sqrt(252):.2f}%")
    st.write(f"💡 현재 **{result['name']}**은 과거 평균 대비 **{'고위험' if curr_vol > result['conditional_vol'].mean() else '저위험'}** 구간에 있습니다.")
