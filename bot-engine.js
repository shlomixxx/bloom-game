// ============================================================
// BLOOM Server-Side Bot Engine
// Simulates realistic players with actual merge game logic.
// Managed from the admin dashboard.
// ============================================================

const NAMES = [
  'נועם','איתי','אורי','עידו','רועי','גיל','דור','אלון','ליאור','עומר',
  'יונתן','אדם','דניאל','איתמר','עידן','רון','תומר','שחר','ניר','אמיר',
  'יובל','אסף','מתן','נדב','אייל','עמית','בן','טל','ארז','שי',
  'אלעד','אריאל','יואב','עדי','ליאם','נועה','מאיה','שירה','תמר','יעל',
  'אביגיל','דנה','הילה','רוני','ליהי','אורלי','מיכל','גלי','שקד','איילת',
  'הדר','ענבר','קרן','לירון','רותם','סתיו','אביב','דקלה','עינב','נגה',
  'אלה','מעיין','יהלי','רננה','שלומית','ורד','אפרת','מורן','טליה','אורית',
  'ליאת','סיגל','חן','יסמין','נעמה','רחל','שרון','אילנה','עליזה','מירב',
  'ציפי','אסתר','רינת','דפנה','גילת','עדינה','חגית','לימור','ענת','יפעת',
  'צליל','אגם','עלמה','שילת','הלל','לביא','אופיר','ניצן','ים','אורן',
  'עמרי','שגיא','דביר','אלמוג','יפתח','אהרון','ברק','גדעון','זיו','חיים',
  'ירדן','כפיר','לירז','משה','נתן','סהר','פלג','צוף','קורל','רפאל',
  'שמעון','תמיר','אביה','בניה','גיא','דורון','הראל','ולדי','זוהר','חיליק',
  'טובי','יגאל','כרמל','לוטם','מגל','נריה','סער','עופר','פנינה','צופיה',
  'קמה','רביד','שלו','תהל','אביתר','בארי','גפן','דליה','הגר','וורד',
  'זמיר','חמוטל','טנא','יקיר','כנרת','לבנה','מרגלית','נאוה','סנונית','עפרה',
  'פרי','צבר','קשת','רזיאל','שניר','תבור','אדר','ביסאן','גאיה','דרור',
  'הודיה','ויויאן','זהבה','חושן','טופז','יערה','כוכב','ליבי','מיקה','נור',
  'סולי','עוז','פיקוס','צבי','קורן','ריף','שקמה','תאיר','אנאל','ברוש',
  'גורן','דולב','הדס','וואלי','זית','חרצית','טיילי','יריב','כליל','לוטוס'
];

const ROWS = 6, COLS = 4, MAX_TIER = 8;

// Simple merge logic (same as game)
function findGroup(g, sr, sc, tier) {
  const visited = new Set();
  const group = [];
  const stack = [[sr, sc]];
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const k = r * COLS + c;
    if (visited.has(k)) continue;
    if (g[r][c] !== tier) continue;
    visited.add(k);
    group.push([r, c]);
    stack.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
  }
  return group;
}

function applyGravity(g) {
  for (let c = 0; c < COLS; c++) {
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][c] !== 0) {
        if (r !== w) { g[w][c] = g[r][c]; g[r][c] = 0; }
        w--;
      }
    }
  }
}

function processChains(g) {
  let totalScore = 0, chains = 0, highest = 1;
  while (true) {
    let merged = false;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = g[r][c];
        if (t === 0 || t === MAX_TIER) continue;
        if (t > highest) highest = t;
        const group = findGroup(g, r, c, t);
        if (group.length >= 2) {
          // Keep bottommost cell
          let kr = -1, kc = -1;
          for (const [gr, gc] of group) {
            if (gr > kr || (gr === kr && gc < kc)) { kr = gr; kc = gc; }
          }
          for (const [gr, gc] of group) {
            if (gr === kr && gc === kc) continue;
            g[gr][gc] = 0;
          }
          const nt = Math.min(t + 1, MAX_TIER);
          g[kr][kc] = nt;
          if (nt > highest) highest = nt;
          chains++;
          const mult = 1 + (chains - 1) * 0.5;
          totalScore += nt * 10 * group.length * mult;
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
    if (!merged) break;
    applyGravity(g);
  }
  return { score: totalScore, chains, highest };
}

function pickPiece(highest) {
  // Tiers 1-3, weighted toward lower
  const maxSpawn = Math.min(3, Math.max(1, highest - 1));
  const weights = [0, 60, 30, 10];
  let total = 0;
  for (let i = 1; i <= maxSpawn; i++) total += weights[i];
  let r = Math.random() * total;
  for (let i = 1; i <= maxSpawn; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 1;
}

function columnHeights(g) {
  const h = new Array(COLS).fill(0);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (g[r][c] !== 0) { h[c] = ROWS - r; break; }
    }
  }
  return h;
}

function evaluateBoard(g) {
  const heights = columnHeights(g);
  let maxH = 0, sumH = 0, topFilled = 0;
  for (let c = 0; c < COLS; c++) {
    if (heights[c] > maxH) maxH = heights[c];
    sumH += heights[c];
    if (g[0][c] !== 0) topFilled++;
  }
  let roughness = 0;
  for (let c = 0; c < COLS - 1; c++) roughness += Math.abs(heights[c] - heights[c+1]);
  
  // Bonus: high-tier pieces (preserves merge ladder)
  let tierBonus = 0;
  // Bonus: adjacent same-tier pairs (future merge potential)
  let pairBonus = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c];
      if (t >= 4) tierBonus += t * 2;
      if (t === 0) continue;
      if (c + 1 < COLS && g[r][c+1] === t) pairBonus += t;
      if (r + 1 < ROWS && g[r+1][c] === t) pairBonus += t;
    }
  }
  
  return {
    heightPenalty: maxH * 6 + sumH * 1.2,
    topPenalty: topFilled * 40 + (topFilled >= 3 ? 120 : 0),
    roughness: roughness * 4,
    tierBonus,
    pairBonus: pairBonus * 1.5,
  };
}

function simulateDrop(g, col, piece) {
  const sim = g.map(r => r.slice());
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (sim[r][col] === 0) { row = r; break; }
  }
  if (row === -1) return null;
  sim[row][col] = piece;
  const result = processChains(sim);
  applyGravity(sim);
  return { grid: sim, ...result };
}

function bestColumn(g, piece) {
  let bestCol = 0, bestScore = -Infinity;
  
  for (let col = 0; col < COLS; col++) {
    const sim = simulateDrop(g, col, piece);
    if (!sim) continue;
    
    const ev = evaluateBoard(sim.grid);
    
    // Primary: actual chain points from this move
    let s = sim.score * 1.0;
    
    // Reward chain length (multiplier ladder)
    if (sim.chains >= 2) s += 80 * (sim.chains - 1);
    if (sim.chains >= 3) s += 200;
    if (sim.chains >= 4) s += 400;
    
    // Reward raising highest tier (long-term progress)
    if (sim.highest > piece) s += (sim.highest - piece) * 60;
    
    // Board quality
    s -= ev.heightPenalty;
    s -= ev.topPenalty;
    s -= ev.roughness;
    s += ev.tierBonus;
    s += ev.pairBonus;
    
    // Hard penalty for nearly-full top row
    let topEmpty = 0;
    for (let c = 0; c < COLS; c++) if (sim.grid[0][c] === 0) topEmpty++;
    if (topEmpty === 0) s -= 5000;
    else if (topEmpty === 1) s -= 200;
    
    // Tiny tie-breaker
    s += Math.random() * 2;
    
    if (s > bestScore) { bestScore = s; bestCol = col; }
  }
  
  return bestCol;
}

function isGameOver(g) {
  return g[0].every(c => c !== 0);
}

// ============================================================
// BOT MANAGER
// ============================================================

const bots = new Map(); // deviceId → bot state
let botInterval = null;
let botPool = null;
let botConfig = {
  mode: 'practice', speed: 'normal', contestCode: null, challengeSlug: null,
  targetCount: 10,    // how many bots should be active at any time
  restartMin: 30,     // seconds to wait before new player replaces finished one
  restartMax: 90,     // max random delay
  maxGamesPerBot: 1   // how many games a bot plays before being replaced (1 = retire after 1 game)
};
let usedNames = new Set(); // track recently used names to avoid repeats
let pendingSpawns = []; // { spawnAt: timestamp }

const TICK_SPEEDS = { slow: 8000, normal: 3000, fast: 1500, instant: 800 };
const MOVES_PER_TICK = { slow: 2, normal: 4, fast: 6, instant: 10 };

function pickNewName() {
  // Find a name not recently used
  const available = NAMES.filter(n => !usedNames.has(n));
  if (available.length === 0) {
    usedNames.clear(); // reset if all names used
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }
  const name = available[Math.floor(Math.random() * available.length)];
  usedNames.add(name);
  // Keep usedNames from growing too large — forget oldest after 60% used
  if (usedNames.size > NAMES.length * 0.6) {
    const arr = [...usedNames];
    for (let i = 0; i < 20 && arr.length > 20; i++) usedNames.delete(arr[i]);
  }
  return name;
}

function createBot(name) {
  const deviceId = 'bot-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  return {
    deviceId,
    name: name || pickNewName(),
    grid: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
    score: 0,
    highestTier: 1,
    gamesPlayed: 0,
    mode: botConfig.mode,
    contestCode: botConfig.contestCode,
    challengeSlug: botConfig.challengeSlug,
    active: true,
    exiting: false, // true = game over, waiting to be replaced
    joined: false
  };
}

function removeBot(bot) {
  bots.delete(bot.deviceId);
  // Clean heartbeat for this bot
  if (botPool) {
    botPool.query(`DELETE FROM player_heartbeat WHERE device_id = $1`, [bot.deviceId]).catch(() => {});
    if (bot.contestCode) {
      botPool.query(`DELETE FROM contest_live_state WHERE device_id = $1`, [bot.deviceId]).catch(() => {});
    }
  }
}

function scheduleReplacement() {
  const delayMs = (botConfig.restartMin + Math.random() * (botConfig.restartMax - botConfig.restartMin)) * 1000;
  pendingSpawns.push({ spawnAt: Date.now() + delayMs });
}

function processPendingSpawns() {
  const now = Date.now();
  const activeCount = [...bots.values()].filter(b => !b.exiting).length;
  const needed = botConfig.targetCount - activeCount;
  
  let spawned = 0;
  while (pendingSpawns.length > 0 && spawned < needed) {
    const next = pendingSpawns[0];
    if (next.spawnAt > now) break; // not ready yet
    pendingSpawns.shift();
    
    const bot = createBot();
    bots.set(bot.deviceId, bot);
    if (bot.mode === 'contest' && bot.contestCode) joinContest(bot).catch(e => console.error("[bots] joinContest:", e.message));
    spawned++;
  }
}

function tickBot(bot) {
  if (!bot.active || bot.exiting) return;
  
  if (isGameOver(bot.grid)) {
    submitBotScore(bot).catch(e => console.error('[bots] submitBotScore:', e.message));
    bot.gamesPlayed++;

    // Should this bot continue playing more games?
    if (bot.gamesPlayed < (botConfig.maxGamesPerBot || 1)) {
      // Reset for a new game — keep the same bot/name (multiple games in a row)
      bot.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
      bot.score = 0;
      bot.highestTier = 1;
      return; // will play again next tick
    }

    // Reached max games — retire this bot
    bot.exiting = true;
    scheduleReplacement();
    setTimeout(() => removeBot(bot), 3000);
    return;
  }

  const moves = MOVES_PER_TICK[botConfig.speed] || 2;
  for (let i = 0; i < moves; i++) {
    if (isGameOver(bot.grid)) break;
    const piece = pickPiece(bot.highestTier);
    const col = bestColumn(bot.grid, piece);
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (bot.grid[r][col] === 0) { row = r; break; }
    }
    if (row === -1) break;
    bot.grid[row][col] = piece;
    if (piece > bot.highestTier) bot.highestTier = piece;
    const result = processChains(bot.grid);
    bot.score += result.score;
    if (result.highest > bot.highestTier) bot.highestTier = result.highest;
    applyGravity(bot.grid);
  }
}

// Submit score to appropriate endpoint based on mode
async function submitBotScore(bot) {
  if (!botPool) return;
  try {
    if (bot.mode === 'daily') {
      // Submit to daily leaderboard
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      // Schema has columns: date, device_id, name, score, tier (verified in
      // schema.sql). Earlier rev used `display_name`/`highest_tier` which
      // silently failed on the INSERT — bot scores never landed.
      await botPool.query(
        `INSERT INTO daily_scores (date, device_id, name, score, tier)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (date, device_id) DO UPDATE
         SET score = GREATEST(daily_scores.score, EXCLUDED.score),
             tier  = GREATEST(daily_scores.tier,  EXCLUDED.tier),
             name  = EXCLUDED.name,
             updated_at = NOW()`,
        [today, bot.deviceId, bot.name, bot.score, bot.highestTier]
      );
    } else if (bot.mode === 'contest' && bot.contestCode) {
      // Submit to contest leaderboard
      await botPool.query(
        `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
         VALUES ($1, $2, $3, $4, $5, 1, NOW())
         ON CONFLICT (contest_code, device_id) DO UPDATE
         SET score = contest_scores.score + EXCLUDED.score,
             highest_tier = GREATEST(contest_scores.highest_tier, EXCLUDED.highest_tier),
             games_played = contest_scores.games_played + 1,
             last_played_at = NOW()`,
        [bot.contestCode, bot.deviceId, bot.name, bot.score, bot.highestTier]
      );
    } else if (bot.mode === 'duel') {
      // Pair finished duel bots into a synthetic duel row so the duels table
      // reflects "bot vs bot" matches. Pairing waits up to one tick for a
      // partner; if none, the bot writes a self-vs-self placeholder row.
      _pendingDuelFinish.push({ deviceId: bot.deviceId, name: bot.name, score: bot.score, tier: bot.highestTier, at: Date.now() });
      await tryPairDuelBots();
    } else if (bot.mode === 'challenge' && bot.challengeSlug) {
      // challenge_entries is keyed by (challenge_id, device_id). Resolve
      // the slug → id once, then insert a completed entry. drops_count is
      // derived from score so the cheat-flag heuristic doesn't auto-flag.
      const plausibleDrops = Math.max(25, Math.min(300, Math.floor(bot.score / 1500)));
      try {
        const ch = await botPool.query(`SELECT id FROM challenges WHERE slug = $1 LIMIT 1`, [bot.challengeSlug]);
        if (ch.rows.length) {
          await botPool.query(
            `INSERT INTO challenge_entries (challenge_id, device_id, display_name, score, highest_tier, drops_count, status, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())
             ON CONFLICT (challenge_id, device_id) DO UPDATE
             SET score = GREATEST(challenge_entries.score, EXCLUDED.score),
                 highest_tier = GREATEST(challenge_entries.highest_tier, EXCLUDED.highest_tier),
                 drops_count = challenge_entries.drops_count + EXCLUDED.drops_count,
                 status = 'completed',
                 completed_at = NOW()`,
            [ch.rows[0].id, bot.deviceId, bot.name, bot.score, bot.highestTier, plausibleDrops]
          );
        }
      } catch (e) { /* silent — slug typo or stale challenge */ }
    }
    // practice mode: heartbeat-only (already done by flushBots). The score
    // is visible in the admin live view but never submitted to a leaderboard.
  } catch (e) {
    // Silent — non-critical
  }
}

// ============================================================
// DUEL BOT PAIRING — when two bots in duel mode finish back-to-back,
// pair them into a real `duels` row (challenger=A, opponent=B) so the
// admin live view, audit log, and player profile stats all see a real
// completed duel. If a bot finishes alone, it sits in the queue for up
// to 30 seconds before getting paired with itself (rare edge case).
// ============================================================
const _pendingDuelFinish = []; // FIFO: { deviceId, name, score, tier, at }
async function tryPairDuelBots() {
  if (!botPool) return;
  const now = Date.now();
  // Drain any finishers older than 30 seconds that never got a partner.
  while (_pendingDuelFinish.length >= 2 || (_pendingDuelFinish.length && now - _pendingDuelFinish[0].at > 30000)) {
    const a = _pendingDuelFinish.shift();
    const b = _pendingDuelFinish.length ? _pendingDuelFinish.shift() : a; // self-pair fallback
    const seed = Math.floor(Math.random() * 1e9);
    let winnerDevice = null, status = 'tie';
    if (a.score > b.score) { winnerDevice = a.deviceId; status = 'settled'; }
    else if (b.score > a.score) { winnerDevice = b.deviceId; status = 'settled'; }
    // opponent_code and expires_at are NOT NULL on the duels table; use
    // synthetic placeholders since the bots never came through the real
    // /api/duels flow. The row is still useful for admin visibility.
    const fakeCode = 'BOT-' + b.deviceId.slice(-4).toUpperCase();
    const expiresAt = new Date(now + 60 * 60 * 1000); // +1 hour, well past insert time
    try {
      await botPool.query(
        `INSERT INTO duels (challenger_device, challenger_name, opponent_device, opponent_name,
                            opponent_code, challenger_score, opponent_score, amount, board_seed,
                            status, winner_device, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)`,
        [a.deviceId, a.name, b.deviceId, b.name, fakeCode, a.score, b.score, seed, status, winnerDevice, expiresAt]
      );
    } catch (e) { /* schema mismatch — silent */ }
  }
}

// Join contest for new bots
async function joinContest(bot) {
  if (!botPool || !bot.contestCode || bot.joined) return;
  try {
    await botPool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
       VALUES ($1, $2, $3, 0, 1, 0, NOW())
       ON CONFLICT (contest_code, device_id) DO NOTHING`,
      [bot.contestCode, bot.deviceId, bot.name]
    );
    bot.joined = true;
  } catch (e) { /* silent */ }
}

async function flushBots() {
  if (!botPool || bots.size === 0) return;
  const activeBots = [...bots.values()].filter(b => b.active && !b.exiting);
  if (!activeBots.length) return;

  // Batch upsert all bot heartbeats
  const values = [];
  const params = [];
  let idx = 1;
  for (const b of activeBots) {
    const gridJson = JSON.stringify(b.grid);
    const modeLabel = b.mode === 'contest' ? 'contest' : b.mode;
    values.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, NOW())`);
    params.push(b.deviceId, b.name, modeLabel, b.score, b.highestTier, gridJson);
    idx += 6;
  }
  
  try {
    await botPool.query(
      `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, grid_json, updated_at)
       VALUES ${values.join(',')}
       ON CONFLICT (device_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, mode = EXCLUDED.mode,
           score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier,
           grid_json = EXCLUDED.grid_json, updated_at = NOW()`,
      params
    );
  } catch (e) {
    try {
      const v2 = [], p2 = [];
      let i2 = 1;
      for (const b of activeBots) {
        v2.push(`($${i2}, $${i2+1}, $${i2+2}, $${i2+3}, $${i2+4}, NOW())`);
        p2.push(b.deviceId, b.name, b.mode, b.score, b.highestTier);
        i2 += 5;
      }
      await botPool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, updated_at)
         VALUES ${v2.join(',')}
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, mode = EXCLUDED.mode,
             score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier, updated_at = NOW()`,
        p2
      );
    } catch (e2) {
      console.error('[bots] flush failed:', e2.message);
    }
  }

  // Push live scores for contest bots
  if (botConfig.mode === 'contest' && botConfig.contestCode) {
    for (const b of activeBots) {
      if (!b.contestCode) continue;
      try {
        await botPool.query(
          `INSERT INTO contest_live_state (contest_code, device_id, display_name, live_score, highest_tier, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (contest_code, device_id) DO UPDATE
           SET live_score = EXCLUDED.live_score, highest_tier = EXCLUDED.highest_tier,
               display_name = EXCLUDED.display_name, updated_at = NOW()`,
          [b.contestCode, b.deviceId, b.name, b.score, b.highestTier]
        );
      } catch (e) { /* silent */ }
    }
  }
}

function startBots(count, pool, config) {
  botPool = pool;
  stopBots();
  
  if (config) {
    botConfig.mode = config.mode || 'practice';
    botConfig.speed = config.speed || 'normal';
    botConfig.contestCode = config.contestCode || null;
    botConfig.challengeSlug = config.challengeSlug || null;
    botConfig.targetCount = count;
    if (config.restartMin != null) botConfig.restartMin = config.restartMin;
    if (config.restartMax != null) botConfig.restartMax = config.restartMax;
    if (config.maxGamesPerBot != null) botConfig.maxGamesPerBot = Math.max(1, config.maxGamesPerBot | 0);
  }
  
  usedNames.clear();
  pendingSpawns = [];
  
  for (let i = 0; i < count; i++) {
    const bot = createBot();
    bots.set(bot.deviceId, bot);
    if (bot.mode === 'contest' && bot.contestCode) joinContest(bot).catch(e => console.error("[bots] joinContest:", e.message));
  }
  
  const tickMs = TICK_SPEEDS[botConfig.speed] || 5000;
  botInterval = setInterval(() => {
    try {
      // Tick all active bots
      for (const bot of bots.values()) {
        try { tickBot(bot); } catch (e) { console.error('[bots] tick error:', e.message); }
      }
      // Spawn replacements for finished bots
      try { processPendingSpawns(); } catch (e) { console.error('[bots] spawn error:', e.message); }
      // Flush to DB
      flushBots().catch(e => console.error('[bots] flush error:', e.message));
    } catch (e) {
      console.error('[bots] interval error:', e.message);
    }
  }, tickMs);
  
  // Immediate first tick
  for (const bot of bots.values()) {
    try { tickBot(bot); } catch (e) { console.error('[bots] initial tick:', e.message); }
  }
  flushBots().catch(e => console.error('[bots] initial flush:', e.message));
  
  console.log(`[bots] started ${bots.size} bots — mode: ${botConfig.mode}, speed: ${botConfig.speed}, max games: ${botConfig.maxGamesPerBot}, rotation: ${botConfig.restartMin}-${botConfig.restartMax}s`);
  return bots.size;
}

function stopBots() {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }
  if (botPool && bots.size > 0) {
    const ids = [...bots.keys()];
    botPool.query(`DELETE FROM player_heartbeat WHERE device_id = ANY($1)`, [ids]).catch(() => {});
    if (botConfig.contestCode) {
      botPool.query(`DELETE FROM contest_live_state WHERE device_id = ANY($1)`, [ids]).catch(() => {});
    }
  }
  bots.clear();
  pendingSpawns = [];
  usedNames.clear();
  console.log('[bots] stopped all bots');
}

function getBotStatus() {
  const active = [...bots.values()].filter(b => !b.exiting);
  const exiting = [...bots.values()].filter(b => b.exiting);
  return {
    running: botInterval !== null,
    count: active.length,
    pending: pendingSpawns.length,
    exiting: exiting.length,
    config: { ...botConfig },
    bots: active.slice(0, 20).map(b => ({
      deviceId: b.deviceId,
      name: b.name,
      score: b.score,
      tier: b.highestTier,
      games: b.gamesPlayed,
      mode: b.mode
    }))
  };
}

export { startBots, stopBots, getBotStatus };
