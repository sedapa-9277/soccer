(() => {
  // 내 폰 저장판: 모든 기록은 이 기기의 IndexedDB에만 저장한다 (서버 없음)
  // 공유 DB(Supabase)는 "공유 DB에서 가져오기"로 한 번 읽어 올 때만 쓴다 (읽기 전용, 공개용 anon 키)
  const SUPABASE_URL = "https://ldektmvedvhumdvrdbxj.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkZWt0bXZlZHZodW1kdnJkYnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NTQ0NTEsImV4cCI6MjEwODEzMDQ1MX0.2ZazwLYXhTwTF1bs9NSFhoSjQlZmvaSRuAEi3FkUyDQ";
  // 온라인 출석부와 같은 주소(origin)를 쓰므로 localStorage 키가 겹치지 않게 따로 둔다
  const TEAM_KEY = "soccer-local-team";
  const DB_NAME = "soccer-attendance-local";
  const BACKUP_APP = "soccer-attendance-local";
  const BACKUP_REMIND_DAYS = 14;

  // [팀 이름, 주소 뒤 # 링크]
  const TEAMS = [["믿음", "faith"], ["소망", "hope"], ["사랑", "love"]];
  // 삭제한(쓰지 않는) 팀 링크는 null — 첫 번째 사용 중인 팀으로 간다
  const teamFromHash = () => TEAMS.find(([t, h]) => "#" + h === location.hash && isActiveTeam(t))?.[0] || null;

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
    mode: "loading",          // loading | live | offline (저장소를 못 열었을 때)
    team: "믿음",
    members: new Map(),       // id -> {name, active, team, created_at}
    days: new Map(),          // "YYYY-MM-DD" -> {att: {memberId: {g1:true,...}}, lineup: {팀: {g1: {formation, pos: {s0: memberId}}}}}
    lastBackup: null,         // 마지막 백업 시각 (ISO 문자열)
    persisted: null,          // 브라우저가 저장소를 지우지 않도록 보호되는지
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
    teamActive: { 믿음: true, 소망: true, 사랑: true }, // 팀 구분값 -> 사용 중인지 (최소 1팀)
    addingTeam: false,        // 회원 관리에서 새 팀 이름 입력 중
    confirmTeamDel: null,     // 팀 삭제 확인 중인 팀
    confirmTeamPurge: null,   // 팀 회원 전체 삭제 확인 중인 팀
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
  function isActiveTeam(t) { return S.teamActive[t] !== false; }
  function activeTeams() { return TEAMS.filter(([t]) => isActiveTeam(t)); }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function showNotice(msg) { const n = $("notice"); n.textContent = msg; n.hidden = !msg; }

  // ---------- 저장소 (IndexedDB, 못 쓰면 localStorage) ----------
  // 키 "data" 하나에 회원·출석·포지션 전체를 통째로 저장한다. 동호회 한 곳 분량이라 충분히 작다
  let idb = null;
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no_idb")); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  }
  function kvGet(key) {
    if (!idb) {
      try {
        const v = localStorage.getItem(`${DB_NAME}:${key}`);
        return Promise.resolve(v ? JSON.parse(v) : undefined);
      } catch (e) { return Promise.reject(e); }
    }
    return new Promise((resolve, reject) => {
      try {
        const r = idb.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    });
  }
  function kvSet(key, val) {
    if (!idb) {
      try { localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(val)); return Promise.resolve(); }
      catch (e) { return Promise.reject(e); }
    }
    return new Promise((resolve, reject) => {
      try {
        const tx = idb.transaction("kv", "readwrite");
        tx.objectStore("kv").put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("abort"));
      } catch (e) { reject(e); }
    });
  }

  // ---------- 저장·백업 형식 <-> 메모리 상태 ----------
  function snapshot() {
    const days = {};
    for (const [d, v] of [...S.days].sort((a, b) => a[0].localeCompare(b[0]))) days[d] = v;
    return {
      app: BACKUP_APP,
      version: 1,
      savedAt: new Date().toISOString(),
      members: [...S.members].map(([id, m]) => ({ id, name: m.name, active: m.active !== false, team: m.team, created_at: m.created_at || null })),
      teamNames: { ...S.teamNames },
      teamActive: Object.fromEntries(TEAMS.map(([t]) => [t, isActiveTeam(t)])),
      days,
    };
  }

  // 저장소·백업 파일에서 읽은 값을 검사해 메모리 형식으로 바꾼다. 형식이 아니면 null
  function parseData(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.members) || !o.days || typeof o.days !== "object") return null;
    const teams = new Set(TEAMS.map(([t]) => t));
    const members = new Map();
    for (const m of o.members) {
      if (!m || typeof m.id !== "string" || typeof m.name !== "string" || !m.name.trim() || !teams.has(m.team)) continue;
      members.set(m.id, { name: m.name.trim().slice(0, 40), active: m.active !== false, team: m.team, created_at: m.created_at || null });
    }
    const days = new Map();
    for (const [d, v] of Object.entries(o.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !v || typeof v !== "object") continue;
      const day = { att: {}, lineup: {} };
      for (const [mid, gs] of Object.entries(v.att || {})) {
        if (!members.has(mid) || !gs) continue;
        for (const g of GAMES) if (gs[`g${g}`] === true) (day.att[mid] ||= {})[`g${g}`] = true;
      }
      for (const [t, games] of Object.entries(v.lineup || {})) {
        if (!teams.has(t) || !games) continue;
        for (const g of GAMES) {
          const lu = games[`g${g}`];
          if (!lu) continue;
          const out = { pos: {} };
          if (FORMATIONS[lu.formation]) out.formation = lu.formation;
          for (let i = 0; i < 11; i++) {
            const mid = lu.pos?.[`s${i}`];
            if (members.has(mid)) out.pos[`s${i}`] = mid;
          }
          (day.lineup[t] ||= {})[`g${g}`] = out;
        }
      }
      if (Object.keys(day.att).length || Object.keys(day.lineup).length) days.set(d, day);
    }
    // 팀 이름 (예전 백업 파일에는 없을 수 있다)
    const teamNames = {};
    for (const [t, n] of Object.entries(o.teamNames || {})) {
      if (teams.has(t) && typeof n === "string" && n.trim()) teamNames[t] = n.trim().slice(0, 12);
    }
    // 사용 중인 팀 (예전 백업에는 없으니 모두 사용 중으로)
    const teamActive = Object.fromEntries(TEAMS.map(([t]) => [t, o.teamActive?.[t] !== false]));
    if (!Object.values(teamActive).some(Boolean)) TEAMS.forEach(([t]) => { teamActive[t] = true; });
    return { members, days, teamNames, teamActive };
  }

  function applyData(parsed) {
    S.members = parsed ? parsed.members : new Map();
    S.days = parsed ? parsed.days : new Map();
    S.teamNames = parsed ? parsed.teamNames : {};
    S.teamActive = parsed ? parsed.teamActive : Object.fromEntries(TEAMS.map(([t]) => [t, true]));
    S.addingTeam = false;
    S.confirmTeamDel = null;
    S.confirmTeamPurge = null;
    if (!isActiveTeam(S.team)) switchToTeam(activeTeams()[0][0]);
  }

  function countData(data) {
    let att = 0;
    for (const d of data.days.values()) for (const gs of Object.values(d.att)) att += Object.keys(gs).length;
    return { members: data.members.size, days: data.days.size, att };
  }
  const countText = (c) => `회원 ${c.members}명 · 모임 ${c.days}일 · 출석 ${c.att}건`;

  function dayOf(map, d) {
    if (!map.has(d)) map.set(d, { att: {}, lineup: {} });
    return map.get(d);
  }

  // ---------- 불러오기 ----------
  async function load() {
    try {
      try { idb = await openDb(); } catch (e) { idb = null; }
      const parsed = parseData(await kvGet("data"));
      applyData(parsed);
      try { S.lastBackup = (await kvGet("lastBackup")) || null; } catch (e) { S.lastBackup = null; }
      S.mode = "live";
      showNotice(idb ? "" : "이 브라우저는 IndexedDB를 쓸 수 없어 임시 저장소에 저장합니다. 백업 파일을 자주 저장해 주세요.");
    } catch (e) {
      S.mode = "offline";
      showNotice("이 기기의 저장소를 열 수 없습니다. 시크릿(비공개) 창이라면 일반 창에서 열어 주세요.");
    }
    renderAll();
  }

  // 저장에 실패하면 마지막으로 저장된 내용으로 되돌린다
  async function revert() {
    try {
      const parsed = parseData(await kvGet("data"));
      applyData(parsed);
    } catch (e) { /* 그대로 둔다 */ }
    renderAll();
  }

  // ---------- 저장 (이 폰의 저장소에) ----------
  let saveChain = Promise.resolve();
  function persistData() {
    const data = snapshot(); // 지금 상태를 바로 떠 두고, 저장은 순서대로 한 번에 하나씩
    const p = saveChain.then(() => kvSet("data", data));
    saveChain = p.catch(() => {});
    return p;
  }

  function fail(code) { throw new Error(code); }

  function handleErr(e) {
    const msg = String(e?.message || "");
    if (msg.includes("last_team")) {
      toast("마지막 남은 팀은 삭제할 수 없습니다.");
    } else if (msg.includes("max_teams")) {
      toast("팀은 최대 3개까지 만들 수 있습니다.");
    } else if (msg.includes("duplicate_team_name")) {
      toast("다른 팀이 이미 쓰는 이름입니다.");
    } else if (msg.includes("duplicate_name")) {
      toast("같은 이름의 회원이 이미 명단에 있습니다.");
    } else if (msg.includes("wrong_team")) {
      toast("다른 팀 회원은 이 팀 포지션에 넣을 수 없습니다.");
    } else if (msg.includes("empty_name")) {
      toast("이름을 입력해 주세요.");
    } else if (msg.includes("not_inactive")) {
      toast("명단에서 뺀 회원만 완전히 삭제할 수 있습니다.");
    } else {
      toast("이 폰에 저장하지 못했습니다. 저장 공간이 부족한지 확인해 주세요.");
    }
  }

  // change(): 규칙을 검사한 뒤 메모리 상태를 고친다. 성공하면 저장하고 okMsg를 띄우고 true를 돌려준다
  async function write(change, okMsg) {
    if (S.mode !== "live") { toast("저장소를 열지 못해 수정할 수 없습니다."); return false; }
    let r;
    try { r = change(); } catch (e) { handleErr(e); renderAll(); return false; }
    renderAll();
    try {
      await persistData();
    } catch (e) {
      handleErr(e);
      await revert();
      return false;
    }
    if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
    return true;
  }

  // ---------- 규칙 (온라인판 DB 함수와 같은 규칙을 이 폰에서) ----------
  // 빈 칸 정리: 출석이 없는 회원, 포지션이 없는 팀, 아무 기록 없는 날짜를 지운다
  function tidyDay(date) {
    const day = S.days.get(date);
    if (!day) return;
    for (const [mid, gs] of Object.entries(day.att)) if (!Object.keys(gs).length) delete day.att[mid];
    for (const [t, games] of Object.entries(day.lineup)) if (!Object.keys(games).length) delete day.lineup[t];
    if (!Object.keys(day.att).length && !Object.keys(day.lineup).length) S.days.delete(date);
  }

  function slotsOf(day, team, g) {
    return day.lineup[team]?.[`g${g}`]?.pos || {};
  }

  // 출석 해제 시 그 경기 포지션에서도 함께 뺀다
  function dbSetAttendance(date, mid, games, on) {
    if (!S.members.has(mid)) fail("no_member");
    const day = dayOf(S.days, date);
    for (const g of games) {
      if (on) { (day.att[mid] ||= {})[`g${g}`] = true; continue; }
      if (day.att[mid]) delete day.att[mid][`g${g}`];
      for (const [t] of TEAMS) {
        const pos = slotsOf(day, t, g);
        for (const [s, v] of Object.entries(pos)) if (v === mid) delete pos[s];
      }
    }
    tidyDay(date);
  }

  function lineupEntry(date, team, g, formation) {
    const lu = ((dayOf(S.days, date).lineup[team] ||= {})[`g${g}`] ||= { pos: {} });
    if (!FORMATIONS[lu.formation]) lu.formation = formation;
    return lu;
  }

  // 포지션에 넣으면 그 경기 출석도 체크한다. 한 경기에서 한 회원은 한 자리에만
  function dbPlace(date, team, g, slot, mid, formation) {
    if (mid && S.members.get(mid)?.team !== team) fail("wrong_team");
    const lu = lineupEntry(date, team, g, formation);
    if (mid) {
      for (const [s, v] of Object.entries(lu.pos)) if (v === mid) delete lu.pos[s];
      lu.pos[`s${slot}`] = mid;
      (S.days.get(date).att[mid] ||= {})[`g${g}`] = true;
    } else {
      delete lu.pos[`s${slot}`];
    }
    tidyDay(date);
  }

  function dbSetFormation(date, team, g, f) {
    if (!FORMATIONS[f]) fail("bad_formation");
    lineupEntry(date, team, g, f).formation = f;
  }

  function newId() {
    try { return crypto.randomUUID(); } catch (e) { return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
  }

  // 명단에 있는 회원끼리는 (팀이 달라도) 이름이 겹치면 안 된다
  function dbAddMembers(team, names) {
    let n = 0;
    for (const raw of names) {
      const name = String(raw).trim().slice(0, 40);
      if (!name || nameTakenBy(name)) continue;
      S.members.set(newId(), { name, active: true, team, created_at: new Date().toISOString() });
      n++;
    }
    return n;
  }

  function dbRename(id, name) {
    const m = S.members.get(id);
    if (!m) fail("no_member");
    if (!name) fail("empty_name");
    if (m.active !== false && nameTakenBy(name, id)) fail("duplicate_name");
    m.name = name;
  }

  // 팀을 옮기면 다른 팀 포지션에 들어가 있던 자리는 모두 뺀다 (출석 기록은 그대로)
  function dbSetTeam(id, team) {
    const m = S.members.get(id);
    if (!m) fail("no_member");
    m.team = team;
    for (const [date, day] of S.days) {
      for (const [t, games] of Object.entries(day.lineup)) {
        if (t === team) continue;
        for (const lu of Object.values(games)) {
          for (const [s, v] of Object.entries(lu.pos || {})) if (v === id) delete lu.pos[s];
        }
      }
      tidyDay(date);
    }
  }

  function dbSetActive(id, active) {
    const m = S.members.get(id);
    if (!m) fail("no_member");
    if (active && nameTakenBy(m.name, id)) fail("duplicate_name");
    m.active = active;
  }

  // 완전 삭제: 명단에서 뺀 회원만. 출석·포지션 기록까지 모두 지운다
  function dbPurge(id) {
    const m = S.members.get(id);
    if (!m) fail("no_member");
    if (m.active !== false) fail("not_inactive");
    wipeMembers(new Set([id]));
  }

  // 회원 정보와 그 회원들의 출석·포지션 기록을 모두 지운다
  function wipeMembers(ids) {
    for (const id of ids) S.members.delete(id);
    for (const [date, day] of [...S.days]) {
      for (const id of ids) delete day.att[id];
      for (const games of Object.values(day.lineup)) {
        for (const lu of Object.values(games)) {
          for (const [s, v] of Object.entries(lu.pos || {})) if (ids.has(v)) delete lu.pos[s];
        }
      }
      tidyDay(date);
    }
  }

  // 팀 회원 전체 삭제 (명단에서 뺀 회원 포함). 팀은 남는다. 지운 회원 수를 돌려준다
  function dbPurgeTeamMembers(team) {
    const ids = new Set([...S.members].filter(([, m]) => m.team === team).map(([id]) => id));
    wipeMembers(ids);
    return ids.size;
  }

  // 팀 삭제: 회원·출석·포지션을 모두 지우고 팀을 쉬게 한다 (이름은 기본값으로). 마지막 한 팀은 지울 수 없다
  function dbDeleteTeam(team) {
    if (!isActiveTeam(team) || activeTeams().length <= 1) fail("last_team");
    dbPurgeTeamMembers(team);
    for (const [date, day] of [...S.days]) {
      delete day.lineup[team];
      tidyDay(date);
    }
    S.teamActive[team] = false;
    delete S.teamNames[team];
  }

  // 팀 추가: 쉬고 있는 첫 번째 팀 자리를 새 이름으로 다시 쓴다. 그 팀 구분값을 돌려준다
  function dbAddTeam(name) {
    if (!name) fail("empty_name");
    const free = TEAMS.find(([t]) => !isActiveTeam(t));
    if (!free) fail("max_teams");
    if (activeTeams().some(([t]) => tn(t).toLowerCase() === name.toLowerCase())) fail("duplicate_team_name");
    const t = free[0];
    S.teamActive[t] = true;
    if (name === `${t}팀`) delete S.teamNames[t];
    else S.teamNames[t] = name;
    return t;
  }

  // 날짜 기록 삭제: 그날 이 팀 회원의 출석과 이 팀 포지션만 지운다
  function dbDeleteTeamDay(date, team) {
    const day = S.days.get(date);
    if (!day) return;
    for (const mid of Object.keys(day.att)) if (S.members.get(mid)?.team === team) delete day.att[mid];
    delete day.lineup[team];
    tidyDay(date);
  }

  // 한 경기 초기화: 그날 그 경기의 이 팀 출석과 포지션 자리를 지운다 (포메이션은 남긴다). 지운 출석 수를 돌려준다
  function dbClearTeamGame(date, team, g) {
    const day = S.days.get(date);
    if (!day) return 0;
    let n = 0;
    for (const [mid, gs] of Object.entries(day.att)) {
      if (S.members.get(mid)?.team === team && gs[`g${g}`]) { delete gs[`g${g}`]; n++; }
    }
    const lu = day.lineup[team]?.[`g${g}`];
    if (lu) lu.pos = {};
    tidyDay(date);
    return n;
  }

  // 팀 이름: 화면에 보이는 이름만 바꾼다 (기록은 믿음·소망·사랑 구분값으로 남는다)
  function dbRenameTeam(team, name) {
    if (!name) fail("empty_name");
    if (activeTeams().some(([t]) => t !== team && tn(t).toLowerCase() === name.toLowerCase())) fail("duplicate_team_name");
    if (name === `${team}팀`) delete S.teamNames[team];
    else S.teamNames[team] = name;
  }

  // ---------- 출석 ----------
  function setGames(mid, games, on) {
    const date = S.date;
    const fromLineup = !on && games.some((g) => lineupOf(date, g).slots.includes(mid));
    const msg = fromLineup ? `${memberName(mid)} 님을 포지션에서도 뺐습니다.` : null;
    return write(() => dbSetAttendance(date, mid, games, on), msg);
  }

  function toggleCell(mid, g) {
    return setGames(mid, [g], !attended(S.date, mid, g));
  }

  // ---------- 포지션 배치 ----------
  function lineupOf(date, g) {
    const t = S.team;
    const base = S.days.get(date)?.lineup?.[t]?.[`g${g}`] || {};
    let formation = base.formation;
    if (!FORMATIONS[formation]) formation = DEFAULT_FORMATION;
    const slots = FORMATIONS[formation].map((_, i) => {
      const v = base.pos?.[`s${i}`];
      return v && S.members.get(v)?.team === t ? v : null;
    });
    return { formation, slots };
  }

  // 그 경기에서 이 회원이 서 있는 포지션 이름(없으면 null) — 출석 동그라미에 보여 준다
  function posOf(date, g, mid) {
    const lu = lineupOf(date, g);
    const i = lu.slots.indexOf(mid);
    return i < 0 ? null : FORMATIONS[lu.formation][i][0];
  }

  function placeMember(slotIdx, mid) {
    const date = S.date, g = S.lineupGame, t = S.team;
    const lu = lineupOf(date, g);
    const pos = FORMATIONS[lu.formation][slotIdx][0];
    // 사람을 넣을 때는 안내 없이 바로 반영한다 (자리를 비울 때만 안내)
    const msg = mid ? null
                    : `${pos} 자리를 비웠습니다. 출석은 출석판에서 해제할 수 있습니다.`;
    // 다 채워도 시트를 닫지 않는다 (닫히면 휴대폰에서 화면이 맨 위로 돌아감) — 닫기는 "닫기" 버튼으로
    S.pickSlot = mid ? nextEmptySlot(lu.slots, slotIdx, mid) ?? slotIdx : slotIdx;
    write(() => dbPlace(date, t, g, slotIdx, mid || null, lu.formation), msg);
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
    write(() => dbSetFormation(date, t, g, f));
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
    c.fillText("Best Line-up", W - PAD, H - 30);

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
      $("imgModalTitle").textContent = `${tn(S.team)} · ${S.date} · ${S.lineupGame}경기`;
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
      toast("그림을 공유했습니다.");
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
    write(() => dbAddMembers(team, fresh),
      (n) => `${tn(team)}에 ${n ?? fresh.length}명을 추가했습니다${taken.length ? ` (이미 있는 ${taken.length}명 제외)` : ""}.`);
  }

  async function moveMember(id, team) {
    const m = S.members.get(id);
    if (!m || m.team === team) return true;
    return write(() => dbSetTeam(id, team),
      `${m.name} 님을 ${tn(team)}으로 옮겼습니다.`);
  }

  function removeMember(id) {
    const name = memberName(id);
    write(() => dbSetActive(id, false),
      `${name} 님을 명단에서 뺐습니다. 지난 기록은 남아 있습니다.`);
  }

  function restoreMember(id) {
    const m = S.members.get(id);
    if (!m) return;
    const other = nameTakenBy(m.name, id);
    if (other) { toast(`같은 이름(${m.name})의 회원이 이미 ${tn(other.team)} 명단에 있습니다.`); return; }
    write(() => dbSetActive(id, true),
      `${m.name} 님을 명단에 다시 넣었습니다.`);
  }

  function purgeMember(id) {
    const name = memberName(id);
    write(() => dbPurge(id),
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
      const ok = await write(() => dbRename(id, name),
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
    if (activeTeams().some(([t]) => t !== team && tn(t).toLowerCase() === name.toLowerCase())) {
      toast("다른 팀이 이미 쓰는 이름입니다.");
      return;
    }
    const ok = await write(() => dbRenameTeam(team, name),
      `${before} → ${name}(으)로 팀 이름을 바꿨습니다.`);
    if (ok) { S.editTeamName = false; renderAll(); }
  }

  // ---------- 팀 관리: 추가 · 삭제 · 회원 전체 삭제 ----------
  // 두 번 눌러야 실행되는 빨간 버튼 (4초 안에 다시 누르지 않으면 원래대로)
  function teamConfirmButton(text, confirmText, stateKey, disabled, onConfirm) {
    const b = document.createElement("button");
    b.type = "button";
    const confirming = !disabled && S[stateKey] === S.team;
    b.className = "row-btn danger" + (confirming ? " confirm" : "");
    b.textContent = confirming ? confirmText : text;
    b.disabled = disabled;
    b.addEventListener("click", () => {
      const team = S.team;
      if (S[stateKey] === team) { S[stateKey] = null; onConfirm(team); return; }
      S[stateKey] = team;
      renderTeamTools();
      setTimeout(() => { if (S[stateKey] === team) { S[stateKey] = null; renderTeamTools(); } }, 4000);
    });
    return b;
  }

  function renderTeamTools() {
    const box = $("teamTools");
    box.replaceChildren();
    if (S.addingTeam) {
      const input = document.createElement("input");
      input.type = "text";
      input.id = "newTeamInput";
      input.className = "edit-input";
      input.maxLength = 12;
      input.placeholder = "새 팀 이름";
      input.setAttribute("aria-label", "새 팀 이름");
      const add = document.createElement("button");
      add.type = "button";
      add.className = "row-btn";
      add.textContent = "추가";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "row-btn";
      cancel.textContent = "취소";
      const doAdd = () => addTeam(input.value);
      const doCancel = () => { S.addingTeam = false; renderTeamTools(); };
      add.addEventListener("click", doAdd);
      cancel.addEventListener("click", doCancel);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); doAdd(); }
        if (e.key === "Escape") doCancel();
      });
      box.append(input, add, cancel);
      setTimeout(() => input.focus(), 0);
      return;
    }
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = "팀 관리";
    box.append(label);
    if (activeTeams().length < TEAMS.length) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "row-btn";
      add.textContent = "팀 추가";
      add.addEventListener("click", () => { S.addingTeam = true; S.confirmTeamDel = null; S.confirmTeamPurge = null; renderTeamTools(); });
      box.append(add);
    }
    const n = teamMembers(true).length;
    box.append(teamConfirmButton("회원 전체 삭제", `정말 ${n}명 모두 삭제할까요?`, "confirmTeamPurge", n === 0, purgeTeamMembers));
    const last = activeTeams().length <= 1;
    const del = teamConfirmButton("팀 삭제", "정말 삭제할까요? 회원·기록 모두 삭제", "confirmTeamDel", last, deleteTeam);
    if (last) del.title = "마지막 남은 팀은 삭제할 수 없습니다";
    box.append(del);
  }

  async function addTeam(raw) {
    const name = String(raw || "").trim().slice(0, 12);
    if (!name) { toast("팀 이름을 입력해 주세요."); return; }
    if (activeTeams().some(([t]) => tn(t).toLowerCase() === name.toLowerCase())) { toast("다른 팀이 이미 쓰는 이름입니다."); return; }
    let team = null;
    const ok = await write(() => { team = dbAddTeam(name); }, `${name} 팀을 추가했습니다. 회원을 추가해 주세요.`);
    if (ok) { S.addingTeam = false; setTeam(team); }
  }

  function deleteTeam(team) {
    const name = tn(team);
    write(() => {
      dbDeleteTeam(team);
      switchToTeam(activeTeams()[0][0]);
    }, `${name}을(를) 삭제했습니다. 회원과 기록도 모두 지웠습니다.`);
  }

  function purgeTeamMembers(team) {
    const name = tn(team);
    write(() => dbPurgeTeamMembers(team), (n) => `${name} 회원 ${n}명과 그 기록을 모두 삭제했습니다.`);
  }

  // 화면을 다시 그리지 않고 지금 팀만 바꾼다 (주소 # 와 마지막 팀 기억도 함께)
  function switchToTeam(team) {
    S.team = team;
    S.editTeamName = false;
    S.addingTeam = false;
    S.confirmTeamDel = null;
    S.confirmTeamPurge = null;
    S.rankOpen = null;
    S.pickSlot = null;
    S.editId = null;
    S.confirmDel = null;
    S.confirmPurge = null;
    try { localStorage.setItem(TEAM_KEY, team); } catch (e) { /* 저장 불가 시 무시 */ }
    const hash = "#" + TEAMS.find(([t]) => t === team)[1];
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function setTeam(team) {
    if (!TEAMS.some(([t]) => t === team) || !isActiveTeam(team)) return;
    switchToTeam(team);
    renderAll();
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

  // ---------- 백업 · 복원 ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function daysSince(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }

  function markBackedUp() {
    S.lastBackup = new Date().toISOString();
    kvSet("lastBackup", S.lastBackup).catch(() => {});
    renderBackup();
  }

  // 백업 파일을 만들어 저장·공유 창을 띄운다 (그림 저장과 같은 방식)
  let backup = null; // {blob, name, shareFile}
  function openBackup() {
    if (S.mode !== "live") { toast("저장소를 열지 못해 백업할 수 없습니다."); return; }
    const text = JSON.stringify(snapshot(), null, 1);
    const name = `출석부_백업_${ymd(new Date())}.json`;
    const blob = new Blob([text], { type: "application/json" });
    // 안드로이드 크롬은 .json 파일 공유를 막으므로, 막히면 같은 내용을 .txt로 공유한다
    let shareFile = null;
    try {
      const asJson = new File([blob], name, { type: "application/json" });
      const asText = new File([text], name.replace(/\.json$/, ".txt"), { type: "text/plain" });
      if (navigator.canShare?.({ files: [asJson] })) shareFile = asJson;
      else if (navigator.canShare?.({ files: [asText] })) shareFile = asText;
    } catch (e) { shareFile = null; }
    backup = { blob, name, shareFile };
    $("backupModalTitle").textContent = name;
    $("backupTip").innerHTML = `${esc(countText(countData(S)))}<br>` +
      (shareFile ? "<b>파일로 저장</b>하거나 <b>공유하기</b>로 카톡·드라이브에 보내 두세요." : "<b>파일로 저장</b>한 뒤 카톡·드라이브 등에 올려 두세요.") +
      " 폰을 바꾸거나 앱을 지웠을 때 이 파일로 되살릴 수 있습니다.";
    $("backupShareBtn").hidden = !shareFile;
    $("backupModal").hidden = false;
    document.body.classList.add("modal-open");
    $("backupCloseBtn").focus();
  }

  function closeBackup() {
    $("backupModal").hidden = true;
    document.body.classList.remove("modal-open");
    backup = null;
  }

  function downloadBackup() {
    if (!backup) return;
    const url = URL.createObjectURL(backup.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backup.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    markBackedUp();
    toast("백업 파일을 저장했습니다. 휴대폰은 '다운로드' 또는 '파일' 앱에서 찾을 수 있습니다.");
  }

  async function shareBackup() {
    if (!backup?.shareFile) return;
    try {
      await navigator.share({ files: [backup.shareFile], title: backup.name });
      markBackedUp();
      toast("백업 파일을 보냈습니다.");
    } catch (e) {
      if (e?.name !== "AbortError") toast("공유하지 못했습니다. '파일로 저장'을 눌러 주세요.");
    }
  }

  // 중요한 작업 확인 창 (confirm()은 앱·웹뷰에서 안 뜨는 경우가 있어 직접 만든다)
  let askResolve = null;
  function askConfirm(title, html, okLabel) {
    if (askResolve) closeAsk(false);
    $("askTitle").textContent = title;
    $("askText").innerHTML = html;
    $("askOk").textContent = okLabel || "확인";
    $("askModal").hidden = false;
    document.body.classList.add("modal-open");
    $("askCancel").focus();
    return new Promise((resolve) => { askResolve = resolve; });
  }
  function closeAsk(ok) {
    if (!askResolve) return;
    const r = askResolve;
    askResolve = null;
    $("askModal").hidden = true;
    document.body.classList.remove("modal-open");
    r(ok);
  }

  // 이 폰의 기록 전체를 바꾼다 (백업 불러오기, 공유 DB 가져오기)
  async function replaceAll(parsed, okMsg) {
    applyData(parsed);
    S.editTeamName = false;
    S.shownGames.clear();
    S.pickSlot = null;
    S.rankOpen = null;
    S.editId = null;
    S.confirmDeleteDay = null;
    renderAll();
    try {
      await persistData();
      toast(okMsg);
    } catch (e) {
      handleErr(e);
      await revert();
    }
  }

  function overwriteText(src, incoming) {
    const now = countData(S);
    return `${src}<br><b>${esc(countText(incoming))}</b><br><br>` +
      (now.members || now.days
        ? `지금 이 폰의 기록(${esc(countText(now))})을 <b>모두 지우고</b> 이 내용으로 바꿉니다. 되돌릴 수 없으니 필요하면 먼저 백업 파일을 저장하세요.`
        : "이 폰에는 아직 기록이 없습니다. 이 내용으로 시작합니다.");
  }

  async function importBackupFile(file) {
    if (S.mode !== "live") { toast("저장소를 열지 못해 불러올 수 없습니다."); return; }
    let parsed = null;
    try { parsed = parseData(JSON.parse(await file.text())); } catch (e) { parsed = null; }
    if (!parsed) { toast("출석부 백업 파일이 아닙니다. 백업 파일 저장으로 만든 파일을 골라 주세요."); return; }
    const c = countData(parsed);
    const ok = await askConfirm("백업 불러오기", overwriteText(`파일: ${esc(file.name)}`, c), "덮어쓰기");
    if (ok) await replaceAll(parsed, `백업을 불러왔습니다. ${countText(c)}`);
  }

  // ---------- 공유 DB(온라인 출석부)에서 한 번 가져오기: 읽기만 한다 ----------
  async function fetchTable(table, cols, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${cols}&order=${order}`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Range-Unit": "items",
          Range: `${from}-${from + 999}`,
        },
      });
      if (res.status === 416) return out; // 딱 1000의 배수일 때 다음 쪽이 없음
      if (!res.ok) throw new Error(`http_${res.status}`);
      const rows = await res.json();
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  async function importFromCloud() {
    if (S.mode !== "live") { toast("저장소를 열지 못해 가져올 수 없습니다."); return; }
    const btn = $("cloudImportBtn");
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = "공유 DB 읽는 중…";
    let parsed = null;
    try {
      const [members, att, lineups, slots, teamRows] = await Promise.all([
        fetchTable("members", "id,name,active,team,created_at", "created_at,id"),
        fetchTable("attendance", "day,member_id,game", "day,member_id,game"),
        fetchTable("lineups", "day,team,game,formation", "day,team,game"),
        fetchTable("lineup_slots", "day,team,game,slot,member_id", "day,team,game,slot"),
        // 팀 이름·사용 여부: active 열이 없으면 이름만, 표가 없으면 빈 목록
        fetchTable("team_names", "team,name,active", "team")
          .catch(() => fetchTable("team_names", "team,name", "team"))
          .catch(() => []),
      ]);
      const days = {};
      const day = (d) => (days[d] ||= { att: {}, lineup: {} });
      for (const r of att) (day(r.day).att[r.member_id] ||= {})[`g${r.game}`] = true;
      const lu = (r) => ((day(r.day).lineup[r.team] ||= {})[`g${r.game}`] ||= { pos: {} });
      for (const r of lineups) lu(r).formation = r.formation;
      for (const r of slots) lu(r).pos[`s${r.slot}`] = r.member_id;
      const teamNames = Object.fromEntries(teamRows.map((r) => [r.team, r.name]));
      const teamActive = Object.fromEntries(teamRows.filter((r) => r.active === false).map((r) => [r.team, false]));
      parsed = parseData({ members, days, teamNames, teamActive });
    } catch (e) {
      parsed = null;
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
    if (!parsed) { toast("공유 DB를 읽지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요."); return; }
    const c = countData(parsed);
    const ok = await askConfirm("공유 DB에서 가져오기", overwriteText("온라인 출석부의 현재 기록", c), "가져오기");
    if (ok) await replaceAll(parsed, `공유 DB에서 가져왔습니다. ${countText(c)}`);
  }

  // ---------- 저장 공간 보호 (브라우저가 공간 부족 때 임의로 지우지 않도록 요청) ----------
  async function askPersist() {
    try {
      if (!navigator.storage?.persisted) S.persisted = null;
      else {
        let p = await navigator.storage.persisted();
        if (!p && navigator.storage.persist) p = await navigator.storage.persist();
        S.persisted = p;
      }
    } catch (e) { S.persisted = null; }
    renderBackup();
  }

  function renderBackup() {
    const c = countData(S);
    $("dataCount").textContent = S.mode === "live" ? countText(c) : "-";
    const lb = S.lastBackup;
    const ago = lb ? daysSince(lb) : null;
    $("lastBackup").textContent = lb ? `${label(ymd(new Date(lb)), true)} (${ago <= 0 ? "오늘" : `${ago}일 전`})` : "아직 없음";
    $("persistState").textContent = S.persisted === true ? "보호됨 (브라우저가 임의로 지우지 않음)"
      : S.persisted === false ? "보호 안 됨 (공간이 부족하면 지워질 수 있음)" : "확인할 수 없음";
    $("persistState").classList.toggle("warn", S.persisted === false);
    // 기록이 있는데 14일 넘게 백업하지 않았으면 위에 알림줄
    const due = S.mode === "live" && c.members > 0 && (!lb || ago >= BACKUP_REMIND_DAYS);
    $("backupBar").hidden = !due;
    $("lastBackup").classList.toggle("warn", due);
    if (due) {
      $("backupBarText").textContent = lb
        ? `마지막 백업이 ${ago}일 전입니다. 백업 파일을 저장해 두세요.`
        : "아직 백업한 적이 없습니다. 기록은 이 폰에만 있어요.";
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
      p.textContent = activeMembers().length
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
    if (S.confirmClearGame !== key) {
      S.confirmClearGame = key;
      renderGrid();
      setTimeout(() => { if (S.confirmClearGame === key) { S.confirmClearGame = null; renderGrid(); } }, 3000);
      return;
    }
    S.confirmClearGame = null;
    const date = S.date, team = S.team;
    write(() => dbClearTeamGame(date, team, g), (n) => `${g}경기 참석 ${n}명을 초기화했습니다.`);
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
      $("emptyText").textContent = "회원 탭에서 이름을 추가하면 이 팀의 경기별 출석판이 생깁니다. 온라인 출석부 기록이 있다면 회원 탭의 \"공유 DB에서 가져오기\"로 한 번에 옮길 수 있습니다.";
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
        b.className = "cell";
        const pos = on ? posOf(S.date, g, id) : null;
        b.textContent = on ? pos || "참석" : g;
        b.setAttribute("aria-pressed", on);
        b.setAttribute("aria-label", `${m.name} ${g}경기 ${on ? "참석" + (pos ? " " + pos : "") : "미참석"}`);
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
    const key = shownKey();
    if (S.confirmDeleteDay !== key) {
      S.confirmDeleteDay = key;
      renderSide();
      setTimeout(() => { if (S.confirmDeleteDay === key) { S.confirmDeleteDay = null; renderSide(); } }, 4000);
      return;
    }
    S.confirmDeleteDay = null;
    const date = S.date, team = S.team, when = label(date, true);
    write(() => {
      dbDeleteTeamDay(date, team);
      S.shownGames.delete(`${date}|${team}`);
    }, `${when} ${tn(team)} 기록을 삭제했습니다.`);
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
    try { localStorage.setItem(SORT_KEY, S.rankSort); } catch (e) { /* 저장 불가 시 무시 */ }
    renderStats();
  }

  function confirmButton(text, confirmText, stateKey, id, onConfirm) {
    const b = document.createElement("button");
    const confirming = S[stateKey] === id;
    b.className = "row-btn" + (confirming || stateKey === "confirmPurge" ? " danger" : "");
    b.textContent = confirming ? confirmText : text;
    b.addEventListener("click", () => {
      if (S[stateKey] === id) { S[stateKey] = null; onConfirm(); renderMembers(); return; }
      S[stateKey] = id;
      renderMembers();
      setTimeout(() => { if (S[stateKey] === id) { S[stateKey] = null; renderMembers(); } }, 3000);
    });
    return b;
  }

  function renderMembers() {
    renderTeamName();
    renderTeamTools();
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
        activeTeams().forEach(([t]) => sel.add(new Option(`${tn(t)}`, t)));
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
      btn.addEventListener("click", () => restoreMember(id));
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
    renderBackup();
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
  const VIEW_KEY = "soccer-local-view";
  const SORT_KEY = "soccer-local-sort";
  const VIEWS = ["check", "lineup", "summary", "stats", "members"];
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

  // 날짜를 바꾸면 바로 다시 그린다
  function setDate(d) {
    S.date = d;
    S.pickSlot = null;
    renderAll();
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
  // 삭제한 팀 링크로 오면 지금 팀 주소로 되돌린다
  window.addEventListener("hashchange", () => { const t = teamFromHash(); if (!t) setTeam(S.team); else if (t !== S.team) setTeam(t); });

  $("formationSel").addEventListener("change", (e) => {
    setFormation(e.target.value);
  });

  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
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

  $("backupBtn").addEventListener("click", openBackup);
  $("backupBarBtn").addEventListener("click", () => {
    setView("members");
    $("dataPanel").scrollIntoView({ block: "start" });
  });
  $("backupCloseBtn").addEventListener("click", closeBackup);
  $("backupDownloadBtn").addEventListener("click", downloadBackup);
  $("backupShareBtn").addEventListener("click", shareBackup);
  $("backupModal").addEventListener("click", (e) => { if (e.target === $("backupModal")) closeBackup(); });
  $("importBtn").addEventListener("click", () => { $("importFile").value = ""; $("importFile").click(); });
  $("importFile").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) importBackupFile(f); });
  $("cloudImportBtn").addEventListener("click", importFromCloud);
  $("askOk").addEventListener("click", () => closeAsk(true));
  $("askCancel").addEventListener("click", () => closeAsk(false));
  $("askModal").addEventListener("click", (e) => { if (e.target === $("askModal")) closeAsk(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("askModal").hidden) closeAsk(false);
    else if (!$("backupModal").hidden) closeBackup();
  });

  // ---------- 시작 ----------
  // 팀: 주소의 #faith/#hope/#love → 이 브라우저에서 마지막으로 고른 팀 → 믿음팀
  let savedTeam = null;
  try { savedTeam = localStorage.getItem(TEAM_KEY); } catch (e) { savedTeam = null; }
  const startTeam = teamFromHash() || (TEAMS.some(([t]) => t === savedTeam) ? savedTeam : "믿음"); // 저장된 팀 정보를 읽은 뒤 쉬는 팀이면 첫 팀으로 바뀐다
  S.team = startTeam;
  if (!teamFromHash()) history.replaceState(null, "", "#" + TEAMS.find(([t]) => t === startTeam)[1]);
  renderAll();
  let savedView = null;
  try { savedView = localStorage.getItem(VIEW_KEY); } catch (e) { savedView = null; }
  setView(savedView || "check", true);
  let savedSort = null;
  try { savedSort = localStorage.getItem(SORT_KEY); } catch (e) { savedSort = null; }
  setRankSort(savedSort || "rate");

  load().then(askPersist);
})();
