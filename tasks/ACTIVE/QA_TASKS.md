# QA Audit — BLOOM (full project)
**Date:** 2026-07-10
**Scanned:** server.js (19,757 L) · db.js · schema.sql · src/*.js (53) · admin/index.html (10,697 L) · live prod endpoints
**Method:** 6 code-mapping agents + verified-only defect sweep (XSS / SQLi / auth / atomicity / payload / dead-code) each cross-read in source + live smoke test of every public GET, all state GETs, and 11 POST mutations against prod.

> Every finding below was **verified by reading the actual code** (line numbers given). Live smoke test: all public + state endpoints `200`; all 11 tested POST mutations `200` (pet/spin/gacha/earn/gift/login-cal/trophies/promo/duels — `bank/deposit` correctly rejected below-min). Build `v20260612e` is current; `server.js`/`db.js`/`bot-engine.js`/live `app.js` all pass `node --check`.

---

## Critical (fix first — silent correctness / core-loop)

- [ ] **C1 — Game-over meta-grants are split across two asymmetric branches; each drops a different reward set.** `src/11-game.js` has TWO game-over paths. **BRANCH 1** (`row===-1` column-full, @3612 — the common path on **default difficulty** per CLAUDE.md LR.1 live-verify) fires starter-pack + pet-XP (3666) + guild (3674) + trophy (3692), but has **no `mode==='dynamic'` handling at all** (submit block 3722-3796 covers only challenge/daily/practice/contest). **BRANCH 2** (post-chain settle @3951 — common on גהינום/Crown) fires the full dynamic sub-branch (per-board best, streak, quests, **season XP 4123**, **album 4129**, tournament, board-score submit) but has **no pet/guild/trophy/starter-pack**.
  - *Failure:* A player grinding a **dynamic board** who tops out by column-full (default difficulty = most players) gets **zero** recorded progress for that game — no board-score on the leaderboard, no season XP, no album, no quest/streak, no tournament score. A player who ends via a final merge-chain fill gets **no trophy / pet-XP / guild contribution / starter-pack offer**. Both features "work" but silently drop a fraction of every player's games depending on *how* the board filled. This is the single highest-impact functional defect.
  - *Fix:* extract the full game-over meta block into one `finalizeGameOver()` helper called identically from both branches (dedup is already server-side per gameId, so double-call is safe).

---

## High

- [ ] **H1 — Stored XSS via unescaped names → innerHTML (4 sites).** `escapeHtml` is a hoisted global available across the IIFE; these sites skip it. Server `cleanName` does **not** strip `<>&` (per CLAUDE.md DU.3).
  - `src/33-guild-wars.js:179` — **opposing guild name** rendered raw into `host.innerHTML` (@219). Cross-player vector: attacker names a guild with a payload, gets auto-matched into a guild war, every victim who opens the war modal executes it.
  - `src/33-guild-wars.js:172` — own guild name (raw). `:202` — contributor player name (raw).
  - `src/06-contests.js:526` — contest name raw into `screen.innerHTML`; the **very next line (527) escapes `host_name`** → clear oversight.
  - *Fix:* wrap each in `escapeHtml(...)`.

- [ ] **H2 — Admin player-moderation is 100% dead (double `/api/` prefix).** `admin/index.html:4962` calls `api('/api/players/moderate')`; `api()` already prepends `/api`, so it resolves to `BASE/api/api/players/moderate` → **404**. All moderation buttons — **ban / unban / grant-trophies / grant-XP / set-level** — silently no-op (toast "שגיאת שרת: 404"). Sibling `_grantGems` at L4969 uses the correct `api('/players/balance')` and works.
  - *Fix:* `api('/api/players/moderate'` → `api('/players/moderate'`.

- [ ] **H3 — Admin economy "ברז מול בור" dashboard is dead (same bug).** `admin/index.html:5010` calls `api('/api/economy')` → `BASE/api/api/economy` → **404** → panel always renders "שגיאה בטעינה". (Server route `adminRouter.get('/api/economy')` server.js:14215 is fine.)
  - *Fix:* `api('/api/economy')` → `api('/economy')`. *(H2 + H3 are the only two `api('/api/…')` calls in the whole file.)*

- [ ] **H4 — Admin audit trail silently loses ~20 action types (`admin_actions` has no `details` column).** `schema.sql:195-202` defines only `metadata JSONB`; there is no `details` column anywhere. Yet ~20 admin CRUD handlers `INSERT INTO admin_actions (... details ...)` (boards/skins/tournaments/daily-deals/gacha/calendar/bundles/guilds/push-broadcast), each wrapped in `.catch(()=>{})` → the INSERT throws and is swallowed. Those changes never appear in `GET /api/audit`. Several other mutations have **no audit call at all** (tournament finalize, push test, calendar patch/delete, bundle delete, match-now).
  - *Fix:* route all through `logAdminAction(action, targetType, targetId, metadataObj)`; drop the raw `INSERT … details` statements.

- [ ] **H5 — Duel opponent-score peek via `GET /api/duels/mine` (server.js:17563).** The handler `SELECT *` returns full duel rows (incl. `challenger_score`) filtered only by `challenger_device|opponent_device|opponent_code = me`, with **no gating on accept/submission**. The score endpoint accepts submissions while `status='pending'` (17948), and the opponent's wager isn't deducted until accept — so a challenged player can poll `/mine`, see the challenger already scored 480K, and **decline** the wagered duel risk-free. This defeats the deliberate null-out in `GET /api/duels/:id` (17900-17903).
  - *Fix:* null `challenger_score`/`opponent_score` in `/mine` for any duel where the viewer hasn't accepted+submitted, mirroring `/:id`.

---

## Medium

- [ ] **M1 — Non-atomic transaction on the shared pool: `POST /api/duels/:id/decline` (server.js:17810).** The wager-refund `UPDATE player_profiles … balance + bet` (17822) + `wager_settlements` INSERT (17827) run under `pool.query('BEGIN')`/`COMMIT`/`ROLLBACK` on the **shared pool**, not a dedicated `pool.connect()` client (the only such case in the file — all 49 others use a client). Under concurrency the BEGIN/UPDATE/COMMIT can land on different connections → double-refund or lost refund. Same class as the already-fixed `_finalizeGuildWar`/`gift-friend` bugs.
  - *Fix:* `const client = await pool.connect()`; route the txn through `client`; `client.release()` in `finally`.

- [ ] **M2 — Silent money-path failures (`.catch(()=>{})` after state already changed).** Player is told they got gems that never arrive:
  - `server.js:9733` — matchmaking-cancel refund `UPDATE balance + refund` swallowed **after** the queue row (carrying the wager) was already `DELETE … RETURNING wager` (9731) → staked gems lost with no error/retry.
  - `server.js:9987` & `9991` — friend-challenge win rewards to challenger + challenged swallowed **after** the challenge was flipped to `'passed'` (9974) and a "+N💎 לשניכם" push was sent (9994) → both told they won, neither paid. Not in a transaction, so a crash between them also loses it.
  - *Fix:* wrap each reward+state-change in a transaction; on refund failure, surface an error / re-queue.

- [ ] **M3 — Latent credentialed-URL fetch risk + a duplicate fetch in admin.** Several admin data fetches use absolute/relative paths instead of `API + path`, so they'd throw "URL that includes credentials" if the admin ever navigates via an embedded-credentials URL, and the bare-relative ones break if the page is served without a trailing slash: `/api/config` (5149), `/api/achievements/leaderboard` (5878), `/api/boards/available` (**6693 + 6694 — fetched twice into one Promise.all**), `/api/events/active` (8705), `api/skins` (6788/6869/6877/6896), `api/boards` (7060/7169/8079/8098).
  - *Fix:* migrate to `API + '/…'`; delete the duplicate 6694.

---

## Low / hygiene

- [ ] **L1 — Gacha spend-flash shows `-0`.** `src/19-skin-gacha.js:259` reads `d.cost`; `POST /api/gacha/pull` never returns `cost` (only `newBalance`). Guarded `-(d.cost||0)` → the balance-bump delta animates as `-0` (counter still lands correctly). Return `cost` or read `totalPrice`.
- [ ] **L2 — Friend add shows wrong pending state on auto-accept.** `src/05a-home-v2.js:1360` reads `d.accepted`; server returns `status:'accepted'`. When adding someone who already had a pending request to you (reverse auto-accept), the UI shows "pending" instead of "✓ friends +200💎" (friendship + credit ARE created). Sibling `49-friend-search.js:286` does it right (`d.status==='accepted'`). Change to `d.status==='accepted'`.
- [ ] **L3 — Empty themed board pollutes the picker (prod data).** Board #3 "בונוס" is `type:'themed', definition:{cells:[]}` with no theme_id/shape_id — a do-nothing board on the dynamic picker (the exact class the IS.4 guard was meant to reject). Disable/delete it in admin, or fix its definition.
- [ ] **L4 — Dead code + duplicate helper.** `src/05b-home-v3.js` (~538 L) is orphaned (rolled back, flag cleared on boot) — delete to shrink the bundle. `escapeHtml` is defined twice in the shared closure (`02-shop.js:1793`, `11-game.js:1060`) — benign redeclaration, but consolidate to one.
- [ ] **L5 — `server.js:5117` interpolates `INTERVAL '${days} days'`** instead of `$1` (sibling at 5090 parameterizes). `days` is `parseInt`+clamped [1,60] so **not injectable** — cosmetic consistency only.
- [ ] **L6 — Debug scanner blind spot.** `checkEndpointHealth` (admin 9841) only probes a 17-endpoint subset and no POSTs, so it would **not** have caught H2/H3. Add `economy` + a lint for the double-`/api/` pattern.
- [ ] **L7 — Uncommitted WIP.** `git status` shows `src/02-shop.js` + `public/app.js` locally modified (28 net insertions) and two stray `*.png`. Confirm this is intended before the next deploy/build.

---

## Verified SAFE (checked, no action)
- **CORS** exact-match `Set().has(origin)` (server.js:147) — not substring. ✓
- **No SQL injection** — 0 of ~1,190 queries interpolate request input (all `$N` params or hardcoded/allowlisted/`parseInt`-clamped). ✓
- **No duplicate routes** (175 app + 100 admin, all unique; the historical dup `/api/players` is gone). ✓
- **Auth** — every money/state POST has `requireDeviceAuth`; the 3 unauthed POSTs (register/feedback/transfer-redeem) are intentional & rate-limited. ✓
- **Server-authoritative pricing** — no endpoint trusts a client price/reward; `event_gift` clamps client meta. ✓
- **Atomic balance deducts** — all use `UPDATE … balance = balance - $x WHERE balance >= $x`. ✓
- **Dedup not bypassable** — meta only enters the dedup key for a fixed allowlist with validated values. ✓
- **All `ON CONFLICT` targets** match real PK/UNIQUE/partial-index constraints (incl. the IS.2 partial-index fix). ✓
- **Admin field-name mapping** — every panel reads the correct camelCase/snake_case per endpoint; no missing element ids; no dead buttons; no references to nonexistent routes (beyond H2/H3 URL typos). ✓

## Summary
**1 critical, 5 high, 3 medium, 7 low.** No SQLi, no CORS gap, no auth gap, no broken ON CONFLICT, no duplicate routes. The two **admin-monitoring** panels the owner asked about (moderation + economy) are broken by a one-character-class prefix typo (H2/H3, trivial fix); the audit log under-reports (H4). The highest *player-impact* bug is C1 (silent progression loss on the core loop). Everything else in the app responds and functions live.

---

# QA Audit — Pass 2 (2026-07-11) — concurrency bug-hunt
**Method:** 6-lens adversarial bug-hunt workflow (find → refute-by-default 2-vote verify). 18 candidates → 11 confirmed. All FIXED + verified (build + engine self-test 200/0-floating + node --check). Shipped in `v20260711a`.

> The workflow hit the monthly spend limit mid-verify; remaining fixes done inline.

## The headline class: economy concurrency double-credit (all fixed to the codebase's safe pattern)
Endpoints that read state OUTSIDE the transaction, ran a CAS whose rowcount was never checked, then credited UNCONDITIONALLY → N concurrent requests paid N×.

- [x] **HIGH** `server.js` `maybeFinalizeTournament` — public `GET /api/tournaments` (polled by every client) lazy-finalized with no lock/CAS → N× prize-pool payout. Fix: `FOR UPDATE` on the tournament row + per-prize CAS `AND prize_claimed IS NULL RETURNING 1` + `status != 'finalized'` guard.
- [x] **HIGH** `server.js` `/api/lifetime/prestige` — CAS result discarded, 5000💎 credited unconditionally. Fix: `RETURNING` + rowcount check before credit.
- [x] **HIGH** `server.js` `/api/player/season/claim-tier` — non-atomic dedup (read outside txn + unconditional SET). Fix: atomic JSONB append `|| $1 WHERE NOT (col @> $1) RETURNING 1`.
- [x] **MED** `server.js` `/api/player/earn` — unchecked dedup `INSERT ON CONFLICT DO NOTHING`. Fix: `RETURNING 1` gate; credit only if inserted.
- [x] **MED** `server.js` `/api/player/starter-pack/buy` — purchased_at checked outside txn → +2000💎 doubled. Fix: CAS `purchased_at IS NULL` at top of txn.
- [x] **MED** `server.js` `/api/player/comeback-claim` — unchecked dedup INSERT (up to 600�e2 doubled). Fix: `RETURNING 1` gate.
- [x] **LOW** `server.js` gacha free daily pull — unlocked date read inside txn. Fix: `FOR UPDATE` on the state row.

## Client + engine
- [x] **HIGH** `src/11-game.js` — `window.__bloomDropCount` was NEVER assigned → every dynamic-board + tournament game-over sent `drops:0`, and the server's drops-implausibility check silently rejected scores ≥100K. Fix: use the real `dropsCount` at all 4 sites.
- [x] **HIGH** `src/02-shop.js` — ⚡ live-race matchmaking lacked the DU.3 cancel-vs-match guard → trapped into a 60s wagered race after a local refund. Fix: `if (!_liveRacePoller) return;` in the poll `.then`.
- [x] **LOW** `src/12-tour-info.js` — render-time gravity invariant false-positived on every shape/frozen/locked board (console spam + redundant applyGravity). Fix: reset the scan at void/frozen/locked anchors.
- [x] **LOW** `src/11-game.js` `pickSmartSurvivor` — gravity sim ignored anchors → wrong survivor on smart-mode special boards. Fix: mirror `applyGravity`'s anchor handling (byte-identical on non-special boards).

## Also
- [x] Deleted orphaned dead code `05b-home-v3.js` + `home-v3.css` (−980 lines; styles.css 22842→22400) + fixed the build.sh doc comment.

## Summary (pass 2)
**3 high (economy) + 3 medium + 3 low (economy) + 2 high (client) + 2 low (engine) = 11 fixed.** No SQLi/auth/crash regressions introduced (each fix mirrors an existing safe pattern in the same file; engine self-test clean).
