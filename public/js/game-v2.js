/* ============================================================
   BLOOM Game v2 — gameplay module (A/B variant, 2026-06)
   ============================================================
   Modularized from bloom-demo.html. The whole engine is wrapped in
   `export function start(root)`; the variant loader in index.html calls
   start(#bloom-v2-root) ONLY when a player is assigned variant 'v2'. It is
   fully isolated from classic:
     • every DOM lookup is scoped to `root` (root.querySelector), so even the
       id collisions with classic (#score/#best/#streak) can't bind to the
       wrong element — and classic's .app is hidden + its app.js never loads.
     • the only backend touchpoint is endGame() → the EXISTING
       /api/score/practice endpoint, tagged difficulty:'v2' so v2 scores are
       stored under their own isolated leaderboard label.
   The TEST HOOKS block from the demo is intentionally removed. */
"use strict";

export function start(root) {
  if (!root) return;

  // ---- markup (the demo's #app inner content) ----
  root.innerHTML =
    '<div class="top">' +
      '<div class="v2-brand">BLOOM <span class="v2-brand-tag">חדש</span></div>' +
      '<div class="icons">' +
        '<button class="iconbtn" id="v2-fb-btn" type="button" title="משוב" aria-label="שלח משוב">💬</button>' +
        '<button class="iconbtn" id="btnRestart" type="button" title="התחל מחדש" aria-label="התחל מחדש">↻</button>' +
        '<button class="iconbtn" id="btnSound" type="button" title="סאונד" aria-label="הפעל/השתק סאונד">🔊</button>' +
      '</div>' +
    '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="lab">חנות 💎</div><div class="val" id="coins">0</div></div>' +
      '<div class="stat streak"><div class="lab">רצף</div><div class="val">🔥 <span id="streak">0</span></div></div>' +
      '<div class="stat"><div class="lab">שיא</div><div class="val" id="best">0</div></div>' +
      '<div class="stat score"><div class="lab">ניקוד</div><div class="val" id="score">0</div></div>' +
    '</div>' +
    '<div class="legendwrap"><div class="legend" id="legend"></div></div>' +
    '<div class="launch">' +
      '<div class="slot"><div class="lab">החזקה</div><div class="holdbox" id="holdbox"></div></div>' +
      '<div class="slot"><div class="current" id="current"></div></div>' +
      '<div class="slot"><div class="lab">הבא</div><div class="nextbox" id="nextbox"></div></div>' +
    '</div>' +
    '<div class="hint">גרור או הקש על עמודה כדי להפיל · הקש על "החזקה" כדי להחליף אריח</div>' +
    '<div id="boardwrap">' +
      '<div id="board">' +
        '<div id="tiles"></div>' +
        '<div id="ghostlayer"><div class="colhi" id="colhi"></div><div class="ghost" id="ghost"></div></div>' +
        '<div id="fx"></div>' +
      '</div>' +
      '<div id="callout"><span class="word" id="word"></span></div>' +
      '<div id="over"><h2>נגמר המשחק</h2><p>ניקוד: <span id="finalScore">0</span></p><button id="btnAgain">שחק שוב</button></div>' +
    '</div>';

  /* ============ CONFIG ============ */
  const COLS = 4, ROWS = 7, GAP = 8, PAD = 9;
  const TIERS = [null,
    { bg: '#D9D7D1', fg: '#74726B', val: 20, icon: 'circle' },
    { bg: '#C4E1A1', fg: '#5C8C39', val: 52, icon: 'leaf' },
    { bg: '#F1C2D6', fg: '#C2487E', val: 96, icon: 'flower' },
    { bg: '#F5C7B4', fg: '#E0613A', val: 152, icon: 'flame' },
    { bg: '#F3CB6E', fg: '#B27F12', val: 220, icon: 'bolt' },
    { bg: '#A6D6C4', fg: '#2E8C72', val: 300, icon: 'star' },
    { bg: '#A6CBEC', fg: '#2E6FB0', val: 392, icon: 'gem' },
    { bg: '#C4B6EA', fg: '#6A4FB0', val: 496, icon: 'crown' }];
  const VAL = TIERS.map(t => t ? t.val : 0);
  const WORDS = { 2: 'יפה!', 3: 'מגניב!', 4: 'מעולה!', 5: 'מדהים!', 6: 'BLOOM!' };

  /* ============ ICONS ============ */
  function svg(n, c) {
    const p = {
      circle: `<circle cx="12" cy="12" r="7" fill="none" stroke="${c}" stroke-width="3"/>`,
      leaf: `<path d="M5 19C5 10 12 5 19 5C19 14 12 19 5 19Z" fill="${c}"/><path d="M7 17C10 13 14 9 17 7" stroke="rgba(255,255,255,.55)" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
      flower: `<g fill="${c}"><circle cx="12" cy="6" r="3.6"/><circle cx="12" cy="18" r="3.6"/><circle cx="6" cy="12" r="3.6"/><circle cx="18" cy="12" r="3.6"/></g><circle cx="12" cy="12" r="3.3" fill="#fff" opacity=".6"/>`,
      flame: `<path d="M12 2C12 2 6 7 6 14a6 6 0 0 0 12 0c0-3.2-2-4.5-2-6.5-1 1.2-2.2 1.8-3 1.5C13.2 6 12 4 12 2Z" fill="${c}"/>`,
      bolt: `<path d="M13 2 L5 13 H11 L10 22 L19 9 H12 Z" fill="${c}"/>`,
      star: `<path d="M12 3 L14.6 9.2 L21 9.7 L16 14 L17.6 20.3 L12 16.8 L6.4 20.3 L8 14 L3 9.7 L9.4 9.2 Z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`,
      gem: `<path d="M12 3 L20 9 L12 21 L4 9 Z" fill="${c}"/><path d="M4 9 H20" stroke="rgba(255,255,255,.45)" stroke-width="1" fill="none"/>`,
      crown: `<path d="M3 18 L4 8 L9 12.5 L12 5 L15 12.5 L20 8 L21 18 Z" fill="${c}"/><rect x="3" y="18" width="18" height="2.4" rx="1" fill="${c}"/>`
    };
    return `<svg viewBox="0 0 24 24">${p[n]}</svg>`;
  }
  const tileHTML = t => svg(TIERS[t].icon, TIERS[t].fg);

  /* ============ STATE ============ */
  let cells, score = 0, streak = 0, coins = 0, busy = false, gameover = false, soundOn = true;
  let best = 0;
  try { best = parseInt(localStorage.getItem('bloom_v2_best') || '0', 10) || 0; } catch (e) {}
  let current = 1, next = 1, hold = null;
  let cell = 0, aimCol = -1, tileId = 0;
  // v2 telemetry for the existing score API (drops drive the anti-cheat check).
  let dropsCount = 0, maxTierReached = 1, _v2Submitted = false;
  let _startBest = best, _bestCelebrated = false;

  const $ = id => root.querySelector('#' + id);
  const boardEl = $('board'), tilesEl = $('tiles'), fxEl = $('fx'), ghostEl = $('ghost'), colhiEl = $('colhi');

  /* ============ IDENTITY (reuse classic's anonymous device id + token) ============ */
  function v2Did() {
    let id = '';
    try { id = localStorage.getItem('bloom_device_id') || ''; } catch (e) {}
    if (!id) {
      try {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem('bloom_device_id', id);
      } catch (e) { id = 'v2-' + Date.now().toString(36); }
    }
    return id;
  }
  const DID = v2Did();
  let TOKEN = '';
  try { TOKEN = localStorage.getItem('bloom_device_token') || ''; } catch (e) {}
  function ensureToken() {
    if (TOKEN) return Promise.resolve(TOKEN);
    return fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DID })
    }).then(r => r.json()).then(d => {
      if (d && d.token) { TOKEN = d.token; try { localStorage.setItem('bloom_device_token', TOKEN); } catch (e) {} }
      return TOKEN;
    }).catch(() => '');
  }
  ensureToken();
  function v2Today() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()); }
    catch (e) {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }
  // The ONE integration point the spec calls out: route v2's game-over score
  // through the EXISTING /api/score/practice endpoint so it lands in the same
  // backend (anti-cheat, profiles) — tagged difficulty:'v2' so it stays in its
  // own isolated leaderboard label and never mixes with classic scores.
  function submitV2Score() {
    if (_v2Submitted) return;        // one submit per game
    if (!(score > 0) || dropsCount < 1) return;
    _v2Submitted = true;
    try {
      const prev = parseInt(localStorage.getItem('bloom_v2_best') || '0', 10) || 0;
      if (score > prev) localStorage.setItem('bloom_v2_best', String(Math.floor(score)));
    } catch (e) {}
    let name = '', country = '';
    try { name = (localStorage.getItem('bloom_player_name') || '').trim(); } catch (e) {}
    try { country = (localStorage.getItem('bloom_country') || '').trim(); } catch (e) {}
    const tier = Math.max(1, Math.min(8, maxTierReached | 0));
    ensureToken().then(function(tok) {
      if (!tok) return;             // no token → keep the score local, never block
      const body = {
        date: v2Today(), deviceId: DID, token: tok,
        score: Math.floor(score), tier: tier, drops: dropsCount,
        difficulty: 'v2', source: 'practice'
      };
      if (name) body.name = name;
      if (/^[A-Z]{2}$/.test(country)) body.country = country;
      fetch('/api/score/practice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function() {});
    });
    try { if (window.trackEvent) window.trackEvent('v2_game_over', { score: Math.floor(score), tier: tier, drops: dropsCount }); } catch (e) {}
    try { if (window.gtag) window.gtag('event', 'game_over', { bloom_variant: 'v2', score: Math.floor(score) }); } catch (e) {}
  }

  /* ============ LAYOUT ============ */
  // Height-AWARE sizing (mirrors classic's fitGrid). #boardwrap is flex:1 and
  // fills the leftover vertical space; we size the 4×7 board to the LARGER tile
  // that still fits BOTH the available width and height, then center it. This
  // is what keeps the whole game on-screen (no overflow/scroll) on every phone
  // — the bloom-demo's width-only measure() overflowed tall phones like the 13 Pro.
  const wrapEl = root.querySelector('#boardwrap');
  function measure() {
    const availW = (wrapEl.clientWidth || boardEl.clientWidth || 360);
    const availH = (wrapEl.clientHeight || 400);
    const cellW = Math.floor((availW - PAD * 2 - GAP * (COLS - 1)) / COLS);
    const cellH = Math.floor((availH - PAD * 2 - GAP * (ROWS - 1)) / ROWS);
    cell = Math.max(1, Math.min(cellW, cellH));
    boardEl.style.width = (PAD * 2 + cell * COLS + GAP * (COLS - 1)) + 'px';
    boardEl.style.height = (PAD * 2 + cell * ROWS + GAP * (ROWS - 1)) + 'px';
  }
  // Re-fit when the layout has actually settled (CSS may apply a frame after
  // start()); retry on rAF until #boardwrap has a real height, capped.
  function relayout() {
    if (!wrapEl || wrapEl.clientHeight < 40 || wrapEl.clientWidth < 40) {
      relayout._t = (relayout._t || 0) + 1;
      if (relayout._t <= 40) requestAnimationFrame(relayout);
      return;
    }
    relayout._t = 0;
    measure(); buildBg(); layout(); clearAim();
  }
  const X = c => PAD + c * (cell + GAP), Y = r => PAD + r * (cell + GAP);
  function buildBg() {
    boardEl.querySelectorAll('.bgcell').forEach(e => e.remove());
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const d = document.createElement('div'); d.className = 'bgcell';
      d.style.cssText = `left:${X(c)}px;top:${Y(r)}px;width:${cell}px;height:${cell}px;`;
      boardEl.insertBefore(d, tilesEl);
    }
  }
  function place(t) {
    t.el.style.width = cell + 'px'; t.el.style.height = cell + 'px';
    const tr = `translate(${X(t.c)}px,${Y(t.r)}px)`; t.el.style.setProperty('--t', tr); t.el.style.transform = tr;
  }
  function layout() { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (cells[r][c]) place(cells[r][c]); }

  /* ============ TILES (DOM) ============ */
  function makeTile(tier) {
    const el = document.createElement('div'); el.className = 'tile';
    el.style.background = TIERS[tier].bg; el.innerHTML = tileHTML(tier); el.style.width = cell + 'px'; el.style.height = cell + 'px';
    tilesEl.appendChild(el); return { id: ++tileId, tier, r: 0, c: 0, el };
  }
  function setTier(t, tier) { t.tier = tier; t.el.style.background = TIERS[tier].bg; t.el.innerHTML = tileHTML(tier); }
  function pop(t) { t.el.classList.remove('pop'); void t.el.offsetWidth; t.el.classList.add('pop'); }
  function vanishTo(t, tr) { t.el.style.setProperty('--t', tr); t.el.classList.add('vanish'); const el = t.el; setTimeout(() => el.remove(), 200); }

  /* ============ GRID LOGIC (mirrors verified core) ============ */
  function landingRow(c) { for (let r = ROWS - 1; r >= 0; r--) if (!cells[r][c]) return r; return -1; }
  function boardFull() { for (let c = 0; c < COLS; c++) if (landingRow(c) >= 0) return false; return true; }
  function groups() {
    const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false)), res = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!cells[r][c] || seen[r][c]) continue;
      const tier = cells[r][c].tier, stack = [[r, c]], grp = []; seen[r][c] = true;
      while (stack.length) {
        const a = stack.pop(), y = a[0], x = a[1]; grp.push({ r: y, c: x });
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let k = 0; k < 4; k++) {
          const ny = y + nb[k][0], nx = x + nb[k][1];
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS && !seen[ny][nx] && cells[ny][nx] && cells[ny][nx].tier === tier) { seen[ny][nx] = true; stack.push([ny, nx]); }
        }
      }
      if (grp.length >= 2) res.push(grp);
    }
    return res;
  }
  function gravity() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) { if (cells[r][c]) { const t = cells[r][c]; if (r !== write) { cells[write][c] = t; cells[r][c] = null; t.r = write; } write--; } }
    }
    layout();
  }

  /* ============ AUDIO ============ */
  let actx;
  function audio() { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; if (!actx) actx = new AC(); return actx; }
  function resumeAudio() { if (!soundOn) return; const c = audio(); if (c && c.state === 'suspended') c.resume(); }
  function tone(freq, dur, type, vol) {
    if (!soundOn) return; const ctx = audio(); if (!ctx) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(vol || .18, ctx.currentTime + .012);
      g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + (dur || .12));
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (dur || .12));
    } catch (e) {}
  }
  function mergeSound(combo) { const f = 392 * Math.pow(2, (combo - 1) / 6); tone(f, .14, 'sine', .2); if (combo >= 3) tone(f * 1.5, .16, 'triangle', .1); }
  function dropSound() { tone(150, .08, 'triangle', .14); }
  function overSound() { [440, 330, 220].forEach((f, i) => setTimeout(() => tone(f, .25, 'sawtooth', .15), i * 140)); }

  /* ============ FX ============ */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function particles(r, c, tier, combo) {
    const cx = X(c) + cell / 2, cy = Y(r) + cell / 2, n = 6 + combo * 3;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div'); p.className = 'particle'; const sz = 4 + Math.random() * 6;
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;background:${TIERS[tier].fg};opacity:.9;`;
      fxEl.appendChild(p); const ang = Math.random() * 6.283, dist = 20 + Math.random() * (28 + combo * 10);
      requestAnimationFrame(() => {
        p.style.transition = 'transform .55s ease-out,opacity .55s';
        p.style.transform = `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist + 10}px)`; p.style.opacity = '0';
      });
      setTimeout(() => p.remove(), 600);
    }
  }
  function shake(combo) {
    const w = $('boardwrap'); w.style.setProperty('--si', Math.min(2 + combo * 2, 12) + 'px');
    w.style.setProperty('--sd', (.25 + combo * .02) + 's'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
  }
  function callout(combo) {
    if (combo < 2) return; const w = $('word');
    w.textContent = (WORDS[Math.min(combo, 6)] || WORDS[6]) + ' ×' + combo;
    w.style.color = TIERS[Math.min(combo + 1, 8)].fg; w.style.fontSize = (40 + combo * 4) + 'px';
    w.classList.remove('show'); void w.offsetWidth; w.classList.add('show');
  }
  // New-best celebration — the strongest "one more game" lever. Fires once per
  // game when the live score first crosses the player's previous best.
  function bestCelebration() {
    try { mergeSound(5); } catch (e) {}
    const host = $('boardwrap'); if (host) {
      const b = document.createElement('div'); b.className = 'v2-newbest'; b.textContent = '🏆 שיא חדש!';
      host.appendChild(b); setTimeout(function() { b.remove(); }, 1600);
    }
    const card = ($('best') || {}).closest ? $('best').closest('.stat') : null;
    if (card) { card.classList.remove('v2-best-pop'); void card.offsetWidth; card.classList.add('v2-best-pop'); }
  }
  function bumpScoreStat() {
    const card = ($('score') || {}).closest ? $('score').closest('.stat') : null;
    if (card) { card.classList.remove('v2-score-pop'); void card.offsetWidth; card.classList.add('v2-score-pop'); }
  }

  /* ============ RESOLVE ============ */
  async function resolve() {
    let combo = 0, total = 0;
    while (true) {
      const gs = groups(); if (!gs.length) break; combo++; let gained = 0;
      for (const grp of gs) {
        let tgt = grp[0]; for (const cc of grp) if (cc.r > tgt.r) tgt = cc;
        const tile = cells[tgt.r][tgt.c], old = tile.tier, tgtTr = `translate(${X(tgt.c)}px,${Y(tgt.r)}px)`;
        for (const cc of grp) { if (cc.r === tgt.r && cc.c === tgt.c) continue; const o = cells[cc.r][cc.c]; vanishTo(o, tgtTr); cells[cc.r][cc.c] = null; }
        let pts;
        if (old === 8) { pts = VAL[8] * grp.length * combo * 3; vanishTo(tile, tgtTr); cells[tgt.r][tgt.c] = null; }
        else { setTier(tile, old + 1); pop(tile); pts = VAL[old + 1] * combo; if (old + 1 > maxTierReached) maxTierReached = old + 1; }
        gained += pts; coins += Math.ceil(pts / 200);
        particles(tgt.r, tgt.c, Math.min(old + 1, 8), combo); mergeSound(combo);
      }
      score += gained; total += gained;
      if (score > best) { best = score; if (!_bestCelebrated && _startBest > 0 && best > _startBest) { _bestCelebrated = true; bestCelebration(); } }
      bumpScoreStat();
      callout(combo); shake(combo); hud();
      await sleep(combo >= 3 ? 260 : 150);
      gravity();
      await sleep(150);
    }
    if (total > 0) streak++; else streak = 0; hud();
  }

  /* ============ DROP / TURN ============ */
  function spawn() { const x = Math.random(); return x < 0.42 ? 1 : x < 0.72 ? 2 : x < 0.90 ? 3 : 4; }
  async function drop(c) {
    if (busy || gameover) return;
    const r = landingRow(c);
    if (r < 0) { shake(1); return; }
    busy = true; clearAim(); resumeAudio();
    const t = makeTile(current); t.r = r; t.c = c;
    if (current > maxTierReached) maxTierReached = current;
    dropsCount++;
    t.el.style.transition = 'none';
    const up = `translate(${X(c)}px,${Y(-1.3)}px)`; t.el.style.transform = up; t.el.style.setProperty('--t', up);
    void t.el.offsetWidth; t.el.style.transition = '';
    cells[r][c] = t; place(t); dropSound();
    await sleep(190);
    await resolve();
    current = next; next = spawn(); hud();
    busy = false;
    if (boardFull()) endGame();
  }
  function swapHold() {
    if (busy || gameover) return;
    if (hold === null) { hold = current; current = next; next = spawn(); } else { const tmp = hold; hold = current; current = tmp; } hud();
  }

  /* ============ AIM / GHOST ============ */
  function colFromClientX(clientX) {
    const rect = boardEl.getBoundingClientRect();
    return Math.max(0, Math.min(COLS - 1, Math.floor((clientX - rect.left - PAD) / (cell + GAP))));
  }
  function clearPulse() { const ps = tilesEl.querySelectorAll('.pulse'); for (let i = 0; i < ps.length; i++) ps[i].classList.remove('pulse'); }
  function showAim(c) {
    aimCol = c; const r = landingRow(c);
    colhiEl.style.cssText = `left:${X(c)}px;top:${PAD}px;width:${cell}px;height:${ROWS * cell + (ROWS - 1) * GAP}px;opacity:1;`;
    clearPulse();
    if (r < 0) { ghostEl.style.opacity = '0'; return; }
    ghostEl.style.cssText = `left:0;top:0;width:${cell}px;height:${cell}px;opacity:.45;background:${TIERS[current].bg};transform:translate(${X(c)}px,${Y(r)}px);`;
    ghostEl.innerHTML = tileHTML(current);
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (let k = 0; k < 4; k++) {
      const y = nb[k][0], x = nb[k][1];
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS && cells[y][x] && cells[y][x].tier === current) cells[y][x].el.classList.add('pulse');
    }
  }
  function clearAim() { aimCol = -1; colhiEl.style.opacity = '0'; ghostEl.style.opacity = '0'; clearPulse(); }

  boardEl.addEventListener('pointerdown', e => { if (busy || gameover) return; showAim(colFromClientX(e.clientX)); });
  boardEl.addEventListener('pointermove', e => { if (busy || gameover) return; showAim(colFromClientX(e.clientX)); });
  boardEl.addEventListener('pointerup', e => { if (busy || gameover) return; const c = aimCol >= 0 ? aimCol : colFromClientX(e.clientX); drop(c); });
  boardEl.addEventListener('pointercancel', () => { if (!busy) clearAim(); });
  boardEl.addEventListener('pointerleave', () => { if (!busy) clearAim(); });

  /* ============ HUD ============ */
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 100) / 10 + 'K' : n;
  function drawCurrent() { const b = $('current'); b.style.background = TIERS[current].bg; b.innerHTML = tileHTML(current); }
  function drawNext() {
    const b = $('nextbox'); b.innerHTML = ''; const m = document.createElement('div'); m.className = 'tile-mini';
    m.style.background = TIERS[next].bg; m.innerHTML = tileHTML(next); b.appendChild(m); b.style.border = 'none';
  }
  function drawHold() {
    const b = $('holdbox');
    if (hold) { b.innerHTML = ''; const m = document.createElement('div'); m.className = 'tile-mini'; m.style.background = TIERS[hold].bg; m.innerHTML = tileHTML(hold); b.appendChild(m); b.style.border = 'none'; }
    else { b.innerHTML = ''; b.style.border = '2px dashed #DAD3C2'; }
  }
  function hud() {
    $('score').textContent = fmt(score); $('streak').textContent = streak; $('best').textContent = fmt(best);
    $('coins').textContent = coins; drawCurrent(); drawNext(); drawHold();
    let hi = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (cells[r][c] && cells[r][c].tier > hi) hi = cells[r][c].tier;
    const legs = root.querySelectorAll('.leg'); legs.forEach((e, i) => { e.classList.toggle('active', (i + 1) === hi); e.style.color = TIERS[i + 1].fg; });
  }
  function buildLegend() {
    const L = $('legend'); L.innerHTML = '';
    for (let i = 1; i <= 8; i++) { const t = TIERS[i], d = document.createElement('div'); d.className = 'leg'; d.innerHTML = `<div class="chip" style="background:${t.bg}">${svg(t.icon, t.fg)}</div><div class="pts">${t.val}</div>`; L.appendChild(d); }
  }

  /* ============ FEEDBACK WIDGET (v2 only) ============ */
  // The heart of the GV.2 ask: a non-blocking 💬 pill always available + a
  // gentle one-time 👍/👎 prompt after the 2nd game-over of the session.
  var FB_DONE_KEY = 'bloom_v2_feedback_done';
  var _fbGameOvers = 0, _fbRating = 0, _fbSubmitting = false;
  function fbDone() { try { return !!localStorage.getItem(FB_DONE_KEY); } catch (e) { return false; } }
  function fbMarkDone() { try { localStorage.setItem(FB_DONE_KEY, '1'); } catch (e) {} }
  function buildFeedbackWidget() {
    // Trigger lives in the header (#v2-fb-btn) so it never overlaps the board.
    var btn = root.querySelector('#v2-fb-btn');
    if (btn) btn.addEventListener('click', function() { openFeedback(false); });
    var panel = document.createElement('div');
    panel.id = 'v2-fb-panel'; panel.hidden = true;
    panel.innerHTML =
      '<div class="v2-fb-card">' +
        '<button type="button" class="v2-fb-x" aria-label="סגור">✕</button>' +
        '<div class="v2-fb-title" id="v2-fb-title">נהנית מהגרסה החדשה?</div>' +
        '<div class="v2-fb-rate">' +
          '<button type="button" class="v2-fb-up" data-r="1">👍</button>' +
          '<button type="button" class="v2-fb-down" data-r="-1">👎</button>' +
        '</div>' +
        '<input type="text" class="v2-fb-input" id="v2-fb-input" maxlength="500" placeholder="ספר/י לנו (לא חובה)">' +
        '<button type="button" class="v2-fb-send" id="v2-fb-send">שלח</button>' +
        '<div class="v2-fb-thanks" id="v2-fb-thanks" hidden>תודה! 🙏</div>' +
      '</div>';
    root.appendChild(panel);
    panel.querySelector('.v2-fb-x').addEventListener('click', function() { closeFeedback(true); });
    panel.querySelectorAll('.v2-fb-rate button').forEach(function(b) {
      b.addEventListener('click', function() {
        _fbRating = parseInt(b.getAttribute('data-r'), 10) || 0;
        panel.querySelector('.v2-fb-up').classList.toggle('sel', _fbRating === 1);
        panel.querySelector('.v2-fb-down').classList.toggle('sel', _fbRating === -1);
      });
    });
    panel.querySelector('#v2-fb-send').addEventListener('click', submitFeedback);
  }
  function openFeedback(isAuto) {
    var panel = root.querySelector('#v2-fb-panel'); if (!panel) return;
    panel.hidden = false; panel.classList.add('show');
    var t = root.querySelector('#v2-fb-title');
    if (t) t.textContent = isAuto ? 'נהנית מהגרסה החדשה?' : '💬 ספר/י לנו מה דעתך';
  }
  function closeFeedback(markDone) {
    var panel = root.querySelector('#v2-fb-panel'); if (!panel) return;
    panel.classList.remove('show'); panel.hidden = true;
    if (markDone) fbMarkDone();  // dismissing the prompt also means "don't nag again"
  }
  function submitFeedback() {
    if (_fbSubmitting) return;
    var input = root.querySelector('#v2-fb-input');
    var comment = input ? (input.value || '').trim().slice(0, 500) : '';
    if (!_fbRating && !comment) {
      var t = root.querySelector('#v2-fb-title'); if (t) t.textContent = 'בחר/י 👍 או 👎 (או כתוב/כתבי משהו)';
      return;
    }
    _fbSubmitting = true;
    var body = { rating: _fbRating || null, comment: comment || null, score: Math.floor(score) || 0, variant: 'v2', deviceId: DID };
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(function() {})
      .then(function() {
        fbMarkDone();
        var thanks = root.querySelector('#v2-fb-thanks'); if (thanks) thanks.hidden = false;
        ['#v2-fb-title', '.v2-fb-rate', '#v2-fb-input', '#v2-fb-send'].forEach(function(sel) { var el = root.querySelector(sel); if (el) el.style.display = 'none'; });
        setTimeout(function() { closeFeedback(true); }, 1400);
      });
  }
  function maybeAutoFeedback() {
    _fbGameOvers++;
    if (_fbGameOvers === 2 && !fbDone()) {
      setTimeout(function() { openFeedback(true); }, 900);  // let the game-over overlay settle first
    }
  }

  /* ============ GAME OVER / RESET ============ */
  function endGame() {
    gameover = true; submitV2Score(); overSound();
    $('finalScore').textContent = fmt(score); $('over').classList.add('show');
    maybeAutoFeedback();
  }
  function reset() {
    gameover = false; busy = false; score = 0; streak = 0; hold = null;
    dropsCount = 0; maxTierReached = 1; _v2Submitted = false;
    tilesEl.innerHTML = ''; fxEl.innerHTML = ''; $('over').classList.remove('show');
    cells = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    current = spawn(); next = spawn(); clearAim(); hud();
    try { if (window.trackEvent) window.trackEvent('v2_game_start', {}); } catch (e) {}
  }

  /* ============ BUTTONS ============ */
  $('holdbox').addEventListener('click', swapHold);
  $('btnSound').addEventListener('click', () => { soundOn = !soundOn; $('btnSound').textContent = soundOn ? '🔊' : '🔇'; if (soundOn) { resumeAudio(); tone(523, .1); } });
  $('btnRestart').addEventListener('click', reset);
  $('btnAgain').addEventListener('click', reset);

  /* ============ INIT ============ */
  function init() {
    cells = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    dropsCount = 0; maxTierReached = 1; _v2Submitted = false;
    _startBest = best; _bestCelebrated = false;
    buildLegend(); current = spawn(); next = spawn(); hud(); relayout();
    try { if (window.trackEvent) window.trackEvent('v2_game_start', {}); } catch (e) {}
  }
  var _reflowTimer = null;
  function scheduleReflow() { clearTimeout(_reflowTimer); _reflowTimer = setTimeout(relayout, 60); }
  window.addEventListener('resize', scheduleReflow);
  window.addEventListener('orientationchange', function() { setTimeout(relayout, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleReflow);
  init();
  buildFeedbackWidget();
}
