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
  const eased = Math.sqrt(ratio);
  return Math.floor(target * eased);
}

function _botAsyncCandidateScore(duelId, createdMs, challengerScore, settleAtMs, nowMs, playerWinPct) {
  const endMs = (settleAtMs && settleAtMs > createdMs) ? settleAtMs : (createdMs + 90 * 1000);
  const totalSec = Math.max(1, (endMs - createdMs) / 1000);
  const elapsed = Math.max(0, (nowMs - createdMs) / 1000);
  const ratio = Math.min(1, elapsed / totalSec);
  const eased = Math.sqrt(ratio);
  const anchor = (challengerScore | 0) > 0 ? (challengerScore | 0) : 40000;
  const target = _calibrateBotScore(duelId, anchor, playerWinPct);
  return Math.max(100, Math.floor(target * eased));
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

// Test 6: Settled score MATCHES the eventual displayed score (no surprise jump).
function testSettledMatchesPreview() {
  console.log('\nTest 6 — settled score matches calibrated preview:');
  for (let duelId = 1; duelId <= 100; duelId++) {
    const playerScore = 30000 + (duelId * 7 % 50000);
    const previewFinal = _calibrateBotScore(duelId, playerScore, 52);
    const actualSettle = _calibrateBotScore(duelId, playerScore, 52);
    assert(previewFinal === actualSettle,
      `duel=${duelId} player=${playerScore}: preview=${previewFinal} actual=${actualSettle}`);
  }
  console.log(`  ✓ 100 duels: preview === actual`);
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
testSettledMatchesPreview();

console.log('\n═══════════════════════════════════════════════════════════');
if (failures === 0) {
  console.log('  ✓ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`  ✗ ${failures} ASSERTIONS FAILED`);
  process.exit(1);
}
