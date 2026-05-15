# CLAUDE.md — BLOOM project agent context

This file is the contract between the project and any AI agent working on it. Read it at the start of every session. Update it whenever the project changes — see [Living docs rule](#living-docs-rule) at the bottom.

The human-facing description lives in [README.md](README.md). This file focuses on what an AI needs to continue work without re-reading the entire codebase.

---

## 1. Project in one paragraph

BLOOM is a Suika-style 4×6 merge puzzle. The frontend is a single HTML file (`public/index.html`, ~1.1k lines, vanilla JS IIFE, RTL Hebrew). The backend is a tiny Node/Express server (`server.js`) that serves the static frontend and a JSON API backed by Postgres. The deployment target is Railway. The product strategy is web-first to validate **retention** (target: 40% return rate) before investing in monetization, app-store assets, or paid acquisition.

---

## 2. User profile

- Israeli lawyer-entrepreneur, not a senior engineer. Solo indie dev.
- Communicates in Hebrew; prefers Hebrew responses in chat.
- Comfortable with single-file HTML apps, no build, no frameworks. Reused stack from his prior SST / BarberBot project.
- Pragmatic: cost/benefit reasoning beats engineering perfection. Frame trade-offs in business/product terms.

---

## 3. Architecture

```
[Browser]
  └── public/index.html  (game UI + state + audio + API calls, single IIFE)
        │
        │  fetch /api/*
        ▼
[Railway: bloom-web (Node 18 / Express)]
  ├── server.js   ← routes, validation, queries
  └── db.js       ← pg Pool, initDb() applies schema.sql on boot
        │
        ▼
[Railway: Postgres-z2RQ]
  └── daily_scores (PK: date + device_id, one row per device per date)
```

- Frontend talks to backend via same-origin `/api/*` calls (`API_BASE = ''`).
- No auth. Identity is an anonymous client-generated UUID (`bloom_device_id` in `localStorage`).
- Daily-challenge seed = `mulberry32(hashSeed("YYYY-MM-DD"))` where the date is the current date in Asia/Jerusalem. Deterministic across all players for the day.
- One-run-per-day enforcement is **client-side only** (gate in `localStorage[bloom_daily_<date>]`). Server only enforces "best score wins" via the upsert clause.

---

## 4. File structure (authoritative)

```
bloom-game/
├── public/
│   ├── index.html      # ENTIRE frontend in one file — HTML + CSS + IIFE JS
│   ├── bot.js          # Dev-only auto-play bot (activated via ?bot=1 / ?botui)
│   ├── manifest.json   # PWA manifest (name, theme, icons → /assets/icon-192/512.png)
│   └── assets/         # favicons, app icons, logos, social-share.png (referenced from index.html <head>)
├── admin/
│   └── index.html      # Single-file RTL Hebrew admin dashboard — gated behind ADMIN_PATH + ADMIN_PASSWORD env vars
├── scripts/
│   └── seed_demo.js    # Demo data seeder (npm run seed:demo) — touches only device_id LIKE 'demo-%'
├── server.js           # Express app + routes + admin router + bootstrap
├── db.js               # pg.Pool, initDb()
├── schema.sql          # daily + contest + live + visits + admin_actions tables
├── package.json        # type:module, deps: express + pg (NO new deps)
├── README.md           # human-facing
├── CLAUDE.md           # this file
├── ADMIN_ROADMAP.md    # phased plan for admin / payments / monetization
├── ROADMAP_1.md        # HISTORICAL design doc — does NOT describe current state
└── .gitignore
```

### Frontend internal map (line numbers will drift — use grep)

Key constants live near the top of the `<script>` (currently around L300–L340):

- `ROWS = 6, COLS = 4`
- `TIERS[]` — array of 8 tier objects (id, color, emoji, inline SVG)
- `MAX_TIER`
- `WEIGHTS = [0, 55, 28, 12, 5]` — drop-piece probability table (tier 1–4 only spawn naturally)
- `BEST_KEY`, `NAME_KEY`, `DEVICE_KEY`, `DAILY_PLAYED_PREFIX`, `MUTE_KEY` — localStorage keys
- `API_BASE = ''` — same-origin

Logical sections (grep these labels in `public/index.html`):

| Section | Approx. function names |
| --- | --- |
| Audio (Web Audio API + mute) | `ensureAudio`, `playTone`, `soundDrop`, `soundMerge`, `soundChain`, `soundMilestone`, `soundGameOver`, `buzz`, `toggleMute`, `updateMuteUI` |
| RNG + daily seed | `mulberry32`, `hashSeed`, `todayInIsrael`, `formatDateHe`, `msUntilNextIsraelMidnight`, `formatCountdown` |
| Identity | `getDeviceId`, `promptForName` |
| Init + mode | `init(nextMode)`, `updateModeBar`, `startCountdown` |
| Leaderboard | `renderLeaderboard`, `submitAndShowLeaderboard`, `loadLeaderboard` (in-page top 5) |
| Leaderboard modal (day/week/month) | `openLeaderboardModal`, `closeLeaderboardModal`, `switchLbTab`, `loadLbModal`, `renderLbModalBody` |
| Contest leaderboard | `renderContestBoardRows`, `fetchContest`, `submitContestScore`, `refreshContestBoardSilently`, `startContestRefresh`, `refreshOvertake` |
| Live contest (real-time) | `pushLiveScore`, `pushLiveState`, `scheduleLiveScorePush`, `stopLivePush`, `updateMyWatchersFromContestData`, `renderAudienceBadge`, `ensureAudienceBadge`, `removeAudienceBadge` |
| Spectator mode | `openSpectatorPicker`, `refreshSpectatorPicker`, `startSpectator`, `spectatorTick`, `spectatorHeartbeat`, `renderSpectatorView`, `stopSpectator`, `showSpectatorToast` |
| Gameplay | `pickPiece`, `findGroup` (BFS), `applyGravity`, `processChains`, `drop`, `isGameOver` |
| Feedback animation | `showFloatingScore`, `showChainBadge`, `bumpScore` |
| Tier-ladder indicator | `buildTierBar`, `highlightNextTier`, `revealNextTier`, `rollNextPiece` |
| Share / info / render | `shareResult`, `showInfo`, `render(opts)` |

---

## 5. Current features (what's actually shipped)

- ✅ 4×6 merge engine with BFS group detection, gravity, and chain processing
- ✅ Chain multiplier scoring (×1 / ×1.5 / ×2 / ×2.5 / ×3)
- ✅ Floating `+points` badges + "שרשרת ×N" banner
- ✅ Score-bump animation, merge `pop`/`merge` cell animations
- ✅ Personal best in `localStorage`
- ✅ Game-over modal with full tier table + emoji-grid share
- ✅ Wordle-style share via `navigator.share` + clipboard fallback
- ✅ Info modal with scoring formula
- ✅ Mute button (sounds + music, persisted)
- ✅ Web Audio synth: drop, merge (tier-pitched), chain, milestone, game-over
- ✅ Mobile vibration (`navigator.vibrate`) on merge and chain
- ✅ Daily challenge mode — Asia/Jerusalem date seeds, one run per device per day
- ✅ Practice mode — random seed, unlimited replays, no leaderboard submit
- ✅ Anonymous deviceId + one-time player-name prompt
- ✅ Daily leaderboard (top 50) with player highlight + absolute rank
- ✅ Public leaderboard modal with day/week/month tabs (rolling 1/7/30 day windows, best-per-device)
- ✅ Countdown to next daily reset (Asia/Jerusalem midnight)
- ✅ PWA manifest (`public/manifest.json`) + favicons / apple-touch-icon / Open Graph + Twitter Card preview, all served from `public/assets/`
- ✅ Tier-ladder "next piece" indicator — horizontal row of all 8 tier icons with mini merge-points beneath each. Active tier is scaled up with a colored glow ring and its score un-fades to the tile color. After each drop a silent left-to-right sweep cycles through tiers 1-4 (`revealNextTier`) and settles on the chosen piece, teaching the ladder order through repetition.
- ✅ **Live contest leaderboard** — while a contest game is in progress, the active player's score updates onto every other contestant's leaderboard view as a pulsing green pill, 1×/sec via `pushLiveScore`. The pill is shown *in addition to* the accumulated total so the rank ordering reflects the projected end-of-game score.
- ✅ **Live spectator mode** — players can watch any other contestant who's currently mid-game. Two entry points: (a) post-game from the game-over modal, (b) **mid-game** from the contest leaderboard screen (`showContestLeaderboard`) — every row with `liveScore !== null` is `spectatable` (role=button, data-spectate-target/data-spectate-name), wired via a delegated handler on `#clb-board`. A top-level "צפה במשחק חי (N)" button shows when at least one live row is rendered. Mid-game entry calls `saveContestGameState()` then `stopLivePush()`, and on exit (`init('contest')`) resumes from the saved state. Watched grid + score + next-piece refreshes every 1s via `GET /api/contests/:code/live-state/:targetDeviceId`. Watching is cost-aware: the active player only POSTs grid frames (`/live-state`) when the server confirmed they have at least one watcher (`hasWatchers` in `/live-score` response). The spectator's `/watch` heartbeat (every 5s) carries either `lastFinalScore` or — when paused mid-game — their *current* in-progress score, so the watched player sees an honest "this watcher reached X" value.
- ✅ **Audience awareness** — the active player sees a floating "👁 N" badge over the board with the watcher count. Tap to expand a list of each watcher's name + last-completed-game score. Watcher heartbeat is 5s; TTL on the server is 10s, so closing a tab disappears the watcher from the badge within ≤15s without any explicit teardown.
- ✅ **Admin dashboard** at `admin/index.html` — gated behind `ADMIN_PATH` (URL slug) **and** `ADMIN_PASSWORD` (HTTP Basic Auth). Includes DAU/WAU/MAU/D1 KPIs vs 2026 hybrid-casual benchmarks (40/20/7), 30-day DAU sparkline, 7-day funnel (visited → played → completed → returned-next-day), weekly cohort retention table (D1/D7/D30 per cohort), time-of-day heatmap (7×24, Asia/Jerusalem), top-scores with z-score outlier flagging (threshold > 3σ), contest management (PATCH endsAt/status/name, DELETE), paginated player list with drill-down + cascading delete, "what's happening right now" live view (from `contest_live_state` + `contest_watchers` filtered to 30s), audit log (`admin_actions` table), CSV export with UTF-8 BOM for every table. Reuses existing `cleanContestName`, `isValidDate`, and the rate-limit helper from server.js.
- ✅ **Visit tracking** — `/api/ping` upserts `device_visits` rows on each page boot. Lightweight (~1 row/device/day), enables bounce-rate and accurate retention denominators.
- ✅ **Demo seeder** (`scripts/seed_demo.js`) — populates 30 players × 30 days × 5 contests for screenshots/load-testing. Scoped to `device_id LIKE 'demo-%'` and contest codes `D…DEMO`. Refuses to run if >1000 non-demo `daily_scores` rows exist unless `--force`. npm scripts: `seed:demo`, `seed:reset`, `seed:clean`.
- ✅ **BLOOM Challenges** — public single-shot prize contests. Four types (`race`, `top_n`, `beat`, `first_to_tier`), admin picks at creation. PK on `(challenge_id, device_id)` enforces "single attempt" at the DB layer. Score-only-grows guard on `/score` heartbeat. Winner slots assigned eagerly under `SELECT FOR UPDATE` for race/first-to-tier (race-safe), on `/complete` for `beat`, on admin `/finalize` for `top_n`. Cheat-flag heuristics: z-score > 3σ AND drops-vs-score sanity table. Frontend mode `'challenge'` (4th mode tab "אתגרים"): no save/load, no reset button, `beforeunload` warning, prize chip floats over the grid, custom result screen with in-line winner contact form. Admin section "אתגרים" — full CRUD with lock-down once entries exist + starts_at passed (only safe fields editable). Helpers added: `cleanSlug`, `challengeDropsImplausible`, `challengeZScore`, `maybeGrabWinnerSlot`. New rate-limit buckets: `challenge:enter` (5/hr), `challenge:score` (600/hr), `challenge:claim` (5/hr).

---

## 6. What was rolled back (do not assume these exist)

In commit `4fb5972` (Roll back to initial daily-challenge game, layered with sound system), the following were **removed** from the current build:

- ❌ Welcome splash / persistent home screen with logo + slogan
- ❌ 6-step interactive tutorial (board intro, first drop, first merge, multi-merge demo, chain, full path to Crown)
- ❌ Background MP3 music (`bloom-music.mp3`) — the file is no longer referenced and the music loop is gone; only synth SFX remain
- ❌ Pre-reset confirmation prompts

`ROADMAP_1.md` still describes these as "shipped" — that doc is **stale**. Trust the code, not the roadmap.

---

## 7. APIs and integrations

### Backend routes (server.js)

| Method | Path | Notes |
| --- | --- | --- |
| `GET /api/health` | — | `{ ok: true }` |
| `POST /api/score` | `{ date, deviceId, name, score, tier }` | Upsert with `WHERE daily_scores.score < EXCLUDED.score` — only higher scores win. Returns `{ ok, rank }`. |
| `GET /api/leaderboard/:date` | `?deviceId=...` | Top 50 for one date. Returns `{ list, total, rank }`. |
| `GET /api/leaderboard/range/:period` | `period ∈ {day,week,month}`, `?endDate&deviceId` | Rolling window (1/7/30 days). Best score per device via `DISTINCT ON (device_id)`. Returns `{ list, total, rank, from, to, period }`. |
| `GET /api/contests/mine` | `?deviceId=...` | All contests the device has joined. Returns `{ ok, contests[] }` with rank, score, games, last-played per contest. |
| `POST /api/contests` | `{ name, hostName, deviceId, durationDays, boardType }` | Create a new contest (rate-limit 5/hour/device). Generates a 6-char code, seeds `host` into `contest_scores`. |
| `GET /api/contests/:code` | `?deviceId=...` | Contest details + leaderboard. Each player row now includes `liveScore`, `liveTier`, `liveUpdatedAt`, `watchers[]`, `hasWatchers` (filtered by `LIVE_FRESH_SECONDS = 10`). Sort key is `cs.score + liveScore` so mid-game players appear at their projected rank. |
| `POST /api/contests/:code/join` | `{ deviceId, displayName }` | Strict name-uniqueness check, then upsert into `contest_scores`. |
| `POST /api/contests/:code/score` | `{ deviceId, displayName, score, tier }` | Submit a finished game (rate-limit 60/hour). `score = contest_scores.score + EXCLUDED.score` — accumulates. Updates `games_played`, `last_played_at`. |
| `POST /api/contests/:code/live-score` | `{ deviceId, displayName, liveScore, tier }` | Heartbeat 1Hz from active player. Upserts `contest_live_state`. Returns `{ ok, hasWatchers, watcherCount }` so the client knows whether to also POST `/live-state`. Rate-limit 120/min. |
| `POST /api/contests/:code/live-state` | `{ deviceId, displayName, liveScore, tier, nextTier, gridJson }` | Same as `/live-score` + writes `grid_json`. Frontend only fires this when previous `/live-score` said `hasWatchers: true`. `gridJson` is a 24-cell array of integers 0-8. Rate-limit 120/min. |
| `GET /api/contests/:code/live-state/:targetDeviceId` | — | Spectator polls this at 1Hz. Returns 404 once `updated_at` is older than 10s (= "the game ended"). |
| `POST /api/contests/:code/watch` | `{ watcherDeviceId, watcherName, watcherLastScore, targetDeviceId }` | Upsert into `contest_watchers`. Acts as both "start" and 5s heartbeat. Rate-limit 60/min. |
| `POST /api/contests/:code/unwatch` | `{ watcherDeviceId, targetDeviceId }` | Best-effort immediate delete. TTL would handle it anyway in ≤10s. |
| `POST /api/ping` | `{ deviceId }` | Upserts today's `device_visits` row, increments `visit_count`. Rate-limit 30/hr. Called fire-and-forget on every page boot. |
| **Public Challenges** | | Single-shot prize contests |
| `GET /api/challenges` | `?deviceId` | Active challenges + my entry status. 30s frontend cache. |
| `GET /api/challenges/:slug` | `?deviceId` | One challenge + top-20 standings + my entry. |
| `POST /api/challenges/:slug/enter` | `{deviceId, displayName}` | PK violation → 409. Rate-limit 5/hr. |
| `POST /api/challenges/:slug/score` | `{deviceId, score, tier, drops}` | Heartbeat per drop. Race/first-to-tier check winner-slot under `SELECT FOR UPDATE`. Rate-limit 600/hr. |
| `POST /api/challenges/:slug/complete` | `{deviceId, score, tier, drops}` | Locks the entry → 'completed'. Sets cheat_flag if `challengeDropsImplausible` OR z-score>3. Beat-type assigns winner here. |
| `POST /api/challenges/:slug/claim` | `{deviceId, contactName, contactPhone, contactEmail}` | Winner-only contact form. Phone OR email required. |
| **Admin Challenges** | | All under `/<ADMIN_PATH>/api/`, Basic Auth |
| `GET /challenges` | — | All challenges + entries_count + winners_filled + cheat_count. |
| `POST /challenges` | full create body | Auto-generates slug from name if absent. Status 'draft' unless explicit. |
| `PATCH /challenges/:id` | partial | Lock-down: once entries_count>0 AND starts_at passed, only `name/description/prize_text/prize_image_url/rules_text/ends_at(extend only)/status` editable. |
| `DELETE /challenges/:id` | — | Cascade. |
| `GET /challenges/:id/entries` | — | Full leaderboard with contact info + cheat_flag. |
| `POST /challenges/:id/finalize` | — | Marks in_progress→abandoned, runs top_n winner assignment. |
| `PATCH /challenges/:id/entries/:device_id` | `{is_winner?, cheat_flag?, prize_claimed?}` | Manual override. |
| **Admin (gated by `requireAdmin` middleware — Basic Auth)** | | All under `/<ADMIN_PATH>/api/*` |
| `GET /<ADMIN_PATH>/api/dashboard` | — | KPIs (DAU/WAU/MAU/new/games/contests/D1) + 30-day sparkline + anomaly flag (if DAU < 70% of 7-day avg). |
| `GET /<ADMIN_PATH>/api/retention` | — | 8 weekly cohorts × D1/D7/D30. |
| `GET /<ADMIN_PATH>/api/funnel` | `?days=7` | visited / played / completed / returned-next-day buckets. |
| `GET /<ADMIN_PATH>/api/heatmap` | `?days=30` | 7×24 game-overs grid in Asia/Jerusalem TZ. |
| `GET /<ADMIN_PATH>/api/top-scores` | `?date=YYYY-MM-DD` | Top 50 daily scores with z-score + outlier flag (>3σ). |
| `GET /<ADMIN_PATH>/api/contests` | — | All contests + member counts + top score. |
| `PATCH /<ADMIN_PATH>/api/contest/:code` | `{ name?, endsAt?, status? }` | Edit contest fields. Writes `admin_actions` row. |
| `DELETE /<ADMIN_PATH>/api/contest/:code` | — | Cascade-delete contest. Writes `admin_actions` row. |
| `GET /<ADMIN_PATH>/api/players` | `?limit&offset&q` | Paginated player list. |
| `GET /<ADMIN_PATH>/api/player/:id` | — | Drill-down: scores + contests + visits. |
| `DELETE /<ADMIN_PATH>/api/player/:id` | — | Manual cascade across all tables (no FK to devices). Writes audit. |
| `GET /<ADMIN_PATH>/api/audit` | `?limit=100` | Recent `admin_actions` rows. |
| `GET /<ADMIN_PATH>/api/live` | — | Active games + spectators (fresh 30s). |
| `GET /<ADMIN_PATH>/api/export/:table.csv` | — | UTF-8 BOM CSV for `daily_scores`, `contests`, `contest_scores`, `device_visits`, `admin_actions`. |

Validation rules (`server.js`):
- `date` must match `^\d{4}-\d{2}-\d{2}$`
- `deviceId` 8–64 chars
- `score` / `liveScore` / `watcherLastScore` finite, 0–10,000,000
- `tier` integer 1–8 for `/score` (final), 0–8 for `/live-score` / `/live-state` (fresh boards allowed)
- `gridJson` must parse to an array of exactly 24 integers each in `0..8`
- `name` trimmed and sliced to 24 chars (50 for contest display names); empty → `אנונימי`
- JSON body limit: 4 KB

### Postgres

```sql
CREATE TABLE daily_scores (
  date TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, device_id)
);
CREATE INDEX idx_daily_scores_lookup ON daily_scores (date, score DESC);

-- Friends contests
CREATE TABLE contests (
  code VARCHAR(8) PRIMARY KEY,
  name, host_name, host_device_id, board_seed, board_type,
  duration_days, ends_at, status, created_at
);

CREATE TABLE contest_scores (
  contest_code FK, device_id, display_name,
  score INTEGER,         -- cumulative across games
  highest_tier, games_played, joined_at, last_played_at,
  UNIQUE (contest_code, device_id)
);

-- Ephemeral: stale rows are filtered out at read time (10s window), not by cron.
-- A best-effort DELETE for rows >1h old runs probabilistically inside POST /live-score.
CREATE TABLE contest_live_state (
  contest_code FK, device_id, display_name,
  live_score, highest_tier, next_tier, grid_json, updated_at,
  PRIMARY KEY (contest_code, device_id)
);

CREATE TABLE contest_watchers (
  contest_code FK, watcher_device_id, watcher_name,
  watcher_last_score, target_device_id, updated_at,
  PRIMARY KEY (contest_code, watcher_device_id, target_device_id)
);
```

`db.js` reads `schema.sql` and runs it on every boot — additions to the schema must remain idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.).

### External integrations

- **Railway** — hosting + Postgres plugin. Deploy via `railway up --service bloom-web --detach --ci`. `DATABASE_URL` is injected from `${{Postgres-z2RQ.DATABASE_URL}}`. The internal hostname only resolves inside Railway; for local DB work use `DATABASE_PUBLIC_URL`. Two extra env vars unlock the admin dashboard: `ADMIN_PATH` (random URL slug) and `ADMIN_PASSWORD` (long random string). If either is unset, the admin surface is disabled.
- **No Firebase** in the current build, despite older memory entries describing the stack as "Vanilla JS + Firebase" (that's from the SST project; BLOOM uses Postgres on Railway).
- **No AdMob / IAP / analytics SDKs** yet.

---

## 8. Coding style

- Vanilla ES2017+ JS in a single IIFE. `var`/`let`/`const` mixed (mostly `const`/`let`). Plain `function` declarations preferred over arrow functions for top-level helpers.
- Server uses ESM (`"type": "module"` in `package.json`).
- No comments except where the *why* is non-obvious.
- No new dependencies without explicit user approval. Frontend stays dep-free; backend's only deps are `express` and `pg`.
- All inline SVG is embedded as JS strings inside `TIERS[]` and the `SVG` icon map.
- RTL Hebrew is canonical for player-facing copy. Code/identifiers stay in English.
- Use `localStorage` for any state that must survive a page reload. Read-once at boot, write-through on change.
- Async UI sequences use `await sleep(ms)` — keep merge/gravity timing snappy (current cell-merge delay is ~220–280 ms).

---

## 9. Important decisions

- **Single-file frontend.** Do not split `public/index.html` into separate JS/CSS files. The user values "open file, see whole project."
- **No build step.** No bundler, no transpiler, no PostCSS, no Tailwind, no CDN libraries. If you need a polyfill, write it inline.
- **No frontend npm deps.** Backend deps are limited to `express` + `pg`.
- **No Firebase.** Despite older notes, the current backend is Postgres on Railway. Don't introduce Firebase unless the user explicitly asks.
- **One row per device per date.** Re-submissions only update if score improves. Don't change the primary key.
- **Best score wins.** The `WHERE daily_scores.score < EXCLUDED.score` guard in the upsert is intentional — don't replace it with a blind overwrite.
- **DeviceId is anonymous and client-generated.** No login flow. Treat any future auth work as a major design change requiring explicit user signoff.
- **Daily seed is Asia/Jerusalem time.** Do not switch to UTC or to user-local time without explicit approval — the leaderboard's fairness depends on every player getting the same daily seed.
- **Schema migrations must be idempotent** — `schema.sql` runs on every boot.
- **Retention beats revenue (for now).** Suggest features that drive return visits over monetization until the user signals otherwise.

---

## 10. What should NOT be changed

Treat the following as load-bearing. If a task seems to require touching any of them, surface the trade-off and ask before proceeding:

1. The single-file structure of `public/index.html`.
2. The 4×6 grid dimensions and 8-tier ladder.
3. The chain multiplier ladder (×1, ×1.5, ×2, ×2.5, ×3) — touching it would invalidate every recorded leaderboard entry. The tier-weighted score formula `tier × 10 × (1 + (tier-1)*0.3) × group_size × chain` IS tunable (it was rebalanced from the original linear `tier × 10 × group × chain` in the score-economy update — see §11) but the chain ladder is load-bearing.
4. The Asia/Jerusalem daily-seed contract.
5. `daily_scores` primary key (`date, device_id`) and the "score must improve" upsert guard.
6. The anonymous-only identity model.
7. The Hebrew RTL UI direction.
8. The inline SVG icon set and tier color palette (don't swap art casually).
9. The no-build, no-framework, no-CDN rule.
10. `idx_daily_scores_lookup` — leaderboard queries depend on it.

---

## 11. Current progress

- **v1 core gameplay** — shipped.
- **v2 daily challenge + Postgres leaderboard** — shipped (single-day API + day/week/month modal).
- **v3 sound + mute** — shipped (Web Audio synth only; no MP3 music in current build).
- **v3a layout polish** — recent commits (`4236be2`, `1c3565a`) fixed scrollable game-over, modal layering above the viewport, and score-area clipping.
- **Auto-play bot (dev-only)** — `public/bot.js`, loaded inertly from `index.html` and gated by `?bot=1` (auto-start) or `?botui` (panel only). Talks to the game via `window.BloomDebug` (exposed at the tail of the IIFE: `ready/getGrid/getCurrentPiece/getScore/getHighestTier/isGameOver/isBusy/drop/restart`). No effect on normal users; used for testing and recording.
- **Tier-ladder next-piece indicator** — replaced the single-tile `הבא:` preview with a horizontal row of all 8 tier icons (rock → crown) plus per-tile merge-points beneath each. The currently-chosen piece is scaled up with a colored glow ring; its score un-fades to the tile color. After each drop a silent ~500 ms left-to-right cycle across tiers 1-4 settles on the chosen piece (teaching device, no audio). Helpers: `buildTierBar`, `highlightNextTier`, `revealNextTier`, `rollNextPiece`.
- **Admin dashboard + visit tracking + demo seeder** — single-file `admin/index.html` (vanilla, no build), gated by `ADMIN_PATH` (URL slug) + `ADMIN_PASSWORD` (Basic Auth). New routes under `/<ADMIN_PATH>/api/*` for dashboard / retention / funnel / heatmap / top-scores / contests / players / audit / live / CSV export. New tables `device_visits` (fed by `/api/ping`) and `admin_actions` (audit log). `scripts/seed_demo.js` fakes 30 players × 30 days × 5 contests, scoped to `demo-%` device IDs. **Outside-the-box choices**: KPI cards compare against 2026 hybrid-casual benchmarks (D1≥40%, D7≥20%, D30≥7%); top-scores carry a z-score column and an `⚠ OUTLIER` flag for scores >3σ above the daily mean (statistical anti-cheat MVP); time-of-day heatmap in Asia/Jerusalem TZ; CSV exports include UTF-8 BOM for Excel + Hebrew; admin URL is intentionally hidden (no `/admin` route) so password-spray attacks don't even reach the auth check.
- **Score economy rebalance** — `pointsFor()` switched from linear `tier × 10 × group × chain` to **exponential** `tier × 10 × (1 + (tier-1)*0.3) × group × chain`. Per-merge values: tier 1=20, tier 4=152, tier 5=220, tier 8=496 (~3× higher at the top). Added **first-time-tier-up bonuses** keyed by `TIER_UP_BONUS = {5:500, 6:1500, 7:5000, 8:15000}`, tracked per-game via `tierUpHit = {}` (reset in `init()`). New helper `showMilestoneBanner(tier, points)` renders a gold-on-black celebration card (1.5s) with `soundMilestone()` + buzz. The chain ladder (×1, ×1.5, ×2, ×2.5, ×3) is **untouched** — leaderboards stay valid. Server-side `challengeDropsImplausible()` recalibrated to match new scoring (100K/25, 200K/50, 500K/100, 1.5M/200, 3M/350). **Architectural prep for the App launch** added in the same diff: `getActiveTiers()` wraps the `TIERS` constant (17 callsites migrated) so future skin packs swap palettes via this single getter; `getBoardRows()`/`getBoardCols()` wrap board dimensions (originally `const ROWS=6, COLS=4`) so future "Pro mode" 5/6-column boards swap dimensions via these getters. Both abstractions are pure refactors today — no behavior change.
- **Live contest + spectator mode** — added 5 new endpoints + 2 ephemeral tables. Active player heartbeats `/live-score` at 1Hz; server tells them whether anyone is watching, and only when watched do they POST grid frames to `/live-state`. Spectators poll `/live-state/:targetDeviceId` every 1s and heartbeat `/watch` every 5s. Stale rows filtered at read time by a 10s `updated_at` window. The contest leaderboard sort key is `accumulated + live` so a mid-game player visibly climbs the table in real time. Frontend touchpoints: live push (`pushLiveScore`, `pushLiveState`, `scheduleLiveScorePush`), audience badge (`renderAudienceBadge`), spectator (`openSpectatorPicker`, `startSpectator`, `spectatorTick`, `renderSpectatorView`). "צא לצפייה במשחקים חיים" button appears on the game-over modal only in contest mode. Also fixed: "שחק שוב" in contest game-over now correctly restarts in contest (previously it kicked back to practice). New localStorage key: `bloom_contest_last_final_<code>` — used as the score shown to the player you're watching ("your watcher's last score").

Live URL: https://bloom-web-production-f3bd.up.railway.app
GitHub: https://github.com/shlomixxx/bloom-game (private)
Railway project: `bloom-game` / service `bloom-web` / Postgres `Postgres-z2RQ`.

---

## 12. Future plans (priority order)

1. **Daily streak counter** + lightweight return-day nudge.
2. **Onboarding tutorial** — redo of the rolled-back version, leaner. Target: a new player gets it in 60–90 seconds.
3. **Rewarded video ads** via AdMob — "watch 15s for a hint piece" / "continue after game-over" / "double score." Requires AdMob account + an app-store presence to fully monetize.
4. **Light IAP** — $4.99 remove-ads + bonus daily runs, $1.99 cosmetic skin packs (skin packs = swapping the 8 SVGs only, same engine).
5. **Capacitor wrap** — iOS / Android stores. Only after retention proves out.
6. **HMAC-signed score submission** — current anti-cheat is just `deviceId` (spoofable). Add server-side HMAC once traffic justifies it.
7. **Sound asset polish** — optional voice cues (Wow / Amazing) via freesound.org or ElevenLabs.

Validation gates (don't skip): each step ships only after the previous one's success metric is met. The user has resisted leapfrogging.

---

## 13. Known issues / debt

- **Fixed bug (state-bleed across contests)**: when switching contests via "↕ החלפת תחרות", `activeContestCode` changed before the in-memory `grid`/`score` were reset. Any `saveContestGameState()` call between that switch and `init('contest')` for the new contest wrote the previous contest's grid into the new contest's `bloom_contest_state_<code>` slot. Fix: track `activeGameContestCode` separately — `saveContestGameState()` writes to the contest the in-memory game *belongs to*, not whichever `activeContestCode` currently is. `activeGameContestCode` is set inside `init('contest')` after load and cleared on game-over and on entering non-contest modes.
- `ROADMAP_1.md` is stale (describes home screen + tutorial + MP3 music as shipped — they were rolled back).
- One-per-day gating is client-only (`localStorage`). A determined player can wipe storage and re-submit; the "score must improve" upsert guard limits abuse but doesn't prevent it.
- `deviceId` is spoofable — no HMAC on score submission yet.
- No rate limiting on the API.
- `WEIGHTS = [0, 55, 28, 12, 5]` means only tiers 1–4 ever spawn naturally. Higher tiers exist only via merging. This is intentional but worth keeping in mind if rebalancing.
- `pg` `ssl: { rejectUnauthorized: false }` is the default — fine for Railway's managed Postgres, would need rethinking for a different host.
- No tests. There is no test framework configured. If introducing tests, ask first about which framework — the user values "no build step" and tests typically violate that.

---

## 14. Local dev

```bash
npm install
export DATABASE_URL="postgres://..."
export PGSSL="false"     # only if your local Postgres has no SSL
npm start                # http://localhost:3000
```

For pure-frontend work, opening `public/index.html` directly in a browser works — only the leaderboard fetches will fail.

For DB inspection from a laptop, use `DATABASE_PUBLIC_URL` from the Railway Postgres variables panel (the internal `DATABASE_URL` only resolves inside Railway).

---

## 15. Deploy

```bash
railway up --service bloom-web --detach --ci
```

`schema.sql` is re-applied on every boot via `initDb()`, so deploys are idempotent. The Railway CLI is logged in as `shlomibusiness@gmail.com`.

Do not deploy without the user's go-ahead — production is live and shared with playtesters.

---

## <a id="living-docs-rule"></a>16. Living-docs rule (very important)

**Whenever the project changes — feature added, file added/renamed/removed, API changed, dep changed, architectural decision made, or roadmap status changed — update BOTH `README.md` and `CLAUDE.md` in the same change.** Don't wait to be asked.

Why: the user wants every future session to start fully primed from these two docs, so we don't burn time/credits/context re-summarizing the project. If either doc drifts from the code, the contract breaks and the next session pays for it.

How to apply:
- Treat doc updates as part of the diff, not a follow-up.
- For small bug fixes that don't shift surface area, a single line in §11 (Current progress) or §13 (Known issues) is enough.
- For feature work or API/schema changes, also reconcile §3, §4, §5, §7, §10, and §12 as needed.
- If `ROADMAP_1.md` ever needs to come back into sync, update it too — but until then, leave the "stale" warning in §6 in place.
