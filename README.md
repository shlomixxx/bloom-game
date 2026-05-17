# BLOOM — Mobile Merge Game

A Suika-style merge puzzle built as a mobile-first web app. Vanilla JS frontend, tiny Express backend, Postgres on Railway. Hebrew RTL interface.

Live: https://bloom-web-production-f3bd.up.railway.app
GitHub: https://github.com/shlomixxx/bloom-game

---

## Project goal

Ship a viral, monetizable casual game that a solo developer can launch on a small budget. Strategy: web first → validate retention → port to App Store / Google Play via Capacitor.

The success metric for v1 is **retention**, not revenue. Target: ≥40% of first-time players return for a second session.

---

## Game mechanics

- 4 columns × 6 rows. Tap a column to drop the "next" piece into the lowest empty cell.
- Adjacent same-tier pieces (horizontally or vertically) merge into the next tier.
- Merges trigger gravity, which can trigger more merges → chain reactions.
- 8 tiers: **Stone → Leaf → Flower → Flame → Bolt → Star → Diamond → Crown**.
- Game ends when the top row fills.

### Scoring

```
points = tier × 10 × (1 + (tier - 1) × 0.3) × group_size × chain_multiplier
```

The `(1 + (tier-1) × 0.3)` factor weights higher tiers more heavily — a Crown (tier 8) merge is worth ~3.1× a flat formula, so the late-game grind pays off. Per-merge values: tier 1 = 20, tier 4 = 152, tier 8 = 496.

Chain multiplier per drop: 1st merge ×1, 2nd ×1.5, 3rd ×2, 4th ×2.5, 5th+ ×3.

**First-time-tier-up bonus** (per game): the FIRST time the player's `highestTier` reaches each milestone in a game, an extra bonus fires alongside a celebration banner:
- ⚡ Bolt (tier 5): **+500**
- ⭐ Star (tier 6): **+1,500**
- 💎 Diamond (tier 7): **+5,000**
- 👑 Crown (tier 8): **+15,000**

A full Crown achievement scores **~62K** under this system (vs ~15K under the previous flat formula), turning the late game into a celebration.

Visual feedback: floating `+X` badge on every merge, "שרשרת ×N" banner for chains of 2+, gold milestone banner for tier-up bonuses, animated bump on score updates.

---

## Modes

- **Daily challenge (default)** — deterministic seed derived from the Israel-timezone date (`mulberry32` hash of `YYYY-MM-DD`). All players get the same piece sequence. One run per device per day. Score is submitted to the global leaderboard.
- **Practice (free play)** — random seed, unlimited replays, no leaderboard submission.
- **Friends contest** — invite-code contests (1–30 days). Scores accumulate across games for each device, leaderboard ranks all participants. Each contest has a shared or free board seed.
- **BLOOM Challenges** — public single-shot prize contests created by the admin. **One attempt per device. No reset, no pause, no replay.** Four types: Race-to-Threshold ("first N to reach X"), Top-N Leaderboard, Beat-the-Target, First-to-Tier. Score posts to the server on every drop — closing the tab finalizes the score as-is. Winners fill an in-game contact form (name/phone/email); the admin reaches out manually to deliver the prize.

The daily run is gated by `localStorage`; on a second visit the same day, the player sees their result and a countdown to midnight Asia/Jerusalem.

---

## Features (currently shipped)

- Full merge engine with BFS group detection, gravity, and chained scoring
- Floating `+points` and "שרשרת ×N" feedback
- Personal best score in `localStorage`
- Game-over screen with full tier table, stats summary, and share card
- Wordle-style emoji share (uses `navigator.share` with clipboard fallback)
- **WhatsApp share** — direct share button in game-over + home screen
- One-time anonymous player-name prompt (persisted)
- Anonymous `deviceId` (UUID, persisted) — one row per device per day
- **Daily leaderboard** — top 50 with player highlight + absolute rank
- **Public leaderboard modal** with `day / week / month` tabs
- **Friends contest** with live in-game score updates + real-time spectator mode
- **BLOOM Challenges** — public single-shot prize contests (4 types)
- **Interactive tutorial** — 8-step tour with animated illustrations
- **Onboarding coach** — gentle in-game toasts for new players
- **Achievements system** — tier, chain, score, streak, and general achievements
- **6 skin packs** — classic, neon, ocean, galaxy, candy, zen (with try-before-buy trial mode)
- **Tile shop** — buy power-ups with BLOOM credits (💎)
- **Credits/wallet system** — BLOOM-XXXX codes, referral credits, daily bonuses
- **1v1 duels** — head-to-head matches with wagers. Challenge by typing only the 4-char BLOOM suffix (the `BLOOM-` prefix is built in), pasting a full code, or tapping the ⚔️ button on any leaderboard row. Your own code is one tap away to copy at the top of the duel modal.
- **Daily jackpot** — auto-settled at midnight Israel time
- **XP leveling** — 11 levels with progression
- **Server-side bots** — 200 Israeli names, 3 modes, 4 speeds, admin-controlled
- **Admin dashboard** — DAU/WAU/MAU, retention cohorts, funnel, heatmap, live view, bot controls, audit log
- **Dark mode** — full (253 CSS rules), auto-detects system preference
- **PWA** — installable, service worker, offline shell
- **Viral features (v1.2)** — streak hero badge, addiction badge with share, WhatsApp invite flow, mini-leaderboard, enhanced share card with game time + chain + addiction

## NOT currently in the build

The repository's older `ROADMAP_1.md` describes a welcome splash, an interactive tutorial, and background MP3 music. **Those were rolled back** in commit `4fb5972` ("Roll back to initial daily-challenge game, layered with sound system"). Treat `ROADMAP_1.md` as a historical design doc, not a description of the current state.

---

## Tech stack

- **Frontend**: `public/index.html` (HTML shell, ~120 lines) + `public/styles.css` (CSS) + `public/app.js` (JS IIFE). Vanilla JS, RTL Hebrew UI, no framework, no CDN. SVG icons inlined as strings. Source files in `src/` (13 JS files) and `public/css/` (5 CSS files), concatenated by `build.sh`.
- **Backend**: `server.js` — Node 18+, Express. Serves the static frontend and a JSON API. `bot-engine.js` — server-side bots (200 Israeli names, 3 modes, 4 speeds).
- **Database**: Postgres via `pg`. Schema in `schema.sql` (16 tables), applied on every boot by `initDb()` (idempotent).
- **Persistence**: `localStorage` for best score, mute, deviceId, player name, skins, streak, achievements, and the daily-played gate.
- **Hosting**: Railway — `bloom-web` service + `Postgres-z2RQ` plugin. Auto-deploy from GitHub.

---

## Project structure

```
bloom-game/
├── public/
│   ├── index.html      # HTML shell (~120 lines)
│   ├── styles.css      # All CSS — GENERATED by build.sh
│   ├── app.js          # All JS (single IIFE) — GENERATED by build.sh
│   ├── css/            # CSS source files (5 files)
│   ├── bot.js          # Dev-only auto-play bot
│   ├── sw.js           # Service worker
│   ├── manifest.json   # PWA manifest
│   └── assets/         # Icons, favicons, social-share.png
├── src/                # JS source files (13 files) — see src/README.md
├── admin/index.html    # Admin dashboard (single-file, RTL Hebrew)
├── server.js           # Express server + API routes
├── bot-engine.js       # Server-side bots (200 names, 3 modes)
├── db.js               # Postgres pool + schema bootstrap
├── schema.sql          # All tables (16, idempotent)
├── build.sh            # Concatenate src/*.js → app.js, css/*.css → styles.css
├── package.json        # deps: express + pg only
├── README.md           # This file
├── CLAUDE.md           # AI-agent context
└── src/README.md       # Source file map
```

### Build

```bash
./build.sh              # Concatenate source → public/app.js + public/styles.css
./build.sh --watch      # Auto-rebuild on change (requires fswatch)
```

Edit `src/*.js` and `public/css/*.css`, then run `build.sh`. Don't edit `public/app.js` or `public/styles.css` directly.

---

## API

All endpoints are JSON. Bodies are limited to 4 KB.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | `{ ok: true }` |
| `POST` | `/api/score` | `{ date, deviceId, name, score, tier }` | `{ ok, rank }` — upserts only if new score is higher than stored |
| `GET` | `/api/leaderboard/:date` | `?deviceId=...` | `{ list (top 50), total, rank }` — single-day board |
| `GET` | `/api/leaderboard/range/:period` | `period ∈ {day,week,month}`, `?endDate=YYYY-MM-DD&deviceId=...` | `{ list, total, rank, from, to, period }` — best-per-device over rolling window |
| `POST` | `/api/ping` | `{ deviceId }` | Records today's visit in `device_visits` (upsert; increments `visit_count`). Fire-and-forget on page load. Rate-limited 30/hr/device. |
| `GET` | `/api/contests/mine` | `?deviceId=...` | List of contests the device is in |
| `POST` | `/api/contests` | `{ name, hostName, deviceId, durationDays, boardType }` | Create new contest |
| `GET` | `/api/contests/:code` | `?deviceId=...` | Contest details + leaderboard (includes `liveScore`, `liveTier`, `watchers`, `hasWatchers` per player) |
| `POST` | `/api/contests/:code/join` | `{ deviceId, displayName }` | Join a contest |
| `POST` | `/api/contests/:code/score` | `{ deviceId, displayName, score, tier }` | Submit a finished game's score (accumulates) |
| `POST` | `/api/contests/:code/live-score` | `{ deviceId, displayName, liveScore, tier }` | Heartbeat (1Hz) of the player's current in-progress score. Response includes `hasWatchers` so the client only sends grid frames when someone is actually watching. |
| `POST` | `/api/contests/:code/live-state` | `{ deviceId, displayName, liveScore, tier, nextTier, gridJson }` | Push a full grid frame for spectators. Only sent when `/live-score` last returned `hasWatchers: true`. |
| `GET` | `/api/contests/:code/live-state/:targetDeviceId` | — | Latest in-progress snapshot of the watched player (404 once stale ≥10s). |
| `POST` | `/api/contests/:code/watch` | `{ watcherDeviceId, watcherName, watcherLastScore, targetDeviceId }` | Start/heartbeat a spectator session. Called every 5s while watching. |
| `POST` | `/api/contests/:code/unwatch` | `{ watcherDeviceId, targetDeviceId }` | End a spectator session immediately. |
| `GET` | `/api/challenges` | `?deviceId=...` | Active public prize challenges with my entry status (if any). |
| `GET` | `/api/challenges/:slug` | `?deviceId=...` | Single challenge + top-20 standings + my entry. |
| `POST` | `/api/challenges/:slug/enter` | `{ deviceId, displayName }` | Single-attempt enrollment. 409 if already entered. |
| `POST` | `/api/challenges/:slug/score` | `{ deviceId, score, tier, drops }` | Per-drop heartbeat. Server enforces score-only-grows + winner-slot assignment for race / first-to-tier. |
| `POST` | `/api/challenges/:slug/complete` | `{ deviceId, score, tier, drops }` | Final submit (locks the entry). Runs cheat-flag sanity check + assigns winner for `beat`-type. |
| `POST` | `/api/challenges/:slug/claim` | `{ deviceId, contactName, contactPhone, contactEmail }` | Winner-only: submit contact info for prize delivery. |

Validation: `date` matches `YYYY-MM-DD`, `deviceId` is 8–64 chars, `score` is 0–10,000,000, `tier` is 1–8 (live endpoints also allow `tier=0`). The name is trimmed to 24 chars and falls back to `אנונימי`. `gridJson` must be a 24-cell array with each entry an integer 0–8.

### Database schema

```sql
daily_scores (
  date TEXT, device_id TEXT, name TEXT,
  score INTEGER, tier INTEGER,
  created_at, updated_at,
  PRIMARY KEY (date, device_id)
)
INDEX idx_daily_scores_lookup ON (date, score DESC)

contests (code PK, name, host_name, host_device_id, board_seed,
          board_type, duration_days, ends_at, status, ...)

contest_scores (contest_code FK, device_id, display_name,
                score, highest_tier, games_played,
                joined_at, last_played_at,
                UNIQUE (contest_code, device_id))

-- ephemeral: filtered out of reads after LIVE_FRESH_SECONDS (10s)
contest_live_state (contest_code, device_id, display_name,
                    live_score, highest_tier, next_tier,
                    grid_json, updated_at,
                    PRIMARY KEY (contest_code, device_id))

contest_watchers (contest_code, watcher_device_id, watcher_name,
                  watcher_last_score, target_device_id, updated_at,
                  PRIMARY KEY (contest_code, watcher_device_id, target_device_id))
```

One row per device per date for `daily_scores`. Re-submissions only overwrite if `new.score > old.score`. Contest scores accumulate. `contest_live_state` + `contest_watchers` are ephemeral — TTL is enforced by filtering on `updated_at` at read time, not by a cleanup cron.

---

## Admin

The admin dashboard is gated behind **two** independent secrets:

1. **`ADMIN_PATH`** — a random URL slug you pick (e.g. `bloom-ops-k7Pq9X2v`). The full admin URL becomes `<host>/<ADMIN_PATH>/`. If unset, the entire admin surface is disabled (returns 503 / static handler 404). The slug never appears in client code or `robots.txt`.
2. **`ADMIN_PASSWORD`** — a long random string. HTTP Basic Auth — any username + this password.

Set both env vars in Railway (Variables tab) and redeploy. The admin URL is then `https://bloom-web-production-f3bd.up.railway.app/<your-slug>/`.

Locally:

```bash
export ADMIN_PATH="bloom-ops-$(openssl rand -hex 4)"
export ADMIN_PASSWORD="$(openssl rand -base64 18)"
npm start
echo "open http://localhost:3000/$ADMIN_PATH/"
```

The dashboard is **read-only by default** plus a few destructive actions (delete contest, delete player). Every destructive action is logged to `admin_actions` and shown in the audit log section.

### Demo data

```bash
npm run seed:demo    # 30 players, 30 days, 5 contests (default)
npm run seed:reset   # wipe + re-seed
npm run seed:clean   # wipe demo-* rows only

node scripts/seed_demo.js --players 50 --days 60 --contests 8
node scripts/seed_demo.js --force   # bypass "looks like prod" guard
```

Demo data is scoped: device IDs prefixed `demo-`, contest codes prefixed `D…DEMO`. Cleanup is exact (`WHERE device_id LIKE 'demo-%'`). The seeder refuses to run against a DB with >1000 non-demo rows in `daily_scores` unless you pass `--force`.

---

## Run locally

```bash
npm install

export DATABASE_URL="postgres://user:pass@host:5432/bloom"
export PGSSL="false"   # only when the local Postgres has no SSL
npm start              # listens on http://localhost:3000
```

The frontend also opens standalone from `public/index.html` — gameplay works, leaderboard requests will simply fail.

---

## Deploy

Railway. From the project root:

```bash
railway login            # one time
railway link             # one time — connect to the bloom-game project
railway up --service bloom-web --detach --ci
```

Railway injects `DATABASE_URL` and `PORT` automatically. Schema is re-applied idempotently on each boot.

---

## Roadmap (planned, not built)

In priority order:

1. **Domain** — bloom-game.co.il
2. **Landing page + SEO** — public-facing marketing page
3. **Google Analytics / Mixpanel** — event tracking
4. **App Store listing** (PWA)
5. **Push notification reminders** ("חזור לאתגר היומי!")
6. **First-day-back bonus** ("חזור מחר ל-500 נקודות בונוס")
7. **Weekly auto-challenge** — automatic weekly contest
8. **Player profile page** — public page with stats
9. **Monetization** — ads / premium themes

---

## Conventions

- Source files live in `src/` (JS) and `public/css/` (CSS). Build with `./build.sh`.
- No npm frontend dependencies, no CDN.
- RTL Hebrew is the canonical UI direction.
- Every state mutation that survives a refresh must hit `localStorage`.
- See [CLAUDE.md](CLAUDE.md) for the full agent contract — architecture, what NOT to change, known issues, and current progress.
