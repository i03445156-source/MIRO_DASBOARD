import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
from scipy.stats import norm
import plotly.express as px

st.set_page_config(page_title="리스크 분석", layout="wide")

# 1. 데이터 구조 (중첩 딕셔너리)
TEA_TIME_STOCKS = {
    "김승년": {"삼성전자": "005930.KS", "롯데케미칼": "011170.KS"},
    "정선경": {"삼성SDI": "006400.KS", "휴메딕스": "200670.KQ"},
    "노문재": {"현대마린엔진": "071970.KS", "한화엔진": "082740.KS", "한화생명": "088350.KS", "NAVER": "035420.KS"},
    "윤창숙": {"효성중공업": "298040.KS", "LS일렉트릭": "010120.KS", "HD현대일렉트릭": "267260.KS"},
    "박은기": {"메리츠금융": "138040.KS", "한전KPS": "051600.KS", "기아": "000270.KS"},
    "최명식": {"한미반도체": "042700.KS", "메지온": "140410.KQ"},
    "박지환": {"에이디테크놀로지": "200710.KQ"},
    "여동호": {"LS머트리얼즈": "417200.KQ", "SKC": "011790.KS"},
    "장효원": {"LG화학": "051910.KS", "트랜스오션(RIG)": "RIG", "시드릴(SDRL)": "SDRL"},
    "김현우": {"비나텍": "126340.KQ"},
    "이세진": {"비트코인 레버리지": "BITX", "코인베이스": "COIN"},
    "글로벌/기타": {"QQQ": "QQQ", "VOO": "VOO", "비트코인(BTC)": "BTC-USD", "트루스소셜": "DJT"}
}

# [수정] 모든 종목을 하나의 딕셔너리로 평탄화 (종목명: 티커)
ALL_STOCKS_MAP = {}
for stocks in TEA_TIME_STOCKS.values():
    ALL_STOCKS_MAP.update(stocks)

st.title("🛡️ 티타임 포트폴리오 VaR 분석")

# 2. 분석 설정
st.sidebar.header("⚙️ 분석 설정")

# [수정] 옵션을 ALL_STOCKS_MAP의 키(종목명)로 설정
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
default_stocks = [s for s in ["삼성전자", "기아", "NAVER", "QQQ"] if s in stock_options]

selected_stocks = st.multiselect(
    "분석할 종목을 선택하세요", 
    options=stock_options, 
    default=default_stocks
)

investment = st.sidebar.number_input("총 투자 금액 (원)", value=10000000, step=1000000)
conf_level = st.sidebar.selectbox("신뢰 수준", [0.95, 0.99])

if selected_stocks:
    # [수정] 선택된 종목명에 해당하는 티커 리스트 생성
    tickers = [ALL_STOCKS_MAP[name] for name in selected_stocks]
    
    with st.spinner('데이터 분석 중...'):
        # 리스크 분석 데이터 로드
        df = yf.download(tickers, period="1y", threads=False)
        
        # [수정] yfinance 결과 처리 (단일 종목일 경우와 다중 종목일 경우 대응)
        if not df.empty:
            if len(tickers) > 1:
                data = df['Close']
            else:
                data = df['Close'].to_frame(name=tickers[0])
                
            returns = data.pct_change().dropna()
            
            # 동일 비중 가정
            weights = np.array([1/len(selected_stocks)] * len(selected_stocks))
            
            # 포트폴리오 성과 계산
            port_return_series = returns.dot(weights)
            port_mean = port_return_series.mean()
            port_std = port_return_series.std() # 포트폴리오 전체 변동성 직접 계산
            
            # VaR 계산 (델타-노멀 방식)
            z_score = norm.ppf(conf_level)
            var_pct = (z_score * port_std)
            var_value = investment * var_pct

            # 결과 시각화
            col1, col2 = st.columns(2)
            with col1:
                st.subheader("📊 리스크 요약")
                st.metric("일일 변동성 (Volatility)", f"{port_std*100:.2f}%")
                st.error(f"내일 하루 최대 예상 손실 ({int(conf_level*100)}% 신뢰수준)")
                st.markdown(f"### **{int(var_value):,} 원**")
                st.caption(f"투자금의 약 {var_pct*100:.2f}% 수준")
            
            with col2:
                fig = px.histogram(
                    port_return_series, 
                    title="포트폴리오 수익률 분포",
                    labels={'value': '수익률', 'count': '빈도'},
                    color_discrete_sequence=['#ff4b4b']
                )
                # VaR 라인 표시
                fig.add_vline(x=-var_pct, line_dash="dash", line_color="black", annotation_text="VaR 지점")
                st.plotly_chart(fig, use_container_width=True)

            # 종목별 기여도 (상관관계)
            with st.expander("🔗 종목 간 상관관계 확인"):
                st.dataframe(returns.corr().style.background_gradient(cmap='RdBu_r'))
        else:
            st.error("데이터를 불러오지 못했습니다. 티커를 확인하세요.")
else:
    st.info("왼쪽 사이드바 또는 상단에서 분석할 종목을 선택해 주세요.")
