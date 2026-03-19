import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.express as px
from datetime import datetime

# 1. 페이지 설정 (가장 위에 와야 함)
st.set_page_config(page_title="티타임 종목 수익률 추적기", layout="wide")

st.title("☕ 3월 13일 기준 티타임 종목 추적")
st.markdown("2026년 3월 13일 종가를 0%로 잡고, 이후의 **종가 기준 흐름(꺾은선 그래프)**을 추적합니다.")

# 2. 기준 데이터 정의
BASE_DATE = "2026-03-13"

tea_time_data = {
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
    "글로벌/기타": {"QQQ": "QQQ", "VOO": "VOO", "비트코인(BTC)": "BTC-USD", "코인베이스": "COIN", "트루스소셜": "DJT"}
}

# 모든 티커 합치기
all_tickers = {}
for stocks in tea_time_data.values():
    all_tickers.update(stocks)

# 3. 사이드바 UI
st.sidebar.header("👤 멤버별 종목 선택")
selected_member = st.sidebar.selectbox("분석할 멤버를 선택하세요", ["전체보기"] + list(tea_time_data.keys()))

# 선택된 멤버에 따른 티커 리스트 준비
current_stocks_dict = all_tickers if selected_member == "전체보기" else tea_time_data[selected_member]
tickers_to_fetch = list(current_stocks_dict.values())

# 4. 데이터 로드 함수 (강력한 에러 핸들링 포함)
@st.cache_data(ttl=3600)
def load_stock_data(stocks_dict, start_date):
    ticker_list = list(stocks_dict.values())
    # threads=False는 서버 환경 안정성을 위해 필수
    raw_data = yf.download(ticker_list, start=start_date, threads=False)
    
    if raw_data.empty or 'Close' not in raw_data:
        return pd.DataFrame(), ticker_list

    # 종가 데이터만 추출
    data = raw_data['Close']
    
    # 조회가 실패한 티커 확인
    failed = []
    if len(ticker_list) > 1:
        for t in ticker_list:
            if t not in data.columns or data[t].isnull().all():
                failed.append(t)
        # 티커 -> 한글 이름 변환
        inv_map = {v: k for k, v in stocks_dict.items()}
        data = data.rename(columns=inv_map)
    else:
        # 단일 종목 처리
        name = list(stocks_dict.keys())[0]
        data = data.to_frame(name=name)
        if data[name].isnull().all():
            failed.append(ticker_list[0])
            
    return data, failed

# 5. 메인 실행 로직
try:
    with st.spinner('실시간 데이터를 분석 중입니다...'):
        df_price, failed_tickers = load_stock_data(current_stocks_dict, BASE_DATE)

    if failed_tickers:
        st.warning(f"⚠️ 일부 데이터 로드 실패: {', '.join(failed_tickers)}")

    if not df_price.empty:
        # 데이터 클리닝
        df_price = df_price.dropna(how='all')
        
        # 6. 수익률 계산
        base_price = df_price.iloc[0]
        df_returns = (df_price / base_price - 1) * 100

        # 7. 시각화 (탭 구성)
        tab1, tab2 = st.tabs(["📈 수익률 추이 (%)", "💵 주가 추이"])
        
        with tab1:
            st.subheader(f"{selected_member} 종목 수익률 흐름")
            fig1 = px.line(df_returns, 
                           labels={"value": "수익률 (%)", "Date": "날짜"},
                           title="3월 13일 대비 누적 수익률")
            fig1.add_hline(y=0, line_dash="dash", line_color="red")
            fig1.update_traces(mode='lines+markers')
            st.plotly_chart(fig1, use_container_width=True)

        # 주가 추이 그래프(tab2) 부분 수정 예시
        with tab2:
            st.subheader("📉 개별 종목 상세 분석")
            
            # 1. 종목 선택
            selected_stock = st.selectbox("분석할 종목을 선택하세요", df_price.columns)
            
            # 2. 데이터 준비 (복사본 생성 및 인덱스 확인)
            df_ma = df_price[[selected_stock]].copy()
            
            # 3. 이동평균선 계산 (데이터가 부족하면 가능한 범위 내에서만 계산하도록 min_periods 추가)
            df_ma['5일 이동평균'] = df_ma[selected_stock].rolling(window=5, min_periods=1).mean()
            df_ma['20일 이동평균'] = df_ma[selected_stock].rolling(window=20, min_periods=1).mean()
    
            # 4. 시각화 (Plotly)
            # 깔끔한 표기를 위해 컬럼명 변경 후 출력
            fig_ma = px.line(
                df_ma, 
                labels={"value": "가격", "Date": "날짜"},
                title=f"<b>{selected_stock}</b> 주가 및 이동평균선 흐름",
                color_discrete_map={
                    selected_stock: "#31333F", # 주가는 어두운 색
                    "5일 이동평균": "#FF4B4B",  # 5일선 빨간색
                    "20일 이동평균": "#1C83E1"  # 20일선 파란색
                }
            )
            
            # 레이아웃 조정
            fig_ma.update_layout(hovermode="x unified")
            st.plotly_chart(fig_ma, use_container_width=True)
            
            st.caption("※ 데이터가 20일 미만인 경우 20일 이동평균선은 계산 가능한 시점부터 표시됩니다.")
    else:
        st.error("데이터를 불러올 수 없습니다. 티커나 네트워크 상태를 확인하세요.")

except Exception as e:
    st.error(f"실행 중 오류가 발생했습니다: {e}")

st.info("💡 **팁:** 코인베이스(COIN) 등 미국 종목이 안 나오면 잠시 후 새로고침 해주세요.")
