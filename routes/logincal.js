// routes/logincal.js — extracted verbatim from server.js (SR.3 route-group decomposition).
// registerLoginCalRoutes(app, deps) is called from server.js after all deps exist.
export function registerLoginCalRoutes(app, deps) {
  const { pool, requireDeviceAuth, checkRateLimit, getCachedConfigPrefix } = deps;

async function _loadLoginCalConfig() {
  try { return await getCachedConfigPrefix('login_cal_'); }
  catch (e) { return {}; }
}
function _loginCalRewardForDay(cfg, day) {
  return parseInt(cfg['login_cal_day_' + day + '_reward'], 10) || 0;
}
function _todayIL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}
function _diffDays(yyyymmddA, yyyymmddB) {
  if (!yyyymmddA || !yyyymmddB) return Infinity;
  const a = new Date(yyyymmddA + 'T00:00:00Z').getTime();
  const b = new Date(yyyymmddB + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

app.get('/api/login-cal/state', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadLoginCalConfig();
    if (cfg.login_cal_enabled === 'false') return res.json({ ok: true, enabled: false });
    const today = _todayIL();
    const r = await pool.query(
      `SELECT login_cal_day, login_cal_last_claim FROM player_profiles WHERE device_id = $1`,
      [deviceId]
    );
    let lastClaimDay = (r.rows[0] && r.rows[0].login_cal_day) | 0;
    let lastClaimDate = r.rows[0] && r.rows[0].login_cal_last_claim;
    // Normalize last_claim to YYYY-MM-DD string (Postgres returns Date obj).
    if (lastClaimDate instanceof Date) {
      lastClaimDate = lastClaimDate.toISOString().slice(0, 10);
    }
    const diff = lastClaimDate ? _diffDays(lastClaimDate, today) : null;
    let claimedToday = false;
    let nextDay; // the day the player can claim next
    let willReset = false;
    if (diff === 0) {
      // Already claimed today — show last_claim_day as current.
      claimedToday = true;
      nextDay = lastClaimDay;
    } else if (diff === 1) {
      // Yesterday → advance (wrap 7→1).
      nextDay = (lastClaimDay % 7) + 1;
    } else if (diff === null) {
      // Never claimed → day 1.
      nextDay = 1;
    } else {
      // Missed days → reset to 1.
      nextDay = 1;
      willReset = (lastClaimDay > 0);
    }
    // Build the 7-card list with each day's reward.
    const cards = [];
    for (let d = 1; d <= 7; d++) {
      const reward = _loginCalRewardForDay(cfg, d);
      let status;
      if (d < nextDay && claimedToday) status = 'claimed';
      else if (d === nextDay && claimedToday) status = 'claimed';
      else if (d === nextDay && !claimedToday) status = 'today';
      else if (d < nextDay) status = 'claimed';
      else status = 'upcoming';
      cards.push({ day: d, reward, status });
    }
    res.json({
      ok: true,
      enabled: true,
      currentDay: nextDay,
      claimedToday,
      willResetOnNextClaim: willReset,
      cards,
      lastClaimDate: lastClaimDate || null
    });
  } catch (e) {
    console.error('GET /api/login-cal/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/login-cal/claim', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  if (!checkRateLimit('login_cal_claim', deviceId, 20, 60 * 60 * 1000)) {
    return res.json({ ok: false, reason: 'rate_limited' });
  }
  try {
    const cfg = await _loadLoginCalConfig();
    if (cfg.login_cal_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const today = _todayIL();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the player row so concurrent claims can't double-pay.
      const sR = await client.query(
        `SELECT login_cal_day, login_cal_last_claim FROM player_profiles WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (!sR.rows.length) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'no_profile' });
      }
      const lastDay = (sR.rows[0].login_cal_day) | 0;
      let lastDate = sR.rows[0].login_cal_last_claim;
      if (lastDate instanceof Date) lastDate = lastDate.toISOString().slice(0, 10);
      const diff = lastDate ? _diffDays(lastDate, today) : null;
      if (diff === 0) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_claimed_today' });
      }
      let newDay;
      let wasReset = false;
      if (diff === 1) newDay = (lastDay % 7) + 1;
      else if (diff === null) newDay = 1;
      else { newDay = 1; wasReset = (lastDay > 0); }
      const reward = _loginCalRewardForDay(cfg, newDay);
      if (reward <= 0) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'reward_disabled' });
      }
      await client.query(
        `UPDATE player_profiles
            SET login_cal_day = $1,
                login_cal_last_claim = $2,
                balance = balance + $3,
                total_earned = total_earned + $3
          WHERE device_id = $4`,
        [newDay, today, reward, deviceId]
      );
      const bal = await client.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
      await client.query('COMMIT');
      res.json({
        ok: true,
        day: newDay,
        reward,
        wasReset,
        newBalance: bal.rows[0] ? (bal.rows[0].balance | 0) : null
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/login-cal/claim', e);
    res.status(500).json({ error: 'internal' });
  }
});
}
