import express from 'express';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { readFile as readFileSw } from 'node:fs/promises';
import { pool, initDb } from './db.js';
import { startBots, stopBots, getBotStatus } from './bot-engine.js';

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

// SEO: robots.txt + sitemap
app.get('/robots.txt', (_req, res) => {
  res.type('text').send('User-agent: *\nAllow: /\nSitemap: https://bloom-web-production-f3bd.up.railway.app/sitemap.xml');
});
app.get('/sitemap.xml', (_req, res) => {
  const base = 'https://bloom-web-production-f3bd.up.railway.app';
  res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
</urlset>`);
});

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

    // Daily jackpot auto-contribution (first submission only)
    try {
      const jpEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_enabled'`);
      if (!jpEnabled.rows.length || jpEnabled.rows[0].value !== 'false') {
        const jpEntry = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_entry'`);
        const entryFee = parseInt((jpEntry.rows[0] || {}).value, 10) || 5;
        if (entryFee > 0) {
          // Check player has balance + hasn't contributed today
          const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
          if (player.rows.length && player.rows[0].balance >= entryFee) {
            const alreadyIn = await pool.query(
              `SELECT 1 FROM wager_settlements WHERE contest_code = $1 AND device_id = $2 AND type = 'jackpot_entry'`,
              ['JP:' + date, deviceId]);
            if (!alreadyIn.rows.length) {
              await pool.query(`UPDATE player_profiles SET balance = balance - $1, total_spent = total_spent + $1 WHERE device_id = $2`, [entryFee, deviceId]);
              await pool.query(
                `INSERT INTO daily_jackpot (date, pool, entries) VALUES ($1, $2, 1)
                 ON CONFLICT (date) DO UPDATE SET pool = daily_jackpot.pool + $2, entries = daily_jackpot.entries + 1`,
                [date, entryFee]);
              await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'jackpot_entry')`,
                ['JP:' + date, deviceId, -entryFee]);
            }
          }
        }
      }
    } catch (jpErr) { /* non-critical */ }

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
    const { name, hostName, deviceId, durationDays, boardType, wagerAmount } = req.body || {};

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

    // Wager handling
    let wager = parseInt(wagerAmount, 10) || 0;
    if (wager > 0) {
      const wcfg = await pool.query(`SELECT key, value FROM game_config WHERE key IN ('wager_enabled','wager_min','wager_max')`);
      const cfg = {}; for (const r of wcfg.rows) cfg[r.key] = r.value;
      if (cfg.wager_enabled === 'false') { wager = 0; }
      else {
        const min = parseInt(cfg.wager_min, 10) || 10;
        const max = parseInt(cfg.wager_max, 10) || 500;
        if (wager < min) return res.status(400).json({ error: 'wager_too_low', min });
        if (wager > max) wager = max;
        // Deduct from host
        const host = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
        if (!host.rows.length || host.rows[0].balance < wager) {
          return res.status(400).json({ error: 'insufficient_balance' });
        }
        await pool.query(`UPDATE player_profiles SET balance = balance - $1, total_spent = total_spent + $1 WHERE device_id = $2`, [wager, deviceId]);
      }
    }

    const code = await generateUniqueContestCode();

    const result = await pool.query(
      `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, ends_at, wager_amount, wager_pool)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [code, cleanedName, cleanedHost, deviceId, seed, type, dur, endsAt, wager, wager]
    );

    // Record settlement entry for host
    if (wager > 0) {
      await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'entry')`,
        [code, deviceId, -wager]);
    }

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

    // Handle wager payment for new joiners
    const contest = contestResult.rows[0];
    const wagerAmt = contest.wager_amount | 0;
    if (wagerAmt > 0 && contest.host_device_id !== deviceId) {
      // Check if already paid (re-join shouldn't double-charge)
      const alreadyPaid = await pool.query(
        `SELECT 1 FROM wager_settlements WHERE contest_code = $1 AND device_id = $2 AND type = 'entry'`, [code, deviceId]);
      if (!alreadyPaid.rows.length) {
        const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
        if (!player.rows.length || player.rows[0].balance < wagerAmt) {
          return res.status(400).json({ error: 'insufficient_balance', wagerRequired: wagerAmt });
        }
        await pool.query(`UPDATE player_profiles SET balance = balance - $1, total_spent = total_spent + $1 WHERE device_id = $2`, [wagerAmt, deviceId]);
        await pool.query(`UPDATE contests SET wager_pool = wager_pool + $1 WHERE code = $2`, [wagerAmt, code]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'entry')`, [code, deviceId, -wagerAmt]);
      }
    }

    res.json({ ok: true, contest: contest });
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
         WHERE ls.updated_at > NOW() - INTERVAL '60 seconds'
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
         WHERE updated_at > NOW() - INTERVAL '60 seconds'
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

  // ---------- SERVER BOTS ----------
  adminRouter.get('/api/bots', (_req, res) => {
    res.json({ ok: true, ...getBotStatus() });
  });
  adminRouter.post('/api/bots/start', (req, res) => {
    const count = Math.max(1, Math.min(200, parseInt(req.body.count, 10) || 10));
    const config = {
      mode: req.body.mode || 'practice',
      speed: req.body.speed || 'normal',
      contestCode: req.body.contestCode || null,
      challengeSlug: req.body.challengeSlug || null,
      restartMin: Math.max(5, Math.min(300, parseInt(req.body.restartMin, 10) || 30)),
      restartMax: Math.max(10, Math.min(600, parseInt(req.body.restartMax, 10) || 90))
    };
    const started = startBots(count, pool, config);
    logAdminAction('bots.start', 'bots', String(count), { ...config, started });
    res.json({ ok: true, count: started });
  });
  adminRouter.post('/api/bots/stop', (_req, res) => {
    stopBots();
    logAdminAction('bots.stop', 'bots', '0', {});
    res.json({ ok: true });
  });

  // ---------- PLAYER MANAGEMENT ----------

  // Settle contest wager — distribute pool to top 3
  adminRouter.post('/api/wager/settle', async (req, res) => {
    const { contestCode } = req.body || {};
    if (!contestCode) return res.status(400).json({ error: 'missing_code' });
    try {
      const contest = await pool.query('SELECT * FROM contests WHERE code = $1', [contestCode]);
      if (!contest.rows.length) return res.status(404).json({ error: 'not_found' });
      const c = contest.rows[0];
      if ((c.wager_amount | 0) === 0) return res.json({ ok: false, reason: 'no_wager' });
      if (c.wager_settled) return res.json({ ok: false, reason: 'already_settled' });
      const pool_amount = c.wager_pool | 0;
      if (pool_amount <= 0) return res.json({ ok: false, reason: 'empty_pool' });

      // Get top 3 players who actually played (score > 0)
      const top = await pool.query(
        `SELECT device_id, display_name, score FROM contest_scores
         WHERE contest_code = $1 AND score > 0 ORDER BY score DESC LIMIT 3`, [contestCode]);

      // Get config percentages
      const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%'`);
      const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
      const rake = parseInt(cfg.wager_rake, 10) || 5;
      const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
      const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
      const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;

      const rakeAmount = Math.round(pool_amount * rake / 100);
      const distributable = pool_amount - rakeAmount;
      const prizes = [
        Math.round(distributable * pct1 / (pct1 + pct2 + pct3)),
        Math.round(distributable * pct2 / (pct1 + pct2 + pct3)),
        Math.round(distributable * pct3 / (pct1 + pct2 + pct3))
      ];

      const winners = [];
      for (let i = 0; i < Math.min(3, top.rows.length); i++) {
        const prize = prizes[i] || 0;
        if (prize <= 0) continue;
        const p = top.rows[i];
        await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, p.device_id]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
          [contestCode, p.device_id, prize, 'win_' + (i + 1)]);
        winners.push({ name: p.display_name, score: p.score, prize, place: i + 1 });
      }

      // Record rake
      if (rakeAmount > 0) {
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'rake')`,
          [contestCode, rakeAmount]);
      }

      // Mark as settled
      await pool.query(`UPDATE contests SET wager_settled = true WHERE code = $1`, [contestCode]);
      logAdminAction('wager.settle', contestCode, contestCode, { pool: pool_amount, rake: rakeAmount, winners });

      res.json({ ok: true, pool: pool_amount, rake: rakeAmount, winners });
    } catch (e) {
      console.error('wager/settle', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Jackpot stats
  adminRouter.get('/api/jackpot/stats', async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM daily_jackpot ORDER BY date DESC LIMIT 14`);
      res.json({ ok: true, days: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });

  // Settle daily jackpot for a specific date
  adminRouter.post('/api/jackpot/settle', async (req, res) => {
    const { date } = req.body || {};
    if (!date) return res.status(400).json({ error: 'missing_date' });
    try {
      const jp = await pool.query(`SELECT * FROM daily_jackpot WHERE date = $1`, [date]);
      if (!jp.rows.length) return res.json({ ok: false, reason: 'no_jackpot' });
      const j = jp.rows[0];
      if (j.settled) return res.json({ ok: false, reason: 'already_settled' });
      if ((j.pool | 0) <= 0) return res.json({ ok: false, reason: 'empty_pool' });

      const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%' OR key = 'jackpot_%'`);
      const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
      const rake = parseInt(cfg.wager_rake, 10) || 5;
      const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
      const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
      const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;
      const minPlayers = parseInt(cfg.jackpot_min_players, 10) || 5;

      // Get top 3 daily scores for that date
      const top = await pool.query(
        `SELECT device_id, name, score FROM daily_scores WHERE date = $1 ORDER BY score DESC LIMIT 3`, [date]);

      if (top.rows.length < minPlayers && j.entries < minPlayers) {
        return res.json({ ok: false, reason: 'not_enough_players', min: minPlayers, actual: j.entries });
      }

      const poolAmt = j.pool | 0;
      const rakeAmt = Math.round(poolAmt * rake / 100);
      const dist = poolAmt - rakeAmt;
      const prizes = [
        Math.round(dist * pct1 / (pct1 + pct2 + pct3)),
        Math.round(dist * pct2 / (pct1 + pct2 + pct3)),
        Math.round(dist * pct3 / (pct1 + pct2 + pct3))
      ];

      const winners = [];
      for (let i = 0; i < Math.min(3, top.rows.length); i++) {
        const prize = prizes[i] || 0;
        if (prize <= 0) continue;
        const p = top.rows[i];
        await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, p.device_id]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
          ['JP:' + date, p.device_id, prize, 'jackpot_win_' + (i + 1)]);
        winners.push({ name: p.name, score: p.score, prize, place: i + 1 });
      }
      if (rakeAmt > 0) {
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'jackpot_rake')`,
          ['JP:' + date, rakeAmt]);
      }
      await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [date]);
      logAdminAction('jackpot.settle', date, date, { pool: poolAmt, rake: rakeAmt, winners });
      res.json({ ok: true, pool: poolAmt, rake: rakeAmt, winners });
    } catch (e) {
      console.error('jackpot/settle', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Wager stats for admin dashboard
  adminRouter.get('/api/wager/stats', async (_req, res) => {
    try {
      const active = await pool.query(
        `SELECT c.code, c.name, c.wager_amount, c.wager_pool, c.wager_settled, c.ends_at,
                (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code) as players
         FROM contests c WHERE c.wager_amount > 0 ORDER BY c.created_at DESC LIMIT 50`);
      const totalRake = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM wager_settlements WHERE type = 'rake' OR type = 'jackpot_rake'`);
      const duels = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending') as pending, COUNT(*) FILTER (WHERE status = 'settled') as settled FROM duels`);
      res.json({ ok: true, contests: active.rows, totalRake: totalRake.rows[0].total | 0, duels: duels.rows[0] });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });
  // List all players with codes and balances
  adminRouter.get('/api/players', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT p.device_id, p.player_code, p.display_name, p.balance, p.total_earned, p.total_spent,
                p.referred_by, p.created_at, COALESCE(p.xp, 0) as xp, COALESCE(p.level, 1) as level,
                (SELECT COUNT(*) FROM referrals WHERE referrer_device = p.device_id) as referral_count
         FROM player_profiles p ORDER BY p.created_at DESC LIMIT 500`);
      res.json({ ok: true, players: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server', msg: e.message });
    }
  });

  // Update player balance (set exact amount or add/subtract)
  adminRouter.post('/api/players/balance', async (req, res) => {
    const { deviceId, playerCode, amount, mode } = req.body || {};
    // Find player by code or deviceId
    const identifier = playerCode || deviceId;
    if (!identifier || amount == null) return res.status(400).json({ error: 'missing_params' });
    try {
      const findCol = playerCode ? 'player_code' : 'device_id';
      const player = await pool.query(`SELECT device_id, player_code, balance FROM player_profiles WHERE ${findCol} = $1`, [identifier]);
      if (!player.rows.length) return res.status(404).json({ error: 'player_not_found' });
      const p = player.rows[0];
      const amt = parseInt(amount, 10) || 0;
      let newBalance;
      if (mode === 'set') {
        newBalance = Math.max(0, amt);
        await pool.query(`UPDATE player_profiles SET balance = $1 WHERE device_id = $2`, [newBalance, p.device_id]);
      } else if (mode === 'subtract') {
        newBalance = Math.max(0, p.balance - Math.abs(amt));
        await pool.query(`UPDATE player_profiles SET balance = $1, total_spent = total_spent + $2 WHERE device_id = $3`,
          [newBalance, Math.abs(amt), p.device_id]);
      } else {
        // default: add
        newBalance = p.balance + Math.abs(amt);
        await pool.query(`UPDATE player_profiles SET balance = $1, total_earned = total_earned + $2 WHERE device_id = $3`,
          [newBalance, Math.abs(amt), p.device_id]);
      }
      logAdminAction('player.balance', p.player_code, identifier, { mode: mode || 'add', amount: amt, newBalance });
      res.json({ ok: true, playerCode: p.player_code, newBalance });
    } catch (e) {
      res.status(500).json({ error: 'server', msg: e.message });
    }
  });

  // Get referral stats
  adminRouter.get('/api/referrals', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT r.*, 
                (SELECT display_name FROM player_profiles WHERE device_id = r.referrer_device) as referrer_name,
                (SELECT display_name FROM player_profiles WHERE device_id = r.referred_device) as referred_name
         FROM referrals r ORDER BY r.created_at DESC LIMIT 200`);
      res.json({ ok: true, referrals: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server', msg: e.message });
    }
  });

  // ---------- GAME CONFIG (moved after bots) ----------
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
// ============================================================
// PUBLIC PLAYER PROFILE — /player/BLOOM-XXXX
// ============================================================
app.get('/player/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 10);
  try {
    const p = await pool.query(
      `SELECT player_code, display_name, balance, total_earned, total_spent, COALESCE(xp, 0) as xp, COALESCE(level, 1) as level, created_at FROM player_profiles WHERE player_code = $1`, [code]);
    if (!p.rows.length) return res.status(404).send('<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>שחקן לא נמצא</h2><a href="/">שחק ב-BLOOM</a></body></html>');
    const player = p.rows[0];
    const lvl = calcLevel(player.xp);
    const gamesRow = await pool.query(`SELECT COUNT(*) as games, MAX(score) as best FROM daily_scores WHERE device_id = (SELECT device_id FROM player_profiles WHERE player_code = $1)`, [code]);
    const stats = gamesRow.rows[0] || { games: 0, best: 0 };
    const referrals = await pool.query(`SELECT COUNT(*) as count FROM referrals WHERE referrer_code = $1`, [code]);
    const joinDate = new Date(player.created_at).toLocaleDateString('he-IL');

    res.send(`<!DOCTYPE html><html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${player.display_name || code} — BLOOM</title>
<meta property="og:title" content="${player.display_name || code} ב-BLOOM">
<meta property="og:description" content="רמה ${lvl.level} ${lvl.title} · שיא ${(stats.best|0).toLocaleString()} נקודות">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F7F5F0;color:#1C1A18;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFF;border-radius:20px;padding:28px;max-width:360px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.06)}
.name{font-size:22px;font-weight:700;text-align:center}
.code{font-size:13px;color:#6F6E68;text-align:center;letter-spacing:0.1em;margin:4px 0 12px}
.level{text-align:center;font-size:14px;font-weight:600;color:#6C3483;margin-bottom:16px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.stat{background:#FAFAF6;border-radius:12px;padding:12px;text-align:center}
.stat-val{font-size:18px;font-weight:700}.stat-lbl{font-size:11px;color:#A8A6A0;margin-top:2px}
.joined{text-align:center;font-size:11px;color:#A8A6A0;margin-bottom:16px}
.cta{display:block;width:100%;padding:14px;background:#1C1A18;color:#FFF;border:none;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;text-align:center;font-family:inherit}
</style></head><body>
<div class="card">
<div class="name">${player.display_name || 'שחקן'}</div>
<div class="code">${player.player_code}</div>
<div class="level">${lvl.title} · רמה ${lvl.level}</div>
<div class="stats">
<div class="stat"><div class="stat-val">${(stats.best|0).toLocaleString()}</div><div class="stat-lbl">🏆 שיא</div></div>
<div class="stat"><div class="stat-val">${stats.games|0}</div><div class="stat-lbl">🎮 משחקים</div></div>
<div class="stat"><div class="stat-val">${player.balance|0}</div><div class="stat-lbl">💎 קרדיטים</div></div>
<div class="stat"><div class="stat-val">${referrals.rows[0].count|0}</div><div class="stat-lbl">🔗 הפניות</div></div>
</div>
<div class="joined">הצטרף ב-${joinDate}</div>
<a class="cta" href="/?ref=${code}">🌸 שחק גם ב-BLOOM</a>
</div></body></html>`);
  } catch (e) {
    console.error('profile', e.message);
    res.status(500).send('שגיאה');
  }
});

// ============================================================
// Player identity + referrals
// ============================================================

// GET /api/jackpot/today — current daily jackpot pool
app.get('/api/jackpot/today', async (_req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const cfgRow = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_enabled'`);
    if (cfgRow.rows.length && cfgRow.rows[0].value === 'false') return res.json({ ok: true, enabled: false });
    const r = await pool.query(`SELECT pool, entries FROM daily_jackpot WHERE date = $1`, [today]);
    const row = r.rows[0] || { pool: 0, entries: 0 };
    res.json({ ok: true, enabled: true, pool: row.pool | 0, entries: row.entries | 0, date: today });
  } catch (e) {
    res.json({ ok: true, enabled: false });
  }
});

// Generate a unique BLOOM-XXXX code
function generatePlayerCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 for clarity
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'BLOOM-' + code;
}

// GET /api/player/code — get or create player code
app.get('/api/player/code', async (req, res) => {
  const deviceId = req.headers['x-device-id'] || req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    // Check if player already has a code
    const existing = await pool.query(
      'SELECT player_code, balance, xp FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (existing.rows.length) {
      const p = existing.rows[0];
      const lvl = calcLevel(p.xp || 0);
      return res.json({ ok: true, code: p.player_code, balance: p.balance, xp: p.xp || 0, level: lvl });
    }
    // Generate unique code (retry if collision)
    const wcfg = await pool.query(`SELECT value FROM game_config WHERE key = 'welcome_bonus'`);
    const welcomeBonus = parseInt((wcfg.rows[0] || {}).value, 10) || 100;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generatePlayerCode();
      try {
        await pool.query(
          `INSERT INTO player_profiles (device_id, player_code, balance, total_earned) VALUES ($1, $2, $3, $3)`,
          [deviceId, code, welcomeBonus]);
        return res.json({ ok: true, code: code, balance: welcomeBonus, isNew: true });
      } catch (e) {
        if (e.code === '23505') continue; // unique violation, retry
        throw e;
      }
    }
    res.status(500).json({ error: 'code_generation_failed' });
  } catch (e) {
    console.error('player/code', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/referral — register a referral

// XP per action and level thresholds
const XP_MAP = {
  daily_complete: 50, daily_login: 15, streak_3: 30, streak_7: 80, streak_30: 300,
  contest_1st: 100, contest_2nd: 50, contest_3rd: 30
};
const LEVELS = [
  { level: 1,  xp: 0,      title: 'מתחיל' },
  { level: 2,  xp: 50,     title: 'מתחיל+' },
  { level: 3,  xp: 150,    title: 'טירון' },
  { level: 5,  xp: 500,    title: 'חובבן' },
  { level: 8,  xp: 1200,   title: 'שחקן' },
  { level: 10, xp: 2000,   title: 'שחקן+' },
  { level: 15, xp: 5000,   title: 'מקצוען' },
  { level: 20, xp: 10000,  title: 'מומחה' },
  { level: 30, xp: 25000,  title: 'אלוף' },
  { level: 50, xp: 50000,  title: 'אגדה' },
  { level: 100,xp: 150000, title: 'אלמוותי' },
];
function calcLevel(xp) {
  let lvl = LEVELS[0];
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xp) { lvl = LEVELS[i]; break; }
  }
  const next = LEVELS.find(l => l.xp > xp) || null;
  return { level: lvl.level, title: lvl.title, xp, nextXp: next ? next.xp : null, nextTitle: next ? next.title : null, progress: next ? Math.round((xp - lvl.xp) / (next.xp - lvl.xp) * 100) : 100 };
}

// POST /api/player/earn — award credits + XP for gameplay actions
app.post('/api/player/earn', async (req, res) => {
  const { deviceId, action, meta } = req.body || {};
  if (!deviceId || !action) return res.status(400).json({ error: 'missing_params' });
  try {
    const player = await pool.query('SELECT device_id, balance, xp FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });

    const actionMap = {
      'daily_login': 'daily_login_reward',
      'daily_complete': 'daily_reward',
      'streak_3': 'streak_3_reward',
      'streak_7': 'streak_7_reward',
      'streak_30': 'streak_30_reward',
      'contest_1st': 'contest_1st_reward',
      'contest_2nd': 'contest_2nd_reward',
      'contest_3rd': 'contest_3rd_reward'
    };
    const configKey = actionMap[action];
    if (!configKey) return res.json({ ok: false, reason: 'unknown_action' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const dedupKey = action + ':' + today + (meta ? ':' + JSON.stringify(meta) : '');
    if (action === 'daily_complete' || action === 'daily_login') {
      const dup = await pool.query(
        `SELECT 1 FROM game_config WHERE key = $1`, ['_earn:' + deviceId + ':' + dedupKey]);
      if (dup.rows.length) return res.json({ ok: false, reason: 'already_earned' });
    }

    const cfgRow = await pool.query('SELECT value FROM game_config WHERE key = $1', [configKey]);
    const reward = parseInt((cfgRow.rows[0] || {}).value, 10) || 0;
    if (reward <= 0) return res.json({ ok: false, reason: 'reward_disabled' });

    // Award credits + XP
    const xpGain = XP_MAP[action] || 10;
    const oldXp = (player.rows[0].xp || 0);
    const newXp = oldXp + xpGain;
    const oldLevel = calcLevel(oldXp);
    const newLevel = calcLevel(newXp);
    const leveledUp = newLevel.level > oldLevel.level;

    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, xp = COALESCE(xp, 0) + $2, level = $3 WHERE device_id = $4`,
      [reward, xpGain, newLevel.level, deviceId]);

    if (action === 'daily_complete' || action === 'daily_login') {
      await pool.query(
        `INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        ['_earn:' + deviceId + ':' + dedupKey, '1']).catch(() => {});
    }

    const newBal = player.rows[0].balance + reward;
    res.json({ ok: true, action, reward, xpGain, newBalance: newBal, level: newLevel, leveledUp });
  } catch (e) {
    console.error('player/earn', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/tile-prices — get current tile prices for in-game shop
app.get('/api/tile-prices', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'tile_%'`);
    const cfg = {};
    for (const row of r.rows) cfg[row.key] = row.value;
    if (cfg.tile_shop_enabled === 'false') return res.json({ ok: true, enabled: false });
    const mult = parseFloat(cfg.tile_price_multiplier) || 1.0;
    const prices = {};
    for (let t = 2; t <= 8; t++) {
      prices[t] = Math.round((parseInt(cfg['tile_price_' + t], 10) || (t * 10)) * mult);
    }
    res.json({ ok: true, enabled: true, prices, multiplier: mult });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-powerup — buy a delete power-up
app.post('/api/player/buy-powerup', async (req, res) => {
  const { deviceId, powerup, refundAmount } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'missing_params' });

  // Handle refund (cancel)
  if (powerup === 'refund' && refundAmount > 0) {
    try {
      await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_spent = total_spent - $1 WHERE device_id = $2`,
        [Math.min(refundAmount, 1000), deviceId]); // cap refund at 1000 for safety
      return res.json({ ok: true, refunded: refundAmount });
    } catch (e) { return res.status(500).json({ error: 'server' }); }
  }

  if (!powerup) return res.status(400).json({ error: 'missing_params' });
  const validPowerups = ['powerup_random_tile', 'powerup_choose_tile', 'powerup_random_row', 'powerup_choose_row'];
  if (!validPowerups.includes(powerup)) return res.json({ ok: false, reason: 'invalid_powerup' });
  try {
    const priceRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [powerup]);
    const cost = parseInt((priceRow.rows[0] || {}).value, 10) || 0;
    if (cost <= 0) return res.json({ ok: false, reason: 'powerup_disabled' });
    const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    if (player.rows[0].balance < cost) return res.json({ ok: false, reason: 'insufficient_balance' });
    const newBalance = player.rows[0].balance - cost;
    await pool.query(`UPDATE player_profiles SET balance = $1, total_spent = total_spent + $2 WHERE device_id = $3`,
      [newBalance, cost, deviceId]);
    res.json({ ok: true, powerup, cost, newBalance });
  } catch (e) {
    console.error('buy-powerup', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-tile — buy a specific tile during gameplay
app.post('/api/player/buy-tile', async (req, res) => {
  const { deviceId, tier } = req.body || {};
  if (!deviceId || !tier) return res.status(400).json({ error: 'missing_params' });
  try {
    const t = parseInt(tier, 10);
    if (t < 2 || t > 8) return res.json({ ok: false, reason: 'invalid_tier' });
    // Check tile shop enabled
    const enabledRow = await pool.query(`SELECT value FROM game_config WHERE key = 'tile_shop_enabled'`);
    if (enabledRow.rows.length && enabledRow.rows[0].value === 'false') return res.json({ ok: false, reason: 'shop_disabled' });
    // Get price
    const priceRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, ['tile_price_' + t]);
    const multRow = await pool.query(`SELECT value FROM game_config WHERE key = 'tile_price_multiplier'`);
    const basePrice = parseInt((priceRow.rows[0] || {}).value, 10) || (t * 10);
    const mult = parseFloat((multRow.rows[0] || {}).value) || 1.0;
    const cost = Math.round(basePrice * mult);
    // Check balance
    const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    if (player.rows[0].balance < cost) return res.json({ ok: false, reason: 'insufficient_balance' });
    // Deduct
    const newBalance = player.rows[0].balance - cost;
    await pool.query(`UPDATE player_profiles SET balance = $1, total_spent = total_spent + $2 WHERE device_id = $3`,
      [newBalance, cost, deviceId]);
    res.json({ ok: true, tier: t, cost, newBalance });
  } catch (e) {
    console.error('buy-tile', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-skin — purchase a skin with credits
app.post('/api/player/buy-skin', async (req, res) => {
  const { deviceId, skinId, price } = req.body || {};
  if (!deviceId || !skinId) return res.status(400).json({ error: 'missing_params' });
  try {
    const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    const balance = player.rows[0].balance;
    const cost = Math.max(0, parseInt(price, 10) || 0);
    if (balance < cost) return res.json({ ok: false, reason: 'insufficient_balance' });
    const newBalance = balance - cost;
    await pool.query(
      `UPDATE player_profiles SET balance = $1, total_spent = total_spent + $2 WHERE device_id = $3`,
      [newBalance, cost, deviceId]);
    res.json({ ok: true, skinId, newBalance });
  } catch (e) {
    console.error('buy-skin', e.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/referral', async (req, res) => {
  const { deviceId, refCode } = req.body || {};
  if (!deviceId || !refCode) return res.status(400).json({ error: 'missing_params' });
  try {
    // Check: can't refer yourself
    const self = await pool.query(
      'SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (self.rows.length && self.rows[0].player_code === refCode) {
      return res.json({ ok: false, reason: 'self_referral' });
    }
    // Check: already referred?
    const alreadyReferred = await pool.query(
      'SELECT id FROM referrals WHERE referred_device = $1', [deviceId]);
    if (alreadyReferred.rows.length) {
      return res.json({ ok: false, reason: 'already_referred' });
    }
    // Find referrer
    const referrer = await pool.query(
      'SELECT device_id FROM player_profiles WHERE player_code = $1', [refCode]);
    if (!referrer.rows.length) {
      return res.json({ ok: false, reason: 'invalid_code' });
    }
    const referrerDevice = referrer.rows[0].device_id;
    // Read reward amounts from game_config
    const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key IN ('referral_enabled','referral_reward','referred_bonus')`);
    const cfg = {};
    for (const r of cfgRows.rows) cfg[r.key] = r.value;
    if (cfg.referral_enabled === 'false') return res.json({ ok: false, reason: 'referrals_disabled' });
    const reward = parseInt(cfg.referral_reward, 10) || 50;
    const bonus = parseInt(cfg.referred_bonus, 10) || 25;
    // Record referral
    await pool.query(
      `INSERT INTO referrals (referrer_code, referrer_device, referred_device, credits_awarded)
       VALUES ($1, $2, $3, $4)`,
      [refCode, referrerDevice, deviceId, reward]);
    // Award credits to referrer
    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1
       WHERE device_id = $2`, [reward, referrerDevice]);
    // Award welcome bonus to referred player (if they have a profile)
    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1,
       referred_by = $2 WHERE device_id = $3`, [bonus, refCode, deviceId]);
    res.json({ ok: true, referrerReward: reward, referredReward: bonus });
  } catch (e) {
    console.error('referral', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// 1v1 DUELS
// ============================================================

// Create a duel challenge
app.post('/api/duels', async (req, res) => {
  const { deviceId, opponentCode, amount } = req.body || {};
  if (!deviceId || !opponentCode) return res.status(400).json({ error: 'missing_params' });
  try {
    const duelEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'duel_enabled'`);
    if (duelEnabled.rows.length && duelEnabled.rows[0].value === 'false') return res.json({ ok: false, reason: 'duels_disabled' });

    const challenger = await pool.query('SELECT player_code, display_name, balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!challenger.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    if (challenger.rows[0].player_code === opponentCode) return res.json({ ok: false, reason: 'self_duel' });

    const bet = Math.max(0, parseInt(amount, 10) || 0);
    if (bet > 0 && challenger.rows[0].balance < bet) return res.json({ ok: false, reason: 'insufficient_balance' });

    // Check opponent exists
    const opponent = await pool.query('SELECT device_id, display_name FROM player_profiles WHERE player_code = $1', [opponentCode]);
    if (!opponent.rows.length) return res.json({ ok: false, reason: 'opponent_not_found' });

    const timeoutH = await pool.query(`SELECT value FROM game_config WHERE key = 'duel_timeout_hours'`);
    const hours = parseInt((timeoutH.rows[0] || {}).value, 10) || 24;
    const seed = Math.floor(Math.random() * 2147483647);
    const expiresAt = new Date(Date.now() + hours * 3600000);

    // Deduct from challenger
    if (bet > 0) {
      await pool.query(`UPDATE player_profiles SET balance = balance - $1, total_spent = total_spent + $1 WHERE device_id = $2`, [bet, deviceId]);
    }

    const r = await pool.query(
      `INSERT INTO duels (challenger_device, challenger_name, challenger_code, opponent_code, opponent_device, opponent_name, amount, board_seed, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [deviceId, challenger.rows[0].display_name, challenger.rows[0].player_code, opponentCode, opponent.rows[0].device_id, opponent.rows[0].display_name, bet, seed, expiresAt]);

    res.json({ ok: true, duelId: r.rows[0].id, seed, amount: bet, expiresAt });
  } catch (e) {
    console.error('duels/create', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// Get my duels (pending, active, completed)
app.get('/api/duels/mine', async (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    const playerCode = await pool.query('SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    const code = playerCode.rows.length ? playerCode.rows[0].player_code : '';
    const r = await pool.query(
      `SELECT * FROM duels WHERE challenger_device = $1 OR opponent_device = $1 OR opponent_code = $2
       ORDER BY created_at DESC LIMIT 20`, [deviceId, code]);
    res.json({ ok: true, duels: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Accept a duel
app.post('/api/duels/:id/accept', async (req, res) => {
  const { deviceId } = req.body || {};
  const duelId = parseInt(req.params.id, 10);
  try {
    const d = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!d.rows.length) return res.json({ ok: false, reason: 'not_found' });
    const duel = d.rows[0];
    if (duel.status !== 'pending') return res.json({ ok: false, reason: 'not_pending' });
    if (new Date(duel.expires_at) < new Date()) return res.json({ ok: false, reason: 'expired' });

    // Verify this is the opponent
    const player = await pool.query('SELECT player_code, balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length || player.rows[0].player_code !== duel.opponent_code) return res.json({ ok: false, reason: 'not_opponent' });

    const bet = duel.amount | 0;
    if (bet > 0 && player.rows[0].balance < bet) return res.json({ ok: false, reason: 'insufficient_balance' });

    if (bet > 0) {
      await pool.query(`UPDATE player_profiles SET balance = balance - $1, total_spent = total_spent + $1 WHERE device_id = $2`, [bet, deviceId]);
    }
    await pool.query(`UPDATE duels SET status = 'accepted', opponent_device = $1 WHERE id = $2`, [deviceId, duelId]);
    res.json({ ok: true, duel: { ...duel, status: 'accepted' } });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Submit duel score
app.post('/api/duels/:id/score', async (req, res) => {
  const { deviceId, score } = req.body || {};
  const duelId = parseInt(req.params.id, 10);
  try {
    const d = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!d.rows.length) return res.json({ ok: false, reason: 'not_found' });
    const duel = d.rows[0];
    if (duel.status !== 'accepted') return res.json({ ok: false, reason: 'not_accepted' });

    const s = Math.max(0, parseInt(score, 10) || 0);
    const isChallenger = duel.challenger_device === deviceId;
    const isOpponent = duel.opponent_device === deviceId;
    if (!isChallenger && !isOpponent) return res.json({ ok: false, reason: 'not_participant' });

    if (isChallenger) await pool.query(`UPDATE duels SET challenger_score = $1 WHERE id = $2`, [s, duelId]);
    else await pool.query(`UPDATE duels SET opponent_score = $1 WHERE id = $2`, [s, duelId]);

    // Check if both scored → settle
    const updated = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    const u = updated.rows[0];
    if (u.challenger_score != null && u.opponent_score != null) {
      // Settle!
      const rake = 5; // use config if needed
      const totalPool = (u.amount | 0) * 2;
      const rakeAmt = Math.round(totalPool * rake / 100);
      const prize = totalPool - rakeAmt;
      let winner = null;
      if (u.challenger_score > u.opponent_score) winner = u.challenger_device;
      else if (u.opponent_score > u.challenger_score) winner = u.opponent_device;
      // Tie → refund both
      if (!winner) {
        if ((u.amount | 0) > 0) {
          await pool.query(`UPDATE player_profiles SET balance = balance + $1 WHERE device_id = $2`, [u.amount, u.challenger_device]);
          await pool.query(`UPDATE player_profiles SET balance = balance + $1 WHERE device_id = $2`, [u.amount, u.opponent_device]);
        }
        await pool.query(`UPDATE duels SET status = 'tie', winner_device = NULL WHERE id = $1`, [duelId]);
        return res.json({ ok: true, result: 'tie', refunded: true });
      }
      if (prize > 0) {
        await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, winner]);
      }
      await pool.query(`UPDATE duels SET status = 'settled', winner_device = $1 WHERE id = $2`, [winner, duelId]);
      res.json({ ok: true, result: 'settled', winner: winner === deviceId ? 'you' : 'opponent', prize });
    } else {
      res.json({ ok: true, result: 'waiting', yourScore: s });
    }
  } catch (e) {
    console.error('duels/score', e.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/heartbeat', async (req, res) => {
  try {
    const { deviceId, displayName, mode, score, highestTier, grid } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device' });
    const gridJson = Array.isArray(grid) ? JSON.stringify(grid) : null;
    const did = String(deviceId).slice(0, 64);
    const name = String(displayName || '').slice(0, 100) || 'אנונימי';
    const m = String(mode || 'daily').slice(0, 20);
    const s = Math.max(0, parseInt(score, 10) || 0);
    const t = Math.max(1, parseInt(highestTier, 10) || 1);
    try {
      // Try with grid_json first
      await pool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, grid_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, player_heartbeat.display_name),
             mode = EXCLUDED.mode, score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier,
             grid_json = COALESCE(EXCLUDED.grid_json, player_heartbeat.grid_json), updated_at = NOW()`,
        [did, name, m, s, t, gridJson]
      );
    } catch (colErr) {
      // Fallback: grid_json column might not exist yet
      await pool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, player_heartbeat.display_name),
             mode = EXCLUDED.mode, score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier, updated_at = NOW()`,
        [did, name, m, s, t]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('heartbeat', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// Universal spectator endpoint — watch ANY player regardless of mode
app.get('/api/live-state/:deviceId', async (req, res) => {
  try {
    const did = String(req.params.deviceId || '').slice(0, 64);
    // Try with grid_json first, fallback without it
    let r;
    try {
      r = await pool.query(
        `SELECT display_name, mode, score, highest_tier, grid_json, updated_at
         FROM player_heartbeat WHERE device_id = $1 AND updated_at > NOW() - INTERVAL '60 seconds'`, [did]);
    } catch (e) {
      r = await pool.query(
        `SELECT display_name, mode, score, highest_tier, updated_at
         FROM player_heartbeat WHERE device_id = $1 AND updated_at > NOW() - INTERVAL '60 seconds'`, [did]);
    }
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    const row = r.rows[0];
    let grid = null;
    if (row.grid_json) { try { grid = JSON.parse(row.grid_json); } catch (e) {} }
    res.json({
      ok: true,
      name: row.display_name,
      mode: row.mode,
      score: row.score | 0,
      tier: row.highest_tier | 0,
      grid: grid,
      updatedAt: row.updated_at
    });
  } catch (e) {
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
    // JACKPOT AUTO-SETTLE (runs every hour, settles yesterday's jackpot)
    // ============================================================
    async function autoSettleJackpot() {
      try {
        const autoEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_auto_settle'`);
        if (autoEnabled.rows.length && autoEnabled.rows[0].value === 'false') return;

        // Find unsettled jackpots from previous days
        const unsettled = await pool.query(
          `SELECT date, pool, entries FROM daily_jackpot WHERE settled = false AND date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date ORDER BY date`);
        
        for (const j of unsettled.rows) {
          if ((j.pool | 0) <= 0) continue;
          const jpDate = j.date instanceof Date ? j.date.toISOString().slice(0, 10) : String(j.date);
          
          // Get config
          const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%' OR key LIKE 'jackpot_%'`);
          const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
          const rake = parseInt(cfg.wager_rake, 10) || 5;
          const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
          const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
          const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;
          const minPlayers = parseInt(cfg.jackpot_min_players, 10) || 5;

          if ((j.entries | 0) < minPlayers) {
            // Not enough players — refund everyone
            const refunds = await pool.query(
              `SELECT device_id, ABS(amount) as amt FROM wager_settlements WHERE contest_code = $1 AND type = 'jackpot_entry'`, ['JP:' + jpDate]);
            for (const rf of refunds.rows) {
              await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_spent = total_spent - $1 WHERE device_id = $2`, [rf.amt, rf.device_id]);
            }
            await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [jpDate]);
            console.log(`[jackpot] ${jpDate}: refunded ${refunds.rows.length} players (below min ${minPlayers})`);
            continue;
          }

          // Get top 3
          const top = await pool.query(
            `SELECT device_id, name, score FROM daily_scores WHERE date = $1 ORDER BY score DESC LIMIT 3`, [jpDate]);
          
          const poolAmt = j.pool | 0;
          const rakeAmt = Math.round(poolAmt * rake / 100);
          const dist = poolAmt - rakeAmt;
          const prizes = [
            Math.round(dist * pct1 / (pct1 + pct2 + pct3)),
            Math.round(dist * pct2 / (pct1 + pct2 + pct3)),
            Math.round(dist * pct3 / (pct1 + pct2 + pct3))
          ];

          for (let i = 0; i < Math.min(3, top.rows.length); i++) {
            const prize = prizes[i] || 0;
            if (prize <= 0) continue;
            await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, top.rows[i].device_id]);
            await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
              ['JP:' + jpDate, top.rows[i].device_id, prize, 'jackpot_win_' + (i + 1)]);
          }
          if (rakeAmt > 0) {
            await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'jackpot_rake')`,
              ['JP:' + jpDate, rakeAmt]);
          }
          await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [jpDate]);
          console.log(`[jackpot] ${jpDate}: settled ${poolAmt}💎 → ${top.rows.length} winners, ${rakeAmt} rake`);
        }
      } catch (e) {
        console.warn('[jackpot] auto-settle failed:', e.message);
      }
    }
    // Run every hour + once on startup (after 30 seconds delay)
    setTimeout(autoSettleJackpot, 30000);
    setInterval(autoSettleJackpot, 60 * 60 * 1000);

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
