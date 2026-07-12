#!/usr/bin/env node
// Route-group wiring test — for every extracted routes/*.js module, registers its
// handlers on a mock app and invokes each with mock req/res + mock deps, failing
// ONLY on a missing-symbol error (a dep that wasn't injected). This catches the
// "500 at request time" that node --check + a boot test cannot. Run:
//   node scripts/test_routes.mjs
import { registerPetRoutes } from '../routes/pet.js';
import { registerSpinRoutes } from '../routes/spin.js';
import { registerLivesRoutes } from '../routes/lives.js';
import { registerLoginCalRoutes } from '../routes/logincal.js';

// Permissive mock row — enough fields that no handler hits a missing-property
// crash that looks like a dep bug.
const ROW = {
  deposited: 0, balance: 100, level: 1, xp: 0, total_xp: 0, pet_name: 'QA',
  current_lives: 5, max_lives: 5, last_regen_at: new Date(), last_refill_ad_date: null,
  login_cal_day: 0, login_cal_last_claim: null, current_streak: 0, longest_streak: 0,
  total_spins: 0, last_spin_date: null, last_reward: null, total_gems_won: 0,
  last_visited_at: new Date(), last_fed_at: null, last_petted_at: null,
  last_pet_date: null, last_feed_date: null, feeds_today: 0, c: 0, value: '1',
};
const mockClient = { query: async () => ({ rows: [ROW], rowCount: 1 }), release() {} };
const deps = {
  pool: { query: async () => ({ rows: [ROW], rowCount: 1 }), connect: async () => mockClient },
  requireDeviceAuth: (req, res, next) => next(),
  checkRateLimit: () => true,
  ensurePlayerProfile: async () => ({ device_id: 'testdevice123', player_code: 'ABCD' }),
  getCachedConfigPrefix: async () => ({}),
};

function isDepBug(e) {
  const m = String(e && e.message || e);
  return /is not defined|is not a function|Cannot read properties of undefined \(reading/.test(m);
}
function mockRes() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  return r;
}

const MODULES = [
  ['pet', registerPetRoutes], ['spin', registerSpinRoutes],
  ['lives', registerLivesRoutes], ['logincal', registerLoginCalRoutes],
];

let pass = 0, fail = 0;
for (const [name, register] of MODULES) {
  const routes = [];
  const app = {
    get(path, ...h) { routes.push({ method: 'GET', path, handler: h[h.length - 1] }); },
    post(path, ...h) { routes.push({ method: 'POST', path, handler: h[h.length - 1] }); },
  };
  register(app, deps);
  for (const rt of routes) {
    const req = { query: { deviceId: 'testdevice123' }, body: { deviceId: 'testdevice123', token: 't', name: 'QA', amount: 10, count: 1, gameId: 'g1' }, deviceId: 'testdevice123' };
    try {
      await rt.handler(req, mockRes());
      pass++;
    } catch (e) {
      if (isDepBug(e)) { fail++; console.log('  ✗ DEP BUG', name, rt.method, rt.path, '—', e.message); }
      else { pass++; }
    }
  }
  console.log('  ' + (fail === 0 ? '✓' : '✗') + ' ' + name + ' (' + routes.length + ' routes)');
}

console.log(fail === 0 ? `\n✅ ALL ROUTE MODULES WIRED (${pass} handlers, 0 dep bugs)` : `\n❌ ${fail} dep-wiring bug(s)`);
process.exit(fail === 0 ? 0 : 1);
