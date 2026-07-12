// routes/pet.js — Pet/Mascot feature, extracted verbatim from server.js
// (SR.3 route-group decomposition — first cohesive route group pulled out).
// registerPetRoutes(app, deps) is called from server.js AFTER all deps exist.
// All 4 pet helpers (_loadPetConfig/_petComputeMood/_petComputeStage/_petLevelFromXp)
// are pet-only and moved here. Deps injected below.
export function registerPetRoutes(app, deps) {
  const { pool, requireDeviceAuth, checkRateLimit, ensurePlayerProfile, getCachedConfigPrefix } = deps;

async function _loadPetConfig() {
  // T6.3 — hits the global config cache (was per-feature LIKE scan).
  try { return await getCachedConfigPrefix('pet_'); }
  catch (e) { return {}; }
}

function _petComputeMood(lastVisitedAt) {
  // 4 mood states based on hours since last visit.
  if (!lastVisitedAt) return 'happy';
  const hoursAgo = (Date.now() - new Date(lastVisitedAt).getTime()) / (60 * 60 * 1000);
  if (hoursAgo < 24)  return 'happy';   // 😊
  if (hoursAgo < 48)  return 'neutral'; // 😐
  if (hoursAgo < 72)  return 'sad';     // 😢
  return 'crying';                       // 😭
}

function _petComputeStage(level) {
  // 4 evolution stages.
  if (level >= 16) return { id: 'king',    emoji: '🌺', label: 'מלך פריחה' };
  if (level >= 11) return { id: 'bloom',   emoji: '🌸', label: 'פריחה מלאה' };
  if (level >= 6)  return { id: 'sapling', emoji: '🌿', label: 'שתיל' };
  return { id: 'sprout', emoji: '🌱', label: 'נבט' };
}

function _petLevelFromXp(xp, xpPerLevel, maxLevel) {
  const lvl = Math.min(maxLevel, Math.max(1, Math.floor(xp / xpPerLevel) + 1));
  return lvl;
}

app.get('/api/pet/state', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: true, enabled: false });
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, needsDevice: true });
    // Lazy-create the pet row on first call.
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const r = await pool.query(
      `SELECT pet_name, level, xp, last_visited_at, last_fed_at, last_petted_at, last_petted_date,
              feeds_today, feeds_today_date, total_fed_count, total_pet_count
         FROM player_pet WHERE device_id = $1`,
      [deviceId]
    );
    const row = r.rows[0] || {};
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    const feedsPerDay = parseInt(cfg.pet_feeds_per_day_max || '3', 10) || 3;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const feedsToday = (row.feeds_today_date && row.feeds_today_date.toISOString().slice(0, 10) === today)
      ? (row.feeds_today | 0) : 0;
    const pettedToday = row.last_petted_date && row.last_petted_date.toISOString().slice(0, 10) === today;
    const xp = row.xp | 0;
    const level = _petLevelFromXp(xp, xpPerLevel, maxLevel);
    const stage = _petComputeStage(level);
    const mood = _petComputeMood(row.last_visited_at);
    const xpIntoLevel = xp - (level - 1) * xpPerLevel;
    const xpToNext = level < maxLevel ? xpPerLevel - xpIntoLevel : 0;
    res.json({
      ok: true,
      enabled: true,
      name: row.pet_name || null,
      needsName: !row.pet_name,
      level,
      xp,
      xpPerLevel,
      xpIntoLevel,
      xpToNext,
      maxLevel,
      stage,
      mood,
      lastVisitedAt: row.last_visited_at,
      pettedToday,
      feedsToday,
      feedsPerDay,
      canPet: !pettedToday,
      canFeed: feedsToday < feedsPerDay,
      feedPrice: parseInt(cfg.pet_feed_price_gems || '10', 10) || 10,
      feedXpReward: parseInt(cfg.pet_feed_xp_reward || '50', 10) || 50,
      dailyPetReward: parseInt(cfg.pet_daily_pet_reward_gems || '20', 10) || 20,
      totalFedCount: row.total_fed_count | 0,
      totalPetCount: row.total_pet_count | 0
    });
  } catch (e) {
    console.error('GET /api/pet/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/name', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, name } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const cleanName = String(name || '').trim().slice(0, 40);
    if (cleanName.length < 1) return res.json({ ok: false, reason: 'name_too_short' });
    if (!checkRateLimit('pet_name', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO player_pet (device_id, pet_name) VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET pet_name = $2, updated_at = NOW()`,
      [deviceId, cleanName]
    );
    // Task #17 — cross-system link: naming your pet unlocks the "Gardener"
    // achievement, which feeds the achievement leaderboard. Turns isolated
    // pet dopamine into the ecosystem ("now I'm #N globally"). Non-fatal —
    // naming still succeeds even if the achievement insert fails.
    let gardenerUnlocked = false, achRank = null;
    try {
      const ins = await pool.query(
        `INSERT INTO player_achievements (device_id, achievement_key)
         VALUES ($1, 'cross:gardener')
         ON CONFLICT (device_id, achievement_key) DO NOTHING
         RETURNING achievement_key`,
        [deviceId]
      );
      gardenerUnlocked = ins.rows.length > 0;
      if (gardenerUnlocked) {
        const cr = await pool.query(`SELECT COUNT(*)::int AS c FROM player_achievements WHERE device_id = $1`, [deviceId]);
        const achCount = (cr.rows[0] && cr.rows[0].c) | 0;
        if (achCount > 0) {
          const rr = await pool.query(
            `SELECT COUNT(*) + 1 AS rank FROM (
               SELECT device_id FROM player_achievements GROUP BY device_id HAVING COUNT(*) > $1
             ) s`,
            [achCount]
          );
          achRank = parseInt(rr.rows[0].rank, 10) || null;
        }
      }
    } catch (e) { /* non-fatal */ }
    res.json({ ok: true, name: cleanName, gardenerUnlocked, achRank });
  } catch (e) {
    console.error('POST /api/pet/name', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/pet', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_pet', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const reward = parseInt(cfg.pet_daily_pet_reward_gems || '20', 10) || 20;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Lazy-create rows. The profile must exist (with a valid player_code)
    // before we credit it inside the transaction below.
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    await ensurePlayerProfile(deviceId);
    // Check + update + grant in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const checkR = await client.query(
        `SELECT last_petted_date FROM player_pet WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const lastDate = checkR.rows[0] && checkR.rows[0].last_petted_date
        ? checkR.rows[0].last_petted_date.toISOString().slice(0, 10) : null;
      if (lastDate === today) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_petted_today' });
      }
      await client.query(
        `UPDATE player_pet
            SET last_petted_at = NOW(),
                last_petted_date = $1::date,
                last_visited_at = NOW(),
                total_pet_count = total_pet_count + 1,
                updated_at = NOW()
          WHERE device_id = $2`,
        [today, deviceId]
      );
      const credit = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      const newBalance = credit.rows[0] ? Number(credit.rows[0].balance) : null;
      res.json({ ok: true, reward, newBalance });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/pet/pet', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/feed', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_feed', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const price = parseInt(cfg.pet_feed_price_gems || '10', 10) || 10;
    const xpReward = parseInt(cfg.pet_feed_xp_reward || '50', 10) || 50;
    const feedsPerDay = parseInt(cfg.pet_feeds_per_day_max || '3', 10) || 3;
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Check today's feed count.
      const checkR = await client.query(
        `SELECT feeds_today, feeds_today_date, xp FROM player_pet WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const row = checkR.rows[0] || {};
      const lastDate = row.feeds_today_date ? row.feeds_today_date.toISOString().slice(0, 10) : null;
      const feedsToday = (lastDate === today) ? (row.feeds_today | 0) : 0;
      if (feedsToday >= feedsPerDay) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'daily_limit_reached', feedsToday, feedsPerDay });
      }
      // Atomic balance deduct.
      const debit = await client.query(
        `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [price, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price, balance: bal });
      }
      const newXp = (row.xp | 0) + xpReward;
      const newLevel = _petLevelFromXp(newXp, xpPerLevel, maxLevel);
      const newStage = _petComputeStage(newLevel);
      const oldLevel = _petLevelFromXp(row.xp | 0, xpPerLevel, maxLevel);
      const leveledUp = newLevel > oldLevel;
      await client.query(
        `UPDATE player_pet
            SET xp = $1,
                level = $2,
                feeds_today = $3,
                feeds_today_date = $4::date,
                last_fed_at = NOW(),
                last_visited_at = NOW(),
                total_fed_count = total_fed_count + 1,
                updated_at = NOW()
          WHERE device_id = $5`,
        [newXp, newLevel, feedsToday + 1, today, deviceId]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        newXp,
        newLevel,
        leveledUp,
        stage: newStage,
        newBalance: Number(debit.rows[0].balance),
        feedsToday: feedsToday + 1,
        feedsPerDay
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/pet/feed', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/grant-xp', requireDeviceAuth, async (req, res) => {
  // Granted from the client after each finished game. Rate-limited generously.
  try {
    const { deviceId, gameId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_grant_xp', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const xpPerGame = parseInt(cfg.pet_xp_per_game || '15', 10) || 15;
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    // Per-gameId dedup so the same game doesn't grant twice.
    if (gameId) {
      const dedupKey = '_pet_xp:' + deviceId + ':' + String(gameId).slice(0, 32);
      const dup = await pool.query(`SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]);
      if (dup.rows.length) return res.json({ ok: false, reason: 'already_granted' });
      await pool.query(
        `INSERT INTO game_config (key, value) VALUES ($1, NOW()::text) ON CONFLICT DO NOTHING`,
        [dedupKey]
      );
    }
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const cur = await pool.query(`SELECT xp FROM player_pet WHERE device_id = $1`, [deviceId]);
    const curXp = cur.rows[0] ? (cur.rows[0].xp | 0) : 0;
    const newXp = curXp + xpPerGame;
    const oldLevel = _petLevelFromXp(curXp, xpPerLevel, maxLevel);
    const newLevel = _petLevelFromXp(newXp, xpPerLevel, maxLevel);
    const leveledUp = newLevel > oldLevel;
    await pool.query(
      `UPDATE player_pet SET xp = $1, level = $2, updated_at = NOW() WHERE device_id = $3`,
      [newXp, newLevel, deviceId]
    );
    res.json({ ok: true, newXp, newLevel, leveledUp, xpGained: xpPerGame });
  } catch (e) {
    console.error('POST /api/pet/grant-xp', e);
    res.status(500).json({ error: 'internal' });
  }
});
}
