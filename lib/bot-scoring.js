// lib/bot-scoring.js — PURE bot-duel scoring math, extracted from server.js
// (QA improvement plan, Sprint 3: incremental server.js decomposition).
//
// Every function here is deterministic and side-effect-free — no DB, no config
// cache, no req/res. That makes them unit-testable in isolation: server.js AND
// scripts/test_bot_scores.mjs both import from this ONE module, so the test
// validates the REAL production code instead of a hand-kept copy (the old
// "keep in sync" duplication is gone → the formulas can never silently drift).

// Deterministic per-seed PRNG (Mulberry32-style) so a duel's live preview and
// its final settled value are computed from the same stream → no surprise jump.
export function _seededBotRng(seed) {
  let s = (seed | 0) >>> 0;
  return function() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Final calibrated bot score for an async duel — seeded on duelId so the live
// preview and the settle agree. playerWinPct biases the win/loss split.
export function _calibrateBotScore(duelId, playerScore, playerWinPct) {
  const p = Math.max(20, Math.min(80, playerWinPct | 0));
  const rng = _seededBotRng((duelId | 0) ^ 0x12345678);
  const playerWins = rng() * 100 < p;
  const isTie = rng() < 0.02;
  let deltaPct;
  const t = rng();
  if (t < 0.65)      deltaPct = 0.03 + rng() * 0.10;  // 65% → 3-13%
  else if (t < 0.90) deltaPct = 0.10 + rng() * 0.15;  // 25% → 10-25%
  else               deltaPct = 0.25 + rng() * 0.15;  // 10% → 25-40%
  let botScore;
  if (isTie) botScore = playerScore;
  else if (playerWins) botScore = Math.max(0, Math.floor(playerScore * (1 - deltaPct)));
  else botScore = Math.floor(playerScore * (1 + deltaPct));
  return Math.max(100, botScore); // never show "0" — looks like a failure
}

// Deterministic per-duel-id target final score for live bot duels.
export function _liveBotTargetScore(duelId) {
  const r = ((duelId * 9301 + 49297) % 233280) / 233280;
  return Math.floor(35000 + r * 75000); // 35K-110K final
}

// DU.2.2 — a real BLOOM score jumps in merge-sized steps (a first tier-1 merge
// is ~20 pts); nothing ever reads as "16". So any computed bot score below this
// threshold is shown as 0 ("hasn't merged yet") rather than an absurd 1-19.
export const BOT_MIN_VISIBLE_SCORE = 20;
export function _floorBotVisibleScore(raw) {
  raw = raw | 0;
  return raw < BOT_MIN_VISIBLE_SCORE ? 0 : raw;
}

// BL.1.6 — bot's "live score" for live races. QUADRATIC easing so the bot
// starts slow like a real player still placing initial pieces, then accelerates.
export function _liveBotScoreAt(duelId, startedAtMs, durationSec, nowMs) {
  const target = _liveBotTargetScore(duelId);
  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  const ratio = Math.min(1, elapsed / Math.max(1, durationSec));
  const eased = ratio * ratio;
  return _floorBotVisibleScore(Math.floor(target * eased));
}

// BL.1.6 — pre-submit async candidate score (quadratic easing; anchor 8000 when
// the challenger hasn't submitted, else the challenger's score).
export function _botAsyncCandidateScore(duelId, createdMs, challengerScore, settleAtMs, nowMs, playerWinPct) {
  const endMs = (settleAtMs && settleAtMs > createdMs) ? settleAtMs : (createdMs + 90 * 1000);
  const totalSec = Math.max(1, (endMs - createdMs) / 1000);
  const elapsed = Math.max(0, (nowMs - createdMs) / 1000);
  const ratio = Math.min(1, elapsed / totalSec);
  const eased = ratio * ratio;
  const anchor = (challengerScore | 0) > 0 ? (challengerScore | 0) : 8000;
  const target = _calibrateBotScore(duelId, anchor, playerWinPct);
  return Math.max(100, Math.floor(target * eased));
}

// Look up the snapshot whose score is closest-but-not-greater-than the target.
export function _snapshotForScore(trajectory, targetScore) {
  if (!trajectory || !Array.isArray(trajectory.snapshots) || !trajectory.snapshots.length) return null;
  const target = Math.max(0, targetScore | 0);
  let chosen = trajectory.snapshots[0];
  for (const snap of trajectory.snapshots) {
    if ((snap.s | 0) <= target) chosen = snap;
    else break;
  }
  return chosen;
}

// BL.1.5 — alternative lookup by PROGRESS (0..1) through the trajectory.
export function _snapshotForProgress(trajectory, progressRatio) {
  if (!trajectory || !Array.isArray(trajectory.snapshots) || !trajectory.snapshots.length) return null;
  const n = trajectory.snapshots.length;
  const p = Math.max(0, Math.min(1, progressRatio));
  const idx = Math.min(n - 1, Math.floor(p * (n - 1)));
  return trajectory.snapshots[idx];
}

// DU.3 — THE selector for bot duels: score AND board both come from the SAME
// real-game snapshot, chosen by elapsed wall-clock time → settled final == last
// frame shown, zero end-jump.
export function _snapshotForTime(traj, elapsedSec) {
  if (!traj || !Array.isArray(traj.snapshots) || !traj.snapshots.length) return null;
  const snaps = traj.snapshots;
  const lastT = snaps[snaps.length - 1].t || 0;
  const t = Math.max(0, Math.min(elapsedSec, lastT));
  let chosen = snaps[0];
  for (let i = 0; i < snaps.length; i++) {
    if ((snaps[i].t || 0) <= t) chosen = snaps[i];
    else break;
  }
  return {
    score: _floorBotVisibleScore(chosen.s | 0),
    tier: chosen.h | 0,
    grid: chosen.g,
    isFinal: chosen === snaps[snaps.length - 1]
  };
}
