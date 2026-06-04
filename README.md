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
- **Emotional game-over screen** (UX audit §1.3) — rank pill ("#23 מתוך 847"), best-score delta ("+2,300 שיא חדש" / "החמצת ב-180"), gap-to-next-tier ("עוד 200 נקודות והיית ב-TOP 20"), prominent breathing "שחק שוב" CTA, plus the legacy tier table + stats summary + share card
- Wordle-style emoji share (uses `navigator.share` with clipboard fallback)
- **WhatsApp share** — direct share button in game-over + home screen
- **First-Time User Experience (FTUE)** — 3-step interactive tutorial (drop → first merge → first chain with "WOW!" + confetti) shown once to brand-new players; demos the core mechanics in <30s before the first real game
- **Default player name** — every device boots with "שחקן XXXX" derived from the deviceId, so there's no pre-game prompt; players opt into a real name via the ✏️ on home or the inline CTA on game-over
- Anonymous `deviceId` (UUID, persisted) — one row per device per day
- **Daily leaderboard** — top 50 with player highlight + absolute rank + total players today
- **Public leaderboard modal** with `day / week / month` tabs and `world / country / difficulty` scopes
- **Friends contest** with live in-game score updates + real-time spectator mode + unified shell header
- **BLOOM Challenges** — public single-shot prize contests (4 types)
- **Onboarding coach** — gentle in-game toasts for new players
- **Achievements system** — tier, chain, score, streak, and general achievements
- **7 skin packs** — classic, neon, ocean, galaxy, candy, zen, Aurora (animated CSS effects, try-before-buy trial mode)
- **Tile shop** — buy power-ups with BLOOM credits (💎)
- **Credits/wallet system** — BLOOM-XXXX codes, referral credits, daily bonuses with slot-machine reel animation
- **1v1 duels** — head-to-head matches with wagers. Challenge by typing only the 4-char BLOOM suffix (the `BLOOM-` prefix is built in), pasting a full code, or tapping the ⚔️ button on any leaderboard row. Your own code is one tap away to copy at the top of the duel modal.
- **Daily jackpot** — auto-settled at midnight Israel time
- **XP leveling** — 11 levels with progression
- **Server-side bots** — 200 Israeli names, 3 modes, 4 speeds, admin-controlled
- **Admin dashboard** — DAU/WAU/MAU, retention cohorts, funnel, heatmap, live view, bot controls, audit log, bonus simulator, scope×time leaderboard config
- **Dark mode** — full, auto-detects system preference; driven by `:root` design tokens
- **PWA** — installable, service worker, offline shell
- **Viral features (v1.2)** — streak hero badge, addiction badge with share, WhatsApp invite flow, mini-leaderboard, enhanced share card with game time + chain + addiction
- **Streak FOMO** (UX audit §1.5) — game-over streak hint has four tones (cold / low / mid border-pulse / hot pulsing-gradient at ≥7 days)
- **"Already played today" funnel** (UX audit §1.6) — the daily countdown screen also offers practice / contests / challenges CTAs so the player isn't dead-ended
- **Social-proof live pulse** (UX audit §1.4) — home screen shows "N שחקנים פעילים · M משחקים היום" via `/api/stats/live`, refreshed every 15s
- **Unified shell + NavStack** (UX audit §2.1 + §3.1) — `mountShell()` injects a sticky back-arrow + title + actions bar across non-game screens (proof-of-pattern on the contest leaderboard; other screens still pending mechanical migration)
- **Design tokens** (UX audit §2.2) — `:root` block in `base.css` exports `--color-*` / `--radius-*` / `--shadow-*` so every new component picks from one source of truth
- **`showToast()` helper** — generic info/success/error/warning toast available globally via `window.__bloomToast`
- **Security**: HMAC device-token (`/api/register`) required on all credit/state-mutating endpoints, atomic balance updates everywhere, strict CORS allowlist, `Strict-Transport-Security` + `Content-Security-Policy` headers, `drops`-mandatory anti-cheat, server-decided gift jackpots (no client-supplied amounts), single-submission guard on duel scores, server-authoritative skin ownership (`player_skins` table), strict per-day dedup on `/api/player/earn`, periodic DB cleanup of dedup keys and stale live-state rows
- **Backups**: Railway-side `DAILY` (retention 6 days) + `WEEKLY` (Saturday, retention 27 days) volume snapshots on `Postgres-z2RQ` plus a manual `manual-baseline-20260520` snapshot. Configured via the `volumeInstanceBackupScheduleUpdate` mutation after the 2026-05-13 incident (see CLAUDE.md §11 for the full post-mortem).
- **Game v2 A/B feature flag** (GV.1–GV.4) — an opt-in "v2" variant behind a Postgres `feature_flags` row the admin controls (🧪 Game v2 card in the 🎮 משחק tab: enable toggle + 0-100% rollout slider + beta link + a signed "force on yourself" preview link). **Default OFF — classic is exactly unchanged until the admin opts in, and flipping it off reverts instantly.** As of GV.4 the model is **"only the board changes"**: the full classic app (home + every meta system) ALWAYS loads; the flag merely adds `body.bloom-v2` and enables new in-game **board mechanics** layered onto the classic 4×6 engine — a hold/swap slot, a ghost-landing preview + drag-to-aim + same-tier pulse, a v2 look, and beta feedback ([src/52-v2-board.js](src/52-v2-board.js) + [public/css/v2-mechanics.css](public/css/v2-mechanics.css), all gated by `v2On()`). The board stays 4×6 + classic scoring, so leaderboards/trophies/Battle-Pass/daily stay fair and valid and dynamic-boards/FTUE/bots are untouched. Assignment is sticky per device, instantly kill-switchable, and every player is tagged `bloom_variant` in GA4 for retention/score/session comparison.
  - **Beta link** — turn on `beta_enabled` and share `https://<DOMAIN>/?beta=v2` with selected testers; they enter v2 and stay (sticky `bb_beta` cookie), independent of the rollout %. `?beta=classic` opts them back out.
  - **In-game feedback** — v2 shows a non-blocking 💬 pill + a one-time 👍/👎 + comment prompt after the 2nd game-over; results land in the `feedback` table and show as 👍/👎 counts + recent comments in the admin "💬 משוב על Game v2" panel.

## NOT currently in the build

The repository's older `ROADMAP_1.md` describes a welcome splash, a longer 6-to-8-step tutorial, and background MP3 music. **Those were rolled back** in commit `4fb5972`. The current onboarding is the 3-step FTUE in [src/15-ftue.js](src/15-ftue.js), not the older tutorial. Treat `ROADMAP_1.md` as a historical design doc, not a description of the current state.

---

## Tech stack

- **Frontend**: `public/index.html` (HTML shell, ~120 lines) + `public/styles.css` (CSS) + `public/app.js` (JS IIFE). Vanilla JS, RTL Hebrew UI, no framework, no CDN. SVG icons inlined as strings. Source files in `src/` (15 numbered JS files + `99-close.js`) and `public/css/` (6 CSS files), concatenated by `build.sh`.
- **Backend**: `server.js` — Node 18+, Express. Serves the static frontend and a JSON API. `bot-engine.js` — server-side bots (200 Israeli names, 3 modes, 4 speeds).
- **Database**: Postgres via `pg`. Schema in `schema.sql` (18 tables), applied on every boot by `initDb()` (idempotent).
- **Persistence**: `localStorage` for best score, mute, deviceId, player name, skins, streak, achievements, FTUE-done flag, and the daily-played gate.
- **Hosting**: Railway — `bloom-web` service + `Postgres-z2RQ` plugin. Auto-deploy from GitHub. Automated daily + weekly volume backups on `Postgres-z2RQ` (Railway-side).

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
├── src/                # JS source files (15 + 99-close.js) — see src/README.md
│   └── 15-ftue.js      # First-time user experience (UX audit §1.1)
├── admin/index.html    # Admin dashboard (single-file, RTL Hebrew)
├── server.js           # Express server + API routes
├── bot-engine.js       # Server-side bots (200 names, 3 modes)
├── db.js               # Postgres pool + schema bootstrap
├── schema.sql          # All tables (18, idempotent)
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
| `GET` | `/api/flags/game_v2` | `?deviceId&force=v2\|classic&force_key&beta=v2\|classic` | `{ enabled, rollout_pct, beta_enabled, variant }` — the player's sticky game variant (GV.1/GV.2). Precedence rollout→beta→force: `bucket(deviceId)%100 < rollout_pct` → `v2`; `?beta=v2` (when `beta_enabled`) opts in via a sticky `bb_beta` cookie; `force` honored only with the admin-derived `force_key`. Write is admin-only under `/<ADMIN_PATH>/api/flags/game_v2`. |
| `POST` | `/api/feedback` | `{ rating(±1), comment, score, variant, deviceId }` | Game v2 in-game feedback (GV.2). Public, rate-limited 20/hr, comment ≤500. Admin reads counts + recent at `/<ADMIN_PATH>/api/feedback`. |
| `GET` | `/api/stats/live` | — | `{ activeNow, playingNow, gamesToday }` — social-proof counters for the home pulse bar (UX audit §1.4). Polled every 15s; cheap aggregate queries with no auth. |
| `POST` | `/api/score` | `{ date, deviceId, token, name, score, tier, drops, country? }` | `{ ok, rank, total }` — upserts only if new score is higher; `total` is the count of players who submitted today (so the game-over rank pill can say "#23 מתוך 847"). |
| `GET` | `/api/leaderboard/:date` | `?deviceId=...` | `{ list (top 50), total, rank }` — single-day board |
| `GET` | `/api/leaderboard/range/:period` | `period ∈ {day,week,month}`, `?endDate=YYYY-MM-DD&deviceId=...` | `{ list, total, rank, from, to, period }` — best-per-device over rolling window |
| `GET` | `/api/leaderboard/v2` | `?scope=world\|country\|difficulty&period=day\|week\|month&difficulty=...&endDate=...&deviceId=...&country=...` | Unified scope×time leaderboard. Each row includes `country` and `player_code` so the client can offer challenge-to-duel affordances. |
| `POST` | `/api/profile/country` | `{ deviceId, token, country }` | Persists ISO-3166 alpha-2 country to `player_profiles`. Rate-limit 10/hr. |
| `POST` | `/api/profile/name` | `{ deviceId, token, name }` | Updates `player_profiles.display_name`. Backs the ✏️ edit-name pill on home. Rate-limit 10/hr. |
| `POST` | `/api/score/practice` | `{ date, deviceId, name, score, tier, drops, country, difficulty, source, token }` | "Best score wins" upsert into `difficulty_scores`. Source ∈ `'practice' \| 'duel'`. Rate-limit 120/hr. |
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
| `POST` | `/api/duels` / `/api/duels/:id/accept` / `/api/duels/:id/score` | (auth + drops + token) | 1v1 wager-backed duels — see [CLAUDE.md §7](CLAUDE.md) for the full duel + player-economy endpoint surface. |
| `POST` | `/api/player/gift` / `/api/player/ad-watch` / `/api/player/buy-skin` / `/api/player/buy-powerup` / `/api/player/buy-tile` / `/api/player/spend` / `/api/player/earn` | various | Server-authoritative credit economy. Per-game ad-watch dedup, server-decided gift jackpots, hourly caps. Full schema in CLAUDE.md §7. |
| `GET` | `/api/weekly` | — | Current active weekly auto-challenge (created server-side on boot + hourly check). |

Validation: `date` matches `YYYY-MM-DD`, `deviceId` is 8–64 chars, `score` is 0–10,000,000, `tier` is 1–8 (live endpoints also allow `tier=0`). The name is trimmed to 24 chars and falls back to `אנונימי`. `gridJson` must be a 24-cell array with each entry an integer 0–8. **Every state-mutating endpoint requires an HMAC `token`** (issued by `/api/register`) — see CLAUDE.md §11 ("Security hardening round 2") for the full list. Read endpoints and high-frequency heartbeats remain `softDeviceAuth` (accept missing tokens; reject only invalid ones) pending client-adoption telemetry.

### Database schema

18 tables in total. The 5 most-load-bearing are reproduced below; the full set lives in `schema.sql`:

```sql
daily_scores (
  date TEXT, device_id TEXT, name TEXT,
  score INTEGER, tier INTEGER,
  country VARCHAR(2),                  -- ISO-3166 alpha-2, nullable
  drops INTEGER,                       -- anti-cheat: required on insert
  created_at, updated_at,
  PRIMARY KEY (date, device_id)
)
INDEX idx_daily_scores_lookup ON (date, score DESC)

difficulty_scores (date, device_id, difficulty_label,
                   name, score, tier, country, source, drops, ...,
                   PRIMARY KEY (date, device_id, difficulty_label))
-- Practice + duel scores. Daily is EXCLUDED for fairness.

player_profiles (device_id PK, player_code 'BLOOM-XXXX', display_name,
                 balance INTEGER, total_earned, total_spent,
                 country, xp, level, ...)

player_skins (device_id, skin_id, purchased_at,
              PRIMARY KEY (device_id, skin_id))
-- Server-authoritative skin ownership (closes the localStorage-edit hole)

contests (code PK, name, host_name, host_device_id, board_seed,
          board_type, duration_days, ends_at, status, contest_type, ...)
-- contest_type ∈ 'private' (friends) | 'weekly' (auto-created)

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

The remaining tables: `challenges`, `challenge_entries`, `duels`, `daily_jackpot`, `device_visits`, `game_config` (admin tunables + per-deviceId dedup keys), `referrals`, `wager_settlements`, `admin_actions`, `player_heartbeat`. One row per device per date for `daily_scores`. Re-submissions only overwrite if `new.score > old.score`. Contest scores accumulate. `contest_live_state` + `contest_watchers` are ephemeral — TTL is enforced by filtering on `updated_at` at read time, not by a cleanup cron.

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

1. **Domain** — bloom-game.co.il (manual: buy + Railway custom domain)
2. **GA4 activation** — set `GA_ID=G-XXXXXXX` env var in Railway (code is wired, just needs the ID)
3. **Landing page** — marketing page for organic traffic
4. **App Store listing** (PWA → Capacitor wrapper)
5. **Push notification reminders** ("חזור לאתגר היומי!") — requires service-worker push permission UX
6. **Monetization** — ads (AdSense SDK is partially wired but `ad_daily_cap` is the active gate) / premium themes / sound asset polish
7. **Sound asset polish** — optional voice cues
8. **Off-Railway backup automation** — `pg_dump` cron uploading to S3/Drive so a parallel incident can't take out both the live DB and its backups simultaneously (CLAUDE.md §13 — "Backup coverage is Railway-side only")
9. **Remaining shell adoption** — migrate `showContestMenu` / `showCreateContestForm` / `showJoinContestForm` / `showContestPreview` / `showMyContestsList` + challenge screens off the legacy `createBackButton` onto `mountShell()` (one screen at a time to keep visual-regression risk small)
10. **Bulk CSS-color migration** — sweep the remaining hard-coded hex values across screens/home/viral CSS onto the `:root` design tokens (incremental, when those surfaces are touched)

**Recently shipped** (in case you're scanning a stale ROADMAP_1.md): the 3-step FTUE, social-proof live pulse, streak FOMO tiers, practice funnel on the daily countdown screen, scope×time leaderboard, BLOOM-XXXX identity, weekly auto-challenge, public player profile, daily-login reward with slot-machine reel, Aurora skin pack, admin bonus simulator, challenges system, and full security-hardening rounds 1+2. See CLAUDE.md §11 for the full feature changelog.

---

## Conventions

- Source files live in `src/` (JS) and `public/css/` (CSS). Build with `./build.sh`.
- No npm frontend dependencies, no CDN.
- RTL Hebrew is the canonical UI direction.
- Every state mutation that survives a refresh must hit `localStorage`.
- See [CLAUDE.md](CLAUDE.md) for the full agent contract — architecture, what NOT to change, known issues, and current progress.
