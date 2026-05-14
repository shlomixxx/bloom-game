import express from 'express';
import { pool, initDb } from './db.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(express.static('public', { maxAge: '5m', extensions: ['html'] }));

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
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateContestCode();
    const result = await pool.query('SELECT code FROM contests WHERE code = $1', [code]);
    if (result.rows.length === 0) return code;
  }
  throw new Error('Could not generate unique code after 10 attempts');
}

function shiftDateBack(iso, daysBack) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// DAILY CHALLENGE ENDPOINTS (קיימים — לא נגענו)
// ============================================================

app.post('/api/score', async (req, res) => {
  try {
    const { date, deviceId, name, score, tier } = req.body || {};
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
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

    const scoresResult = await pool.query(
      `SELECT device_id, display_name, score, highest_tier, games_played, last_played_at
       FROM contest_scores
       WHERE contest_code = $1
       ORDER BY score DESC, last_played_at ASC`,
      [code]
    );

    const players = scoresResult.rows.map((r) => ({
      name: r.display_name,
      score: r.score,
      tier: r.highest_tier,
      games: r.games_played,
      last: r.last_played_at,
      you: !!(deviceId && r.device_id === deviceId)
    }));

    res.json({
      ok: true,
      contest: contestResult.rows[0],
      players
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
    const cleanedName = cleanDisplayName(displayName);

    const contestResult = await pool.query('SELECT * FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
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

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         score = GREATEST(contest_scores.score, EXCLUDED.score),
         highest_tier = GREATEST(contest_scores.highest_tier, EXCLUDED.highest_tier),
         games_played = contest_scores.games_played + 1,
         last_played_at = NOW()`,
      [code, deviceId, cleanedName, Math.floor(score), Math.floor(tier)]
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
    app.listen(port, () => console.log(`[bloom] listening on ${port}`));
  });
