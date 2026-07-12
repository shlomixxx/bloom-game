#!/usr/bin/env node
// Verifies routes/pet.js's extracted handlers are correctly wired to their
// injected deps — catches the "missing dep → ReferenceError/TypeError at request
// time" that node --check + a boot test CANNOT catch. Registers the routes on a
// mock app, then invokes each handler with mock req/res + mock deps and fails
// ONLY on a missing-symbol error (dep-wiring bug). Run: node scripts/test_routes_pet.mjs
import { registerPetRoutes } from '../routes/pet.js';

const routes = [];
const app = {
  get(path, ...h) { routes.push({ method: 'GET', path, handler: h[h.length - 1] }); },
  post(path, ...h) { routes.push({ method: 'POST', path, handler: h[h.length - 1] }); },
};

// A permissive mock DB: any query returns one plausible pet/profile row.
const petRow = {
  deposited: 0, level: 1, xp: 0, total_xp: 0, pet_name: 'QA',
  last_visited_at: new Date(), last_fed_at: null, last_petted_at: null,
  last_pet_date: null, last_feed_date: null, feeds_today: 0, c: 0,
};
const mockClient = { query: async () => ({ rows: [petRow], rowCount: 1 }), release() {} };
const deps = {
  pool: { query: async () => ({ rows: [petRow], rowCount: 1 }), connect: async () => mockClient },
  requireDeviceAuth: (req, res, next) => next(),
  checkRateLimit: () => true,
  ensurePlayerProfile: async () => ({ device_id: 'testdevice123', player_code: 'ABCD' }),
  getCachedConfigPrefix: async () => ({}),
};

registerPetRoutes(app, deps);

if (routes.length !== 5) { console.log('✗ expected 5 pet routes, got', routes.length); process.exit(1); }

function mockRes() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  return r;
}

// Only a missing-symbol error means a dep-wiring bug; other errors (e.g. the
// mock's row shape) are acceptable — we're not testing business logic here.
function isDepBug(e) {
  const m = String(e && e.message || e);
  return /is not defined|is not a function|Cannot read properties of undefined \(reading/.test(m);
}

let pass = 0, fail = 0;
for (const rt of routes) {
  const req = { query: { deviceId: 'testdevice123', score: 500, tier: 5 }, body: { deviceId: 'testdevice123', token: 't', name: 'QA', amount: 10, score: 500, tier: 5, gameId: 'g1' }, deviceId: 'testdevice123' };
  try {
    await rt.handler(req, mockRes());
    pass++; console.log('  ✓', rt.method, rt.path, '— ran with injected deps');
  } catch (e) {
    if (isDepBug(e)) { fail++; console.log('  ✗ DEP BUG', rt.method, rt.path, '—', e.message); }
    else { pass++; console.log('  ✓', rt.method, rt.path, '— ran (non-dep error ok:', String(e.message).slice(0, 60) + ')'); }
  }
}

console.log(fail === 0 ? `\n✅ ALL PET HANDLERS WIRED (${pass}/5, 0 dep bugs)` : `\n❌ ${fail} dep-wiring bug(s)`);
process.exit(fail === 0 ? 0 : 1);
