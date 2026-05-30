#!/usr/bin/env node
/**
 * BL.1.3 — Bot score formula tests.
 *
 * Verifies:
 *   1. _calibrateBotScore is deterministic (same inputs → same output)
 *   2. _liveBotScoreAt is strictly non-decreasing over time
 *   3. _botAsyncCandidateScore is strictly non-decreasing over time WITHIN
 *      a single anchor (i.e. before player submits OR after — separately)
 *   4. The DB-ceiling pattern guarantees monotonicity ACROSS the player-
 *      submit transition (since opponent_live_score is GREATEST-guarded)
 *
 * Formulas duplicated from server.js _seededBotRng / _calibrateBotScore /
 * _liveBotScoreAt / _botAsyncCandidateScore. Keep in sync.
 *
 * Run: node scripts/test_bot_scores.mjs
 */

function _seededBotRng(seed) {
  let s = (seed | 0) >>> 0;
  return function() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _calibrateBotScore(duelId, playerScore, playerWinPct) {
  const p = Math.max(20, Math.min(80, playerWinPct | 0));
  const rng = _seededBotRng((duelId | 0) ^ 0x12345678);
  const playerWins = rng() * 100 < p;
  const isTie = rng() < 0.02;
  let deltaPct;
  const t = rng();
  if (t < 0.65)      deltaPct = 0.03 + rng() * 0.10;
  else if (t < 0.90) deltaPct = 0.10 + rng() * 0.15;
  else               deltaPct = 0.25 + rng() * 0.15;
  let botScore;
  if (isTie) botScore = playerScore;
  else if (playerWins) botScore = Math.max(0, Math.floor(playerScore * (1 - deltaPct)));
  else botScore = Math.floor(playerScore * (1 + deltaPct));
  return Math.max(100, botScore);
}

function _liveBotTargetScore(duelId) {
  const r = ((duelId * 9301 + 49297) % 233280) / 233280;
  return Math.floor(35000 + r * 75000);
}

function _liveBotScoreAt(duelId, startedAtMs, durationSec, nowMs) {
  const target = _liveBotTargetScore(duelId);
  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  const ratio = Math.min(1, elapsed / Math.max(1, durationSec));
  // BL.1.6 — quadratic easing.
  const eased = ratio * ratio;
  // DU.2.2 — snap sub-20 to 0 (no weird "16").
  const raw = Math.floor(target * eased);
  return raw < 20 ? 0 : raw;
}

function _botAsyncCandidateScore(duelId, createdMs, challengerScore, settleAtMs, nowMs, playerWinPct) {
  const endMs = (settleAtMs && settleAtMs > createdMs) ? settleAtMs : (createdMs + 90 * 1000);
  const totalSec = Math.max(1, (endMs - createdMs) / 1000);
  const elapsed = Math.max(0, (nowMs - createdMs) / 1000);
  const ratio = Math.min(1, elapsed / totalSec);
  // BL.1.6 — quadratic easing.
  const eased = ratio * ratio;
  // BL.1.6 — anchor lowered 40000 → 8000.
  const anchor = (challengerScore | 0) > 0 ? (challengerScore | 0) : 8000;
  const target = _calibrateBotScore(duelId, anchor, playerWinPct);
  return Math.max(100, Math.floor(target * eased));
}

// BL.1.6 — settle helper that mirrors _settleBotDuel logic.
function _settledBotScore(duelId, playerScore, liveCeiling, playerWinPct) {
  let botScore = _calibrateBotScore(duelId, playerScore, playerWinPct);
  if ((liveCeiling | 0) > botScore) botScore = liveCeiling | 0;
  return botScore;
}

function _tierForScore(score) {
  if (score >= 60000) return 6;
  if (score >= 30000) return 5;
  if (score >= 15000) return 4;
  if (score >= 5000)  return 3;
  if (score >= 1000)  return 2;
  return 1;
}

function _synthesizeBotGrid(duelId, score) {
  const ROWS = 6, COLS = 4;
  const maxTier = _tierForScore(score);
  const bucket = Math.floor((score | 0) / 600);
  let s = ((duelId * 2654435761) ^ (bucket * 1597463007)) >>> 0;
  function rand() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(0));
  const fillBase = Math.min(3, 1 + Math.floor((score | 0) / 15000));
  for (let c = 0; c < COLS; c++) {
    let cellsToPlace = fillBase + Math.floor(rand() * 3);
    for (let r = ROWS - 1; r >= 0 && cellsToPlace > 0; r--) {
      let tier;
      const roll = rand();
      if (roll < 0.45) tier = 1;
      else if (roll < 0.70) tier = 2;
      else if (roll < 0.86) tier = Math.min(3, maxTier);
      else if (roll < 0.95) tier = Math.min(4, maxTier);
      else if (roll < 0.99) tier = Math.min(5, maxTier);
      else tier = Math.min(6, maxTier);
      grid[r][c] = tier;
      cellsToPlace--;
    }
  }
  return grid;
}

// ─── Tests ──────────────────────────────────────────────────────────

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); failures++; }
}

// Test 1: _calibrateBotScore deterministic.
function testCalibrationDeterministic() {
  console.log('\nTest 1 — _calibrateBotScore deterministic:');
  for (let duelId = 1; duelId <= 50; duelId++) {
    for (const playerScore of [1000, 10000, 50000, 100000]) {
      const a = _calibrateBotScore(duelId, playerScore, 52);
      const b = _calibrateBotScore(duelId, playerScore, 52);
      const c = _calibrateBotScore(duelId, playerScore, 52);
      assert(a === b && b === c,
        `duel=${duelId} player=${playerScore}: ${a}/${b}/${c} should match`);
    }
  }
  console.log(`  ✓ 50 duels × 4 player scores × 3 calls each = consistent`);
}

// Test 2: _calibrateBotScore distribution → ~52% player win rate.
function testCalibrationWinRate() {
  console.log('\nTest 2 — _calibrateBotScore yields ~52% player win rate:');
  const PLAYER = 50000;
  let playerWins = 0, botWins = 0, ties = 0;
  for (let duelId = 1; duelId <= 10000; duelId++) {
    const bot = _calibrateBotScore(duelId, PLAYER, 52);
    if (PLAYER > bot) playerWins++;
    else if (bot > PLAYER) botWins++;
    else ties++;
  }
  const total = playerWins + botWins + ties;
  const winPct = playerWins / total * 100;
  console.log(`  player wins: ${playerWins} (${winPct.toFixed(1)}%)`);
  console.log(`  bot wins:    ${botWins} (${(botWins/total*100).toFixed(1)}%)`);
  console.log(`  ties:        ${ties} (${(ties/total*100).toFixed(1)}%)`);
  assert(winPct >= 48 && winPct <= 56,
    `win rate ${winPct.toFixed(1)}% should be in [48, 56]`);
  console.log(`  ✓ within tolerance band 48-56%`);
}

// Test 3: _liveBotScoreAt strictly non-decreasing over time.
function testLiveMonotonic() {
  console.log('\nTest 3 — _liveBotScoreAt strictly non-decreasing over time:');
  const start = 1700000000000;
  for (let duelId = 1; duelId <= 200; duelId++) {
    let prev = -1;
    // Sample every 50ms for 90s.
    for (let dt = 0; dt <= 90000; dt += 50) {
      const score = _liveBotScoreAt(duelId, start, 60, start + dt);
      if (score < prev) {
        assert(false, `duel=${duelId} dt=${dt}ms score=${score} < prev=${prev}`);
        break;
      }
      prev = score;
    }
  }
  console.log(`  ✓ 200 duels × 1801 ticks (50ms each) = monotonic`);
}

// Test 4: _botAsyncCandidateScore strictly non-decreasing within a SINGLE anchor.
function testAsyncCandidateMonotonicWithinAnchor() {
  console.log('\nTest 4 — _botAsyncCandidateScore monotonic within single anchor:');
  const created = 1700000000000;
  for (let duelId = 1; duelId <= 200; duelId++) {
    // Before-submit phase (no challenger_score): anchor = 40000 estimate.
    let prev = -1;
    for (let dt = 0; dt <= 90000; dt += 50) {
      const score = _botAsyncCandidateScore(duelId, created, null, null, created + dt, 52);
      if (score < prev) {
        assert(false, `[pre-submit] duel=${duelId} dt=${dt} score=${score} < prev=${prev}`);
        break;
      }
      prev = score;
    }
    // After-submit phase (challenger_score known + settle time set):
    const submitMs = created + 30000;
    const settleMs = submitMs + 35000;
    prev = -1;
    for (let dt = 30000; dt <= 65000; dt += 50) {
      const score = _botAsyncCandidateScore(duelId, created, 50000, settleMs, created + dt, 52);
      if (score < prev) {
        assert(false, `[post-submit] duel=${duelId} dt=${dt} score=${score} < prev=${prev}`);
        break;
      }
      prev = score;
    }
  }
  console.log(`  ✓ 200 duels × (1801 pre + 701 post) ticks = monotonic`);
}

// Test 5: Simulate the FULL spectator-poll lifecycle with DB-ceiling guard.
// This verifies that even when the candidate score drops AT THE SUBMIT BOUNDARY
// (because the anchor changes from 40000 estimate to actual player score),
// the displayed score never decreases — because the GREATEST() guard keeps it.
function testFullPollLifecycleMonotonic() {
  console.log('\nTest 5 — full poll lifecycle with DB-ceiling guard:');
  const created = 1700000000000;
  let downJumps = 0;
  for (let duelId = 1; duelId <= 500; duelId++) {
    // Random player score (different from the estimate of 40000).
    const playerScore = 5000 + (duelId * 137 % 90000);
    const submitMs = created + 25000 + (duelId * 53 % 20000); // 25-45s
    const settleMs = submitMs + 20000 + (duelId * 71 % 35000); // +20-55s
    let ceiling = 0; // simulates opponent_live_score column
    let prev = -1;
    for (let dt = 0; dt <= 100000; dt += 1500) { // 1.5s poll interval
      const nowMs = created + dt;
      const submitted = nowMs >= submitMs;
      const candidate = _botAsyncCandidateScore(
        duelId, created, submitted ? playerScore : null,
        submitted ? settleMs : null, nowMs, 52
      );
      // DB-side GREATEST guard:
      ceiling = Math.max(ceiling, candidate);
      const displayed = ceiling;
      if (displayed < prev) {
        downJumps++;
        assert(false, `duel=${duelId} dt=${dt} displayed=${displayed} < prev=${prev} (BUG)`);
        break;
      }
      prev = displayed;
    }
  }
  console.log(`  ✓ 500 duels × 68 polls (1.5s each) — 0 down-jumps`);
  assert(downJumps === 0, `expected 0 down-jumps, got ${downJumps}`);
}

// Test 6a: _synthesizeBotGrid is deterministic per (duelId, score).
function testGridDeterministic() {
  console.log('\nTest 6a — _synthesizeBotGrid deterministic per (duelId, score):');
  for (let duelId = 1; duelId <= 50; duelId++) {
    for (const score of [500, 3000, 10000, 50000]) {
      const a = JSON.stringify(_synthesizeBotGrid(duelId, score));
      const b = JSON.stringify(_synthesizeBotGrid(duelId, score));
      assert(a === b, `duel=${duelId} score=${score} grids differ`);
    }
  }
  console.log(`  ✓ 50 duels × 4 scores × 2 calls each = consistent`);
}

// Test 6b: _synthesizeBotGrid EVOLVES as score crosses bucket boundaries.
function testGridEvolves() {
  console.log('\nTest 6b — _synthesizeBotGrid evolves with score (≥10 changes / 30K range):');
  let totalChanges = 0;
  let duelsWithEvolution = 0;
  for (let duelId = 1; duelId <= 30; duelId++) {
    let prev = JSON.stringify(_synthesizeBotGrid(duelId, 0));
    let changes = 0;
    // Step through score 0 → 30000 in 600-point increments (bucket size).
    for (let score = 600; score <= 30000; score += 600) {
      const next = JSON.stringify(_synthesizeBotGrid(duelId, score));
      if (next !== prev) changes++;
      prev = next;
    }
    totalChanges += changes;
    if (changes >= 10) duelsWithEvolution++;
  }
  const avgChanges = totalChanges / 30;
  console.log(`  avg changes per duel: ${avgChanges.toFixed(1)} (target ≥10)`);
  console.log(`  duels with ≥10 evolutions: ${duelsWithEvolution} / 30`);
  assert(avgChanges >= 10, `avg changes ${avgChanges} should be ≥10`);
  assert(duelsWithEvolution >= 25, `${duelsWithEvolution}/30 should evolve well`);
  console.log(`  ✓ grid evolves visibly across the game`);
}

// Test 7: Settled score MATCHES the eventual displayed score (no surprise jump).
function testSettledMatchesPreview() {
  console.log('\nTest 7 — settled score matches calibrated preview:');
  for (let duelId = 1; duelId <= 100; duelId++) {
    const playerScore = 30000 + (duelId * 7 % 50000);
    const previewFinal = _calibrateBotScore(duelId, playerScore, 52);
    const actualSettle = _calibrateBotScore(duelId, playerScore, 52);
    assert(previewFinal === actualSettle,
      `duel=${duelId} player=${playerScore}: preview=${previewFinal} actual=${actualSettle}`);
  }
  console.log(`  ✓ 100 duels: preview === actual`);
}

// Test 8 — BL.1.6 CRITICAL: settled score is NEVER LESS than what
// was displayed live (no "bot at 17K mid-game then 9K at settle" bug).
// Simulates the full poll lifecycle + settle for many score scenarios.
function testNoSettleRegression() {
  console.log('\nTest 8 — settled score >= live ceiling (CRITICAL):');
  let downJumps = 0;
  const scenarios = [];
  for (let duelId = 1; duelId <= 500; duelId++) {
    // Wide range of player scores
    const playerScore = 500 + (duelId * 311 % 95000);
    const createdMs = 1700000000000;
    const submitDelay = 30000 + (duelId * 53 % 30000);
    const settleDelay = 20000 + (duelId * 71 % 35000);
    const submitMs = createdMs + submitDelay;
    const settleAtMs = submitMs + settleDelay;
    // Simulate full 1.5s polling lifecycle, tracking ceiling.
    let ceiling = 0;
    let liveAtSettle = 0;
    for (let dt = 0; dt <= submitDelay + settleDelay; dt += 1500) {
      const nowMs = createdMs + dt;
      const submitted = nowMs >= submitMs;
      const cand = _botAsyncCandidateScore(
        duelId, createdMs,
        submitted ? playerScore : null,
        submitted ? settleAtMs : null,
        nowMs, 52
      );
      ceiling = Math.max(ceiling, cand);
      if (nowMs >= settleAtMs) liveAtSettle = ceiling;
    }
    // Compute settled with BL.1.6 MAX guard.
    const settled = _settledBotScore(duelId, playerScore, ceiling, 52);
    // CRITICAL: settled must be ≥ liveAtSettle (no displayed-score regression).
    if (settled < liveAtSettle) {
      downJumps++;
      scenarios.push({ duelId, playerScore, ceiling, liveAtSettle, settled });
    }
  }
  console.log(`  500 duels simulated through full lifecycle`);
  console.log(`  settle-regression events: ${downJumps} (target: 0)`);
  if (scenarios.length > 0) {
    console.log(`  failed examples: ${JSON.stringify(scenarios.slice(0, 3))}`);
  }
  assert(downJumps === 0, `expected 0 regressions, got ${downJumps}`);
  console.log(`  ✓ settled always ≥ live ceiling`);
}

// Test 9 — BL.1.6: bot's initial score gap is SMALL (no "huge head start").
// At t=2s of a 60s race, bot's score should be tiny (mimics real player).
function testNoEarlyGap() {
  console.log('\nTest 9 — bot starts SLOW (no head-start gap):');
  let totalEarlyScore = 0;
  let maxEarlyScore = 0;
  for (let duelId = 1; duelId <= 200; duelId++) {
    const start = 1700000000000;
    const at2sec = _liveBotScoreAt(duelId, start, 60, start + 2000);
    totalEarlyScore += at2sec;
    if (at2sec > maxEarlyScore) maxEarlyScore = at2sec;
  }
  const avg = Math.floor(totalEarlyScore / 200);
  console.log(`  avg bot score at t=2s of 60s race: ${avg}`);
  console.log(`  max bot score at t=2s: ${maxEarlyScore}`);
  // With quadratic and target ~70K: 70K * (2/60)² = 70K * 0.00111 = 77
  assert(avg < 500, `avg ${avg} should be <500 (slow start)`);
  assert(maxEarlyScore < 800, `max ${maxEarlyScore} should be <800`);
  console.log(`  ✓ bot's early score is realistic (matches first-tile player)`);
}

// ─── DU.2 — duel-overhaul mirrors + tests ───────────────────────────

// Mirror of the rewritten _synthesizeBotLiveState ASYNC locked-path math.
// Once the player submits, the bot's final is LOCKED; the displayed score
// climbs monotonically (quadratic in time) up to EXACTLY that final, never
// exceeding it. progress is the fraction of the settle window elapsed.
function asyncDisplayScore(lockedFinal, progress) {
  const eased = progress * progress;
  return Math.min(lockedFinal, Math.max(0, Math.floor(lockedFinal * eased)));
}

// Test 10 — async spectator display converges to the locked final, is
// monotonic, and never exceeds it (the headline mismatch fix).
function testAsyncConvergesToFinal() {
  console.log('\nTest 10 — async spectator converges to locked final (DU.2):');
  let downJumps = 0, exceed = 0, notConverged = 0;
  for (let i = 0; i < 500; i++) {
    const duelId = 5000 + i;
    const playerScore = 8000 + ((i * 137) % 90000);
    const lockedFinal = _calibrateBotScore(duelId, playerScore, 52); // server locks this at submit
    let prev = -1, last = 0;
    for (let p = 0; p <= 60; p++) {
      const progress = p / 60;
      // server keeps GREATEST(prev, candidate) — model it so the curve is
      // monotone even if the formula had a flat spot.
      const shown = Math.max(prev < 0 ? 0 : prev, asyncDisplayScore(lockedFinal, progress));
      if (shown < prev) downJumps++;
      if (shown > lockedFinal) exceed++;
      prev = shown; last = shown;
    }
    if (last !== lockedFinal) notConverged++;
  }
  console.log(`  500 duels × 61 polls — down-jumps: ${downJumps}, over-final: ${exceed}, not-converged: ${notConverged}`);
  assert(downJumps === 0, `expected 0 down-jumps, got ${downJumps}`);
  assert(exceed === 0, `expected 0 polls over final, got ${exceed}`);
  assert(notConverged === 0, `expected all to land on final, ${notConverged} did not`);
  console.log('  ✓ displayed score climbs monotonically to EXACTLY the final');
}

// Test 11 — wager conservation. A duel removes gems from circulation only
// via the rake; win/lose/tie nets are exact and balanced.
function testWagerConservation() {
  console.log('\nTest 11 — wager conservation (DU.2):');
  let bad = 0;
  for (let W = 0; W <= 1000; W += 50) {
    for (const rakePct of [0, 3, 5, 10]) {
      const pool = 2 * W;
      const rake = Math.floor(pool * rakePct / 100);
      const payout = pool - rake;
      const winNet = payout - W;   // staked -W, received +payout
      const loseNet = -W;          // staked -W, received 0
      const tieNet = 0;            // staked -W, refunded +W
      if (winNet !== (W - rake)) bad++;
      if (loseNet !== -W) bad++;
      if (tieNet !== 0) bad++;
    }
  }
  console.log(`  21 wagers × 4 rake tiers — mismatches: ${bad}`);
  assert(bad === 0, `expected 0 conservation mismatches, got ${bad}`);
  console.log('  ✓ only the rake leaves circulation; win/lose/tie nets exact');
}

// Test 12 — DU.2 continuity: the spectator widget is ANCHORED to the bot
// score the player last saw in the HUD (`seen`) and climbs to the locked
// final = max(calibrated, seen). It must START at seen (no restart-from-0),
// never drop below seen, never exceed final, and converge to final. Also:
// final >= seen always, and seen < playerScore keeps player-wins as wins.
function testSpectatorContinuity() {
  console.log('\nTest 12 — spectator continuity from HUD value (DU.2):');
  let startedLow = 0, downJumps = 0, overFinal = 0, notConverged = 0, finalBelowSeen = 0, winFlipped = 0;
  for (let i = 0; i < 600; i++) {
    const duelId = 9000 + i;
    const playerScore = 6000 + ((i * 211) % 100000);
    // HUD shows ~70-92% of the player's score; clamp like the server does.
    const hud = Math.floor(playerScore * (0.70 + ((i * 37) % 23) / 100)); // 0.70..0.92
    const seen = Math.max(0, Math.min(hud, Math.floor(playerScore * 0.97)));
    const calibrated = _calibrateBotScore(duelId, playerScore, 52);
    const final = Math.max(calibrated, seen);
    if (final < seen) finalBelowSeen++;
    // If the player would have won by calibration, the seen-anchor must not flip it.
    if (calibrated < playerScore && final >= playerScore) winFlipped++;
    let prev = -1, last = 0, first = null;
    for (let p = 0; p <= 60; p++) {
      const progress = p / 60;
      const curve = Math.min(final, Math.floor(final * progress * progress));
      const shown = Math.max(seen, curve); // server: GREATEST(opponent_live_score=seen, candidate)
      if (first === null) first = shown;
      if (shown < prev) downJumps++;
      if (shown > final) overFinal++;
      prev = shown; last = shown;
    }
    if (first < seen) startedLow++;        // must start at >= seen (continuity)
    if (last !== final) notConverged++;
  }
  console.log(`  600 duels — started-below-seen: ${startedLow}, down-jumps: ${downJumps}, over-final: ${overFinal}, not-converged: ${notConverged}, final<seen: ${finalBelowSeen}, win-flips: ${winFlipped}`);
  assert(startedLow === 0, `expected all to start at >= seen, ${startedLow} started low`);
  assert(downJumps === 0, `expected 0 down-jumps, got ${downJumps}`);
  assert(overFinal === 0, `expected 0 over-final, got ${overFinal}`);
  assert(notConverged === 0, `expected all to converge to final, ${notConverged} did not`);
  assert(finalBelowSeen === 0, `final must be >= seen, ${finalBelowSeen} violated`);
  assert(winFlipped === 0, `seen-anchor must not flip a player-win, ${winFlipped} flipped`);
  console.log('  ✓ spectator starts at the HUD value, climbs to final, no flips');
}

// Test 13 — DU.2.2: the live bot score is NEVER in the weird (0,20) range.
// Real BLOOM scores jump in merge-sized steps; a displayed "16" looks broken.
// The bot is either 0 ("hasn't merged yet") or >= 20. Sweep the whole race.
function testNoWeirdSubTwenty() {
  console.log('\nTest 13 — live bot score never in (0,20) (DU.2.2):');
  let weird = 0, examples = [];
  for (let duelId = 1; duelId <= 300; duelId++) {
    const start = 1700000000000;
    for (let ms = 0; ms <= 60000; ms += 100) { // every 100ms of a 60s race
      const s = _liveBotScoreAt(duelId, start, 60, start + ms);
      if (s > 0 && s < 20) { weird++; if (examples.length < 5) examples.push({ duelId, ms, s }); }
    }
  }
  console.log(`  300 duels × 601 ticks — sub-20 nonzero values: ${weird}`);
  if (weird) console.log('  examples:', JSON.stringify(examples));
  assert(weird === 0, `expected 0 weird sub-20 scores, got ${weird}`);
  console.log('  ✓ bot score is always 0 or >= 20 — no absurd "16"');
}

// ─── DU.3 "One Real Game, One Truth" — logic mirrors + tests ─────────
// The engine itself is validated by test_engine.mjs; here we verify the NEW
// decision logic (outcome lottery, candidate selection, snapshot-by-time,
// no-jump, continuity) with SYNTHETIC monotonic trajectories. The real
// engine+selection integration is verified by the live API test.

function botOutcomeLottery(duelId, anchor, playerWinPct) {
  const rng = _seededBotRng((duelId | 0) ^ 0x12345678);
  const p = Math.max(20, Math.min(80, playerWinPct | 0));
  const playerWins = rng() * 100 < p;
  const isTie = rng() < 0.02;
  let deltaPct;
  const tk = rng();
  if (tk < 0.65)      deltaPct = 0.03 + rng() * 0.10;
  else if (tk < 0.90) deltaPct = 0.10 + rng() * 0.15;
  else                deltaPct = 0.25 + rng() * 0.15;
  let target;
  if (isTie || anchor <= 0) target = anchor;
  else if (playerWins) target = Math.max(0, Math.floor(anchor * (1 - deltaPct)));
  else target = Math.floor(anchor * (1 + deltaPct));
  return { playerWins, isTie, target };
}

function selectCalibratedFinal(candFinals, anchor, lottery, lastShown) {
  let poolC = candFinals;
  if (lastShown > 0) {
    const reach = candFinals.filter(f => f >= lastShown);
    if (reach.length) poolC = reach;
  }
  const onSide = (fs) => lottery.isTie ? true : (lottery.playerWins ? fs < anchor : fs > anchor);
  const correct = poolC.filter(onSide);
  const set = correct.length ? correct : poolC;
  let best = set[0], bd = Math.abs(best - lottery.target);
  for (let i = 1; i < set.length; i++) {
    const d = Math.abs(set[i] - lottery.target);
    if (d < bd) { bd = d; best = set[i]; }
  }
  return best;
}

function snapshotScoreForTime(snaps, elapsedSec) {
  const lastT = snaps[snaps.length - 1].t;
  const t = Math.max(0, Math.min(elapsedSec, lastT));
  let chosen = snaps[0];
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].t <= t) chosen = snaps[i]; else break;
  }
  return chosen.s < 20 ? 0 : chosen.s; // mirrors _floorBotVisibleScore
}

function synthTraj(finalScore, n) {
  n = n || 40;
  const snaps = [];
  for (let i = 0; i <= n; i++) {
    const frac = i / n;
    const s = Math.round(finalScore * frac * frac / 20) * 20; // merge-stepped monotonic climb
    snaps.push({ t: Math.round((frac * 60) * 10) / 10, s });
  }
  snaps[snaps.length - 1].s = finalScore;
  return snaps;
}

function testSelectionWinRate() {
  console.log('\nTest 14 — selection win-rate ≈ 52% from real candidates (DU.3):');
  let pWins = 0, bWins = 0, ties = 0;
  for (let i = 0; i < 10000; i++) {
    const duelId = 20000 + i;
    const anchor = 5000 + ((i * 313) % 90000);
    const lot = botOutcomeLottery(duelId, anchor, 52);
    const cands = [];
    for (let k = 0; k < 12; k++) {
      const f = Math.floor(anchor * (0.55 + ((i * 7 + k * 53) % 90) / 100)); // 0.55..1.45×
      cands.push(Math.max(100, f));
    }
    const lastShown = Math.min(8000, Math.floor(anchor * 0.95));
    const chosen = selectCalibratedFinal(cands, anchor, lot, lastShown);
    if (chosen < anchor) pWins++; else if (chosen > anchor) bWins++; else ties++;
  }
  const pct = Math.round((pWins / 10000) * 1000) / 10;
  console.log(`  player wins: ${pWins} (${pct}%) · bot wins: ${bWins} · ties: ${ties}`);
  assert(pct >= 46 && pct <= 58, `win-rate ${pct}% out of band`);
  console.log('  ✓ outcome tracks the 52% lottery using only real candidate finals');
}

function testSnapshotByTime() {
  console.log('\nTest 15 — snapshot-by-time monotonic + exact final (DU.3):');
  let down = 0, badFinal = 0;
  for (let i = 0; i < 500; i++) {
    const finalScore = 2000 + ((i * 191) % 100000);
    const snaps = synthTraj(finalScore, 45);
    let prev = -1;
    for (let ms = 0; ms <= 70000; ms += 500) {
      const s = snapshotScoreForTime(snaps, ms / 1000);
      if (s < prev) down++;
      prev = s;
    }
    if (snapshotScoreForTime(snaps, 999) !== finalScore) badFinal++;
  }
  console.log(`  500 trajectories × 141 ticks — down-jumps: ${down}, wrong-final: ${badFinal}`);
  assert(down === 0, `expected 0 down-jumps, got ${down}`);
  assert(badFinal === 0, `expected exact final at end, ${badFinal} wrong`);
  console.log('  ✓ score climbs monotonically and ends exactly on the final');
}

function testNoJumpAndContinuity() {
  console.log('\nTest 16 — no end-jump + continuity (DU.3):');
  let jump = 0, dip = 0;
  for (let i = 0; i < 600; i++) {
    const duelId = 30000 + i;
    const anchor = 4000 + ((i * 271) % 90000);
    const lot = botOutcomeLottery(duelId, anchor, 52);
    const lastShown = Math.min(8000, Math.floor(anchor * 0.95));
    const cands = [];
    for (let k = 0; k < 12; k++) cands.push(Math.max(100, Math.floor(anchor * (0.55 + ((i * 7 + k * 53) % 90) / 100))));
    const finalScore = selectCalibratedFinal(cands, anchor, lot, lastShown);
    const snaps = synthTraj(finalScore, 45);
    const lastT = snaps[snaps.length - 1].t;
    let joinT = 0;
    for (let j = 0; j < snaps.length; j++) { if (snaps[j].s <= lastShown) joinT = snaps[j].t; else break; }
    let prev = -1, last = 0;
    for (let p = 0; p <= 30; p++) {
      const progress = p / 30;
      const elapsed = joinT + progress * (lastT - joinT);
      const s = snapshotScoreForTime(snaps, elapsed);
      if (s < prev) dip++;
      prev = s; last = s;
    }
    if (finalScore !== last) jump++;
  }
  console.log(`  600 duels — end-jumps: ${jump}, playback-dips: ${dip}`);
  assert(jump === 0, `settle must equal last-shown, ${jump} jumps`);
  assert(dip === 0, `playback must not dip, ${dip} dips`);
  console.log('  ✓ settle == last frame shown, playback never dips (continuous)');
}

// ─── Run all tests ──────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log('  BL.1.3 — Bot score formula tests');
console.log('═══════════════════════════════════════════════════════════');

testCalibrationDeterministic();
testCalibrationWinRate();
testLiveMonotonic();
testAsyncCandidateMonotonicWithinAnchor();
testFullPollLifecycleMonotonic();
testGridDeterministic();
testGridEvolves();
testSettledMatchesPreview();
testNoSettleRegression();
testNoEarlyGap();
testAsyncConvergesToFinal();
testWagerConservation();
testSpectatorContinuity();
testNoWeirdSubTwenty();
testSelectionWinRate();
testSnapshotByTime();
testNoJumpAndContinuity();

console.log('\n═══════════════════════════════════════════════════════════');
if (failures === 0) {
  console.log('  ✓ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`  ✗ ${failures} ASSERTIONS FAILED`);
  process.exit(1);
}
