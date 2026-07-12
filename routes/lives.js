// routes/lives.js — extracted verbatim from server.js (SR.3 route-group decomposition).
// registerLivesRoutes(app, deps) is called from server.js after all deps exist.
export function registerLivesRoutes(app, deps) {
  const { pool, requireDeviceAuth, checkRateLimit, getCachedConfigPrefix } = deps;

async function _loadLivesConfig() {
  // T6.3 — was a per-feature LIKE scan; now hits the global config
  // cache via getCachedConfigPrefix(). Saves a DB round-trip per call.
  try { return await getCachedConfigPrefix('lives_'); }
  catch (e) { return {}; }
}

async function _computeLivesNow(deviceId, cfg) {
  // Reads state, applies time-based regen, returns the live values.
  // Caller may write back via _saveLives if it consumed any.
  await pool.query(
    `INSERT INTO player_lives_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [deviceId]
  );
  const r = await pool.query(
    `SELECT current_lives, max_lives, last_regen_at, total_lives_spent, total_ads_watched, total_gems_spent
       FROM player_lives_state WHERE device_id = $1`,
    [deviceId]
  );
  const row = r.rows[0] || { current_lives: 5, max_lives: 5, last_regen_at: new Date() };
  const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
  const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
  let curLives = Math.min(maxLives, Number(row.current_lives) || 0);
  let lastRegen = row.last_regen_at ? new Date(row.last_regen_at) : new Date();
  // Compute how many regen ticks elapsed.
  if (curLives < maxLives) {
    const minutesElapsed = (Date.now() - lastRegen.getTime()) / (60 * 1000);
    const regens = Math.floor(minutesElapsed / regenMin);
    if (regens > 0) {
      const added = Math.min(regens, maxLives - curLives);
      curLives = Math.min(maxLives, curLives + added);
      // Advance lastRegen by the consumed ticks.
      lastRegen = new Date(lastRegen.getTime() + regens * regenMin * 60 * 1000);
      // Persist updated state immediately (idempotent).
      await pool.query(
        `UPDATE player_lives_state
            SET current_lives = $1, max_lives = $2, last_regen_at = $3, updated_at = NOW()
          WHERE device_id = $4`,
        [curLives, maxLives, lastRegen, deviceId]
      );
    }
  } else {
    // Already at max — bump lastRegen forward so next consume starts fresh.
    if (lastRegen.getTime() < Date.now() - regenMin * 60 * 1000) {
      lastRegen = new Date();
      await pool.query(
        `UPDATE player_lives_state SET last_regen_at = NOW(), updated_at = NOW() WHERE device_id = $1`,
        [deviceId]
      );
    }
  }
  // Time until next regen (when not full).
  let msUntilNext = 0;
  if (curLives < maxLives) {
    const nextRegenAt = lastRegen.getTime() + regenMin * 60 * 1000;
    msUntilNext = Math.max(0, nextRegenAt - Date.now());
  }
  return {
    currentLives: curLives,
    maxLives,
    regenMinutes: regenMin,
    msUntilNextRegen: msUntilNext,
    totalLivesSpent: row.total_lives_spent || 0,
    totalAdsWatched: row.total_ads_watched || 0,
    totalGemsSpent: row.total_gems_spent || 0
  };
}

app.get('/api/player/lives/state', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: true, enabled: false });
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, currentLives: 0, maxLives: parseInt(cfg.lives_max || '5', 10) });
    const state = await _computeLivesNow(deviceId, cfg);
    res.json({
      ok: true,
      enabled: true,
      ...state,
      refillPriceGems: parseInt(cfg.lives_refill_price_gems || '50', 10) || 50,
      adRefillCount: parseInt(cfg.lives_ad_refill_count || '1', 10) || 1,
      perGame: parseInt(cfg.lives_per_game_dynamic || '1', 10) || 1
    });
  } catch (e) {
    console.error('GET /api/player/lives/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/consume', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, count } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_consume', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: true, enabled: false, currentLives: 999 });
    const n = Math.max(1, Math.min(10, parseInt(count || '1', 10) || 1));
    // Apply regen first.
    const beforeState = await _computeLivesNow(deviceId, cfg);
    if (beforeState.currentLives < n) {
      return res.json({ ok: false, reason: 'insufficient_lives', currentLives: beforeState.currentLives, needed: n, msUntilNextRegen: beforeState.msUntilNextRegen });
    }
    // Atomic decrement — guarded by current_lives >= n.
    const r = await pool.query(
      `UPDATE player_lives_state
          SET current_lives = current_lives - $1,
              total_lives_spent = total_lives_spent + $1,
              updated_at = NOW(),
              last_regen_at = CASE WHEN current_lives = max_lives THEN NOW() ELSE last_regen_at END
        WHERE device_id = $2 AND current_lives >= $1
        RETURNING current_lives, last_regen_at, max_lives`,
      [n, deviceId]
    );
    if (!r.rows[0]) {
      return res.json({ ok: false, reason: 'insufficient_lives', currentLives: beforeState.currentLives });
    }
    const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
    const newLast = new Date(r.rows[0].last_regen_at);
    const msUntilNext = r.rows[0].current_lives < r.rows[0].max_lives
      ? Math.max(0, newLast.getTime() + regenMin * 60 * 1000 - Date.now())
      : 0;
    res.json({
      ok: true,
      enabled: true,
      currentLives: r.rows[0].current_lives,
      maxLives: r.rows[0].max_lives,
      msUntilNextRegen: msUntilNext
    });
  } catch (e) {
    console.error('POST /api/player/lives/consume', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/refill-gems', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_refill_gems', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: false, reason: 'disabled' });
    const price = parseInt(cfg.lives_refill_price_gems || '50', 10) || 50;
    const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
    // Already at max?
    const state = await _computeLivesNow(deviceId, cfg);
    if (state.currentLives >= maxLives) return res.json({ ok: false, reason: 'already_full' });
    // Atomic transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
      await client.query(
        `UPDATE player_lives_state
            SET current_lives = max_lives,
                total_gems_spent = total_gems_spent + $1,
                last_regen_at = NOW(),
                updated_at = NOW()
          WHERE device_id = $2`,
        [price, deviceId]
      );
      await client.query('COMMIT');
      return res.json({
        ok: true,
        currentLives: maxLives,
        maxLives,
        msUntilNextRegen: 0,
        newBalance: Number(debit.rows[0].balance)
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/player/lives/refill-gems', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/refill-ad', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, gameId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_refill_ad', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: false, reason: 'disabled' });
    const adCount = parseInt(cfg.lives_ad_refill_count || '1', 10) || 1;
    const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
    // Per-game dedup so the same ad can't be claimed multiple times.
    const dedupKey = '_lives_ad:' + deviceId + ':' + (gameId || Date.now()).toString().slice(0, 32);
    const dedupCheck = await pool.query(
      `SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]
    );
    if (dedupCheck.rows.length) return res.json({ ok: false, reason: 'already_claimed' });
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, NOW()::text) ON CONFLICT DO NOTHING`,
      [dedupKey]
    );
    const r = await pool.query(
      `UPDATE player_lives_state
          SET current_lives = LEAST(max_lives, current_lives + $1),
              total_ads_watched = total_ads_watched + 1,
              updated_at = NOW()
        WHERE device_id = $2
        RETURNING current_lives, max_lives, last_regen_at`,
      [adCount, deviceId]
    );
    if (!r.rows[0]) return res.json({ ok: false, reason: 'no_state' });
    const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
    const newLast = new Date(r.rows[0].last_regen_at);
    const msUntilNext = r.rows[0].current_lives < r.rows[0].max_lives
      ? Math.max(0, newLast.getTime() + regenMin * 60 * 1000 - Date.now())
      : 0;
    res.json({
      ok: true,
      currentLives: r.rows[0].current_lives,
      maxLives: r.rows[0].max_lives,
      msUntilNextRegen: msUntilNext,
      refilled: adCount
    });
  } catch (e) {
    console.error('POST /api/player/lives/refill-ad', e);
    res.status(500).json({ error: 'internal' });
  }
});
}
