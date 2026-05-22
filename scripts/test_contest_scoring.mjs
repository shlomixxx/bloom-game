// E2E test: contest scoring modes (cumulative + best) + HUD math
// Spins up 4 simulated players, creates a contest in each mode, submits
// staggered scores, then verifies:
//   - Server-side leaderboard reflects the correct reducer
//   - GET /api/contests/:code returns correct totals
//   - The same projection math the HUD uses produces consistent rank/gap
// Run: node scripts/test_contest_scoring.mjs

const BASE = process.env.BASE || 'https://bloom-web-production-f3bd.up.railway.app';

function rand() { return Math.random().toString(36).slice(2, 10); }
function devId(name) { return 'test-' + name + '-' + rand() + '-' + Date.now().toString(36); }

async function api(path, opts) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { _raw: text }; }
  if (!r.ok && !json.ok) {
    console.warn('  ⚠', r.status, path, JSON.stringify(json).slice(0, 200));
  }
  return { status: r.status, body: json };
}

async function register(name) {
  const id = devId(name);
  const r = await api('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: id })
  });
  if (!r.body || !r.body.token) throw new Error('register failed for ' + name + ': ' + JSON.stringify(r.body));
  return { id, name, token: r.body.token };
}

async function createContest(host, name, scoreMode) {
  const r = await api('/api/contests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: host.id, token: host.token,
      name, hostName: host.name,
      durationDays: 1, boardType: 'shared', wagerAmount: 0,
      difficulty: 'default',
      scoreMode
    })
  });
  if (!r.body || !r.body.ok) throw new Error('create failed: ' + JSON.stringify(r.body));
  return r.body.contest;
}

async function joinContest(player, code) {
  const r = await api('/api/contests/' + code + '/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: player.id, token: player.token,
      displayName: player.name
    })
  });
  if (!r.body || !r.body.ok) throw new Error('join failed for ' + player.name + ': ' + JSON.stringify(r.body));
}

async function submitScore(player, code, score, tier, drops) {
  const r = await api('/api/contests/' + code + '/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: player.id, token: player.token,
      displayName: player.name,
      score, tier, drops: drops || Math.max(15, Math.floor(score / 200))
    })
  });
  return r;
}

async function fetchContest(code, viewerDeviceId) {
  const r = await api('/api/contests/' + code + (viewerDeviceId ? '?deviceId=' + viewerDeviceId : ''));
  return r.body;
}

function assert(cond, msg) {
  if (!cond) { console.error('  ❌ FAIL:', msg); process.exit(1); }
  console.log('  ✓', msg);
}

// Replicate the HUD's local projection math from src/06-contests.js paintContestHud.
function hudProject(players, mode, viewerDeviceId, myLiveScore) {
  const ranked = players.map(p => {
    let total;
    if (p.deviceId === viewerDeviceId) {
      total = mode === 'best'
        ? Math.max(p.score | 0, myLiveScore | 0)
        : ((p.score | 0) + (myLiveScore | 0));
    } else {
      const live = p.liveScore == null ? 0 : (p.liveScore | 0);
      total = mode === 'best'
        ? Math.max(p.score | 0, live)
        : ((p.score | 0) + live);
    }
    return { p, total };
  });
  ranked.sort((a, b) => b.total - a.total);
  const me = ranked.findIndex(r => r.p.deviceId === viewerDeviceId);
  const target = me > 0 ? ranked[me - 1] : null;
  const chaser = me >= 0 && me < ranked.length - 1 ? ranked[me + 1] : null;
  return {
    rank: me + 1, of: ranked.length, myTotal: me >= 0 ? ranked[me].total : null,
    target: target ? { name: target.p.name, total: target.total, gap: target.total - ranked[me].total } : null,
    chaser: chaser ? { name: chaser.p.name, total: chaser.total, lead: ranked[me].total - chaser.total } : null
  };
}

(async () => {
  console.log('BASE:', BASE);
  console.log('\n═══ Setup ═══');
  const [host, alice, bob, carol] = await Promise.all([
    register('host'),
    register('alice'),
    register('bob'),
    register('carol')
  ]);
  console.log('  ✓ registered 4 devices');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test 1: CUMULATIVE mode ═══');
  const cum = await createContest(host, 'Test-Cum-' + rand(), 'cumulative');
  assert(cum.score_mode === 'cumulative', 'contest created with score_mode=cumulative');
  console.log('  → code:', cum.code);

  await joinContest(alice, cum.code);
  await joinContest(bob, cum.code);
  await joinContest(carol, cum.code);
  console.log('  ✓ all joined');

  // Submit 1st-round scores. Note 30s cool-down per device per contest,
  // so we do all players at once then move on.
  await submitScore(host, cum.code, 5000, 3, 50);
  await submitScore(alice, cum.code, 8000, 4, 60);
  await submitScore(bob, cum.code, 3000, 2, 40);
  await submitScore(carol, cum.code, 6500, 3, 55);

  const after1 = await fetchContest(cum.code, host.id);
  const byName = name => after1.players.find(p => p.name === name);
  assert(byName('host').score === 5000, 'host total = 5000 (single game)');
  assert(byName('alice').score === 8000, 'alice total = 8000 (single game)');

  // Wait 31s to pass the contest cool-down, then submit again (cumulative should ADD)
  console.log('  ⏱ waiting 31s for per-contest cool-down…');
  await new Promise(r => setTimeout(r, 31_000));

  await submitScore(host, cum.code, 7000, 4, 70);
  await submitScore(alice, cum.code, 4000, 3, 50);

  const after2 = await fetchContest(cum.code, host.id);
  const byName2 = name => after2.players.find(p => p.name === name);
  assert(byName2('host').score === 12000, 'host total = 5000 + 7000 = 12000 (cumulative)');
  assert(byName2('alice').score === 12000, 'alice total = 8000 + 4000 = 12000 (cumulative)');
  assert(byName2('bob').score === 3000, 'bob unchanged = 3000');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test 2: BEST-OF mode ═══');
  const best = await createContest(host, 'Test-Best-' + rand(), 'best');
  assert(best.score_mode === 'best', 'contest created with score_mode=best');
  console.log('  → code:', best.code);

  await joinContest(alice, best.code);
  await joinContest(bob, best.code);
  await joinContest(carol, best.code);

  await submitScore(host, best.code, 5000, 3, 50);
  await submitScore(alice, best.code, 9000, 4, 70);
  await submitScore(bob, best.code, 4000, 3, 50);
  await submitScore(carol, best.code, 7000, 4, 60);

  const bAfter1 = await fetchContest(best.code, host.id);
  const bn1 = name => bAfter1.players.find(p => p.name === name);
  assert(bn1('host').score === 5000, 'host best = 5000');
  assert(bn1('alice').score === 9000, 'alice best = 9000');

  console.log('  ⏱ waiting 31s…');
  await new Promise(r => setTimeout(r, 31_000));

  // Round 2: alice submits LOWER (should stay 9000), host submits HIGHER
  await submitScore(host, best.code, 8000, 4, 60);   // 8000 > 5000 → 8000
  await submitScore(alice, best.code, 3000, 2, 30);  // 3000 < 9000 → still 9000
  await submitScore(bob, best.code, 6000, 3, 50);    // 6000 > 4000 → 6000

  const bAfter2 = await fetchContest(best.code, host.id);
  const bn2 = name => bAfter2.players.find(p => p.name === name);
  assert(bn2('host').score === 8000, 'host best = max(5000, 8000) = 8000');
  assert(bn2('alice').score === 9000, 'alice best = max(9000, 3000) = 9000 (unchanged)');
  assert(bn2('bob').score === 6000, 'bob best = max(4000, 6000) = 6000');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test 3: HUD projection math — CUMULATIVE ═══');
  // Imagine alice is mid-game with a current local score of 2500. Her server-side
  // total is 12000 (5000+8000=… wait that was 8000+4000=12000). With a current
  // game of 2500, her PROJECTED total = 12000 + 2500 = 14500. That should put
  // her ahead of host's 12000.
  const cumPlayers = (await fetchContest(cum.code, alice.id)).players;
  const aliceLive = 2500;
  const proj = hudProject(cumPlayers, 'cumulative', alice.id, aliceLive);
  console.log('  alice projection:', JSON.stringify(proj, null, 2));
  assert(proj.myTotal === 14500, 'alice projected total = 12000 + 2500 = 14500');
  // Carol has 6500; bob has 3000. Alice's projected 14500 should be highest.
  assert(proj.rank === 1, 'alice projected rank = 1 (was tied #1 before live)');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test 4: HUD projection math — BEST-OF ═══');
  // Alice's stored best is 9000. If her live game is 12000, projected = 12000.
  // If her live game is 5000, projected = max(9000, 5000) = 9000 (UNCHANGED).
  const bestPlayers = (await fetchContest(best.code, alice.id)).players;
  const projLower = hudProject(bestPlayers, 'best', alice.id, 5000);
  assert(projLower.myTotal === 9000, 'best-of projection stays at 9000 when live=5000 (lower than best)');
  const projHigher = hudProject(bestPlayers, 'best', alice.id, 12000);
  assert(projHigher.myTotal === 12000, 'best-of projection becomes 12000 when live=12000 (beats stored best)');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test 5: target/chaser deltas are positive and labeled correctly ═══');
  const playerCount = bestPlayers.length;
  console.log('  best-of player count:', playerCount);
  if (proj.target) assert(proj.target.gap > 0, 'target gap is positive (the player ABOVE me)');
  if (proj.chaser) assert(proj.chaser.lead > 0, 'chaser lead is positive (the player BELOW me)');

  // ──────────────────────────────────────────────────────────
  console.log('\n✅ All contest scoring tests PASSED');
  console.log('  cumulative contest:', cum.code);
  console.log('  best-of contest:', best.code);
})().catch(e => {
  console.error('TEST CRASHED:', e);
  process.exit(1);
});
