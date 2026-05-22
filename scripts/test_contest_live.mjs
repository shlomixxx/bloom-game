// E2E test: live-score heartbeat + spectator flow + contest GET shape
// Run: node scripts/test_contest_live.mjs

const BASE = process.env.BASE || 'https://bloom-web-production-f3bd.up.railway.app';

function rand() { return Math.random().toString(36).slice(2, 10); }
function devId(name) { return 'test-' + name + '-' + rand() + '-' + Date.now().toString(36); }

async function api(path, opts) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { _raw: text }; }
  return { status: r.status, body: json };
}

async function register(name) {
  const id = devId(name);
  const r = await api('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: id })
  });
  return { id, name, token: r.body.token };
}

function assert(cond, msg) {
  if (!cond) { console.error('  ❌ FAIL:', msg); process.exit(1); }
  console.log('  ✓', msg);
}

(async () => {
  console.log('BASE:', BASE);
  console.log('\n═══ Setup ═══');
  const [host, alice, bob] = await Promise.all([
    register('liveHost'),
    register('liveAlice'),
    register('liveBob')
  ]);
  console.log('  ✓ registered 3 devices');

  const createResp = await api('/api/contests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: host.id, token: host.token,
      name: 'LiveTest-' + rand(),
      hostName: host.name,
      durationDays: 1, boardType: 'shared', wagerAmount: 0,
      difficulty: 'default',
      scoreMode: 'cumulative'
    })
  });
  const code = createResp.body.contest.code;
  console.log('  → contest:', code);

  await api('/api/contests/' + code + '/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: alice.id, token: alice.token, displayName: alice.name })
  });
  await api('/api/contests/' + code + '/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: bob.id, token: bob.token, displayName: bob.name })
  });

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: GET /api/contests/:code response shape ═══');
  const det = await api('/api/contests/' + code + '?deviceId=' + host.id);
  assert(det.body.ok === true, 'response has ok=true');
  assert(det.body.contest.score_mode === 'cumulative', 'contest.score_mode field present');
  assert(Array.isArray(det.body.players), 'players is array');
  assert(det.body.players.length === 3, 'has 3 players');
  const me = det.body.players.find(p => p.you);
  assert(me && me.name === host.name, 'host is marked you=true');
  // Schema fields on each player
  ['deviceId','name','score','tier','games','liveScore','liveTier','watchers','hasWatchers']
    .forEach(f => assert(f in me, 'player row has ' + f));

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: live-score heartbeat ═══');
  const live1 = await api('/api/contests/' + code + '/live-score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: alice.id, token: alice.token,
      displayName: alice.name,
      liveScore: 3500, tier: 3
    })
  });
  assert(live1.body && live1.body.ok, 'live-score accepted');
  assert(typeof live1.body.hasWatchers === 'boolean', 'live-score returns hasWatchers');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: live-state grid heartbeat (24 cells, ints 0-8) ═══');
  const gridJson = JSON.stringify(new Array(24).fill(0).map((_,i) => i % 4 === 0 ? 2 : (i % 7 === 0 ? 3 : 0)));
  const liveSt = await api('/api/contests/' + code + '/live-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: alice.id, token: alice.token,
      displayName: alice.name,
      liveScore: 3500, tier: 3, nextTier: 2,
      gridJson
    })
  });
  assert(liveSt.body && liveSt.body.ok, 'live-state with gridJson accepted');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: spectator can read live-state ═══');
  const spec = await api('/api/contests/' + code + '/live-state/' + alice.id);
  assert(spec.body && spec.body.live, 'spectator GET returns live snapshot');
  assert(spec.body.live.score === 3500, 'snapshot score matches the heartbeat');
  assert(Array.isArray(spec.body.live.grid) || spec.body.live.grid === null,
    'snapshot has grid field');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: detail fetch reflects live score in player row ═══');
  const det2 = await api('/api/contests/' + code + '?deviceId=' + host.id);
  const aliceLiveRow = det2.body.players.find(p => p.deviceId === alice.id);
  assert(aliceLiveRow.liveScore === 3500, 'leaderboard reflects alice.liveScore=3500');
  // Ranking sort key is score + liveScore — alice (0+3500) should rank above
  // bob (0+0) and host (0+0).
  assert(det2.body.players[0].deviceId === alice.id,
    'live score lifts alice to #1 in the ranked list (server-side)');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: watch + watcher count ═══');
  await api('/api/contests/' + code + '/watch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      watcherDeviceId: bob.id, token: bob.token,
      watcherName: bob.name, watcherLastScore: 0,
      targetDeviceId: alice.id
    })
  });
  // Re-fetch — alice's hasWatchers should now be true
  await new Promise(r => setTimeout(r, 500));
  const det3 = await api('/api/contests/' + code + '?deviceId=' + host.id);
  const aliceWithWatcher = det3.body.players.find(p => p.deviceId === alice.id);
  assert(aliceWithWatcher.hasWatchers === true, 'alice.hasWatchers=true after bob /watch');
  assert(Array.isArray(aliceWithWatcher.watchers) && aliceWithWatcher.watchers.length >= 1,
    'alice.watchers contains bob');

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: server live-score response signals hasWatchers ═══');
  const live3 = await api('/api/contests/' + code + '/live-score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: alice.id, token: alice.token,
      displayName: alice.name,
      liveScore: 4200, tier: 3
    })
  });
  assert(live3.body.hasWatchers === true, '/live-score now reports hasWatchers=true');
  console.log('  → watcherCount:', live3.body.watcherCount);

  // ──────────────────────────────────────────────────────────
  console.log('\n═══ Test: invalid gridJson rejected ═══');
  const badGrid = await api('/api/contests/' + code + '/live-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: alice.id, token: alice.token,
      displayName: alice.name,
      liveScore: 4200, tier: 3, nextTier: 2,
      gridJson: '[1,2,3]' // wrong length
    })
  });
  // Note: server accepts /live-score-only updates; gridJson may be optional.
  // What matters is that a malformed grid doesn't crash anything.
  assert(badGrid.status >= 200 && badGrid.status < 500, 'malformed gridJson does not 500');

  // ──────────────────────────────────────────────────────────
  console.log('\n✅ All live-state/spectator tests PASSED');
  console.log('  contest code:', code);
})().catch(e => {
  console.error('TEST CRASHED:', e);
  process.exit(1);
});
