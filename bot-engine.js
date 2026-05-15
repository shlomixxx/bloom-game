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

function bestColumn(g, piece) {
  let bestCol = 0, bestScore = -Infinity;
  for (let col = 0; col < COLS; col++) {
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][col] === 0) { row = r; break; }
    }
    if (row === -1) continue;
    // Clone and simulate
    const sim = g.map(r => r.slice());
    sim[row][col] = piece;
    const result = processChains(sim);
    // Simple heuristic
    let s = result.score;
    // Prefer columns that keep the board low
    let height = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (sim[r][c] !== 0) height++;
      }
    }
    s -= height * 5;
    s += Math.random() * 3; // tie-breaker
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
let botPool = null; // set by init

function createBot(name) {
  const deviceId = 'bot-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  return {
    deviceId,
    name,
    grid: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
    score: 0,
    highestTier: 1,
    gamesPlayed: 0,
    mode: 'practice',
    active: true
  };
}

function tickBot(bot) {
  if (!bot.active) return;
  
  // Game over → restart
  if (isGameOver(bot.grid)) {
    bot.gamesPlayed++;
    bot.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    bot.score = 0;
    bot.highestTier = 1;
    return;
  }

  // Make 1-3 moves per tick
  const moves = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < moves; i++) {
    if (isGameOver(bot.grid)) break;
    const piece = pickPiece(bot.highestTier);
    const col = bestColumn(bot.grid, piece);
    // Find landing row
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

async function flushBots() {
  if (!botPool || bots.size === 0) return;
  const activeBots = [...bots.values()].filter(b => b.active);
  if (!activeBots.length) return;

  // Batch upsert all bot heartbeats
  const values = [];
  const params = [];
  let idx = 1;
  for (const b of activeBots) {
    const gridJson = JSON.stringify(b.grid);
    values.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, NOW())`);
    params.push(b.deviceId, b.name, b.mode, b.score, b.highestTier, gridJson);
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
    // Fallback without grid_json
    try {
      const values2 = [];
      const params2 = [];
      let idx2 = 1;
      for (const b of activeBots) {
        values2.push(`($${idx2}, $${idx2+1}, $${idx2+2}, $${idx2+3}, $${idx2+4}, NOW())`);
        params2.push(b.deviceId, b.name, b.mode, b.score, b.highestTier);
        idx2 += 5;
      }
      await botPool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, updated_at)
         VALUES ${values2.join(',')}
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, mode = EXCLUDED.mode,
             score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier, updated_at = NOW()`,
        params2
      );
    } catch (e2) {
      console.error('[bots] flush failed:', e2.message);
    }
  }
}

function startBots(count, pool) {
  botPool = pool;
  stopBots(); // clear existing
  
  // Pick random names
  const shuffled = [...NAMES].sort(() => Math.random() - 0.5);
  const names = shuffled.slice(0, Math.min(count, NAMES.length));
  
  for (const name of names) {
    const bot = createBot(name);
    bots.set(bot.deviceId, bot);
  }
  
  // Tick all bots every 5 seconds
  botInterval = setInterval(() => {
    for (const bot of bots.values()) {
      tickBot(bot);
    }
    flushBots();
  }, 5000);
  
  // Immediate first flush
  for (const bot of bots.values()) tickBot(bot);
  flushBots();
  
  console.log(`[bots] started ${bots.size} bots`);
  return bots.size;
}

function stopBots() {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }
  // Clean up heartbeat entries for bots
  if (botPool && bots.size > 0) {
    const ids = [...bots.keys()];
    botPool.query(
      `DELETE FROM player_heartbeat WHERE device_id = ANY($1)`,
      [ids]
    ).catch(() => {});
  }
  bots.clear();
  console.log('[bots] stopped all bots');
}

function getBotStatus() {
  const active = [...bots.values()].filter(b => b.active);
  return {
    running: botInterval !== null,
    count: active.length,
    bots: active.map(b => ({
      name: b.name,
      score: b.score,
      tier: b.highestTier,
      games: b.gamesPlayed
    }))
  };
}

export { startBots, stopBots, getBotStatus };
