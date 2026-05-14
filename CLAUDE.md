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
├── server.js           # Express app + 4 routes + bootstrap
├── db.js               # pg.Pool, initDb()
├── schema.sql          # daily_scores table + idx_daily_scores_lookup
├── package.json        # type:module, deps: express + pg
├── README.md           # human-facing
├── CLAUDE.md           # this file
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

Validation rules (`server.js`):
- `date` must match `^\d{4}-\d{2}-\d{2}$`
- `deviceId` 8–64 chars
- `score` finite, 0–10,000,000
- `tier` integer 1–8
- `name` trimmed and sliced to 24 chars; empty → `אנונימי`
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
```

`db.js` reads `schema.sql` and runs it on every boot — additions to the schema must remain idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.).

### External integrations

- **Railway** — hosting + Postgres plugin. Deploy via `railway up --service bloom-web --detach --ci`. `DATABASE_URL` is injected from `${{Postgres-z2RQ.DATABASE_URL}}`. The internal hostname only resolves inside Railway; for local DB work use `DATABASE_PUBLIC_URL`.
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
3. The scoring formula `tier × 10 × group_size × chain_multiplier` and the multiplier ladder.
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
