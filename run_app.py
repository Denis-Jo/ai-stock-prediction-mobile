import sys
import os
import socket
import subprocess
import webbrowser
import qrcode

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def main():
    ip = get_local_ip()
    port = 8000
    mobile_url = f"http://{ip}:{port}"
    
    print("\n" + "=" * 65)
    print(" [+] AI Stock Prediction & Recommendation Mobile App (iPhone / PWA)")
    print("=" * 65)
    print(f"\n[+] Local PC Access : http://localhost:{port}")
    print(f"[+] iPhone Wi-Fi Access : {mobile_url}")
    print("\n[+] Scan the QR Code below with your iPhone Camera:")
    print("-" * 65 + "\n")
    
    # 터미널에 텍스트 QR 코드 출력
    qr = qrcode.QRCode(border=1)
    qr.add_data(mobile_url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
    
    print("-" * 65)
    print("Web Browser: Open http://localhost:8000 -> Click 'iPhone App (아이폰 앱)' Tab!")
    print("=" * 65 + "\n")
    
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(port)]
    
    try:
        webbrowser.open(f"http://localhost:{port}")
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n[!] Mobile app server stopped.")

if __name__ == "__main__":
    main()
