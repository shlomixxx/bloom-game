import express from 'express';
import { pool, initDb } from './db.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(express.static('public', { maxAge: '5m', extensions: ['html'] }));

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function cleanName(n) {
  const s = String(n || '').trim().slice(0, 24);
  return s || 'אנונימי';
}

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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
initDb()
  .catch((e) => console.error('[db] init failed:', e))
  .finally(() => {
    app.listen(port, () => console.log(`[bloom] listening on ${port}`));
  });
