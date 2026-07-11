#!/usr/bin/env node
// Tests for lib/validators.js — the pure sanitizers extracted from server.js.
// Run: node scripts/test_validators.mjs
import {
  isValidDate, cleanName, cleanContestName, cleanDisplayName, cleanSlug,
  challengeDropsImplausible
} from '../lib/validators.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// isValidDate
eq('isValidDate valid', isValidDate('2026-07-11'), true);
eq('isValidDate bad format', isValidDate('2026-7-1'), false);
eq('isValidDate non-string', isValidDate(20260711), false);
eq('isValidDate empty', isValidDate(''), false);
eq('isValidDate injection', isValidDate("2026-07-11'; DROP"), false);

// cleanName — trims, caps 24, defaults
eq('cleanName trims', cleanName('  Danny  '), 'Danny');
eq('cleanName caps 24', cleanName('x'.repeat(40)).length, 24);
eq('cleanName empty→anon', cleanName('   '), 'אנונימי');
eq('cleanName null→anon', cleanName(null), 'אנונימי');

// cleanContestName — caps 100, no default
eq('cleanContestName caps 100', cleanContestName('y'.repeat(150)).length, 100);
eq('cleanContestName empty', cleanContestName(''), '');

// cleanDisplayName — caps 50, defaults
eq('cleanDisplayName caps 50', cleanDisplayName('z'.repeat(80)).length, 50);
eq('cleanDisplayName empty→anon', cleanDisplayName(''), 'אנונימי');

// cleanSlug — lowercase, hyphenate, trim, cap 40
eq('cleanSlug basic', cleanSlug('Hello World!'), 'hello-world');
eq('cleanSlug trims hyphens', cleanSlug('--A B--'), 'a-b');
eq('cleanSlug caps 40', cleanSlug('a'.repeat(60)).length, 40);
eq('cleanSlug non-latin drops', cleanSlug('תחרות 2026'), '2026');

// challengeDropsImplausible — anti-cheat table
eq('drops plausible low score', challengeDropsImplausible(50000, 5), false);
eq('drops implausible 100K/5', challengeDropsImplausible(100000, 5), true);
eq('drops plausible 100K/30', challengeDropsImplausible(100000, 30), false);
eq('drops implausible 500K/50', challengeDropsImplausible(500000, 50), true);
eq('drops plausible 3M/400', challengeDropsImplausible(3000000, 400), false);
eq('drops implausible 3M/100', challengeDropsImplausible(3000000, 100), true);

console.log(fail === 0 ? `\n✅ ALL VALIDATOR TESTS PASSED (${pass})` : `\n❌ ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
