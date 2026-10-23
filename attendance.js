(() => {
  // ---------- Supabase 설정 (공개용 anon 키: 읽기만 가능, 수정은 PIN 확인 함수로만) ----------
  const SUPABASE_URL = "https://ldektmvedvhumdvrdbxj.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkZWt0bXZlZHZodW1kdnJkYnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NTQ0NTEsImV4cCI6MjEwODEzMDQ1MX0.2ZazwLYXhTwTF1bs9NSFhoSjQlZmvaSRuAEi3FkUyDQ";
  const PIN_KEY = "soccer-attendance-pin";
  const TEAM_KEY = "soccer-attendance-team";

  // [팀 이름, 주소 뒤 # 링크]
  const TEAMS = [["믿음", "faith"], ["소망", "hope"], ["사랑", "love"]];
  const teamFromHash = () => TEAMS.find(([t, h]) => "#" + h === location.hash && S.teamActive[t] !== false)?.[0] || null;

  const GAMES = [1, 2, 3, 4, 5, 6];
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const $ = (id) => document.getElementById(id);

  // 포메이션: [포지션, x%, y%] — 위쪽이 상대 골문, 첫 번째는 항상 GK
  const FORMATIONS = {
    "4-4-2": [["GK", 50, 91], ["LB", 14, 72], ["CB", 38, 75], ["CB", 62, 75], ["RB", 86, 72],
              ["LM", 14, 47], ["CM", 38, 51], ["CM", 62, 51], ["RM", 86, 47], ["ST", 37, 22], ["ST", 63, 22]],
    "4-3-3": [["GK", 50, 91], ["LB", 14, 72], ["CB", 38, 75], ["CB", 62, 75], ["RB", 86, 72],
              ["CM", 24, 50], ["CM", 50, 54], ["CM", 76, 50], ["LW", 16, 23], ["ST", 50, 18], ["RW", 84, 23]],
    "4-2-3-1": [["GK", 50, 91], ["LB", 14, 73], ["CB", 38, 76], ["CB", 62, 76], ["RB", 86, 73],
                ["DM", 36, 57], ["DM", 64, 57], ["LW", 15, 36], ["CAM", 50, 38], ["RW", 85, 36], ["ST", 50, 15]],
    "3-5-2": [["GK", 50, 91], ["CB", 24, 74], ["CB", 50, 77], ["CB", 76, 74],
              ["LWB", 11, 49], ["CM", 31, 53], ["CM", 50, 45], ["CM", 69, 53], ["RWB", 89, 49], ["ST", 37, 21], ["ST", 63, 21]],
  };
  const DEFAULT_FORMATION = "4-4-2";

  // ---------- 상태 ----------
  const S = {
    sb: null,
    mode: "loading",          // loading | live | offline
    pin: null,                // 잠금 해제된 PIN (이 브라우저 탭에서만 기억)
    team: "믿음",
    members: new Map(),       // id -> {name, active, team}
    days: new Map(),          // "YYYY-MM-DD" -> {att: {memberId: {g1:true,...}}, lineup: {팀: {g1: {formation, pos: {s0: memberId}}}}}
    pending: new Map(),       // "date|mid|gN" -> bool (낙관적 반영)
    pendingLineup: new Map(), // "date|팀|gN|sI" -> memberId|null, "date|팀|gN|form" -> 포메이션
    lineupGame: 1,
    pickSlot: null,
    date: ymd(new Date()),
    period: "month",
    rankSort: "rate",         // rate | name
    rankOpen: null,           // 통계에서 최근 10경기를 펼친 회원 id
    shownGames: new Map(),    // "date|팀" -> 출석판에 직접 늘려 둔 경기 수
    confirmDeleteDay: null,   // "date|팀": 날짜 기록 삭제 확인 중
    confirmClearGame: null,   // "date|팀|gN": 경기 참석 초기화 확인 중
    teamNames: {},            // 팀 구분값 -> 화면에 보이는 팀 이름
    teamActive: {},           // 팀 구분값 -> 사용 중 여부 (삭제된 팀은 false)
    confirmTeamDel: null,     // 팀 삭제 확인 중인 팀
    confirmPurgeAll: null,    // 팀 회원 전체 삭제 확인 중인 팀
    addingTeam: false,        // 팀 추가 이름 입력 중
    editTeamName: false,      // 회원 관리에서 팀 이름 고치는 중
    confirmDel: null,
    confirmPurge: null,
    editId: null,
    editDraft: null,
    editTeam: null,
  };

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function label(s, short) {
    const d = parseYmd(s);
    return short ? `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`
                 : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  }
  function shiftDate(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }

  function attended(date, mid, g) {
    const k = `${date}|${mid}|g${g}`;
    if (S.pending.has(k)) return S.pending.get(k);
    return S.days.get(date)?.att?.[mid]?.[`g${g}`] === true;
  }
  // 지금 고른 팀의 회원만 (명단에서 뺀 회원 포함 여부 선택)
  function teamMembers(includeInactive) {
    return [...S.members.entries()]
      .filter(([, m]) => m.team === S.team && (includeInactive || m.active !== false))
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "ko"));
  }
  function activeMembers() { return teamMembers(false); }
  function nameTakenBy(name, exceptId) {
    for (const [id, m] of S.members) if (id !== exceptId && m.active && m.name === name) return m;
    return null;
  }
  function memberName(id) { return S.members.get(id)?.name || "(삭제된 회원)"; }
  // 화면에 보이는 팀 이름 (회원 관리에서 바꿀 수 있음). 저장된 이름이 없으면 "믿음팀"처럼 기본값
  function tn(team) { return S.teamNames[team] || `${team}팀`; }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function showNotice(msg) { const n = $("notice"); n.textContent = msg; n.hidden = !msg; }

  // ---------- 불러오기 ----------
  async function fetchAll(table, cols, orderCols) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = S.sb.from(table).select(cols);
      orderCols.forEach((c) => { q = q.order(c); });
      const { data, error } = await q.range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  function dayOf(map, d) {
    if (!map.has(d)) map.set(d, { att: {}, lineup: {} });
    return map.get(d);
  }

  let loadSeq = 0;
  async function reload() {
    const seq = ++loadSeq;
    try {
      const [members, att, lineups, slots, teamNames] = await Promise.all([
        fetchAll("members", "id,name,active,team", ["created_at", "id"]),
        fetchAll("attendance", "day,member_id,game", ["day", "member_id", "game"]),
        fetchAll("lineups", "day,team,game,formation", ["day", "team", "game"]),
        fetchAll("lineup_slots", "day,team,game,slot,member_id", ["day", "team", "game", "slot"]),
        fetchAll("team_names", "team,name,active", ["team"]).catch(() => fetchAll("team_names", "team,name", ["team"]).catch(() => [])),
      ]);
      if (seq !== loadSeq) return;
      S.members = new Map(members.map((m) => [m.id, { name: m.name, active: m.active, team: m.team }]));
      S.teamNames = Object.fromEntries(teamNames.map((t) => [t.team, t.name]));
      S.teamActive = Object.fromEntries(teamNames.map((t) => [t.team, t.active !== false]));
      if (S.teamActive[S.team] === false) { const first = activeTeams()[0]; if (first) setTeam(first[0]); }
      const days = new Map();
      for (const r of att) {
        const d = dayOf(days, r.day);
        (d.att[r.member_id] ||= {})[`g${r.game}`] = true;
      }
      const lu = (r) => ((dayOf(days, r.day).lineup[r.team] ||= {})[`g${r.game}`] ||= { pos: {} });
      for (const r of lineups) lu(r).formation = r.formation;
      for (const r of slots) lu(r).pos[`s${r.slot}`] = r.member_id;
      S.days = days;
      if (S.mode !== "live") showNotice("");
      S.mode = "live";
    } catch (e) {
      if (seq !== loadSeq) return;
      if (S.mode === "loading") S.mode = "offline";
      showNotice("출석 기록을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.");
    }
    renderAll();
  }

  let reloadTimer;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 250);
  }

  // ---------- 저장 (모든 수정은 PIN을 확인하는 DB 함수로) ----------
  async function rpc(name, params) {
    const { data, error } = await S.sb.rpc(name, { p_pin: S.pin, ...params });
    if (error) throw error;
    return data;
  }

  // 잠긴 상태면 안내만 띄운다. PIN 칸으로 포커스를 옮기면 휴대폰에서 화면이 맨 위로 튀고 키패드가 올라오므로 옮기지 않는다
  function needPin() {
    if (S.pin) return false;
    toast("보기 전용입니다. 수정하려면 맨 위 PIN 칸에 4자리를 입력해 주세요.");
    return true;
  }

  function handleErr(e) {
    const msg = String(e?.message || "");
    if (msg.includes("invalid_pin")) {
      lock();
      toast("PIN이 바뀌었거나 맞지 않습니다. 다시 입력해 주세요.");
    } else if (msg.includes("last_team")) {
      toast("마지막 남은 팀은 삭제할 수 없습니다.");
    } else if (msg.includes("team_limit")) {
      toast("팀은 최대 3개까지 만들 수 있습니다.");
    } else if (msg.includes("duplicate_team_name")) {
      toast("다른 팀이 이미 쓰는 이름입니다.");
    } else if (msg.includes("duplicate_name")) {
      toast("같은 이름의 회원이 이미 명단에 있습니다.");
    } else if (msg.includes("wrong_team")) {
      toast("다른 팀 회원은 이 팀 포지션에 넣을 수 없습니다.");
    } else if (msg.includes("empty_name")) {
      toast("이름을 입력해 주세요.");
    } else {
      toast("저장하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.");
    }
  }

  const queues = new Map();
  function enqueue(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(key, next.catch(() => {}));
    return next;
  }

  // pend: [[map, key, value]] 낙관적 반영 목록. 성공하면 okMsg를 띄우고 true를 돌려준다
  function write(key, pend, call, okMsg) {
    if (needPin()) return Promise.resolve(false);
    pend.forEach(([m, k, v]) => m.set(k, v));
    renderAll();
    return enqueue(key, async () => {
      try {
        const r = await call();
        await reload();
        if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
        return true;
      } catch (e) {
        handleErr(e);
        return false;
      } finally {
        pend.forEach(([m, k]) => m.delete(k));
        renderAll();
      }
    });
  }

  // ---------- 출석 ----------
  // 출석 해제 시 그 경기 포지션에서도 함께 빠진다 (DB 함수가 처리)
  function setGames(mid, games, on) {
    const date = S.date;
    const pend = games.map((g) => [S.pending, `${date}|${mid}|g${g}`, on]);
    let fromLineup = false;
    if (!on) {
      for (const g of games) {
        lineupOf(date, g).slots.forEach((v, i) => {
          if (v === mid) { pend.push([S.pendingLineup, `${date}|${S.team}|g${g}|s${i}`, null]); fromLineup = true; }
        });
      }
    }
    const msg = fromLineup ? `${memberName(mid)} 님을 포지션에서도 뺐습니다.` : null;
    return write(date, pend, () => rpc("set_attendance", { p_day: date, p_member: mid, p_games: games, p_on: on }), msg);
  }

  function toggleCell(mid, g) {
    const on = !attended(S.date, mid, g);
    // 방금 체크한 칸만 축구공이 통통 튀게 표시한다
    if (on && S.pin) {
      const key = `${S.date}|${mid}|g${g}`;
      S.popKey = key;
      setTimeout(() => { if (S.popKey === key) S.popKey = null; }, 700);
    }
    return setGames(mid, [g], on);
  }

  // ---------- 포지션 배치 ----------
  function lineupOf(date, g) {
    const t = S.team;
    const base = S.days.get(date)?.lineup?.[t]?.[`g${g}`] || {};
    const fk = `${date}|${t}|g${g}|form`;
    let formation = S.pendingLineup.has(fk) ? S.pendingLineup.get(fk) : base.formation;
    if (!FORMATIONS[formation]) formation = DEFAULT_FORMATION;
    const slots = FORMATIONS[formation].map((_, i) => {
      const k = `${date}|${t}|g${g}|s${i}`;
      const v = S.pendingLineup.has(k) ? S.pendingLineup.get(k) : base.pos?.[`s${i}`];
      return v && S.members.get(v)?.team === t ? v : null;
    });
    return { formation, slots };
  }

  function placeMember(slotIdx, mid) {
    if (needPin()) return;
    const date = S.date, g = S.lineupGame, t = S.team;
    const lu = lineupOf(date, g);
    const pend = [[S.pendingLineup, `${date}|${t}|g${g}|s${slotIdx}`, mid]];
    if (mid) {
      lu.slots.forEach((v, i) => { if (v === mid && i !== slotIdx) pend.push([S.pendingLineup, `${date}|${t}|g${g}|s${i}`, null]); });
      pend.push([S.pending, `${date}|${mid}|g${g}`, true]);
    }
    const pos = FORMATIONS[lu.formation][slotIdx][0];
    const msg = mid ? `${memberName(mid)} → ${g}경기 ${pos}, 출석 체크했습니다.`
                    : `${pos} 자리를 비웠습니다. 출석은 출석판에서 해제할 수 있습니다.`;
    // 다 채워도 시트를 닫지 않는다 (닫히면 휴대폰에서 화면이 맨 위로 돌아감) — 닫기는 "닫기" 버튼으로
    S.pickSlot = mid ? nextEmptySlot(lu.slots, slotIdx, mid) ?? slotIdx : slotIdx;
    write(date, pend, () => rpc("place_member", {
      p_day: date, p_team: t, p_game: g, p_slot: slotIdx, p_member: mid || null, p_formation: lu.formation,
    }), msg);
  }

  function nextEmptySlot(slots, from, mid) {
    const after = slots.map((v, i) => (i === from ? mid : v));
    for (let k = 1; k <= after.length; k++) {
      const i = (from + k) % after.length;
      if (!after[i]) return i;
    }
    return null;
  }

  function setFormation(f) {
    const date = S.date, g = S.lineupGame, t = S.team;
    write(date, [[S.pendingLineup, `${date}|${t}|g${g}|form`, f]],
      () => rpc("set_formation", { p_day: date, p_team: t, p_game: g, p_formation: f }));
  }

  // ---------- 포지션 배치를 그림(PNG)으로 저장 ----------
  async function drawLineupImage() {
    const g = S.lineupGame;
    const { formation, slots } = lineupOf(S.date, g);
    const spots = FORMATIONS[formation];
    const d = parseYmd(S.date);

    const W = 1080, PAD = 22, HEAD = 190;
    const PW = W - PAD * 2, PH = Math.round(PW * 100 / 68);
    const H = HEAD + PH + PAD + 50;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const c = cv.getContext("2d");
    const DISPLAY = '"Black Han Sans", "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
    const BODY = '"IBM Plex Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    try { await Promise.all([document.fonts.load(`60px ${DISPLAY}`), document.fonts.load(`700 30px ${BODY}`)]); } catch (e) { /* 기본 글꼴로 그린다 */ }

    const round = (x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

    // 배경과 제목
    c.fillStyle = "#0f1f15";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "#ffffff";
    c.textBaseline = "alphabetic";
    c.font = `64px ${DISPLAY}`;
    c.fillText(`${tn(S.team)} · ${g}경기`, PAD, 92);
    c.font = `500 32px ${BODY}`;
    c.fillStyle = "#b9d7c2";
    c.fillText(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})  ·  ${formation}  ·  ${slots.filter(Boolean).length}/11명`, PAD, 146);

    // 구장: 잔디 줄무늬와 라인
    const X = PAD, Y = HEAD;
    round(X, Y, PW, PH, 22);
    c.save();
    c.clip();
    for (let i = 0; i < 10; i++) {
      c.fillStyle = i % 2 ? "#2a7d43" : "#2f8a4a";
      c.fillRect(X, Y + (PH / 10) * i, PW, PH / 10 + 1);
    }
    c.strokeStyle = "rgba(255,255,255,.7)";
    c.lineWidth = 4;
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    line(X, Y + PH / 2, X + PW, Y + PH / 2);
    c.beginPath();
    c.arc(X + PW / 2, Y + PH / 2, PW * 0.135, 0, Math.PI * 2);
    c.stroke();
    c.strokeRect(X + PW * 0.2, Y - 2, PW * 0.6, PH * 0.16);
    c.strokeRect(X + PW * 0.37, Y - 2, PW * 0.26, PH * 0.06);
    c.strokeRect(X + PW * 0.2, Y + PH * 0.84 + 2, PW * 0.6, PH * 0.16);
    c.strokeRect(X + PW * 0.37, Y + PH * 0.94 + 2, PW * 0.26, PH * 0.06);
    c.restore();
    round(X, Y, PW, PH, 22);
    c.lineWidth = 5;
    c.stroke();

    // 선수
    c.textAlign = "center";
    spots.forEach(([pos, px, py], i) => {
      const cx = X + (PW * px) / 100, cy = Y + (PH * py) / 100;
      const mid = slots[i];
      const R = 62;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      if (mid) {
        c.fillStyle = i === 0 ? "#ffd23f" : "#ffffff";
        c.fill();
        c.fillStyle = i === 0 ? "#2b2100" : "#174f2b";
      } else {
        c.fillStyle = "rgba(0,0,0,.22)";
        c.fill();
        c.setLineDash([10, 8]);
        c.strokeStyle = "rgba(255,255,255,.85)";
        c.lineWidth = 3;
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = "#ffffff";
      }
      c.font = `700 ${pos.length > 2 ? 30 : 36}px ${BODY}`;
      c.textBaseline = "middle";
      c.fillText(pos, cx, cy + 1);

      const name = mid ? memberName(mid) : "-";
      c.font = `700 42px ${BODY}`;
      const tw = Math.min(c.measureText(name).width, 250);
      const bw = tw + 34, bh = 60, by = cy + R + 8;
      round(cx - bw / 2, by, bw, bh, 10);
      c.fillStyle = mid ? "rgba(0,0,0,.72)" : "rgba(0,0,0,0)";
      c.fill();
      c.fillStyle = mid ? "#ffffff" : "rgba(255,255,255,.7)";
      c.fillText(name, cx, by + bh / 2 + 2, 250);
    });

    // 바닥 글씨
    c.textAlign = "right";
    c.textBaseline = "alphabetic";
    c.font = `500 24px ${BODY}`;
    c.fillStyle = "#6f8f78";
    c.fillText("BEST Line-Up", W - PAD, H - 30);

    return new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  }

  // 그림을 화면에 띄운다. 휴대폰은 그림을 길게 눌러 사진에 저장하는 것이 가장 확실하다
  let shot = null; // {blob, name, dataUrl}
  async function saveLineupImage() {
    const btn = $("saveLineupBtn");
    btn.disabled = true;
    try {
      const blob = await drawLineupImage();
      if (!blob) throw new Error("no blob");
      const safeTeam = tn(S.team).replace(/[\\/:*?"<>|\s]+/g, "_");
      const name = `${safeTeam}_${S.date}_${S.lineupGame}경기.png`;
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      shot = { blob, name, dataUrl };
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      $("imgPreview").src = dataUrl;
      $("imgModalTitle").textContent = name.replace(".png", "").replaceAll("_", " · ");
      $("imgTip").innerHTML = !touch
        ? "<b>파일로 저장</b>을 누르면 PNG 파일로 내려받습니다."
        : ios
          ? "그림을 <b>길게 눌러</b> <b>'사진 앱에 저장'</b>을 고르세요."
          : "그림을 <b>길게 눌러</b> <b>'이미지 다운로드'</b>를 고르면 갤러리에 저장됩니다.";
      const file = new File([blob], name, { type: "image/png" });
      $("imgShareBtn").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
      $("imgModal").hidden = false;
      document.body.classList.add("modal-open");
      $("imgCloseBtn").focus();
    } catch (e) {
      toast("그림을 만들지 못했습니다. 다시 눌러 주세요.");
    } finally {
      btn.disabled = false;
    }
  }

  function closeImageModal() {
    $("imgModal").hidden = true;
    document.body.classList.remove("modal-open");
    $("imgPreview").removeAttribute("src");
    shot = null;
  }

  function downloadShot() {
    if (!shot) return;
    const url = URL.createObjectURL(shot.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shot.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("파일로 저장했습니다. 휴대폰은 '다운로드' 또는 '파일' 앱에서 찾을 수 있습니다.");
  }

  async function shareShot() {
    if (!shot) return;
    try {
      await navigator.share({ files: [new File([shot.blob], shot.name, { type: "image/png" })], title: shot.name });
    } catch (e) {
      if (e?.name !== "AbortError") toast("공유하지 못했습니다. 그림을 길게 눌러 저장해 주세요.");
    }
  }

  // ---------- 회원 ----------
  function addMembers(names) {
    const taken = names.map((n) => [n, nameTakenBy(n)]).filter(([, m]) => m);
    const fresh = names.filter((n) => !nameTakenBy(n));
    if (taken.length) {
      const [n, m] = taken[0];
      toast(m.team === S.team ? `${n} 님은 이미 ${tn(m.team)}에 있습니다.` : `${n} 님은 ${tn(m.team)} 회원입니다. 회원 관리에서 팀을 옮길 수 있습니다.`);
    }
    if (!fresh.length) return;
    const team = S.team;
    write("members", [], () => rpc("add_members", { p_team: team, p_names: fresh }),
      (n) => `${tn(team)}에 ${n ?? fresh.length}명을 추가했습니다${taken.length ? ` (이미 있는 ${taken.length}명 제외)` : ""}.`);
  }

  async function moveMember(id, team) {
    const m = S.members.get(id);
    if (!m || m.team === team) return true;
    return write("members", [], () => rpc("set_member_team", { p_id: id, p_team: team }),
      `${m.name} 님을 ${tn(team)}으로 옮겼습니다.`);
  }

  function removeMember(id) {
    const name = memberName(id);
    write("members", [], () => rpc("set_member_active", { p_id: id, p_active: false }),
      `${name} 님을 명단에서 뺐습니다. 지난 기록은 남아 있습니다.`);
  }

  function restoreMember(id) {
    const m = S.members.get(id);
    if (!m) return;
    const other = nameTakenBy(m.name, id);
    if (other) { toast(`같은 이름(${m.name})의 회원이 이미 ${tn(other.team)} 명단에 있습니다.`); return; }
    write("members", [], () => rpc("set_member_active", { p_id: id, p_active: true }),
      `${m.name} 님을 명단에 다시 넣었습니다.`);
  }

  function purgeMember(id) {
    const name = memberName(id);
    write("members", [], () => rpc("purge_member", { p_id: id }),
      `${name} 님의 회원 정보와 모든 출석·포지션 기록을 완전히 삭제했습니다.`);
  }

  // 이름 수정과 팀 이동을 함께 저장
  async function saveMember(id, raw, team) {
    const m = S.members.get(id);
    const name = String(raw || "").trim().slice(0, 40);
    if (!m) return;
    if (!name) { toast("이름을 입력해 주세요."); return; }
    if (name !== m.name) {
      const other = nameTakenBy(name, id);
      if (other) { toast(`같은 이름(${name})의 회원이 이미 ${tn(other.team)}에 있습니다.`); return; }
      const ok = await write("members", [], () => rpc("rename_member", { p_id: id, p_name: name }),
        `${m.name} → ${name}(으)로 이름을 바꿨습니다.`);
      if (!ok) return;
    }
    if (team !== m.team && !(await moveMember(id, team))) return;
    S.editId = null;
    S.editDraft = null;
    S.editTeam = null;
    renderMembers();
  }

  // ---------- 팀 이름 변경 (지금 고른 팀) ----------
  function renderTeamName() {
    const row = $("teamNameRow");
    row.replaceChildren();
    if (!S.editTeamName) {
      const label = document.createElement("span");
      label.className = "muted";
      label.textContent = "팀 이름";
      const name = document.createElement("b");
      name.textContent = tn(S.team);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "row-btn";
      btn.textContent = "변경";
      btn.setAttribute("aria-label", `${tn(S.team)} 이름 변경`);
      btn.addEventListener("click", () => {
        if (needPin()) return;
        S.editTeamName = true;
        renderTeamName();
      });
      row.append(label, name, btn);
      return;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.id = "teamNameInput";
    input.className = "edit-input";
    input.maxLength = 12;
    input.value = tn(S.team);
    input.setAttribute("aria-label", "새 팀 이름");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "row-btn";
    save.textContent = "저장";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "row-btn";
    cancel.textContent = "취소";
    const doCancel = () => { S.editTeamName = false; renderTeamName(); };
    const doSave = () => saveTeamName(input.value);
    save.addEventListener("click", doSave);
    cancel.addEventListener("click", doCancel);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSave(); }
      if (e.key === "Escape") doCancel();
    });
    row.append(input, save, cancel);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  async function saveTeamName(raw) {
    const name = String(raw || "").trim().slice(0, 12);
    const team = S.team, before = tn(team);
    if (!name) { toast("팀 이름을 입력해 주세요."); return; }
    if (name === before) { S.editTeamName = false; renderTeamName(); return; }
    if (TEAMS.some(([t]) => t !== team && tn(t).toLowerCase() === name.toLowerCase())) {
      toast("다른 팀이 이미 쓰는 이름입니다.");
      return;
    }
    const ok = await write("team-names", [], () => rpc("rename_team", { p_team: team, p_name: name }),
      `${before} → ${name}(으)로 팀 이름을 바꿨습니다.`);
    if (ok) { S.editTeamName = false; renderAll(); }
  }

  function setTeam(team, fromHash) {
    if (!TEAMS.some(([t]) => t === team)) return;
    S.team = team;
    S.editTeamName = false;
    S.addingTeam = false;
    S.rankOpen = null;
    S.pickSlot = null;
    S.editId = null;
    S.confirmDel = null;
    S.confirmPurge = null;
    try { localStorage.setItem(TEAM_KEY, team); } catch (e) { /* 저장 불가 시 무시 */ }
    const hash = "#" + TEAMS.find(([t]) => t === team)[1];
    if (!fromHash && location.hash !== hash) history.replaceState(null, "", hash);
    renderAll();
  }

  // 사용 중인 팀만 (삭제한 팀은 빠진다). 최소 1팀, 최대 3팀
  function activeTeams() { return TEAMS.filter(([t]) => S.teamActive[t] !== false); }

  // ---------- 팀 관리: 팀 추가 / 팀 삭제 / 팀 회원 전체 삭제 ----------
  function renderTeamAdmin() {
    const box = $("teamAdmin");
    box.replaceChildren();
    const teams = activeTeams();
    const team = S.team;
    const count = teamMembers(true).length;
    const btn = (text, cls, onClick, disabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      b.disabled = !!disabled;
      b.addEventListener("click", onClick);
      return b;
    };
    if (S.addingTeam) {
      const input = document.createElement("input");
      input.type = "text";
      input.id = "newTeamInput";
      input.className = "edit-input";
      input.maxLength = 12;
      input.placeholder = "새 팀 이름 (최대 12자)";
      input.setAttribute("aria-label", "새 팀 이름");
      const save = () => addTeam(input.value);
      const cancel = () => { S.addingTeam = false; renderTeamAdmin(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") cancel(); });
      box.append(input, btn("추가", "row-btn", save), btn("취소", "row-btn", cancel));
      setTimeout(() => input.focus(), 0);
      return;
    }
    if (teams.length < TEAMS.length) {
      box.append(btn(`+ 팀 추가 (${teams.length}/${TEAMS.length})`, "row-btn", () => { if (needPin()) return; S.addingTeam = true; renderTeamAdmin(); }));
    }
    const delConfirm = S.confirmTeamDel === team;
    box.append(btn(delConfirm ? "정말 삭제할까요? 회원·기록 모두 삭제" : "팀 삭제", "row-btn danger" + (delConfirm ? " confirm" : ""),
      () => deleteTeam(team), teams.length <= 1));
    const purgeConfirm = S.confirmPurgeAll === team;
    box.append(btn(purgeConfirm ? `정말 ${count}명 모두 삭제할까요?` : "회원 전체 삭제", "row-btn danger" + (purgeConfirm ? " confirm" : ""),
      () => purgeTeamMembers(team), count === 0));
  }

  function confirmTwice(key, field) {
    if (S[field] === key) { S[field] = null; return true; }
    S[field] = key;
    renderTeamAdmin();
    setTimeout(() => { if (S[field] === key) { S[field] = null; renderTeamAdmin(); } }, 4000);
    return false;
  }

  function deleteTeam(team) {
    if (needPin()) return;
    if (activeTeams().length <= 1) { toast("마지막 남은 팀은 삭제할 수 없습니다."); return; }
    if (!confirmTwice(team, "confirmTeamDel")) return;
    const name = tn(team);
    write("teams", [], () => rpc("delete_team", { p_team: team }), () => {
      const next = activeTeams().find(([t]) => t !== team);
      if (next) setTeam(next[0]);
      return `${name}과 그 팀의 회원·기록을 삭제했습니다.`;
    });
  }

  async function addTeam(raw) {
    const name = String(raw || "").trim().slice(0, 12);
    if (!name) { toast("팀 이름을 입력해 주세요."); return; }
    if (activeTeams().some(([t]) => tn(t).toLowerCase() === name.toLowerCase())) { toast("다른 팀이 이미 쓰는 이름입니다."); return; }
    let added = null;
    const ok = await write("teams", [], async () => { added = await rpc("add_team", { p_name: name }); return added; },
      `${name} 팀을 추가했습니다.`);
    if (ok) {
      S.addingTeam = false;
      if (added) setTeam(added); else renderAll();
    }
  }

  function purgeTeamMembers(team) {
    if (needPin()) return;
    if (!confirmTwice(team, "confirmPurgeAll")) return;
    write("members", [], () => rpc("purge_team_members", { p_team: team }),
      (n) => `${tn(team)} 회원 ${n ?? ""}명과 그 기록을 모두 삭제했습니다.`);
  }

  function renderTeams() {
    const box = $("teamTabs");
    box.replaceChildren();
    const teams = activeTeams();
    box.style.gridTemplateColumns = `repeat(${teams.length}, 1fr)`;
    for (const [t] of teams) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${tn(t)}`;
      b.setAttribute("aria-pressed", t === S.team);
      b.addEventListener("click", () => setTeam(t));
      box.append(b);
    }
  }

  // ---------- PIN 잠금 ----------
  function renderLock() {
    const on = !!S.pin;
    document.body.classList.toggle("locked", !on);
    $("lockbar").classList.toggle("unlocked", on);
    $("lockBadge").textContent = on ? "수정 가능" : "보기 전용";
    $("lockText").textContent = on
      ? "이 브라우저 탭에서는 출석과 회원을 수정할 수 있습니다. 공용 기기라면 다 쓴 뒤 잠가 주세요."
      : "출석을 체크하거나 회원을 고치려면 동호회 PIN 4자리를 입력하세요.";
    $("pinForm").hidden = on;
    $("unlockedTools").hidden = !on;
  }

  function savePin(pin) {
    try { pin ? sessionStorage.setItem(PIN_KEY, pin) : sessionStorage.removeItem(PIN_KEY); } catch (e) { /* 저장 불가 시 무시 */ }
  }

  function lock() {
    S.pin = null;
    savePin(null);
    $("changePinForm").hidden = true;
    $("changePinBtn").hidden = false;
    renderLock();
  }

  async function unlock(pin) {
    if (!/^[0-9]{4}$/.test(pin)) { toast("PIN은 숫자 4자리입니다."); return; }
    if (!S.sb) { toast("DB에 연결되지 않았습니다."); return; }
    const { data, error } = await S.sb.rpc("verify_pin", { p_pin: pin });
    if (error) { toast("PIN을 확인하지 못했습니다. 인터넷 연결을 확인해 주세요."); return; }
    if (!data) { toast("PIN이 맞지 않습니다."); $("pinInput").select(); return; }
    S.pin = pin;
    savePin(pin);
    $("pinInput").value = "";
    renderLock();
    toast("잠금을 해제했습니다. 이제 출석을 체크할 수 있습니다.");
  }

  async function changePin(newPin) {
    if (!/^[0-9]{4}$/.test(newPin)) { toast("새 PIN은 숫자 4자리여야 합니다."); return; }
    try {
      await S.sb.rpc("change_pin", { p_old: S.pin, p_new: newPin }).then(({ error }) => { if (error) throw error; });
      S.pin = newPin;
      savePin(newPin);
      $("newPinInput").value = "";
      $("changePinForm").hidden = true;
      $("changePinBtn").hidden = false;
      toast("PIN을 바꿨습니다. 회원들에게 새 PIN을 알려 주세요.");
    } catch (e) {
      handleErr(e);
    }
  }

  // ---------- 렌더 ----------
  // 그날 이 팀 회원 중 출석이 하나라도 있는지
  function hasAny(date) {
    const att = S.days.get(date)?.att || {};
    return Object.entries(att).some(([mid, gs]) =>
      S.members.get(mid)?.team === S.team && Object.values(gs).some((v) => v === true));
  }

  function renderHeader() {
    // 휴대폰에서는 연도를 숨겨 한 줄에 들어가게 한다
    const d = parseYmd(S.date);
    const y = document.createElement("span");
    y.className = "y";
    y.textContent = `${d.getFullYear()}년 `;
    $("dateBig").replaceChildren(y, `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`);
    $("calMonth").textContent = `${d.getMonth() + 1}월`;
    $("calDay").textContent = d.getDate();
    $("datePick").value = S.date;
    $("calDesk").textContent = `${S.date} (${WD[d.getDay()]})`;
    $("calBtn").setAttribute("aria-label", `달력 열기, 지금 ${label(S.date)}`);

    const dates = [...S.days.keys()].filter(hasAny).sort().reverse().slice(0, 8);
    const box = $("recent");
    box.replaceChildren();
    if (!dates.length) return;
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = "최근 모임";
    box.append(lab);
    for (const d of dates) {
      const b = document.createElement("button");
      b.textContent = label(d, true);
      b.setAttribute("aria-pressed", d === S.date);
      b.addEventListener("click", () => setDate(d));
      box.append(b);
    }
  }

  function renderLineup() {
    // 경기 탭도 출석판과 같은 규칙: 기본 4경기, 기록이 있거나 + 로 늘린 경기까지
    const games = visibleGames();
    if (!games.includes(S.lineupGame)) { S.lineupGame = games[games.length - 1]; S.pickSlot = null; }
    const g = S.lineupGame;
    const { formation, slots } = lineupOf(S.date, g);
    const spots = FORMATIONS[formation];

    const tabs = $("gameTabs");
    tabs.replaceChildren();
    for (const n of games) {
      const b = document.createElement("button");
      const filled = lineupOf(S.date, n).slots.filter(Boolean).length;
      b.setAttribute("aria-pressed", n === g);
      b.textContent = `${n}경기`;
      if (filled) { const s = document.createElement("small"); s.textContent = `${filled}/11`; b.append(s); }
      b.addEventListener("click", () => { S.lineupGame = n; S.pickSlot = null; renderLineup(); });
      tabs.append(b);
    }
    const canAdd = games.length < GAMES.length;
    const canRemove = games.length > BASE_GAMES && games.length > usedGames();
    if (canAdd) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tab-add";
      add.textContent = "+";
      add.title = `${games.length + 1}경기 추가`;
      add.setAttribute("aria-label", add.title);
      add.addEventListener("click", () => {
        S.shownGames.set(shownKey(), games.length + 1);
        S.lineupGame = games.length + 1;
        S.pickSlot = null;
        renderAll();
      });
      tabs.append(add);
    }
    if (canRemove) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "tab-add minus";
      rm.textContent = "−";
      rm.title = `${games.length}경기 닫기`;
      rm.setAttribute("aria-label", rm.title);
      rm.addEventListener("click", () => {
        S.shownGames.set(shownKey(), games.length - 1);
        S.pickSlot = null;
        renderAll();
      });
      tabs.append(rm);
    }
    tabs.style.setProperty("--tab-count", games.length + (canAdd ? 1 : 0) + (canRemove ? 1 : 0));

    const sel = $("formationSel");
    if (!sel.options.length) Object.keys(FORMATIONS).forEach((f) => sel.add(new Option(f, f)));
    sel.value = formation;

    const field = $("field");
    field.querySelectorAll(".slot").forEach((el) => el.remove());
    spots.forEach(([pos, x, y], i) => {
      const mid = slots[i];
      const b = document.createElement("button");
      b.className = "slot" + (mid ? " filled" : "") + (i === 0 ? " gk" : "");
      b.style.left = x + "%";
      b.style.top = y + "%";
      b.setAttribute("aria-pressed", S.pickSlot === i);
      b.setAttribute("aria-label", `${pos} ${mid ? memberName(mid) : "비어 있음"}`);
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = pos;
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = mid ? memberName(mid) : "선택";
      b.append(dot, nm);
      b.addEventListener("click", () => {
        if (needPin()) return;
        S.pickSlot = S.pickSlot === i ? null : i;
        renderLineup();
      });
      field.append(b);
    });

    const picker = $("picker");
    picker.replaceChildren();
    const picking = S.pickSlot !== null && S.pickSlot < spots.length;
    picker.classList.toggle("sheet", picking);
    // 휴대폰: 고르는 동안 구장을 맨 위로 올려 줄이고, 회원 목록과 한 화면에 보이게 한다
    const wasPicking = document.body.classList.contains("picking");
    document.body.classList.toggle("picking", picking);
    if (picking && !wasPicking && window.matchMedia("(max-width: 860px)").matches) window.scrollTo(0, 0);
    const sum = document.createElement("div");
    sum.className = "lineup-sum";
    const cntB = document.createElement("b");
    cntB.textContent = slots.filter(Boolean).length;
    sum.append(`${tn(S.team)} · ${g}경기 · ${formation} · 배치 `, cntB, "/11명");

    if (S.pickSlot === null || S.pickSlot >= spots.length) {
      S.pickSlot = null;
      const p = document.createElement("div");
      p.className = "picker-empty";
      p.textContent = !S.pin
        ? "포지션을 바꾸려면 위에서 PIN을 입력해 잠금을 해제하세요."
        : activeMembers().length
          ? "구장에서 포지션 동그라미를 누르면 여기서 회원을 고를 수 있습니다. 회원을 넣으면 다음 빈 자리로 자동으로 넘어갑니다."
          : "먼저 회원 관리에서 회원을 추가해 주세요.";
      picker.append(sum, p);
      return;
    }

    const i = S.pickSlot;
    const cur = slots[i];
    const head = document.createElement("div");
    head.className = "picker-head";
    const title = document.createElement("b");
    title.textContent = `${spots[i][0]} 자리에 넣을 회원`;
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    if (cur) {
      const clr = document.createElement("button");
      clr.className = "btn-ghost";
      clr.textContent = "자리 비우기";
      clr.addEventListener("click", () => placeMember(i, null));
      actions.append(clr);
    }
    const close = document.createElement("button");
    close.className = "btn-ghost";
    close.textContent = "닫기";
    close.addEventListener("click", () => { S.pickSlot = null; renderLineup(); });
    actions.append(close);
    head.append(title, actions);

    const list = document.createElement("div");
    list.className = "picker-list";
    const placedAt = new Map(slots.map((v, k) => [v, k]).filter(([v]) => v));
    // 최근 3번 모임(보고 있는 날짜까지) 중 한 번도 안 나온 회원은 구분선 아래로 보내고 흐리게
    const recent3 = [...S.days.keys()].filter((d) => d <= S.date && hasAny(d)).sort().slice(-3);
    const cameRecently = (id) => recent3.some((d) => GAMES.some((g) => attended(d, id, g)));
    const order = (a, b) => (placedAt.has(a[0]) - placedAt.has(b[0])) || a[1].name.localeCompare(b[1].name, "ko");
    const all = activeMembers();
    const regulars = recent3.length ? all.filter(([id]) => cameRecently(id) || placedAt.has(id)) : all;
    const rare = recent3.length ? all.filter(([id]) => !cameRecently(id) && !placedAt.has(id)) : [];
    const members = [...regulars.sort(order), ...rare.sort(order)];
    for (const [id, m] of members) {
      if (rare.length && id === rare[0][0]) {
        const hr = document.createElement("div");
        hr.className = "pick-divider";
        hr.textContent = `최근 ${recent3.length}번 모임 불참`;
        list.append(hr);
      }
      const b = document.createElement("button");
      const at = placedAt.get(id);
      b.className = "pick" + (id === cur ? " current" : at !== undefined ? " placed" : "") + (rare.some(([rid]) => rid === id) ? " rare" : "");
      b.textContent = m.name;
      if (at !== undefined && id !== cur) {
        const s = document.createElement("small");
        s.textContent = spots[at][0];
        b.append(s);
        b.title = `${spots[at][0]}에서 이 자리로 옮깁니다`;
      }
      b.addEventListener("click", () => { if (id !== cur) placeMember(i, id); });
      list.append(b);
    }
    if (!members.length) {
      const p = document.createElement("div");
      p.className = "picker-empty";
      p.textContent = "등록된 회원이 없습니다. 회원 관리에서 회원을 추가해 주세요.";
      list.append(p);
    }
    picker.append(sum, head, list);
  }

  // 한 경기의 이 팀 참석을 모두 해제 (그 경기 포지션 배치에서도 빠진다)
  function clearGame(g, key) {
    if (needPin()) return;
    if (S.confirmClearGame !== key) {
      S.confirmClearGame = key;
      renderGrid();
      setTimeout(() => { if (S.confirmClearGame === key) { S.confirmClearGame = null; renderGrid(); } }, 3000);
      return;
    }
    S.confirmClearGame = null;
    const date = S.date, team = S.team, gk = `g${g}`;
    const pend = [];
    for (const [id] of teamMembers(true)) {
      if (attended(date, id, g)) pend.push([S.pending, `${date}|${id}|${gk}`, false]);
    }
    lineupOf(date, g).slots.forEach((v, i) => { if (v) pend.push([S.pendingLineup, `${date}|${team}|${gk}|s${i}`, null]); });
    write(date, pend, () => rpc("clear_team_game", { p_day: date, p_team: team, p_game: g }),
      (n) => `${g}경기 참석 ${n ?? pend.length}명을 초기화했습니다.`);
  }

  // 출석판에 보이는 경기 수: 기본 4경기, 기록이 있거나 직접 추가한 경기까지 (최대 6)
  const BASE_GAMES = 4;
  function shownKey() { return `${S.date}|${S.team}`; }
  function usedGames() {
    const ids = teamMembers(true).map(([id]) => id);
    let max = 0;
    for (const g of GAMES) {
      if (ids.some((id) => attended(S.date, id, g)) || lineupOf(S.date, g).slots.some(Boolean)) max = g;
    }
    return max;
  }
  function visibleGames() {
    const n = Math.max(BASE_GAMES, usedGames(), S.shownGames.get(shownKey()) || 0);
    return GAMES.slice(0, Math.min(n, GAMES.length));
  }

  function renderGrid() {
    const list = activeMembers();
    const games = visibleGames();
    // 보이는 경기 수에 따라 출석 칸 크기를 바꾼다 (4경기면 크게, 6경기면 화면에 맞게)
    $("attTable").dataset.games = games.length;
    const counts = games.map((g) => list.filter(([id]) => attended(S.date, id, g)).length);
    const canAdd = games.length < GAMES.length;
    const canRemove = games.length > BASE_GAMES && games.length > usedGames();
    const head = document.createElement("tr");
    head.innerHTML = `<th class="name">이름</th>${games.map((g, i) =>
      `<th>${g}경기<span class="cnt num">${counts[i]}</span></th>`).join("")}`;
    // 경기별 참석 초기화: 체크된 사람이 있을 때만 작게 표시, 한 번 더 눌러야 실행
    games.forEach((g, i) => {
      if (!counts[i]) return;
      const key = `${shownKey()}|g${g}`;
      const confirming = S.confirmClearGame === key;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "game-reset" + (confirming ? " confirm" : "");
      b.textContent = confirming ? "확인" : "↺";
      b.title = `${g}경기 참석 모두 해제`;
      b.setAttribute("aria-label", confirming ? `${g}경기 참석 초기화 확인` : `${g}경기 참석 초기화`);
      b.addEventListener("click", () => clearGame(g, key));
      head.children[i + 1].append(b);
    });
    if (canAdd || canRemove) {
      const th = document.createElement("th");
      th.className = "add-col";
      if (canAdd) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "game-add";
        add.textContent = "+";
        add.title = `${games.length + 1}경기 추가`;
        add.setAttribute("aria-label", add.title);
        add.addEventListener("click", () => {
          S.shownGames.set(shownKey(), games.length + 1);
          renderAll();
        });
        th.append(add);
      }
      if (canRemove) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "game-add minus";
        rm.textContent = "−";
        rm.title = `${games.length}경기 칸 닫기`;
        rm.setAttribute("aria-label", rm.title);
        rm.addEventListener("click", () => {
          S.shownGames.set(shownKey(), games.length - 1);
          renderAll();
        });
        th.append(rm);
      }
      head.append(th);
    }
    $("attHead").replaceChildren(head);

    const body = $("attBody");
    body.replaceChildren();
    const empty = $("attEmpty");
    if (S.mode !== "live" && !list.length) {
      empty.hidden = false;
      $("emptyTitle").textContent = S.mode === "loading" ? "기록을 불러오는 중입니다" : "기록을 불러오지 못했습니다";
      $("emptyText").textContent = "";
      return;
    }
    if (!list.length) {
      empty.hidden = false;
      $("emptyTitle").textContent = `${tn(S.team)}에 등록된 회원이 없습니다`;
      $("emptyText").textContent = "PIN으로 잠금을 해제한 뒤 회원 관리에서 이름을 추가하면 이 팀의 경기별 출석판이 생깁니다.";
      return;
    }
    empty.hidden = true;

    for (const [id, m] of list) {
      const tr = document.createElement("tr");
      const n = GAMES.filter((g) => attended(S.date, id, g)).length;

      // 이름 한 줄 + 아래 작은 줄("3경기 · 전 경기")로 줄 높이를 줄인다
      const tdName = document.createElement("td");
      tdName.className = "name";
      const nm = document.createElement("span");
      nm.className = "nm-main";
      nm.textContent = m.name;
      nm.title = m.name;
      const sub = document.createElement("span");
      sub.className = "sub";
      // 몇 경기 나왔는지는 동그라미로 보이므로, 아래 줄에는 "전 경기" 버튼만 둔다
      sub.title = n ? `${n}경기 출전` : "불참";
      // "전 경기"는 지금 보이는 경기만 체크/해제한다
      const all = document.createElement("button");
      all.className = "all-link";
      const full = games.every((g) => attended(S.date, id, g));
      all.textContent = full ? "전체 해제" : "전 경기";
      all.setAttribute("aria-label", `${m.name} ${full ? "보이는 경기 모두 해제" : "보이는 경기 모두 참석"}`);
      all.addEventListener("click", () => setGames(id, games, !full));
      sub.append(all);
      tdName.append(nm, sub);
      tr.append(tdName);

      for (const g of games) {
        const td = document.createElement("td");
        const b = document.createElement("button");
        const on = attended(S.date, id, g);
        b.className = "cell" + (on && S.popKey === `${S.date}|${id}|g${g}` ? " pop" : "");
        b.textContent = on ? "" : g;
        b.setAttribute("aria-pressed", on);
        b.setAttribute("aria-label", `${m.name} ${g}경기 ${on ? "참석" : "미참석"}`);
        b.addEventListener("click", () => toggleCell(id, g));
        td.append(b);
        tr.append(td);
      }
      if (canAdd || canRemove) tr.append(document.createElement("td"));

      body.append(tr);
    }
  }

  function dayRoster(date) {
    const ids = teamMembers(true).map(([id]) => id);
    // 요약도 출석판과 같은 경기만: 기본 4경기, 기록이 있거나 + 로 늘린 경기까지
    const shown = date === S.date ? visibleGames() : GAMES;
    const games = shown.map((g) => ({
      g,
      people: ids.filter((id) => attended(date, id, g)).map(memberName).sort((a, b) => a.localeCompare(b, "ko")),
    }));
    const people = new Set();
    games.forEach(({ people: p }) => p.forEach((n) => people.add(n)));
    return { games, people };
  }

  function renderSide() {
    const { games, people } = dayRoster(S.date);
    $("tPeople").textContent = people.size;
    $("tGames").textContent = games.filter((x) => x.people.length).length;
    renderDeleteDay(people.size);

    const r = $("roster");
    r.replaceChildren();
    // 이 팀에 그날 출석 기록이 하나도 없으면 안내만 보여 주고 복사 버튼은 끈다
    const empty = people.size === 0;
    const copy = $("copyBtn");
    copy.disabled = empty || S.mode !== "live";
    copy.title = empty ? "이날 기록이 없어 복사할 명단이 없습니다" : "";
    if (empty) {
      $("copyFallback").hidden = true;
      const msg = document.createElement("div");
      msg.className = "roster-empty";
      const strong = document.createElement("strong");
      strong.textContent = "아직 기록 없음";
      const sub = document.createElement("span");
      sub.textContent = S.mode === "live"
        ? `${label(S.date, true)} ${tn(S.team)}의 출석 기록이 아직 없습니다. 출석 탭에서 체크하면 여기에 경기별 명단이 나옵니다.`
        : "기록을 불러오는 중입니다.";
      msg.append(strong, sub);
      r.append(msg);
      return;
    }
    for (const { g, people: p } of games) {
      const div = document.createElement("div");
      const gs = document.createElement("span");
      gs.className = "g";
      gs.textContent = `${g}경기 ${p.length}명`;
      const txt = document.createElement("span");
      if (p.length) txt.textContent = p.join(", ");
      else { txt.textContent = "기록 없음"; txt.className = "none"; }
      div.append(gs, " ", txt);
      r.append(div);
    }
    // 맨 아래: 이날 한 경기도 안 나온 회원 (명단에서 뺀 회원 제외)
    const absent = activeMembers().filter(([id]) => !GAMES.some((g) => attended(S.date, id, g))).map(([, m]) => m.name);
    const ab = document.createElement("div");
    ab.className = "absent";
    const as = document.createElement("span");
    as.className = "g";
    as.textContent = `불참 ${absent.length}명`;
    const at = document.createElement("span");
    if (absent.length) at.textContent = absent.join(", ");
    else { at.textContent = "없음"; at.className = "none"; }
    ab.append(as, " ", at);
    r.append(ab);
  }

  // ---------- 날짜 기록 삭제 (선택한 날짜, 지금 팀만) ----------
  function teamHasLineup(date) {
    return Object.values(S.days.get(date)?.lineup?.[S.team] || {}).length > 0;
  }

  function renderDeleteDay(peopleCount) {
    const btn = $("deleteDayBtn");
    const key = shownKey();
    const has = hasAny(S.date) || teamHasLineup(S.date);
    btn.disabled = !has;
    if (!has) {
      if (S.confirmDeleteDay === key) S.confirmDeleteDay = null;
      btn.classList.remove("confirm");
      btn.textContent = "이 날짜에 지울 기록이 없습니다";
      return;
    }
    const confirming = S.confirmDeleteDay === key;
    btn.classList.toggle("confirm", confirming);
    btn.textContent = confirming
      ? `정말 삭제할까요? ${label(S.date, true)} ${tn(S.team)} ${peopleCount}명 기록`
      : `${label(S.date, true)} ${tn(S.team)} 기록 삭제`;
  }

  function deleteDay() {
    if (needPin()) return;
    const key = shownKey();
    if (S.confirmDeleteDay !== key) {
      S.confirmDeleteDay = key;
      renderSide();
      setTimeout(() => { if (S.confirmDeleteDay === key) { S.confirmDeleteDay = null; renderSide(); } }, 4000);
      return;
    }
    S.confirmDeleteDay = null;
    const date = S.date, team = S.team, when = label(date, true);
    write(date, [], () => rpc("delete_team_day", { p_day: date, p_team: team }), () => {
      S.shownGames.delete(`${date}|${team}`);
      return `${when} ${tn(team)} 기록을 삭제했습니다.`;
    });
  }

  function rosterText() {
    const { games, people } = dayRoster(S.date);
    const lines = [`[${label(S.date, true)} ${tn(S.team)} 출석]`];
    for (const { g, people: p } of games) if (p.length) lines.push(`${g}경기 (${p.length}명): ${p.join(", ")}`);
    lines.push(`총 참석 ${people.size}명`);
    return lines.join("\n");
  }

  // ---------- 통계: 팀별 탭으로 나눈 날짜별 출석자 명단을 엑셀(.xlsx)로 내보내기 ----------
  const PERIOD_LABEL = { month: "이번달", "3m": "최근3개월", year: "올해", all: "전체" };
  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("xlsx")));
      s.onerror = () => { xlsxLoading = null; reject(new Error("xlsx")); };
      document.head.append(s);
    });
    return xlsxLoading;
  }

  // 팀 한 개의 시트 내용: [날짜, 인원, 출석자 명단] (그날 한 경기라도 나온 사람, 이름순)
  function teamExportRows(team) {
    const ids = [...S.members.entries()].filter(([, m]) => m.team === team).map(([id]) => id);
    const rows = [];
    for (const d of [...S.days.keys()].filter(inPeriod).sort()) {
      const names = ids.filter((id) => GAMES.some((g) => attended(d, id, g)))
        .map(memberName).sort((a, b) => a.localeCompare(b, "ko"));
      if (!names.length) continue;
      const day = parseYmd(d);
      rows.push([`${d} (${WD[day.getDay()]})`, names.length, names.join(", ")]);
    }
    return rows;
  }

  async function exportAttendance() {
    const btn = $("exportBtn");
    if (S.mode !== "live") { toast("기록을 불러온 뒤에 다시 눌러 주세요."); return; }
    btn.disabled = true;
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.utils.book_new();
      let total = 0;
      const used = new Set();
      for (const [t] of activeTeams()) {
        const rows = teamExportRows(t);
        total += rows.length;
        const ws = XLSX.utils.aoa_to_sheet([["날짜", "인원", "출석자 명단"], ...(rows.length ? rows : [["(이 기간 기록 없음)", "", ""]])]);
        ws["!cols"] = [{ wch: 16 }, { wch: 6 }, { wch: 80 }];
        // 시트 이름: 엑셀 규칙(31자, 금지 문자) 맞추고 겹치지 않게
        let name = tn(t).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || t;
        while (used.has(name)) name = (name.slice(0, 28) + "_" + used.size);
        used.add(name);
        XLSX.utils.book_append_sheet(wb, ws, name);
      }
      if (!total) { toast("이 기간에는 내보낼 출석 기록이 없습니다."); return; }
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const file = `출석명단_${PERIOD_LABEL[S.period] || ""}_${ymd(new Date())}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`${file} 파일을 저장했습니다. 휴대폰은 '다운로드' 폴더에서 찾을 수 있습니다.`);
    } catch (e) {
      toast("엑셀 파일을 만들지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.");
    } finally {
      btn.disabled = false;
    }
  }

  function inPeriod(date) {
    const today = new Date();
    const d = parseYmd(date);
    if (S.period === "all") return true;
    if (S.period === "year") return d.getFullYear() === today.getFullYear();
    if (S.period === "month") return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    if (S.period === "3m") return d >= new Date(today.getFullYear(), today.getMonth() - 2, 1);
    return true;
  }

  function renderStats() {
    const dates = [...S.days.keys()].filter((d) => inPeriod(d) && hasAny(d)).sort();
    const ids = activeMembers().map(([id]) => id);

    // 참석률 = 참석한 모임 날짜 수 ÷ 기간 중 팀의 전체 모임 날짜 수 (그날 한 경기라도 나오면 참석)
    const meetingDays = dates.length;
    const stat = new Map(ids.map((id) => [id, { games: 0, days: 0 }]));
    for (const d of dates) {
      for (const id of ids) {
        const n = GAMES.filter((g) => attended(d, id, g)).length;
        const s = stat.get(id);
        s.games += n;
        if (n) s.days++;
      }
    }

    const rows = ids.map((id) => ({ id, name: S.members.get(id).name, ...stat.get(id) }))
      .sort((a, b) => b.days - a.days || b.games - a.games || a.name.localeCompare(b.name, "ko"));
    const body = $("rankBody");
    body.replaceChildren();
    if (!rows.length || !dates.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "muted";
      td.style.textAlign = "center";
      td.style.padding = "18px 6px";
      td.textContent = rows.length ? "이 기간에는 출석 기록이 없습니다." : "회원을 추가하고 출석을 체크하면 순위가 여기에 표시됩니다.";
      tr.append(td);
      body.append(tr);
      return;
    }
    // 참석률순: # 는 참석률 순위(동점은 같은 순위). 이름순: # 는 1번부터 차례대로
    let pos = 0, prev = null;
    rows.forEach((r, i) => {
      if (r.days !== prev) { pos = i + 1; prev = r.days; }
      r.pos = pos;
    });
    const shown = S.rankSort === "name"
      ? [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"))
      : rows;
    const recent = S.rankOpen ? recentTeamGames(10) : [];
    const byName = S.rankSort === "name";
    shown.forEach((r, idx) => {
      const pct = meetingDays ? Math.round((r.days / meetingDays) * 100) : 0;
      const open = S.rankOpen === r.id;
      const tr = document.createElement("tr");
      const no = byName ? idx + 1 : r.pos;
      tr.className = (!byName && r.pos <= 3 && r.days > 0 ? "top " : "") + (open ? "open" : "");
      tr.innerHTML = `<td class="pos num">${no}</td><td class="nm"></td><td class="r num">${r.days}/${meetingDays}</td>
        <td><div class="rate"><div class="bar"><i style="width:${pct}%"></i></div><em>${pct}%</em></div></td>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-btn";
      btn.textContent = r.name;
      btn.title = `${r.name} 최근 모임 10번 보기`;
      btn.setAttribute("aria-expanded", open);
      btn.addEventListener("click", () => toggleRecentRow(tr, btn, r.id));
      tr.children[1].append(btn);
      body.append(tr);
      if (open) body.append(recentRow(r.id, recent));
    });
  }

  // 표를 다시 그리지 않고 누른 줄 아래만 펼치거나 닫는다.
  // 휴대폰에서 표 전체를 다시 그리면 화면이 맨 위로 튀던 문제를 막고, 누른 이름이 같은 자리에 머물게 한다
  function toggleRecentRow(tr, btn, mid) {
    const body = $("rankBody");
    const before = tr.getBoundingClientRect().top;
    const opening = S.rankOpen !== mid;
    body.querySelectorAll("tr.recent-row").forEach((x) => x.remove());
    body.querySelectorAll("tr.open").forEach((x) => x.classList.remove("open"));
    body.querySelectorAll('.name-btn[aria-expanded="true"]').forEach((x) => x.setAttribute("aria-expanded", "false"));
    S.rankOpen = opening ? mid : null;
    let detail = null;
    if (opening) {
      tr.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      detail = recentRow(mid, recentTeamGames(10));
      tr.after(detail);
    }
    // 위쪽에서 닫힌 줄만큼 화면을 보정해 누른 이름이 제자리에 있게 한다
    const shift = tr.getBoundingClientRect().top - before;
    if (shift) window.scrollBy(0, shift);
    // 펼친 내용이 하단 탭에 가려지면 보이는 만큼만 살짝 올린다
    if (detail) {
      const bar = $("tabbar");
      const limit = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().top : window.innerHeight;
      const over = detail.getBoundingClientRect().bottom - limit + 8;
      if (over > 0) window.scrollBy({ top: over, behavior: "smooth" });
    }
    btn.focus({ preventScroll: true });
  }

  // 이 팀의 최근 모임 날짜 n개 (팀에서 한 명이라도 출석한 날), 오래된 순
  function recentTeamGames(n) {
    return [...S.days.keys()].filter(hasAny).sort().slice(-n);
  }

  function recentRow(mid, dates) {
    const tr = document.createElement("tr");
    tr.className = "recent-row";
    const td = document.createElement("td");
    td.colSpan = 4;
    const wrap = document.createElement("div");
    wrap.className = "recent10";
    const strip = document.createElement("div");
    strip.className = "strip";
    let hit = 0;
    for (let i = 0; i < 10; i++) {
      const day = dates[i];
      const c = document.createElement("span");
      if (!day) {
        c.className = "c none";
        c.title = "모임 기록 없음";
      } else {
        const played = GAMES.filter((g) => attended(day, mid, g)).length;
        if (played) hit++;
        const d = parseYmd(day);
        c.className = "c " + (played ? "in" : "out");
        const m = document.createElement("small");
        m.textContent = `${d.getMonth() + 1}월`;
        const dd = document.createElement("b");
        dd.textContent = d.getDate();
        c.append(m, dd);
        c.title = `${label(day, true)} ${played ? `참석 (${played}경기)` : "불참"}`;
        c.setAttribute("aria-label", c.title);
      }
      strip.append(c);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    if (dates.length) {
      const range = document.createElement("span");
      range.textContent = `${label(dates[0], true)} → ${label(dates[dates.length - 1], true)}`;
      const sum = document.createElement("b");
      sum.textContent = `최근 모임 ${dates.length}번 중 ${hit}번 참석`;
      meta.append(sum, range);
    } else {
      meta.textContent = "아직 이 팀의 모임 기록이 없습니다.";
    }
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `<span><i class="c in"></i>참석 (그날 1경기 이상)</span><span><i class="c out"></i>불참</span>`;
    wrap.append(meta, strip, legend);
    td.append(wrap);
    tr.append(td);
    return tr;
  }

  function setRankSort(v) {
    S.rankSort = v === "name" ? "name" : "rate";
    document.querySelectorAll("#rankSort [data-sort]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === S.rankSort));
    try { localStorage.setItem("soccer-attendance-sort", S.rankSort); } catch (e) { /* 저장 불가 시 무시 */ }
    renderStats();
  }

  function confirmButton(text, confirmText, stateKey, id, onConfirm) {
    const b = document.createElement("button");
    const confirming = S[stateKey] === id;
    b.className = "row-btn" + (confirming || stateKey === "confirmPurge" ? " danger" : "");
    b.textContent = confirming ? confirmText : text;
    b.addEventListener("click", () => {
      if (needPin()) return;
      if (S[stateKey] === id) { S[stateKey] = null; onConfirm(); renderMembers(); return; }
      S[stateKey] = id;
      renderMembers();
      setTimeout(() => { if (S[stateKey] === id) { S[stateKey] = null; renderMembers(); } }, 3000);
    });
    return b;
  }

  function renderMembers() {
    renderTeamAdmin();
    renderTeamName();
    const active = activeMembers();
    const inactive = [...S.members.entries()]
      .filter(([, m]) => m.active === false)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "ko"));
    $("memberCount").textContent = `${active.length}명`;

    const list = $("memberList");
    list.replaceChildren();
    if (!active.length) {
      const li = document.createElement("li");
      li.className = "empty-row";
      li.textContent = S.mode === "loading" ? "불러오는 중" : "등록된 회원이 없습니다";
      list.append(li);
    }
    for (const [id, m] of active) {
      const li = document.createElement("li");

      if (S.editId === id) {
        li.className = "editing";
        const input = document.createElement("input");
        input.type = "text";
        input.id = "editName-" + id;
        input.maxLength = 40;
        const hadFocus = document.activeElement?.id === input.id;
        const caret = hadFocus ? document.activeElement.selectionStart : null;
        input.value = S.editDraft ?? m.name;
        input.className = "edit-input";
        input.setAttribute("aria-label", `${m.name} 새 이름`);
        input.addEventListener("input", () => { S.editDraft = input.value; });
        const sel = document.createElement("select");
        sel.className = "team-sel";
        sel.id = "editTeam-" + id;
        sel.setAttribute("aria-label", `${m.name} 소속 팀`);
        TEAMS.forEach(([t]) => sel.add(new Option(`${tn(t)}`, t)));
        sel.value = S.editTeam ?? m.team;
        sel.addEventListener("change", () => { S.editTeam = sel.value; });
        const save = document.createElement("button");
        save.className = "row-btn";
        save.textContent = "저장";
        const cancel = document.createElement("button");
        cancel.className = "row-btn";
        cancel.textContent = "취소";
        const doSave = () => saveMember(id, input.value, sel.value);
        const doCancel = () => { S.editId = null; S.editDraft = null; S.editTeam = null; renderMembers(); };
        save.addEventListener("click", doSave);
        cancel.addEventListener("click", doCancel);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); doSave(); }
          if (e.key === "Escape") doCancel();
        });
        const btns = document.createElement("div");
        btns.className = "row-actions";
        btns.append(sel, save, cancel);
        li.append(input, btns);
        list.append(li);
        setTimeout(() => {
          input.focus();
          if (caret !== null) input.setSelectionRange(caret, caret);
          else if (S.editDraft === null) input.select();
        }, 0);
        continue;
      }

      const name = document.createElement("span");
      name.textContent = m.name;
      const edit = document.createElement("button");
      edit.className = "row-btn";
      edit.textContent = "수정";
      edit.setAttribute("aria-label", `${m.name} 이름 수정`);
      edit.addEventListener("click", () => {
        if (needPin()) return;
        S.editId = id; S.editDraft = null; S.editTeam = null; S.confirmDel = null;
        renderMembers();
      });
      const del = confirmButton("삭제", "정말 삭제할까요?", "confirmDel", id, () => removeMember(id));
      del.setAttribute("aria-label", `${m.name} 삭제`);
      const btns = document.createElement("div");
      btns.className = "row-actions";
      btns.append(edit, del);
      li.append(name, btns);
      list.append(li);
    }

    $("inactiveBox").hidden = !inactive.length;
    $("inactiveCount").textContent = `${inactive.length}명`;
    const il = $("inactiveList");
    il.replaceChildren();
    for (const [id, m] of inactive) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = m.name;
      const btn = document.createElement("button");
      btn.className = "row-btn";
      btn.textContent = "복구";
      btn.addEventListener("click", () => { if (!needPin()) restoreMember(id); });
      const purge = confirmButton("완전 삭제", "기록까지 지울까요?", "confirmPurge", id, () => purgeMember(id));
      purge.setAttribute("aria-label", `${m.name} 완전 삭제`);
      const btns = document.createElement("div");
      btns.className = "row-actions";
      btns.append(btn, purge);
      li.append(name, btns);
      il.append(li);
    }
  }

  // 다시 그려도 보던 위치를 유지한다 (누른 버튼이 다시 그려지며 사라질 때 휴대폰에서 화면이 위로 튀는 것 방지)
  function renderAll() {
    const y = window.scrollY;
    const active = document.activeElement;
    const hadFocusInList = active && active !== document.body && (active.closest?.("#attBody, #rankBody, #memberList, #inactiveList, #field, #picker, #gameTabs"));
    renderTeams();
    renderHeader();
    renderLineup();
    renderGrid();
    renderSide();
    renderMembers();
    renderStats();
    if (hadFocusInList && document.activeElement !== active) active.blur?.();
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }

  // ---------- 이벤트 ----------
  // ---------- 달력: 지금 팀의 모임이 있던 날을 동그라미로 표시 ----------
  let calView = null; // 보고 있는 달의 1일 (Date)
  function openCalendar() {
    const d = parseYmd(S.date);
    calView = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar();
    $("calModal").hidden = false;
    document.body.classList.add("modal-open");
    ($("calGrid").querySelector(".sel") || $("calClose")).focus();
  }
  function closeCalendar() {
    $("calModal").hidden = true;
    document.body.classList.remove("modal-open");
    $("calBtn").focus({ preventScroll: true });
  }
  function renderCalendar() {
    if (!calView) return;
    const y = calView.getFullYear(), m = calView.getMonth();
    $("calTitle").textContent = `${y}년 ${m + 1}월`;
    const grid = $("calGrid");
    grid.replaceChildren();
    const lead = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = ymd(new Date());
    for (let i = 0; i < lead; i++) grid.append(document.createElement("span"));
    for (let n = 1; n <= days; n++) {
      const ds = ymd(new Date(y, m, n));
      const met = hasAny(ds) || teamHasLineup(ds);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal-day-btn" + (met ? " met" : "") + (ds === S.date ? " sel" : "") + (ds === today ? " today" : "");
      b.textContent = n;
      const wd = new Date(y, m, n).getDay();
      if (wd === 0) b.classList.add("sun");
      if (wd === 6) b.classList.add("sat");
      b.setAttribute("aria-label", `${m + 1}월 ${n}일 (${WD[wd]})${met ? ", 모임 있음" : ""}${ds === today ? ", 오늘" : ""}`);
      if (ds === S.date) b.setAttribute("aria-current", "date");
      b.addEventListener("click", () => { closeCalendar(); setDate(ds); });
      grid.append(b);
    }
  }
  function shiftCalendar(n) {
    calView = new Date(calView.getFullYear(), calView.getMonth() + n, 1);
    renderCalendar();
  }

  // ---------- 하단 탭 (휴대폰 화면에서만 한 번에 한 화면) ----------
  const VIEW_KEY = "soccer-attendance-view";
  const VIEWS = ["check", "lineup", "summary", "stats", "members", "chat"];
  function setView(v, keepScroll) {
    if (!VIEWS.includes(v)) v = "check";
    document.body.dataset.view = v;
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
    document.querySelectorAll("#tabbar [data-tab]").forEach((b) => {
      if (b.dataset.tab === v) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (v !== "lineup" && S.pickSlot !== null) { S.pickSlot = null; renderLineup(); }
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* 저장 불가 시 무시 */ }
    if (!keepScroll && window.matchMedia("(max-width: 860px)").matches) window.scrollTo(0, 0);
  }
  $("tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setView(b.dataset.tab);
  });

  // 날짜를 바꾸면 바로 다시 그리고, DB에서 최신 기록도 다시 받아 이날 요약을 갱신한다
  function setDate(d) {
    S.date = d;
    S.pickSlot = null;
    renderAll();
    if (S.sb) scheduleReload();
  }
  $("prevDay").addEventListener("click", () => setDate(shiftDate(S.date, -1)));
  $("nextDay").addEventListener("click", () => setDate(shiftDate(S.date, 1)));
  $("datePick").addEventListener("change", (e) => { if (e.target.value) setDate(e.target.value); });
  $("calBtn").addEventListener("click", openCalendar);
  $("calPrev").addEventListener("click", () => shiftCalendar(-1));
  $("calNext").addEventListener("click", () => shiftCalendar(1));
  $("calClose").addEventListener("click", closeCalendar);
  $("calToday").addEventListener("click", () => { closeCalendar(); setDate(ymd(new Date())); });
  $("calModal").addEventListener("click", (e) => { if (e.target === $("calModal")) closeCalendar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("calModal").hidden) closeCalendar(); });
  window.addEventListener("hashchange", () => { const t = teamFromHash(); if (t && t !== S.team) setTeam(t, true); });

  $("formationSel").addEventListener("change", (e) => {
    if (needPin()) { e.target.value = lineupOf(S.date, S.lineupGame).formation; return; }
    setFormation(e.target.value);
  });

  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (needPin()) return;
    if (S.mode !== "live") { toast("기록을 불러온 뒤에 다시 시도해 주세요."); return; }
    const names = [...new Set($("addInput").value.split(/[,\n、·]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 60);
    if (!names.length) return;
    $("addInput").value = "";
    addMembers(names);
  });

  $("periodChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    S.period = b.dataset.period;
    document.querySelectorAll("#periodChips .chip").forEach((c) => c.setAttribute("aria-pressed", c === b));
    renderStats();
  });

  $("saveLineupBtn").addEventListener("click", saveLineupImage);
  $("deleteDayBtn").addEventListener("click", deleteDay);
  $("imgCloseBtn").addEventListener("click", closeImageModal);
  $("imgDownloadBtn").addEventListener("click", downloadShot);
  $("imgShareBtn").addEventListener("click", shareShot);
  $("imgModal").addEventListener("click", (e) => { if (e.target === $("imgModal")) closeImageModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("imgModal").hidden) closeImageModal(); });

  $("exportBtn").addEventListener("click", exportAttendance);

  $("rankSort").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]");
    if (b) setRankSort(b.dataset.sort);
  });

  $("copyBtn").addEventListener("click", () => {
    const text = rosterText();
    const fb = $("copyFallback");
    const fallback = () => { fb.value = text; fb.hidden = false; fb.focus(); fb.select(); toast("자동 복사가 막혀 있어요. 아래 글을 직접 복사해 주세요."); };
    try {
      navigator.clipboard.writeText(text).then(() => { fb.hidden = true; toast("명단을 복사했습니다. 단톡방에 붙여넣으세요."); }, fallback);
    } catch (e) { fallback(); }
  });

  $("pinForm").addEventListener("submit", (e) => { e.preventDefault(); unlock($("pinInput").value.trim()); });
  $("lockBtn").addEventListener("click", () => { lock(); toast("잠갔습니다."); renderAll(); });
  $("changePinBtn").addEventListener("click", () => {
    $("changePinForm").hidden = false;
    $("changePinBtn").hidden = true;
    $("newPinInput").focus();
  });
  $("cancelPinBtn").addEventListener("click", () => {
    $("newPinInput").value = "";
    $("changePinForm").hidden = true;
    $("changePinBtn").hidden = false;
  });
  $("changePinForm").addEventListener("submit", (e) => { e.preventDefault(); changePin($("newPinInput").value.trim()); });

  // ---------- 시작 ----------
  try { S.pin = sessionStorage.getItem(PIN_KEY); } catch (e) { S.pin = null; }
  // 팀: 주소의 #faith/#hope/#love → 이 브라우저에서 마지막으로 고른 팀 → 믿음팀
  let savedTeam = null;
  try { savedTeam = localStorage.getItem(TEAM_KEY); } catch (e) { savedTeam = null; }
  const startTeam = teamFromHash() || (TEAMS.some(([t]) => t === savedTeam) ? savedTeam : "믿음");
  S.team = startTeam;
  if (!teamFromHash()) history.replaceState(null, "", "#" + TEAMS.find(([t]) => t === startTeam)[1]);
  renderLock();
  renderAll();
  let savedView = null;
  try { savedView = localStorage.getItem(VIEW_KEY); } catch (e) { savedView = null; }
  setView(savedView || "check", true);
  let savedSort = null;
  try { savedSort = localStorage.getItem("soccer-attendance-sort"); } catch (e) { savedSort = null; }
  setRankSort(savedSort || "rate");

  if (!window.supabase?.createClient) {
    S.mode = "offline";
    showNotice("DB 연결 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.");
    renderAll();
    return;
  }
  S.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 저장된 PIN이 그사이 바뀌었으면 잠금 상태로 되돌린다
  if (S.pin) {
    S.sb.rpc("verify_pin", { p_pin: S.pin }).then(({ data }) => { if (data === false) { lock(); renderAll(); } });
  }

  reload();
  const ch = S.sb.channel("attendance-changes");
  ["members", "attendance", "lineups", "lineup_slots", "team_names"].forEach((table) => {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
  });
  ch.subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleReload(); });
})();
