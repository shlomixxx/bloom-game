(function() {
  'use strict';

  // ============================================================
  // BLOOM Auto-Play Bot
  // Activate via: ?bot=1 in URL
  // Or manually:  window.BloomBot.start()
  // ============================================================

  const params = new URLSearchParams(window.location.search);
  const autoStart = params.get('bot') === '1';
  if (!autoStart && !params.get('botui')) return;

  const SPEED_DELAYS = {
    slow:    { min: 800, max: 1500 },
    normal:  { min: 350, max: 700 },
    fast:    { min: 120, max: 250 },
    instant: { min: 30,  max: 80 },
  };

  const bot = {
    running: false,
    speed: 'normal',
    gamesPlayed: 0,
    totalScore: 0,
    bestScore: 0,
    bestTier: 0,
    stopRequested: false,
    autoRestart: true,
  };

  // ============================================================
  // WAIT FOR GAME API
  // ============================================================

  function waitForGame() {
    return new Promise(resolve => {
      const check = () => {
        if (window.BloomDebug && window.BloomDebug.ready()) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // DECISION ALGORITHM — full chain simulation per candidate move
  // ============================================================

  const MAX_TIER = 8;

  function cloneGrid(g) {
    const out = new Array(g.length);
    for (let i = 0; i < g.length; i++) out[i] = g[i].slice();
    return out;
  }

  function findGroupSim(g, sr, sc, tier) {
    const ROWS = g.length, COLS = g[0].length;
    const visited = new Set();
    const group = [];
    const stack = [[sr, sc]];
    while (stack.length) {
      const pos = stack.pop();
      const r = pos[0], c = pos[1];
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const k = r * COLS + c;
      if (visited.has(k)) continue;
      if (g[r][c] !== tier) continue;
      visited.add(k);
      group.push([r, c]);
      stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
    return group;
  }

  function applyGravitySim(g) {
    const ROWS = g.length, COLS = g[0].length;
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

  // Simulate dropping `piece` into column `col` and running the full chain.
  // Returns { grid, score, chains, highestTier } or null if column is full.
  function simulateDrop(grid, col, piece) {
    const ROWS = grid.length, COLS = grid[0].length;
    const g = cloneGrid(grid);
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][col] === 0) { row = r; break; }
    }
    if (row === -1) return null;
    g[row][col] = piece;

    let score = 0;
    let chains = 0;
    let highest = piece;

    while (true) {
      let merged = false;
      outer: for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = g[r][c];
          if (t === 0 || t === MAX_TIER) continue;
          const group = findGroupSim(g, r, c, t);
          if (group.length >= 2) {
            let kr = -1, kc = -1;
            for (let i = 0; i < group.length; i++) {
              const gr = group[i][0], gc = group[i][1];
              if (gr > kr || (gr === kr && gc < kc)) { kr = gr; kc = gc; }
            }
            for (let i = 0; i < group.length; i++) {
              const gr = group[i][0], gc = group[i][1];
              if (gr === kr && gc === kc) continue;
              g[gr][gc] = 0;
            }
            const nt = Math.min(t + 1, MAX_TIER);
            g[kr][kc] = nt;
            chains++;
            const mult = 1 + (chains - 1) * 0.5;
            score += nt * 10 * group.length * mult;
            if (nt > highest) highest = nt;
            merged = true;
            break outer;
          }
        }
      }
      if (!merged) break;
      applyGravitySim(g);
    }

    return { grid: g, score: score, chains: chains, highestTier: highest };
  }

  function columnHeights(g) {
    const ROWS = g.length, COLS = g[0].length;
    const h = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (g[r][c] !== 0) { h[c] = ROWS - r; break; }
      }
    }
    return h;
  }

  function evaluateBoard(g) {
    const ROWS = g.length, COLS = g[0].length;
    const heights = columnHeights(g);
    let maxH = 0, sumH = 0, topFilled = 0;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] > maxH) maxH = heights[c];
      sumH += heights[c];
      if (g[0][c] !== 0) topFilled++;
    }
    let roughness = 0;
    for (let c = 0; c < COLS - 1; c++) roughness += Math.abs(heights[c] - heights[c + 1]);

    // Bonus: presence of high-tier pieces (preserves merge ladder)
    let tierBonus = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = g[r][c];
        if (t >= 4) tierBonus += t * 2;
      }
    }

    // Bonus: pieces that could merge with the *next* drop (any tier with a same-tier neighbor)
    let pairBonus = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = g[r][c];
        if (t === 0) continue;
        if (c + 1 < COLS && g[r][c + 1] === t) pairBonus += t;
        if (r + 1 < ROWS && g[r + 1][c] === t) pairBonus += t;
      }
    }

    return {
      heightPenalty: maxH * 6 + sumH * 1.2,
      topPenalty: topFilled * 40 + (topFilled >= 3 ? 120 : 0),
      roughness: roughness * 4,
      tierBonus: tierBonus,
      pairBonus: pairBonus * 1.5,
    };
  }

  function decideMove() {
    const grid = window.BloomDebug.getGrid();
    const piece = window.BloomDebug.getCurrentPiece();
    if (!grid || !piece) return 0;
    const COLS = grid[0].length;

    let bestCol = -1;
    let bestScore = -Infinity;

    for (let col = 0; col < COLS; col++) {
      const sim = simulateDrop(grid, col, piece);
      if (!sim) continue;

      const ev = evaluateBoard(sim.grid);

      // Primary signal: actual chain points from this move
      let s = sim.score * 1.0;

      // Reward chain length explicitly (multiplier ladder pays off)
      if (sim.chains >= 2) s += 80 * (sim.chains - 1);
      if (sim.chains >= 3) s += 200;
      if (sim.chains >= 4) s += 400;

      // Reward raising the highest tier (long-term progress)
      if (sim.highestTier > piece) s += (sim.highestTier - piece) * 60;

      // Board quality after the move
      s -= ev.heightPenalty;
      s -= ev.topPenalty;
      s -= ev.roughness;
      s += ev.tierBonus;
      s += ev.pairBonus;

      // Hard penalty if move leaves top row completely full (next drop = game over)
      let topEmpty = 0;
      for (let c = 0; c < COLS; c++) if (sim.grid[0][c] === 0) topEmpty++;
      if (topEmpty === 0) s -= 5000;
      else if (topEmpty === 1) s -= 200;

      // Tiny tie-breaker
      s += Math.random() * 2;

      if (s > bestScore) {
        bestScore = s;
        bestCol = col;
      }
    }

    return bestCol === -1 ? 0 : bestCol;
  }

  // ============================================================
  // PLAY LOOP
  // ============================================================

  async function play() {
    if (bot.running) return;
    bot.running = true;
    bot.stopRequested = false;
    updateUI();

    while (!bot.stopRequested) {
      if (!window.BloomDebug || !window.BloomDebug.ready()) {
        await sleep(200);
        continue;
      }

      // Game-over check must come first — after a final drop the game leaves
      // `busy = true` permanently, so checking isBusy first would block forever.
      if (window.BloomDebug.isGameOver()) {
        const score = window.BloomDebug.getScore() || 0;
        const tier = window.BloomDebug.getHighestTier() || 1;
        bot.gamesPlayed++;
        bot.totalScore += score;
        if (score > bot.bestScore) bot.bestScore = score;
        if (tier > bot.bestTier) bot.bestTier = tier;
        updateUI();

        if (!bot.autoRestart) {
          bot.stopRequested = true;
          break;
        }

        await sleep(1500);
        if (bot.stopRequested) break;
        window.BloomDebug.restart();
        await sleep(600);
        continue;
      }

      if (window.BloomDebug.isBusy()) {
        await sleep(80);
        continue;
      }

      const col = decideMove();
      window.BloomDebug.drop(col);

      const d = SPEED_DELAYS[bot.speed];
      const delay = d.min + Math.random() * (d.max - d.min);
      await sleep(delay);
    }

    bot.running = false;
    updateUI();
  }

  function stop() {
    bot.stopRequested = true;
  }

  // ============================================================
  // UI PANEL
  // ============================================================

  function createUI() {
    const panel = document.createElement('div');
    panel.id = 'bloom-bot-panel';
    panel.innerHTML = `
      <div class="bbp-header">
        <span class="bbp-title">BLOOM Bot</span>
        <span class="bbp-status" id="bbp-status">paused</span>
        <button class="bbp-close" id="bbp-close" aria-label="close">×</button>
      </div>
      <div class="bbp-controls">
        <button id="bbp-toggle" class="bbp-btn-primary">▶ Start</button>
      </div>
      <div class="bbp-row">
        <label class="bbp-label">Speed</label>
        <select id="bbp-speed">
          <option value="slow">Slow (great for video)</option>
          <option value="normal" selected>Normal</option>
          <option value="fast">Fast</option>
          <option value="instant">Instant (testing)</option>
        </select>
      </div>
      <div class="bbp-row">
        <label class="bbp-label">
          <input type="checkbox" id="bbp-autorestart" checked />
          Auto-restart after game over
        </label>
      </div>
      <div class="bbp-stats">
        <div class="bbp-stat"><span>Games</span><b id="bbp-games">0</b></div>
        <div class="bbp-stat"><span>Best</span><b id="bbp-best">0</b></div>
        <div class="bbp-stat"><span>Average</span><b id="bbp-avg">0</b></div>
        <div class="bbp-stat"><span>Highest tier</span><b id="bbp-tier">1</b></div>
      </div>
      <div class="bbp-footer">
        <button id="bbp-reset" class="bbp-btn-link">reset stats</button>
        <button id="bbp-collapse" class="bbp-btn-link">collapse</button>
      </div>
    `;
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #bloom-bot-panel {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 2147483647;
        background: #1C1A18;
        color: #FFFFFF;
        border-radius: 14px;
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        width: 240px;
        direction: ltr;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        transition: transform 0.2s;
      }
      #bloom-bot-panel.collapsed {
        width: auto;
        padding: 8px 12px;
      }
      #bloom-bot-panel.collapsed > *:not(.bbp-header) { display: none; }
      .bbp-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      #bloom-bot-panel.collapsed .bbp-header {
        margin: 0; padding: 0; border: none;
      }
      .bbp-title { font-weight: 600; flex: 1; font-size: 13px; }
      .bbp-status {
        background: rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.85);
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .bbp-status.running {
        background: #9FE1CB;
        color: #04342C;
      }
      .bbp-close {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.6);
        font-size: 20px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      }
      .bbp-close:hover { color: #FFFFFF; }
      .bbp-controls { margin-bottom: 10px; }
      .bbp-btn-primary {
        width: 100%;
        padding: 9px;
        border: none;
        border-radius: 8px;
        background: #FAC775;
        color: #1C1A18;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
      }
      .bbp-btn-primary.running {
        background: #F4C0D1;
      }
      .bbp-btn-primary:hover { opacity: 0.9; }
      .bbp-row {
        margin-bottom: 10px;
      }
      .bbp-label {
        display: block;
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
      }
      .bbp-label input { vertical-align: middle; margin-right: 4px; }
      #bbp-speed {
        width: 100%;
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,0.08);
        color: #FFFFFF;
        border: 1px solid rgba(255,255,255,0.15);
        font-family: inherit;
        font-size: 12px;
      }
      .bbp-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        padding: 8px 0;
        border-top: 1px solid rgba(255,255,255,0.1);
      }
      .bbp-stat {
        background: rgba(255,255,255,0.05);
        padding: 6px 8px;
        border-radius: 6px;
      }
      .bbp-stat span {
        display: block;
        font-size: 10px;
        color: rgba(255,255,255,0.55);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }
      .bbp-stat b {
        font-size: 14px;
        font-weight: 600;
        color: #FFFFFF;
      }
      .bbp-footer {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }
      .bbp-btn-link {
        flex: 1;
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.5);
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        padding: 4px;
        text-transform: lowercase;
      }
      .bbp-btn-link:hover { color: #FFFFFF; }
    `;
    document.head.appendChild(style);

    document.getElementById('bbp-toggle').onclick = () => {
      if (bot.running) stop();
      else play();
    };
    document.getElementById('bbp-speed').onchange = e => bot.speed = e.target.value;
    document.getElementById('bbp-autorestart').onchange = e => bot.autoRestart = e.target.checked;
    document.getElementById('bbp-close').onclick = () => panel.remove();
    document.getElementById('bbp-collapse').onclick = () => panel.classList.toggle('collapsed');
    document.getElementById('bbp-reset').onclick = () => {
      bot.gamesPlayed = 0;
      bot.totalScore = 0;
      bot.bestScore = 0;
      bot.bestTier = 0;
      updateUI();
    };
  }

  function updateUI() {
    const status = document.getElementById('bbp-status');
    const toggle = document.getElementById('bbp-toggle');
    if (status) {
      status.textContent = bot.running ? 'playing' : 'paused';
      status.className = 'bbp-status' + (bot.running ? ' running' : '');
    }
    if (toggle) {
      toggle.textContent = bot.running ? '⏸ Stop' : '▶ Start';
      toggle.className = 'bbp-btn-primary' + (bot.running ? ' running' : '');
    }
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setText('bbp-games', bot.gamesPlayed);
    setText('bbp-best', bot.bestScore.toLocaleString());
    setText('bbp-avg', bot.gamesPlayed ? Math.round(bot.totalScore / bot.gamesPlayed).toLocaleString() : 0);
    setText('bbp-tier', bot.bestTier);
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    await waitForGame();
    createUI();
    if (autoStart) {
      setTimeout(() => play(), 1200);
    }
  }

  window.BloomBot = {
    start: play,
    stop: stop,
    state: () => ({ ...bot }),
    decideMove: decideMove,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
