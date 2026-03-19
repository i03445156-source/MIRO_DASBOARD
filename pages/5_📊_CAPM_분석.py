import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
from scipy import stats
import plotly.express as px

st.set_page_config(page_title="CAPM 분석", layout="wide")

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

st.title("📊 CAPM 기반 시장 민감도 분석")

# 2. 분석 설정
st.sidebar.header("⚙️ 분석 설정")
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
selected_stock_name = st.sidebar.selectbox("분석할 종목 선택", stock_options, index=stock_options.index("삼성전자") if "삼성전자" in stock_options else 0)
rf_rate = st.sidebar.number_input("무위험 수익률 (연 %)", value=3.5) / 100

if selected_stock_name:
    ticker = ALL_STOCKS_MAP[selected_stock_name]
    
    # [추가] 시장 지수 자동 선택 (한국 종목은 KOSPI, 미국/기타 종목은 S&P 500)
    market_ticker = "^KS11" if ticker.endswith((".KS", ".KQ")) else "^GSPC"
    market_name = "KOSPI" if market_ticker == "^KS11" else "S&P 500"
    
    st.markdown(f"**{market_name}({market_ticker})** 대비 **{selected_stock_name}**의 체계적 위험($\beta$)을 분석합니다.")

    with st.spinner(f'{selected_stock_name}와 {market_name} 데이터를 가져오는 중...'):
        # 데이터 로드 (최근 1년)
        raw_data = yf.download([ticker, market_ticker], period="1y", threads=False)
        
        if not raw_data.empty and 'Close' in raw_data:
            data = raw_data['Close'].dropna()
            
            # 수익률 계산
            returns = data.pct_change().dropna()
            
            # 초과 수익률 계산 (일일 무위험 수익률 차감)
            daily_rf = rf_rate / 252
            stock_excess = returns[ticker] - daily_rf
            market_excess = returns[market_ticker] - daily_rf
            
            # 3. 선형 회귀 분석
            beta, alpha, r_value, p_value, std_err = stats.linregress(market_excess, stock_excess)
            
            # 결과 지표 출력
            col1, col2, col3, col4 = st.columns(4)
            col1.metric("Beta (β)", f"{beta:.2f}", help="시장 대비 변동성 민감도")
            col2.metric("Alpha (α, 연환산)", f"{alpha * 252:.2%}", help="시장 수익률을 초과한 종목 고유의 성과")
            col3.metric("R-squared", f"{r_value**2:.2f}", help="시장 흐름이 이 종목을 설명하는 정도")
            col4.metric("P-value", f"{p_value:.4f}", help="통계적 유의성 (0.05 미만일 때 유의미)")

            st.divider()
            
            c1, c2 = st.columns([2, 1])
            with c1:
                st.subheader("📈 증권특성선 (SCL)")
                # 시각화를 위한 데이터프레임 구성
                reg_df = pd.DataFrame({
                    'Market_Excess': market_excess,
                    'Stock_Excess': stock_excess
                })
                fig = px.scatter(reg_df, x='Market_Excess', y='Stock_Excess',
                                 labels={'Market_Excess': f'{market_name} 초과 수익률', 
                                         'Stock_Excess': f'{selected_stock_name} 초과 수익률'},
                                 title=f"{selected_stock_name} vs {market_name} Regression",
                                 trendline="ols", trendline_color_override="red",
                                 template="plotly_white")
                st.plotly_chart(fig, use_container_width=True)
            
            with c2:
                st.subheader("💡 분석 결과 해석")
                # 베타 해석
                if beta > 1.2:
                    st.warning(f"⚠️ **공격적 주식**: {market_name}보다 변동이 훨씬 큽니다. 상승장에서는 유리하지만 하락장에서는 위험합니다.")
                elif 0.8 <= beta <= 1.2:
                    st.info(f"✅ **시장 추종**: {market_name}과 유사하게 움직이는 경향이 있습니다.")
                else:
                    st.success(f"🛡️ **방어적 주식**: 시장 변동에 둔감합니다. 하락장에서 포트폴리오를 방어하는 역할을 합니다.")
                
                # 알파 및 결정계수 해석
                if alpha > 0:
                    st.markdown(f"- 이 종목은 지난 1년간 시장 대비 **연 {alpha*252:.1%}%**의 추가 수익을 냈습니다.")
                
                r_sq = r_value**2
                if r_sq > 0.7:
                    st.write(f"- 결정계수가 `{r_sq:.2f}`로 높습니다. 시장의 흐름을 매우 충실히 따르는 종목입니다.")
                else:
                    st.write(f"- 결정계수가 `{r_sq:.2f}`로 낮습니다. 시장 흐름보다는 **개별 뉴스나 업황**에 더 민감합니다.")

            # 4. CAPM 기대수익률 계산기
            st.info("### 🧮 CAPM 기대수익률 계산")
            exp_market_ret = st.slider(f"향후 1년 {market_name} 예상 수익률 (%)", -20.0, 40.0, 10.0) / 100
            expected_ret = rf_rate + beta * (exp_market_ret - rf_rate)
            
            st.write(f"시장 수익률이 **{exp_market_ret:.1%}**일 때, CAPM 이론에 따른 **{selected_stock_name}**의 기대 수익률은 **{expected_ret:.1%}**입니다.")
            st.latex(r"E(R_i) = " + f"{rf_rate:.3f} + {beta:.2f} \times ({exp_market_ret:.3f} - {rf_rate:.3f})")

        else:
            st.error(f"데이터를 불러오지 못했습니다. {ticker} 혹은 {market_ticker}를 확인하세요.")
