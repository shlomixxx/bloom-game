(function() {
  'use strict';

  // ============================================================
  // BLOOM Auto-Play Bot — Premium Edition (May 2026)
  // ?bot=1 or ?botui — panel with full controls
  // Panel can be fully hidden for clean video recording.
  //
  // Two modes:
  // • Silent (default): window.__bloomBotActive = true → game-side guards
  //   skip leaderboard submits, achievements, season XP, etc.
  // • Submit: window.__bloomBotActive = false → bot behaves like a real
  //   player and writes to every leaderboard, including daily / dynamic /
  //   tournaments. Useful for testing and for an admin who wants to
  //   populate boards. Off-by-default for safety.
  //
  // AI is aware of dynamic boards: special cells (gold/bonus/frozen/
  // locked/electric/teleport), column multipliers (×1..×20), shape voids.
  // ============================================================

  const params = new URLSearchParams(window.location.search);
  if (!params.has('bot') && !params.has('botui')) return;

  // Signal to the game: skip stats, heartbeat, best-score when bot is active.
  // Re-toggled inside play() based on the "submit to LB" checkbox.
  window.__bloomBotActive = false;

  const SPEED_DELAYS = {
    slow:    { min: 800, max: 1500 },
    normal:  { min: 350, max: 700 },
    fast:    { min: 120, max: 250 },
    instant: { min: 30,  max: 80 },
  };

  const STATE_KEY = 'bloom_bot_state_v2';
  const SETTINGS_KEY = 'bloom_bot_settings_v2';

  const bot = {
    running: false,
    speed: 'normal',
    autoRestart: true,
    submitToLB: false,         // ☑ allow LB submits (off by default)
    targetMode: 'current',     // current | auto | practice | daily | dynamic | duel
    selectedBoardId: null,     // null = random | id | '__rotation__'
    rotationIndex: 0,          // cursor for '__rotation__' mode
    currentBoardName: '',      // populated when starting a dynamic board
    duelWaiting: false,        // true when in duel mode but no duel ready
    duelGamesPlayed: 0,        // duel-specific session counter
    // stats
    gamesPlayed: 0,
    totalScore: 0,
    bestScore: 0,
    bestTier: 0,
    crownCount: 0,             // games where bot reached tier 8 at least once
    totalPlaytimeMs: 0,
    lastRank: null,            // last seen leaderboard rank (after submit-ON game)
    lastRankTotal: null,
    lastRankMode: null,
    // internals
    stopRequested: false,
    currentGameStart: 0,
    sawCrownThisGame: false,
  };

  // Load persisted state + settings.
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    Object.assign(bot, {
      gamesPlayed: s.gamesPlayed | 0,
      totalScore: s.totalScore | 0,
      bestScore: s.bestScore | 0,
      bestTier: s.bestTier | 0,
      crownCount: s.crownCount | 0,
      totalPlaytimeMs: s.totalPlaytimeMs | 0,
    });
  } catch (e) {}
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.speed) bot.speed = s.speed;
    if (s.targetMode) bot.targetMode = s.targetMode;
    if (s.selectedBoardId !== undefined) bot.selectedBoardId = s.selectedBoardId;
    if (typeof s.autoRestart === 'boolean') bot.autoRestart = s.autoRestart;
    if (typeof s.submitToLB === 'boolean') bot.submitToLB = s.submitToLB;
  } catch (e) {}

  function persistState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        gamesPlayed: bot.gamesPlayed, totalScore: bot.totalScore,
        bestScore: bot.bestScore, bestTier: bot.bestTier,
        crownCount: bot.crownCount, totalPlaytimeMs: bot.totalPlaytimeMs
      }));
    } catch (e) {}
  }
  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        speed: bot.speed, targetMode: bot.targetMode,
        selectedBoardId: bot.selectedBoardId,
        autoRestart: bot.autoRestart, submitToLB: bot.submitToLB
      }));
    } catch (e) {}
  }

  function waitForGame() {
    return new Promise(resolve => {
      const check = () => {
        if (window.BloomDebug && window.BloomDebug.ready()) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isInGame() {
    if (document.getElementById('home-screen')) return false;
    if (document.getElementById('contest-screen')) return false;
    if (document.getElementById('challenge-screen')) return false;
    const grid = document.getElementById('grid');
    return !!(grid && grid.children.length > 0);
  }

  // ============================================================
  // Dynamic-board awareness — read window._activeSpecialBoard
  // ============================================================

  function getBoardContext() {
    const sb = window._activeSpecialBoard || null;
    if (!sb) return { mults: null, cellsByPos: null, shapeId: null };
    const def = sb.definition || sb;
    const cellsByPos = {};
    if (Array.isArray(def.cells)) {
      for (const c of def.cells) {
        if (!c || typeof c.row !== 'number' || typeof c.col !== 'number') continue;
        cellsByPos[c.row + ',' + c.col] = c;
      }
    }
    return {
      mults: Array.isArray(def.multipliers) ? def.multipliers : null,
      cellsByPos: cellsByPos,
      shapeId: def.shape_id || null,
    };
  }

  // Shape voids per src/01-constants.js SHAPE_GEOMETRIES. 1 = active, 0 = void.
  const SHAPE_GEOMETRIES = {
    heart: [
      [0,1,1,0],[1,1,1,1],[1,1,1,1],[1,1,1,1],[0,1,1,0],[0,0,1,0]
    ],
    diamond: [
      [0,1,1,0],[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,1],[0,1,1,0]
    ],
    tree: [
      [0,1,1,0],[0,1,1,0],[1,1,1,1],[1,1,1,1],[1,1,1,1],[0,1,1,0]
    ],
    pyramid: [
      [0,1,1,0],[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,1]
    ],
  };
  function isShapeVoid(shapeId, r, c) {
    if (!shapeId) return false;
    const g = SHAPE_GEOMETRIES[shapeId];
    if (!g || !g[r]) return false;
    return g[r][c] === 0;
  }

  // ============================================================
  // ADVANCED AI — multi-factor board evaluation
  // ============================================================

  const MAX_TIER = 8;

  function cloneGrid(g) {
    return g.map(r => r.slice());
  }

  function findGroupSim(g, sr, sc, tier, voidAt) {
    const ROWS = g.length, COLS = g[0].length;
    const visited = new Set();
    const group = [];
    const stack = [[sr, sc]];
    while (stack.length) {
      const [r, c] = stack.pop();
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (voidAt(r, c)) continue;
      const k = r * COLS + c;
      if (visited.has(k)) continue;
      if (g[r][c] !== tier) continue;
      visited.add(k);
      group.push([r, c]);
      stack.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
    }
    return group;
  }

  function applyGravitySim(g, voidAt, frozenAt) {
    const ROWS = g.length, COLS = g[0].length;
    for (let c = 0; c < COLS; c++) {
      let w = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        // Voids + frozen tiles are anchors — write cursor jumps above them.
        if (voidAt(r, c)) { w = r - 1; continue; }
        if (frozenAt(r, c) && g[r][c] !== 0) { w = r - 1; continue; }
        if (g[r][c] !== 0) {
          if (r !== w) { g[w][c] = g[r][c]; g[r][c] = 0; }
          w--;
        }
      }
    }
  }

  // Find the landing row of a drop in column `col`, taking voids + locked
  // cells into account. Returns -1 if the column is unplayable.
  function findLandingRow(grid, col, ctx) {
    const ROWS = grid.length;
    const shapeId = ctx.shapeId;
    const cellsByPos = ctx.cellsByPos || {};
    for (let r = ROWS - 1; r >= 0; r--) {
      if (isShapeVoid(shapeId, r, col)) {
        // hit a void from below — column ends here
        return -1;
      }
      const cell = cellsByPos[r + ',' + col];
      // Locked cell that isn't yet unlocked blocks like a wall
      if (cell && cell.type === 'locked' && !cell.unlocked) continue;
      if (grid[r][col] === 0) return r;
    }
    return -1;
  }

  function simulateDrop(grid, col, piece, ctx) {
    const ROWS = grid.length, COLS = grid[0].length;
    const cellsByPos = ctx.cellsByPos || {};
    const shapeId = ctx.shapeId;
    const voidAt = (r, c) => isShapeVoid(shapeId, r, c);
    const frozenAt = (r, c) => {
      const cell = cellsByPos[r + ',' + c];
      return !!(cell && cell.type === 'frozen');
    };
    const g = cloneGrid(grid);
    const row = findLandingRow(grid, col, ctx);
    if (row === -1) return null;

    // Frozen cell behavior: tile landing on it is inert (won't merge,
    // acts as anchor). Treat as placed but tag it to skip from groups.
    const landedOnFrozen = frozenAt(row, col);
    g[row][col] = piece;

    // Gold cell upgrade — landing on gold cell promotes by one tier.
    const landedCell = cellsByPos[row + ',' + col];
    let goldBonus = 0;
    if (landedCell && landedCell.type === 'gold' && piece < MAX_TIER) {
      g[row][col] = piece + 1;
      goldBonus = 30; // small heuristic bonus — promotion is huge
    }
    // Bonus cell — adds amount to score on merge landing.
    let bonusGain = 0;
    if (landedCell && landedCell.type === 'bonus' && typeof landedCell.amount === 'number') {
      bonusGain = landedCell.amount;
    }

    let score = 0, chains = 0, highest = g[row][col];
    if (!landedOnFrozen) {
      while (true) {
        let merged = false;
        outer: for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const t = g[r][c];
            if (t === 0 || t === MAX_TIER) continue;
            if (voidAt(r, c)) continue;
            if (frozenAt(r, c)) continue;
            const group = findGroupSim(g, r, c, t, voidAt);
            if (group.length >= 2) {
              let kr = -1, kc = -1;
              for (const [gr, gc] of group) {
                if (gr > kr) { kr = gr; kc = gc; }
                else if (gr === kr && Math.abs(gc - col) < Math.abs(kc - col)) kc = gc;
              }
              for (const [gr, gc] of group) {
                if (gr === kr && gc === kc) continue;
                g[gr][gc] = 0;
              }
              const nt = Math.min(t + 1, MAX_TIER);
              g[kr][kc] = nt;
              chains++;
              const mult = 1 + (chains - 1) * 0.5;
              // Column multiplier — applied at the survivor column.
              const colMult = (ctx.mults && ctx.mults[kc]) ? ctx.mults[kc] : 1;
              score += nt * 10 * group.length * mult * colMult;
              if (nt > highest) highest = nt;
              merged = true;
              break outer;
            }
          }
        }
        if (!merged) break;
        applyGravitySim(g, voidAt, frozenAt);
      }
    }
    return { grid: g, score: score + bonusGain + goldBonus, chains,
             highestTier: highest, landedOnFrozen };
  }

  function evaluateBoard(g, ctx) {
    const ROWS = g.length, COLS = g[0].length;
    const shapeId = ctx.shapeId;
    const heights = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (isShapeVoid(shapeId, r, c)) continue;
        if (g[r][c] !== 0) { heights[c] = ROWS - r; break; }
      }
    }
    let maxH = 0, sumH = 0, topFilled = 0;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] > maxH) maxH = heights[c];
      sumH += heights[c];
      if (g[0][c] !== 0 && !isShapeVoid(shapeId, 0, c)) topFilled++;
    }
    let roughness = 0;
    for (let c = 0; c < COLS - 1; c++) roughness += Math.abs(heights[c] - heights[c+1]);

    let tierBonus = 0, pairBonus = 0, tripleBonus = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isShapeVoid(shapeId, r, c)) continue;
        const t = g[r][c];
        if (t === 0) continue;
        if (t >= 4) tierBonus += t * 3;
        if (t >= 6) tierBonus += t * 5;
        if (c + 1 < COLS && g[r][c+1] === t) pairBonus += t * 1.5;
        if (r + 1 < ROWS && g[r+1][c] === t) pairBonus += t * 1.5;
        let nearby = 0;
        if (c > 0 && g[r][c-1] === t) nearby++;
        if (c < COLS-1 && g[r][c+1] === t) nearby++;
        if (r > 0 && g[r-1][c] === t) nearby++;
        if (r < ROWS-1 && g[r+1][c] === t) nearby++;
        if (nearby >= 2) tripleBonus += t * 3;
      }
    }
    return { heightPenalty: maxH * 7 + sumH * 1.5,
             topPenalty: topFilled * 50 + (topFilled >= 3 ? 150 : 0),
             roughness: roughness * 5, tierBonus, pairBonus, tripleBonus };
  }

  // Compute a per-column "value tier" 0..1 from the multipliers.
  // Used to bias high-tier pieces toward high-mult columns AND to penalize
  // wasting low-tier pieces in high-mult columns when other slots exist.
  function multStats(ctx, COLS) {
    if (!ctx.mults || !ctx.mults.length) return null;
    let maxM = -Infinity, minM = Infinity;
    for (let c = 0; c < COLS; c++) {
      const m = ctx.mults[c] || 1;
      if (m > maxM) maxM = m;
      if (m < minM) minM = m;
    }
    const range = maxM - minM;
    return {
      max: maxM, min: minM, range,
      valueTier: (col) => range > 0 ? (((ctx.mults[col] || 1) - minM) / range) : 0
    };
  }

  // Single-ply scoring: how good is THIS landing for THIS piece.
  function scoreLanding(grid, col, piece, ctx, ms, COLS) {
    const sim = simulateDrop(grid, col, piece, ctx);
    if (!sim) return { score: -Infinity, sim: null };
    const ev = evaluateBoard(sim.grid, ctx);

    // Base: immediate sim score includes column-multiplier scaling from
    // pointsFor-equivalent inside simulateDrop. Weight it heavily.
    let s = sim.score * 1.5;

    // CHAIN VALUATION — chains are the game's life-blood. Big chain in a
    // VIP column wins the game. Boost vs v1 by 4×.
    if (sim.chains >= 2) s += 250 * (sim.chains - 1);
    if (sim.chains >= 3) s += 600;
    if (sim.chains >= 4) s += 1500;
    if (sim.chains >= 5) s += 3500;
    // Chains in high-mult boards are even better — every chained merge
    // is multiplied. Reward them disproportionately.
    if (sim.chains >= 2 && ms) s += sim.chains * ms.max * 25;

    // TIER UPGRADE — every time a merge produces a tier the bot hasn't seen
    // before this drop, that's progress toward crown. Reward proportional
    // to the new tier reached, with extra weight for crown (8).
    if (sim.highestTier > piece) {
      const newTiers = sim.highestTier - piece;
      s += newTiers * 120;
      if (sim.highestTier === MAX_TIER) s += 5000; // crown achievement
      if (sim.highestTier >= 6) s += (sim.highestTier - 5) * 200;
    }

    // COLUMN RESERVATION — the single biggest mistake a naive bot makes
    // on a multiplier board is wasting slots in the ×6 column on tier-1
    // tiles. Strongly route high tiers to VIP columns, penalize low tiers
    // landing there when non-VIP columns have space.
    if (ms && ms.range > 0) {
      const vt = ms.valueTier(col); // 0..1
      // High piece in high-mult column: big bonus.
      if (piece >= 4) s += piece * vt * 120;
      else if (piece === 3) s += vt * 50;
      // Low piece in high-mult column: penalty (proportional to value).
      else if (piece <= 2) s -= (3 - piece) * vt * 130;
      // BONUS: this drop's survivor lands in a VIP column? Check sim.grid
      // for highest tier present in this column.
      let colMax = 0;
      for (let r = 0; r < sim.grid.length; r++) {
        if (sim.grid[r][col] > colMax) colMax = sim.grid[r][col];
      }
      if (colMax >= 5) s += colMax * vt * 30;
    }

    // Frozen-landing penalty — the tile becomes inert + wastes a slot.
    if (sim.landedOnFrozen) s -= 350;

    s -= ev.heightPenalty;
    s -= ev.topPenalty;
    s -= ev.roughness;
    s += ev.tierBonus;
    s += ev.pairBonus * 1.4; // pairs are setups for next merge — boost
    s += ev.tripleBonus * 1.8;

    // SETUP BONUS — does dropping here create an adjacent same-tier pair
    // (i.e., a merge-ready setup) in a VIP column?
    if (ms && ms.range > 0) {
      const ROWS = sim.grid.length;
      // Find landing row of THIS piece (post-merges if any).
      // Heuristic: look for the piece's tier in the column from top down.
      for (let r = 0; r < ROWS; r++) {
        if (sim.grid[r][col] === 0) continue;
        const t = sim.grid[r][col];
        if (t < 3) break;
        const vt = ms.valueTier(col);
        if (vt < 0.4) break;
        // Same-tier neighbor in this VIP column → setup
        if (r + 1 < ROWS && sim.grid[r + 1][col] === t) s += t * vt * 25;
        if (col > 0 && sim.grid[r][col - 1] === t) s += t * vt * 15;
        if (col + 1 < COLS && sim.grid[r][col + 1] === t) s += t * vt * 15;
        break;
      }
    }

    // Top-of-board awareness.
    let topEmpty = 0;
    for (let c = 0; c < COLS; c++) {
      if (isShapeVoid(ctx.shapeId, 0, c)) continue;
      if (sim.grid[0][c] === 0) topEmpty++;
    }
    if (topEmpty === 0) s -= 9000;
    else if (topEmpty === 1) s -= 450;
    else if (topEmpty === 2) s -= 80;

    return { score: s, sim };
  }

  // 2-ply lookahead: for each candidate landing, simulate the best follow-up
  // assuming the next piece is the expected average tier (default weights
  // favor tier 1-2). We only consider the BEST follow-up column, not full
  // expectation over piece distribution — fast and good enough.
  function decideMove() {
    const grid = window.BloomDebug.getGrid();
    const piece = window.BloomDebug.getCurrentPiece();
    if (!grid || !piece) return 0;
    const COLS = grid[0].length;
    const ctx = getBoardContext();
    const ms = multStats(ctx, COLS);
    // Event awareness — the live in-game event (💣 bomb / ⭐ star / 🎁 gift /
    // 🔥 fever / ❄️ freeze) triggers when a tile is dropped into its COLUMN
    // (see 14-events.js checkEventTrigger). Bias toward the valuable ones and
    // away from freezing a good tile. Read once per move.
    const evt = (window.BloomDebug.getActiveEvent && window.BloomDebug.getActiveEvent()) || null;
    // Expected next piece — tier 1 is most common under default weights;
    // tier 2 is the second-most. Score both, take the better follow-up to
    // approximate "the next move will at least be playable."
    const EXPECTED_NEXT_PIECES = [1, 2];

    let bestCol = -1, bestScore = -Infinity;
    for (let col = 0; col < COLS; col++) {
      const r = scoreLanding(grid, col, piece, ctx, ms, COLS);
      if (!r.sim) continue;
      let s = r.score;

      // 2-PLY: simulate the best follow-up move from the resulting grid.
      // Discounted by 0.55 so present > future without ignoring it.
      let bestFollowup = -Infinity;
      for (const np of EXPECTED_NEXT_PIECES) {
        for (let nc = 0; nc < COLS; nc++) {
          const fr = scoreLanding(r.sim.grid, nc, np, ctx, ms, COLS);
          if (fr.score > bestFollowup) bestFollowup = fr.score;
        }
      }
      if (bestFollowup > -Infinity) s += bestFollowup * 0.55;

      // Event bias — strongly prefer triggering a valuable event in this column.
      if (evt && evt.col === col) {
        if (evt.type === 'bomb') s += 700;         // +2000 per destroyed tile — huge
        else if (evt.type === 'fever') s += 400;   // opens a ×3 score window
        else if (evt.type === 'star') s += 280;    // +1 tier on the landed tile
        else if (evt.type === 'gift') s += 160;     // free 💎 (for a real player)
        else if (evt.type === 'freeze') s -= 12 * piece * piece; // don't freeze a good tile
      }

      s += Math.random() * 1.5;
      if (s > bestScore) { bestScore = s; bestCol = col; }
    }
    return bestCol === -1 ? 0 : bestCol;
  }

  // ============================================================
  // MODE NAVIGATION
  // ============================================================

  // Scan the user's duels and start the next playable one. Priority:
  // (1) ACCEPTED duels where my score is null (already wagered + waiting),
  // (2) PENDING duels where I'm the opponent (accept then start).
  // Settled / tied / expired / declined / submitted are skipped.
  // Returns true if a duel was kicked off, false if nothing is actionable.
  async function tryStartNextDuel() {
    try {
      const deviceId = localStorage.getItem('bloom_device_id');
      if (!deviceId) return false;
      const r = await fetch('/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      const d = await r.json();
      if (!d || !Array.isArray(d.duels) || !d.duels.length) return false;

      // Pass 1: accepted + my-score-null = ready to play
      for (const duel of d.duels) {
        if (duel.status !== 'accepted') continue;
        const isChallenger = duel.challenger_device === deviceId;
        const myScore = isChallenger ? duel.challenger_score : duel.opponent_score;
        if (myScore != null) continue;
        if (typeof window.playDuel === 'function') {
          window.playDuel(duel.id);
          await sleep(900); // give startDuelGame a beat to mount
          return true;
        }
      }
      // Pass 2: pending + I'm the opponent = needs accept
      for (const duel of d.duels) {
        if (duel.status !== 'pending') continue;
        const isChallenger = duel.challenger_device === deviceId;
        if (isChallenger) continue;
        if (typeof window.acceptDuel === 'function') {
          window.acceptDuel(duel.id);
          // acceptDuel chains into startDuelGame internally
          await sleep(1200);
          return true;
        }
      }
      return false;
    } catch (e) { return false; }
  }

  async function navigateToTargetMode() {
    if (!window.BloomDebug) return;
    const mode = bot.targetMode;
    if (mode === 'current') {
      // Play wherever the user already is — NEVER navigate or restart, so the
      // bot can be turned on while sitting on a specific board/contest/duel/
      // challenge and stays put. (The user explicitly asked for this.)
      return;
    }
    if (mode === 'auto') {
      // If we're not in a game, default to practice.
      if (!isInGame()) {
        try { window.BloomDebug.setMode('practice'); } catch (e) {}
        await sleep(400);
      }
      return;
    }
    if (mode === 'practice') {
      window.BloomDebug.setMode('practice');
      await sleep(400);
      return;
    }
    if (mode === 'daily') {
      window.BloomDebug.setMode('daily');
      await sleep(400);
      return;
    }
    if (mode === 'duel') {
      // Find an actionable duel for this device. Returns true if a duel
      // is starting; false if there's nothing to do right now (caller
      // will sleep + retry).
      const started = await tryStartNextDuel();
      bot.duelWaiting = !started;
      updateUI();
      if (started) await sleep(700);
      return;
    }
    if (mode === 'dynamic') {
      const list = window.BloomDebug.getAvailableBoards();
      if (!list.length) {
        // No dynamic board available — fall back to practice.
        window.BloomDebug.setMode('practice');
        await sleep(400);
        return;
      }
      let board = null;
      if (bot.selectedBoardId === '__rotation__') {
        // Cycle through every available board, one game per board.
        const idx = bot.rotationIndex % list.length;
        board = list[idx];
        bot.rotationIndex = (idx + 1) % list.length;
      } else if (bot.selectedBoardId) {
        board = list.find(b => String(b.id) === String(bot.selectedBoardId));
      }
      if (!board) board = list[Math.floor(Math.random() * list.length)];
      bot.currentBoardName = board.name || ('Board #' + board.id);
      window.BloomDebug.startDynamicBoard(board.id);
      await sleep(500);
      return;
    }
  }

  // After a submit-ON game, try to read this device's rank for the played mode.
  async function fetchLastRank() {
    try {
      const mode = window.BloomDebug.getMode();
      const deviceId = localStorage.getItem('bloom_device_id');
      if (!deviceId) return;
      let url = null, label = '';
      if (mode === 'daily') {
        const today = new Date().toISOString().slice(0, 10);
        url = '/api/leaderboard/' + today + '?deviceId=' + encodeURIComponent(deviceId);
        label = 'יומי';
      } else if (mode === 'dynamic' && window._activeDynamicBoard) {
        url = '/api/boards/' + window._activeDynamicBoard.id + '/leaderboard?limit=1&deviceId=' + encodeURIComponent(deviceId);
        label = 'לוח';
      }
      if (!url) return;
      const r = await fetch(url);
      const d = await r.json();
      if (typeof d.rank === 'number') {
        bot.lastRank = d.rank;
        bot.lastRankTotal = d.total | 0;
        bot.lastRankMode = label;
      }
    } catch (e) {}
  }

  // ============================================================
  // PLAY LOOP
  // ============================================================

  async function play() {
    if (bot.running) return;
    bot.running = true;
    bot.stopRequested = false;
    // When "submit to LB" is checked we DON'T set the guard flag → all the
    // game's normal submit / earn / achievement paths run. When unchecked
    // (default), guards skip them and the bot stays sandboxed.
    //
    // EXCEPTION — Duel mode always behaves like a real player. The user
    // explicitly wants the bot to play their pending duels FOR them and
    // earn the wager + trophies + achievements + season XP that come with
    // it. Sandbox mode would skip all of that and leave the duel in limbo.
    const treatAsRealPlayer = bot.submitToLB || bot.targetMode === 'duel';
    window.__bloomBotActive = !treatAsRealPlayer;
    updateUI();

    await navigateToTargetMode();

    if (window.BloomDebug && window.BloomDebug.restart && bot.targetMode === 'auto') {
      window.BloomDebug.restart();
      await sleep(400);
    }
    // 'current' mode plays whatever's already open — don't tear down home (the
    // user may not be in a game yet; the loop just waits). Other modes already
    // navigated/restarted into a game, so a stale home node is safe to remove.
    if (bot.targetMode !== 'current') {
      const homeScreen = document.getElementById('home-screen');
      if (homeScreen) homeScreen.remove();
    }

    bot.currentGameStart = Date.now();
    bot.sawCrownThisGame = false;

    while (!bot.stopRequested) {
      if (!window.BloomDebug || !window.BloomDebug.ready()) {
        await sleep(200); continue;
      }
      // Duel-mode: if we're waiting for a duel and not actively in a game,
      // re-poll every 30s instead of burning the play loop.
      if (bot.targetMode === 'duel' && bot.duelWaiting && !isInGame()) {
        await sleep(30000);
        if (bot.stopRequested) break;
        await navigateToTargetMode();
        continue;
      }
      if (!isInGame() && !window.BloomDebug.isGameOver()) {
        await sleep(300); continue;
      }
      if (window.BloomDebug.isGameOver()) {
        const score = window.BloomDebug.getScore() || 0;
        const tier = window.BloomDebug.getHighestTier() || 1;
        bot.gamesPlayed++;
        bot.totalScore += score;
        if (score > bot.bestScore) bot.bestScore = score;
        if (tier > bot.bestTier) bot.bestTier = tier;
        if (tier >= MAX_TIER || bot.sawCrownThisGame) bot.crownCount++;
        const elapsed = Date.now() - bot.currentGameStart;
        bot.totalPlaytimeMs += Math.min(elapsed, 1000 * 60 * 30);
        persistState();
        updateUI();
        if (bot.submitToLB) {
          // Give the score-submit POST a beat to land, then read back rank.
          await sleep(700);
          await fetchLastRank();
          updateUI();
        }
        if (bot.targetMode === 'duel') bot.duelGamesPlayed++;
        if (!bot.autoRestart) { bot.stopRequested = true; break; }
        await sleep(1500);
        if (bot.stopRequested) break;
        if (bot.targetMode === 'current') {
          // Replay the SAME board/mode — never jump elsewhere.
          if (window.BloomDebug.restartCurrent) window.BloomDebug.restartCurrent();
        } else {
          await navigateToTargetMode();
          if (bot.targetMode === 'auto' || bot.targetMode === 'practice') {
            window.BloomDebug.restart();
          }
        }
        await sleep(600);
        bot.currentGameStart = Date.now();
        bot.sawCrownThisGame = false;
        continue;
      }
      if (window.BloomDebug.isBusy()) { await sleep(80); continue; }

      const col = decideMove();
      window.BloomDebug.drop(col);
      if (window.BloomDebug.getHighestTier() >= MAX_TIER) bot.sawCrownThisGame = true;

      const d = SPEED_DELAYS[bot.speed];
      await sleep(d.min + Math.random() * (d.max - d.min));
    }

    bot.running = false;
    window.__bloomBotActive = false;
    updateUI();
  }

  function stop() { bot.stopRequested = true; }

  // ============================================================
  // UI — fully hideable for video recording
  // ============================================================

  let panelVisible = true;
  let dotVisible = true;

  function fmtMinutes(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function createUI() {
    const dot = document.createElement('div');
    dot.id = 'bloom-bot-dot';
    document.body.appendChild(dot);

    const panel = document.createElement('div');
    panel.id = 'bloom-bot-panel';
    panel.innerHTML = `
      <div class="bbp-header">
        <span class="bbp-title">🤖 BLOOM Bot</span>
        <span class="bbp-status" id="bbp-status">paused</span>
        <button class="bbp-minimize" id="bbp-hide" title="הסתר פאנל">—</button>
      </div>
      <div id="bbp-body">
        <div class="bbp-controls">
          <button id="bbp-toggle" class="bbp-btn-primary">▶ Start</button>
        </div>

        <div class="bbp-row">
          <label class="bbp-label">Mode</label>
          <select id="bbp-mode">
            <option value="current">📍 הלוח הנוכחי · בלי קפיצה</option>
            <option value="auto">🎮 Auto (restart practice)</option>
            <option value="practice">🎯 Practice</option>
            <option value="daily">📅 Daily Challenge</option>
            <option value="dynamic">✨ Dynamic Board</option>
            <option value="duel">⚔️ Duel</option>
          </select>
        </div>

        <div class="bbp-row" id="bbp-board-row" style="display:none">
          <label class="bbp-label">Board</label>
          <select id="bbp-board">
            <option value="">🎲 Random</option>
          </select>
          <div class="bbp-board-current" id="bbp-board-current" style="display:none"></div>
        </div>

        <div class="bbp-duel-status" id="bbp-duel-status" style="display:none"></div>

        <div class="bbp-row">
          <label class="bbp-label">Speed</label>
          <select id="bbp-speed">
            <option value="slow">🐌 Slow (video)</option>
            <option value="normal">🏃 Normal</option>
            <option value="fast">⚡ Fast</option>
            <option value="instant">🚀 Instant</option>
          </select>
        </div>

        <div class="bbp-row">
          <label class="bbp-label">
            <input type="checkbox" id="bbp-autorestart" />
            Auto-restart on game over
          </label>
        </div>

        <div class="bbp-row bbp-submit-row">
          <label class="bbp-label">
            <input type="checkbox" id="bbp-submit" />
            📊 שלח ניקוד לטבלאות
          </label>
          <div class="bbp-warn" id="bbp-warn" style="display:none">
            ⚠ ניקוד הבוט יישלח לטבלאות בשמך (יומי / לוחות דינמיים / טורנירים / season pass / הישגים). בוט פעיל בלי דגל = שחקן רגיל לשרת.
          </div>
        </div>

        <div class="bbp-stats">
          <div class="bbp-stat"><span>Games</span><b id="bbp-games">0</b></div>
          <div class="bbp-stat"><span>Best</span><b id="bbp-best">0</b></div>
          <div class="bbp-stat"><span>Average</span><b id="bbp-avg">0</b></div>
          <div class="bbp-stat"><span>Top tier</span><b id="bbp-tier">1</b></div>
          <div class="bbp-stat"><span>👑 Crowns</span><b id="bbp-crowns">0</b></div>
          <div class="bbp-stat"><span>⏱ Playtime</span><b id="bbp-playtime">0:00</b></div>
        </div>

        <div class="bbp-stats bbp-stats-lb" id="bbp-rank-row" style="display:none">
          <div class="bbp-stat bbp-stat-wide"><span id="bbp-rank-label">Last LB rank</span><b id="bbp-rank">—</b></div>
        </div>

        <div class="bbp-footer">
          <button id="bbp-reset" class="bbp-btn-link">reset stats</button>
        </div>
        <div class="bbp-hint">טיפ: הסתר פאנל לצילום וידאו נקי.<br>הקש 3 פעמים על המסך להחזיר.</div>
      </div>
    `;
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #bloom-bot-dot{position:fixed;bottom:20px;left:20px;z-index:2147483647;width:12px;height:12px;border-radius:50%;background:rgba(250,199,117,0.5);cursor:pointer;transition:opacity 0.3s,transform 0.2s;display:none}
      #bloom-bot-dot:hover{transform:scale(1.5);background:rgba(250,199,117,0.9)}
      #bloom-bot-dot.hidden{display:none!important}
      #bloom-bot-panel{position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1C1A18;color:#FFF;border-radius:14px;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;width:260px;direction:ltr;box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:transform 0.2s,opacity 0.2s;max-height:90vh;overflow-y:auto}
      #bloom-bot-panel.hidden{transform:translateY(20px);opacity:0;pointer-events:none}
      #bloom-bot-panel.submitting{box-shadow:0 8px 32px rgba(244,192,209,0.6),0 0 0 2px #F4C0D1}
      .bbp-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)}
      .bbp-title{font-weight:600;flex:1;font-size:13px}
      .bbp-status{background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em}
      .bbp-status.running{background:#9FE1CB;color:#04342C}
      .bbp-status.submitting{background:#F4C0D1;color:#7A2B3A}
      .bbp-minimize{background:transparent;border:none;color:rgba(255,255,255,0.6);font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
      .bbp-minimize:hover{color:#FFF}
      .bbp-controls{margin-bottom:10px}
      .bbp-btn-primary{width:100%;padding:10px;border:none;border-radius:8px;background:#FAC775;color:#1C1A18;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px}
      .bbp-btn-primary.running{background:#F4C0D1}
      .bbp-btn-primary:hover{opacity:0.9}
      .bbp-row{margin-bottom:10px}
      .bbp-label{display:block;font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer}
      .bbp-label input{vertical-align:middle;margin-right:4px}
      .bbp-row select{width:100%;padding:7px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFF;border:1px solid rgba(255,255,255,0.15);font-family:inherit;font-size:13px}
      .bbp-board-current{margin-top:4px;font-size:10px;color:#9FE1CB;background:rgba(159,225,203,0.1);padding:4px 6px;border-radius:5px;text-align:center;direction:rtl}
      .bbp-duel-status{margin-bottom:10px;font-size:11px;padding:8px 10px;border-radius:6px;text-align:center;direction:rtl;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.75);border:1px solid rgba(255,255,255,0.1)}
      .bbp-duel-status.waiting{background:rgba(250,199,117,0.08);color:#FAC775;border-color:rgba(250,199,117,0.25)}
      .bbp-duel-status.active{background:rgba(244,192,209,0.1);color:#F4C0D1;border-color:rgba(244,192,209,0.3);font-weight:600}
      .bbp-submit-row{background:rgba(244,192,209,0.08);padding:8px 10px;border-radius:8px;border:1px solid rgba(244,192,209,0.2)}
      .bbp-warn{margin-top:6px;font-size:10px;color:#F4C0D1;line-height:1.5;padding:6px;background:rgba(244,192,209,0.1);border-radius:6px}
      .bbp-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;border-top:1px solid rgba(255,255,255,0.1)}
      .bbp-stats-lb{border-top:none;padding-top:0}
      .bbp-stat{background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:6px}
      .bbp-stat-wide{grid-column:span 2;background:rgba(159,225,203,0.08);border:1px solid rgba(159,225,203,0.2)}
      .bbp-stat span{display:block;font-size:10px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px}
      .bbp-stat b{font-size:15px;font-weight:700;color:#FFF}
      .bbp-footer{display:flex;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1)}
      .bbp-btn-link{flex:1;background:transparent;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-family:inherit;font-size:11px;padding:4px}
      .bbp-btn-link:hover{color:#FFF}
      .bbp-hint{margin-top:8px;font-size:10px;color:rgba(255,255,255,0.3);line-height:1.5;text-align:center}
    `;
    document.head.appendChild(style);

    // Initial values
    document.getElementById('bbp-speed').value = bot.speed;
    document.getElementById('bbp-mode').value = bot.targetMode;
    document.getElementById('bbp-autorestart').checked = bot.autoRestart;
    document.getElementById('bbp-submit').checked = bot.submitToLB;
    document.getElementById('bbp-warn').style.display = bot.submitToLB ? 'block' : 'none';
    document.getElementById('bbp-board-row').style.display =
      bot.targetMode === 'dynamic' ? 'block' : 'none';
    populateBoardDropdown();

    // Wire
    document.getElementById('bbp-toggle').onclick = () => { if (bot.running) stop(); else play(); };
    document.getElementById('bbp-speed').onchange = e => { bot.speed = e.target.value; persistSettings(); };
    document.getElementById('bbp-mode').onchange = e => {
      bot.targetMode = e.target.value;
      document.getElementById('bbp-board-row').style.display =
        bot.targetMode === 'dynamic' ? 'block' : 'none';
      if (bot.targetMode === 'dynamic') populateBoardDropdown();
      // Duel mode must always act as a real player — flip the guard live
      // if the bot is running so a mid-session mode switch takes effect.
      if (bot.running) {
        const treatAsReal = bot.submitToLB || bot.targetMode === 'duel';
        window.__bloomBotActive = !treatAsReal;
      }
      bot.duelWaiting = false;
      updateUI();
      persistSettings();
    };
    document.getElementById('bbp-board').onchange = e => {
      bot.selectedBoardId = e.target.value || null;
      persistSettings();
    };
    document.getElementById('bbp-autorestart').onchange = e => { bot.autoRestart = e.target.checked; persistSettings(); };
    document.getElementById('bbp-submit').onchange = e => {
      bot.submitToLB = e.target.checked;
      document.getElementById('bbp-warn').style.display = bot.submitToLB ? 'block' : 'none';
      // If the bot is currently running, flip the guard live (duel mode
      // overrides — it always acts as a real player).
      if (bot.running) {
        const treatAsReal = bot.submitToLB || bot.targetMode === 'duel';
        window.__bloomBotActive = !treatAsReal;
      }
      updateUI();
      persistSettings();
    };
    document.getElementById('bbp-reset').onclick = () => {
      bot.gamesPlayed = 0; bot.totalScore = 0; bot.bestScore = 0;
      bot.bestTier = 0; bot.crownCount = 0; bot.totalPlaytimeMs = 0;
      bot.lastRank = null; bot.lastRankTotal = null; bot.lastRankMode = null;
      persistState();
      updateUI();
    };

    document.getElementById('bbp-hide').onclick = () => {
      panel.classList.add('hidden');
      panelVisible = false;
      if (dotVisible) dot.style.display = 'block';
    };
    dot.onclick = () => {
      panel.classList.remove('hidden');
      panelVisible = true;
      dot.style.display = 'none';
    };
    let longPressTimer = null;
    dot.addEventListener('pointerdown', () => {
      longPressTimer = setTimeout(() => {
        dot.classList.add('hidden');
        dotVisible = false;
      }, 800);
    });
    dot.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    dot.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

    let tapCount = 0, tapTimer = null;
    document.addEventListener('pointerdown', () => {
      if (panelVisible) return;
      tapCount++;
      if (tapCount >= 3) {
        tapCount = 0;
        panel.classList.remove('hidden');
        panelVisible = true;
        dot.style.display = 'none';
        dot.classList.remove('hidden');
        dotVisible = true;
      }
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 600);
    }, true);

    // Refresh available boards periodically (admin can add/remove).
    setInterval(populateBoardDropdown, 30000);
  }

  function populateBoardDropdown() {
    const sel = document.getElementById('bbp-board');
    if (!sel) return;
    let boards = [];
    try { boards = window.BloomDebug ? window.BloomDebug.getAvailableBoards() : []; } catch (e) {}
    const prev = bot.selectedBoardId || '';
    const rotLabel = '🔄 כל הלוחות בסבב (' + boards.length + ')';
    sel.innerHTML = '<option value="">🎲 Random</option>' +
      '<option value="__rotation__">' + rotLabel + '</option>' +
      boards.map(b => `<option value="${b.id}">${(b.name || ('Board #' + b.id)).slice(0, 36)}</option>`).join('');
    if (prev === '__rotation__') sel.value = '__rotation__';
    else if (prev && boards.find(b => String(b.id) === String(prev))) sel.value = prev;
  }

  function updateUI() {
    const status = document.getElementById('bbp-status');
    const toggle = document.getElementById('bbp-toggle');
    const panel = document.getElementById('bloom-bot-panel');
    if (status) {
      let txt = bot.running ? 'playing' : 'paused';
      let cls = 'bbp-status' + (bot.running ? ' running' : '');
      if (bot.running && bot.submitToLB) { txt = 'submitting'; cls += ' submitting'; }
      status.textContent = txt;
      status.className = cls;
    }
    if (toggle) {
      toggle.textContent = bot.running ? '⏸ Stop' : '▶ Start';
      toggle.className = 'bbp-btn-primary' + (bot.running ? ' running' : '');
    }
    if (panel) panel.classList.toggle('submitting', bot.running && bot.submitToLB);
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('bbp-games', bot.gamesPlayed);
    setText('bbp-best', bot.bestScore.toLocaleString());
    setText('bbp-avg', bot.gamesPlayed ? Math.round(bot.totalScore / bot.gamesPlayed).toLocaleString() : 0);
    setText('bbp-tier', bot.bestTier);
    setText('bbp-crowns', bot.crownCount);
    setText('bbp-playtime', fmtMinutes(bot.totalPlaytimeMs));
    const rankRow = document.getElementById('bbp-rank-row');
    if (rankRow) {
      if (bot.lastRank != null) {
        rankRow.style.display = 'grid';
        setText('bbp-rank-label', 'Last LB rank · ' + (bot.lastRankMode || ''));
        const t = bot.lastRankTotal ? ' / ' + bot.lastRankTotal : '';
        setText('bbp-rank', '#' + bot.lastRank + t);
      } else {
        rankRow.style.display = 'none';
      }
    }
    // Duel-mode status pill.
    const duelStatus = document.getElementById('bbp-duel-status');
    if (duelStatus) {
      if (bot.targetMode === 'duel') {
        duelStatus.style.display = 'block';
        if (bot.duelWaiting) {
          duelStatus.className = 'bbp-duel-status waiting';
          duelStatus.textContent = '⏳ ממתין לדו-קרב... (סריקה כל 30ש)';
        } else if (window._duelMode && window._duelOpponentName) {
          duelStatus.className = 'bbp-duel-status active';
          duelStatus.textContent = '⚔️ דו-קרב פעיל · vs ' + window._duelOpponentName +
            (bot.duelGamesPlayed > 0 ? '  ·  שיחקתי ' + bot.duelGamesPlayed : '');
        } else {
          duelStatus.className = 'bbp-duel-status';
          duelStatus.textContent = '⚔️ Duel mode · שיחקתי ' + bot.duelGamesPlayed + ' דו-קרבות';
        }
      } else {
        duelStatus.style.display = 'none';
      }
    }
    // Show currently-playing board name + rotation cursor when in dynamic mode.
    const cur = document.getElementById('bbp-board-current');
    if (cur) {
      if (bot.targetMode === 'dynamic' && bot.currentBoardName) {
        let txt = '▶ ' + bot.currentBoardName;
        if (bot.selectedBoardId === '__rotation__') {
          try {
            const total = window.BloomDebug.getAvailableBoards().length;
            // rotationIndex was incremented to point at NEXT; the one playing is index-1.
            const idx = ((bot.rotationIndex - 1) + total) % total;
            txt = '▶ ' + bot.currentBoardName + ' (' + (idx + 1) + '/' + total + ')';
          } catch (e) {}
        }
        cur.textContent = txt;
        cur.style.display = 'block';
      } else {
        cur.style.display = 'none';
      }
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    await waitForGame();
    createUI();
    updateUI();
  }

  window.BloomBot = { start: play, stop, state: () => ({ ...bot }), decideMove };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
