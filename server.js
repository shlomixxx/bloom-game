import express from 'express';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { readFile as readFileSw } from 'node:fs/promises';
import { pool, initDb } from './db.js';

const app = express();
app.disable('x-powered-by');

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS — only allow same-origin API requests (block external sites)
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  // Allow same-origin and no-origin (direct/curl). Block cross-origin.
  if (origin && !origin.includes(host)) {
    return res.status(403).json({ error: 'cross_origin_blocked' });
  }
  next();
});

app.use(express.json({ limit: '4kb' }));

// Serve sw.js dynamically so CACHE_NAME auto-bumps on every deploy.
// The boot timestamp ensures users always get fresh cache after a Railway restart.
const BOOT_TS = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
let _swTemplate = null;
app.get('/sw.js', async (_req, res) => {
  try {
    if (!_swTemplate) _swTemplate = await readFileSw(new URL('./public/sw.js', import.meta.url), 'utf8');
    const body = _swTemplate.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'bloom-v1-${BOOT_TS}';`);
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(body);
  } catch (e) {
    res.status(500).send('// sw.js unavailable');
  }
});

app.use(express.static('public', { maxAge: '5m', extensions: ['html'] }));

// ============================================================
// ADMIN — hidden URL + Basic Auth (defense in depth)
// ============================================================
// ADMIN_PATH is a random slug the user picks (e.g. "bloom-ops-K9pQ2v").
// ADMIN_PASSWORD is a 24+ char random secret. Both required to authenticate.
// If either env var is missing the admin surface returns 503 — never auto-allows.

const ADMIN_PATH_RAW = process.env.ADMIN_PATH || '';
const ADMIN_PATH = ADMIN_PATH_RAW
  ? ('/' + ADMIN_PATH_RAW.replace(/^\/+|\/+$/g, ''))
  : '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_PATH || !ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="bloom-admin", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }
  let decoded;
  try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); }
  catch (e) { return res.status(400).send('Bad auth header'); }
  const idx = decoded.indexOf(':');
  const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).send('Forbidden');
  }
  next();
}

async function logAdminAction(action, targetType, targetId, metadata) {
  try {
    await pool.query(
      `INSERT INTO admin_actions (action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      [String(action).slice(0, 50), targetType ? String(targetType).slice(0, 50) : null,
       targetId ? String(targetId).slice(0, 120) : null, metadata || null]
    );
  } catch (e) {
    console.warn('logAdminAction failed', e.message);
  }
}

// ============================================================
// HELPERS
// ============================================================

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function cleanName(n) {
  const s = String(n || '').trim().slice(0, 24);
  return s || 'אנונימי';
}

function cleanContestName(n) {
  return String(n || '').trim().slice(0, 100);
}

function cleanDisplayName(n) {
  const s = String(n || '').trim().slice(0, 50);
  return s || 'אנונימי';
}

function generateContestCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueContestCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateContestCode();
    if (isCodeBlacklisted(code)) continue;
    const result = await pool.query('SELECT code FROM contests WHERE code = $1', [code]);
    if (result.rows.length === 0) return code;
  }
  throw new Error('Could not generate unique code after 20 attempts');
}

function shiftDateBack(iso, daysBack) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// Validates a serialized 4x6 grid coming from a spectated client.
// Returns the canonical JSON string or null if the payload doesn't fit
// the expected shape (24 cells, each tier 0-8). Anything off-shape is
// rejected so we never store junk that the spectator's renderer would
// choke on.
function normalizeGridJson(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (e) { return null; }
  }
  if (!Array.isArray(arr) || arr.length !== 24) return null;
  for (let i = 0; i < 24; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const n = v | 0;
    if (n < 0 || n > 8) return null;
    arr[i] = n;
  }
  return JSON.stringify(arr);
}

// How long since the last update a live row stays "live" — used both for
// in-game scoreboard overlays and for the watchers list. Kept loose enough
// (10s) to absorb the 5s spectator heartbeat plus typical network jitter.
const LIVE_FRESH_SECONDS = 10;

// ============================================================
// DEVICE TOKEN AUTH (HMAC-based anti-spoofing)
// ============================================================
// Each device registers once → gets an HMAC token tied to its deviceId.
// Score-sensitive endpoints verify the token. Old clients that don't send
// a token are allowed through during migration (soft enforcement).
// Set DEVICE_SECRET env var for stable tokens across restarts.

const DEVICE_SECRET = process.env.DEVICE_SECRET || randomBytes(32).toString('hex');
if (!process.env.DEVICE_SECRET) {
  console.warn('[auth] DEVICE_SECRET not set — using random (tokens reset on restart). Set it in Railway env vars.');
}

function generateDeviceToken(deviceId) {
  return createHmac('sha256', DEVICE_SECRET).update(deviceId).digest('hex');
}

function verifyDeviceToken(deviceId, token) {
  if (!token) return false;
  const expected = generateDeviceToken(deviceId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// POST /api/register — issues a token for a deviceId. Idempotent.
app.post('/api/register', (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('register', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    res.json({ ok: true, token: generateDeviceToken(deviceId) });
  } catch (e) {
    console.error('POST /api/register', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// RATE LIMITING (per-device, in-memory, sliding window)
// ============================================================
// Resets on server restart. Acceptable for a friends game with no auth.

const rateLimitStore = new Map(); // bucket key → array of timestamps
const MAX_RATE_LIMIT_KEYS = 50000;

function checkRateLimit(bucket, deviceId, maxRequests, windowMs) {
  if (!deviceId) return true; // bad inputs validated separately; don't double-fail
  if (rateLimitStore.size > MAX_RATE_LIMIT_KEYS) rateLimitStore.clear();
  const key = bucket + ':' + deviceId;
  const now = Date.now();
  const recent = (rateLimitStore.get(key) || []).filter(function(ts) { return now - ts < windowMs; });
  if (recent.length >= maxRequests) {
    return false;
  }
  recent.push(now);
  rateLimitStore.set(key, recent);
  return true;
}

// Periodic cleanup so the map doesn't grow unbounded
setInterval(function() {
  const cutoff = Date.now() - 60 * 60 * 1000; // anything older than 1 hour is gone
  for (const [k, arr] of rateLimitStore) {
    const fresh = arr.filter(function(ts) { return ts > cutoff; });
    if (fresh.length === 0) rateLimitStore.delete(k);
    else if (fresh.length !== arr.length) rateLimitStore.set(k, fresh);
  }
}, 5 * 60 * 1000);

// ============================================================
// CONTEST CODE GENERATION + BLACKLIST
// ============================================================
// The base alphabet already avoids 0/1/I/O. Filter out a small set of
// substrings that read offensive in the resulting codes.
const CODE_BLACKLIST = [
  'FUCK', 'SHIT', 'BITCH', 'DICK', 'COCK', 'CUNT', 'TWAT', 'PUSS',
  'ANAL', 'PORN', 'NAZI', 'KKK', 'HELL', 'CRAP', 'DAMN',
  'SLUT', 'WHORE', 'RAPE', 'SUCK'
];
function isCodeBlacklisted(code) {
  for (let i = 0; i < CODE_BLACKLIST.length; i++) {
    if (code.indexOf(CODE_BLACKLIST[i]) !== -1) return true;
  }
  return false;
}

// ============================================================
// DAILY CHALLENGE ENDPOINTS (קיימים — לא נגענו)
// ============================================================

app.post('/api/score', async (req, res) => {
  try {
    const { date, deviceId, name, score, tier, drops, token } = req.body || {};
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Token verification: reject if a token is provided but invalid.
    // Missing tokens are allowed (old clients) but logged for monitoring.
    if (token) {
      if (!verifyDeviceToken(deviceId, token)) {
        return res.status(403).json({ error: 'bad_token' });
      }
    }
    // Rate limit: max 60 daily score submissions per device per hour
    if (!checkRateLimit('daily:score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    // Anti-cheat: reject scores that are implausible given the number of drops.
    // Old clients that don't send drops are allowed through (drops will be undefined).
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
    if (dropsN !== null && challengeDropsImplausible(score, dropsN)) {
      console.warn(`[anti-cheat] daily score rejected: device=${deviceId} score=${score} drops=${dropsN}`);
      return res.status(400).json({ error: 'implausible_score' });
    }
    const safeName = cleanName(name);
    await pool.query(
      `INSERT INTO daily_scores (date, device_id, name, score, tier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date, device_id) DO UPDATE
         SET name = EXCLUDED.name,
             score = EXCLUDED.score,
             tier = EXCLUDED.tier,
             updated_at = NOW()
         WHERE daily_scores.score < EXCLUDED.score`,
      [date, deviceId, safeName, Math.floor(score), Math.floor(tier)]
    );
    const rankRes = await pool.query(
      `SELECT 1 + (
         SELECT COUNT(*) FROM daily_scores
         WHERE date = $1 AND score > (
           SELECT score FROM daily_scores WHERE date = $1 AND device_id = $2
         )
       ) AS rank`,
      [date, deviceId]
    );
    res.json({ ok: true, rank: parseInt(rankRes.rows[0].rank, 10) });
  } catch (e) {
    console.error('POST /api/score', e);
    res.status(500).json({ error: 'server' });
  }
});

app.get('/api/leaderboard/:date', async (req, res) => {
  try {
    const date = req.params.date;
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT name, score, tier, device_id
       FROM daily_scores
       WHERE date = $1
       ORDER BY score DESC, updated_at ASC
       LIMIT 50`,
      [date]
    );
    const list = rows.rows.map((r) => ({
      name: r.name,
      score: r.score,
      tier: r.tier,
      you: deviceId && r.device_id === deviceId
    }));
    let rank = null;
    if (deviceId) {
      const rankRes = await pool.query(
        `SELECT 1 + (
           SELECT COUNT(*) FROM daily_scores
           WHERE date = $1 AND score > COALESCE((
             SELECT score FROM daily_scores WHERE date = $1 AND device_id = $2
           ), -1)
         ) AS rank,
         EXISTS (SELECT 1 FROM daily_scores WHERE date = $1 AND device_id = $2) AS has_score`,
        [date, deviceId]
      );
      if (rankRes.rows[0].has_score) rank = parseInt(rankRes.rows[0].rank, 10);
    }
    const total = await pool.query(`SELECT COUNT(*)::int AS c FROM daily_scores WHERE date = $1`, [date]);
    res.json({ list, total: total.rows[0].c, rank });
  } catch (e) {
    console.error('GET /api/leaderboard', e);
    res.status(500).json({ error: 'server' });
  }
});

app.get('/api/leaderboard/range/:period', async (req, res) => {
  try {
    const period = req.params.period;
    const endDate = String(req.query.endDate || '');
    if (!isValidDate(endDate)) return res.status(400).json({ error: 'bad_date' });
    if (!['day', 'week', 'month'].includes(period)) return res.status(400).json({ error: 'bad_period' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const daysBack = period === 'day' ? 0 : period === 'week' ? 6 : 29;
    const startDate = shiftDateBack(endDate, daysBack);
    const rows = await pool.query(
      `SELECT name, score, tier, device_id FROM (
         SELECT DISTINCT ON (device_id) name, score, tier, device_id
         FROM daily_scores
         WHERE date >= $1 AND date <= $2
         ORDER BY device_id, score DESC, updated_at ASC
       ) best
       ORDER BY score DESC LIMIT 50`,
      [startDate, endDate]
    );
    const list = rows.rows.map((r) => ({
      name: r.name,
      score: r.score,
      tier: r.tier,
      you: !!(deviceId && r.device_id === deviceId)
    }));
    let rank = null;
    if (deviceId) {
      const rankRes = await pool.query(
        `WITH best AS (
           SELECT DISTINCT ON (device_id) device_id, score
           FROM daily_scores
           WHERE date >= $1 AND date <= $2
           ORDER BY device_id, score DESC
         ),
         me AS (SELECT score FROM best WHERE device_id = $3)
         SELECT 1 + (SELECT COUNT(*) FROM best WHERE score > COALESCE((SELECT score FROM me), -1)) AS rank,
                EXISTS (SELECT 1 FROM me) AS has_score`,
        [startDate, endDate, deviceId]
      );
      if (rankRes.rows[0].has_score) rank = parseInt(rankRes.rows[0].rank, 10);
    }
    const totalRes = await pool.query(
      `SELECT COUNT(DISTINCT device_id)::int AS c FROM daily_scores WHERE date >= $1 AND date <= $2`,
      [startDate, endDate]
    );
    res.json({ list, total: totalRes.rows[0].c, rank, from: startDate, to: endDate, period });
  } catch (e) {
    console.error('GET /api/leaderboard/range', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// FRIENDS COMPETITION ENDPOINTS (חדש)
// ============================================================

// GET /api/contests/mine — כל התחרויות שהמכשיר חבר בהן
app.get('/api/contests/mine', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (!deviceId || deviceId.length < 8) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const result = await pool.query(
      `SELECT
         c.code, c.name, c.host_name, c.ends_at, c.created_at, c.board_type,
         cs.score AS my_score, cs.highest_tier AS my_tier,
         cs.games_played AS my_games, cs.last_played_at AS my_last,
         (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code) AS member_count,
         (SELECT 1 + COUNT(*) FROM contest_scores
            WHERE contest_code = c.code AND score > cs.score) AS my_rank
       FROM contests c
       INNER JOIN contest_scores cs ON cs.contest_code = c.code
       WHERE cs.device_id = $1
       ORDER BY cs.last_played_at DESC, c.created_at DESC`,
      [deviceId]
    );
    const contests = result.rows.map((r) => ({
      code: r.code,
      name: r.name,
      host_name: r.host_name,
      ends_at: r.ends_at,
      board_type: r.board_type,
      member_count: parseInt(r.member_count, 10) || 0,
      my: {
        score: r.my_score | 0,
        tier: r.my_tier | 0,
        games: r.my_games | 0,
        rank: parseInt(r.my_rank, 10) || 1,
        last: r.my_last
      }
    }));
    res.json({ ok: true, contests });
  } catch (e) {
    console.error('GET /api/contests/mine', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests — יצירת תחרות חדשה
app.post('/api/contests', async (req, res) => {
  try {
    const { name, hostName, deviceId, durationDays, boardType } = req.body || {};

    const cleanedName = cleanContestName(name);
    if (!cleanedName) return res.status(400).json({ error: 'bad_name' });

    const cleanedHost = cleanDisplayName(hostName);
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }

    // Rate limit: max 5 new contests per device per hour
    if (!checkRateLimit('contest:create', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    const dur = Math.min(Math.max(parseInt(durationDays, 10) || 7, 1), 30);
    const type = boardType === 'free' ? 'free' : 'shared';
    const seed = type === 'shared' ? Math.floor(Math.random() * 2147483647) : null;
    const endsAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);

    const code = await generateUniqueContestCode();

    const result = await pool.query(
      `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, cleanedName, cleanedHost, deviceId, seed, type, dur, endsAt]
    );

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier)
       VALUES ($1, $2, $3, 0, 1)
       ON CONFLICT (contest_code, device_id) DO NOTHING`,
      [code, deviceId, cleanedHost]
    );

    res.json({ ok: true, contest: result.rows[0] });
  } catch (e) {
    console.error('POST /api/contests', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/contests/:code — קבלת פרטי תחרות + לוח מובילים
app.get('/api/contests/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    if (!code) return res.status(400).json({ error: 'bad_code' });

    const contestResult = await pool.query('SELECT * FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const deviceId = String(req.query.deviceId || '').slice(0, 64);

    // Pull scores + currently-live overlay in one query so a single round
    // trip carries everything the contest leaderboard needs. The sort key
    // is "accumulated + live (if fresh)" so a player who's mid-game appears
    // at their *projected* rank, matching what the user expects to see.
    const scoresResult = await pool.query(
      `SELECT
         cs.device_id,
         cs.display_name,
         cs.score,
         cs.highest_tier,
         cs.games_played,
         cs.last_played_at,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.live_score ELSE NULL END AS live_score,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.highest_tier ELSE NULL END AS live_tier,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.updated_at ELSE NULL END AS live_updated_at
       FROM contest_scores cs
       LEFT JOIN contest_live_state ls
         ON ls.contest_code = cs.contest_code
        AND ls.device_id    = cs.device_id
       WHERE cs.contest_code = $1
       ORDER BY (cs.score + CASE WHEN ls.updated_at IS NOT NULL
                                   AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
                                  THEN ls.live_score ELSE 0 END) DESC,
                cs.last_played_at ASC`,
      [code, LIVE_FRESH_SECONDS]
    );

    // Watchers, grouped by who they're watching. Limited to LIVE_FRESH_SECONDS
    // since the last heartbeat so a closed tab stops counting almost immediately.
    const watchersResult = await pool.query(
      `SELECT target_device_id, watcher_name, watcher_last_score, updated_at
       FROM contest_watchers
       WHERE contest_code = $1
         AND updated_at > NOW() - ($2::int * INTERVAL '1 second')
       ORDER BY updated_at DESC`,
      [code, LIVE_FRESH_SECONDS]
    );
    const watchersByTarget = new Map();
    for (const w of watchersResult.rows) {
      const list = watchersByTarget.get(w.target_device_id) || [];
      list.push({ name: w.watcher_name, lastScore: w.watcher_last_score | 0 });
      watchersByTarget.set(w.target_device_id, list);
    }

    const players = scoresResult.rows.map((r) => {
      const watchers = watchersByTarget.get(r.device_id) || [];
      return {
        deviceId: r.device_id,
        name: r.display_name,
        score: r.score,
        tier: r.highest_tier,
        games: r.games_played,
        last: r.last_played_at,
        liveScore: r.live_score === null ? null : (r.live_score | 0),
        liveTier:  r.live_tier  === null ? null : (r.live_tier  | 0),
        liveUpdatedAt: r.live_updated_at,
        watchers: watchers,
        hasWatchers: watchers.length > 0,
        you: !!(deviceId && r.device_id === deviceId)
      };
    });

    res.json({
      ok: true,
      contest: contestResult.rows[0],
      players,
      liveFreshSeconds: LIVE_FRESH_SECONDS
    });
  } catch (e) {
    console.error('GET /api/contests/:code', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/join — הצטרפות לתחרות
app.post('/api/contests/:code/join', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: max 30 joins per device per hour
    if (!checkRateLimit('contest:join', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cleanedName = cleanDisplayName(displayName);

    const contestResult = await pool.query('SELECT * FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
    }

    // Name uniqueness check — any OTHER device in this contest already using
    // this display name (case-insensitive) makes us reject.
    const nameClash = await pool.query(
      `SELECT 1 FROM contest_scores
       WHERE contest_code = $1
         AND LOWER(display_name) = LOWER($2)
         AND device_id <> $3
       LIMIT 1`,
      [code, cleanedName, deviceId]
    );
    if (nameClash.rows.length > 0) {
      return res.status(409).json({ error: 'name_taken' });
    }

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier)
       VALUES ($1, $2, $3, 0, 1)
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET display_name = EXCLUDED.display_name`,
      [code, deviceId, cleanedName]
    );

    res.json({ ok: true, contest: contestResult.rows[0] });
  } catch (e) {
    console.error('POST /api/contests/:code/join', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/score — שליחת תוצאת משחק לתחרות
app.post('/api/contests/:code/score', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, score, tier } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: max 60 score submissions per device per hour (~1/min)
    if (!checkRateLimit('contest:score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const cleanedName = cleanDisplayName(displayName);

    const contestResult = await pool.query('SELECT ends_at FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
    }

    // If the submitter is trying to RENAME themselves to a name another
    // device in this contest already uses, silently keep their existing
    // name. The score still saves — we just don't let them steal the
    // identity. (New joiners hit the strict 409 inside /join above; this
    // path is only for ongoing players, and we don't want to lose a game's
    // score over a name choice.)
    let nameToStore = cleanedName;
    const existing = await pool.query(
      `SELECT display_name FROM contest_scores WHERE contest_code = $1 AND device_id = $2`,
      [code, deviceId]
    );
    if (existing.rows.length > 0) {
      const currentName = existing.rows[0].display_name;
      if (currentName && cleanedName.toLowerCase() !== currentName.toLowerCase()) {
        const clash = await pool.query(
          `SELECT 1 FROM contest_scores
           WHERE contest_code = $1
             AND LOWER(display_name) = LOWER($2)
             AND device_id <> $3
           LIMIT 1`,
          [code, cleanedName, deviceId]
        );
        if (clash.rows.length > 0) nameToStore = currentName;
      }
    }

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         score = contest_scores.score + EXCLUDED.score,
         highest_tier = GREATEST(contest_scores.highest_tier, EXCLUDED.highest_tier),
         games_played = contest_scores.games_played + 1,
         last_played_at = NOW()`,
      [code, deviceId, nameToStore, Math.floor(score), Math.floor(tier)]
    );

    const rankRes = await pool.query(
      `SELECT 1 + (
         SELECT COUNT(*) FROM contest_scores
         WHERE contest_code = $1 AND score > (
           SELECT score FROM contest_scores WHERE contest_code = $1 AND device_id = $2
         )
       ) AS rank,
       (SELECT COUNT(*) FROM contest_scores WHERE contest_code = $1) AS total`,
      [code, deviceId]
    );

    res.json({
      ok: true,
      rank: parseInt(rankRes.rows[0].rank, 10),
      total: parseInt(rankRes.rows[0].total, 10)
    });
  } catch (e) {
    console.error('POST /api/contests/:code/score', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// LIVE CONTEST + SPECTATOR ENDPOINTS (חדש — שלב 3)
// ============================================================
// כל הראוטים הללו מעדכנים שורה לכל היותר — אין רשומות היסטוריות. שורות
// "נושנות" מסוננות בקריאה לפי LIVE_FRESH_SECONDS, ולכן אין צורך ב-cron
// לניקוי. ניקוי "אמיתי" קורה בהזדמנות (best-effort) בתוך POST /live-score.

async function purgeStaleLiveRowsBestEffort(code) {
  try {
    await pool.query(
      `DELETE FROM contest_live_state
       WHERE contest_code = $1 AND updated_at < NOW() - INTERVAL '1 hour'`,
      [code]
    );
    await pool.query(
      `DELETE FROM contest_watchers
       WHERE contest_code = $1 AND updated_at < NOW() - INTERVAL '1 hour'`,
      [code]
    );
  } catch (_) { /* best-effort */ }
}

// POST /api/contests/:code/live-score — עדכון ניקוד חי (ללא הגריד).
// מוחזר hasWatchers כדי שה-client ידע אם לטרוח לשלוח גם /live-state.
app.post('/api/contests/:code/live-score', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, liveScore, tier } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: 1Hz heartbeat + slack → 120/min/device.
    if (!checkRateLimit('contest:live-score', deviceId, 120, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof liveScore !== 'number' || !Number.isFinite(liveScore) || liveScore < 0 || liveScore > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const cleanedName = cleanDisplayName(displayName);

    // Lazy purge — runs at most a few times a minute thanks to rate limiting.
    if (Math.random() < 0.01) purgeStaleLiveRowsBestEffort(code);

    await pool.query(
      // Note: live_score / highest_tier come straight from the client — each
      // contest game starts fresh so we overwrite both. Stale rows for a
      // previous game are gone after LIVE_FRESH_SECONDS anyway.
      `INSERT INTO contest_live_state (contest_code, device_id, display_name, live_score, highest_tier, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (contest_code, device_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         live_score   = EXCLUDED.live_score,
         highest_tier = EXCLUDED.highest_tier,
         updated_at   = NOW()`,
      [code, deviceId, cleanedName, Math.floor(liveScore), Math.floor(tier)]
    );

    const watchersRes = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM contest_watchers
       WHERE contest_code = $1
         AND target_device_id = $2
         AND updated_at > NOW() - ($3::int * INTERVAL '1 second')`,
      [code, deviceId, LIVE_FRESH_SECONDS]
    );
    const watcherCount = watchersRes.rows[0].c | 0;

    res.json({ ok: true, hasWatchers: watcherCount > 0, watcherCount });
  } catch (e) {
    console.error('POST /api/contests/:code/live-score', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/live-state — אותו דבר + גריד JSON. נשלח רק
// כשהשרת אמר "יש לך צופים" בתשובה הקודמת ל-/live-score.
app.post('/api/contests/:code/live-state', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, liveScore, tier, nextTier, gridJson } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('contest:live-state', deviceId, 120, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof liveScore !== 'number' || !Number.isFinite(liveScore) || liveScore < 0 || liveScore > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    let nextTierVal = null;
    if (nextTier !== undefined && nextTier !== null) {
      if (typeof nextTier !== 'number' || nextTier < 0 || nextTier > 8) {
        return res.status(400).json({ error: 'bad_next_tier' });
      }
      nextTierVal = Math.floor(nextTier);
    }
    const cleanedName = cleanDisplayName(displayName);
    const gridStr = normalizeGridJson(gridJson);
    if (!gridStr) return res.status(400).json({ error: 'bad_grid' });

    await pool.query(
      `INSERT INTO contest_live_state (contest_code, device_id, display_name, live_score, highest_tier, next_tier, grid_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (contest_code, device_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         live_score   = EXCLUDED.live_score,
         highest_tier = EXCLUDED.highest_tier,
         next_tier    = EXCLUDED.next_tier,
         grid_json    = EXCLUDED.grid_json,
         updated_at   = NOW()`,
      [code, deviceId, cleanedName, Math.floor(liveScore), Math.floor(tier), nextTierVal, gridStr]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/live-state', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/contests/:code/live-state/:targetDeviceId — קריאת snapshot.
// מוחזר 404 אם אין שורה טרייה (=המשחק הסתיים / הופסק).
app.get('/api/contests/:code/live-state/:targetDeviceId', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const targetDeviceId = String(req.params.targetDeviceId || '').slice(0, 64);
    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (!targetDeviceId || targetDeviceId.length < 8) return res.status(400).json({ error: 'bad_device' });

    const result = await pool.query(
      `SELECT display_name, live_score, highest_tier, next_tier, grid_json, updated_at
       FROM contest_live_state
       WHERE contest_code = $1
         AND device_id = $2
         AND updated_at > NOW() - ($3::int * INTERVAL '1 second')`,
      [code, targetDeviceId, LIVE_FRESH_SECONDS]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'not_live' });

    const r = result.rows[0];
    let grid = null;
    if (r.grid_json) {
      try { grid = JSON.parse(r.grid_json); } catch (_) { grid = null; }
    }
    res.json({
      ok: true,
      live: {
        name: r.display_name,
        score: r.live_score | 0,
        tier:  r.highest_tier | 0,
        nextTier: r.next_tier === null ? null : (r.next_tier | 0),
        grid: grid,
        updatedAt: r.updated_at
      }
    });
  } catch (e) {
    console.error('GET /api/contests/:code/live-state/:targetDeviceId', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/watch — מתחיל/מחדש watch + heartbeat (כל 5s).
app.post('/api/contests/:code/watch', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { watcherDeviceId, watcherName, watcherLastScore, targetDeviceId } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof watcherDeviceId !== 'string' || watcherDeviceId.length < 8 || watcherDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof targetDeviceId !== 'string' || targetDeviceId.length < 8 || targetDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_target' });
    }
    if (watcherDeviceId === targetDeviceId) {
      return res.status(400).json({ error: 'self_watch' });
    }
    if (!checkRateLimit('contest:watch', watcherDeviceId, 60, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const lastScore = (typeof watcherLastScore === 'number' && Number.isFinite(watcherLastScore)
      && watcherLastScore >= 0 && watcherLastScore <= 10_000_000) ? Math.floor(watcherLastScore) : 0;
    const cleanedName = cleanDisplayName(watcherName);

    await pool.query(
      `INSERT INTO contest_watchers (contest_code, watcher_device_id, watcher_name, watcher_last_score, target_device_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (contest_code, watcher_device_id, target_device_id) DO UPDATE SET
         watcher_name       = EXCLUDED.watcher_name,
         watcher_last_score = EXCLUDED.watcher_last_score,
         updated_at         = NOW()`,
      [code, watcherDeviceId, cleanedName, lastScore, targetDeviceId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/watch', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/unwatch — מסלק watch מיידית.
app.post('/api/contests/:code/unwatch', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { watcherDeviceId, targetDeviceId } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof watcherDeviceId !== 'string' || watcherDeviceId.length < 8 || watcherDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof targetDeviceId !== 'string' || targetDeviceId.length < 8 || targetDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_target' });
    }

    await pool.query(
      `DELETE FROM contest_watchers
       WHERE contest_code = $1
         AND watcher_device_id = $2
         AND target_device_id = $3`,
      [code, watcherDeviceId, targetDeviceId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/unwatch', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// BLOOM CHALLENGES — public single-shot prize contests
// ============================================================

const CHALLENGE_TYPES = ['race', 'top_n', 'beat', 'first_to_tier'];

function cleanSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Drops-vs-score sanity table. Calibrated against the BloomDebug bot's
// recorded games. Returns true if the score appears unreachable in the
// number of drops reported.
function challengeDropsImplausible(score, drops) {
  // Recalibrated for the exponential tier scoring + tier-up bonuses
  // introduced in the score-economy rebalance. Real games now produce
  // 2-3× higher scores per drop, so the old thresholds (50K / 25 drops)
  // would false-positive on legitimate skilled play. New thresholds
  // assume a strong player can reasonably hit ~100K in 25 drops by
  // chaining mid-tier merges + the +500/+1500 milestone bonuses.
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

// Computes the z-score (vs. completed entries' scores) for one entry.
// Returns null if there's not enough data to be meaningful.
async function challengeZScore(challengeId, score) {
  const r = await pool.query(
    `SELECT AVG(score)::float AS m, COALESCE(STDDEV_SAMP(score), 0)::float AS s
     FROM challenge_entries
     WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > 0`,
    [challengeId]
  );
  const m = r.rows[0].m;
  const s = r.rows[0].s;
  if (s == null || s <= 0) return null;
  return (score - m) / s;
}

// Map a DB challenge row to the public-facing summary shape.
function publicChallengeRow(c, myEntry, entriesCount, winnersFilled) {
  return {
    slug:           c.slug,
    name:           c.name,
    description:    c.description,
    challengeType:  c.challenge_type,
    thresholdScore: c.threshold_score,
    thresholdTier:  c.threshold_tier,
    winnersCount:   c.winners_count,
    prizeText:      c.prize_text,
    prizeImageUrl:  c.prize_image_url,
    startsAt:       c.starts_at,
    endsAt:         c.ends_at,
    status:         c.status,
    rulesText:      c.rules_text,
    entriesCount:   entriesCount | 0,
    winnersFilled:  winnersFilled | 0,
    myEntry:        myEntry || null
  };
}

// GET /api/challenges — list active + upcoming challenges that the public can see.
app.get('/api/challenges', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int AS entries_count,
        (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled
       FROM challenges c
       WHERE c.status IN ('active','draft')
         AND c.ends_at > NOW()
       ORDER BY (c.status = 'active') DESC, c.ends_at ASC`
    );
    let myEntries = new Map();
    if (deviceId && deviceId.length >= 8 && rows.rows.length) {
      const ids = rows.rows.map(r => r.id);
      const me = await pool.query(
        `SELECT challenge_id, score, highest_tier, status, is_winner, winner_rank, contact_at
         FROM challenge_entries WHERE device_id = $1 AND challenge_id = ANY($2::int[])`,
        [deviceId, ids]
      );
      for (const e of me.rows) myEntries.set(e.challenge_id, e);
    }
    const list = rows.rows
      .filter(c => c.status === 'active')  // draft challenges aren't shown publicly
      .map(c => publicChallengeRow(c, myEntries.get(c.id) || null, c.entries_count, c.winners_filled));
    res.json({ ok: true, challenges: list });
  } catch (e) {
    console.error('GET /api/challenges', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/challenges/history — past / ended challenges with winner info.
// Returns up to 50 most recently ended challenges, each with the winner names
// (top-3 by winner_rank) and this device's outcome (if they participated).
app.get('/api/challenges/history', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int AS entries_count,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled
       FROM challenges c
       WHERE c.status IN ('ended','cancelled') OR c.ends_at <= NOW()
       ORDER BY c.ends_at DESC
       LIMIT 50`
    );
    if (!rows.rows.length) return res.json({ ok: true, challenges: [] });
    const ids = rows.rows.map(r => r.id);
    // Top winners per challenge
    const winnersRes = await pool.query(
      `SELECT challenge_id, display_name, score, winner_rank
       FROM challenge_entries
       WHERE challenge_id = ANY($1::int[]) AND is_winner = TRUE
       ORDER BY challenge_id, winner_rank ASC NULLS LAST`,
      [ids]
    );
    const winnersByChal = new Map();
    for (const w of winnersRes.rows) {
      if (!winnersByChal.has(w.challenge_id)) winnersByChal.set(w.challenge_id, []);
      const list = winnersByChal.get(w.challenge_id);
      if (list.length < 3) list.push({ name: w.display_name, score: w.score | 0, rank: w.winner_rank });
    }
    // My entries (if a deviceId is given)
    let myEntries = new Map();
    if (deviceId && deviceId.length >= 8) {
      const me = await pool.query(
        `SELECT challenge_id, score, highest_tier, status, is_winner, winner_rank, contact_at
         FROM challenge_entries WHERE device_id = $1 AND challenge_id = ANY($2::int[])`,
        [deviceId, ids]
      );
      for (const e of me.rows) myEntries.set(e.challenge_id, e);
    }
    const list = rows.rows.map(function(c) {
      const row = publicChallengeRow(c, myEntries.get(c.id) || null, c.entries_count, c.winners_filled);
      row.topWinners = winnersByChal.get(c.id) || [];
      return row;
    });
    res.json({ ok: true, challenges: list });
  } catch (e) {
    console.error('GET /api/challenges/history', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/challenges/:slug — single challenge detail + my entry + standings preview.
app.get('/api/challenges/:slug', async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const cr = await pool.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status === 'draft') return res.status(404).json({ error: 'not_found' });
    const countsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1)::int AS entries_count,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE)::int AS winners_filled`,
      [c.id]
    );
    const standings = await pool.query(
      `SELECT display_name, score, highest_tier, status, is_winner, winner_rank
       FROM challenge_entries WHERE challenge_id = $1
       ORDER BY (winner_rank IS NULL), winner_rank ASC, score DESC LIMIT 20`,
      [c.id]
    );
    let myEntry = null;
    if (deviceId && deviceId.length >= 8) {
      const me = await pool.query(
        `SELECT * FROM challenge_entries WHERE challenge_id = $1 AND device_id = $2`,
        [c.id, deviceId]
      );
      myEntry = me.rows[0] || null;
    }
    res.json({
      ok: true,
      challenge: publicChallengeRow(c, myEntry, countsRes.rows[0].entries_count, countsRes.rows[0].winners_filled),
      standings: standings.rows
    });
  } catch (e) {
    console.error('GET /api/challenges/:slug', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/challenges/:slug/enter — create the single attempt row.
app.post('/api/challenges/:slug/enter', async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, displayName } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('challenge:enter', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cleanedName = cleanDisplayName(displayName);
    if (!cleanedName || cleanedName === 'אנונימי') {
      return res.status(400).json({ error: 'bad_name' });
    }
    const cr = await pool.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status !== 'active') return res.status(403).json({ error: 'not_active' });
    if (new Date(c.starts_at) > new Date()) return res.status(403).json({ error: 'not_started' });
    if (new Date(c.ends_at) <= new Date())  return res.status(403).json({ error: 'ended' });
    // PK on (challenge_id, device_id) enforces single-attempt at the DB layer.
    try {
      await pool.query(
        `INSERT INTO challenge_entries (challenge_id, device_id, display_name)
         VALUES ($1, $2, $3)`,
        [c.id, deviceId, cleanedName]
      );
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'already_entered' });
      throw err;
    }
    res.json({
      ok: true,
      boardSeed:     c.board_seed,
      challengeType: c.challenge_type,
      thresholdScore: c.threshold_score,
      thresholdTier:  c.threshold_tier,
      winnersCount:  c.winners_count,
      prizeText:     c.prize_text
    });
  } catch (e) {
    console.error('POST /api/challenges/:slug/enter', e);
    res.status(500).json({ error: 'server' });
  }
});

// Internal: race-safe winner-slot grab. Returns winnerRank if this entry just
// won, or null if no slot was taken. Caller decides whether to set the
// reached_*_at timestamp.
async function maybeGrabWinnerSlot(client, challengeId, deviceId, eventColumn) {
  // FOR UPDATE locks the challenges row so two players can't both pass the
  // gating check simultaneously and overflow winners_count.
  const ch = await client.query(`SELECT id, winners_count FROM challenges WHERE id = $1 FOR UPDATE`, [challengeId]);
  if (!ch.rows.length) return null;
  const winnersCount = ch.rows[0].winners_count | 0;
  const won = await client.query(
    `SELECT COUNT(*)::int AS c FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE`,
    [challengeId]
  );
  const filled = won.rows[0].c | 0;
  if (filled >= winnersCount) return null;
  const nextRank = filled + 1;
  const upd = await client.query(
    `UPDATE challenge_entries
     SET is_winner = TRUE, winner_rank = $1, ${eventColumn} = NOW()
     WHERE challenge_id = $2 AND device_id = $3 AND is_winner = FALSE
     RETURNING winner_rank`,
    [nextRank, challengeId, deviceId]
  );
  if (!upd.rows.length) return null;
  return nextRank;
}

// POST /api/challenges/:slug/score — heartbeat per drop. score-only-grows.
app.post('/api/challenges/:slug/score', async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, score, tier, drops } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('challenge:score', deviceId, 600, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : 0;

    const cr = await client.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status !== 'active') return res.status(403).json({ error: 'not_active' });

    const er = await client.query(
      `UPDATE challenge_entries
       SET score = GREATEST(score, $1),
           highest_tier = GREATEST(highest_tier, $2),
           drops_count = GREATEST(drops_count, $3)
       WHERE challenge_id = $4 AND device_id = $5 AND status = 'in_progress'
       RETURNING *`,
      [Math.floor(score), Math.floor(tier), dropsN, c.id, deviceId]
    );
    if (!er.rows.length) return res.status(409).json({ error: 'no_active_entry' });
    const entry = er.rows[0];

    let wonNow = null;
    // Race & first_to_tier check for winner slot eagerly so the threshold-crossing player
    // is rewarded in real time. Beat marks at /complete. Top_N marks at admin /finalize.
    if (c.challenge_type === 'race' && c.threshold_score != null
        && entry.score >= c.threshold_score && entry.reached_threshold_at == null) {
      await client.query('BEGIN');
      try {
        wonNow = await maybeGrabWinnerSlot(client, c.id, deviceId, 'reached_threshold_at');
        // If the slot was full, at least record the crossing time for analytics.
        if (wonNow == null) {
          await client.query(
            `UPDATE challenge_entries SET reached_threshold_at = COALESCE(reached_threshold_at, NOW())
             WHERE challenge_id = $1 AND device_id = $2`,
            [c.id, deviceId]
          );
        }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    } else if (c.challenge_type === 'first_to_tier' && c.threshold_tier != null
        && entry.highest_tier >= c.threshold_tier && entry.reached_tier_at == null) {
      await client.query('BEGIN');
      try {
        wonNow = await maybeGrabWinnerSlot(client, c.id, deviceId, 'reached_tier_at');
        if (wonNow == null) {
          await client.query(
            `UPDATE challenge_entries SET reached_tier_at = COALESCE(reached_tier_at, NOW())
             WHERE challenge_id = $1 AND device_id = $2`,
            [c.id, deviceId]
          );
        }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    res.json({ ok: true, score: entry.score | 0, tier: entry.highest_tier | 0, isWinner: wonNow != null, winnerRank: wonNow });
  } catch (e) {
    console.error('POST /api/challenges/:slug/score', e);
    res.status(500).json({ error: 'server' });
  } finally {
    client.release();
  }
});

// POST /api/challenges/:slug/complete — final submit. Locks the entry.
app.post('/api/challenges/:slug/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, score, tier, drops } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : 0;

    const cr = await client.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];

    // Lock the entry to 'completed' atomically. Anti-cheat sanity check runs here.
    const finalScore = Math.floor(score);
    const finalTier  = Math.floor(tier);
    const cheatByDrops = challengeDropsImplausible(finalScore, dropsN);

    const er = await client.query(
      `UPDATE challenge_entries
       SET score = GREATEST(score, $1),
           highest_tier = GREATEST(highest_tier, $2),
           drops_count = GREATEST(drops_count, $3),
           status = 'completed',
           completed_at = NOW(),
           cheat_flag = cheat_flag OR $4
       WHERE challenge_id = $5 AND device_id = $6 AND status = 'in_progress'
       RETURNING *`,
      [finalScore, finalTier, dropsN, cheatByDrops, c.id, deviceId]
    );
    if (!er.rows.length) return res.status(409).json({ error: 'no_active_entry' });
    const entry = er.rows[0];

    // Z-score outlier check (uses other completed entries as the baseline).
    const z = await challengeZScore(c.id, entry.score);
    if (z != null && z > 3) {
      await client.query(
        `UPDATE challenge_entries SET cheat_flag = TRUE WHERE challenge_id = $1 AND device_id = $2`,
        [c.id, deviceId]
      );
    }

    // For "beat" type, mark winner immediately if threshold met. No cap on winners.
    // Wrapped in transaction to prevent duplicate winner_rank under concurrency.
    let isWinner = entry.is_winner;
    let winnerRank = entry.winner_rank;
    if (c.challenge_type === 'beat' && c.threshold_score != null && entry.score >= c.threshold_score && !isWinner) {
      await client.query('BEGIN');
      try {
        const w = await client.query(
          `UPDATE challenge_entries SET is_winner = TRUE,
                  winner_rank = (SELECT COUNT(*)+1 FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE),
                  reached_threshold_at = COALESCE(reached_threshold_at, NOW())
           WHERE challenge_id = $1 AND device_id = $2 AND is_winner = FALSE
           RETURNING is_winner, winner_rank`,
          [c.id, deviceId]
        );
        if (w.rows.length) { isWinner = true; winnerRank = w.rows[0].winner_rank; }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    // Compute rank in completed entries (for non-winners to see where they stand).
    const rk = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM challenge_entries
            WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > $2)::int + 1 AS rank,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1)::int AS total`,
      [c.id, entry.score]
    );

    res.json({
      ok: true,
      finalScore: entry.score | 0,
      finalTier:  entry.highest_tier | 0,
      isWinner: !!isWinner,
      winnerRank: winnerRank,
      rank: rk.rows[0].rank | 0,
      totalEntries: rk.rows[0].total | 0,
      cheatFlag: !!entry.cheat_flag || (z != null && z > 3),
      challengeType: c.challenge_type,
      thresholdScore: c.threshold_score
    });
  } catch (e) {
    console.error('POST /api/challenges/:slug/complete', e);
    res.status(500).json({ error: 'server' });
  } finally {
    client.release();
  }
});

// POST /api/challenges/:slug/claim — winner submits contact info.
app.post('/api/challenges/:slug/claim', async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, contactName, contactPhone, contactEmail } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('challenge:claim', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const name  = String(contactName  || '').trim().slice(0, 80);
    const phone = String(contactPhone || '').trim().slice(0, 40);
    const email = String(contactEmail || '').trim().slice(0, 120);
    if (!name)  return res.status(400).json({ error: 'bad_name' });
    if (!phone && !email) return res.status(400).json({ error: 'no_contact' });
    if (email && !email.includes('@')) return res.status(400).json({ error: 'bad_email' });
    const cr = await pool.query(`SELECT id FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const r = await pool.query(
      `UPDATE challenge_entries
       SET contact_name = $1, contact_phone = $2, contact_email = $3, contact_at = NOW()
       WHERE challenge_id = $4 AND device_id = $5 AND is_winner = TRUE AND contact_at IS NULL
       RETURNING 1`,
      [name, phone, email, cr.rows[0].id, deviceId]
    );
    if (!r.rows.length) return res.status(409).json({ error: 'not_winner_or_already_claimed' });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/challenges/:slug/claim', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// VISIT PING (ניתוח ביקורים)
// ============================================================
// POST /api/ping — שורה אחת לכל (device, date). אם השורה כבר קיימת,
// מקדם visit_count ו-last_at. שימוש: ה-frontend קורא פעם אחת ב-init().

app.post('/api/ping', async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: 30/hour/device. The frontend only calls once per init(),
    // but a chatty refresher tab could spam — guard.
    if (!checkRateLimit('ping', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO device_visits (device_id, date)
       VALUES ($1, CURRENT_DATE)
       ON CONFLICT (device_id, date) DO UPDATE SET
         visit_count = device_visits.visit_count + 1,
         last_at     = NOW()`,
      [deviceId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/ping', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// ADMIN ROUTES (כל המסלולים מוגנים ב-requireAdmin)
// ============================================================

if (ADMIN_PATH && ADMIN_PASSWORD) {
  const adminRouter = express.Router();
  adminRouter.use(requireAdmin);

  // Static admin app — single file mirroring public/index.html pattern.
  adminRouter.use(express.static('admin', { maxAge: 0, extensions: ['html'] }));

  // ---------- DASHBOARD ----------
  // One round-trip returns every headline number the admin UI needs at boot.
  adminRouter.get('/api/dashboard', async (_req, res) => {
    try {
      const today = await pool.query(`SELECT CURRENT_DATE AS d`);
      const todayStr = today.rows[0].d.toISOString().slice(0, 10);

      // DAU/WAU/MAU from device_visits (true active = visited).
      const dauRes = await pool.query(
        `SELECT
           (SELECT COUNT(DISTINCT device_id) FROM device_visits WHERE date = CURRENT_DATE)         AS dau,
           (SELECT COUNT(DISTINCT device_id) FROM device_visits
             WHERE date >= CURRENT_DATE - INTERVAL '6 days')                                       AS wau,
           (SELECT COUNT(DISTINCT device_id) FROM device_visits
             WHERE date >= CURRENT_DATE - INTERVAL '29 days')                                      AS mau,
           (SELECT COUNT(*) FROM device_visits WHERE date = CURRENT_DATE
              AND device_id NOT IN (SELECT device_id FROM device_visits WHERE date < CURRENT_DATE)) AS new_today,
           (SELECT COUNT(*) FROM daily_scores WHERE date = CURRENT_DATE)                            AS games_today,
           (SELECT COUNT(*) FROM contests WHERE ends_at > NOW())                                    AS contests_active`
      );
      const k = dauRes.rows[0];

      // DAU 30-day sparkline data.
      const sparkRes = await pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS d
         )
         SELECT d, COALESCE(COUNT(DISTINCT dv.device_id), 0) AS dau
         FROM days
         LEFT JOIN device_visits dv ON dv.date = days.d
         GROUP BY d
         ORDER BY d ASC`
      );
      const sparkline = sparkRes.rows.map(r => ({ date: r.d.toISOString().slice(0, 10), dau: r.dau | 0 }));

      // D1 retention — yesterday's first-visit cohort, who came back today.
      const d1Res = await pool.query(
        `WITH yesterday_first AS (
           SELECT device_id FROM device_visits dv
           WHERE date = CURRENT_DATE - INTERVAL '1 day'
             AND NOT EXISTS (
               SELECT 1 FROM device_visits dv2
               WHERE dv2.device_id = dv.device_id AND dv2.date < dv.date
             )
         )
         SELECT
           (SELECT COUNT(*) FROM yesterday_first)                                         AS cohort_size,
           (SELECT COUNT(*) FROM yesterday_first
              WHERE device_id IN (SELECT device_id FROM device_visits WHERE date = CURRENT_DATE)) AS returned`
      );
      const d1Cohort = parseInt(d1Res.rows[0].cohort_size, 10) || 0;
      const d1Returned = parseInt(d1Res.rows[0].returned, 10) || 0;
      const d1Pct = d1Cohort > 0 ? Math.round(1000 * d1Returned / d1Cohort) / 10 : null;

      // Anomaly flag: DAU vs 7-day rolling avg (excluding today).
      const baselineRes = await pool.query(
        `SELECT AVG(c)::float AS avg7 FROM (
           SELECT COUNT(DISTINCT device_id) AS c
           FROM device_visits
           WHERE date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day'
           GROUP BY date
         ) t`
      );
      const baseline = parseFloat(baselineRes.rows[0].avg7 || 0);
      const dauToday = k.dau | 0;
      let anomaly = null;
      if (baseline >= 5 && dauToday < baseline * 0.7) {
        anomaly = {
          severity: 'warn',
          message: 'DAU היום ' + dauToday + ' — צניחה של ' +
            Math.round(100 * (1 - dauToday / baseline)) + '% מהממוצע של 7 ימים (' +
            Math.round(baseline) + ')'
        };
      }

      res.json({
        ok: true,
        today: todayStr,
        kpis: {
          dau: dauToday,
          wau: k.wau | 0,
          mau: k.mau | 0,
          newToday: k.new_today | 0,
          gamesToday: k.games_today | 0,
          contestsActive: k.contests_active | 0,
          d1Pct, d1Cohort, d1Returned
        },
        benchmarks: { d1: 40, d7: 20, d30: 7 },  // 2026 hybrid-casual medians
        sparkline,
        anomaly
      });
    } catch (e) {
      console.error('admin /dashboard', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- RETENTION (cohorts) ----------
  adminRouter.get('/api/retention', async (_req, res) => {
    try {
      // Weekly cohorts (first-visit week) × D1/D7/D30 returns.
      // Last 8 weeks. A cohort with size < 3 is reported but flagged.
      const rows = await pool.query(
        `WITH first_visit AS (
           SELECT device_id, MIN(date) AS first_date
           FROM device_visits
           GROUP BY device_id
         ),
         cohort AS (
           SELECT date_trunc('week', first_date)::date AS week, device_id, first_date
           FROM first_visit
           WHERE first_date >= CURRENT_DATE - INTERVAL '8 weeks'
         )
         SELECT
           c.week,
           COUNT(*)::int AS size,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 1
           ))::int AS d1,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 7
           ))::int AS d7,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 30
           ))::int AS d30
         FROM cohort c
         GROUP BY c.week
         ORDER BY c.week DESC`
      );
      const list = rows.rows.map(r => ({
        weekStart: r.week.toISOString().slice(0, 10),
        size: r.size,
        d1: r.size ? Math.round(1000 * r.d1 / r.size) / 10 : null,
        d7: r.size ? Math.round(1000 * r.d7 / r.size) / 10 : null,
        d30: r.size ? Math.round(1000 * r.d30 / r.size) / 10 : null
      }));
      res.json({ ok: true, cohorts: list });
    } catch (e) {
      console.error('admin /retention', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- FUNNEL ----------
  adminRouter.get('/api/funnel', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || 7));
      const result = await pool.query(
        `WITH window_visits AS (
           SELECT DISTINCT device_id FROM device_visits
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         ),
         played AS (
           SELECT DISTINCT device_id FROM daily_scores
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         ),
         completed AS (
           SELECT DISTINCT device_id FROM daily_scores
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day' AND score > 0
         ),
         returned AS (
           SELECT DISTINCT v.device_id FROM device_visits v
           JOIN device_visits v2 ON v2.device_id = v.device_id AND v2.date = v.date + 1
           WHERE v.date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         )
         SELECT
           (SELECT COUNT(*) FROM window_visits)::int AS visited,
           (SELECT COUNT(*) FROM played)::int        AS played,
           (SELECT COUNT(*) FROM completed)::int     AS completed,
           (SELECT COUNT(*) FROM returned)::int      AS returned_next_day`,
        [days]
      );
      res.json({ ok: true, days, funnel: result.rows[0] });
    } catch (e) {
      console.error('admin /funnel', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- HEATMAP ----------
  adminRouter.get('/api/heatmap', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
      // game-overs from daily_scores.updated_at, converted to Asia/Jerusalem.
      const result = await pool.query(
        `SELECT
           EXTRACT(DOW  FROM updated_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
           EXTRACT(HOUR FROM updated_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
           COUNT(*)::int AS games
         FROM daily_scores
         WHERE updated_at >= NOW() - $1::int * INTERVAL '1 day'
         GROUP BY dow, hour
         ORDER BY dow, hour`,
        [days]
      );
      // Fill the 7×24 grid.
      const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const r of result.rows) grid[r.dow][r.hour] = r.games;
      res.json({ ok: true, days, grid });
    } catch (e) {
      console.error('admin /heatmap', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- TOP SCORES + Z-SCORE OUTLIERS ----------
  adminRouter.get('/api/top-scores', async (req, res) => {
    try {
      const date = isValidDate(req.query.date) ? req.query.date : null;
      const params = date ? [date] : [];
      const dateClause = date ? 'WHERE date = $1' : 'WHERE date = CURRENT_DATE';
      const result = await pool.query(
        `WITH stats AS (
           SELECT AVG(score)::float AS m, COALESCE(STDDEV_SAMP(score), 0)::float AS s
           FROM daily_scores ${dateClause} AND score > 0
         )
         SELECT ds.name, ds.score, ds.tier, ds.device_id, ds.date, ds.updated_at,
                CASE WHEN s.s > 0 THEN ROUND(((ds.score - s.m) / s.s)::numeric, 2)::float ELSE 0 END AS zscore,
                CASE WHEN s.s > 0 AND (ds.score - s.m) / s.s > 3 THEN true ELSE false END AS outlier
         FROM daily_scores ds CROSS JOIN stats s
         ${dateClause}
         ORDER BY ds.score DESC
         LIMIT 50`,
        params
      );
      res.json({ ok: true, date: date || null, scores: result.rows });
    } catch (e) {
      console.error('admin /top-scores', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CONTESTS ----------
  adminRouter.get('/api/contests', async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.code, c.name, c.host_name, c.host_device_id, c.board_type,
                c.duration_days, c.ends_at, c.status, c.created_at,
                (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code)::int AS members,
                (SELECT MAX(score) FROM contest_scores WHERE contest_code = c.code)    AS top_score
         FROM contests c
         ORDER BY (c.ends_at > NOW()) DESC, c.ends_at DESC`
      );
      res.json({ ok: true, contests: result.rows });
    } catch (e) {
      console.error('admin /contests', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // PATCH contest — change name / end / extend
  adminRouter.patch('/api/contest/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const { name, endsAt, status } = req.body || {};
      if (!code) return res.status(400).json({ error: 'bad_code' });
      const sets = [], values = [code];
      if (typeof name === 'string') {
        const n = cleanContestName(name);
        if (!n) return res.status(400).json({ error: 'bad_name' });
        sets.push('name = $' + (values.length + 1)); values.push(n);
      }
      if (typeof endsAt === 'string') {
        const d = new Date(endsAt);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'bad_ends_at' });
        sets.push('ends_at = $' + (values.length + 1)); values.push(d);
      }
      if (typeof status === 'string') {
        if (!['active', 'paused', 'ended'].includes(status)) return res.status(400).json({ error: 'bad_status' });
        sets.push('status = $' + (values.length + 1)); values.push(status);
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      const r = await pool.query(
        `UPDATE contests SET ${sets.join(', ')} WHERE code = $1 RETURNING *`,
        values
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('contest.patch', 'contest', code, { fields: { name, endsAt, status } });
      res.json({ ok: true, contest: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /contest', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // DELETE contest — cascade through scores/live state via FK ON DELETE CASCADE.
  adminRouter.delete('/api/contest/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const r = await pool.query(`DELETE FROM contests WHERE code = $1 RETURNING name`, [code]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('contest.delete', 'contest', code, { name: r.rows[0].name });
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /contest', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- PLAYERS ----------
  adminRouter.get('/api/players', async (req, res) => {
    try {
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10)  || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const q      = String(req.query.q || '').trim();
      const params = [limit, offset];
      let where = '';
      if (q) {
        params.push('%' + q + '%');
        where = `WHERE name ILIKE $${params.length} OR device_id ILIKE $${params.length}`;
      }
      const rows = await pool.query(
        `SELECT
           device_id,
           MAX(name)              AS name,
           COUNT(*)::int          AS games_played,
           MAX(score)             AS best_score,
           MAX(tier)              AS best_tier,
           MIN(date)              AS first_played,
           MAX(date)              AS last_played
         FROM daily_scores
         ${where}
         GROUP BY device_id
         ORDER BY last_played DESC
         LIMIT $1 OFFSET $2`,
        params
      );
      const total = await pool.query(
        `SELECT COUNT(DISTINCT device_id)::int AS c FROM daily_scores ${where}`,
        q ? [params[2]] : []
      );
      res.json({ ok: true, players: rows.rows, total: total.rows[0].c });
    } catch (e) {
      console.error('admin /players', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Single-player drill-down.
  adminRouter.get('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').slice(0, 64);
      if (!id) return res.status(400).json({ error: 'bad_id' });
      const scores = await pool.query(
        `SELECT date, score, tier, updated_at FROM daily_scores WHERE device_id = $1 ORDER BY date DESC LIMIT 50`,
        [id]
      );
      const contests = await pool.query(
        `SELECT cs.contest_code, c.name AS contest_name, cs.display_name, cs.score, cs.highest_tier,
                cs.games_played, cs.last_played_at
         FROM contest_scores cs JOIN contests c ON c.code = cs.contest_code
         WHERE cs.device_id = $1
         ORDER BY cs.last_played_at DESC`,
        [id]
      );
      const visits = await pool.query(
        `SELECT date, visit_count FROM device_visits WHERE device_id = $1 ORDER BY date DESC LIMIT 90`,
        [id]
      );
      res.json({
        ok: true,
        deviceId: id,
        scores: scores.rows,
        contests: contests.rows,
        visits: visits.rows
      });
    } catch (e) {
      console.error('admin /player/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // DELETE player — cascades manually since daily_scores has no FK back.
  adminRouter.delete('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').slice(0, 64);
      if (!id) return res.status(400).json({ error: 'bad_id' });
      const meta = {};
      const c1 = await pool.query('DELETE FROM daily_scores   WHERE device_id = $1 RETURNING 1', [id]);
      const c2 = await pool.query('DELETE FROM contest_scores WHERE device_id = $1 RETURNING 1', [id]);
      const c3 = await pool.query('DELETE FROM device_visits  WHERE device_id = $1 RETURNING 1', [id]);
      const c4 = await pool.query('DELETE FROM contest_live_state WHERE device_id = $1 RETURNING 1', [id]);
      const c5 = await pool.query('DELETE FROM contest_watchers  WHERE watcher_device_id = $1 OR target_device_id = $1 RETURNING 1', [id]);
      meta.deletions = {
        daily_scores: c1.rowCount, contest_scores: c2.rowCount,
        device_visits: c3.rowCount, contest_live_state: c4.rowCount, contest_watchers: c5.rowCount
      };
      await logAdminAction('player.delete', 'player', id, meta);
      res.json({ ok: true, deletions: meta.deletions });
    } catch (e) {
      console.error('admin DELETE /player', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- AUDIT LOG ----------
  adminRouter.get('/api/audit', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
      const rows = await pool.query(
        `SELECT id, action, target_type, target_id, metadata, created_at
         FROM admin_actions ORDER BY id DESC LIMIT $1`,
        [limit]
      );
      res.json({ ok: true, actions: rows.rows });
    } catch (e) {
      console.error('admin /audit', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- LIVE — what's happening right now ----------
  adminRouter.get('/api/live', async (_req, res) => {
    try {
      // Contest live state (existing)
      const live = await pool.query(
        `SELECT ls.contest_code, ls.device_id, ls.display_name, ls.live_score, ls.highest_tier, ls.updated_at, c.name AS contest_name
         FROM contest_live_state ls JOIN contests c ON c.code = ls.contest_code
         WHERE ls.updated_at > NOW() - INTERVAL '30 seconds'
         ORDER BY ls.live_score DESC`
      );
      // All active players from heartbeat (daily, practice, contest, challenge)
      const heartbeat = await pool.query(
        `SELECT device_id, display_name, mode, score, highest_tier, updated_at
         FROM player_heartbeat
         WHERE updated_at > NOW() - INTERVAL '45 seconds'
         ORDER BY score DESC`
      );
      const watchers = await pool.query(
        `SELECT contest_code, watcher_name, target_device_id, watcher_last_score, updated_at
         FROM contest_watchers
         WHERE updated_at > NOW() - INTERVAL '30 seconds'
         ORDER BY updated_at DESC`
      );
      res.json({ ok: true, live: live.rows, heartbeat: heartbeat.rows, watchers: watchers.rows });
    } catch (e) {
      console.error('admin /live', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CHALLENGES ----------
  adminRouter.get('/api/challenges', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.*,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int                  AS entries_count,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND cheat_flag = TRUE)::int AS cheat_count
         FROM challenges c
         ORDER BY (c.status = 'active') DESC, c.created_at DESC`
      );
      res.json({ ok: true, challenges: r.rows });
    } catch (e) {
      console.error('admin /challenges', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/challenges', async (req, res) => {
    try {
      const b = req.body || {};
      // Hebrew-only names cleanSlug to "" — fall back to a generated slug so
      // the admin doesn't need to pick an ASCII slug for every contest.
      let slug = cleanSlug(b.slug || b.name || '');
      if (!slug || slug.length < 3) {
        slug = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      }
      const name = cleanContestName(b.name);
      if (!name) return res.status(400).json({ error: 'bad_name' });
      const type = b.challenge_type;
      if (!CHALLENGE_TYPES.includes(type)) return res.status(400).json({ error: 'bad_type' });
      const winners = Math.max(1, Math.min(100, parseInt(b.winners_count, 10) || 1));
      const prizeText = String(b.prize_text || '').trim().slice(0, 200);
      if (!prizeText) return res.status(400).json({ error: 'bad_prize' });
      const prizeImageUrl = b.prize_image_url ? String(b.prize_image_url).trim().slice(0, 500) : null;
      if (prizeImageUrl && !/^https?:\/\//i.test(prizeImageUrl)) return res.status(400).json({ error: 'bad_image_url' });
      let thresholdScore = null, thresholdTier = null;
      if (type === 'race' || type === 'beat') {
        thresholdScore = parseInt(b.threshold_score, 10);
        if (!Number.isFinite(thresholdScore) || thresholdScore < 100 || thresholdScore > 10_000_000) {
          return res.status(400).json({ error: 'bad_threshold_score' });
        }
      } else if (type === 'first_to_tier') {
        thresholdTier = parseInt(b.threshold_tier, 10);
        if (!Number.isFinite(thresholdTier) || thresholdTier < 2 || thresholdTier > 8) {
          return res.status(400).json({ error: 'bad_threshold_tier' });
        }
      }
      const startsAt = b.starts_at ? new Date(b.starts_at) : new Date();
      const endsAt   = b.ends_at   ? new Date(b.ends_at)   : null;
      if (!endsAt || isNaN(endsAt.getTime())) return res.status(400).json({ error: 'bad_ends_at' });
      if (endsAt <= startsAt) return res.status(400).json({ error: 'ends_before_starts' });
      const rulesText = b.rules_text ? String(b.rules_text).trim() : null;
      const boardSeed = b.board_seed != null && Number.isFinite(parseInt(b.board_seed, 10))
        ? parseInt(b.board_seed, 10) : Math.floor(Math.random() * 2147483647);
      const status = b.status === 'active' ? 'active' : 'draft';

      const r = await pool.query(
        `INSERT INTO challenges (slug, name, description, challenge_type, threshold_score, threshold_tier,
                                 winners_count, prize_text, prize_image_url, board_seed, starts_at, ends_at, rules_text, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [slug, name, b.description || null, type, thresholdScore, thresholdTier,
         winners, prizeText, prizeImageUrl, boardSeed, startsAt, endsAt, rulesText, status]
      );
      await logAdminAction('challenge.create', 'challenge', String(r.rows[0].id), { slug, name, type });
      res.json({ ok: true, challenge: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'slug_taken' });
      console.error('admin POST /challenges', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Lock-down rules: once entries exist + starts_at passed, only "cosmetic"
  // fields are editable. Hard-mode fields (type, thresholds, winners_count)
  // would change the game mid-flight.
  const LOCKED_FIELDS = new Set(['challenge_type', 'threshold_score', 'threshold_tier', 'winners_count', 'starts_at', 'board_seed']);
  const SAFE_FIELDS   = new Set(['name', 'description', 'prize_text', 'prize_image_url', 'rules_text', 'ends_at', 'status']);

  adminRouter.patch('/api/challenges/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const cr = await pool.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
      if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
      const current = cr.rows[0];
      const entriesRes = await pool.query(`SELECT COUNT(*)::int AS c FROM challenge_entries WHERE challenge_id = $1`, [id]);
      const hasEntries = (entriesRes.rows[0].c | 0) > 0;
      const startsHasPassed = new Date(current.starts_at) <= new Date();
      const locked = hasEntries && startsHasPassed;
      const b = req.body || {};
      const sets = [], values = [id];
      const apply = (col, val) => { sets.push(col + ' = $' + (values.length + 1)); values.push(val); };
      for (const k of Object.keys(b)) {
        if (locked && LOCKED_FIELDS.has(k)) {
          return res.status(409).json({ error: 'challenge_locked', field: k });
        }
        if (!LOCKED_FIELDS.has(k) && !SAFE_FIELDS.has(k)) continue;
        // Per-field validation when changing locked fields on a draft (allowed).
        if (k === 'name')             { const v = cleanContestName(b[k]); if (!v) return res.status(400).json({error:'bad_name'}); apply('name', v); }
        else if (k === 'description') { apply('description', b[k] ? String(b[k]).trim() : null); }
        else if (k === 'prize_text')  { const v = String(b[k]||'').trim().slice(0,200); if (!v) return res.status(400).json({error:'bad_prize'}); apply('prize_text', v); }
        else if (k === 'prize_image_url') {
          const v = b[k] ? String(b[k]).trim().slice(0,500) : null;
          if (v && !/^https?:\/\//i.test(v)) return res.status(400).json({error:'bad_image_url'});
          apply('prize_image_url', v);
        }
        else if (k === 'rules_text')  { apply('rules_text', b[k] ? String(b[k]).trim() : null); }
        else if (k === 'ends_at') {
          const d = new Date(b[k]); if (isNaN(d.getTime())) return res.status(400).json({error:'bad_ends_at'});
          // If already locked, only allow extending (can't cut the contest short on players).
          if (locked && d < new Date(current.ends_at)) return res.status(409).json({error:'cannot_shorten'});
          apply('ends_at', d);
        }
        else if (k === 'status') {
          if (!['draft','active','ended','cancelled'].includes(b[k])) return res.status(400).json({error:'bad_status'});
          apply('status', b[k]);
        }
        else if (k === 'starts_at') {
          const d = new Date(b[k]); if (isNaN(d.getTime())) return res.status(400).json({error:'bad_starts_at'});
          apply('starts_at', d);
        }
        else if (k === 'challenge_type') {
          if (!CHALLENGE_TYPES.includes(b[k])) return res.status(400).json({error:'bad_type'});
          apply('challenge_type', b[k]);
        }
        else if (k === 'threshold_score') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 100 || v > 10_000_000) return res.status(400).json({error:'bad_threshold_score'});
          apply('threshold_score', v);
        }
        else if (k === 'threshold_tier') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 2 || v > 8) return res.status(400).json({error:'bad_threshold_tier'});
          apply('threshold_tier', v);
        }
        else if (k === 'winners_count') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 1 || v > 100) return res.status(400).json({error:'bad_winners_count'});
          apply('winners_count', v);
        }
        else if (k === 'board_seed') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v)) return res.status(400).json({error:'bad_board_seed'});
          apply('board_seed', v);
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      sets.push('updated_at = NOW()');
      const r = await pool.query(`UPDATE challenges SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
      await logAdminAction('challenge.patch', 'challenge', String(id), { fields: Object.keys(b) });
      res.json({ ok: true, challenge: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /challenges/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.delete('/api/challenges/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const r = await pool.query(`DELETE FROM challenges WHERE id = $1 RETURNING slug, name`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('challenge.delete', 'challenge', String(id), { slug: r.rows[0].slug, name: r.rows[0].name });
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /challenges/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Full entries list for a challenge — admin sees everything including contact info + cheat flag.
  adminRouter.get('/api/challenges/:id/entries', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const cr = await pool.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
      if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
      const er = await pool.query(
        `SELECT * FROM challenge_entries
         WHERE challenge_id = $1
         ORDER BY (winner_rank IS NULL), winner_rank ASC, score DESC, completed_at ASC`,
        [id]
      );
      res.json({ ok: true, challenge: cr.rows[0], entries: er.rows });
    } catch (e) {
      console.error('admin /challenges/:id/entries', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Finalize — closes the challenge, marks in_progress as abandoned, runs winner
  // assignment for top_n (race/beat already mark eagerly).
  adminRouter.post('/api/challenges/:id/finalize', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      await client.query('BEGIN');
      const cr = await client.query(`SELECT * FROM challenges WHERE id = $1 FOR UPDATE`, [id]);
      if (!cr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
      const c = cr.rows[0];
      // Mark in_progress entries as abandoned (final score = whatever they had).
      await client.query(
        `UPDATE challenge_entries SET status = 'abandoned' WHERE challenge_id = $1 AND status = 'in_progress'`,
        [id]
      );
      if (c.challenge_type === 'top_n') {
        await client.query(
          `UPDATE challenge_entries SET is_winner = TRUE, winner_rank = sub.rnk
           FROM (
             SELECT device_id, ROW_NUMBER() OVER (ORDER BY score DESC, completed_at ASC NULLS LAST) AS rnk
             FROM challenge_entries
             WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > 0
           ) sub
           WHERE challenge_entries.challenge_id = $1
             AND challenge_entries.device_id = sub.device_id
             AND sub.rnk <= $2`,
          [id, c.winners_count]
        );
      }
      await client.query(`UPDATE challenges SET status = 'ended', updated_at = NOW() WHERE id = $1`, [id]);
      await client.query('COMMIT');
      await logAdminAction('challenge.finalize', 'challenge', String(id), { type: c.challenge_type });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('admin POST /challenges/:id/finalize', e);
      res.status(500).json({ error: 'server' });
    } finally {
      client.release();
    }
  });

  // Manual override on a single entry — toggle winner / cheat_flag / prize_claimed.
  adminRouter.patch('/api/challenges/:id/entries/:device_id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const did = String(req.params.device_id || '').slice(0, 64);
      if (!Number.isFinite(id) || !did) return res.status(400).json({ error: 'bad_params' });
      const sets = [], values = [id, did];
      const b = req.body || {};
      if (typeof b.is_winner === 'boolean') {
        sets.push('is_winner = $' + (values.length + 1)); values.push(b.is_winner);
        if (!b.is_winner) sets.push('winner_rank = NULL');
      }
      if (typeof b.cheat_flag === 'boolean') {
        sets.push('cheat_flag = $' + (values.length + 1)); values.push(b.cheat_flag);
      }
      if (typeof b.prize_claimed === 'boolean') {
        sets.push('prize_claimed = $' + (values.length + 1)); values.push(b.prize_claimed);
        sets.push('prize_claimed_at = ' + (b.prize_claimed ? 'NOW()' : 'NULL'));
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      const r = await pool.query(
        `UPDATE challenge_entries SET ${sets.join(', ')} WHERE challenge_id = $1 AND device_id = $2 RETURNING *`,
        values
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('entry.patch', 'challenge_entry', id + ':' + did, b);
      res.json({ ok: true, entry: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /challenges/:id/entries/:device_id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- GAME CONFIG ----------
  adminRouter.get('/api/config', async (_req, res) => {
    try {
      const r = await pool.query('SELECT key, value, updated_at FROM game_config ORDER BY key');
      res.json({ ok: true, config: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.patch('/api/config/:key', async (req, res) => {
    try {
      const key = String(req.params.key || '').slice(0, 60);
      const { value } = req.body || {};
      if (!key || typeof value !== 'string') return res.status(400).json({ error: 'bad_input' });
      await pool.query(
        `INSERT INTO game_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value.slice(0, 200)]
      );
      _configCache = {}; _configCacheTs = 0; // bust cache
      await logAdminAction('config.update', 'game_config', key, { value });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CSV EXPORT ----------
  const exportTables = {
    'daily_scores':       ['date', 'device_id', 'name', 'score', 'tier', 'created_at', 'updated_at'],
    'contests':           ['code', 'name', 'host_name', 'host_device_id', 'board_type', 'duration_days', 'created_at', 'ends_at', 'status'],
    'contest_scores':     ['contest_code', 'device_id', 'display_name', 'score', 'highest_tier', 'games_played', 'joined_at', 'last_played_at'],
    'device_visits':      ['device_id', 'date', 'visit_count', 'first_at', 'last_at'],
    'admin_actions':      ['id', 'action', 'target_type', 'target_id', 'metadata', 'created_at'],
    'challenges':         ['id', 'slug', 'name', 'challenge_type', 'threshold_score', 'threshold_tier', 'winners_count', 'prize_text', 'starts_at', 'ends_at', 'status', 'created_at'],
    'challenge_entries':  ['challenge_id', 'device_id', 'display_name', 'score', 'highest_tier', 'drops_count', 'status', 'is_winner', 'winner_rank', 'cheat_flag', 'contact_name', 'contact_phone', 'contact_email', 'contact_at', 'prize_claimed', 'started_at', 'completed_at']
  };
  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    let s;
    if (v instanceof Date) s = v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  adminRouter.get('/api/export/:table.csv', async (req, res) => {
    const table = req.params.table;
    const cols = exportTables[table];
    if (!cols) return res.status(404).json({ error: 'unknown_table' });
    try {
      const r = await pool.query(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY 1 DESC LIMIT 10000`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bloom_${table}_${new Date().toISOString().slice(0,10)}.csv"`);
      res.write('﻿'); // BOM for Excel + Hebrew
      res.write(cols.join(',') + '\n');
      for (const row of r.rows) {
        res.write(cols.map(c => csvEscape(row[c])).join(',') + '\n');
      }
      res.end();
    } catch (e) {
      console.error('admin /export', e);
      res.status(500).json({ error: 'server' });
    }
  });

  app.use(ADMIN_PATH, adminRouter);
  console.log('[admin] mounted at ' + ADMIN_PATH);
} else {
  console.log('[admin] disabled — set ADMIN_PATH + ADMIN_PASSWORD env vars to enable');
}

// ============================================================
// PLAYER HEARTBEAT — tracks all active players (any mode)
// ============================================================
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { deviceId, displayName, mode, score, highestTier } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device' });
    await pool.query(
      `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (device_id) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, player_heartbeat.display_name),
           mode = EXCLUDED.mode,
           score = EXCLUDED.score,
           highest_tier = EXCLUDED.highest_tier,
           updated_at = NOW()`,
      [String(deviceId).slice(0, 64),
       String(displayName || '').slice(0, 100) || 'אנונימי',
       String(mode || 'daily').slice(0, 20),
       Math.max(0, parseInt(score, 10) || 0),
       Math.max(1, parseInt(highestTier, 10) || 1)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('heartbeat', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// Cleanup old heartbeats every hour
setInterval(async () => {
  try {
    await pool.query(`DELETE FROM player_heartbeat WHERE updated_at < NOW() - INTERVAL '2 minutes'`);
  } catch (e) {}
}, 60 * 1000);

// ============================================================
// GAME CONFIG (admin-controlled runtime settings)
// ============================================================

// In-memory cache refreshed every 60s (avoids DB hit per page load).
let _configCache = {};
let _configCacheTs = 0;
const CONFIG_CACHE_TTL = 60 * 1000;

async function loadConfig() {
  if (Date.now() - _configCacheTs < CONFIG_CACHE_TTL) return _configCache;
  try {
    const r = await pool.query('SELECT key, value FROM game_config');
    const cfg = {};
    for (const row of r.rows) cfg[row.key] = row.value;
    _configCache = cfg;
    _configCacheTs = Date.now();
  } catch (e) {
    console.warn('loadConfig failed', e.message);
  }
  return _configCache;
}

app.get('/api/config', async (_req, res) => {
  try {
    const cfg = await loadConfig();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ============================================================
// SERVER START
// ============================================================

const port = process.env.PORT || 3000;
initDb()
  .catch((e) => console.error('[db] init failed:', e))
  .finally(() => {
    const server = app.listen(port, () => console.log(`[bloom] listening on ${port}`));

    // ============================================================
    // EPHEMERAL TABLE CLEANUP (every hour)
    // ============================================================
    setInterval(async () => {
      try {
        await pool.query(`DELETE FROM contest_live_state WHERE updated_at < NOW() - INTERVAL '1 hour'`);
        await pool.query(`DELETE FROM contest_watchers WHERE updated_at < NOW() - INTERVAL '1 hour'`);
      } catch (e) {
        console.warn('[cleanup] ephemeral cleanup failed', e.message);
      }
    }, 60 * 60 * 1000);

    // ============================================================
    // GRACEFUL SHUTDOWN
    // ============================================================
    function shutdown(signal) {
      console.log(`[bloom] ${signal} received, shutting down gracefully`);
      server.close(() => {
        pool.end(() => {
          console.log('[bloom] shut down complete');
          process.exit(0);
        });
      });
      setTimeout(() => { console.error('[bloom] forced shutdown'); process.exit(1); }, 10000);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  });
