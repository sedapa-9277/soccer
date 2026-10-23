// 전술 챗봇 탭 — 이 PC에서 켠 챗봇 서버(chatbot/server.py)에 질문을 보낸다.
(function () {
  const API = "http://localhost:8800";
  const $ = (id) => document.getElementById(id);
  const log = $("chatLog"), form = $("chatForm"), input = $("chatInput"), send = $("chatSend"), status = $("chatStatus");
  let busy = false;

  function add(role, text, detail) {
    const box = document.createElement("div");
    box.className = "msg " + role;
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
    if (detail) {
      const d = document.createElement("details");
      const s = document.createElement("summary");
      s.textContent = role === "bot stats" ? "집계 결과 (DB 원본 기준)" : "근거";
      const pre = document.createElement("pre");
      pre.textContent = detail;
      d.append(s, pre);
      if (role === "bot stats") d.open = true;
      box.appendChild(d);
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
    return box;
  }

  async function checkServer() {
    try {
      const r = await fetch(API + "/api/health", { cache: "no-store" });
      if (!r.ok) throw new Error();
      status.textContent = "서버 연결됨";
      status.dataset.ok = "1";
      return true;
    } catch (e) {
      status.textContent = "서버 꺼짐";
      status.dataset.ok = "0";
      return false;
    }
  }

  async function ask(q) {
    if (busy || !q) return;
    busy = true;
    send.disabled = true;
    add("me", q);
    const wait = add("bot", "답변을 만드는 중… (처음에는 1분 가까이 걸릴 수 있어요)");
    try {
      const r = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await r.json();
      wait.remove();
      if (!r.ok) add("bot", data.error || "답변을 받지 못했습니다.");
      else add(data.mode === "stats" ? "bot stats" : "bot", data.answer, data.detail);
    } catch (e) {
      wait.remove();
      add("bot", "챗봇 서버에 연결할 수 없습니다. chatbot 폴더의 start_chatbot.bat 을 실행한 뒤 다시 질문해 주세요.");
      checkServer();
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    input.value = "";
    ask(q);
  });
  $("chatSugg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) ask(b.textContent.trim());
  });

  add("bot", "안녕하세요! 축구 전술이나 출석 통계를 물어보세요. 예) \"4-3-3 포메이션의 장단점은?\", \"이번 달 출석 많은 순서로 보여줘\"");
  checkServer();
  document.querySelector('#tabbar [data-tab="chat"]').addEventListener("click", checkServer);
})();
