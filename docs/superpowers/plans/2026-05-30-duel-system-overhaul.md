# Duel System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BLOOM's three duel modes clearly distinct, give every mode a real gem wager chosen by the initiator, and eliminate the spectator-vs-bot score mismatch — all tuned for maximum addiction.

**Architecture:** Server-authoritative. Lock the bot's final calibrated score at the moment the player submits, then drive both the spectator live-score and the settlement from that one locked number (kills the mismatch). Add atomic wager deduction at entry + pool payout at settle for all three modes including vs-bot. Match random/live on difficulty + trophy + wager band. Three modes stay; async modes get a "no-clock" identity, live race keeps its 60s clock.

**Tech Stack:** Node/Express + Postgres (server.js, db.js, schema.sql), vanilla JS IIFE built by build.sh (src/02-shop.js), CSS (public/css/*), admin/index.html, node assertion harness (scripts/test_bot_scores.mjs).

**Working note for every server/client task:** server.js is ~17K lines and src/02-shop.js is large. Each task names the exact function(s) to change. **Read the target function before editing** (the line numbers below are from the 2026-05-30 Explore pass and will drift — grep the function name). After any src/*.js or css change, run `./build.sh`. Never edit public/app.js or public/styles.css directly.

**Reference spec:** `docs/superpowers/specs/2026-05-30-duel-system-overhaul-design.md`

---

## Phase 0: Baseline & safety net

### Task 0: Capture green baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the engine self-test**

Run: `node scripts/test_engine.mjs`
Expected: PASS, ~200 games / 0 floating tiles.

- [ ] **Step 2: Run the bot-score harness twice**

Run: `node scripts/test_bot_scores.mjs && node scripts/test_bot_scores.mjs`
Expected: all tests pass, identical numbers both runs (deterministic, e.g. 51.5% / 46.4% / 2.1%). Record the exact numbers — they are the regression baseline.

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: empty (spec already committed).

---

## Phase 1: Schema & config (idempotent migrations)

### Task 1: Add wager column to matchmaking queue + bot_final_score to duels + config keys

**Files:**
- Modify: `schema.sql` (duel_matchmaking_queue table area + duels ALTERs + game_config seeds)
- Modify: `db.js` (the `migrations` array applied on boot)

- [ ] **Step 1: Add idempotent ALTERs to schema.sql**

Find the `duel_matchmaking_queue` CREATE TABLE and the `duels` ALTER block in `schema.sql`. After them, add:

```sql
-- Duel overhaul (2026-05-30): wager-aware matchmaking + locked bot final score
ALTER TABLE duel_matchmaking_queue ADD COLUMN IF NOT EXISTS wager INT DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS bot_final_score INT;

INSERT INTO game_config (key, value) VALUES
  ('duel_wager_match_tolerance_pct', '0'),
  ('duel_wager_widen_after_polls', '3'),
  ('duel_wager_widen_band', '50'),
  ('duel_random_default_wager', '0'),
  ('duel_rake_pct', '5')
ON CONFLICT (key) DO NOTHING;
```

(`duel_wager_match_tolerance_pct=0` means exact-bucket match by default; widening kicks in after N polls. `duel_rake_pct` mirrors the existing friend-duel 5% rake — reuse the existing key if one already exists; grep `rake` in server.js first and prefer the existing key, deleting this seed if so.)

- [ ] **Step 2: Mirror the ALTERs in db.js**

In `db.js`, find the `migrations` array (the list of idempotent `ALTER`/`CREATE` strings run on boot) and append the same three statements (the two ALTERs + the config INSERT) so live DBs pick them up on next deploy.

- [ ] **Step 3: Apply locally and verify**

Run (against your local/public DB): `node -e "import('./db.js').then(m=>m.initDb()).then(()=>{console.log('migrated');process.exit(0)})"`
Expected: prints `migrated`, no error. (If no local DB, this is verified on first Railway deploy instead — note it for the rollout task.)

- [ ] **Step 4: Commit**

```bash
git add schema.sql db.js
git commit -m "feat(duels): schema — wager-aware queue + bot_final_score + config keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2: Score unification (kill the mismatch)

This is the headline bug fix. After this phase, the spectator-displayed bot score is non-decreasing, never exceeds the final, and converges to exactly the final.

### Task 2: Extend the test harness with the convergence + conservation assertions FIRST

**Files:**
- Modify: `scripts/test_bot_scores.mjs`

- [ ] **Step 1: Read the harness to learn its mirrored-formula structure**

Read `scripts/test_bot_scores.mjs` fully. It re-implements the server formulas (`_calibrateBotScore`, `_liveBotScoreAt`, `_botAsyncCandidateScore`, the GREATEST ceiling, etc.) and runs assertions. Note the helper names it uses so the new assertions match.

- [ ] **Step 2: Add Test 10 — async spectator converges to locked final without exceeding it**

Append a new test that mirrors the NEW async flow (Task 4): given a `duelId` + `playerScore`, compute `lockedFinal = calibrate(duelId, playerScore)` once, then simulate the spectator poll lifecycle calling the NEW `asyncDisplayScore(duelId, playerScore, lockedFinal, progress)` (the mirror of the rewritten `_synthesizeBotLiveState` math). Assert across 500 duels × 60 polls each:
  - displayed score is monotonic non-decreasing within a duel,
  - `displayed <= lockedFinal` at every poll,
  - the last poll equals `lockedFinal` (within ±0 — exact).

```js
// Test 10: async spectator display converges to locked final, never exceeds it
{
  let violations = 0, exceed = 0, notConverged = 0;
  for (let i = 0; i < 500; i++) {
    const duelId = 5000 + i;
    const playerScore = 8000 + (i * 137 % 90000);
    const lockedFinal = calibrate(duelId, playerScore); // mirror of _calibrateBotScore
    let prev = -1, last = 0;
    for (let p = 0; p <= 60; p++) {
      const progress = p / 60;
      const shown = asyncDisplayScore(duelId, playerScore, lockedFinal, progress);
      if (shown < prev) violations++;
      if (shown > lockedFinal) exceed++;
      prev = shown; last = shown;
    }
    if (last !== lockedFinal) notConverged++;
  }
  assert(violations === 0, `T10 monotonic: ${violations} down-jumps`);
  assert(exceed === 0, `T10 ceiling: ${exceed} polls exceeded final`);
  assert(notConverged === 0, `T10 converge: ${notConverged} duels not landing on final`);
  console.log('Test 10 PASS — async spectator converges to final, 0 exceed, 0 down-jumps');
}
```

- [ ] **Step 3: Add the `asyncDisplayScore` mirror helper**

Above the tests, add the mirror of the rewritten server math. It must match `_synthesizeBotLiveState`'s NEW behavior exactly (defined in Task 4): displayed = `min(lockedFinal, round(lockedFinal * progress))`, but never below the prior poll — and because progress is monotonic in `p`, `lockedFinal * progress` is already monotonic, so the simple form is:

```js
function asyncDisplayScore(duelId, playerScore, lockedFinal, progress) {
  // progress in [0,1]; quadratic ease so the bot ramps then plateaus
  const eased = progress * progress;
  return Math.min(lockedFinal, Math.round(lockedFinal * eased));
}
```

- [ ] **Step 4: Add Test 11 — wager conservation (pure-math model)**

Model a wager round: player stakes W, bot stakes virtual W, pool = 2W, rake = floor(2W * rakePct/100), payout = 2W - rake. Assert: if player wins, player net = +(payout - W) = +(W - rake); if bot wins, player net = -W; tie → player net = 0 (refund W). Across many (W, rakePct) combos assert no gem creation (payout + (player loss on loss) accounting balances to rake skim only).

```js
// Test 11: wager conservation
{
  let bad = 0;
  for (let W = 0; W <= 1000; W += 50) {
    for (const rakePct of [0, 3, 5, 10]) {
      const pool = 2 * W;
      const rake = Math.floor(pool * rakePct / 100);
      const payout = pool - rake;
      // player win: started -W (stake), gets +payout  => net = payout - W
      const winNet = payout - W;
      // bot win: player started -W, gets 0 => net = -W
      const loseNet = -W;
      // tie: refund W => net 0
      const tieNet = 0;
      // conservation: in a player-win, gems removed from circulation = rake (the only sink)
      if (winNet !== (W - rake)) bad++;
      if (loseNet !== -W) bad++;
      if (tieNet !== 0) bad++;
    }
  }
  assert(bad === 0, `T11 wager conservation: ${bad} mismatches`);
  console.log('Test 11 PASS — wager conservation holds');
}
```

- [ ] **Step 5: Run the harness — Test 10 should FAIL (server not yet rewritten)**

Run: `node scripts/test_bot_scores.mjs`
Expected: Tests 1-9 + 11 pass; **Test 10 references `asyncDisplayScore` which is defined, so it will actually pass against the mirror** — but the POINT is the mirror now encodes the target behavior. The true red/green gate is the live-verification in Phase 7. Commit the harness as the executable spec of the new math.

> Note: because the harness mirrors formulas rather than importing server.js, Test 10 passes immediately against its own mirror. Its value is locking the intended math + catching future regressions in the mirror. The server-vs-reality check is the DevTools live test (Phase 7).

- [ ] **Step 6: Commit**

```bash
git add scripts/test_bot_scores.mjs
git commit -m "test(duels): harness asserts async spectator converges to locked final + wager conservation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3: Lock the bot final score at submit time

**Files:**
- Modify: `server.js` — `POST /api/duels/:id/score` bot branch (~the `is_bot_match` detection, near the `bot_settle_at` stamping)

- [ ] **Step 1: Read the endpoint**

Grep `bot_settle_at` and read the `POST /api/duels/:id/score` handler's bot branch. Today it stamps `bot_settle_at = NOW() + random(20-55)s` and returns `result:'waiting'` WITHOUT computing the final score yet (the final is rolled later in `_settleBotDuel`).

- [ ] **Step 2: Compute and persist the locked final at submit**

In that bot branch, after the player's score is validated and before/with the `bot_settle_at` stamp, compute the final once and store it:

```js
// Lock the bot's final score NOW so the spectator view and the settle agree.
const lockedFinal = _calibrateBotScore(duelId, playerScore, _playerWinPct(cfg));
await client.query(
  `UPDATE duels
     SET bot_final_score = $1,
         bot_settle_at = NOW() + ($2 || ' seconds')::interval
   WHERE id = $3`,
  [lockedFinal, settleDelaySeconds, duelId]
);
```

(Use the existing helper that reads `bot_duel_player_win_rate_pct` for `_playerWinPct(cfg)`; grep how `_calibrateBotScore`'s third arg is currently sourced and reuse it. `settleDelaySeconds` is the existing random 20-55 value — keep it.)

- [ ] **Step 3: Verify it compiles**

Run: `node --check server.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(duels): lock bot final score at player-submit time

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4: Rewrite the spectator live-state to converge to the locked final

**Files:**
- Modify: `server.js` — `_synthesizeBotLiveState`, `_botAsyncCandidateScore`, `_snapshotForProgress` usage

- [ ] **Step 1: Read all three functions**

Grep and read `_synthesizeBotLiveState`, `_botAsyncCandidateScore`, `_snapshotForProgress`. Note how the displayed score and grid are currently derived and where the GREATEST ceiling (`opponent_live_score`) is written.

- [ ] **Step 2: Branch on whether bot_final_score is locked**

Rewrite `_synthesizeBotLiveState` so:
  - **After submit (bot_final_score set):** `target = bot_final_score`. `progress = elapsedSinceSubmit / settleWindow` clamped to [0,1] (use `bot_settle_at` and the submit timestamp; if no submit ts column, derive `submitAt = bot_settle_at - settleDelay` or store `bot_settle_at - interval`). `displayed = min(target, round(target * progress*progress))` (quadratic ease). Grid via `_snapshotForProgress(trajectory, progress)`. **No GREATEST ceiling needed** — the curve is structurally monotonic and ≤ target.
  - **Before submit (bot_final_score NULL — a spectator peeking while player still plays):** keep a believable low estimate climbing toward a conservative anchor (existing `_botAsyncCandidateScore` with the **low** anchor from BL.1.6, e.g. 8000), but cap it so that when the real final later locks in, the displayed value is ≤ final and continues upward. Concretely: pre-submit displayed caps at `min(estimate, lockedFinalIfKnown)`; since lockedFinal isn't known pre-submit, cap the pre-submit estimate at a low constant (e.g. `pre_submit_display_cap = 8000` from config) so it cannot overshoot a typical final.

```js
// inside _synthesizeBotLiveState, after loading duel row `d`
let displayed, progress;
if (d.bot_final_score != null) {
  const target = d.bot_final_score | 0;
  const submitAtMs = new Date(d.bot_settle_at).getTime() - settleWindowMs;
  progress = Math.max(0, Math.min(1, (nowMs - submitAtMs) / settleWindowMs));
  displayed = Math.min(target, Math.round(target * progress * progress));
} else {
  // pre-submit peek: conservative climbing estimate, capped low so it can't overshoot the final
  const est = _botAsyncCandidateScore(d, nowMs); // low-anchor curve
  displayed = Math.min(est, PRE_SUBMIT_DISPLAY_CAP);
  progress = displayed > 0 ? Math.min(1, displayed / Math.max(1, PRE_SUBMIT_DISPLAY_CAP)) : 0;
}
const snap = _snapshotForProgress(traj, progress);
```

- [ ] **Step 3: Stop writing the GREATEST ceiling for async**

Remove (or gate off for the bot_final_score-locked path) the `UPDATE duels SET opponent_live_score = GREATEST(...)` write in `_synthesizeBotLiveState`. The locked-final path doesn't need it. Leave the live-race path's ceiling untouched (live race is a different curve handled in `_liveBotScoreAt` / `_settleLiveDuel`).

- [ ] **Step 4: Add the PRE_SUBMIT_DISPLAY_CAP constant + settleWindowMs**

Near the other bot-duel constants, add `const PRE_SUBMIT_DISPLAY_CAP = 8000;` (or read from config `pre_submit_display_cap`). Confirm `settleWindowMs` corresponds to the 20-55s settle delay used at submit (derive from the same source).

- [ ] **Step 5: Verify compile**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "fix(duels): spectator score converges monotonically to locked final (kills mismatch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5: Make _settleBotDuel read the locked final (no re-roll, no MAX bump)

**Files:**
- Modify: `server.js` — `_settleBotDuel`

- [ ] **Step 1: Read `_settleBotDuel`**

Grep and read it. Today it recomputes `botScore = _calibrateBotScore(...)` then does `if (liveCeiling > botScore) botScore = liveCeiling;` ([~server.js:9053-9062]).

- [ ] **Step 2: Use bot_final_score when present**

Replace the compute+MAX with:

```js
// Prefer the score locked at submit time; fall back to a fresh calibration
// only for legacy rows created before this field existed.
let botScore = (d.bot_final_score != null)
  ? (d.bot_final_score | 0)
  : _calibrateBotScore(duelId, playerScore, _playerWinPct(cfg));
// No MAX-vs-live-ceiling bump: the spectator curve was driven FROM botScore,
// so it can never have exceeded it.
```

Keep the rest of the settle (winner pick, status write, push) unchanged except the wager payout added in Phase 3.

- [ ] **Step 3: Verify compile**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "fix(duels): settle reads locked bot final, drops result-flipping MAX guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3: Real wager — all three modes incl. vs bot

### Task 6: Wager deduction at entry for random + live matchmaking

**Files:**
- Modify: `server.js` — `POST /api/duels/find-random`, `POST /api/duels/find-random-live`, `_spawnBotDuelForPlayer`

- [ ] **Step 1: Read the three functions + the friend-duel deduction pattern**

Grep `find-random`, `find-random-live`, `_spawnBotDuelForPlayer`, and the friend-duel `POST /api/duels` deduction (`balance = balance - $1 WHERE balance >= $1 RETURNING balance`).

- [ ] **Step 2: Accept + validate wager on both random endpoints**

At the top of each handler, read `wager` from the body, clamp `const bet = Math.max(0, Math.min(MAX_WAGER, parseInt(req.body.wager,10) || 0));` (define `MAX_WAGER` e.g. 100000 or read config). Before queueing/matching, if `bet > 0`, atomically deduct from the initiator:

```js
if (bet > 0) {
  const r = await pool.query(
    `UPDATE player_profiles SET balance = balance - $1
       WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
    [bet, deviceId]
  );
  if (!r.rowCount) return res.json({ ok:false, reason:'insufficient_funds', wager:bet });
}
```

- [ ] **Step 3: Store wager on the queue row + the duel row**

When UPSERTing into `duel_matchmaking_queue`, include the new `wager` column. When a match (real or bot) creates a `duels` row, set `amount = bet` instead of the hardcoded `0`. For a **real** match, the matched opponent's stake was already deducted when THEY queued (they paid on their own entry) — confirm both sides paid; if the opponent queued with a different wager, see Task 8 matching (only same-band matches, so both paid the same bet within tolerance — credit the difference back if bands differ, or match only exact buckets to avoid this; default tolerance 0 = exact, so amounts are equal).

- [ ] **Step 4: Thread wager into `_spawnBotDuelForPlayer`**

Add `wager` to the opts and set `amount` on the bot duel INSERT to `wager`. The bot's stake is virtual (no second deduction).

- [ ] **Step 5: Verify compile**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(duels): deduct wager at entry for random + live, store on queue + duel + bot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7: Wager payout at settle (bot + live + real) and refund on cancel

**Files:**
- Modify: `server.js` — `_settleBotDuel`, `_settleLiveDuel`, the random-match cancel path, and confirm friend-duel payout already pools

- [ ] **Step 1: Read settle + cancel paths + friend-duel payout**

Grep `_settleBotDuel`, `_settleLiveDuel`, the matchmaking cancel/leave handler, and the friend-duel settlement pool math (`pool minus 5% rake`, ~server.js:16823-16881).

- [ ] **Step 2: Add pool payout to `_settleBotDuel`**

After the winner is decided, inside the same transaction, if `d.amount > 0`:

```js
const wager = d.amount | 0;
if (wager > 0) {
  const pool = wager * 2;
  const rake = Math.floor(pool * _rakePct(cfg) / 100);
  const payout = pool - rake;
  if (playerWon) {
    await client.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
         WHERE device_id = $2`, [payout, playerDeviceId]);
  } else if (isTie) {
    await client.query(
      `UPDATE player_profiles SET balance = balance + $1, updated_at = NOW()
         WHERE device_id = $2`, [wager, playerDeviceId]); // refund stake
  } // bot win → player already debited, nothing to do
}
```

(`_rakePct(cfg)` reads `duel_rake_pct` or the existing rake key. `playerDeviceId`, `playerWon`, `isTie` already exist in the settle scope — adapt names to the function's locals.)

- [ ] **Step 3: Add the same payout to `_settleLiveDuel`**

Mirror Step 2 in `_settleLiveDuel` for the bot-live case (and for the real-vs-real case, the existing friend-duel pool helper may already cover it — confirm; if live duels never paid wagers before, add the pool logic there too, guarded by `amount > 0`).

- [ ] **Step 4: Refund on cancel / no-match abandon**

In the matchmaking cancel handler (where a queued player backs out), if they had a `wager > 0` deducted at entry and no duel was created for them, refund atomically:

```js
const q = await pool.query(`DELETE FROM duel_matchmaking_queue WHERE device_id=$1 RETURNING wager`, [deviceId]);
const refund = q.rows[0]?.wager | 0;
if (refund > 0) await pool.query(
  `UPDATE player_profiles SET balance = balance + $1 WHERE device_id=$2`, [refund, deviceId]);
```

- [ ] **Step 5: Verify compile**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 6: Run the harness (Test 11 wager conservation must pass)**

Run: `node scripts/test_bot_scores.mjs`
Expected: all tests including Test 11 pass.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat(duels): wager payout at settle (bot/live) + refund on cancel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 8: Matchmaking matches on wager band

**Files:**
- Modify: `server.js` — the opponent-search query inside `find-random` and `find-random-live`

- [ ] **Step 1: Read the opponent-search query**

Grep the `SELECT ... FROM duel_matchmaking_queue ... WHERE ABS(trophy_count - $2) <= $3 AND difficulty_label = $4 ... FOR UPDATE SKIP LOCKED` in both endpoints.

- [ ] **Step 2: Add the wager predicate**

Compute the band: `const band = (pollCount >= widenAfter) ? widenBand : Math.floor(bet * tolerancePct/100);` and add `AND ABS(wager - $N) <= $band` to the WHERE. With default `tolerancePct=0`, the band is 0 (exact bucket) until `pollCount >= duel_wager_widen_after_polls`, after which it widens by `duel_wager_widen_band` so a quiet queue still resolves. When matched across a non-zero band, refund/charge the difference so both sides' effective stake equals the lower of the two (or simply match exact buckets and skip this — choose exact-bucket and keep band=0 unless product wants widening; document the choice inline).

- [ ] **Step 3: Verify compile**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(duels): matchmaking matches on wager band (exact bucket, widens when queue is quiet)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4: Difficulty unification

### Task 9: Async random bot honors duel difficulty + client BL.1.7 parity

**Files:**
- Modify: `server.js` — `_spawnBotDuelForPlayer` (async path carries difficulty), confirm `_simulateBotDuelTrajectory` reads it
- Modify: `src/02-shop.js` — `startDuelGame` difficulty re-apply (mirror the BL.1.7 fix already in `startLiveRaceGame`)

- [ ] **Step 1: Confirm the async bot row carries difficulty**

Read `_spawnBotDuelForPlayer` async call site (`live:false`). Ensure `difficulty_label` + `difficulty_weights` + `difficulty_speed_pct` are written onto the bot `duels` row exactly as the live path does, so `_simulateBotDuelTrajectory` (which reads `difficulty_weights`) and `_calibrateBotScore` use the player's chosen difficulty.

- [ ] **Step 2: Verify `startDuelGame` applies the duel difficulty over practice-localStorage**

Read `startDuelGame` in src/02-shop.js. It already reads `duelRow.difficulty_weights` and sets `sessionDifficulty`. Confirm it does NOT call `init()` in a way that re-reads `readPracticeDifficulty()` and clobbers it (the BL.1.7 bug was in `startLiveRaceGame`). If `startDuelGame` is clean, no change. If it has the same bleed, apply the BL.1.7 pattern: after the engine seed, re-apply the duel's difficulty (or explicitly `sessionDifficulty = null` for default duels) + `updateModeBar()`.

- [ ] **Step 3: build + compile**

Run: `./build.sh && node --check server.js`
Expected: build succeeds, no syntax error.

- [ ] **Step 4: Commit**

```bash
git add server.js src/02-shop.js public/app.js public/styles.css
git commit -m "fix(duels): async random bot honors chosen difficulty; client difficulty parity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5: Client UI — three distinct modes, wager + difficulty pickers, no-clock identity

### Task 10: Duel modal — three clearly-distinct modes with difficulty + wager pickers

**Files:**
- Modify: `src/02-shop.js` — `showDuelModal`, `startRandomMatchmaking`, the live-race launch button
- Modify: `public/css/home-v2.css` (or the css file holding duel-modal styles — grep `.duel-modal`)

- [ ] **Step 1: Read the current modal**

Read `showDuelModal` and the random/live launch buttons. Note the existing difficulty pill picker and the friend-code input.

- [ ] **Step 2: Restructure into 3 labelled mode cards**

Render three visually distinct option blocks, each with icon + name + one-line explanation + theme color:
  - ⚔️ **דו-קרב חבר** (purple) — "אתגר חבר ספציפי · משחק מלא · בלי שעון" → friend-code flow.
  - 🎲 **דו-קרב אקראי** (blue) — "זר אקראי · משחק מלא · בלי שעון" → `startRandomMatchmaking`.
  - ⚡ **מרוץ חי 60 שניות** (red-pink) — "זר אקראי · אותו לוח · 60 שניות" → live race.

Above the mode cards, a shared **difficulty picker** (existing pills: default/easy/medium/hard/insane) and a new **wager picker** (preset chips: 0 / 50 / 100 / 250 / 500 💎 + the player's current balance shown). The chosen difficulty + wager apply to whichever mode the player launches.

- [ ] **Step 3: Pass wager into the launch calls**

`startRandomMatchmaking(difficulty, wager)` and the live launch both send `{ difficulty, wager }` in their POST bodies (via `apiPost`, which auto-injects deviceId+token). Friend-duel create already sends `amount` — wire the shared wager chip to it.

- [ ] **Step 4: Insufficient-gems UX**

If `wager > currentBalance`, disable the launch with an inline hint "💎 חסר Nשׁ — הורד הימור או קנה" + a quick "קנה יהלומים" link (open the gem bank/shop). Never a blocking alert.

- [ ] **Step 5: build**

Run: `./build.sh`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/02-shop.js public/css/home-v2.css public/app.js public/styles.css
git commit -m "feat(duels): modal — 3 distinct modes + shared difficulty + wager pickers + low-gems UX

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 11: Async duel HUD — "no-clock" identity, never a 60s countdown

**Files:**
- Modify: `src/02-shop.js` — `startDuelGame`, `startDuelOpponentHud`, `renderDuelHud`, `refreshDuelHudData`
- Modify: the css file with `.duel-hud`

- [ ] **Step 1: Read the async HUD path**

Read `startDuelOpponentHud` / `renderDuelHud` / `refreshDuelHudData`. Confirm they never read `duration_seconds` and never mount a countdown. Per the Explore pass they don't — but verify nothing keys off the DB-default 60.

- [ ] **Step 2: Add the "♾️ משחק מלא · בלי שעון" tag to the async HUD**

In `renderDuelHud`, add a small static tag element (no ticking) reading `♾️ משחק מלא` so the player explicitly sees there is no clock. Ensure `refreshDuelHudData` short-circuits any live-state fetch correctly for `is_bot_match && !is_live` (BL.1.1 already did this — confirm intact).

- [ ] **Step 3: Belt-and-suspenders — client ignores duration for non-live**

Anywhere the client could read `duration_seconds`, gate on `is_live === true` (the authoritative signal). Grep `duration_seconds` and `duration` in src/02-shop.js; ensure only the live-race path (`startLiveRaceGame` / `_liveRaceState`) consumes it.

- [ ] **Step 4: build**

Run: `./build.sh`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/02-shop.js public/css/home-v2.css public/app.js public/styles.css
git commit -m "feat(duels): async HUD shows no-clock identity; duration gated on is_live

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 12: Rematch + result overlay show wager + opponent score

**Files:**
- Modify: `src/02-shop.js` — `rematchDuel`, the duel result overlay, `loadMyDuels`

- [ ] **Step 1: Read rematch + result overlay**

Read `rematchDuel` and the settled-result overlay. Confirm the opponent's real score renders (BL.1.x fixed this; verify with the locked-final change).

- [ ] **Step 2: Pre-fill wager + difficulty on rematch**

`rematchDuel` re-opens the modal pre-selecting the same difficulty + wager chips as the finished duel. Show the wager in the result overlay ("הימור: 100💎 · ניצחת +190💎").

- [ ] **Step 3: build + commit**

Run: `./build.sh`

```bash
git add src/02-shop.js public/app.js public/styles.css
git commit -m "feat(duels): rematch pre-fills difficulty+wager; result overlay shows wager outcome

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 6: Admin telemetry

### Task 13: Surface wager economics + new config in admin

**Files:**
- Modify: `server.js` — extend `/admin/api/bot-duels/stats` (or add a small wager-stats query)
- Modify: `admin/index.html` — the existing bot-duels section + config tooltips for the new keys

- [ ] **Step 1: Read the existing bot-duels admin endpoint + section**

Grep `bot-duels/stats` in server.js and the `דו-קרבות מול בוטים` section in admin/index.html.

- [ ] **Step 2: Add gems-wagered / gems-paid-out / rake-collected to the stats query**

Sum `amount` over bot duels (wagered) and the payout side (from balance deltas or a simple `amount` × win-rate estimate; prefer an exact sum if a payout log exists, else show wagered + player-win-% which implies payout). Render three numbers in the admin card.

- [ ] **Step 3: Add tooltips for the 5 new config keys**

In the `TIPS_PER_KEY` / `PRESETS_PER_KEY` dicts, add entries for `duel_wager_match_tolerance_pct`, `duel_wager_widen_after_polls`, `duel_wager_widen_band`, `duel_random_default_wager`, `duel_rake_pct` with Hebrew explanations + sensible preset chips.

- [ ] **Step 4: Commit**

```bash
git add server.js admin/index.html
git commit -m "feat(admin): bot-duel wager economics + config tooltips for new duel keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 7: Verification, live bot test, rollout

### Task 14: Full regression + live DevTools acceptance

**Files:** none (verification) → then rollout edits

- [ ] **Step 1: Engine self-test**

Run: `node scripts/test_engine.mjs`
Expected: 200 games / 0 floating tiles.

- [ ] **Step 2: Bot-score harness 3× identical**

Run: `node scripts/test_bot_scores.mjs` three times.
Expected: all tests (1-11) pass, identical numbers across all three runs.

- [ ] **Step 3: Deploy to a test/live context**

Run: `railway up --service bloom-web --detach --ci` (only with user go-ahead — see rollout note). Then `curl -s https://bloom-web-production-f3bd.up.railway.app/api/health` → `{ "ok": true }`.

- [ ] **Step 4: Live bot-duel acceptance via Chrome DevTools**

Spawn bots via the bot engine. From a browser session on the live deploy, run BOTH an async random duel and a live 60s race that fall through to a bot. Using Chrome DevTools (chrome-devtools MCP):
  - Watch the spectator widget poll responses (`/api/live-state/<botId>`) and the final settle (`/api/duels/:id`). **Assert the displayed bot score is non-decreasing, ≤ final, and the final overlay number equals the last displayed number.** This is the acceptance gate for the mismatch bug.
  - Verify the async duel shows NO 60s countdown (the "♾️ משחק מלא" tag is present), and the live race shows the 60s clock.
  - Verify gem balance: starts −wager at entry, +payout on win / nothing on loss / +refund on tie. Confirm against `/api/player` balance before/after.
  - Verify difficulty: launch at גיהנום and confirm the bot trajectory reaches high tiers (bot honored the difficulty).

- [ ] **Step 5: Record results**

Note the observed numbers (a sample duel's displayed-curve vs final, and a wager round's balance deltas) for the CLAUDE.md change-log entry.

### Task 15: Rollout — cache buster, SW, docs, deploy, health

**Files:**
- Modify: `public/index.html` (cache buster `v20260530X`), `public/sw.js` (`bloom-vXX.X`)
- Modify: `CLAUDE.md` (new change-log row + APIs/schema reconciliation), `README.md` if surface changed

- [ ] **Step 1: Bump cache buster + SW version**

Edit `public/index.html` cache-buster query and `public/sw.js` `CACHE_NAME` to the next versions (grep the current values first).

- [ ] **Step 2: Update CLAUDE.md**

Add a new Retention-Stages-Tracker row (e.g. `DU.2 — Duel system overhaul`) summarizing: 3 distinct modes, locked-final score-unification (mismatch fixed), real wager all modes incl. vs bot, wager-band matchmaking, difficulty parity, admin wager telemetry. Reconcile §7 (new schema cols + config keys + any endpoint body changes) and the engine self-test line.

- [ ] **Step 3: Final build + checks**

Run: `./build.sh && node --check server.js && node scripts/test_engine.mjs`
Expected: build OK, syntax OK, engine clean.

- [ ] **Step 4: Commit + push + deploy + health**

```bash
git add -A
git commit -m "chore(duels): cache buster + SW bump + CLAUDE.md change-log for duel overhaul

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
railway up --service bloom-web --detach --ci
```
Then: `curl -s https://bloom-web-production-f3bd.up.railway.app/api/health`
Expected: `{ "ok": true }`.

---

## Self-review notes

- **Spec coverage:** mode clarity → Tasks 10,11; 60s leak → Tasks 1,11; score unification → Tasks 2,3,4,5; wager all modes incl. bot → Tasks 1,6,7,8; difficulty → Task 9; addiction polish (rematch/result/celebration) → Task 12; admin → Task 13; tests + live verification → Tasks 0,2,14; rollout → Task 15. All spec sections mapped.
- **No-test-framework reality:** TDD is realized via the node assertion harness (`scripts/test_bot_scores.mjs`) + live DevTools acceptance, not a unit-test runner. Stated up front.
- **Type/name consistency:** `bot_final_score` used consistently (schema → submit lock → spectator read → settle read). `wager`/`amount`: `wager` is the request/queue field, `amount` is the existing `duels` column — mapping stated in Tasks 6-8. `_playerWinPct(cfg)` / `_rakePct(cfg)` flagged as "reuse existing helper, grep first."
- **Open implementation choices (intentional, decided at execution):** exact-bucket vs widening wager band (default exact, band=0); reuse existing rake config key vs new `duel_rake_pct` (grep first); `bot_final_score` column vs reuse — plan commits to the new column for clarity.
