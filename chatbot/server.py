"""챗봇 웹 API — 출석 앱의 '챗봇' 탭이 호출한다.

실행: python server.py   (기본 http://localhost:8800)
POST /api/chat  {"question": "..."}  →  {"mode": "tactics|stats", "answer": "...", "detail": "..."}
GET  /api/health
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from chatbot import make_bot

PORT = 8800
ask = make_bot()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/chat":
            return self._send(404, {"error": "not found"})
        try:
            size = int(self.headers.get("Content-Length", 0))
            q = str(json.loads(self.rfile.read(size) or b"{}").get("question", "")).strip()
        except (ValueError, TypeError):
            return self._send(400, {"error": "잘못된 요청입니다"})
        if not q:
            return self._send(400, {"error": "질문을 입력하세요"})
        try:
            self._send(200, ask(q[:500]))
        except Exception as e:  # Ollama 꺼짐 등
            self._send(500, {"error": f"답변 생성 실패: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[chat] " + fmt % args + "\n")


if __name__ == "__main__":
    print(f"챗봇 서버: http://localhost:{PORT}  (종료: Ctrl+C)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
