# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Plain HTML/CSS/JS with no build step, package manager, linter or test suite. The repo root is served as-is. It holds these pages:

| Page | Files | Data |
|---|---|---|
| Soccer club attendance (main app, site root) | `index.html`, `attendance.css`, `attendance.js`, `sw.js`, `manifest.webmanifest`, `icon-*.png` | Supabase project `soccer-attendance` (id `ldektmvedvhumdvrdbxj`) |
| "Best Line-up" phone-storage copy of the attendance app | `local/` (`index.html`, `local.css`, `local.js`, `sw.js`, own manifest/icons) | IndexedDB on the phone (falls back to `localStorage`); reads Supabase only for a one-time read-only "공유 DB에서 가져오기" import |
| RPG-style todo ("monsters" = tasks, XP/level-ups) | `todo.html`, `style.css`, `script.js` | `localStorage` only |
| Legacy attendance page for claude.ai | `soccer-attendance.html` | claude.ai artifact DB (`window.claude.use("db")`), published at https://claude.ai/artifact/FsvfEfYGV3dSjW4hpASNUa |

`soccer-attendance.html` is the original single-file version. It runs only as a claude.ai Artifact, which blocks network calls to Supabase. It is no longer the source of truth; Supabase is. Change it only when asked, and republish it with the Artifact tool, not by pushing.

`local/` is a separately maintained copy, not shared code: root changes never reach it. Edit only the root (Supabase) app unless the user explicitly asks for `local/` too, and then port the change by hand (its commits are prefixed `local/:`). An Android APK wraps the live root site, so root changes reach it without a rebuild; `apk/` (package and signing key) is gitignored and must never be committed.

UI copy and code comments are in Korean. Keep them that way.

## Deploy and preview

- **Live site:** GitHub Pages serves `main` from the repo root at https://sedapa-9277.github.io/design_skill/. Pushing to `main` updates it in about 1–2 minutes. The repo is public for this reason, and the Supabase anon key in `attendance.js` is intentionally public.
- **Team deep links:** `#faith` (믿음), `#hope` (소망), `#love` (사랑).
- **Cache busting:** whenever `attendance.css` or `attendance.js` changes, bump the `?v=N` query on both links in `index.html` and the `CACHE = 'attendance-shell-vN'` name in `sw.js` (kept equal). Phones and home-screen installs otherwise keep the stale files. The root service worker is network-first and only deletes caches with its own `attendance-shell-` prefix, so it never touches `local/`'s caches.
  - `local/` works the same way but cache-first: when `local.css`/`local.js` change, bump their `?v=N` in `local/index.html`, the matching entries in `local/sw.js`'s `SHELL`, and its `VERSION`.
- **Azure workflow:** `.github/workflows/azure-webapps-static.yml` runs on every push.
  - It copies only root-level `*.html *.css *.js *.webmanifest *.png` into `site/`. A new asset type must be added to that glob, and subfolders such as `local/` are not deployed to Azure (GitHub Pages does serve them).
  - It fails if a page references a missing local CSS/JS file.
  - The Azure deploy step is skipped while `AZURE_WEBAPP_NAME` is `your-app-name` or the `AZURE_WEBAPP_PUBLISH_PROFILE` secret is unset, so the run still passes.
- **Local preview:** this machine has no Node or Python. Serve the folder with any static server (e.g. a PowerShell `HttpListener`) and open `/index.html`. The page talks to the live Supabase project, so local edits act on real data.
- **GitHub access:** `gh` is not installed. For GitHub API calls, read the token from Git Credential Manager with `printf "protocol=https\nhost=github.com\n\n" | git credential fill`. Commits use author `leejjang812 <leejjang812@gmail.com>` (set in the repo's local git config).

## Attendance app architecture

### Supabase side

The schema lives only in Supabase migrations; there are no SQL files in this repo. Change it with the Supabase MCP `apply_migration` tool.

- **Tables (`public`):**
  - `members(id, name, active, team, created_at)`: `team` is one of `'믿음' | '소망' | '사랑'`, and active names are unique across all teams.
  - `attendance(day, member_id, game)`: a row's existence means the member played that game (1–6) that day.
  - `lineups(day, team, game, formation)`
  - `lineup_slots(day, team, game, slot 0–10, member_id)`: slot 0 is the GK, and a member appears at most once per (day, team, game).
  - Deleting a member cascades to attendance and slots.
  - `team_names(team, name)`: the editable display name per team key (1–12 chars, unique) and an `active` flag (1–3 active teams; the UI lists only active teams via `activeTeams()`). The client's `tn(team)` reads it and falls back to `"<team>팀"`. Team keys and `#faith`/`#hope`/`#love` never change.
- **Security model:**
  - RLS allows `select` for anon. Insert, update and delete are revoked.
  - Every write goes through a `SECURITY DEFINER` RPC that takes `p_pin` and calls `private.check_pin`.
  - The PIN is a 4-digit club code. Only its bcrypt hash is stored, in `private.settings`.
  - The RPCs are `verify_pin`, `add_members(p_pin, p_team, p_names)`, `rename_member`, `set_member_team`, `set_member_active`, `purge_member` (inactive members only), `set_attendance(p_pin, p_day, p_member, p_games[], p_on)`, `set_formation`, `place_member`, `delete_team_day(p_pin, p_day, p_team)`, `clear_team_game(p_pin, p_day, p_team, p_game)`, `rename_team(p_pin, p_team, p_name)`, `delete_team(p_pin, p_team)` (deletes the team's members and records, marks it inactive; never the last active team), `add_team(p_pin, p_name)` (reactivates the first inactive key, returns it), `purge_team_members(p_pin, p_team)` and `change_pin`.
  - Server-side rules live in these functions, and the client only mirrors them optimistically:
    - Unchecking attendance also removes the member from that game's lineup.
    - Placing a member also checks their attendance.
    - Moving teams drops the member's other-team lineup slots.
  - Advisor warnings about anon-executable `SECURITY DEFINER` functions are expected under this design.
- **PostgREST `safeupdate` gotcha:** requests through the API reject `UPDATE`/`DELETE` without a `WHERE` clause. `execute_sql` does not enforce this, so a function can pass a SQL test and still fail from the page. Test RPCs through the REST endpoint (`/rest/v1/rpc/<name>` with the anon key), and use no-op arguments when touching real data.
- **Realtime:** all five tables are in the `supabase_realtime` publication.

### Client (`attendance.js`, one IIFE)

- **State:** everything lives in a single `S` object.
  - `reload()` fetches all four tables, paging 1000 rows at a time, and rebuilds `S.members` (id → `{name, active, team}`) and `S.days` (`"YYYY-MM-DD"` → `{ att: {memberId: {g1: true…}}, lineup: {team: {g1: {formation, pos: {s0: memberId}}}} }`).
  - Realtime events and date changes call a debounced `scheduleReload()`.
- **Writes:** `write(queueKey, pend, call, okMsg)` handles every write.
  1. It applies optimistic values into `S.pending` (keys `"date|memberId|gN"`) or `S.pendingLineup` (keys `"date|team|gN|sI"` and `"date|team|gN|form"`).
  2. It serializes the call per key, runs the RPC, then calls `reload()`.
  3. It clears the pending entries.
  - Read helpers (`attended`, `lineupOf`) check the pending maps before `S.days`.
- **Team scoping:** almost every view filters by `S.team` through `teamMembers()`/`activeMembers()`, including the roster, stats, recent dates (`hasAny`) and lineups. Attendance rows themselves carry no team; it comes from the member.
- **PIN:** stored in `sessionStorage` after `verify_pin` succeeds. `needPin()` guards every edit control. An `invalid_pin` error re-locks the page.
- **Layout:**
  - At `max-width: 860px` the page becomes a phone app. A bottom `.tabbar` switches `.view[data-view]` sections (`check`, `lineup`, `summary`, `stats`, `members`); `.main` and `.side` use `display: contents`.
  - `body.picking` hides the header and shrinks the pitch while the bottom-sheet member picker is open.
  - The date button (`#calBtn`, a `.cal-tile` on phones) opens an in-app month calendar (`#calModal`) that circles the current team's meeting days. The native `<input type="date" id="datePick">` is kept hidden only for its `change` handler.
  - The attendance grid shows 4 games by default (`visibleGames()`; +/− up to 6, shared with the lineup tabs and day summary). Circle size depends on `#attTable[data-games]`, and checked cells render as an inline-SVG soccer ball.
  - Stats rate is meeting-day based: days attended ÷ team meeting days in the period, shown as "참석/전체".
  - Desktop shows all panels at once.
- **Formations:** positions come from the `FORMATIONS` table, `[label, x%, y%]` per slot with index 0 as the GK. The DB allows only the four formation keys defined there, so adding one needs a migration too.
