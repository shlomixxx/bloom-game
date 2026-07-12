// routes/spin.js — extracted verbatim from server.js (SR.3 route-group decomposition).
// registerSpinRoutes(app, deps) is called from server.js after all deps exist.
export function registerSpinRoutes(app, deps) {
  const { pool, requireDeviceAuth, checkRateLimit, getCachedConfigPrefix } = deps;

async function _loadSpinConfig() {
  // T6.3 — cached. Pulls the master toggle + bonus settings + all 12
  // segment definitions from the global cache instead of a LIKE scan.
  try { return await getCachedConfigPrefix('daily_spin_'); }
  catch (e) { return {}; }
}

function _spinSegments(cfg) {
  const segs = [];
  for (let i = 1; i <= 12; i++) {
    const label  = cfg['daily_spin_seg_' + i + '_label'];
    const emoji  = cfg['daily_spin_seg_' + i + '_emoji'];
    const type   = cfg['daily_spin_seg_' + i + '_type'];
    const amount = parseFloat(cfg['daily_spin_seg_' + i + '_amount']) || 0;
    const weight = parseFloat(cfg['daily_spin_seg_' + i + '_weight']) || 0;
    const color  = cfg['daily_spin_seg_' + i + '_color'];
    if (!label || !type || weight <= 0) continue;
    segs.push({ index: i, label, emoji, type, amount, weight, color });
  }
  return segs;
}

function _spinPickSegment(segs) {
  // Weighted random pick.
  const total = segs.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of segs) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return segs[segs.length - 1];
}

function _spinTodayISO() {
  // Asia/Jerusalem date string.
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const jeru = new Date(utc + 3 * 3600000);
  return jeru.toISOString().slice(0, 10);
}

function _spinYesterdayISO() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const jeru = new Date(utc + 3 * 3600000);
  jeru.setUTCDate(jeru.getUTCDate() - 1);
  return jeru.toISOString().slice(0, 10);
}

app.get('/api/spin/state', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadSpinConfig();
    if (cfg.daily_spin_enabled === 'false') return res.json({ ok: true, enabled: false });
    const segs = _spinSegments(cfg);
    const r = await pool.query(
      `SELECT last_spin_date, current_streak, longest_streak, total_spins, total_gems_won, last_reward
         FROM daily_spin_state WHERE device_id = $1`,
      [deviceId]
    );
    const today = _spinTodayISO();
    let row = r.rows[0] || { last_spin_date: null, current_streak: 0, longest_streak: 0, total_spins: 0, total_gems_won: 0, last_reward: null };
    const lastDateStr = row.last_spin_date ? new Date(row.last_spin_date).toISOString().slice(0, 10) : null;
    const canSpin = !lastDateStr || lastDateStr !== today;
    res.json({
      ok: true,
      enabled: true,
      canSpin,
      lastSpinDate: lastDateStr,
      currentStreak: row.current_streak || 0,
      longestStreak: row.longest_streak || 0,
      totalSpins: row.total_spins || 0,
      totalGemsWon: Number(row.total_gems_won || 0),
      lastReward: row.last_reward || null,
      segments: segs.map(function(s) { return { index: s.index, label: s.label, emoji: s.emoji, type: s.type, amount: s.amount, color: s.color, weight: s.weight }; }),
      streakBonusPct: parseInt(cfg.daily_spin_streak_bonus_pct || '10', 10),
      streakBonusMaxPct: parseInt(cfg.daily_spin_streak_max_pct || '200', 10)
    });
  } catch (e) {
    console.error('GET /api/spin/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/spin/today', requireDeviceAuth, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    if (!checkRateLimit('spin_today', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadSpinConfig();
    if (cfg.daily_spin_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const segs = _spinSegments(cfg);
    if (!segs.length) return res.json({ ok: false, reason: 'no_segments' });

    const today = _spinTodayISO();
    const yesterday = _spinYesterdayISO();
    const bonusPct = parseInt(cfg.daily_spin_streak_bonus_pct || '10', 10);
    const bonusMaxPct = parseInt(cfg.daily_spin_streak_max_pct || '200', 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lazy-insert state row.
      const sr = await client.query(
        `INSERT INTO daily_spin_state (device_id, last_spin_date, current_streak, longest_streak, total_spins, total_gems_won)
         VALUES ($1, NULL, 0, 0, 0, 0)
         ON CONFLICT (device_id) DO NOTHING
         RETURNING device_id`,
        [deviceId]
      );
      // Lock the row for the rest of the txn.
      const st = await client.query(
        `SELECT last_spin_date, current_streak, longest_streak, total_spins, total_gems_won
           FROM daily_spin_state WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const cur = st.rows[0];
      const lastDateStr = cur.last_spin_date ? new Date(cur.last_spin_date).toISOString().slice(0, 10) : null;
      if (lastDateStr === today) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_spun_today' });
      }
      // Streak: continued (yesterday) or reset (anything else).
      let newStreak;
      if (lastDateStr === yesterday) newStreak = (cur.current_streak || 0) + 1;
      else newStreak = 1;
      const newLongest = Math.max(cur.longest_streak || 0, newStreak);
      // Roll a segment.
      const picked = _spinPickSegment(segs);
      // Streak bonus only applies to gem-type rewards.
      const streakBonusPct = Math.min((newStreak - 1) * bonusPct, bonusMaxPct);
      let finalAmount = picked.amount;
      if (picked.type === 'gems' || picked.type === 'jackpot') {
        finalAmount = Math.round(picked.amount * (1 + streakBonusPct / 100));
      }
      // Grant the reward.
      let granted = { type: picked.type, amount: finalAmount, segment: picked.index, label: picked.label, emoji: picked.emoji, color: picked.color, streakBonusPct };
      let newBalance = null;
      if (picked.type === 'gems' || picked.type === 'jackpot') {
        const cr = await client.query(
          `UPDATE player_profiles
             SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
           WHERE device_id = $2
           RETURNING balance`,
          [finalAmount, deviceId]
        );
        newBalance = cr.rows[0] ? Number(cr.rows[0].balance) : null;
      } else if (picked.type === 'bp_xp') {
        // Pump BP XP via existing season_pass tile-advance mechanic.
        // For simplicity: bump player_season_progress.xp by finalAmount.
        await client.query(
          `INSERT INTO player_season_progress (device_id, season_id, xp, claimed_tiers, recent_game_ids)
             VALUES ($1, COALESCE((SELECT value FROM game_config WHERE key='season_id'), 's1'), $2, '[]'::jsonb, '[]'::jsonb)
             ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + EXCLUDED.xp`,
          [deviceId, finalAmount]
        );
      } else if (picked.type === 'freeze') {
        // Bump streak-freeze count. Server doesn't track freezes directly —
        // they live in localStorage on the client. We pass back the amount
        // and the client increments its own counter.
        // (No server-side counter to update.)
      } else if (picked.type === 'chest') {
        // We grant a "bonus chest" gem-equivalent (gachas/chests aren't a
        // pure server table). For v1, simply credit the average chest value.
        const chestAvg = parseInt(cfg.dyn_chest_uncommon_max || '30', 10);
        const cr = await client.query(
          `UPDATE player_profiles
             SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
           WHERE device_id = $2
           RETURNING balance`,
          [chestAvg, deviceId]
        );
        granted.amount = chestAvg;
        granted.type = 'gems';
        granted.note = 'chest_equiv';
        newBalance = cr.rows[0] ? Number(cr.rows[0].balance) : null;
      }
      // Update state.
      const gemDelta = (granted.type === 'gems' || granted.type === 'jackpot') ? granted.amount : 0;
      await client.query(
        `UPDATE daily_spin_state
           SET last_spin_date = $2::date,
               current_streak = $3,
               longest_streak = $4,
               total_spins    = total_spins + 1,
               total_gems_won = total_gems_won + $5,
               last_reward    = $6::jsonb,
               last_spin_at   = NOW()
         WHERE device_id = $1`,
        [deviceId, today, newStreak, newLongest, gemDelta, JSON.stringify(granted)]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        reward: granted,
        currentStreak: newStreak,
        longestStreak: newLongest,
        newBalance
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/spin/today', e);
    res.status(500).json({ error: 'internal' });
  }
});
}
