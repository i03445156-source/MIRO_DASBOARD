import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.figure_factory as ff
import plotly.express as px

st.set_page_config(page_title="상관관계 분석", layout="wide")

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

# [수정] 모든 종목을 '종목명: 티커' 형태로 통합
ALL_STOCKS_MAP = {}
for stocks in TEA_TIME_STOCKS.values():
    ALL_STOCKS_MAP.update(stocks)

# [수정] 티커를 다시 한글 이름으로 바꾸기 위한 역매핑 딕셔너리
TICKER_TO_NAME = {v: k for k, v in ALL_STOCKS_MAP.items()}

st.title("🔗 종목 간 상관관계 분석")
st.markdown("선택한 종목들이 얼마나 비슷하게 움직이는지 확인하여 **분산 투자 전략**을 점검합니다.")

# 2. 분석 설정 (옵션 리스트와 디폴트값 일치시킴)
stock_options = sorted(list(ALL_STOCKS_MAP.keys()))
# 기존 코드의 "비트코인"을 "비트코인(BTC)" 등으로 정확히 일치시켜야 에러가 안 납니다.
default_selection = [s for s in ["삼성전자", "기아", "SKC", "QQQ", "비트코인(BTC)"] if s in stock_options]

selected_stocks = st.multiselect(
    "분석할 종목들을 선택하세요", 
    options=stock_options, 
    default=default_selection
)

# 3. 데이터 로드 함수 (캐싱 적용)
@st.cache_data(ttl=3600)
def get_correlation_data(stock_names):
    tickers = [ALL_STOCKS_MAP[name] for name in stock_names]
    # [수정] yf.download 시 Close 데이터 처리 (MultiIndex 대응)
    raw_data = yf.download(tickers, period="1y", threads=False)
    
    if raw_data.empty:
        return pd.DataFrame()
    
    # Close 가격만 추출
    df = raw_data['Close'] if 'Close' in raw_data else raw_data
    if isinstance(df, pd.Series): df = df.to_frame()
    
    # 수익률 계산 및 결측치 보정 (휴장일 차이 대응)
    returns = df.pct_change().fillna(0)
    
    # [수정] 티커(Column 명)를 한글 이름으로 변환
    returns = returns.rename(columns=TICKER_TO_NAME)
    return returns

# 4. 분석 실행
if len(selected_stocks) > 1:
    with st.spinner('데이터를 분석 중입니다...'):
        df_returns = get_correlation_data(selected_stocks)
        
    if not df_returns.empty:
        # 상관계수 행렬 계산
        corr_matrix = df_returns.corr().round(2)
        
        # [추가] 가독성을 위해 컬럼 순서를 선택한 순서대로 정렬
        corr_matrix = corr_matrix.reindex(index=selected_stocks, columns=selected_stocks)
        
        # 히트맵 시각화
        fig = ff.create_annotated_heatmap(
            z=corr_matrix.values,
            x=list(corr_matrix.columns),
            y=list(corr_matrix.index),
            annotation_text=corr_matrix.values,
            colorscale='RdBu_r', # 빨간색(양의 상관), 파란색(음의 상관)
            zmin=-1, zmax=1
        )
        
        fig.update_layout(
            title_text='Correlation Heatmap',
            title_x=0.5,
            height=600,
            xaxis_showgrid=False,
            yaxis_showgrid=False
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # 5. 산점도 행렬 (Scatter Matrix) - 종목이 너무 많지 않을 때만 표시
        if len(selected_stocks) <= 5:
            with st.expander("📈 종목 간 수익률 산점도 확인 (상세 분포)"):
                fig_scatter = px.scatter_matrix(df_returns, height=700)
                st.plotly_chart(fig_scatter, use_container_width=True)
        
        # 해석 가이드
        st.divider()
        st.subheader("💡 상관관계 해석 가이드")
        col1, col2, col3 = st.columns(3)
        with col1:
            st.info("**+0.7 ~ +1.0 (강한 상관)**\n\n거의 같이 움직입니다. 같은 섹터나 같은 시장 종목일 가능성이 높으며 분산 효과가 낮습니다.")
        with col2:
            st.warning("**-0.1 ~ +0.3 (약한 상관)**\n\n서로 따로 움직입니다. 한쪽이 떨어질 때 다른 쪽은 버틸 수 있어 분산 투자에 유리합니다.")
        with col3:
            st.success("**음의 상관 (-)**\n\n청개구리처럼 반대로 움직입니다. 리스크를 상쇄하는 헤지(Hedge) 수단으로 적합합니다.")
            
    else:
        st.error("데이터 로드에 실패했습니다. 티커 또는 시장 휴장 여부를 확인하세요.")
else:
    st.info("상관관계를 분석하려면 최소 2개 이상의 종목을 선택해 주세요.")
