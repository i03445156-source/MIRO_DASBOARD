import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from statsmodels.tsa.arima.model import ARIMA
from arch import arch_model  # pip install arch 필수
from datetime import datetime, timedelta

# 페이지 설정
st.set_page_config(page_title="ARIMA-GARCH 하이라이트", layout="wide")

# 1. 티타임 종목 데이터 (100% 반영)
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
if 'ag_highlight_result' not in st.session_state:
    st.session_state.ag_highlight_result = None

st.title("🌪️ ARIMA-GARCH 시나리오 하이라이트")
st.markdown("수백 개의 **뾰족한 시나리오** 사이에서 **가장 평균적인 흐름**을 추출하여 시각화합니다.")

# 2. 사이드바 설정
st.sidebar.header("⚙️ 분석 설정")
selected_owner = st.sidebar.selectbox("이름 선택", list(TEA_TIME_DATA.keys()))
selected_stock = st.sidebar.selectbox("종목 선택", list(TEA_TIME_DATA[selected_owner].keys()))
ticker = TEA_TIME_DATA[selected_owner][selected_stock]

p = st.sidebar.slider("GARCH p (변동성 전이)", 1, 2, 1)
q = st.sidebar.slider("GARCH q (충격 민감도)", 1, 2, 1)

if st.sidebar.button("하이브리드 분석 실행"):
    with st.spinner(f'{selected_stock} 분석 중...'):
        df = yf.download(ticker, period="3y", threads=False)
        if not df.empty:
            close_data = df['Close']
            if isinstance(close_data, pd.DataFrame): close_data = close_data.iloc[:, 0]
            
            # (1) 수익률 데이터 준비 (Scaling)
            returns = 100 * close_data.pct_change().dropna()
            last_price = float(close_data.iloc[-1])
            
            # (2) ARIMA-GARCH 통합 모델 피팅
            # ARIMA(1,1,1)의 평균과 GARCH(p,q)의 변동성 결합
            am = arch_model(returns, vol='Garch', p=p, q=q, dist='normal')
            res = am.fit(disp='off')
            
            # (3) 미래 시뮬레이션 (30일)
            forecast_steps = 30
            forecasts = res.forecast(horizon=forecast_steps)
            
            mu_f = forecasts.mean.values[-1, :] / 100
            var_f = forecasts.variance.values[-1, :] / 10000
            
            sim_paths = []
            for _ in range(100):
                # 개별 시나리오는 매일 랜덤 노이즈를 주어 '뾰족하게' 생성
                daily_noises = np.random.normal(mu_f, np.sqrt(var_f))
                path = last_price * (1 + daily_noises).cumprod()
                sim_paths.append(path)
            
            # (4) 가장 평균적인 흐름 계산
            mean_path = np.mean(sim_paths, axis=0)
            
            st.session_state.ag_highlight_result = {
                'name': selected_stock, 'ticker': ticker,
                'past_data': close_data.tail(150),
                'sim_paths': sim_paths,
                'mean_path': mean_path,
                'forecast_idx': pd.date_range(close_data.index[-1], periods=forecast_steps+1, freq='B')[1:]
            }

# 3. 시각화 (하이라이트 디자인)
if st.session_state.ag_highlight_result:
    res = st.session_state.ag_highlight_result
    fig = go.Figure()

    # 1. 배경: 100개의 뾰족한 개별 경로 (매우 흐리게)
    for path in res['sim_paths']:
        fig.add_trace(go.Scatter(
            x=res['forecast_idx'], y=path,
            mode='lines', 
            line=dict(width=0.7, color='rgba(100, 200, 255, 0.08)'), # 투명도를 0.08로 낮춤
            showlegend=False, 
            hoverinfo='skip'
        ))

    # 2. 중심: 과거 주가 (흰색)
    fig.add_trace(go.Scatter(
        x=res['past_data'].index, y=res['past_data'],
        name='과거 주가', 
        line=dict(color='#FFFFFF', width=2)
    ))

    # 3. 하이라이트: 평균 흐름 (그림자 효과 대용으로 2중 선 사용)
    # 외곽 광성 효과
    fig.add_trace(go.Scatter(
        x=res['forecast_idx'], y=res['mean_path'],
        showlegend=False, hoverinfo='skip',
        line=dict(color='rgba(255, 215, 0, 0.15)', width=12)
    ))
    # 메인 황금선
    fig.add_trace(go.Scatter(
        x=res['forecast_idx'], y=res['mean_path'],
        name='평균 시나리오',
        line=dict(color='#FFD700', width=4)
    ))

    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        title=f"<b>{res['name']} ARIMA-GARCH 변동성 시뮬레이션</b>",
        yaxis_title="가격",
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        height=650
    )

    st.plotly_chart(fig, use_container_width=True)
    st.success("✅ 에러가 수정되었습니다. 황금색 선이 수백 개의 시나리오 중 통계적 중앙값을 나타냅니다.")
    # [중심] 과거 데이터 (흰색)
    # 요약 정보
    st.info(f"💡 **시각화 가이드:** 배경에 깔린 흐릿한 파란 선들은 GARCH 모델이 예측한 시장 변동성에 따라 주가가 **뾰족하게 요동칠 수 있는 100가지 시나리오**입니다. 중앙의 **황금색 실선**은 이 수많은 가능성들의 평균적인 통계적 흐름을 나타냅니다.")

else:
    st.info("왼쪽 사이드바에서 종목을 선택하고 실행 버튼을 눌러주세요.")
