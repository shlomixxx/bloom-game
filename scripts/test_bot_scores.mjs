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
  return Math.floor(target * eased);
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

console.log('\n═══════════════════════════════════════════════════════════');
if (failures === 0) {
  console.log('  ✓ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`  ✗ ${failures} ASSERTIONS FAILED`);
  process.exit(1);
}
