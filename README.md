# BLOOM — Mobile Merge Game

A Suika-style merge game built as a mobile-first web app. Single HTML file, no build step, no dependencies.

## Project goal

Build a viral, monetizable casual game that a solo developer can launch with minimal budget. The strategy is to launch on the web first, validate user retention organically, then port to App Store and Google Play.

## Game mechanics

- 4×6 grid. Tap a column to drop the "next" piece into the lowest empty cell.
- Adjacent identical pieces (horizontally or vertically) automatically merge into the next tier.
- Merges trigger gravity, which can trigger more merges → chain reactions.
- 8 tiers in total: Stone → Leaf → Flower → Flame → Bolt → Star → Diamond → Crown.
- Game ends when the top row fills completely.

## Scoring

`points = tier × 10 × group_size × chain_multiplier`

Chain multipliers:
- 1st merge in a drop: ×1
- 2nd merge in chain: ×1.5
- 3rd merge: ×2
- 4th: ×2.5
- 5th+: ×3

Floating "+X" badges appear on each merge to give the player immediate feedback.
A "שרשרת ×N" chain badge appears in the centre of the board for chain reactions of 2+.

## Visual identity

- Palette: muted parchment cream background (#F5F5F0) with vibrant tier colours.
- Each tier has its own distinct colour from the Tabler ramp family.
- Icons are inlined SVG (no external font dependency).
- Typography: system sans (Apple system / Segoe / Helvetica).
- Direction: RTL, Hebrew UI.

## Tech stack

- Frontend: single `public/index.html`. Vanilla JS, one IIFE, no build, no framework.
- Backend: Node 18+ / Express, single `server.js`. Serves the static frontend and a small JSON API.
- Database: Postgres via `pg`. Schema in `schema.sql`, applied on boot.
- Hosting: Railway (frontend + backend + Postgres in one project).
- `localStorage` for personal best score, daily-played state, deviceId, and player name.
- `navigator.share` API for Web Share, with clipboard fallback.
- All SVG icons embedded inline as strings.

## Project structure

```
bloom-game/
├── public/index.html    ← the game (frontend)
├── server.js             ← Express server: static + /api/*
├── db.js                 ← Postgres pool + schema bootstrap
├── schema.sql            ← daily_scores table
├── package.json
└── README.md
```

## API

- `POST /api/score` — body `{ date, deviceId, name, score, tier }`. Upserts the player's best score for the given date. Returns `{ ok, rank }`.
- `GET /api/leaderboard/:date?deviceId=...` — returns `{ list (top 50), total, rank }`.
- `GET /api/health` — liveness check.

The deviceId is a UUID generated client-side on first visit and persisted in `localStorage`. One row per deviceId per date.

## Current status

**v1 — core gameplay (done):**
- Full merge logic with BFS group detection and gravity
- Chain reaction processing with multiplier scoring
- Floating score feedback on every merge
- Score "bump" animation on changes
- Chain badge for 2+ merges
- Game-over screen with tier table showing point values
- Share result with emoji grid (Wordle-style)
- Personal best persisted across sessions
- Info button explaining the scoring system

**v2 — daily challenge + leaderboard (done):**
- Daily seed mode: deterministic mulberry32 RNG keyed by date (Asia/Jerusalem)
- One run per day per device; second visit shows the prior result + countdown
- Practice mode: random seed, unlimited replays, no leaderboard submit
- Global leaderboard on Postgres via Express API
- Anonymous deviceId tracking (no signup)
- One-time player-name prompt
- Share text includes the daily date and player rank

## Roadmap (NOT yet built)

When the user wants to extend the game, these are the planned features in priority order:

1. **Rewarded video ads** — "watch 15s for a hint piece" via AdMob or similar.
2. **Light IAP** — $4.99 "remove ads + 2 daily extra games"; $1.99 cosmetic skin packs.
3. **Onboarding tutorial** — 30-second guided first-game.
4. **Sound effects** — drop, merge, chain — each with a satisfying audio cue.
5. **Particle effects** — small confetti burst when reaching the Crown for the first time.
6. **Capacitor wrap** — port to iOS and Android app stores once retention is proven.
7. **Better anti-cheat** — currently deviceId only (spoofable). Add HMAC-signed score submission once we have meaningful traffic.

## Important context

- The developer is Israeli, comfortable in Hebrew, builds in Vanilla JS + Firebase (his existing stack from SST/BarberBot project).
- The developer is a lawyer and entrepreneur, not a senior game designer. Keep explanations clear and grounded, with practical economic reasoning.
- The launch strategy is **web first** — no app store on day one. Validate viral mechanics with friends and Twitter/Reddit before investing in store assets.
- The success metric for v1 is **retention**, not revenue. Target: 40% of first-time players play a second time.

## How to run locally

```bash
npm install
# Start Postgres locally OR point at a remote one:
export DATABASE_URL="postgres://user:pass@host:5432/bloom"
export PGSSL="false"   # only when the local Postgres has no SSL
npm start              # listens on http://localhost:3000
```

The frontend can also be opened standalone from `public/index.html` for pure-gameplay testing — the leaderboard simply won't load.

## How to deploy

The app is hosted on Railway. From the project root:

```bash
railway login           # one time
railway link            # connect to the bloom-game Railway project
railway up              # build & deploy from the local directory
```

Railway injects `DATABASE_URL` (Postgres plugin) and `PORT` automatically. The schema in `schema.sql` runs on every boot via `initDb()`, so deploys are idempotent.
