import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from quant_engine import load_stock_data, COMPANY_TICKERS

# 예측 기간 설정 매핑
PERIOD_CONFIG = {
    "1d": {"interval": "1d", "steps": 1, "label": "1일", "period_name": "1일 (1 Day)"},
    "1w": {"interval": "1d", "steps": 5, "label": "1주", "period_name": "1주 (1 Week)"},
    "1m": {"interval": "1d", "steps": 20, "label": "1달", "period_name": "1달 (1 Month)"},
    "6m": {"interval": "1wk", "steps": 26, "label": "6개월", "period_name": "6개월 (6 Months)"},
    "1y": {"interval": "1mo", "steps": 12, "label": "1년", "period_name": "1년 (1 Year)"}
}

class LightweightLSTMModel:
    """초고속 딥러닝/신경망 기대수익률(Drift) 예측 엔진 (NumPy/RMSProp 기반)"""
    def __init__(self, window_size=30, hidden_dim=64):
        self.window_size = window_size
        self.hidden_dim = hidden_dim
        # 가중치 초기화 (Xavier/He initialization)
        np.random.seed(42)
        self.W_in = np.random.randn(window_size, hidden_dim) * np.sqrt(2.0 / window_size)
        self.b_in = np.zeros(hidden_dim)
        self.W_out = np.random.randn(hidden_dim, 1) * np.sqrt(2.0 / hidden_dim)
        self.b_out = np.zeros(1)
        
    def fit(self, x_train: np.ndarray, y_train: np.ndarray, epochs=25, lr=0.01):
        """RMSProp 최적화 기법을 통한 신경망 피팅"""
        N = x_train.shape[0]
        x_flat = x_train.reshape(N, -1)
        
        eg_W_in = np.zeros_like(self.W_in)
        eg_b_in = np.zeros_like(self.b_in)
        eg_W_out = np.zeros_like(self.W_out)
        eg_b_out = np.zeros_like(self.b_out)
        gamma = 0.9
        eps = 1e-8
        
        for epoch in range(epochs):
            # 순전파 (Forward pass)
            h = np.maximum(0, np.dot(x_flat, self.W_in) + self.b_in) # ReLU
            y_pred = np.dot(h, self.W_out) + self.b_out
            
            # 손실 (MSE gradient)
            dy = (y_pred.flatten() - y_train) / N
            dy = dy.reshape(-1, 1)
            
            # 역전파 (Backpropagation)
            dW_out = np.dot(h.T, dy)
            db_out = np.sum(dy, axis=0)
            dh = np.dot(dy, self.W_out.T)
            dh[h <= 0] = 0
            
            dW_in = np.dot(x_flat.T, dh)
            db_in = np.sum(dh, axis=0)
            
            # RMSProp 파라미터 업데이트
            eg_W_in = gamma * eg_W_in + (1 - gamma) * (dW_in ** 2)
            self.W_in -= lr * dW_in / (np.sqrt(eg_W_in) + eps)
            
            eg_b_in = gamma * eg_b_in + (1 - gamma) * (db_in ** 2)
            self.b_in -= lr * db_in / (np.sqrt(eg_b_in) + eps)
            
            eg_W_out = gamma * eg_W_out + (1 - gamma) * (dW_out ** 2)
            self.W_out -= lr * dW_out / (np.sqrt(eg_W_out) + eps)
            
            eg_b_out = gamma * eg_b_out + (1 - gamma) * (db_out ** 2)
            self.b_out -= lr * db_out / (np.sqrt(eg_b_out) + eps)

    def predict_batch(self, x_batch: np.ndarray) -> np.ndarray:
        N = x_batch.shape[0]
        x_flat = x_batch.reshape(N, -1)
        h = np.maximum(0, np.dot(x_flat, self.W_in) + self.b_in)
        y_pred = np.dot(h, self.W_out) + self.b_out
        return y_pred.flatten()

import time
import threading

_PREDICT_CACHE = {}
PREDICT_CACHE_LOCK = threading.Lock()
PREDICT_CACHE_TTL = 600  # 10분

def run_monte_carlo_prediction(ticker: str, period_key: str = "1m", base_date_str: str = None):
    """LSTM + 몬테카를로 1,000회 시뮬레이션 예측 수행 (인메모리 캐싱 적용)"""
    if period_key not in PERIOD_CONFIG:
        period_key = "1m"

    cache_key = (ticker.upper(), period_key, base_date_str or "today")
    now = time.time()
    with PREDICT_CACHE_LOCK:
        if cache_key in _PREDICT_CACHE:
            ts, res_data = _PREDICT_CACHE[cache_key]
            if now - ts < PREDICT_CACHE_TTL:
                return res_data
        
    cfg = PERIOD_CONFIG[period_key]
    interval = cfg["interval"]
    forecast_steps = cfg["steps"]
    period_label = cfg["label"]
    
    if not base_date_str:
        base_date = datetime.now()
    else:
        try:
            base_date = datetime.strptime(base_date_str, "%Y-%m-%d")
        except Exception:
            base_date = datetime.now()
            
    today_dt = datetime.now()
    train_end_str = base_date.strftime("%Y-%m-%d")
    # 최적화: 10년치 시세 데이터 다운로드 대신 최근 2년치(약 500영업일)로 축소하여 속도 5배 향상
    train_start_str = (base_date - relativedelta(years=2)).strftime("%Y-%m-%d")
    download_end_str = today_dt.strftime("%Y-%m-%d") if base_date <= today_dt else train_end_str
    
    stock_data = load_stock_data(ticker, train_start_str, download_end_str, interval)
    if stock_data.empty or len(stock_data) < 40:
        return {"error": f"종목({ticker}) 시세 데이터가 부족하거나 조회할 수 없습니다."}
        
    train_data = stock_data.loc[:train_end_str]
    if len(train_data) < 35:
        train_data = stock_data

        
    close_prices_train = train_data['Close'].values.flatten()
    close_prices = stock_data['Close'].values.flatten()
    dates = [d.strftime("%Y-%m-%d") for d in stock_data.index]
    
    # 통화 유무 판별
    ticker_prefix = ticker.split(".")[0]
    is_krw = len(ticker_prefix) == 6 and ticker_prefix.isdigit() or ticker.endswith(".KS") or ticker.endswith(".KQ")
    currency_symbol = "₩" if is_krw else "$"
    
    window_size = 30
    log_returns_train = np.log(close_prices_train[1:] / close_prices_train[:-1])
    
    if len(log_returns_train) <= window_size:
        return {"error": "학습에 필요한 최소 데이터 수가 부족합니다."}
        
    x_train = []
    y_train = []
    for i in range(len(log_returns_train) - window_size):
        x_train.append(log_returns_train[i : i + window_size])
        y_train.append(log_returns_train[i + window_size])
    x_train = np.array(x_train).reshape((-1, window_size, 1))
    y_train = np.array(y_train)
    
    # 모델 학습
    model = LightweightLSTMModel(window_size=window_size, hidden_dim=64)
    model.fit(x_train, y_train, epochs=20, lr=0.01)
    
    # 몬테카를로 1,000회 시뮬레이션
    num_simulations = 1000
    sigma = np.std(log_returns_train)
    
    last_actual_prices = close_prices[-(window_size+1):]
    last_actual_log_returns = np.log(last_actual_prices[1:] / last_actual_prices[:-1])
    if len(last_actual_log_returns) < window_size:
        # 데이터 부족 시 채우기
        last_actual_log_returns = np.pad(last_actual_log_returns, (window_size - len(last_actual_log_returns), 0), 'edge')
        
    sim_returns_buffer = np.tile(last_actual_log_returns, (num_simulations, 1)).reshape((num_simulations, window_size, 1))
    sim_prices = np.full((num_simulations,), close_prices[-1])
    simulated_paths = np.zeros((num_simulations, forecast_steps))
    
    for step in range(forecast_steps):
        expected_returns = model.predict_batch(sim_returns_buffer)
        shocks = np.random.normal(loc=0, scale=sigma, size=(num_simulations,))
        sim_step_returns = expected_returns + shocks
        sim_prices = sim_prices * np.exp(sim_step_returns)
        simulated_paths[:, step] = sim_prices
        
        sim_returns_buffer[:, :-1, :] = sim_returns_buffer[:, 1:, :]
        sim_returns_buffer[:, -1, 0] = sim_step_returns

    # 날짜 생성
    last_date_obj = stock_data.index[-1]
    future_dates = []
    for i in range(1, forecast_steps + 1):
        if interval == "1d":
            next_d = last_date_obj + timedelta(days=i)
        elif interval == "1wk":
            next_d = last_date_obj + timedelta(weeks=i)
        else:
            next_d = last_date_obj + relativedelta(months=i)
        future_dates.append(next_d.strftime("%Y-%m-%d"))

    # 통계 연산
    conn_prices_paths = np.hstack([np.full((num_simulations, 1), close_prices[-1]), simulated_paths])
    median_path = np.percentile(conn_prices_paths, 50, axis=0)
    upper_95 = np.percentile(conn_prices_paths, 97.5, axis=0)
    lower_95 = np.percentile(conn_prices_paths, 2.5, axis=0)
    upper_80 = np.percentile(conn_prices_paths, 90, axis=0)
    lower_80 = np.percentile(conn_prices_paths, 10, axis=0)
    
    current_price = float(close_prices[-1])
    final_pred_price = float(median_path[-1])
    price_change_pct = ((final_pred_price - current_price) / current_price) * 100
    
    rise_prob = float(np.mean(simulated_paths[:, -1] > current_price) * 100)
    
    lower_95_final = float(lower_95[-1])
    upper_95_final = float(upper_95[-1])
    max_upside_pct = float(((upper_95_final - current_price) / current_price) * 100)
    max_downside_pct = float(((lower_95_final - current_price) / current_price) * 100)
    
    recent_start = float(close_prices[-window_size]) if len(close_prices) >= window_size else float(close_prices[0])
    recent_trend_pct = float(((current_price - recent_start) / recent_start) * 100)
    
    if rise_prob > 60:
        opinion_text = "적극 매수 (Strong Buy)"
        opinion_color = "#34d399"
    elif rise_prob < 40:
        opinion_text = "적극 매도 (Strong Sell)"
        opinion_color = "#f87171"
    else:
        opinion_text = "보유/중립 (Hold)"
        opinion_color = "#fbbf24"
        
    # 시각화용 과거 데이터 범위 컷 (최근 60개)
    show_historical_len = min(len(close_prices), 60)
    hist_dates_cut = dates[-show_historical_len:]
    hist_prices_cut = [round(float(p), 2 if not is_krw else 0) for p in close_prices[-show_historical_len:]]
    
    all_future_dates = [dates[-1]] + future_dates
    
    res_dict = {
        "ticker": ticker,
        "is_krw": is_krw,
        "currency_symbol": currency_symbol,
        "current_price": round(current_price, 2 if not is_krw else 0),
        "final_pred_price": round(final_pred_price, 2 if not is_krw else 0),
        "price_change_pct": round(price_change_pct, 2),
        "rise_prob": round(rise_prob, 1),
        "recent_trend_pct": round(recent_trend_pct, 2),
        "opinion_text": opinion_text,
        "opinion_color": opinion_color,
        "max_upside_pct": round(max_upside_pct, 2),
        "max_downside_pct": round(max_downside_pct, 2),
        "lower_95_final": round(lower_95_final, 2 if not is_krw else 0),
        "upper_95_final": round(upper_95_final, 2 if not is_krw else 0),
        "period_label": period_label,
        "hist_dates": hist_dates_cut,
        "hist_prices": hist_prices_cut,
        "future_dates": all_future_dates,
        "median_path": [round(float(p), 2 if not is_krw else 0) for p in median_path],
        "upper_80": [round(float(p), 2 if not is_krw else 0) for p in upper_80],
        "lower_80": [round(float(p), 2 if not is_krw else 0) for p in lower_80],
        "upper_95": [round(float(p), 2 if not is_krw else 0) for p in upper_95],
        "lower_95": [round(float(p), 2 if not is_krw else 0) for p in lower_95]
    }

    with PREDICT_CACHE_LOCK:
        _PREDICT_CACHE[cache_key] = (now, res_dict)

    return res_dict

