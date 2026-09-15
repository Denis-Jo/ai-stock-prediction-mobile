import os
import socket
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from quant_engine import search_stock_list, get_quant_recommendations
from prediction_engine import run_monte_carlo_prediction

app = FastAPI(
    title="AI 기반 주식 예측 및 추천 모바일 API",
    description="아이폰 및 모바일 기기를 위한 딥러닝 몬테카를로 주가 예측 REST API",
    version="2.0.0"
)

# CORS 허용 (모바일 디바이스 및 외부 Wi-Fi 접속 원활화)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_local_ip():
    """아이폰 및 외부 기기 연결용 로컬 LAN IP 자동 감지"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

@app.get("/api/stocks/search")
def api_search_stocks(q: str = Query("", description="검색어 (한글, 영문, 티커)")):
    """종목 실시간 검색 API"""
    if not q:
        return {"results": []}
    results = search_stock_list(q)
    return {"results": results}

@app.get("/api/stocks/recommendations")
def api_recommendations(days: int = Query(20, description="예측 기대일수")):
    """국내 및 해외 퀀트 추천 종목 상위 5개 반환"""
    data = get_quant_recommendations(forecast_days=days)
    return data

@app.get("/api/stocks/predict")
def api_predict(
    ticker: str = Query("005930.KS", description="주식 티커"),
    period: str = Query("1m", description="예측 기간 (1d, 1w, 1m, 6m, 1y)"),
    base_date: str = Query(None, description="예측 기준 시점 (YYYY-MM-DD)")
):
    """LSTM + 몬테카를로 1,000회 주가 예측 API"""
    res = run_monte_carlo_prediction(ticker=ticker, period_key=period, base_date_str=base_date)
    return res

import threading
import subprocess
import re
import time

public_tunnel_url = ""

def start_public_tunnel():
    global public_tunnel_url
    try:
        cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-R", "80:localhost:8000", "nokey@localhost.run"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in iter(proc.stdout.readline, ''):
            if "lhr.life" in line or "https://" in line:
                match = re.search(r'https://[a-zA-Z0-9\.\-]+\.lhr\.life', line)
                if match:
                    public_tunnel_url = match.group(0)
                    print(f"\n[🌐 PUBLIC TUNNEL ACTIVE] LTE/5G Public HTTPS URL: {public_tunnel_url}\n")
                    break
    except Exception as e:
        print(f"Tunnel start error: {e}")

# 백엔드 시작 시 자동 퍼블릭 터널 생성
threading.Thread(target=start_public_tunnel, daemon=True).start()

@app.get("/api/network-info")
def api_network_info():
    """아이폰 접속용 로컬 네트워크 IP, 퍼블릭 HTTPS URL 및 QR 정보"""
    ip = get_local_ip()
    port = 8000
    mobile_url = f"http://{ip}:{port}"
    
    # 퍼블릭 URL이 생성되었으면 퍼블릭 URL을 우선 QR 코드로 전달
    target_url = public_tunnel_url if public_tunnel_url else mobile_url
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={target_url}"
    
    return {
        "ip": ip,
        "port": port,
        "local_url": f"http://localhost:{port}",
        "mobile_url": mobile_url,
        "public_url": public_tunnel_url,
        "active_url": target_url,
        "qr_url": qr_url
    }


# 정적 웹 앱 파일 호스팅 (PWA 프론트엔드)
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def read_root():
    """루트 접속 시 PWA 메인 모바일 앱 index.html 반환"""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "AI Stock Prediction Mobile App Server is running. Frontend static files loading..."}

if __name__ == "__main__":
    import uvicorn
    local_ip = get_local_ip()
    print("=" * 60)
    print(f"[+] AI Stock Prediction Mobile App Server Started!")
    print(f"[+] iPhone URL: http://{local_ip}:8000")
    print(f"[+] PC URL: http://localhost:8000")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)

