#!/usr/bin/env node
// Post-deploy production smoke test (QA improvement plan, Sprint 2).
// Hits the live public surface and asserts each endpoint responds with the
// expected shape. Would have caught the class of bug that shipped silently
// (a 500, a dead route, a broken build). Run after every `railway up`:
//
//   node scripts/smoke_prod.mjs
//   node scripts/smoke_prod.mjs https://your-host           # override base
//
// Exit code 0 = all green, 1 = one or more failures. No auth/admin needed.
// Uses a throwaway device id; the writes it performs are on that test player.

const BASE = (process.argv[2] || process.env.BLOOM_BASE ||
  'https://bloom-web-production-f3bd.up.railway.app').replace(/\/$/, '');

const DEV = 'smoke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

let TOKEN = null;
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' } });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}
async function post(path, obj) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}

async function main() {
  console.log('BLOOM prod smoke test → ' + BASE + '\n  device=' + DEV + ' date=' + TODAY + '\n');

  // --- core ---
  let r = await get('/api/health');
  ok('health', r.status === 200 && r.body && r.body.ok === true, 'HTTP ' + r.status);

  r = await post('/api/register', { deviceId: DEV });
  TOKEN = r.body && r.body.token;
  ok('register issues token', r.status === 200 && !!TOKEN, 'HTTP ' + r.status);

  r = await get('/api/config');
  ok('config', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);

  r = await get('/api/flags/game_v2?deviceId=' + DEV);
  ok('flags/game_v2', r.status === 200 && r.body && ('variant' in r.body), 'HTTP ' + r.status);

  r = await get('/api/stats/live');
  ok('stats/live', r.status === 200 && r.body && ('activeNow' in r.body), 'HTTP ' + r.status);

  // --- public GET surface (must all be 200 with ok) ---
  const stateGets = [
    'leaderboard/v2?scope=world&period=day&endDate=' + TODAY + '&deviceId=' + DEV,
    'boards/available', 'skins/available', 'tournaments',
    'bank/state?deviceId=' + DEV, 'pet/state?deviceId=' + DEV, 'trophies/state?deviceId=' + DEV,
    'gacha/state?deviceId=' + DEV, 'spin/state?deviceId=' + DEV, 'player/season/status?deviceId=' + DEV,
    'league/state?deviceId=' + DEV, 'album/state?deviceId=' + DEV, 'lifetime/state?deviceId=' + DEV,
    'chests/state?deviceId=' + DEV, 'duels/mine?deviceId=' + DEV, 'friends/list?deviceId=' + DEV,
    'inbox?deviceId=' + DEV, 'checklist/today?deviceId=' + DEV, 'daily-deals/today?deviceId=' + DEV,
    'bundles/active?deviceId=' + DEV, 'challenges?deviceId=' + DEV, 'guilds/mine?deviceId=' + DEV,
    'player/lives/state?deviceId=' + DEV, 'calendar/upcoming?deviceId=' + DEV, 'login-cal/state?deviceId=' + DEV,
  ];
  for (const ep of stateGets) {
    const rr = await get('/api/' + ep);
    // Most endpoints wrap in {ok:true}; a few return raw data (leaderboard/v2 →
    // {list,total,rank}) or {enabled:false} when a system is admin-disabled.
    const good = rr.status === 200 && rr.body &&
      (rr.body.ok === true || rr.body.enabled === false || Array.isArray(rr.body.list));
    ok('GET ' + ep.split('?')[0], good, 'HTTP ' + rr.status + (rr.body && rr.body.error ? ' ' + rr.body.error : ''));
  }

  // --- a few write paths (on the throwaway device) ---
  const auth = (o) => Object.assign({ deviceId: DEV, token: TOKEN }, o);
  r = await post('/api/pet/name', auth({ name: 'QA' }));
  ok('POST pet/name', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);
  r = await post('/api/pet/pet', auth({}));
  ok('POST pet/pet', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);
  r = await post('/api/spin/today', auth({}));
  ok('POST spin/today', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);
  r = await post('/api/gacha/pull', auth({ multiplier: 1, free: true }));
  ok('POST gacha/pull (returns cost)', r.status === 200 && r.body && r.body.ok && ('cost' in r.body), 'HTTP ' + r.status);
  r = await post('/api/player/earn', auth({ action: 'daily_login', meta: { streak: 1 } }));
  ok('POST player/earn', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);
  r = await post('/api/trophies/grant-from-game', auth({ score: 600, tier: 5, isNewBest: true, gameId: 'smoke-' + Date.now() }));
  ok('POST trophies/grant-from-game', r.status === 200 && r.body && r.body.ok, 'HTTP ' + r.status);

  console.log('\n' + (fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('Failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('smoke test crashed:', e); process.exit(1); });
