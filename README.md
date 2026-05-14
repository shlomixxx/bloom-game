# BLOOM — Mobile Merge Game

A Suika-style merge puzzle built as a mobile-first web app. Single HTML frontend, tiny Express backend, no build step.

Live: https://bloom-web-production-f3bd.up.railway.app

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
points = tier × 10 × group_size × chain_multiplier
```

Chain multiplier per drop: 1st merge ×1, 2nd ×1.5, 3rd ×2, 4th ×2.5, 5th+ ×3.

Visual feedback: floating `+X` badge on every merge, "שרשרת ×N" banner for chains of 2+, animated bump on score updates.

---

## Modes

- **Daily challenge (default)** — deterministic seed derived from the Israel-timezone date (`mulberry32` hash of `YYYY-MM-DD`). All players get the same piece sequence. One run per device per day. Score is submitted to the global leaderboard.
- **Practice (free play)** — random seed, unlimited replays, no leaderboard submission.

The daily run is gated by `localStorage`; on a second visit the same day, the player sees their result and a countdown to midnight Asia/Jerusalem.

---

## Features (currently shipped)

- Full merge engine with BFS group detection, gravity, and chained scoring
- Floating `+points` and "שרשרת ×N" feedback
- Personal best score in `localStorage`
- Game-over screen with full tier table and point values
- Wordle-style emoji share (uses `navigator.share` with clipboard fallback)
- One-time anonymous player-name prompt (persisted)
- Anonymous `deviceId` (UUID, persisted) — one row per device per day
- **Daily leaderboard** — top 50 for today's date, with the player's row highlighted and absolute rank
- **Public leaderboard modal** with `day / week / month` tabs (rolling 1 / 7 / 30 day windows)
- Mute button (sounds + music, persisted)
- Web Audio synth: drop, merge (pitch rises with tier), chain, milestone, game-over
- Info modal explaining the scoring formula and tier table

## NOT currently in the build

The repository's older `ROADMAP_1.md` describes a welcome splash, an interactive tutorial, and background MP3 music. **Those were rolled back** in commit `4fb5972` ("Roll back to initial daily-challenge game, layered with sound system"). Treat `ROADMAP_1.md` as a historical design doc, not a description of the current state.

---

## Tech stack

- **Frontend**: one `public/index.html` (~1.1k lines). Vanilla JS in a single IIFE. RTL Hebrew UI. No build, no framework, no CDN. SVG icons inlined as strings.
- **Backend**: `server.js` — Node 18+, Express, ~165 lines. Serves the static frontend and a small JSON API.
- **Database**: Postgres via `pg`. Schema in `schema.sql`, applied on every boot by `initDb()` (idempotent `CREATE TABLE IF NOT EXISTS`).
- **Persistence**: `localStorage` for best score, mute, deviceId, player name, and the daily-played gate.
- **Hosting**: Railway — `bloom-web` service + `Postgres-z2RQ` plugin in one project.

---

## Project structure

```
bloom-game/
├── public/
│   └── index.html      # the entire game — HTML + CSS + JS in one file
├── server.js           # Express server: static + /api/*
├── db.js               # Postgres pool + schema bootstrap
├── schema.sql          # daily_scores table + index
├── package.json
├── README.md           # this file (human-facing)
├── CLAUDE.md           # AI-agent context for future sessions
└── ROADMAP_1.md        # historical design doc (NOT current state)
```

---

## API

All endpoints are JSON. Bodies are limited to 4 KB.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | `{ ok: true }` |
| `POST` | `/api/score` | `{ date, deviceId, name, score, tier }` | `{ ok, rank }` — upserts only if new score is higher than stored |
| `GET` | `/api/leaderboard/:date` | `?deviceId=...` | `{ list (top 50), total, rank }` — single-day board |
| `GET` | `/api/leaderboard/range/:period` | `period ∈ {day,week,month}`, `?endDate=YYYY-MM-DD&deviceId=...` | `{ list, total, rank, from, to, period }` — best-per-device over rolling window |

Validation: `date` matches `YYYY-MM-DD`, `deviceId` is 8–64 chars, `score` is 0–10,000,000, `tier` is 1–8. The name is trimmed to 24 chars and falls back to `אנונימי`.

### Database schema

```sql
daily_scores (
  date TEXT, device_id TEXT, name TEXT,
  score INTEGER, tier INTEGER,
  created_at, updated_at,
  PRIMARY KEY (date, device_id)
)
INDEX idx_daily_scores_lookup ON (date, score DESC)
```

One row per device per date. Re-submissions only overwrite if `new.score > old.score`.

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

1. **Daily streak counter** + return-day prompts
2. **Onboarding tutorial** (was previously built, then rolled back — to be redone leaner)
3. **Rewarded video ads** ("watch 15s for a hint piece") via AdMob
4. **Light IAP** — "$4.99 remove ads + bonus daily runs", $1.99 cosmetic skin packs
5. **Capacitor wrap** — iOS / Android app stores (only after retention is proven)
6. **HMAC-signed score submission** — anti-cheat hardening once traffic is meaningful

---

## Conventions

- Single HTML file. Do not split into separate JS / CSS files.
- No npm frontend dependencies, no CDN, no build step.
- RTL Hebrew is the canonical UI direction.
- Every state mutation that survives a refresh must hit `localStorage`.
- See [CLAUDE.md](CLAUDE.md) for the full agent contract — architecture, what NOT to change, known issues, and current progress.
