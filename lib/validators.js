// lib/validators.js — PURE input-validation / sanitization helpers, extracted
// from server.js (QA improvement plan, Sprint 3: incremental server.js
// decomposition). No DB, no config, no req/res — deterministic and unit-tested
// (scripts/test_validators.mjs). Impure siblings (challengeZScore, which queries
// the DB) intentionally stay in server.js.

export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function cleanName(n) {
  const s = String(n || '').trim().slice(0, 24);
  return s || 'אנונימי';
}

export function cleanContestName(n) {
  return String(n || '').trim().slice(0, 100);
}

export function cleanDisplayName(n) {
  const s = String(n || '').trim().slice(0, 50);
  return s || 'אנונימי';
}

export function cleanSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Drops-vs-score sanity table (anti-cheat). Returns true if the score appears
// unreachable in the number of drops reported. Recalibrated for the exponential
// tier scoring + tier-up bonuses (a strong player can hit ~100K in 25 drops).
export function challengeDropsImplausible(score, drops) {
  const tiers = [
    [100_000,   25],
    [200_000,   50],
    [500_000,  100],
    [1_500_000, 200],
    [3_000_000, 350]
  ];
  for (const [s, d] of tiers) {
    if (score >= s && drops < d) return true;
  }
  return false;
}
