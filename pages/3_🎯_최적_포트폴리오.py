import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
from scipy.optimize import minimize
import plotly.express as px
import plotly.graph_objects as go

st.set_page_config(page_title="최적 포트폴리오", layout="wide")

# 1. 데이터 구조 평탄화 (에러 방지의 핵심)
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

# 모든 종목을 '종목명: 티커' 형태로 통합
ALL_STOCKS_MAP = {}
for stocks in TEA_TIME_STOCKS.values():
    ALL_STOCKS_MAP.update(stocks)

st.title("🎯 티타임 종목 최적 비중 산출")
st.markdown("샤프비율을 극대화하는 **수학적 최적 투자 비중**을 계산합니다.")

# 2. 종목 선택 (옵션 리스트와 디폴트값 일치시킴)
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
default_selection = [s for s in ["삼성전자", "기아", "NAVER", "QQQ"] if s in stock_options]

selected_stocks = st.multiselect(
    "최적화할 종목들을 골라주세요", 
    options=stock_options, 
    default=default_selection
)

# 3. 최적화 함수 정의
def get_performance(weights, mean_returns, cov_matrix):
    port_ret = np.sum(mean_returns * weights) * 252
    port_std = np.sqrt(np.dot(weights.T, np.dot(cov_matrix * 252, weights)))
    return port_ret, port_std

def negative_sharpe(weights, mean_returns, cov_matrix, rf_rate=0.035):
    ret, std = get_performance(weights, mean_returns, cov_matrix)
    if std == 0: return 0
    return -(ret - rf_rate) / std

# 4. 분석 실행
result = None # 초기화
if len(selected_stocks) > 1:
    tickers = [ALL_STOCKS_MAP[name] for name in selected_stocks]
    # 티커 -> 한글이름 매핑 (결과 출력용)
    ticker_to_name = {ALL_STOCKS_MAP[name]: name for name in selected_stocks}
    
    with st.spinner('최근 1년 데이터를 분석하여 최적화 중...'):
        raw_data = yf.download(tickers, period="1y", threads=False)
        
        if not raw_data.empty:
            # MultiIndex 또는 단일 Index 대응
            df = raw_data['Close'] if 'Close' in raw_data else raw_data
            if isinstance(df, pd.Series): df = df.to_frame()
            
            # 수익률 계산 및 결측치 보정
            returns = df.pct_change().fillna(0)
            
            # 계산용 변수들
            mean_returns = returns.mean()
            cov_matrix = returns.cov()
            num_assets = len(selected_stocks)
            
            # 최적화 설정
            constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})
            bounds = tuple((0, 1) for _ in range(num_assets))
            init_guess = np.array([1. / num_assets] * num_assets)
            
            result = minimize(
                negative_sharpe, 
                init_guess, 
                args=(mean_returns, cov_matrix),
                method='SLSQP', 
                bounds=bounds, 
                constraints=constraints
            )
            
            if result.success:
                weights = result.x
                ret, std = get_performance(weights, mean_returns, cov_matrix)
                
                col1, col2 = st.columns([1, 1])
                with col1:
                    st.subheader("✅ 최적 비중 결과")
                    # 티커를 다시 한글 이름으로 매핑하여 표 생성
                    display_names = [ticker_to_name.get(t, t) for t in returns.columns]
                    res_df = pd.DataFrame({'종목': display_names, '비중': weights})
                    res_df = res_df.sort_values(by='비중', ascending=False)
                    
                    st.table(res_df.style.format({'비중': '{:.2%}'}))
                    st.metric("최적 샤프비율", f"{(ret-0.035)/std:.2f}")
                    st.write(f"**연 예상 수익률:** {ret:.2%}")
                    st.write(f"**연 변동성(위험):** {std:.2%}")

                with col2:
                    fig = px.pie(res_df, values='비중', names='종목', 
                                 title="Portfolio Allocation", hole=0.3,
                                 color_discrete_sequence=px.colors.sequential.RdBu)
                    st.plotly_chart(fig, use_container_width=True)

                # --- 스트레스 테스트 섹션 ---
                st.divider()
                st.header("🧪 포트폴리오 스트레스 테스트")

                # 1. 몬테카를로 시뮬레이션
                st.subheader("🎲 몬테카를로 미래 주가 시뮬레이션")
                iterations = st.select_slider("시뮬레이션 반복 횟수", options=[100, 1000, 3000], value=1000)
                
                port_daily_returns = returns.dot(weights)
                mu, sigma = port_daily_returns.mean(), port_daily_returns.std()
                
                sim_days = 252
                # 기하 브라운 운동(GBM) 기반 수익률 생성
                rand_rets = np.random.normal(mu, sigma, (sim_days, iterations))
                sim_paths = 100 * (1 + rand_rets).cumprod(axis=0)
                
                savings_line = 100 * (1 + 0.035 / 252)**np.arange(1, sim_days + 1)
                
                fig_mc = go.Figure()
                for i in range(min(50, iterations)): # 성능상 50개 경로만 시각화
                    fig_mc.add_trace(go.Scatter(y=sim_paths[:, i], mode='lines', line=dict(width=0.5), opacity=0.1, showlegend=False))
                
                fig_mc.add_trace(go.Scatter(y=sim_paths.mean(axis=1), mode='lines', line=dict(color='red', width=3), name='포트폴리오 평균'))
                fig_mc.add_trace(go.Scatter(y=savings_line, mode='lines', line=dict(color='orange', width=2, dash='dash'), name='연 3.5% 적금'))
                st.plotly_chart(fig_mc, use_container_width=True)

                # 2. 코로나19 시나리오 분석
                st.subheader("🦠 역사적 시나리오: 2020년 코로나19 금융 쇼크")
                covid_start, covid_end = "2020-01-01", "2020-07-01"
                
                with st.spinner('과거 데이터 비교 분석 중...'):
                    # 당시 상장되어 있던 종목만 필터링
                    hist_raw = yf.download(tickers + ["^KS11"], start=covid_start, end=covid_end, threads=False)['Close']
                    
                    if not hist_raw.empty:
                        # 데이터가 존재하는 종목만 추출
                        available_tickers = [t for t in tickers if t in hist_raw.columns and not hist_raw[t].dropna().empty]
                        
                        if available_tickers:
                            # 비중 재산출 (당시 상장된 종목들로만)
                            valid_indices = [tickers.index(t) for t in available_tickers]
                            sub_weights = weights[valid_indices]
                            sub_weights /= sub_weights.sum() # 비중 합 1로 재조정
                            
                            hist_returns = hist_raw[available_tickers].pct_change().fillna(0)
                            port_cum = (1 + hist_returns.dot(sub_weights)).cumprod()
                            
                            kospi_cum = (1 + hist_raw["^KS11"].pct_change().fillna(0)).cumprod()
                            
                            fig_comp = go.Figure()
                            fig_comp.add_trace(go.Scatter(x=port_cum.index, y=port_cum, name='내 포트폴리오', line=dict(color='blue', width=3)))
                            fig_comp.add_trace(go.Scatter(x=kospi_cum.index, y=kospi_cum, name='KOSPI 지수', line=dict(color='gray', dash='dot')))
                            st.plotly_chart(fig_comp, use_container_width=True)
                            
                            mdd = (port_cum / port_cum.cummax() - 1).min()
                            st.info(f"💡 코로나 쇼크 당시 이 포트폴리오의 최대 하락률(MDD)은 **{mdd:.2%}** 였습니다.")
                        else:
                            st.warning("선택한 종목 중 2020년에 상장되어 있던 종목이 없어 시나리오 분석이 불가능합니다.")
            else:
                st.error("최적화에 실패했습니다.")
else:
    st.info("좌측 또는 상단에서 2개 이상의 종목을 선택해 주세요.")
