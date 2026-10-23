"""축구 전술 챗봇 (RAG + 출석 통계).

- 전술 질문: docs/*.doc 를 청킹 → bge-m3 임베딩 → 코사인 유사도 상위 5개 청크를 근거로 qwen2.5:3b 가 답변
- 통계 질문: Supabase(읽기 전용, anon)에서 출석 데이터를 읽어 파이썬으로 집계한 뒤 그 표를 근거로 답변

실행: python chatbot.py            (대화형)
      python chatbot.py "4-3-3이 뭐야?"   (한 번만 질문)
"""
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path

import requests
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

HERE = Path(__file__).parent
DOCS_DIR = HERE / "docs"
CACHE_FILE = HERE / ".embed_cache.json"
LLM_MODEL = "qwen2.5:3b"   # llmfit 추천(이 PC: RAM 8GB, 내장 GPU) — Ollama 모델
EMBED_MODEL = "bge-m3"     # 한국어 지원 다국어 임베딩
TOP_K = 5

# 출석 앱과 같은 Supabase 프로젝트(읽기 전용). 키는 attendance.js 의 공개 anon 키를 그대로 읽는다.
_js = (HERE.parent / "attendance.js").read_text(encoding="utf-8")
SUPABASE_URL = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', _js).group(1)
SUPABASE_KEY = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', _js).group(1)


# ───────────────────────── 전술 RAG ─────────────────────────
class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def load_docs():
    docs = []
    for path in sorted(DOCS_DIR.glob("*.doc")):
        p = _Text()
        p.feed(path.read_text(encoding="utf-8-sig"))
        text = re.sub(r"\n{3,}", "\n\n", "".join(p.parts)).strip()
        docs.append(Document(page_content=text, metadata={"source": path.name}))
    return docs


class CachedEmbeddings(Embeddings):
    """임베딩을 디스크에 캐시해서 재실행 시 다시 계산하지 않는다."""

    def __init__(self, inner):
        self.inner = inner
        try:
            self.cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.cache = {}

    def _key(self, text):
        return hashlib.sha1((EMBED_MODEL + text).encode("utf-8")).hexdigest()

    def embed_documents(self, texts):
        missing = [t for t in texts if self._key(t) not in self.cache]
        if missing:
            for t, v in zip(missing, self.inner.embed_documents(missing)):
                self.cache[self._key(t)] = v
            CACHE_FILE.write_text(json.dumps(self.cache), encoding="utf-8")
        return [self.cache[self._key(t)] for t in texts]

    def embed_query(self, text):
        return self.inner.embed_query(text)


def build_store():
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=80)
    chunks = splitter.split_documents(load_docs())
    emb = CachedEmbeddings(OllamaEmbeddings(model=EMBED_MODEL))
    store = InMemoryVectorStore(emb)  # 코사인 유사도
    store.add_documents(chunks)
    return store, len(chunks)


TACTIC_PROMPT = """너는 축구 전술 전문가 챗봇이다. 아래 [자료]만 근거로 한국어로 답한다.
자료에 없는 내용은 "자료에 없는 내용입니다"라고 말하고 추측하지 않는다.

[자료]
{context}

[질문]
{question}"""


def answer_tactics(llm, store, question):
    hits = store.similarity_search_with_score(question, k=TOP_K)
    context = "\n\n".join(f"({i + 1}) {d.page_content}" for i, (d, _) in enumerate(hits))
    reply = llm.invoke(TACTIC_PROMPT.format(context=context, question=question)).content
    refs = ", ".join(f"{d.metadata['source']}({s:.2f})" for d, s in hits)
    return reply, f"근거 청크 {len(hits)}개 · 코사인 유사도: {refs}"


# ───────────────────────── 출석 통계 ─────────────────────────
def _get(table, select="*", extra=""):
    rows, start = [], 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?select={select}{extra}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range": f"{start}-{start + 999}",
            },
            timeout=20,
        )
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < 1000:
            return rows
        start += 1000


class Stats:
    def __init__(self):
        self.refresh()

    def refresh(self):
        self.members = {m["id"]: m for m in _get("members")}
        self.att = _get("attendance", "day,member_id,game")
        self.team_names = {t["team"]: t["name"] for t in _get("team_names") if t.get("active", True)}

    def team_label(self, team):
        return self.team_names.get(team, f"{team}팀")

    def period(self, q):
        today = date.today()
        if "이번달" in q.replace(" ", "") or "이번 달" in q:
            return today.replace(day=1), today, "이번 달"
        if "지난달" in q.replace(" ", ""):
            end = today.replace(day=1) - timedelta(days=1)
            return end.replace(day=1), end, "지난달"
        m = re.search(r"최근\s*(\d+)\s*(개월|달|주|일)", q)
        if m:
            n, unit = int(m.group(1)), m.group(2)
            days = n * (30 if unit in ("개월", "달") else 7 if unit == "주" else 1)
            return today - timedelta(days=days), today, f"최근 {n}{unit}"
        return date.min, date.max, "전체 기간"

    def summarize(self, q):
        lo, hi, label = self.period(q)
        # member -> day -> 참여 경기 번호
        played = defaultdict(lambda: defaultdict(list))
        team_days = defaultdict(set)
        for a in self.att:
            m = self.members.get(a["member_id"])
            d = date.fromisoformat(a["day"])
            if not m or not (lo <= d <= hi):
                continue
            played[a["member_id"]][a["day"]].append(a["game"])
            team_days[m["team"]].add(a["day"])

        asked = [m for m in self.members.values() if m["name"] in q]
        want_team = [t for t in self.team_names if self.team_label(t) in q or t in q]
        if asked:
            targets = asked
        elif want_team:
            targets = [m for m in self.members.values() if m["team"] in want_team and m["active"]]
        else:
            targets = [m for m in self.members.values() if m["active"]]

        lines = [f"기간: {label}"]
        for t, days in sorted(team_days.items()):
            lines.append(f"{self.team_label(t)} 모임 {len(days)}일")
        rows = []
        for m in targets:
            days = played.get(m["id"], {})
            total = len(team_days.get(m["team"], ()))
            games = sum(len(g) for g in days.values())
            rows.append((len(days), games, m, total, days))
        rows.sort(key=lambda r: (-r[0], -r[1], r[2]["name"]))

        detail = len(targets) <= 3 and asked
        for n, games, m, total, days in rows:
            line = f"{m['name']}({self.team_label(m['team'])}{'' if m['active'] else ', 비활동'}): 참석 {n}/{total}일, 총 {games}경기"
            if detail:
                line += " | " + ", ".join(f"{d}(경기 {','.join(map(str, sorted(g)))})" for d, g in sorted(days.items()))
            lines.append(line)
        return "\n".join(lines)


STATS_PROMPT = """너는 축구 동호회 출석 통계 도우미다. 아래 [출석 데이터]를 근거로 질문에 대한 핵심만 한국어 한두 문장으로 요약한다.
목록이나 표는 만들지 않는다(원본 표는 따로 보여준다). 숫자를 바꾸거나 데이터에 없는 내용을 만들지 않는다.

[출석 데이터]
{data}

[질문]
{question}"""

STATS_WORDS = ("출석", "참석", "통계", "명단", "몇 번", "몇번", "몇 경기", "출전", "결석", "참여율")


def is_stats(question, stats):
    if any(w in question for w in STATS_WORDS):
        return True
    return stats is not None and any(m["name"] in question for m in stats.members.values())


def answer_stats(llm, stats, question):
    data = stats.summarize(question)
    reply = llm.invoke(STATS_PROMPT.format(data=data, question=question)).content
    return reply, data


# ───────────────────────── 실행 ─────────────────────────
def make_bot():
    """질문 문자열 → {"mode", "answer", "detail"} 를 돌려주는 함수와 준비 정보를 만든다."""
    print("전술 문서 인덱싱 중...", flush=True)
    store, n = build_store()
    llm = ChatOllama(model=LLM_MODEL, temperature=0.1, num_ctx=4096)
    stats = None
    try:
        stats = Stats()
    except requests.RequestException as e:
        print(f"(출석 DB 연결 실패 — 통계 질문은 건너뜁니다: {e})")
    print(f"준비 완료: 청크 {n}개, 모델 {LLM_MODEL}, 임베딩 {EMBED_MODEL}, 상위 {TOP_K}개 검색", flush=True)

    def ask(q):
        if stats is not None and is_stats(q, stats):
            try:
                stats.refresh()  # 출석은 계속 바뀌므로 질문마다 최신 데이터를 받는다
            except requests.RequestException:
                pass
            reply, data = answer_stats(llm, stats, q)
            return {"mode": "stats", "answer": reply, "detail": data}
        reply, refs = answer_tactics(llm, store, q)
        return {"mode": "tactics", "answer": reply, "detail": refs}

    return ask


def main():
    ask = make_bot()

    def show(q):
        r = ask(q)
        label = "집계 결과 — DB 원본 기준" if r["mode"] == "stats" else "근거"
        print(f"{r['answer']}\n\n[{label}]\n{r['detail']}")
    if len(sys.argv) > 1:
        show(" ".join(sys.argv[1:]))
        return
    print("질문을 입력하세요 (종료: 빈 줄 또는 q)")
    while True:
        q = input("\n> ").strip()
        if not q or q.lower() == "q":
            break
        show(q)


if __name__ == "__main__":
    main()
