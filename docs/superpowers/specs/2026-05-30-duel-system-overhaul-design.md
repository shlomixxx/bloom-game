# Duel System Overhaul — Design Spec (2026-05-30)

## Goal

Make BLOOM's duel system feel like a real, dramatic, **maximally addictive** head-to-head — with zero seams that reveal the opponent is a bot. Three duel modes stay, but each becomes clearly distinct, every mode supports a real gem wager, the inviter always picks difficulty + wager, and the spectator-vs-bot score mismatch is eliminated.

Prime directive (per project memory): every decision optimizes for "the player can't stop playing." When in doubt, pick the more dramatic / more addictive option.

## Problem statement (what's broken today)

1. **Mode confusion.** Three duel modes exist but two of them feel identical. `🎲 random` (async) and `⚡ live 60s race` both pit you against a stranger, and the async random duel row inherits `duration_seconds = 60` from the DB default ([db.js:98](../../../db.js)) even though the async client (`startDuelGame`, [src/02-shop.js:1370](../../../src/02-shop.js)) never uses it. The user literally saw "60 seconds" on a random duel and asked "what's the difference?" — there is no clear one.

2. **Spectator score mismatch (the headline bug).** In the async modes, after the player submits, a spectator widget shows the bot "playing" with a climbing score. That displayed number comes from `_botAsyncCandidateScore` ([server.js:17054](../../../server.js)) climbing toward one target, while the final settled number comes from `_calibrateBotScore` ([server.js:8991](../../../server.js)) — a different formula. The BL.1.6 `MAX(calibrated, opponent_live_score)` guard in `_settleBotDuel` ([server.js:9053-9062](../../../server.js)) papers over downward jumps but can flip a loss into a win, so the displayed score and the final result tell different stories. This reads as "the scores are lying."

3. **No real wager in random/live.** `amount` is hardcoded `0` for both random ([server.js:8404](../../../server.js)) and live ([server.js:8650](../../../server.js)). The matchmaking queue (`duel_matchmaking_queue`, [db.js:277](../../../db.js)) matches on trophies + difficulty only — no wager column. Only friend duels (`POST /api/duels`, [server.js:16285](../../../server.js)) deduct/credit gems.

4. **Difficulty not applied to async random bot consistently.** BL.1.7 fixed difficulty bleed for the live race only. The async random bot path needs the same guarantee: the bot honors the duel's chosen difficulty (seed / weights / speed).

## Decision: keep three modes, make them distinct

The three modes are retained (explicit user choice). Each gets a distinct identity:

| Mode | Opponent | Timing | Feeling | Theme |
|---|---|---|---|---|
| ⚔️ **Friend Duel** (by code) | A specific friend you invite | Async, **full game** | "Who's better" | Purple |
| 🎲 **Random Duel** | A stranger the system finds (or bot) | Async, **full game** | Relaxed stranger match | Blue |
| ⚡ **Live 60s Race** | A stranger, real-time | Live, **60s clock** | Adrenaline sprint | Red-pink |

Async modes (Friend + Random) carry a visible **"♾️ משחק מלא · בלי שעון"** tag. The live race carries **"⏱ 60 שניות"**. The player always knows whether there is a clock.

## Design

### A. Mode clarity & the 60s leak

- **Async duels must never surface a 60s timer.** Concretely:
  - When creating async bot duels, stop relying on the DB default for `duration_seconds`. Either explicitly write `NULL` / `0` for async rows, or have the client treat `is_live = FALSE` as "no clock" regardless of the column value. The authoritative signal is `is_live`, not `duration_seconds`.
  - The async duel HUD (`startDuelGame` → `startDuelOpponentHud`/`renderDuelHud`, [src/02-shop.js](../../../src/02-shop.js)) renders the "♾️ משחק מלא · בלי שעון" tag and never a countdown.
- **The duel modal** (`showDuelModal`, [src/02-shop.js](../../../src/02-shop.js)) presents the three modes with distinct labels, colors, and a one-line explanation each, so Random vs Live is unmistakable.

### B. Score unification (kill the mismatch) — async modes 1 + 2

**Single source of truth, locked at submit time.**

- The moment the player submits their score in an async bot duel (`POST /api/duels/:id/score` → `is_bot_match` branch), the server computes the **final calibrated bot score once** via `_calibrateBotScore(duelId, playerScore, playerWinPct)` and **persists it immediately** (on the duel row, e.g. a `bot_final_score` field or by reusing `opponent_score` set at submit but only revealed at settle). This number is deterministic per `(duelId, playerScore)`.
- The spectator live-state endpoint (`_synthesizeBotLiveState`, [server.js:17076](../../../server.js)) interpolates the **displayed** score monotonically from its current value up to **exactly that locked final number**, using the trajectory progress ratio. The grid snapshot (`_snapshotForProgress`) follows the same ratio. No second target, no candidate formula.
- **Remove the result-flipping guard.** Because the live ceiling and the final now share one target, the displayed score can never overshoot the final, so the `MAX(calibrated, opponent_live_score)` bump that could flip a loss into a win ([server.js:9053-9062](../../../server.js)) is no longer needed and is removed. Monotonicity is preserved structurally (the curve only climbs toward the locked target), not by a post-hoc MAX.
- **Pre-submit display** (before the player has finished, if a spectator peeks) still climbs toward a believable estimate, but once the player submits, the target snaps to the locked final and the curve continues monotonically toward it (never downward — if the locked final is below the current displayed value, hold flat until settle rather than drop; in practice the estimate is tuned low enough that this is rare).
- Net invariant: **the number shown in the spectator widget at any time ≤ the final, climbing to exactly the final.** What the player watches is what they get.

### C. Real wager — all three modes, including vs bot

- **Inviter/initiator picks the wager** (gem amount) in all three modes, alongside difficulty.
- **Atomic deduction at entry** for both sides, reusing the friend-duel pattern ([server.js:16308-16315](../../../server.js)): `UPDATE player_profiles SET balance = balance - $1 WHERE balance >= $1 RETURNING balance`.
  - Friend duel: challenger deducts on create, opponent deducts on accept (already exists).
  - Random / Live: the initiating player deducts when they commit to the search. If matched with a **real** player, that player deducts on their side. If matched with a **bot**, only the player's stake is deducted (the bot's stake is virtual).
- **Payout at settle**, reusing the friend-duel settlement pool logic ([server.js:16823-16881](../../../server.js)): winner takes `2 × wager × (1 - rake)`, loser gets nothing; tie refunds both. For bot duels the same math applies against the virtual bot stake (player wins → credited `2 × wager × (1 - rake)`; player loses → already debited; tie → refunded).
- **Matchmaking matches on wager range** in addition to trophy + difficulty. Add a `wager` column to `duel_matchmaking_queue` and filter on an admin-tunable tolerance band (e.g. exact bucket, or ± a configurable %). Widen the band as poll_count grows (same pattern as the existing trophy-range widening) so a quiet queue still resolves.
- **Insufficient gems UX:** if the player lacks the chosen wager, surface an inline option to lower the wager or buy gems — never a dead-end error.
- **Refund on no-match / cancel / timeout:** if the player cancels the search or no match is found and the search is abandoned, the entry stake is refunded atomically. (Bot fallback always produces a match, so the refund path is mainly for explicit cancel.)

### D. Difficulty — inviter picks, bot honors, all modes

- The initiator's chosen difficulty is snapshotted onto the duel/queue row (already done for friend + live).
- Random + Live matchmaking pair only same-difficulty players (already partially done; confirm for async random).
- The async random **bot** plays the duel's difficulty: `_simulateBotDuelTrajectory` ([server.js:17413](../../../server.js)) already reads `difficulty_weights` from the duel row — ensure the async bot-spawn path (`_spawnBotDuelForPlayer` called with `live: false`, [server.js:8451](../../../server.js)) carries the difficulty through so the trajectory and calibration use it.
- Unify the BL.1.7 guarantee (duel difficulty always wins over practice-localStorage) across `startDuelGame` (async) and `startLiveRaceGame` (live).

### E. Addiction polish

- **Bot believability + drama:** keep ~52% player win rate, most games close, occasional blowout (existing `_calibrateBotScore` distribution). In live races the bot leads sometimes and lets the player overtake late. The overtake / win / close-loss moments fire `buzz` + sound + confetti.
- **Trophy + gems:** a win credits both the gem pool and trophies (Trophy Road integration). Losses to stronger opponents cost fewer trophies (new-player protection already exists).
- **One-tap rematch:** after any settled duel, a "⚔️ שוב" button re-opens the modal pre-filled with the same opponent/difficulty/wager (extend the existing `rematchDuel`).
- **Win/loss celebration:** distinct gold (win) / purple (tie) / pink (loss) result overlays with the real opponent score shown.

## Components touched

- **server.js** — `_spawnBotDuelForPlayer`, `find-random`, `find-random-live`, `POST /api/duels/:id/score` (bot branch), `_settleBotDuel`, `_settleLiveDuel`, `_calibrateBotScore`, `_botAsyncCandidateScore`, `_synthesizeBotLiveState`, `_simulateBotDuelTrajectory`, `_liveBotScoreAt`, wager deduction/payout helpers, matchmaking queue queries.
- **schema.sql / db.js** — `duel_matchmaking_queue` gains a `wager` column (idempotent ALTER); `duels` may gain a `bot_final_score` column if reusing `opponent_score` at submit is awkward; new `game_config` keys for wager tolerance band + any new tunables. All migrations idempotent.
- **src/02-shop.js** — duel modal (3 distinct modes + wager + difficulty pickers), `startDuelGame` / `startDuelOpponentHud` (no-clock tag, no countdown), `startLiveRaceGame` (unchanged clock), spectator widget (`injectDuelSpectatorWidget` / `pollDuelLiveState`), matchmaking overlays (wager display), rematch, insufficient-gems UX.
- **public/css/** — mode theming (purple / blue / red-pink), "♾️ no-clock" vs "⏱ 60s" tags, dark-theme overrides.
- **admin/index.html** — bot-duel stats already exist; surface wager economics (gems wagered / paid out) and the new tolerance config.
- **scripts/test_bot_scores.mjs** — extend with a "spectator-displayed score never exceeds and converges to final" assertion + a wager-conservation assertion (no gem creation/destruction beyond rake).

## Data flow (async bot duel, the critical path)

1. Player commits to Random search with `{difficulty, wager}` → stake deducted atomically.
2. No real opponent in 8s → `_spawnBotDuelForPlayer({live:false, difficulty, wager})` creates a `duels` row (`is_bot_match=TRUE`, `is_live` unset/FALSE, wager set, difficulty snapshotted).
3. Player plays full game → `POST /api/duels/:id/score`. Server detects bot match, computes `_calibrateBotScore(duelId, playerScore)` **once**, persists it as the locked final, sets `bot_settle_at = NOW() + random(20-55)s`, returns `result:'waiting'`.
4. Player watches spectator widget → polls `_synthesizeBotLiveState` → displayed score interpolates monotonically toward the **locked final**, grid from `_snapshotForProgress` at the same ratio.
5. `bot_settle_at` fires (ticker or lazy on poll) → `_settleBotDuel` reads the **already-locked** final (no re-roll, no MAX bump), picks winner, runs the wager payout (winner gets `2×wager×(1-rake)`), credits trophies, pushes result.
6. Player sees final overlay — the exact number the widget converged to. Zero mismatch.

## Error handling & invariants

- All gem mutations atomic and balance-guarded (no negative balances, no double-spend) — extends the §11 security-hardening pattern.
- Wager conservation: total gems out of player balances at entry = total gems back in at settle + rake. No gem creation. Verified by test.
- Spectator monotonicity: displayed bot score is non-decreasing and ≤ final, converging to exactly the final. Verified by test (extends the existing BL.1.3/BL.1.6 harness).
- Determinism: `_calibrateBotScore(duelId, playerScore)` stays seeded by duelId → same inputs, same output (preserve BL.1.3 guarantee).
- Idempotent settle: settling an already-settled duel is a no-op (existing `FOR UPDATE` + status guard).
- Difficulty isolation: practice-localStorage difficulty never bleeds into a duel (BL.1.7, unified across async + live).

## Testing

- `node scripts/test_engine.mjs` — engine self-test clean (200 games / 0 floating tiles), as every stage does.
- `node scripts/test_bot_scores.mjs` — all existing assertions pass 3× identical, **plus** new assertions: (a) spectator-displayed ≤ final and converges to final across the full poll lifecycle; (b) wager conservation across many simulated duels.
- **Live verification with real bots:** spawn bots via the bot engine, run actual async-random + live-race bot duels against the live deploy, use Chrome DevTools to watch the spectator widget and confirm the displayed score matches the final result and the wager debits/credits are correct. This is the acceptance gate for the mismatch fix.
- Manual: insufficient-gems path, cancel-refund path, rematch, difficulty applied to bot, no 60s timer anywhere in async.

## Out of scope

- Real-money (Stripe) wager — gems only.
- True WebSocket live race — the polling MVP stays.
- Collapsing the three modes into fewer (explicitly rejected by the user).

## Rollout

Per project convention: bump cache buster + SW version, update CLAUDE.md change-log + APIs/schema sections, commit + push + `railway up` + `/api/health` check.
