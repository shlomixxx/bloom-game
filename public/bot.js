(function() {
  'use strict';

  // ============================================================
  // BLOOM Auto-Play Bot — Premium Edition
  // ?bot=1 or ?botui — panel with full controls
  // Panel can be fully hidden for clean video recording.
  // Bot NEVER affects stats, leaderboards, or graphs.
  // ============================================================

  const params = new URLSearchParams(window.location.search);
  if (!params.has('bot') && !params.has('botui')) return;

  // Signal to the game: skip stats, heartbeat, best-score when bot is active
  window.__bloomBotActive = false;

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
  // ADVANCED AI — multi-factor board evaluation
  // ============================================================

  const MAX_TIER = 8;

  function cloneGrid(g) {
    return g.map(r => r.slice());
  }

  function findGroupSim(g, sr, sc, tier) {
    const ROWS = g.length, COLS = g[0].length;
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

  function simulateDrop(grid, col, piece) {
    const ROWS = grid.length, COLS = grid[0].length;
    const g = cloneGrid(grid);
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][col] === 0) { row = r; break; }
    }
    if (row === -1) return null;
    g[row][col] = piece;

    let score = 0, chains = 0, highest = piece;
    while (true) {
      let merged = false;
      outer: for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = g[r][c];
          if (t === 0 || t === MAX_TIER) continue;
          const group = findGroupSim(g, r, c, t);
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
    return { grid: g, score, chains, highestTier: highest };
  }

  function evaluateBoard(g) {
    const ROWS = g.length, COLS = g[0].length;
    const heights = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (g[r][c] !== 0) { heights[c] = ROWS - r; break; }
      }
    }
    let maxH = 0, sumH = 0, topFilled = 0;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] > maxH) maxH = heights[c];
      sumH += heights[c];
      if (g[0][c] !== 0) topFilled++;
    }
    let roughness = 0;
    for (let c = 0; c < COLS - 1; c++) roughness += Math.abs(heights[c] - heights[c+1]);

    let tierBonus = 0, pairBonus = 0, tripleBonus = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = g[r][c];
        if (t === 0) continue;
        if (t >= 4) tierBonus += t * 3;
        if (t >= 6) tierBonus += t * 5; // extra reward for high tiers
        // Adjacent same-tier pairs
        if (c + 1 < COLS && g[r][c+1] === t) pairBonus += t * 1.5;
        if (r + 1 < ROWS && g[r+1][c] === t) pairBonus += t * 1.5;
        // Triple potential (3 of same tier nearby)
        let nearby = 0;
        if (c > 0 && g[r][c-1] === t) nearby++;
        if (c < COLS-1 && g[r][c+1] === t) nearby++;
        if (r > 0 && g[r-1][c] === t) nearby++;
        if (r < ROWS-1 && g[r+1][c] === t) nearby++;
        if (nearby >= 2) tripleBonus += t * 3;
      }
    }
    return { heightPenalty: maxH * 7 + sumH * 1.5, topPenalty: topFilled * 50 + (topFilled >= 3 ? 150 : 0),
      roughness: roughness * 5, tierBonus, pairBonus, tripleBonus };
  }

  function decideMove() {
    const grid = window.BloomDebug.getGrid();
    const piece = window.BloomDebug.getCurrentPiece();
    if (!grid || !piece) return 0;
    const COLS = grid[0].length;

    let bestCol = -1, bestScore = -Infinity;
    for (let col = 0; col < COLS; col++) {
      const sim = simulateDrop(grid, col, piece);
      if (!sim) continue;
      const ev = evaluateBoard(sim.grid);

      let s = sim.score * 1.2; // value immediate points
      if (sim.chains >= 2) s += 100 * (sim.chains - 1);
      if (sim.chains >= 3) s += 250;
      if (sim.chains >= 4) s += 500;
      if (sim.highestTier > piece) s += (sim.highestTier - piece) * 80;

      s -= ev.heightPenalty;
      s -= ev.topPenalty;
      s -= ev.roughness;
      s += ev.tierBonus;
      s += ev.pairBonus;
      s += ev.tripleBonus;

      let topEmpty = 0;
      for (let c = 0; c < COLS; c++) if (sim.grid[0][c] === 0) topEmpty++;
      if (topEmpty === 0) s -= 8000;
      else if (topEmpty === 1) s -= 300;

      s += Math.random() * 2;
      if (s > bestScore) { bestScore = s; bestCol = col; }
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
    window.__bloomBotActive = true;
    updateUI();

    if (window.BloomDebug && window.BloomDebug.restart) {
      window.BloomDebug.restart();
      await sleep(400);
    }
    const homeScreen = document.getElementById('home-screen');
    if (homeScreen) homeScreen.remove();

    while (!bot.stopRequested) {
      if (!window.BloomDebug || !window.BloomDebug.ready()) {
        await sleep(200); continue;
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
        updateUI();
        if (!bot.autoRestart) { bot.stopRequested = true; break; }
        await sleep(1500);
        if (bot.stopRequested) break;
        window.BloomDebug.restart();
        await sleep(600);
        continue;
      }
      if (window.BloomDebug.isBusy()) { await sleep(80); continue; }

      const col = decideMove();
      window.BloomDebug.drop(col);

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

  function createUI() {
    // Floating dot (visible when panel is hidden)
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
          <label class="bbp-label">Speed</label>
          <select id="bbp-speed">
            <option value="slow">🐌 Slow (video)</option>
            <option value="normal" selected>🏃 Normal</option>
            <option value="fast">⚡ Fast</option>
            <option value="instant">🚀 Instant</option>
          </select>
        </div>
        <div class="bbp-row">
          <label class="bbp-label">
            <input type="checkbox" id="bbp-autorestart" checked />
            Auto-restart on game over
          </label>
        </div>
        <div class="bbp-stats">
          <div class="bbp-stat"><span>Games</span><b id="bbp-games">0</b></div>
          <div class="bbp-stat"><span>Best</span><b id="bbp-best">0</b></div>
          <div class="bbp-stat"><span>Average</span><b id="bbp-avg">0</b></div>
          <div class="bbp-stat"><span>Top tier</span><b id="bbp-tier">1</b></div>
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
      #bloom-bot-panel{position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1C1A18;color:#FFF;border-radius:14px;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;width:240px;direction:ltr;box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:transform 0.2s,opacity 0.2s}
      #bloom-bot-panel.hidden{transform:translateY(20px);opacity:0;pointer-events:none}
      .bbp-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)}
      .bbp-title{font-weight:600;flex:1;font-size:13px}
      .bbp-status{background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em}
      .bbp-status.running{background:#9FE1CB;color:#04342C}
      .bbp-minimize{background:transparent;border:none;color:rgba(255,255,255,0.6);font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
      .bbp-minimize:hover{color:#FFF}
      .bbp-controls{margin-bottom:10px}
      .bbp-btn-primary{width:100%;padding:10px;border:none;border-radius:8px;background:#FAC775;color:#1C1A18;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px}
      .bbp-btn-primary.running{background:#F4C0D1}
      .bbp-btn-primary:hover{opacity:0.9}
      .bbp-row{margin-bottom:10px}
      .bbp-label{display:block;font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer}
      .bbp-label input{vertical-align:middle;margin-right:4px}
      #bbp-speed{width:100%;padding:7px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFF;border:1px solid rgba(255,255,255,0.15);font-family:inherit;font-size:13px}
      .bbp-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;border-top:1px solid rgba(255,255,255,0.1)}
      .bbp-stat{background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:6px}
      .bbp-stat span{display:block;font-size:10px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px}
      .bbp-stat b{font-size:15px;font-weight:700;color:#FFF}
      .bbp-footer{display:flex;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1)}
      .bbp-btn-link{flex:1;background:transparent;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-family:inherit;font-size:11px;padding:4px}
      .bbp-btn-link:hover{color:#FFF}
      .bbp-hint{margin-top:8px;font-size:10px;color:rgba(255,255,255,0.3);line-height:1.5;text-align:center}
    `;
    document.head.appendChild(style);

    // Wire buttons
    document.getElementById('bbp-toggle').onclick = () => { if (bot.running) stop(); else play(); };
    document.getElementById('bbp-speed').onchange = e => bot.speed = e.target.value;
    document.getElementById('bbp-autorestart').onchange = e => bot.autoRestart = e.target.checked;
    document.getElementById('bbp-reset').onclick = () => {
      bot.gamesPlayed = 0; bot.totalScore = 0; bot.bestScore = 0; bot.bestTier = 0;
      updateUI();
    };

    // Hide panel → show dot
    document.getElementById('bbp-hide').onclick = () => {
      panel.classList.add('hidden');
      panelVisible = false;
      if (dotVisible) dot.style.display = 'block';
    };

    // Tap dot → show panel
    dot.onclick = () => {
      panel.classList.remove('hidden');
      panelVisible = true;
      dot.style.display = 'none';
    };

    // Long-press dot → hide dot too (fully clean screen)
    let longPressTimer = null;
    dot.addEventListener('pointerdown', () => {
      longPressTimer = setTimeout(() => {
        dot.classList.add('hidden');
        dotVisible = false;
      }, 800);
    });
    dot.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    dot.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

    // Triple-tap anywhere → restore panel (emergency)
    let tapCount = 0, tapTimer = null;
    document.addEventListener('pointerdown', (e) => {
      if (panelVisible) return; // panel already visible
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
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
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
  }

  window.BloomBot = { start: play, stop, state: () => ({ ...bot }), decideMove };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
