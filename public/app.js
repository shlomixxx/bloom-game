(function() {
  // Board dimensions live behind getters so a future "Pro mode" (5 or 6
  // columns, sold as IAP) can swap them at runtime without touching every
  // callsite. Today they return the original 6×4 dimensions — pure refactor.
  function getBoardRows() { return 6; }
  function getBoardCols() { return 4; }

  // Column score multipliers (phase 1 of Dynamic Boards System).
  // null = no multiplier active → pointsFor() takes the vanilla branch with
  // zero overhead. An array of length getBoardCols() activates per-column
  // multiplication. Values are floats; sensible range is 0.5..20.
  let _columnMultipliers = null;
  function getColumnMultipliers() {
    if (_columnMultipliers && Array.isArray(_columnMultipliers) && _columnMultipliers.length === getBoardCols()) {
      return _columnMultipliers;
    }
    return null;
  }
  function setColumnMultipliers(arr) {
    if (arr == null) { _columnMultipliers = null; return true; }
    if (!Array.isArray(arr) || arr.length !== getBoardCols()) return false;
    const sanitized = arr.map(function(v) {
      const n = Number(v);
      if (!isFinite(n) || n < 0) return 1;
      return Math.min(20, Math.max(0.5, n));
    });
    _columnMultipliers = sanitized;
    return true;
  }

  // Special cells (phase 3 of Dynamic Boards System, May 2026).
  // Each cell is { row: 0..rows-1, col: 0..cols-1, type: 'gold'|... }.
  // Stored as an array (not a 2D map) because most boards will have <12
  // cells — array iteration is cheaper than a sparse grid. Lookup by
  // position uses _specialCellsByPos for O(1) reads in the hot path.
  let _specialCells = null;
  let _specialCellsByPos = null;
  function getSpecialCells() { return _specialCells; }
  function getSpecialCellAt(row, col) {
    if (!_specialCellsByPos) return null;
    return _specialCellsByPos[row + ',' + col] || null;
  }
  // Mirror the server's SPECIAL_CELL_TYPES allowlist. Keep in sync.
  // (Defining here so the client doesn't import from the server module.)
  const CLIENT_SPECIAL_CELL_TYPES = ['gold', 'bonus', 'frozen', 'electric', 'locked', 'teleport'];

  // Phase 5 board shapes — 1 = active cell, 0 = inactive (visual void
  // + engine wall). Each shape is a 6-row × 4-col matrix in row-major
  // top-to-bottom order matching the engine's grid[row][col] layout.
  // Keep IDs in sync with the server allowlist in validateBoardDefinition.
  const SHAPE_GEOMETRIES = {
    // ❤️ Heart — tapered diamond bottom + rounded top (Valentine pair).
    heart: [
      [1, 0, 0, 1],   // row 0 — two top "humps" with a notch in the middle
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 1, 0]
    ],
    // 💎 Diamond — wide middle, narrow top + bottom (Independence Day pair).
    diamond: [
      [0, 0, 1, 0],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [0, 1, 1, 1],
      [0, 0, 1, 0]
    ],
    // 🌲 Tree — narrow crown widens down to a 2-cell trunk (Hanukkah/Christmas).
    tree: [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [0, 1, 1, 0]
    ],
    // 🔺 Pyramid — narrow top widens to a full 4-cell base (Passover).
    pyramid: [
      [0, 0, 1, 0],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ]
  };

  // Looks up the active board's shape and returns true if the cell is
  // a "void" (not part of the playable area). False fast-path when no
  // shape is active — zero overhead on vanilla play.
  function isShapeInactiveAt(r, c) {
    var board = window._activeSpecialBoard;
    var shapeId = board && board.definition && board.definition.shape_id;
    if (!shapeId) return false;
    var geo = SHAPE_GEOMETRIES[shapeId];
    if (!geo) return false;
    if (r < 0 || r >= geo.length) return true;
    var row = geo[r];
    if (!row || c < 0 || c >= row.length) return true;
    return row[c] === 0;
  }
  function setSpecialCells(arr) {
    if (arr == null) { _specialCells = null; _specialCellsByPos = null; return true; }
    if (!Array.isArray(arr)) return false;
    const sanitized = [];
    const byPos = {};
    const rows = getBoardRows();
    const cols = getBoardCols();
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (!c || typeof c !== 'object') continue;
      const row = parseInt(c.row, 10);
      const col = parseInt(c.col, 10);
      const type = String(c.type || '');
      if (!Number.isInteger(row) || row < 0 || row >= rows) continue;
      if (!Number.isInteger(col) || col < 0 || col >= cols) continue;
      if (!CLIENT_SPECIAL_CELL_TYPES.includes(type)) continue;
      const key = row + ',' + col;
      if (byPos[key]) continue;        // dedupe
      const entry = { row: row, col: col, type: type };
      // Per-type fields. Bonus carries `amount`; locked carries
      // `unlock_after` (and an `unlocked` runtime flag we mirror so
      // restoring a saved board keeps the unlocked state).
      if (type === 'bonus') {
        const amt = Number(c.amount);
        if (!Number.isFinite(amt) || amt < 50 || amt > 10000) continue;  // drop bad bonus cells
        entry.amount = amt;
      }
      if (type === 'locked') {
        const unlock = parseInt(c.unlock_after, 10);
        if (!Number.isInteger(unlock) || unlock < 1 || unlock > 30) continue;
        entry.unlock_after = unlock;
        entry.unlocked = !!c.unlocked;  // runtime flag — false on fresh game
      }
      sanitized.push(entry);
      byPos[key] = entry;
    }
    _specialCells = sanitized.length ? sanitized : null;
    _specialCellsByPos = sanitized.length ? byPos : null;
    return true;
  }

  // Surgical move of a single special cell at runtime (phase 3D++).
  // Used by the "relocate after shatter" mechanic — mutates _specialCells
  // + _specialCellsByPos in place without rebuilding the whole list.
  // Returns true on success, false if the source doesn't exist or the
  // target is already occupied by another special cell.
  function moveSpecialCellInPlace(fromR, fromC, toR, toC) {
    if (!_specialCells || !_specialCellsByPos) return false;
    if (fromR === toR && fromC === toC) return false;
    var rows = getBoardRows(), cols = getBoardCols();
    if (toR < 0 || toR >= rows || toC < 0 || toC >= cols) return false;
    var fromKey = fromR + ',' + fromC;
    var toKey = toR + ',' + toC;
    var entry = _specialCellsByPos[fromKey];
    if (!entry) return false;
    if (_specialCellsByPos[toKey]) return false;  // target already special
    entry.row = toR;
    entry.col = toC;
    delete _specialCellsByPos[fromKey];
    _specialCellsByPos[toKey] = entry;
    return true;
  }

  const SVG = {
    circle:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/></svg>',
    leaf:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21c.5-4.5 2.5-8 7-10"/><path d="M9 18c6.218 0 10.5-3.288 11-12v-2h-4.014c-9 0-11.986 4-12 9c0 1 0 3 2 5h3z"/></svg>',
    flower:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="5.5" r="3"/><circle cx="12" cy="18.5" r="3"/><circle cx="5.5" cy="12" r="3"/><circle cx="18.5" cy="12" r="3"/></svg>',
    flame:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a5 5 0 0 0 10 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-2 2z"/></svg>',
    bolt:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v7h6l-8 11v-7H5l8-11z"/></svg>',
    star:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 1.999l3.086 6.254 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h12l3 5-9 11-9-11z"/><path d="M3 10h18M9 5l3 5-3 5M15 5l-3 5 3 5"/></svg>',
    crown:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l3.5 9h11l3.5-9-5 4-4-7-4 7z"/></svg>'
  };

  const TIERS = [
    null,
    { svg: SVG.circle,  bg: '#D3D1C7', fg: '#2C2C2A', name: 'אבן',    emoji: '⬜' },
    { svg: SVG.leaf,    bg: '#C0DD97', fg: '#173404', name: 'עלה',    emoji: '🟩' },
    { svg: SVG.flower,  bg: '#F4C0D1', fg: '#4B1528', name: 'פרח',    emoji: '🟧' },
    { svg: SVG.flame,   bg: '#F5C4B3', fg: '#4A1B0C', name: 'אש',     emoji: '🟥' },
    { svg: SVG.bolt,    bg: '#FAC775', fg: '#412402', name: 'ברק',    emoji: '🟨' },
    { svg: SVG.star,    bg: '#9FE1CB', fg: '#04342C', name: 'כוכב',   emoji: '🟦' },
    { svg: SVG.diamond, bg: '#B5D4F4', fg: '#042C53', name: 'יהלום',  emoji: '💎' },
    { svg: SVG.crown,   bg: '#CECBF6', fg: '#26215C', name: 'כתר',    emoji: '👑' }
  ];
  const MAX_TIER = TIERS.length - 1;
  const WEIGHTS = [0, 55, 28, 12, 5];

  // ============ SKIN PACKS ============
  const SKIN_PACKS = {
    classic: { id: 'classic', name: '🌸 קלאסי', price: 0, tiers: null }, // null = use TIERS
    ocean: { id: 'ocean', name: '🌊 אוקיינוס', price: 200, tiers: [
      null,
      { svg: SVG.circle, bg: '#B8D4E3', fg: '#1A3A4A', name: 'חול',   emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#7EC8E3', fg: '#0A2540', name: 'גל',    emoji: '🟦' },
      { svg: SVG.flower, bg: '#4CA1AF', fg: '#FFFFFF', name: 'אלמוג', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#2C7DA0', fg: '#FFFFFF', name: 'דג',    emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#1B6B93', fg: '#FFFFFF', name: 'דולפין', emoji: '🟨' },
      { svg: SVG.star,   bg: '#14557B', fg: '#FFD700', name: 'כוכב ים', emoji: '⭐' },
      { svg: SVG.diamond,bg: '#0E3F5C', fg: '#7FDBFF', name: 'פנינה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#072A40', fg: '#FFD700', name: 'פוסיידון', emoji: '👑' }
    ]},
    candy: { id: 'candy', name: '🍬 ממתקים', price: 200, tiers: [
      null,
      { svg: SVG.circle, bg: '#FFDEE9', fg: '#6B2043', name: 'סוכריה', emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#FF9AA2', fg: '#5C1A25', name: 'מסטיק', emoji: '🟩' },
      { svg: SVG.flower, bg: '#FFB7B2', fg: '#5C2A25', name: 'גומי',   emoji: '🟧' },
      { svg: SVG.flame,  bg: '#E2979C', fg: '#FFFFFF', name: 'שוקולד', emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#FFC8A2', fg: '#5C3A12', name: 'קרמל',  emoji: '🟨' },
      { svg: SVG.star,   bg: '#B5EAD7', fg: '#1A4A35', name: 'מנטה',  emoji: '🟦' },
      { svg: SVG.diamond,bg: '#C7CEEA', fg: '#2A2D5E', name: 'לביבה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#E8D5B7', fg: '#5C3A12', name: 'עוגה',   emoji: '👑' }
    ]},
    space: { id: 'space', name: '🌙 חלל', price: 300, tiers: [
      null,
      { svg: SVG.circle, bg: '#2D283E', fg: '#B8B5C8', name: 'אבק',    emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#564F6F', fg: '#E0DFEE', name: 'סלע',    emoji: '🟩' },
      { svg: SVG.flower, bg: '#4A2A7A', fg: '#D4A5FF', name: 'ערפילית', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#9B59B6', fg: '#FFFFFF', name: 'כוכב',   emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#E74C3C', fg: '#FFFFFF', name: 'סופרנובה', emoji: '🟨' },
      { svg: SVG.star,   bg: '#F39C12', fg: '#FFFFFF', name: 'שמש',    emoji: '🟦' },
      { svg: SVG.diamond,bg: '#3498DB', fg: '#FFFFFF', name: 'גלקסיה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#1A1A2E', fg: '#FFD700', name: 'חור שחור', emoji: '👑' }
    ]},
    fire: { id: 'fire', name: '🔥 אש וקרח', price: 300, tiers: [
      null,
      { svg: SVG.circle, bg: '#E8E8E8', fg: '#333333', name: 'אפר',   emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#A8D8EA', fg: '#1A3A4A', name: 'קרח',   emoji: '🟩' },
      { svg: SVG.flower, bg: '#78C4D4', fg: '#0A2540', name: 'כפור',  emoji: '🟧' },
      { svg: SVG.flame,  bg: '#FFB347', fg: '#5C2A00', name: 'ניצוץ', emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#FF6B35', fg: '#FFFFFF', name: 'להבה',  emoji: '🟨' },
      { svg: SVG.star,   bg: '#E63946', fg: '#FFFFFF', name: 'אש',    emoji: '🟦' },
      { svg: SVG.diamond,bg: '#1D3557', fg: '#A8DADC', name: 'קריסטל', emoji: '💎' },
      { svg: SVG.crown,  bg: '#0D1B2A', fg: '#FFD700', name: 'דרקון',  emoji: '👑' }
    ]},
    gold: { id: 'gold', name: '✨ VIP זהב', price: 500, tiers: [
      null,
      { svg: SVG.circle, bg: '#F5F0E1', fg: '#7A6B4E', name: 'חול',    emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#E8D9A0', fg: '#5C4A12', name: 'נחושת', emoji: '🟩' },
      { svg: SVG.flower, bg: '#D4AF37', fg: '#3A2A00', name: 'ברונזה', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#C5A028', fg: '#FFFFFF', name: 'כסף',   emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#B8941E', fg: '#FFFFFF', name: 'זהב',   emoji: '🟨' },
      { svg: SVG.star,   bg: '#A07818', fg: '#FFFFFF', name: 'פלטינה', emoji: '🟦' },
      { svg: SVG.diamond,bg: '#8B6914', fg: '#FFE4A0', name: 'יהלום',  emoji: '💎' },
      { svg: SVG.crown,  bg: '#6B4E0A', fg: '#FFD700', name: 'מלך',    emoji: '👑' }
    ]},
    // Aurora — gradient surfaces + addictive CSS animations layered via
    // body.skin-aurora-active. The existing render path
    // (cell.style.background = tiers[t].bg in 12-tour-info.js) accepts
    // string gradients as-is. Other skins are completely unaffected.
    aurora: { id: 'aurora', name: '🌌 אורורה', price: 300, tiers: [
      null,
      { svg: SVG.circle,  bg: 'linear-gradient(140deg,#EBE7DA 0%,#C0BAA8 100%)', fg: '#3D3A33', name: 'אבן',   emoji: '⬜' },
      { svg: SVG.leaf,    bg: 'linear-gradient(140deg,#D9EDB7 0%,#88B450 100%)', fg: '#1F3A0E', name: 'עלה',   emoji: '🟩' },
      { svg: SVG.flower,  bg: 'linear-gradient(140deg,#FFD3E2 0%,#E07AA8 100%)', fg: '#5C1A38', name: 'פרח',   emoji: '🟧' },
      { svg: SVG.flame,   bg: 'linear-gradient(140deg,#FFC4A0 0%,#EE7548 100%)', fg: '#5A1E08', name: 'אש',    emoji: '🟥' },
      { svg: SVG.bolt,    bg: 'linear-gradient(140deg,#FFDA7A 0%,#E89010 100%)', fg: '#3A1F00', name: 'ברק',   emoji: '🟨' },
      { svg: SVG.star,    bg: 'linear-gradient(140deg,#A8EBD0 0%,#2DAC85 100%)', fg: '#013024', name: 'כוכב',  emoji: '🟦' },
      { svg: SVG.diamond, bg: 'linear-gradient(140deg,#B8D5F8 0%,#3F88D8 100%)', fg: '#042C53', name: 'יהלום', emoji: '💎' },
      { svg: SVG.crown,   bg: 'linear-gradient(110deg,#F0E8FF 0%,#9B8AE8 20%,#F5C8E8 40%,#9B8AE8 60%,#FFD37A 80%,#9B8AE8 100%)', fg: '#26215C', name: 'כתר', emoji: '👑' }
    ]}
  };
  const ACTIVE_SKIN_KEY = 'bloom_active_skin';
  const OWNED_SKINS_KEY = 'bloom_owned_skins';
  var activeSkinId = localStorage.getItem(ACTIVE_SKIN_KEY) || 'classic';
  var ownedSkins = JSON.parse(localStorage.getItem(OWNED_SKINS_KEY) || '["classic"]');

  // Single source of truth for the body.skin-aurora-active class. Called from
  // every place activeSkinId mutates (boot, purchase, equip, trial, revert).
  // Aurora's CSS-only effects live exclusively under this class — other skins
  // remain untouched. No-op if the body isn't ready yet (called again on boot).
  function syncBodySkinClass() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('skin-aurora-active', activeSkinId === 'aurora');
  }
  // Boot sync — if body already exists, set the class now; otherwise wait.
  if (typeof document !== 'undefined') {
    if (document.body) syncBodySkinClass();
    else document.addEventListener('DOMContentLoaded', syncBodySkinClass, { once: true });
  }

  // ─── Aurora-only juice helpers ───
  // Every function checks auroraIsActive() before running, so they're safe to
  // call unconditionally from the engine — they no-op when Aurora isn't the
  // active skin (most players). Saves wrapping every call site in an if.
  const AURORA_CHAIN_TEXTS = ['', '', 'GREAT!', 'AMAZING!', 'INSANE!', 'GODLIKE!'];
  const AURORA_CHAIN_CLASSES = ['', '', 'good', 'great', 'amazing', 'godlike'];

  function auroraIsActive() {
    return !!(document.body && document.body.classList.contains('skin-aurora-active'));
  }

  // Spawn a "GREAT!" / "AMAZING!" / "INSANE!" / "GODLIKE!" text burst at the
  // top of the grid. Called on merge with chainCount >= 2.
  function auroraShowTextBurst(chainNum) {
    if (!auroraIsActive() || chainNum < 2) return;
    const gridEl = document.getElementById('grid') || document.querySelector('.grid');
    if (!gridEl || !gridEl.parentElement) return;
    let burst = document.getElementById('aurora-text-burst');
    if (!burst) {
      burst = document.createElement('div');
      burst.id = 'aurora-text-burst';
      gridEl.parentElement.style.position = gridEl.parentElement.style.position || 'relative';
      gridEl.parentElement.appendChild(burst);
    }
    const tier = Math.min(chainNum, 5);
    burst.textContent = AURORA_CHAIN_TEXTS[tier] || 'GREAT!';
    burst.className = 'aurora-text-burst aurora-text-burst-' + (AURORA_CHAIN_CLASSES[tier] || 'good');
    // Restart the animation by toggling the class
    burst.classList.remove('show');
    void burst.offsetWidth;
    burst.classList.add('show');
  }

  // Quick scale animation on the score counter when points are added.
  // Call after updating the score number in the DOM.
  function auroraScoreBump() {
    if (!auroraIsActive()) return;
    const scoreEls = document.querySelectorAll('#score, .score, .stat-primary .stat-val');
    scoreEls.forEach(function(el) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      setTimeout(function() { el.classList.remove('bump'); }, 400);
    });
  }

  // Fly a few small gold particles from cell → score counter, simulating
  // "points entering your pocket" (Vampire Survivors style).
  function auroraFlyParticlesToScore(cellEl, count) {
    if (!auroraIsActive() || !cellEl) return;
    const scoreEl = document.querySelector('#score, .score, .stat-primary .stat-val');
    if (!scoreEl) return;
    const sRect = scoreEl.getBoundingClientRect();
    const cRect = cellEl.getBoundingClientRect();
    const targetX = sRect.left + sRect.width / 2;
    const targetY = sRect.top + sRect.height / 2;
    const n = Math.min(8, Math.max(1, count | 0));
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'aurora-score-particle';
      const startX = cRect.left + cRect.width / 2 + (Math.random() - 0.5) * 30;
      const startY = cRect.top + cRect.height / 2 + (Math.random() - 0.5) * 30;
      p.style.left = startX + 'px';
      p.style.top = startY + 'px';
      document.body.appendChild(p);
      setTimeout(function() {
        p.style.left = targetX + 'px';
        p.style.top = targetY + 'px';
      }, 10 + i * 40);
      setTimeout(function() { p.remove(); }, 800 + i * 40);
    }
  }

  // Apply a random scale-peak to a cell's merge animation, so consecutive
  // merges don't look identical. Slot-machine variance for the brain.
  function auroraSetMergeVariance(cellEl) {
    if (!auroraIsActive() || !cellEl) return;
    const peak = (1.3 + Math.random() * 0.2).toFixed(2);
    cellEl.style.setProperty('--merge-peak', peak);
  }

  // Expose globally so files outside the same IIFE (or curious devs in the
  // console) can reach them. Within the IIFE the names also work directly.
  if (typeof window !== 'undefined') {
    window.auroraIsActive = auroraIsActive;
    window.auroraShowTextBurst = auroraShowTextBurst;
    window.auroraScoreBump = auroraScoreBump;
    window.auroraFlyParticlesToScore = auroraFlyParticlesToScore;
    window.auroraSetMergeVariance = auroraSetMergeVariance;
  }

  // ============ THEME / SKIN ABSTRACTION ============
  function getActiveTiers() {
    var pack = SKIN_PACKS[activeSkinId];
    if (pack && pack.tiers) return pack.tiers;
    return TIERS;
  }

  var skinTrialMode = false;
  var skinTrialId = null;
  var skinTrialOriginal = null;

  function showSkinShop() {
    var existing = document.getElementById('skin-shop-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'skin-shop-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var html = '<div class="info-card" style="max-width:360px;direction:rtl">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<span style="font-size:16px;font-weight:700">🎨 חנות סקינים</span>' +
        '<span style="font-size:13px;font-weight:700;color:#BA7517">💎 ' + playerBalance + '</span>' +
      '</div>';
    Object.keys(SKIN_PACKS).forEach(function(id) {
      var s = SKIN_PACKS[id];
      var owned = ownedSkins.indexOf(id) >= 0;
      var active = activeSkinId === id;
      var tiers = s.tiers || TIERS;
      var preview = '';
      for (var t = 1; t <= Math.min(5, tiers.length - 1); t++) {
        preview += '<div style="width:28px;height:28px;border-radius:8px;background:' + tiers[t].bg + ';color:' + tiers[t].fg + ';display:flex;align-items:center;justify-content:center">' + tiers[t].svg + '</div>';
      }
      var btnsHtml = '';
      if (active) {
        btnsHtml = '<button class="btn sm" disabled style="opacity:0.5;min-width:60px">✓ פעיל</button>';
      } else if (owned) {
        btnsHtml = '<button class="btn sm skin-equip-btn" data-skin="' + id + '" style="min-width:60px">לבש</button>';
      } else {
        btnsHtml = '<div style="display:flex;gap:4px">' +
          '<button class="btn sm skin-try-btn" data-skin="' + id + '" style="min-width:50px;font-size:11px">נסה</button>' +
          '<button class="btn sm skin-buy-btn" data-skin="' + id + '" style="background:#BA7517;color:#FFF;min-width:60px">' + s.price + ' 💎</button>' +
        '</div>';
      }

      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,0.06)">' +
        '<div style="flex:1">' +
          '<div style="font-size:13px;font-weight:600">' + s.name + '</div>' +
          '<div style="display:flex;gap:3px;margin-top:4px">' + preview + '</div>' +
        '</div>' +
        btnsHtml +
      '</div>';
    });
    html += '<button class="btn secondary" id="skin-shop-close" style="margin-top:12px;width:100%">סגור</button></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('skin-shop-close').onclick = function() { modal.remove(); };

    // Wire try buttons
    modal.querySelectorAll('.skin-try-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        modal.remove();
        startSkinTrial(skinId);
      };
    });

    // Wire buy buttons
    modal.querySelectorAll('.skin-buy-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        var pack = SKIN_PACKS[skinId];
        if (!pack) return;
        if (playerBalance < pack.price) {
          this.textContent = 'אין מספיק 💎';
          setTimeout(function() { showSkinShop(); }, 1200);
          return;
        }
        var self = this;
        self.disabled = true; self.textContent = '...';
        fetch(API_BASE + '/api/player/buy-skin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, skinId: skinId, token: deviceToken })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            ownedSkins.push(skinId);
            try { localStorage.setItem(OWNED_SKINS_KEY, JSON.stringify(ownedSkins)); } catch(e) {}
            activeSkinId = skinId;
            try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
            syncBodySkinClass();
            skinTrialMode = false; skinTrialId = null;
            removeSkinTrialBanner();
            showSkinShop();
            buildTierBar(true);
            render();
            trackEvent('purchase', { item: 'skin', skin: skinId, cost: d.cost | 0 });
          } else {
            self.textContent = d.reason || 'שגיאה';
          }
        }).catch(function() { self.textContent = 'שגיאה'; });
      };
    });

    // Wire equip buttons
    modal.querySelectorAll('.skin-equip-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        activeSkinId = skinId;
        try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
        syncBodySkinClass();
        showSkinShop();
        buildTierBar(true);
        render();
      };
    });
  }

  function startSkinTrial(skinId) {
    skinTrialOriginal = activeSkinId;
    skinTrialId = skinId;
    skinTrialMode = true;
    activeSkinId = skinId;
    syncBodySkinClass();
    buildTierBar(true);
    hideHome(); // close home screen → enter game directly
    init('practice', { fresh: true });
    showSkinTrialBanner(skinId);
  }

  function showSkinTrialBanner(skinId) {
    removeSkinTrialBanner();
    var pack = SKIN_PACKS[skinId];
    if (!pack) return;
    // Add bottom padding so last row isn't hidden behind banner
    document.body.style.paddingBottom = '56px';
    var banner = document.createElement('div');
    banner.id = 'skin-trial-banner';
    banner.className = 'skin-trial-banner';
    banner.innerHTML =
      '<div class="trial-info">' +
        '<div class="trial-title">🎨 ניסיון · ' + pack.name + '</div>' +
        '<div class="trial-sub">ניקוד לא נשמר</div>' +
      '</div>' +
      '<div class="trial-btns">' +
        '<button class="btn sm skin-trial-end-btn" style="font-size:11px;padding:6px 12px">סיים</button>' +
        '<button class="btn sm skin-trial-buy-btn" style="background:#BA7517;color:#FFF;font-size:11px;padding:6px 12px">' + pack.price + ' 💎</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.skin-trial-buy-btn').onclick = function() {
      if (playerBalance < pack.price) {
        this.textContent = 'אין מספיק 💎';
        return;
      }
      this.disabled = true; this.textContent = '...';
      fetch(API_BASE + '/api/player/buy-skin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, skinId: skinId, token: deviceToken })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d && d.ok) {
          playerBalance = d.newBalance;
          try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
          ownedSkins.push(skinId);
          try { localStorage.setItem(OWNED_SKINS_KEY, JSON.stringify(ownedSkins)); } catch(e) {}
          try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
          syncBodySkinClass();
          skinTrialMode = false; skinTrialId = null;
          removeSkinTrialBanner();
          updateModeBar();
          showCreditToast(-pack.price, pack.name + ' נרכש!');
          trackEvent('purchase', { item: 'skin', skin: skinId, cost: pack.price });
        }
      }).catch(function() {});
    };

    banner.querySelector('.skin-trial-end-btn').onclick = function() {
      endSkinTrial();
    };
  }

  function endSkinTrial() {
    if (skinTrialOriginal) {
      activeSkinId = skinTrialOriginal;
      try { localStorage.setItem(ACTIVE_SKIN_KEY, skinTrialOriginal); } catch(e) {}
      syncBodySkinClass();
    }
    skinTrialMode = false;
    skinTrialId = null;
    skinTrialOriginal = null;
    removeSkinTrialBanner();
    buildTierBar(true);
    init('practice', { fresh: true }); // fresh game so trial score doesn't leak
    updateModeBar();
    showSkinShop();
  }

  function removeSkinTrialBanner() {
    var b = document.getElementById('skin-trial-banner');
    if (b) b.remove();
    document.body.style.paddingBottom = '';
  }
  // ============ 1v1 DUEL SYSTEM ============
  // opts: { prefillSuffix } — used when launching from leaderboard "challenge" buttons
  function showDuelModal(opts) {
    opts = opts || {};
    var pre = (opts.prefillSuffix || '').toString().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'duel-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var myCodePill = '';
    if (typeof playerCode !== 'undefined' && playerCode) {
      myCodePill = '<div id="duel-my-code" style="font-size:11px;background:#FFF7E6;border:1px solid #FAC775;border-radius:8px;padding:6px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer" title="הקוד שלי — לחץ כדי להעתיק ולשלוח לחבר">' +
        '<span style="color:#6F6E68">הקוד שלי</span>' +
        '<strong style="font-family:ui-monospace,monospace;letter-spacing:0.08em">' + playerCode + '</strong>' +
        '<span style="color:#BA7517">📋 העתק</span>' +
      '</div>';
    }
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:12px">⚔️ דו-קרב 1v1</div>' +
      '<div style="font-size:12px;color:#6F6E68;margin-bottom:12px">אתגר שחקן ספציפי! שניכם משחקים על אותו לוח — מי שמשיג יותר נקודות מנצח.</div>' +
      myCodePill +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">קוד היריב</div>' +
      // direction:ltr — the code "BLOOM-XXXX" is LTR English text, so the
      // pill must sit on the LEFT and the suffix input on the RIGHT, even
      // though the surrounding modal is RTL Hebrew. Without this override
      // the flex children flip and the user reads "XXXX-BLOOM" backwards.
      '<div class="duel-code-input" dir="ltr" style="display:flex;align-items:stretch;border:1px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;margin-bottom:8px;background:#FFFFFF;direction:ltr">' +
        '<span style="background:#1C1A18;color:#FAC775;padding:8px 10px;font-weight:700;letter-spacing:0.08em;font-family:ui-monospace,monospace;display:flex;align-items:center">BLOOM-</span>' +
        '<input id="duel-opponent-suffix" dir="ltr" maxlength="4" inputmode="latin" autocapitalize="characters" autocomplete="off" placeholder="XXXX" value="' + pre + '" style="flex:1;padding:8px;border:0;font-family:ui-monospace,monospace;font-size:16px;text-transform:uppercase;letter-spacing:0.2em;font-weight:700;text-align:center;outline:none;background:transparent;direction:ltr">' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">💪 רמת קושי (לשניכם)</div>' +
      '<div id="duel-difficulty" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" class="diff-pill selected" data-diff="default" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:600;cursor:pointer">📦 רגיל</button>' +
        '<button type="button" class="diff-pill" data-diff="easy" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">😊 קל</button>' +
        '<button type="button" class="diff-pill" data-diff="medium" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🎯 בינוני</button>' +
        '<button type="button" class="diff-pill" data-diff="hard" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🔥 קשה</button>' +
        '<button type="button" class="diff-pill" data-diff="insane" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">💀 גהינום</button>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">הימור (אופציונלי)</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<input type="number" id="duel-amount" value="0" min="0" style="width:80px;padding:6px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-align:center;font-weight:700">' +
        '<span style="font-size:12px;color:#6F6E68">💎 · המנצח לוקח הכל (minus 5% עמלה)</span>' +
      '</div>' +
      '<button class="btn" id="duel-send" style="width:100%;margin-bottom:6px">שלח אתגר ⚔️</button>' +
      // Send gift — peaceful counterpart to a duel. Same input (BLOOM-XXXX
      // suffix), small gem amount, optional message. Recipient sees a
      // toast banner next time they open the app.
      '<button class="btn" id="duel-gift" style="width:100%;margin-bottom:10px;background:transparent;color:#BA7517;border:1px solid #FAC775">🎁 שלח מתנה לחבר</button>' +
      '<div id="duel-error" style="color:#C8472F;font-size:12px;text-align:center;min-height:18px"></div>' +
      '<div style="border-top:1px solid rgba(0,0,0,0.06);margin-top:10px;padding-top:10px">' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:6px">הדו-קרבות שלי</div>' +
        '<div id="duel-list" style="font-size:12px;color:#6F6E68">טוען...</div>' +
      '</div>' +
      '<button class="btn secondary" style="width:100%;margin-top:10px" onclick="this.closest(\'.info-modal\').remove()">סגור</button>' +
    '</div>';
    document.body.appendChild(modal);

    // Load my duels
    loadMyDuels();

    // Gift-to-friend opens a dedicated modal — uses the SAME suffix as
    // the duel form is pre-filled with (if the player typed one) so a
    // single typed code can be reused for either "challenge" or "gift".
    var giftBtn = document.getElementById('duel-gift');
    if (giftBtn) giftBtn.onclick = function() {
      var prefSuf = ((document.getElementById('duel-opponent-suffix') || {}).value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      showGiftFriendModal(prefSuf);
    };

    // Difficulty pill picker (challenger picks one — both players get it)
    var selectedDuelDifficulty = 'default';
    modal.querySelectorAll('.diff-pill').forEach(function(pill) {
      pill.onclick = function() {
        modal.querySelectorAll('.diff-pill').forEach(function(p) {
          p.classList.remove('selected');
          p.style.background = '#F5F2EC';
          p.style.color = '#1C1A18';
        });
        pill.classList.add('selected');
        pill.style.background = '#1C1A18';
        pill.style.color = '#FAC775';
        selectedDuelDifficulty = pill.getAttribute('data-diff') || 'default';
      };
    });

    // "My code" pill — copy to clipboard
    var myPill = document.getElementById('duel-my-code');
    if (myPill) {
      myPill.onclick = function() {
        if (typeof playerCode === 'undefined' || !playerCode) return;
        var copy = function() {
          var orig = myPill.innerHTML;
          myPill.innerHTML = '<span style="color:#2E8B6F;font-weight:700">✓ הקוד הועתק! שלח לחבר שיאתגר אותך</span>';
          setTimeout(function() { myPill.innerHTML = orig; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(playerCode).then(copy, copy);
        } else { copy(); }
      };
    }

    // Suffix input: strip "BLOOM-" prefix on paste, enforce charset
    var suffixEl = document.getElementById('duel-opponent-suffix');
    if (suffixEl) {
      suffixEl.addEventListener('paste', function(e) {
        var t = (e.clipboardData || window.clipboardData).getData('text') || '';
        var cleaned = t.toUpperCase().replace(/^BLOOM-/, '').replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
        if (cleaned) {
          e.preventDefault();
          suffixEl.value = cleaned;
        }
      });
      suffixEl.addEventListener('input', function() {
        var v = (suffixEl.value || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
        if (v !== suffixEl.value) suffixEl.value = v;
      });
      setTimeout(function() { try { suffixEl.focus(); } catch(_) {} }, 50);
    }

    // Send challenge
    document.getElementById('duel-send').onclick = async function() {
      var suf = ((document.getElementById('duel-opponent-suffix') || {}).value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      var opp = 'BLOOM-' + suf;
      var amt = parseInt(document.getElementById('duel-amount').value, 10) || 0;
      var errEl = document.getElementById('duel-error');
      errEl.style.color = '#C8472F';
      errEl.textContent = '';
      if (suf.length !== 4) { errEl.textContent = 'הקוד חייב להיות 4 תווים (אותיות וספרות)'; return; }
      if (amt > 0 && playerBalance < amt) { errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + ')'; return; }
      this.disabled = true; this.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/duels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, opponentCode: opp, amount: amt, difficulty: selectedDuelDifficulty })
        });
        var d = await r.json();
        this.disabled = false; this.textContent = 'שלח אתגר ⚔️';
        if (d && d.ok) {
          if (amt > 0) { playerBalance -= amt; updateBalanceDisplay(); }
          errEl.style.color = '#2E8B6F';
          errEl.textContent = '✅ אתגר נשלח! מתחיל את המשחק שלך…';
          // Auto-start the challenger's game IMMEDIATELY. Without this the
          // challenger has to refresh and click "Play" manually — the bug
          // the user reported ("המשחק לא מצליח עד שעושה רענון"). The server
          // now accepts score submissions while the duel is still 'pending',
          // and settlement waits for both sides to submit.
          var duelRow = d.duel || {
            id: d.duelId,
            board_seed: d.seed,
            difficulty_label: d.difficulty,
            difficulty_weights: null,
            difficulty_speed_pct: null
          };
          activeDuelOpponentName = duelRow.opponent_name || opp;
          // First-time social action = ideal moment to ask for push
          // permission. The pre-prompt has its own 3-day cooldown so
          // this can be called liberally.
          try {
            if (typeof window.__bloomMaybeAskPush === 'function') {
              window.__bloomMaybeAskPush('כשהיריב יקבל / יסרב / יסיים — תקבל הודעה מיד, גם כשהמשחק סגור.');
            }
          } catch (e) {}
          setTimeout(function() {
            var m = document.getElementById('duel-modal');
            if (m) m.remove();
            startDuelGame(duelRow.id, duelRow.board_seed, duelRow);
          }, 600); // brief confirmation flash before transitioning
        } else {
          var msgs = { self_duel: 'לא ניתן לאתגר את עצמך', opponent_not_found: 'שחקן לא נמצא', insufficient_balance: 'אין מספיק 💎', duels_disabled: 'דו-קרבות מושבתים' };
          errEl.textContent = msgs[d.reason] || 'שגיאה';
        }
      } catch(e) { this.disabled = false; this.textContent = 'שלח אתגר ⚔️'; errEl.textContent = 'שגיאת רשת'; }
    };
  }

  // Provide a no-op fallback so this file works even if 05a-home-v2.js
  // is concatenated later than expected.
  function markDuelAcknowledged(id) {
    if (typeof window.__bloomMarkDuelAcknowledged === 'function') window.__bloomMarkDuelAcknowledged(id);
  }
  function markAllDuelsAcknowledged(ids) {
    if (typeof window.__bloomMarkAllDuelsAcknowledged === 'function') window.__bloomMarkAllDuelsAcknowledged(ids);
  }

  async function loadMyDuels() {
    var el = document.getElementById('duel-list');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels || !d.duels.length) { el.textContent = 'אין דו-קרבות'; return; }
      // Opening the modal = the user is now LOOKING at the list.
      // Mark every currently-visible duel as acknowledged so the red
      // badge on the home action button clears on next render.
      markAllDuelsAcknowledged(d.duels.map(function(x) { return x.id; }));
      var html = '';
      d.duels.forEach(function(duel) {
        var isChallenger = duel.challenger_device === deviceId;
        var otherName = isChallenger ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
        var statusMap = { pending: '⏳ ממתין', accepted: '🎮 משחקים', settled: '✅ הסתיים', tie: '🤝 תיקו', expired: '⏰ פג תוקף', declined: '✕ נדחה' };
        var statusText = statusMap[duel.status] || duel.status;
        var amtText = (duel.amount | 0) > 0 ? ' · ' + duel.amount + '💎' : '';
        var winText = '';
        // Render the actual score line on every terminal duel — settled
        // OR tie. Players were leaving the list none the wiser about by
        // how much they won/lost; the scores are the whole satisfaction
        // of a duel.
        var myScoreRow = isChallenger ? duel.challenger_score : duel.opponent_score;
        var oppScoreRow = isChallenger ? duel.opponent_score : duel.challenger_score;
        var scoreLine = '';
        if ((duel.status === 'settled' || duel.status === 'tie') && myScoreRow != null && oppScoreRow != null) {
          scoreLine = ' · <span style="color:#6F6E68;font-size:11px">' +
            (myScoreRow | 0).toLocaleString() + ' vs ' + (oppScoreRow | 0).toLocaleString() +
          '</span>';
        }
        if (duel.status === 'settled' && duel.winner_device) {
          winText = duel.winner_device === deviceId ? ' · <strong style="color:#2E8B6F">ניצחת!</strong>' : ' · <span style="color:#C8472F">הפסדת</span>';
        }
        var actionBtn = '';
        if (duel.status === 'pending' && !isChallenger) {
          // Two-button row: accept + decline. The decline path is what the
          // user explicitly asked for — previously the only way out of a
          // pending duel was to play it. Now: ✕ דחה calls the new
          // /api/duels/:id/decline (refunds the challenger's wager).
          actionBtn =
            '<span style="display:inline-flex;gap:4px">' +
              '<button class="btn sm" style="font-size:10px;padding:3px 8px" onclick="acceptDuel(' + duel.id + ')">קבל ⚔️</button>' +
              '<button class="btn sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid rgba(0,0,0,0.15);color:#6F6E68" onclick="declineDuel(' + duel.id + ')">✕ דחה</button>' +
            '</span>';
        } else if (duel.status === 'declined') {
          actionBtn = '<span style="font-size:10px;color:#6F6E68">דחיתי ✕</span>';
        } else if (duel.status === 'accepted') {
          var myScore = isChallenger ? duel.challenger_score : duel.opponent_score;
          if (myScore == null) {
            actionBtn = '<button class="btn sm" style="font-size:10px;padding:3px 8px;background:#BA7517" onclick="playDuel(' + duel.id + ')">🎮 שחק</button>';
          } else {
            actionBtn = '<span style="font-size:10px;color:#2E8B6F">✓ סיימת (' + (myScore|0).toLocaleString() + ')</span>';
          }
        }
        // Rematch ⚔️ — let the player re-challenge the same opponent on
        // any terminal-state row (settled/tie/declined/expired). Pulls
        // the opponent's BLOOM code (suffix) from the duel row and
        // re-opens the duel modal pre-filled. This is a major retention
        // lever — the closest BLOOM gets to a "play again" loop is the
        // FRIEND already in this list; surfacing a one-tap rematch turns
        // the duel list into a personal opponent leaderboard.
        var rematchBtn = '';
        var isTerminal = duel.status === 'settled' || duel.status === 'tie' ||
                         duel.status === 'declined' || duel.status === 'expired';
        if (isTerminal) {
          var otherCode = isChallenger ? duel.opponent_code : duel.challenger_code;
          if (otherCode) {
            var sufRematch = String(otherCode).replace(/^BLOOM-/i, '').toUpperCase().slice(0, 4);
            if (sufRematch.length === 4) {
              rematchBtn = ' <button class="btn sm" title="אתגר שוב" style="font-size:11px;padding:3px 10px;background:#FAC775;color:#412402;border:none;font-weight:700" onclick="rematchDuel(\'' + sufRematch + '\')">⚔️ שוב</button>';
            }
          }
        }
        html += '<div style="padding:6px 0;border-top:1px solid rgba(0,0,0,0.04);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<span style="flex:1;min-width:0">' +
            '<span style="font-weight:600">vs ' + otherName + '</span>' + amtText + ' · ' + statusText + winText + scoreLine +
          '</span>' +
          actionBtn + rematchBtn +
        '</div>';
      });
      el.innerHTML = html;
    } catch(e) { el.textContent = 'שגיאה בטעינה'; }
  }

  window.acceptDuel = async function(id) {
    var r = await fetch(API_BASE + '/api/duels/' + id + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
    });
    var d = await r.json();
    if (d && d.ok) {
      markDuelAcknowledged(id); // clear it from the badge count
      fetchPlayerCode();
      loadMyDuels();
      activeDuelOpponentName = d.duel ? (d.duel.challenger_name || d.duel.challenger_code || 'יריב') : 'יריב';
      startDuelGame(id, d.duel.board_seed, d.duel);
    } else {
      var msgs = { not_opponent: 'אתה לא היריב', not_pending: 'כבר קיבלת', expired: 'פג תוקף', insufficient_balance: 'אין מספיק 💎' };
      alert(msgs[d && d.reason] || 'שגיאה');
    }
  };

  // Decline a pending duel. Opponent-only; refunds the challenger's
  // wager on the server. A tiny native confirm() guards the click so
  // a fat-finger tap on a tiny mobile row doesn't kill the duel.
  window.declineDuel = async function(id) {
    if (!window.confirm('לדחות את הדו-קרב? היריב יקבל את ההימור בחזרה.')) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/' + id + '/decline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
      });
      var d = await r.json();
      if (d && d.ok) {
        // Mark as acknowledged so the home badge clears too.
        if (typeof markDuelAcknowledged === 'function') markDuelAcknowledged(id);
        loadMyDuels();
        if (typeof window.__bloomToast === 'function') window.__bloomToast('דו-קרב נדחה', 'info');
      } else {
        var msgs = {
          not_opponent: 'אתה לא היריב',
          not_pending: 'כבר טופל',
          not_found: 'הדו-קרב לא נמצא',
          race: 'הדו-קרב כבר השתנה. רענן ונסה שוב',
          missing_token: 'התחבר מחדש',
          bad_token: 'התחבר מחדש'
        };
        alert(msgs[d && d.reason] || 'שגיאה');
      }
    } catch (e) {
      alert('שגיאה בחיבור');
    }
  };

  // Re-challenge an opponent from a terminal-state duel row. The list
  // sits INSIDE the duel modal, so we close + reopen it pre-filled
  // with the opponent's 4-char suffix. The player taps "שלח אתגר" and
  // the existing flow takes over from there.
  window.rematchDuel = function(suffix) {
    var clean = String(suffix || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    if (clean.length !== 4) return;
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    showDuelModal({ prefillSuffix: clean });
  };

  window.playDuel = async function(id) {
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels) return;
      var duel = d.duels.find(function(dd) { return dd.id === id; });
      if (!duel || duel.status !== 'accepted') { alert('הדו-קרב לא פעיל'); return; }
      var isChallenger = duel.challenger_device === deviceId;
      activeDuelOpponentName = isChallenger ? (duel.opponent_name || duel.opponent_code || 'יריב') : (duel.challenger_name || duel.challenger_code || 'יריב');
      startDuelGame(id, duel.board_seed, duel);
    } catch(e) { alert('שגיאת רשת'); }
  };

  // Active duel state
  var activeDuelId = null;
  var activeDuelOpponentName = 'יריב';

  // ============================================================
  // LIVE OPPONENT HUD — visible during the player's active duel game
  // ============================================================
  // The user's ask: "players want to see their opponent's score while
  // playing". Previously you could only see the opponent's score AFTER
  // you submitted yours. That turned every duel into 2 separate games
  // stitched at the end. This HUD turns it into an actual race — every
  // tap of YOUR board is a reaction to the live score next to you.
  //
  // Data path:
  //   - GET /api/duels/:id every 3s gives us the opponent's committed
  //     state (final score if set, otherwise their assigned device_id)
  //   - GET /api/live-state/:opponentDeviceId every 3s gives us the
  //     opponent's IN-PROGRESS score (fed by their 5s heartbeats)
  //   - We merge the two: final score wins; otherwise live score; else
  //     "waiting to accept".
  // ============================================================
  var _duelHudPoller = null;
  var _duelHudDuelRow = null;
  var _duelHudLastOppScore = null;  // for "score jump" flash animation
  var _duelHudFinalized = false;    // stops polling once opponent finalized
  var _duelHudOppFinishedAnnounced = false; // single big-toast on transition

  function startDuelOpponentHud(duelRow) {
    if (!duelRow) return;
    stopDuelOpponentHud();
    _duelHudDuelRow = duelRow;
    _duelHudLastOppScore = null;
    _duelHudFinalized = false;
    _duelHudOppFinishedAnnounced = false;
    renderDuelHud();
    // First tick fires immediately so the HUD isn't empty for 2s
    refreshDuelHudData();
    // Tightened from 3s → 2s. The /api/duels/:id query is cheap (single
    // row read) and the lag was noticeable when an opponent merged —
    // the player's eye sees the action in real life faster than the
    // HUD reflected it. 2s gets us inside the perception window.
    _duelHudPoller = setInterval(refreshDuelHudData, 2000);
    // Also update the "my score" side via a fast tick that just reads
    // the game's score global — no network needed.
    _duelHudMyScoreTick = setInterval(syncDuelHudMyScore, 500);
  }

  function stopDuelOpponentHud() {
    if (_duelHudPoller) { clearInterval(_duelHudPoller); _duelHudPoller = null; }
    if (_duelHudMyScoreTick) { clearInterval(_duelHudMyScoreTick); _duelHudMyScoreTick = null; }
    var hud = document.getElementById('duel-hud');
    if (hud) hud.remove();
    _duelHudDuelRow = null;
    _duelHudLastOppScore = null;
    _duelHudFinalized = false;
    _duelHudOppFinishedAnnounced = false;
  }

  // Big toast that fires once when the opponent transitions from
  // 'playing' to 'finished' during the player's own duel game. This
  // is the dramatic moment the user explicitly asked for — the
  // player needs to FEEL "your opponent locked in their score, you
  // now have a target". HUD color change alone is too subtle.
  function showOpponentFinishedToast(oppScore) {
    var oppName = window._duelOpponentName || 'יריב';
    var myScore = (typeof score === 'number') ? score : 0;
    var diff = (myScore | 0) - (oppScore | 0);
    var rallyText, color;
    if (diff > 0) {
      rallyText = 'אתה מוביל ב-' + diff.toLocaleString() + ' — תשמור על זה!';
      color = '#2E8B6F';
    } else if (diff < 0) {
      rallyText = 'צריך עוד ' + Math.abs(diff).toLocaleString() + ' נקודות כדי לנצח!';
      color = '#FF6B6B';
    } else {
      rallyText = 'אתם תיקו — כל merge קובע!';
      color = '#BA7517';
    }
    var t = document.createElement('div');
    t.id = 'duel-opp-finished-toast';
    t.style.cssText =
      'position:fixed;left:50%;top:max(72px, env(safe-area-inset-top));' +
      'transform:translateX(-50%) translateY(-30px);opacity:0;' +
      'transition:opacity 280ms ease-out, transform 280ms ease-out;' +
      'z-index:9700;background:linear-gradient(135deg,#1C1A18,#2A2724);' +
      'border:2px solid ' + color + ';border-radius:16px;padding:14px 18px;' +
      'direction:rtl;font-family:inherit;color:#F2EFE9;' +
      'box-shadow:0 12px 32px rgba(0,0,0,0.5);max-width:340px;' +
      'width:calc(100vw - 32px);text-align:center;';
    t.innerHTML =
      '<div style="font-size:30px;line-height:1;margin-bottom:4px">🏁</div>' +
      '<div style="font-size:14px;font-weight:800;color:#FFF;line-height:1.3">' +
        escDuelHtml(oppName) + ' סיים/ה עם <span style="color:' + color + '">' +
        (oppScore | 0).toLocaleString() + '</span></div>' +
      '<div style="font-size:12px;color:#FAC775;margin-top:4px;font-weight:600">' + rallyText + '</div>';
    document.body.appendChild(t);
    requestAnimationFrame(function() {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Tactile cue: short buzz so the player feels the moment
    try { if (typeof buzz === 'function') buzz([18, 40, 18]); } catch (e) {}
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(-30px)';
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3800);
  }
  var _duelHudMyScoreTick = null;

  function renderDuelHud() {
    if (document.getElementById('duel-hud')) return;
    var iAmChallenger = _duelHudDuelRow && _duelHudDuelRow.challenger_device === deviceId;
    var oppName = iAmChallenger
      ? (_duelHudDuelRow.opponent_name || _duelHudDuelRow.opponent_code || 'יריב')
      : (_duelHudDuelRow.challenger_name || _duelHudDuelRow.challenger_code || 'יריב');
    var hud = document.createElement('div');
    hud.id = 'duel-hud';
    hud.className = 'duel-hud';
    hud.innerHTML =
      '<div class="duel-hud-side duel-hud-me">' +
        '<div class="duel-hud-label">אתה</div>' +
        '<div class="duel-hud-score" id="duel-hud-my-score">0</div>' +
      '</div>' +
      '<div class="duel-hud-vs">' +
        '<div class="duel-hud-vs-icon">⚔️</div>' +
        '<div class="duel-hud-delta" id="duel-hud-delta">--</div>' +
        '<div class="duel-hud-status" id="duel-hud-status">טוען...</div>' +
      '</div>' +
      '<div class="duel-hud-side duel-hud-opp">' +
        '<div class="duel-hud-label">' + escDuelHtml(oppName) + '</div>' +
        '<div class="duel-hud-score" id="duel-hud-opp-score">--</div>' +
      '</div>' +
      // Exit button — taps to confirm + submit current score as final.
      // Gives the player a graceful way out of a duel they don't want
      // to finish, without forfeiting their accumulated points.
      '<button class="duel-hud-exit" id="duel-hud-exit" aria-label="צא מהדו-קרב" type="button">✕</button>';
    // Append to document.body (NOT .app) — .app has overflow:hidden
    // which has clipped fixed children on some Safari versions. Body
    // is the safest containing block for a position:fixed element.
    document.body.appendChild(hud);
    // Wire the exit handler. Uses native confirm() so a fat-finger tap
    // can't accidentally end the duel.
    var exitBtn = document.getElementById('duel-hud-exit');
    if (exitBtn) exitBtn.onclick = function(e) {
      e.stopPropagation();
      exitDuelEarly();
    };
    try { console.info('[duel-hud] mounted', { iAmChallenger: iAmChallenger, oppName: oppName }); } catch (e) {}
  }

  // §Bug 2 — graceful exit. Submits the player's current score as the
  // final value (so the opponent still gets a target to beat), then
  // tears down the duel game and routes back to home. The native
  // confirm() shows the actual current score so the player knows
  // exactly what they're locking in.
  function exitDuelEarly() {
    var myScore = (typeof score === 'number') ? score : 0;
    var msg = myScore > 0
      ? 'תסיים את הדו-קרב עכשיו? הניקוד שלך (' + myScore.toLocaleString() + ') יוגש כסופי.\n' +
        'היריב עוד יכול לשחק נגדך.'
      : 'תסיים את הדו-קרב? תאבד את ההימור והניקוד שלך יהיה 0.';
    if (!window.confirm(msg)) return;
    // Pull together the values submitDuelScore needs from the engine.
    var finalScore = myScore;
    // Stop the HUD's pollers + remove the DOM immediately so we don't
    // race against the result overlay.
    try { stopDuelOpponentHud(); } catch (e) {}
    // Mark the game as "over" so the engine + heartbeats stop. The
    // existing submitDuelScore() flow handles the server submission
    // and result-overlay rendering — we just reuse it.
    try { window.__bloomGameOver = true; } catch (e) {}
    try { if (typeof submitDuelScore === 'function') submitDuelScore(finalScore); } catch (e) {
      console.warn('[duel-hud] exit submit failed', e);
    }
    try { trackEvent('duel_early_exit', { finalScore: finalScore }); } catch (e) {}
  }

  function syncDuelHudMyScore() {
    var el = document.getElementById('duel-hud-my-score');
    if (!el) return;
    var myScore = (typeof score === 'number') ? score : 0;
    el.textContent = myScore.toLocaleString();
    // Also refresh the delta so it stays in sync with my score growth
    paintDuelHudDelta(myScore, _duelHudLastOppScore);
  }

  function refreshDuelHudData() {
    if (!_duelHudDuelRow || !activeDuelId) return;
    // Stop polling /api/duels/:id once we have the opponent's final score
    // (no reason to keep hitting the DB after that). Live-state still
    // polls below if applicable.
    fetch(API_BASE + '/api/duels/' + activeDuelId + '?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(resp) {
        if (!resp || !resp.duel) return;
        var u = resp.duel;
        _duelHudDuelRow = u; // refresh stored row
        var iAmChallenger = u.challenger_device === deviceId;
        var oppFinalScore = iAmChallenger ? u.opponent_score : u.challenger_score;
        var oppDeviceId   = iAmChallenger ? u.opponent_device : u.challenger_device;
        if (oppFinalScore != null) {
          _duelHudFinalized = true;
          paintDuelHud({
            oppScore: oppFinalScore,
            oppStatus: 'finished',
            oppDeviceId: oppDeviceId
          });
          return;
        }
        // Opponent hasn't finalized — check if they're playing live.
        if (oppDeviceId) {
          fetch(API_BASE + '/api/live-state/' + encodeURIComponent(oppDeviceId))
            .then(function(r2) {
              // 404 = no recent heartbeat yet (within 60s window). That's
              // not an error — it just means the opponent is accepted but
              // hasn't started playing yet. Treat it as 'accepted'.
              if (r2.status === 404) return null;
              return r2.ok ? r2.json() : null;
            })
            .then(function(live) {
              // BUG FIX: server returns the field as `score`, NOT `live_score`.
              // The old guard `typeof live.live_score === 'number'` always
              // failed → HUD never showed the opponent's actual live score.
              if (live && typeof live.score === 'number') {
                paintDuelHud({
                  oppScore: live.score,
                  oppStatus: 'playing',
                  oppDeviceId: oppDeviceId
                });
              } else {
                paintDuelHud({
                  oppScore: null,
                  oppStatus: 'accepted',
                  oppDeviceId: oppDeviceId
                });
              }
            })
            .catch(function(err) {
              // Surface fetch failures so we can see them in DevTools
              // instead of silently downgrading to "accepted" state.
              console.warn('[duel-hud] live-state fetch failed', err);
              paintDuelHud({ oppScore: null, oppStatus: 'accepted', oppDeviceId: oppDeviceId });
            });
        } else {
          // Pending: opponent hasn't even accepted yet (challenger case)
          paintDuelHud({ oppScore: null, oppStatus: 'pending', oppDeviceId: null });
        }
      })
      .catch(function(err) {
        // Surface duel-state fetch failures too — same reasoning as above.
        console.warn('[duel-hud] duel-state fetch failed', err);
      });
  }

  function paintDuelHud(state) {
    var scoreEl  = document.getElementById('duel-hud-opp-score');
    var statusEl = document.getElementById('duel-hud-status');
    var hud      = document.getElementById('duel-hud');
    if (!scoreEl || !statusEl || !hud) return;

    // Status text + visual class
    hud.classList.remove('duel-hud-status-pending', 'duel-hud-status-accepted',
                          'duel-hud-status-playing', 'duel-hud-status-finished');
    if (state.oppStatus === 'pending') {
      statusEl.textContent = 'עדיין לא קיבל';
      scoreEl.textContent  = '--';
      hud.classList.add('duel-hud-status-pending');
    } else if (state.oppStatus === 'accepted') {
      statusEl.textContent = 'מקבל אתגר';
      scoreEl.textContent  = '0';
      hud.classList.add('duel-hud-status-accepted');
    } else if (state.oppStatus === 'playing') {
      statusEl.textContent = '🎮 משחק';
      hud.classList.add('duel-hud-status-playing');
      // Flash the score if it just jumped (opponent merged → score went up)
      var prev = _duelHudLastOppScore;
      scoreEl.textContent = (state.oppScore | 0).toLocaleString();
      if (prev != null && state.oppScore > prev) {
        scoreEl.classList.remove('duel-hud-score-bump');
        // Force reflow so re-adding the class restarts the animation
        void scoreEl.offsetWidth;
        scoreEl.classList.add('duel-hud-score-bump');
      }
    } else if (state.oppStatus === 'finished') {
      statusEl.textContent = '🏁 סיים — תנצח אותו!';
      scoreEl.textContent  = (state.oppScore | 0).toLocaleString();
      hud.classList.add('duel-hud-status-finished');
      // Stop the heavy /api/duels/:id polling once we have the target —
      // we just need to keep updating MY score, which is the local tick.
      if (_duelHudPoller) { clearInterval(_duelHudPoller); _duelHudPoller = null; }
      // First-time transition into 'finished' deserves a big moment —
      // a celebratory toast that calls out the opponent's score as the
      // new target. Without this, the HUD changes color but the player
      // might miss that their opponent just locked in.
      if (!_duelHudOppFinishedAnnounced) {
        _duelHudOppFinishedAnnounced = true;
        showOpponentFinishedToast(state.oppScore);
      }
    }

    _duelHudLastOppScore = state.oppScore;
    var myScore = (typeof score === 'number') ? score : 0;
    paintDuelHudDelta(myScore, state.oppScore);
  }

  // Delta pill — "+580 💪" if leading, "-200 😬" if behind, "=" if tied
  function paintDuelHudDelta(myScore, oppScore) {
    var el = document.getElementById('duel-hud-delta');
    if (!el) return;
    if (oppScore == null) { el.textContent = ''; el.className = 'duel-hud-delta'; return; }
    var d = (myScore | 0) - (oppScore | 0);
    if (d > 0) {
      el.textContent = '+' + d.toLocaleString() + ' 💪';
      el.className = 'duel-hud-delta duel-hud-delta-ahead';
    } else if (d < 0) {
      el.textContent = d.toLocaleString() + ' 😬';
      el.className = 'duel-hud-delta duel-hud-delta-behind';
    } else {
      el.textContent = '= תיקו';
      el.className = 'duel-hud-delta duel-hud-delta-tied';
    }
  }

  function startDuelGame(duelId, seed, duelRow) {
    activeDuelId = duelId;
    // Close the duel modal
    var modal = document.getElementById('duel-modal');
    if (modal) modal.remove();
    // Hide home if open
    hideHome();
    // Start the game with the duel's seed
    mode = 'practice'; // engine uses practice mode
    window._duelMode = true; // flag for UI
    window._duelOpponentName = activeDuelOpponentName || 'יריב';
    dailyDate = todayInIsrael();
    // Apply the challenger-chosen difficulty (both sides get the same one).
    // Falls back to admin globals if the duel row predates the difficulty
    // columns or the challenger picked 'default'.
    if (duelRow && duelRow.difficulty_weights) {
      sessionDifficulty = {
        label: duelRow.difficulty_label || 'custom',
        weights: duelRow.difficulty_weights,
        speed_pct: duelRow.difficulty_speed_pct || null
      };
    } else {
      sessionDifficulty = null;
    }
    // Dynamic Boards (phase 3, May 2026): duel-snapshotted board.
    // The server stored board_multipliers (+ board_name) on the duel row
    // at creation time. Both players read the same snapshot — guarantees
    // fairness even if admin changes the active board mid-duel. Vanilla
    // duel = no snapshot.
    if (typeof setColumnMultipliers === 'function') setColumnMultipliers(null);
    if (typeof setSpecialCells === 'function') setSpecialCells(null);
    window._activeSpecialBoard = null;
    if (duelRow && typeof applyDuelBoardSnapshot === 'function') {
      applyDuelBoardSnapshot(duelRow);
    }
    grid = Array.from({length: getBoardRows()}, function() { return Array(getBoardCols()).fill(0); });
    score = 0; highestTier = 1; busy = false; dropsCount = 0;
    window.__bloomGameOver = false; // duel = active game
    currentGameMaxChain = 0;
    tierUpHit = {};
    gameMergesPerTier = {};
    gamePointsPerTier = {};
    gameBestMergeTier = 0;
    gameTotalMerges = 0;
    gameStartTime = Date.now();
    // Use the duel's board seed for deterministic RNG
    rng = mulberry32(seed);
    dailySubmitted = false;
    nextPiece = pickPiece();
    updateModeBar();
    render();
    // Toast for special-board duels — "this duel has bonus columns!"
    if (window._activeSpecialBoard && typeof showSpecialBoardToast === 'function') {
      try { showSpecialBoardToast(window._activeSpecialBoard); } catch (e) {}
    }
    playMusic('game');
    ensureAudio();
    startEventSystem();
    trackEvent('duel_start', { duelId: duelId });
    // §LIVE OPPONENT HUD — kick off the real-time opponent-score widget
    // the moment the duel game starts. Self-tears-down via submitDuelScore.
    try { startDuelOpponentHud(duelRow); } catch (e) { console.warn('[duel-hud]', e); }
  }

  // Called from game-over to submit duel score
  function submitDuelScore(finalScore) {
    if (!activeDuelId) return;
    var duelId = activeDuelId;
    var oppName = window._duelOpponentName || 'יריב';
    activeDuelId = null;
    // Tear down the live opponent HUD — the game-over overlay takes
    // over from here, so the HUD's job is done.
    try { stopDuelOpponentHud(); } catch (e) {}
    window._duelMode = false;
    fetch(API_BASE + '/api/duels/' + duelId + '/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        score: finalScore,
        drops: (typeof dropsCount === 'number' ? dropsCount : 0) | 0,
        token: deviceToken
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      showDuelResultOverlay(d, finalScore, oppName);
      if (d && (d.result === 'tie' || (d.result === 'settled' && d.winner === 'you'))) fetchPlayerCode();
      trackEvent('duel_score', { duelId: duelId, result: d && d.result });
      // If we're still 'waiting' for the opponent, poll the duel state so we
      // can flip the overlay from "..." to the real result the moment the
      // opponent finishes. Bug 4: previously the overlay stayed stuck on
      // "ממתין ליריב..." forever, even after opponent had submitted.
      // ALSO: attach a live spectator view of the opponent's actual game so
      // the player can watch instead of staring at a "..." spinner.
      if (d && d.result === 'waiting') {
        pollDuelUntilSettled(duelId, finalScore, oppName);
        attachDuelLiveSpectator(duelId, finalScore, oppName);
      }
    }).catch(function() {
      showDuelResultOverlay({ result: 'error' }, finalScore, oppName);
    });
  }

  // Poll a duel after we submitted but the opponent hasn't yet. Stops as soon
  // as the duel becomes 'settled' or 'tie', or after 5 minutes (whichever
  // comes first). Updates the in-flight result overlay in place.
  function pollDuelUntilSettled(duelId, myScore, oppName) {
    var attempts = 0;
    var maxAttempts = 150; // 150 × 2s = 5 minutes of active polling
    var poller = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        // The duel hasn't resolved in 5 minutes. Don't leave the player
        // staring at a frozen spinner — swap the overlay to a friendly
        // "go do something else, we'll notify you" state and stop the
        // background spectator. The home-side checkIncomingDuels poll
        // (every 60s) will pick up the eventual settle/decline/expire
        // and surface it via the banner.
        clearInterval(poller);
        stopDuelLiveSpectator();
        replaceDuelResultOverlay({
          result: 'unresolved',
          opponentName: oppName
        }, myScore, oppName);
        return;
      }
      fetch(API_BASE + '/api/duels/' + duelId + '?deviceId=' + encodeURIComponent(deviceId), { method: 'GET' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(resp) {
          if (!resp || !resp.duel) return;
          var u = resp.duel;
          var isChallenger = u.challenger_device === deviceId;
          // Settled / tie — the normal happy path.
          if (u.status === 'settled' || u.status === 'tie') {
            clearInterval(poller);
            stopDuelLiveSpectator();
            var oppScore = isChallenger ? u.opponent_score : u.challenger_score;
            var winner = null;
            if (u.status === 'settled') {
              winner = u.winner_device === deviceId ? 'you' : 'opponent';
            }
            var prize = u.amount ? Math.round((u.amount | 0) * 2 * 0.95) : 0;
            replaceDuelResultOverlay({
              result: u.status === 'tie' ? 'tie' : 'settled',
              winner: winner,
              opponentScore: oppScore,
              prize: prize
            }, myScore, oppName);
            if (winner === 'you' || u.status === 'tie') fetchPlayerCode();
            return;
          }
          // NEW: opponent declined, or duel auto-expired past its TTL.
          // Both are terminal — refund already happened server-side.
          // Surface a clear "you got your gems back, no win/loss" overlay
          // so the challenger isn't stuck on "ממתין ליריב..." forever.
          if (u.status === 'declined' || u.status === 'expired') {
            clearInterval(poller);
            stopDuelLiveSpectator();
            replaceDuelResultOverlay({
              result: u.status,            // 'declined' or 'expired'
              opponentName: oppName,
              refund: u.amount | 0          // for the message body
            }, myScore, oppName);
            // The wager came back — refresh balance immediately so the
            // player sees the new total without waiting for the next
            // navigation.
            if (isChallenger) fetchPlayerCode();
            return;
          }
        })
        .catch(function() {});
    }, 2000);
  }

  // ============================================================
  // DUEL LIVE SPECTATOR — embed an actual live view of the opponent
  // inside the "waiting" overlay so the player watches them play
  // in real time, not a mirror, not a spinner. Polls the universal
  // /api/live-state/:deviceId endpoint (fed by 5s heartbeats).
  // ============================================================
  var _duelSpectatorPoller = null;
  var _duelSpectatorTargetId = null;

  function stopDuelLiveSpectator() {
    if (_duelSpectatorPoller) { clearInterval(_duelSpectatorPoller); _duelSpectatorPoller = null; }
    _duelSpectatorTargetId = null;
  }

  function attachDuelLiveSpectator(duelId, myScore, oppName) {
    // Fetch the duel row once to learn the opponent's deviceId, then start
    // the live-state poller and inject a mini-board into the waiting overlay.
    fetch(API_BASE + '/api/duels/' + duelId + '?deviceId=' + encodeURIComponent(deviceId), { method: 'GET' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(resp) {
        if (!resp || !resp.duel) return;
        var u = resp.duel;
        var oppDeviceId = (u.challenger_device === deviceId) ? u.opponent_device : u.challenger_device;
        if (!oppDeviceId) return;
        _duelSpectatorTargetId = oppDeviceId;
        injectDuelSpectatorWidget(myScore, oppName);
        // First poll immediately, then every 1.5s. Cheap: opponent's
        // heartbeat refreshes server-side every 5s, so we get a fresh
        // snapshot ≈3× per heartbeat — feels live without spamming.
        pollDuelLiveState();
        _duelSpectatorPoller = setInterval(pollDuelLiveState, 1500);
      })
      .catch(function() {});
  }

  function injectDuelSpectatorWidget(myScore, oppName) {
    var overlay = document.querySelector('[data-duel-result-overlay]');
    if (!overlay) return;
    // Find the inner card (the dark rounded box). It's the only direct child div.
    var card = overlay.querySelector('div');
    if (!card) return;
    // Don't inject twice
    if (overlay.querySelector('[data-duel-spec-widget]')) return;
    var ROWS = getBoardRows(), COLS = getBoardCols();
    var cellsHtml = '';
    for (var i = 0; i < ROWS * COLS; i++) cellsHtml += '<div class="dspec-cell" data-i="' + i + '"></div>';
    var widget = document.createElement('div');
    widget.setAttribute('data-duel-spec-widget', '1');
    widget.style.cssText = 'margin-top:14px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;direction:rtl';
    widget.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#9FE1CB">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#2E8B6F;animation:dspecPulse 1.2s ease-in-out infinite"></span>' +
          '<span>צופה ב-' + escapeHtml(oppName) + ' חי</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0" data-dspec-status>מתחבר…</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:center;gap:18px;margin-bottom:10px;font-size:11px">' +
        '<div style="text-align:center"><div style="color:#A8A6A0">ניקוד שלו</div><div data-dspec-score style="font-size:20px;font-weight:900;color:#FAC775">—</div></div>' +
        '<div style="text-align:center"><div style="color:#A8A6A0">הניקוד שלך</div><div style="font-size:20px;font-weight:900;color:#9FE1CB">' + myScore.toLocaleString() + '</div></div>' +
      '</div>' +
      // direction:ltr matches the main game's .grid-wrap (also ltr); without
      // this the cells flow right-to-left from the rtl widget parent and the
      // board reads as a horizontal mirror of what the opponent actually sees.
      '<div class="dspec-grid" style="direction:ltr;display:grid;grid-template-columns:repeat(' + COLS + ',1fr);gap:3px;background:#0E0D0C;padding:6px;border-radius:8px;max-width:200px;margin:0 auto">' + cellsHtml + '</div>' +
      '<style>' +
        '.dspec-cell{aspect-ratio:1;background:#2A2724;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;overflow:hidden}' +
        // Tier SVGs have viewBox but no width/height. Without explicit sizing
        // they fall back to UA-default ~300×150 and either overflow or render
        // invisibly — leaving cells looking like plain coloured squares. 65%
        // of the cell matches the main game ratio.
        '.dspec-cell svg{width:65%;height:65%;display:block}' +
        '@keyframes dspecPulse{0%,100%{opacity:1}50%{opacity:0.3}}' +
      '</style>';
    // Insert before the "Play Again" button — last child of card.
    var btn = card.querySelector('button');
    if (btn && btn.parentNode === card) card.insertBefore(widget, btn);
    else card.appendChild(widget);
  }

  function pollDuelLiveState() {
    if (!_duelSpectatorTargetId) return;
    // If the player dismissed the waiting overlay (e.g. clicked "play again"),
    // the widget is gone — tear down the poller so we don't keep hammering
    // the live-state endpoint in the background.
    if (!document.querySelector('[data-duel-spec-widget]')) {
      stopDuelLiveSpectator();
      return;
    }
    fetch(API_BASE + '/api/live-state/' + encodeURIComponent(_duelSpectatorTargetId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        var statusEl = document.querySelector('[data-dspec-status]');
        var scoreEl = document.querySelector('[data-dspec-score]');
        var gridHost = document.querySelector('[data-duel-spec-widget] .dspec-grid');
        if (!gridHost) return; // widget gone (overlay closed)
        if (!d) {
          if (statusEl) statusEl.textContent = '🔴 לא מחובר';
          return;
        }
        if (statusEl) statusEl.textContent = '🟢 מתעדכן';
        if (scoreEl) scoreEl.textContent = (d.score | 0).toLocaleString();
        if (!Array.isArray(d.grid)) return;
        var tiers = getActiveTiers();
        var cells = gridHost.children;
        var idx = 0;
        for (var r = 0; r < d.grid.length; r++) {
          var row = d.grid[r] || [];
          for (var c = 0; c < row.length; c++) {
            var cell = cells[idx];
            if (cell) {
              var t = row[c] | 0;
              if (t > 0 && tiers[t]) {
                cell.style.background = tiers[t].bg;
                cell.style.color = tiers[t].fg;
                cell.innerHTML = tiers[t].svg || '';
              } else {
                cell.style.background = '#2A2724';
                cell.style.color = '';
                cell.innerHTML = '';
              }
            }
            idx++;
          }
        }
      })
      .catch(function() {
        var statusEl = document.querySelector('[data-dspec-status]');
        if (statusEl) statusEl.textContent = '⚠️ שגיאת רשת';
      });
  }

  // Swap the existing "waiting" overlay for a fresh result overlay. Called
  // by the poller above when the opponent's score lands.
  function replaceDuelResultOverlay(d, myScore, oppName) {
    // Remove any open duel-result overlay (created by showDuelResultOverlay
    // — identified by the dark backdrop with the inline border style).
    document.querySelectorAll('[data-duel-result-overlay]').forEach(function(el) {
      el.remove();
    });
    showDuelResultOverlay(d, myScore, oppName);
  }

  function showDuelResultOverlay(d, myScore, oppName) {
    var emoji, title, detail, color, showConfettiFlag = false;
    var ctaLabel = 'שחק שוב';                  // default close-overlay CTA
    var ctaMode = 'practice';                  // default mode to start
    var hideScoresVs = false;                  // hide the vs ... ... block when opponent didn't play
    if (d && d.result === 'settled' && d.winner === 'you') {
      emoji = '🏆'; title = 'ניצחת!'; color = '#2E8B6F'; showConfettiFlag = true;
      detail = '<div style="font-size:14px;color:#9FE1CB;margin-top:6px">+' + (d.prize || 0) + ' 💎 פרס</div>';
    } else if (d && d.result === 'settled' && d.winner === 'opponent') {
      emoji = '😔'; title = 'הפסדת'; color = '#C8472F';
      detail = '<div style="font-size:14px;color:#F5C4B3;margin-top:6px">היריב היה טוב יותר הפעם</div>';
    } else if (d && d.result === 'tie') {
      emoji = '🤝'; title = 'תיקו!'; color = '#BA7517';
      detail = '<div style="font-size:14px;color:#FAC775;margin-top:6px">ההימור הוחזר</div>';
    } else if (d && d.result === 'declined') {
      // The opponent explicitly declined the duel. No win/loss for either
      // side; the wager has been refunded server-side already. Make the
      // copy upbeat — this isn't a "failure", just an asymmetric outcome.
      emoji = '🤷'; title = 'היריב סירב'; color = '#BA7517';
      detail = '<div style="font-size:13px;color:#FAC775;margin-top:6px">' + escDuelHtml(oppName || 'היריב') + ' לא הצטרף לדו-קרב' +
        (d.refund > 0 ? '<br>קיבלת חזרה <strong>' + d.refund + ' 💎</strong>' : '') +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'expired') {
      // The 24h window closed and the opponent never accepted. Server
      // auto-expired + refunded.
      emoji = '⏰'; title = 'פג תוקף'; color = '#BA7517';
      detail = '<div style="font-size:13px;color:#FAC775;margin-top:6px">' + escDuelHtml(oppName || 'היריב') + ' לא קיבל את האתגר בזמן' +
        (d.refund > 0 ? '<br>קיבלת חזרה <strong>' + d.refund + ' 💎</strong>' : '') +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'unresolved') {
      // 5 minutes of polling passed with no resolution. Don't hang the
      // player on a frozen spinner — give them a graceful exit + reassure
      // them they'll get notified later via the home banner.
      emoji = '⏳'; title = 'הניקוד שלך נשמר'; color = '#6B5CE7';
      detail = '<div style="font-size:13px;color:#B5B3F0;margin-top:6px">' +
        escDuelHtml(oppName || 'היריב') + ' עדיין לא שיחק.<br>תקבל הודעה ברגע שהמשחק יסתיים — בינתיים תוכל לחזור לשחק' +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'waiting') {
      emoji = '⏳'; title = 'ממתין ליריב...'; color = '#6B5CE7';
      detail = '<div style="font-size:13px;color:#B5B3F0;margin-top:6px">הניקוד שלך נשלח. נעדכן כשהיריב יסיים</div>';
    } else {
      emoji = '⚔️'; title = 'דו-קרב נשלח'; color = '#6B5CE7';
      detail = '';
    }

    // Build scores comparison (skipped for declined / expired / unresolved
    // where the opponent never played — showing "vs ..." would imply they
    // *did* play, which is misleading). Use `!= null` so a legitimate
    // opponent score of 0 (gave up on first drop) still renders as "0"
    // instead of dropping to the "..." placeholder.
    var oppScore = (d && d.opponentScore != null) ? d.opponentScore : null;
    var scoresHtml = '';
    if (!hideScoresVs) {
      scoresHtml = '<div style="display:flex;justify-content:center;gap:20px;margin:14px 0;font-size:13px">' +
        '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">אתה</div><div style="font-size:22px;font-weight:900;color:#FAC775">' + myScore.toLocaleString() + '</div></div>' +
        '<div style="align-self:center;font-size:18px;color:#A8A6A0">vs</div>' +
        '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">' + escDuelHtml(oppName) + '</div><div style="font-size:22px;font-weight:900;color:' + (oppScore != null ? '#FAC775' : '#555') + '">' + (oppScore != null ? oppScore.toLocaleString() : '...') + '</div></div>' +
      '</div>';
    } else {
      // Show only the player's own score in a compact card
      scoresHtml = '<div style="margin:14px 0;font-size:13px">' +
        '<div style="font-size:11px;color:#A8A6A0">הניקוד שלך</div>' +
        '<div style="font-size:26px;font-weight:900;color:#FAC775">' + myScore.toLocaleString() + '</div>' +
      '</div>';
    }

    // CTA wiring — for "go home" results we want the button to actually
    // dismiss + return to home, not to start a fresh practice game.
    var ctaOnClick = ctaMode === '__home__'
      ? 'this.closest(\'div[style]\').parentElement.remove(); if (typeof showHome === \'function\') showHome();'
      : 'this.closest(\'div[style]\').parentElement.remove();init(\'practice\',{fresh:true})';

    var overlay = document.createElement('div');
    overlay.setAttribute('data-duel-result-overlay', '1');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;direction:rtl';
    overlay.innerHTML =
      '<div style="background:#1C1A18;border-radius:20px;padding:28px 24px;max-width:320px;width:90%;text-align:center;border:2px solid ' + color + ';box-shadow:0 0 40px ' + color + '33">' +
        '<div style="font-size:48px;margin-bottom:8px">' + emoji + '</div>' +
        '<div style="font-size:24px;font-weight:900;color:' + color + '">' + title + '</div>' +
        scoresHtml +
        detail +
        '<button onclick="' + ctaOnClick + '" style="margin-top:18px;width:100%;padding:12px;border:none;border-radius:12px;background:#FAC775;color:#412402;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit">' + escDuelHtml(ctaLabel) + '</button>' +
      '</div>';
    document.body.appendChild(overlay);

    if (showConfettiFlag && typeof showConfetti === 'function') showConfetti(40);
    if (showConfettiFlag) buzz([80, 40, 80, 40, 80]);
    if (d && d.result === 'settled' && d.winner === 'you') shakeGrid(4);
  }

  function showDuelResultToast(text) {
    // Kept for backward compat — but overlay is used now
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.style.background = 'linear-gradient(135deg, #1C1A18, #2C2A28)';
    t.style.color = '#FAC775';
    t.style.fontSize = '14px';
    t.innerHTML = '<span>' + text + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 4000);
  }

  // ============================================================
  // INCOMING-DUEL NOTIFICATIONS (Bug 2 fix)
  // ============================================================
  // Polls /api/duels/mine on boot and every 60s while the app is visible.
  // Shows a top-right toast for:
  //  - pending duels I haven't accepted yet (someone challenged me)
  //  - settled duels I haven't seen the result of (notify of win/loss)
  // Tracks already-seen duel IDs in localStorage. We used to use
  // sessionStorage so the badge would re-fire each tab open, but that
  // turned out to mean the red dot NEVER cleared on real-world usage —
  // closing and re-opening Safari = unseen again, and on iOS that's
  // basically every other session. localStorage keeps the seen-state
  // across sessions; the entry is keyed { id → status } so a duel that
  // *transitions* (pending → settled) re-notifies as expected.
  var SEEN_DUELS_KEY = 'bloom_seen_duel_notifications_v2';
  function loadSeenDuels() {
    try { return JSON.parse(localStorage.getItem(SEEN_DUELS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markDuelSeen(duelId, status) {
    try {
      var seen = loadSeenDuels();
      seen[String(duelId)] = status;
      // Hard cap so this map can't grow forever for prolific duellists.
      var keys = Object.keys(seen);
      if (keys.length > 500) {
        // Drop oldest half by lowest numeric id (duel ids are sequential).
        keys.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
        for (var i = 0; i < Math.floor(keys.length / 2); i++) delete seen[keys[i]];
      }
      localStorage.setItem(SEEN_DUELS_KEY, JSON.stringify(seen));
    } catch (e) {}
  }
  function showDuelNotificationBanner(opts) {
    // opts: { kind: 'invite'|'won'|'lost'|'tie', name, score?, onTap }
    var existing = document.querySelector('[data-duel-notif="' + opts.id + '"]');
    if (existing) return; // already showing
    var b = document.createElement('div');
    b.setAttribute('data-duel-notif', opts.id);
    var bg = '#1C1A18', border = '#6B5CE7', emoji = '⚔️', title = 'אתגר חדש', sub = '';
    // Compact "vs" string when both scores are known — shown on the
    // result banners (won/lost/tie). The score numbers are the whole
    // reason a duel feels satisfying; the original banner just said
    // "ניצחת! מול X" and forced the player to dig into the modal to
    // see by how much.
    var vsScores = '';
    if (typeof opts.myScore === 'number' && typeof opts.oppScore === 'number') {
      vsScores = ' · ' + (opts.myScore | 0).toLocaleString() + ' vs ' + (opts.oppScore | 0).toLocaleString();
    }
    if (opts.kind === 'invite') {
      emoji = '⚔️'; title = (opts.name || 'מישהו') + ' אתגר/ה אותך!'; sub = 'לחץ לקבל'; border = '#6B5CE7';
    } else if (opts.kind === 'won') {
      emoji = '🏆'; title = 'ניצחת בדו-קרב!'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#2E8B6F';
    } else if (opts.kind === 'lost') {
      emoji = '😔'; title = 'הפסדת בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#C8472F';
    } else if (opts.kind === 'tie') {
      emoji = '🤝'; title = 'תיקו בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#BA7517';
    } else if (opts.kind === 'declined') {
      // Opponent rejected. Tone is informative + warm — not "you failed".
      emoji = '🤷'; title = (opts.name || 'היריב') + ' סירב/ה לדו-קרב'; sub = 'ההימור הוחזר אליך'; border = '#BA7517';
    } else if (opts.kind === 'expired') {
      // 24h window closed. Server already refunded.
      emoji = '⏰'; title = 'דו-קרב מול ' + (opts.name || 'יריב') + ' פג תוקף'; sub = 'ההימור הוחזר אליך'; border = '#BA7517';
    }
    b.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
      'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
      'z-index:9999;background:' + bg + ';color:#FAC775;border:2px solid ' + border + ';' +
      'border-radius:14px;padding:10px 16px;direction:rtl;font-family:inherit;font-size:13px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;max-width:320px;width:calc(100vw - 32px);';
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:22px">' + emoji + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:800;color:#FFFFFF;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escDuelHtml(title) + '</div>' +
          (sub ? '<div style="font-size:11px;color:#A8A6A0;margin-top:2px">' + escDuelHtml(sub) + '</div>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0">✕</div>' +
      '</div>';
    document.body.appendChild(b);
    requestAnimationFrame(function() {
      b.style.opacity = '1';
      b.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Tactile cue — different patterns by event kind so the player
    // can subconsciously tell what type of notification just arrived.
    try {
      if (typeof buzz === 'function') {
        var kind = (opts && opts.kind) || 'invite';
        if      (kind === 'invite')   buzz([14, 30, 14, 30, 14]);
        else if (kind === 'won')      buzz([20, 40, 20, 40, 40]);
        else if (kind === 'lost')     buzz([40]);
        else if (kind === 'tie')      buzz([18, 30, 18]);
        else if (kind === 'declined') buzz([24]);
        else if (kind === 'expired')  buzz([10, 40, 10]);
      }
    } catch (e) {}
    var dismiss = function() {
      b.style.opacity = '0';
      b.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(function() { b.remove(); }, 250);
    };
    b.onclick = function() {
      if (opts.onTap) try { opts.onTap(); } catch (e) {}
      dismiss();
    };
    setTimeout(dismiss, 7000);
  }
  function escDuelHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  async function checkIncomingDuels() {
    if (!deviceId) return;
    if (document.visibilityState === 'hidden') return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.duels) return;
      var seen = loadSeenDuels();
      var myCode = '';
      try { myCode = localStorage.getItem('bloom_player_code') || ''; } catch (e) {}
      d.duels.forEach(function(duel) {
        var prevSeen = seen[String(duel.id)];
        // Skip duels currently being played (mid-game) — they'll get a result overlay.
        if (activeDuelId && duel.id === activeDuelId) return;

        if (duel.status === 'pending') {
          // Pending where I'm the opponent → I was challenged. Notify once.
          var iAmOpponent = duel.opponent_device === deviceId ||
            (myCode && duel.opponent_code === myCode);
          var iAmChallenger = duel.challenger_device === deviceId;
          if (iAmOpponent && prevSeen !== 'pending') {
            showDuelNotificationBanner({
              id: duel.id,
              kind: 'invite',
              name: duel.challenger_name || duel.challenger_code,
              onTap: function() { showDuelModal(); }
            });
            markDuelSeen(duel.id, 'pending');
          } else if (iAmChallenger && duel.challenger_score == null && prevSeen !== 'pending-c') {
            // I sent it and haven't played yet. Don't notify — just track.
            markDuelSeen(duel.id, 'pending-c');
          }
        } else if ((duel.status === 'settled' || duel.status === 'tie') && prevSeen !== duel.status) {
          // Result available, haven't seen it yet — but only notify if we
          // actually played this duel (have a score). The overlay shown
          // by submitDuelScore handles the same-session case; this banner
          // covers the cross-session case (closed app, opponent finished).
          var iPlayed = (duel.challenger_device === deviceId && duel.challenger_score != null) ||
                        (duel.opponent_device === deviceId && duel.opponent_score != null);
          if (iPlayed) {
            var iAmChall = duel.challenger_device === deviceId;
            var opponentName = iAmChall ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
            var myScoreForBanner = iAmChall ? duel.challenger_score : duel.opponent_score;
            var oppScoreForBanner = iAmChall ? duel.opponent_score : duel.challenger_score;
            var kind = 'tie';
            if (duel.status === 'settled') {
              kind = (duel.winner_device === deviceId) ? 'won' : 'lost';
            }
            showDuelNotificationBanner({
              id: duel.id,
              kind: kind,
              name: opponentName,
              myScore: myScoreForBanner,
              oppScore: oppScoreForBanner,
              onTap: function() { showDuelModal(); }
            });
          }
          markDuelSeen(duel.id, duel.status);
        } else if ((duel.status === 'declined' || duel.status === 'expired') && prevSeen !== duel.status) {
          // I challenged someone and they declined OR didn't accept in
          // time. The wager has been refunded server-side; surface a
          // banner so I know what happened next time I open the app.
          var iAmChallengerForOutcome = duel.challenger_device === deviceId;
          if (iAmChallengerForOutcome) {
            showDuelNotificationBanner({
              id: duel.id,
              kind: duel.status, // 'declined' or 'expired'
              name: duel.opponent_name || duel.opponent_code,
              onTap: function() { showDuelModal(); }
            });
          }
          markDuelSeen(duel.id, duel.status);
        }
      });
    } catch (e) {}
  }
  // Expose for boot.
  window.__bloomCheckIncomingDuels = checkIncomingDuels;

  // ============================================================
  // SEND-GIFT MODAL — player-to-player gem transfer
  // ============================================================
  // Counterpart to the duel modal: same BLOOM-XXXX input shape, but
  // it sends gems peacefully instead of starting a wager. Recipient
  // sees a toast banner the next time they open the app (handled by
  // pollGiftInbox in src/05a-home-v2.js).
  function showGiftFriendModal(prefillSuffix) {
    var existing = document.getElementById('gift-friend-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'gift-friend-modal';
    modal.className = 'info-modal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center;direction:rtl;padding:16px';
    var preSuf = (prefillSuffix || '').toString().slice(0, 4).toUpperCase();
    modal.innerHTML =
      '<div class="info-card" style="background:#FFF;border-radius:18px;padding:22px 22px;max-width:340px;width:100%;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.3);border:1px solid #FAC775">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px;color:#1C1A18">🎁 שלח מתנה לחבר</div>' +
        '<div style="font-size:12px;color:#6F6E68;margin-bottom:14px">תן 💎 לחבר/ה במשחק. הם יקבלו הודעה ברגע שיפתחו את BLOOM.</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">קוד הנמען</div>' +
        '<div dir="ltr" style="display:flex;align-items:stretch;border:1px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;margin-bottom:10px;background:#FFFFFF;direction:ltr">' +
          '<span style="background:#1C1A18;color:#FAC775;padding:8px 10px;font-weight:700;letter-spacing:0.08em;font-family:ui-monospace,monospace;display:flex;align-items:center">BLOOM-</span>' +
          '<input id="gift-recipient-suffix" dir="ltr" maxlength="4" inputmode="latin" autocapitalize="characters" autocomplete="off" placeholder="XXXX" value="' + escDuelHtml(preSuf) + '" style="flex:1;padding:8px;border:0;font-family:ui-monospace,monospace;font-size:16px;text-transform:uppercase;letter-spacing:0.2em;font-weight:700;text-align:center;outline:none;background:transparent;direction:ltr">' +
        '</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">סכום (5-200 💎)</div>' +
        '<div id="gift-amount-pills" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
          '<button type="button" class="gift-pill selected" data-amt="10" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:700;cursor:pointer">10💎</button>' +
          '<button type="button" class="gift-pill" data-amt="25" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">25💎</button>' +
          '<button type="button" class="gift-pill" data-amt="50" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">50💎</button>' +
          '<button type="button" class="gift-pill" data-amt="100" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">100💎</button>' +
        '</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">הודעה (אופציונלי)</div>' +
        '<input id="gift-message" maxlength="120" placeholder="שתהנה!" style="width:100%;padding:8px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-size:13px;font-family:inherit;margin-bottom:14px;direction:rtl">' +

        '<button class="btn" id="gift-send" style="width:100%;background:linear-gradient(135deg,#FAC775,#BA7517);color:#FFF;font-weight:800">שלח 🎁</button>' +
        '<div id="gift-error" style="color:#C8472F;font-size:12px;text-align:center;min-height:18px;margin-top:8px"></div>' +
        '<button class="btn secondary" style="width:100%;margin-top:6px;background:transparent;color:#6F6E68" onclick="document.getElementById(\'gift-friend-modal\').remove()">סגור</button>' +
      '</div>';
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

    // Amount pill picker
    var chosenAmt = 10;
    modal.querySelectorAll('.gift-pill').forEach(function(pill) {
      pill.onclick = function() {
        modal.querySelectorAll('.gift-pill').forEach(function(p) {
          p.classList.remove('selected');
          p.style.background = '#F5F2EC';
          p.style.color = '#1C1A18';
        });
        pill.classList.add('selected');
        pill.style.background = '#1C1A18';
        pill.style.color = '#FAC775';
        chosenAmt = parseInt(pill.getAttribute('data-amt'), 10) || 10;
      };
    });

    // Paste-normalize the recipient field same as the duel modal
    var sufEl = document.getElementById('gift-recipient-suffix');
    if (sufEl) sufEl.addEventListener('input', function() {
      var cleaned = (sufEl.value || '').toUpperCase().replace(/^BLOOM-?/, '').replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
      if (cleaned !== sufEl.value) sufEl.value = cleaned;
    });

    document.getElementById('gift-send').onclick = async function() {
      var btn = this;
      var suf = (sufEl.value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      var msg = (document.getElementById('gift-message').value || '').trim().slice(0, 120);
      var errEl = document.getElementById('gift-error');
      errEl.style.color = '#C8472F';
      errEl.textContent = '';
      if (suf.length !== 4) { errEl.textContent = 'הקוד חייב להיות 4 תווים'; return; }
      if (typeof playerBalance !== 'undefined' && playerBalance < chosenAmt) {
        errEl.textContent = '💎 אין מספיק קרדיטים (יתרה: ' + playerBalance + ')';
        return;
      }
      btn.disabled = true;
      btn.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/player/gift-friend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: deviceId,
            token: deviceToken,
            recipientCode: 'BLOOM-' + suf,
            amount: chosenAmt,
            message: msg || null
          })
        });
        var d = await r.json();
        btn.disabled = false;
        btn.textContent = 'שלח 🎁';
        if (d && d.ok) {
          // Local balance update + UI feedback
          if (typeof playerBalance !== 'undefined') { playerBalance = d.newBalance; }
          if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
          errEl.style.color = '#2E8B6F';
          errEl.textContent = '✓ נשלח! ' + (d.recipientCode || ('BLOOM-' + suf)) + ' יקבל/ת הודעה';
          if (typeof showCreditToast === 'function') showCreditToast(-chosenAmt, 'מתנה ל-' + suf);
          // Sending a gift is also a great moment to ask for push
          // permission — the sender clearly cares about social play.
          try {
            if (typeof window.__bloomMaybeAskPush === 'function') {
              window.__bloomMaybeAskPush('כשמישהו ישלח לך מתנה או יאתגר אותך — תדע מיד, גם כשהמשחק סגור.');
            }
          } catch (e) {}
          setTimeout(function() { modal.remove(); }, 1400);
        } else {
          var msgs = {
            recipient_not_found: 'שחקן לא נמצא',
            no_self_gift: 'אי אפשר לשלוח לעצמך',
            insufficient_balance: 'אין מספיק 💎',
            bad_code: 'קוד לא חוקי',
            bad_amount: 'סכום לא חוקי',
            rate_limited_daily: 'שלחת היום יותר מדי מתנות. נסה מחר'
          };
          errEl.textContent = msgs[d && d.reason] || 'שגיאה';
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'שלח 🎁';
        errEl.textContent = 'שגיאת חיבור';
      }
    };
  }

  // ============ IN-GAME TILE SHOP ============
  var tilePrices = null; // fetched once from server

  var powerupPrices = null;

  async function loadTilePrices() {
    if (tilePrices) return;
    try {
      var r = await fetch(API_BASE + '/api/tile-prices');
      var d = await r.json();
      if (d && d.ok && d.enabled) tilePrices = d.prices;
      else tilePrices = null;
    } catch (e) { tilePrices = null; }
    // Load power-up prices from config
    try {
      var r2 = await fetch(API_BASE + '/api/tile-prices');
      // Power-up prices are in the config too — fetch them via the config endpoint fallback
      powerupPrices = {
        random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 // defaults
      };
    } catch(e) {}
  }

  function updateBalanceDisplay() {
    var el = document.getElementById('balance-display');
    if (!el) return;
    var b = playerBalance;
    var text = b >= 100000 ? Math.round(b / 1000) + 'K'
      : b >= 10000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : b >= 1000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : String(b);
    el.textContent = text;
  }

  // Active power-up mode
  var activePowerup = null;
  var activePowerupCost = 0;

  function showTileShop() {
    if (!tilePrices) { loadTilePrices().then(showTileShop); return; }
    if (busy) return;
    var existing = document.getElementById('tile-shop-modal');
    if (existing) { existing.remove(); return; }

    var modal = document.createElement('div');
    modal.id = 'tile-shop-modal';
    var html = '<button class="ts-close" id="ts-close-btn">✕</button>';
    html += '<div class="ts-header"><span>🛒 חנות משחק</span><span style="color:#BA7517;font-weight:700">💎 ' + playerBalance + '</span></div>';

    // Section 1: Buy tiles
    html += '<div class="ts-section-label">קנה אריח</div>';
    html += '<div class="ts-grid">';
    for (var t = 2; t <= MAX_TIER; t++) {
      var ti = getActiveTiers()[t];
      var price = tilePrices[t] || 0;
      var canBuy = playerBalance >= price;
      html += '<button class="ts-tile' + (!canBuy ? ' ts-locked' : '') + '" data-tier="' + t + '" data-price="' + price + '"' + (!canBuy ? ' disabled' : '') + '>' +
        '<div class="ts-icon" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
        '<div class="ts-name">' + ti.name + '</div>' +
        '<div class="ts-price">' + price + ' 💎</div>' +
      '</button>';
    }
    html += '</div>';

    // Section 2: Power-ups
    var pp = powerupPrices || { random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 };
    html += '<div class="ts-section-label">כלי עזר</div>';
    html += '<div class="ts-powerups">';
    html += '<button class="ts-power" data-power="random_tile"' + (playerBalance < pp.random_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">מחק אריח<br>אקראי</span><span class="ts-power-price">' + pp.random_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="choose_tile"' + (playerBalance < pp.choose_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎯</span><span class="ts-power-name">מחק אריח<br>לבחירתך</span><span class="ts-power-price">' + pp.choose_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="random_row"' + (playerBalance < pp.random_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">פנה שורה<br>אקראית</span><span class="ts-power-price">' + pp.random_row + ' 💎</span></button>';
    html += '<button class="ts-power ts-power-premium" data-power="choose_row"' + (playerBalance < pp.choose_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">👑</span><span class="ts-power-name">פנה שורה<br>לבחירתך</span><span class="ts-power-price">' + pp.choose_row + ' 💎</span></button>';
    html += '</div>';
    html += '<div class="ts-hint">🎲 = המערכת בוחרת · 🎯 = אתה בוחר · 👑 = פרימיום</div>';

    modal.innerHTML = html;
    document.getElementById('grid-wrap').appendChild(modal);

    document.getElementById('ts-close-btn').onclick = function() { modal.remove(); };
    modal.addEventListener('pointerdown', function(e) { if (e.target === modal) modal.remove(); });

    // Wire tile buy buttons
    modal.querySelectorAll('.ts-tile:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        var tier = parseInt(this.getAttribute('data-tier'), 10);
        var self = this;
        self.style.opacity = '0.5';
        fetch(API_BASE + '/api/player/buy-tile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, tier: tier })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            nextPiece = tier;
            render();
            modal.remove();
            showCreditToast(-d.cost, getActiveTiers()[tier].name);
            trackEvent('purchase', { item: 'tile', tier: tier, cost: d.cost });
          } else {
            self.style.opacity = '1';
            self.querySelector('.ts-price').textContent = d.reason === 'insufficient_balance' ? 'אין 💎' : 'שגיאה';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });

    // Wire power-up buttons
    modal.querySelectorAll('.ts-power:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        // Block double-buy
        if (activePowerup) {
          modal.remove();
          return;
        }
        var power = this.getAttribute('data-power');
        var self = this;
        self.style.opacity = '0.5';
        var configKey = 'powerup_' + power;
        fetch(API_BASE + '/api/player/buy-powerup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, powerup: configKey })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            modal.remove();
            executePowerup(power, d.cost);
            trackEvent('purchase', { item: 'powerup', type: power, cost: d.cost });
          } else {
            self.style.opacity = '1';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });
  }

  function executePowerup(type, cost) {
    if (type === 'random_tile') {
      var filled = [];
      for (var r = 0; r < getBoardRows(); r++)
        for (var c = 0; c < getBoardCols(); c++)
          if (grid[r][c] > 0) filled.push([r, c]);
      if (filled.length === 0) return;
      var pick = filled[Math.floor(Math.random() * filled.length)];
      // Roulette animation → then delete
      animateRouletteTile(filled, pick, function() {
        grid[pick[0]][pick[1]] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי אריח 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_tile') {
      activePowerup = 'choose_tile';
      activePowerupCost = cost;
      showPowerupHint('🎯 לחץ על האריח שרוצה לפנות');
      showCreditToast(-cost, 'בחר אריח לפינוי');
    }
    else if (type === 'random_row') {
      var filledRows = [];
      for (var r = 0; r < getBoardRows(); r++) {
        if (grid[r].some(function(c) { return c > 0; })) filledRows.push(r);
      }
      if (filledRows.length === 0) return;
      var rowIdx = filledRows[Math.floor(Math.random() * filledRows.length)];
      // Slot machine animation → then delete
      animateRouletteRow(filledRows, rowIdx, function() {
        for (var c = 0; c < getBoardCols(); c++) grid[rowIdx][c] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי שורה 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_row') {
      activePowerup = 'choose_row';
      activePowerupCost = cost;
      showPowerupHint('👑 לחץ על השורה שרוצה לפנות');
      showCreditToast(-cost, 'בחר שורה לפינוי');
    }
  }

  // Roulette animation for random tile: rapidly highlights tiles, slows down, explodes target
  function animateRouletteTile(candidates, target, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 18 + Math.floor(Math.random() * 6); // 18-24 flashes
    var step = 0;
    var prevCell = null;

    function tick() {
      // Remove previous highlight
      if (prevCell) { prevCell.classList.remove('roulette-flash'); prevCell.style.removeProperty('box-shadow'); }
      if (step >= steps) {
        // Land on target → explode!
        var targetCell = gridEl.children[target[0] * COLS + target[1]];
        if (targetCell) {
          targetCell.classList.add('roulette-hit');
          setTimeout(function() {
            targetCell.classList.remove('roulette-hit');
            onDone();
          }, 500);
        } else { onDone(); }
        return;
      }
      // Pick random candidate (last 4 steps → force closer to target)
      var pick = step >= steps - 3 ? target : candidates[Math.floor(Math.random() * candidates.length)];
      var cell = gridEl.children[pick[0] * COLS + pick[1]];
      if (cell) {
        cell.classList.add('roulette-flash');
        cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)';
        prevCell = cell;
      }
      step++;
      // Slow down: starts fast (60ms), ends slow (200ms)
      var delay = 60 + Math.pow(step / steps, 2.5) * 200;
      setTimeout(tick, delay);
    }
    tick();
  }

  // Slot machine animation for random row: cycles rows up/down, slows down, explodes target row
  function animateRouletteRow(candidateRows, targetRow, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 12 + Math.floor(Math.random() * 4);
    var step = 0;
    var prevRow = -1;

    function clearRowHighlight(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.remove('roulette-flash'); cell.style.removeProperty('box-shadow'); }
      }
    }
    function highlightRow(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.add('roulette-flash'); cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)'; }
      }
    }

    function tick() {
      if (prevRow >= 0) clearRowHighlight(prevRow);
      if (step >= steps) {
        // Land on target row → explode all cells!
        highlightRow(targetRow);
        setTimeout(function() {
          for (var c = 0; c < COLS; c++) {
            var cell = gridEl.children[targetRow * COLS + c];
            if (cell) { cell.classList.remove('roulette-flash'); cell.classList.add('roulette-hit'); }
          }
          setTimeout(function() {
            for (var c = 0; c < COLS; c++) {
              var cell = gridEl.children[targetRow * COLS + c];
              if (cell) cell.classList.remove('roulette-hit');
            }
            onDone();
          }, 500);
        }, 300);
        return;
      }
      // Cycle through rows (last 3 steps → target)
      var row = step >= steps - 2 ? targetRow : candidateRows[step % candidateRows.length];
      highlightRow(row);
      prevRow = row;
      step++;
      var delay = 80 + Math.pow(step / steps, 2.5) * 250;
      setTimeout(tick, delay);
    }
    tick();
  }

  function showPowerupHint(text) {
    var existing = document.getElementById('powerup-hint');
    if (existing) existing.remove();
    var hint = document.createElement('div');
    hint.id = 'powerup-hint';
    hint.className = 'powerup-hint';
    hint.innerHTML = '<span>' + text + '</span><button id="powerup-cancel-btn" class="powerup-cancel">✕ ביטול</button>';
    var wrap = document.getElementById('grid-wrap');
    if (wrap) wrap.appendChild(hint);
    document.getElementById('powerup-cancel-btn').onclick = function(e) {
      e.stopPropagation();
      cancelPowerup();
    };
  }

  function cancelPowerup() {
    if (!activePowerup) return;
    // Cancellation is now a local-only optimistic refund — the server's `refund`
    // branch was removed because it could be called without a prior charge.
    // The visible balance reflects the refund until the next server sync, after
    // which it returns to the deducted value. Accepted UX cost to close the hole.
    if (activePowerupCost > 0) {
      playerBalance += activePowerupCost;
      try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      updateBalanceDisplay();
      showCreditToast(activePowerupCost, 'ביטול — החזר 💎');
    }
    activePowerup = null;
    activePowerupCost = 0;
    var hint = document.getElementById('powerup-hint');
    if (hint) hint.remove();
  }

  function handlePowerupClick(row, col) {
    if (!activePowerup) return false;
    if (activePowerup === 'choose_tile') {
      if (grid[row][col] > 0) {
        // Explosion animation then delete
        var gridEl = document.getElementById('grid');
        var COLS = getBoardCols();
        var cell = gridEl ? gridEl.children[row * COLS + col] : null;
        if (cell) {
          cell.classList.add('roulette-hit');
          setTimeout(function() {
            grid[row][col] = 0;
            applyGravity();
            render();
            if (mode === 'practice') savePracticeGameState();
          }, 450);
        } else {
          grid[row][col] = 0; applyGravity(); render();
          if (mode === 'practice') savePracticeGameState();
        }
      }
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    if (activePowerup === 'choose_row') {
      var allMax = grid[row].every(function(c) { return c === MAX_TIER; });
      if (allMax) {
        showPowerupHint('❌ שורה מלאת כתרים! בחר שורה אחרת');
        return true;
      }
      // Explosion animation for entire row
      var gridEl = document.getElementById('grid');
      var COLS = getBoardCols();
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl ? gridEl.children[row * COLS + c] : null;
        if (cell) cell.classList.add('roulette-hit');
      }
      setTimeout(function() {
        for (var c = 0; c < getBoardCols(); c++) grid[row][c] = 0;
        applyGravity();
        render();
        if (mode === 'practice') savePracticeGameState();
      }, 450);
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    return false;
  }

  // Same idea for board dimensions (added in Step 2 below).
  const BEST_KEY = 'bloom_best_score';
  const NAME_KEY = 'bloom_player_name';
  const DEVICE_KEY = 'bloom_device_id';
  const DAILY_PLAYED_PREFIX = 'bloom_daily_';
  const MUTE_KEY = 'bloom_muted';
  const MUSIC_MUTE_KEY = 'bloom_muted_music';
  const SFX_MUTE_KEY = 'bloom_muted_sfx';
  const STREAK_KEY = 'bloom_streak';
  const ACH_KEY = 'bloom_achievements';
  const GAMES_COUNT_KEY = 'bloom_games_played';
  // Onboarding progress: 0=fresh, 1=saw "tap a column", 2=saw "merge!", 3=saw "chain!" / done.
  const ONBOARD_KEY = 'bloom_onboard_step';
  function getOnboardStep() { return parseInt(localStorage.getItem(ONBOARD_KEY) || '0', 10) || 0; }
  function setOnboardStep(n) { try { localStorage.setItem(ONBOARD_KEY, String(n | 0)); } catch (e) {} }
  // Lifetime "personal bests" — only ever grow.
  const BEST_TIER_KEY  = 'bloom_best_tier_ever';
  const BEST_CHAIN_KEY = 'bloom_best_chain_ever';
  const BEST_STREAK_KEY = 'bloom_best_streak_ever';
  const TOTAL_SCORE_KEY = 'bloom_total_lifetime_score';

  // Same-origin API. When the game is served from the Express backend, this
  // works as-is. When opened from file:// the leaderboard simply won't load.
  const API_BASE = '';

  // Game config fetched from server (admin-controlled).
  // merge_mode: 'anchor' (result near drop) | 'classic' (leftmost wins) |
  //             'smart' (engine picks the cell that gives the best follow-up).
  var gameConfig = { merge_mode: 'anchor' };
  (function loadGameConfig() {
    fetch(API_BASE + '/api/config').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.config) gameConfig = d.config;
        // Aurora admin-gate. Default: enabled. Only the explicit string 'false'
        // disables it. When disabled: hide from shop and, if a player has it
        // active, revert them to classic so they don't keep showing gradients
        // that the admin can't see in their own account.
        try {
          if (gameConfig.aurora_skin_enabled === 'false') {
            if (typeof SKIN_PACKS !== 'undefined' && SKIN_PACKS.aurora) delete SKIN_PACKS.aurora;
            if (typeof activeSkinId !== 'undefined' && activeSkinId === 'aurora') {
              activeSkinId = 'classic';
              try { localStorage.setItem(ACTIVE_SKIN_KEY, 'classic'); } catch(e) {}
              if (typeof syncBodySkinClass === 'function') syncBodySkinClass();
              if (typeof buildTierBar === 'function') try { buildTierBar(true); } catch(e) {}
              if (typeof render === 'function') try { render(); } catch(e) {}
            }
          }
        } catch (e) {}
      })
      .catch(function() {});
  })();

  // Dynamic Boards (phase 3 — per-mode targeting, May 2026)
  //
  // The boot path still fetches the dynamic-mode list to populate the
  // home picker. Per-mode boards (practice/daily/duel) are fetched
  // on-demand inside init() via fetchBoardForMode(mode) so the cache
  // is always 60s fresh from the server, no stale-state issues.
  //
  // Daily / practice / duel are the per-mode candidates. Contest /
  // challenge are NOT yet wired (planned for next round).
  var _availableBoards = [];
  window._availableBoards = _availableBoards;
  function refreshAvailableBoards() {
    if (document.hidden) return;
    fetch(API_BASE + '/api/boards/available').then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.ok) return;
        _availableBoards = Array.isArray(d.boards) ? d.boards : [];
        window._availableBoards = _availableBoards;
        if (typeof updateDynamicBoardsButton === 'function') {
          try { updateDynamicBoardsButton(); } catch (e) {}
        }
      })
      .catch(function() {});
  }
  (function loadAvailableBoards() {
    refreshAvailableBoards();
    setInterval(refreshAvailableBoards, 90 * 1000);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) refreshAvailableBoards();
    });
  })();

  // fetchBoardForMode — returns the active board for a specific mode,
  // or null if none. The server applies its 60s in-memory cache, so
  // repeated calls in quick succession are cheap.
  function fetchBoardForMode(mode) {
    return fetch(API_BASE + '/api/active-board/' + encodeURIComponent(mode))
      .then(function(r) { return r.json(); })
      .then(function(d) { return (d && d.ok && d.board) ? d.board : null; })
      .catch(function() { return null; });
  }
  window.fetchBoardForMode = fetchBoardForMode;

  // Per-game difficulty override. Populated by init() from the active
  // contest/duel row, or by practice mode from localStorage. When null,
  // getDropWeights() and gameSpeedScale() fall back to gameConfig (admin).
  // Shape: { label: 'hard', weights: '5,15,30,30,15,5,0,0', speed_pct: 100 }
  var sessionDifficulty = null;
  // Mirror of server's DIFFICULTY_PRESETS — kept in sync at the source.
  var DIFFICULTY_PRESETS = {
    default: { label: 'default', weights: null,                    speed_pct: null, name: 'ברירת מחדל', emoji: '📦' },
    easy:    { label: 'easy',    weights: '70,25,5,0,0,0,0,0',     speed_pct: 100,  name: 'קל',         emoji: '😊' },
    medium:  { label: 'medium',  weights: '30,35,25,10,0,0,0,0',   speed_pct: 100,  name: 'בינוני',     emoji: '🎯' },
    hard:    { label: 'hard',    weights: '5,15,30,30,15,5,0,0',   speed_pct: 100,  name: 'קשה',        emoji: '🔥' },
    insane:  { label: 'insane',  weights: '0,0,10,30,35,20,5,0',   speed_pct: 100,  name: 'גהינום',     emoji: '💀' }
  };
  var PRACTICE_DIFF_KEY = 'bloom_practice_difficulty';
  function readPracticeDifficulty() {
    try {
      var raw = localStorage.getItem(PRACTICE_DIFF_KEY);
      if (!raw) return null;
      var p = DIFFICULTY_PRESETS[raw];
      return p || null;
    } catch (e) { return null; }
  }
  function writePracticeDifficulty(label) {
    try {
      if (!label || label === 'default') localStorage.removeItem(PRACTICE_DIFF_KEY);
      else localStorage.setItem(PRACTICE_DIFF_KEY, label);
    } catch (e) {}
  }

  /* ============ AUDIO ============ */
  let audioCtx = null;
  // Channel volumes (0–1). Music drives the mp3 cross-fade target; sfx
  // multiplies every Web Audio tone()'s gain and gates haptic buzz.
  // Volume === 0 is the "muted" state; the speaker icon lights up red when
  // either channel is at zero.
  const MUSIC_VOL_KEY = 'bloom_music_volume';
  const SFX_VOL_KEY = 'bloom_sfx_volume';
  const DEFAULT_MUSIC_VOLUME = 0.28;
  const DEFAULT_SFX_VOLUME = 1.0;
  const VOL_MUTE_THRESHOLD = 0.005;
  function readVolumeKey(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw !== null && raw !== '') {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(0, Math.min(1, v));
    }
    // One-time migration from the old boolean mute keys. Only per-channel
    // mutes are honored — the legacy *unified* `bloom_muted` is intentionally
    // ignored, because users who tapped it once on an old version got stuck
    // permanently silent after the per-channel split (no UI affordance to
    // recover). Defaulting to audible is recoverable; defaulting to mute isn't.
    const oldKey = (key === 'bloom_music_volume') ? 'bloom_muted_music' : 'bloom_muted_sfx';
    const oldRaw = localStorage.getItem(oldKey);
    if (oldRaw === '1') return 0;
    return fallback;
  }
  let musicVolume = readVolumeKey(MUSIC_VOL_KEY, DEFAULT_MUSIC_VOLUME);
  let sfxVolume = readVolumeKey(SFX_VOL_KEY, DEFAULT_SFX_VOLUME);
  // Persist the resolved values immediately so the migration only runs once,
  // then clear the legacy keys so they can never re-mute on future loads.
  try {
    localStorage.setItem(MUSIC_VOL_KEY, String(musicVolume));
    localStorage.setItem(SFX_VOL_KEY, String(sfxVolume));
    localStorage.removeItem('bloom_muted');
    localStorage.removeItem('bloom_muted_music');
    localStorage.removeItem('bloom_muted_sfx');
  } catch (e) {}
  function isMusicMuted() { return musicVolume < VOL_MUTE_THRESHOLD; }
  function isSfxMuted() { return sfxVolume < VOL_MUTE_THRESHOLD; }
  function isAnyMuted() { return isMusicMuted() || isSfxMuted(); }
  function saveVolumeState() {
    try {
      localStorage.setItem(MUSIC_VOL_KEY, String(musicVolume));
      localStorage.setItem(SFX_VOL_KEY, String(sfxVolume));
    } catch (e) {}
  }

  function ensureAudio() {
    if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(function() {
        // Browser autoplay policy: any playMusic() called before the first
        // user gesture left its BufferSource scheduled on a suspended ctx —
        // on Safari that source never recovers. Re-arm the current track
        // here, on the first successful resume, so music actually starts.
        if (currentTrack && !isMusicMuted()) {
          var t = MUSIC_TRACKS[currentTrack];
          if (!t || !t.source || currentTrackLevel(currentTrack) < 0.001) {
            fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
          }
        }
      }).catch(function() {});
    }
    return audioCtx;
  }

  // Persistent gesture-unlock (was one-shot — recovered audio only once,
  // and any later context-suspend stayed permanently broken). Now every
  // user gesture re-runs ensureAudio. The check inside ensureAudio is
  // a no-op when the context is already running, so the cost is zero
  // when audio is already happy.
  (function attachGestureUnlock() {
    function tryUnlock() { try { ensureAudio(); } catch (e) {} }
    document.addEventListener('pointerdown', tryUnlock, true);
    document.addEventListener('touchstart', tryUnlock, true);
    document.addEventListener('keydown', tryUnlock, true);
    // Also recover audio when the tab becomes visible again — iOS
    // Safari and some Chrome versions suspend the context on tab blur
    // and don't auto-resume on visibility change.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) try { ensureAudio(); } catch (e) {}
    });
  })();

  /* Music manager: 3 tracks (lobby/game/fail) with 0.5s cross-fade */
  const MUSIC_FADE_MS = 500;
  const MUSIC_FADE_STEPS = 20;
  // Music architecture: AudioBufferSourceNode per track. The previous design
  // routed an <audio loop> element through createMediaElementSource, but that
  // path can never produce a truly gapless loop — every browser inserts a
  // small silence at the end-of-file boundary, which on a 16-second track is
  // audible and feels like the music "stops". BufferSource.loop is gapless
  // by definition (it's a sample-accurate loop in the audio thread), so the
  // song plays uninterrupted for the entire session.
  const MUSIC_TRACKS = {
    lobby: { url: 'bloom-music-lobby.mp3', buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null },
    game:  { url: 'bloom-music.mp3',       buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null },
    fail:  { url: 'bloom-music-fail.mp3',  buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null }
  };
  let currentTrack = null;

  function ensureTrackGain(name) {
    const t = MUSIC_TRACKS[name];
    if (!t) return null;
    if (t.gain) return t.gain;
    const ctx = ensureAudio();
    if (!ctx) return null;
    try {
      t.gain = ctx.createGain();
      t.gain.gain.value = 0;
      t.gain.connect(ctx.destination);
    } catch (e) { t.gain = null; }
    return t.gain;
  }

  function loadTrackBuffer(name) {
    const t = MUSIC_TRACKS[name];
    if (!t) return Promise.reject(new Error('no track'));
    if (t.buffer) return Promise.resolve(t.buffer);
    if (t.loadingPromise) return t.loadingPromise;
    const ctx = ensureAudio();
    if (!ctx) return Promise.reject(new Error('no AudioContext'));
    t.loadingPromise = fetch(t.url)
      .then(function(res) { return res.arrayBuffer(); })
      .then(function(arr) {
        // decodeAudioData has a callback form for older Safari support.
        return new Promise(function(resolve, reject) {
          ctx.decodeAudioData(arr, resolve, reject);
        });
      })
      .then(function(buffer) { t.buffer = buffer; return buffer; })
      .catch(function(e) { t.loadingPromise = null; throw e; });
    return t.loadingPromise;
  }

  function startTrackSource(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.buffer) return false;
    const gain = ensureTrackGain(name);
    if (!gain) return false;
    const ctx = ensureAudio();
    if (!ctx) return false;
    stopTrackSource(name);
    try {
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.loop = true;
      src.connect(gain);
      src.start(0);
      t.source = src;
      return true;
    } catch (e) { return false; }
  }

  function stopTrackSource(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.source) return;
    try { t.source.stop(); } catch (e) {}
    try { t.source.disconnect(); } catch (e) {}
    t.source = null;
  }

  function setTrackLevel(name, v) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.gain) return;
    try { t.gain.gain.value = Math.max(0, Math.min(1, v)); } catch (e) {}
  }
  function currentTrackLevel(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.gain) return 0;
    return Number(t.gain.gain.value) || 0;
  }

  function clearFade(name) {
    const t = MUSIC_TRACKS[name];
    if (t && t.fadeTimer) { clearInterval(t.fadeTimer); t.fadeTimer = null; }
  }
  function fadeOutTrack(name, ms, onDone) {
    const t = MUSIC_TRACKS[name];
    if (!t) { onDone && onDone(); return; }
    clearFade(name);
    const startLevel = currentTrackLevel(name);
    if (!t.source || startLevel <= 0.001) {
      setTrackLevel(name, 0);
      stopTrackSource(name);
      onDone && onDone();
      return;
    }
    const stepMs = ms / MUSIC_FADE_STEPS;
    let i = 0;
    t.fadeTimer = setInterval(function() {
      i++;
      setTrackLevel(name, Math.max(0, startLevel * (1 - i / MUSIC_FADE_STEPS)));
      if (i >= MUSIC_FADE_STEPS) {
        clearFade(name);
        setTrackLevel(name, 0);
        stopTrackSource(name);
        onDone && onDone();
      }
    }, stepMs);
  }
  function fadeInTrack(name, ms, target) {
    const t = MUSIC_TRACKS[name];
    if (!t) return;
    clearFade(name);
    target = (typeof target === 'number') ? target : musicVolume;
    ensureAudio();
    ensureTrackGain(name);
    setTrackLevel(name, 0);
    // Lazy-load the buffer on first playback. Once decoded, start the
    // source and tween the gain in.
    loadTrackBuffer(name).then(function() {
      if (currentTrack !== name || isMusicMuted()) return;
      if (!t.source) startTrackSource(name);
      const stepMs = ms / MUSIC_FADE_STEPS;
      let i = 0;
      clearFade(name);
      t.fadeTimer = setInterval(function() {
        i++;
        setTrackLevel(name, Math.min(target, target * (i / MUSIC_FADE_STEPS)));
        if (i >= MUSIC_FADE_STEPS) clearFade(name);
      }, stepMs);
    }).catch(function() { /* decode failed — silent */ });
  }
  function playMusic(name) {
    if (!MUSIC_TRACKS[name]) return;
    const t = MUSIC_TRACKS[name];
    const sameTrack = currentTrack === name;
    if (sameTrack && t.source && currentTrackLevel(name) > 0.001) return;
    const prev = currentTrack;
    currentTrack = name;
    if (isMusicMuted()) return;
    if (prev && prev !== name) {
      fadeOutTrack(prev, MUSIC_FADE_MS, function() {
        if (currentTrack === name) fadeInTrack(name, MUSIC_FADE_MS, musicVolume);
      });
    } else {
      fadeInTrack(name, MUSIC_FADE_MS, musicVolume);
    }
  }
  function stopAllMusic() {
    Object.keys(MUSIC_TRACKS).forEach(function(k) {
      fadeOutTrack(k, MUSIC_FADE_MS);
    });
    currentTrack = null;
  }
  function pauseAllMusic() {
    // BufferSource has no pause API — stop and recreate on resume. For
    // looping tracks restarting from the top is fine.
    Object.keys(MUSIC_TRACKS).forEach(function(k) {
      clearFade(k);
      setTrackLevel(k, 0);
      stopTrackSource(k);
    });
  }
  function resumeCurrentMusic() {
    if (!currentTrack || isMusicMuted()) return;
    fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
  }
  // Apply a volume change to any currently-playing music immediately
  // (without restarting / fading). Used by the slider for live response.
  function applyMusicVolumeToActive() {
    if (!currentTrack) return;
    setTrackLevel(currentTrack, isMusicMuted() ? 0 : musicVolume);
  }
  // Tetris-style music tempo: speed up as board fills
  function updateMusicTempo(filledRows) {
    var t = MUSIC_TRACKS.game;
    if (!t || !t.source || !t.source.playbackRate) return;
    // 0 rows = ×1.0, 3 rows = ×1.1, 5 rows = ×1.25, 6 rows = ×1.35
    var maxRows = 6;
    var rate = 1.0 + (Math.min(filledRows, maxRows) / maxRows) * 0.35;
    try { t.source.playbackRate.value = rate; } catch(e) {}
  }
  function tone(opts) {
    if (isSfxMuted()) return;
    const c = ensureAudio();
    if (!c) return;
    const t0 = c.currentTime + (opts.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.bendTo) osc.frequency.exponentialRampToValueAtTime(opts.bendTo, t0 + opts.duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.filter || 5000, t0);
    gain.gain.setValueAtTime(0, t0);
    const peak = (opts.vol || 0.2) * sfxVolume;
    gain.gain.linearRampToValueAtTime(peak, t0 + (opts.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
    osc.connect(filter); filter.connect(gain); gain.connect(c.destination);
    osc.start(t0); osc.stop(t0 + opts.duration + 0.05);
  }

  function soundDrop() {
    tone({ freq: 520, bendTo: 280, duration: 0.12, type: 'sine', vol: 0.14, filter: 3000 });
    tone({ freq: 260, bendTo: 140, duration: 0.15, type: 'sine', vol: 0.09, filter: 1500, delay: 0.005 });
  }

  function soundMerge(tier) {
    const baseFreqs = [0, 0, 330, 392, 466, 523, 622, 740, 880];
    const fundamental = baseFreqs[tier] || 330;
    tone({ freq: fundamental, duration: 0.25, type: 'triangle', vol: 0.18, filter: 5000 });
    tone({ freq: fundamental * 1.5, duration: 0.22, type: 'triangle', vol: 0.12, filter: 6000, delay: 0.025 });
    tone({ freq: fundamental * 2, duration: 0.18, type: 'sine', vol: 0.09, filter: 8000, delay: 0.05 });
    if (tier >= 6) tone({ freq: fundamental * 3, duration: 0.15, type: 'sine', vol: 0.06, filter: 9000, delay: 0.08 });
    if (tier >= 8) tone({ freq: fundamental * 4, duration: 0.2, type: 'sine', vol: 0.07, filter: 10000, delay: 0.12 });
  }

  function soundChain(chainCount) {
    const scale = [523, 587, 659, 784, 880, 1047, 1175];
    for (let i = 0; i < Math.min(chainCount + 1, scale.length); i++) {
      tone({ freq: scale[i], duration: 0.16, type: 'triangle', vol: 0.14, filter: 6000, delay: i * 0.07 });
      tone({ freq: scale[i] * 2, duration: 0.12, type: 'sine', vol: 0.06, filter: 8000, delay: i * 0.07 + 0.01 });
    }
  }

  function soundMilestone(tier) {
    const melody = [523, 659, 784, 1047, 1319];
    for (let i = 0; i < melody.length; i++) {
      tone({ freq: melody[i], duration: 0.22, type: 'triangle', vol: 0.16, filter: 6000, delay: i * 0.09 });
      tone({ freq: melody[i] * 2, duration: 0.18, type: 'sine', vol: 0.08, filter: 8000, delay: i * 0.09 + 0.01 });
    }
    if (tier >= MAX_TIER) {
      const sparkle = [2093, 2349, 2637, 3136];
      for (let i = 0; i < sparkle.length; i++) {
        tone({ freq: sparkle[i], duration: 0.1, type: 'sine', vol: 0.05, filter: 10000, delay: 0.55 + i * 0.04 });
      }
    }
  }

  function soundGameOver() {
    tone({ freq: 392, bendTo: 370, duration: 0.18, type: 'sawtooth', vol: 0.11, filter: 2500 });
    tone({ freq: 349, bendTo: 330, duration: 0.18, type: 'sawtooth', vol: 0.11, filter: 2500, delay: 0.18 });
    tone({ freq: 311, bendTo: 220, duration: 0.5, type: 'sawtooth', vol: 0.13, filter: 2200, delay: 0.36 });
    tone({ freq: 196, bendTo: 165, duration: 0.18, type: 'sine', vol: 0.08, filter: 1500 });
    tone({ freq: 175, bendTo: 165, duration: 0.18, type: 'sine', vol: 0.08, filter: 1500, delay: 0.18 });
    tone({ freq: 156, bendTo: 110, duration: 0.5, type: 'sine', vol: 0.09, filter: 1500, delay: 0.36 });
  }
  function buzz(pattern) {
    if (isSfxMuted()) return;
    if (navigator.vibrate) try { navigator.vibrate(pattern); } catch(e) {}
  }
  function setMuteIcon(btn, icon, mutedState) {
    if (!btn || !icon) return;
    if (mutedState) {
      btn.classList.add('muted');
      icon.innerHTML = '<path d="M15 8a5 5 0 0 1 1.7 3M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15M21 9l-6 6M15 9l6 6"/>';
    } else {
      btn.classList.remove('muted');
      icon.innerHTML = '<path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/>';
    }
  }
  function updateMuteUI() {
    setMuteIcon(document.getElementById('mute'), document.getElementById('mute-icon'), isAnyMuted());
    setMuteIcon(document.getElementById('home-mute'), document.getElementById('home-mute-icon'), isAnyMuted());
  }
  function setMusicVolume(next, opts) {
    opts = opts || {};
    const v = Math.max(0, Math.min(1, Number(next) || 0));
    const wasMuted = isMusicMuted();
    musicVolume = v;
    saveVolumeState();
    updateMuteUI();
    syncMuteMenuItems();
    if (isMusicMuted()) {
      pauseAllMusic();
    } else {
      // If we were silent and just turned on, resume the current track at the
      // new level. Otherwise patch the live element so the slider feels live.
      if (wasMuted) { ensureAudio(); resumeCurrentMusic(); }
      else applyMusicVolumeToActive();
    }
  }
  function setSfxVolume(next, opts) {
    opts = opts || {};
    const v = Math.max(0, Math.min(1, Number(next) || 0));
    const wasMuted = isSfxMuted();
    sfxVolume = v;
    saveVolumeState();
    updateMuteUI();
    syncMuteMenuItems();
    // Tiny confirm chirp when crossing zero → audible.
    if (wasMuted && !isSfxMuted() && !opts.silent) {
      ensureAudio(); tone({ freq: 523, duration: 0.08, type: 'sine', vol: 0.12 });
    }
  }
  function muteAll() { setMusicVolume(0); setSfxVolume(0, { silent: true }); }
  function unmuteAll() {
    setMusicVolume(musicVolume > 0 ? musicVolume : DEFAULT_MUSIC_VOLUME);
    setSfxVolume(sfxVolume > 0 ? sfxVolume : DEFAULT_SFX_VOLUME);
  }

  // Audio reset — exposed to the mute menu button + window for devtools.
  // Recovers from "I lost all sound" by:
  //   1. Discarding the existing AudioContext (which may be stuck suspended)
  //   2. Restoring volumes to defaults if they collapsed to zero
  //   3. Creating a fresh ctx and playing a confirmation tone
  function __bloomResetAudio() {
    try {
      // Tear down the old ctx + nodes if any
      if (audioCtx) {
        try {
          Object.keys(MUSIC_TRACKS).forEach(function(k) {
            var t = MUSIC_TRACKS[k];
            if (t.source) { try { t.source.stop(); } catch (e) {} }
            t.source = null;
            t.gain = null;
            t.buffer = null;
            t.loadingPromise = null;
            t.fadeTimer = null;
          });
        } catch (e) {}
        try { audioCtx.close(); } catch (e) {}
        audioCtx = null;
      }
      // Restore volumes to sensible defaults if user accidentally
      // dragged them to zero.
      var resetMusicVol = (musicVolume < VOL_MUTE_THRESHOLD) ? DEFAULT_MUSIC_VOLUME : musicVolume;
      var resetSfxVol   = (sfxVolume   < VOL_MUTE_THRESHOLD) ? DEFAULT_SFX_VOLUME   : sfxVolume;
      musicVolume = resetMusicVol;
      sfxVolume   = resetSfxVol;
      saveVolumeState();
      // Update mute UI to reflect the recovered volumes.
      if (typeof updateMuteUI === 'function') { try { updateMuteUI(); } catch (e) {} }
      if (typeof syncMuteMenuItems === 'function') { try { syncMuteMenuItems(); } catch (e) {} }
      // Create a fresh ctx + confirm with a chirp.
      ensureAudio();
      setTimeout(function() {
        try { tone({ freq: 587, duration: 0.10, type: 'sine', vol: 0.18 }); } catch (e) {}
        setTimeout(function() {
          try { tone({ freq: 784, duration: 0.12, type: 'sine', vol: 0.18 }); } catch (e) {}
        }, 130);
      }, 80);
      // Re-arm music if a track was playing.
      try {
        if (currentTrack && !isMusicMuted()) {
          fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
        }
      } catch (e) {}
      if (typeof showTransientBanner === 'function') {
        try {
          showTransientBanner({
            tag: 'audio-reset', holdMs: 1400, fadeMs: 300,
            style: 'position:fixed;top:18%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#9FE1CB,#4FBD8B);color:#04342C;border-radius:14px;padding:12px 18px;font-weight:800;box-shadow:0 6px 22px rgba(79,189,139,0.4);direction:rtl;text-align:center',
            html: '🔊 הסאונד אופחל מחדש'
          });
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[audio-reset] failed:', err);
    }
  }
  window.__bloomResetAudio = __bloomResetAudio;

  /* Mute popover menu — 3 choices: music, sfx, all */
  const SVG_MUSIC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const SVG_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  function volSliderHtml(kind, value) {
    const pct = Math.round(value * 100);
    const icon = (kind === 'music') ? SVG_MUSIC_NOTE : SVG_BELL;
    const label = (kind === 'music') ? 'מוזיקה' : 'אפקטי קול';
    return '<div class="mute-row" data-kind="' + kind + '">' +
      '<div class="mute-row-head">' +
        '<div class="mute-item-icon">' + icon + '</div>' +
        '<div class="mute-item-label">' + label + '</div>' +
        '<div class="mute-row-pct" data-pct="' + kind + '">' + pct + '%</div>' +
      '</div>' +
      '<input type="range" class="vol-slider" data-slider="' + kind + '" min="0" max="100" step="1" value="' + pct + '" aria-label="' + label + '" />' +
    '</div>';
  }

  // ============ NAV STACK + SHELL (UX audit §2.1 + §3.1) ============
  // Lightweight navigation primitive: each non-game screen pushes itself
  // onto NavStack on entry; the shell's back button pops one level.
  // We deliberately don't lean on browser history — BLOOM screens are a
  // logical hierarchy (Spectator → Contest Leaderboard → Contest Menu →
  // Home), not a history of visits, and "back" should follow that tree.
  //
  // A "screen descriptor" is { id, title, enter, exit } where enter/exit
  // are optional callbacks. Enter runs on push (and on re-push after a
  // pop that returns here); exit runs when the screen is popped/replaced.
  const NavStack = (function() {
    const stack = []; // descriptors
    function current() { return stack.length ? stack[stack.length - 1] : null; }
    function depth() { return stack.length; }
    function push(descriptor) {
      if (!descriptor || !descriptor.id) return;
      // De-dupe consecutive identical entries so refreshing the same screen
      // doesn't grow the stack indefinitely.
      const top = current();
      if (top && top.id === descriptor.id) return;
      stack.push(descriptor);
      if (typeof descriptor.enter === 'function') {
        try { descriptor.enter(); } catch (e) { console.warn('NavStack.enter', e); }
      }
    }
    function replace(descriptor) {
      const popped = stack.pop();
      if (popped && typeof popped.exit === 'function') {
        try { popped.exit(); } catch (e) { /* swallow */ }
      }
      push(descriptor);
    }
    function back() {
      if (!stack.length) return false;
      const popped = stack.pop();
      if (popped && typeof popped.exit === 'function') {
        try { popped.exit(); } catch (e) { /* swallow */ }
      }
      const now = current();
      if (now && typeof now.enter === 'function') {
        try { now.enter(); } catch (e) { /* swallow */ }
      } else if (!now) {
        // Stack empty — route home.
        if (typeof window.showHome === 'function') window.showHome();
      }
      return true;
    }
    function reset() {
      while (stack.length) {
        const popped = stack.pop();
        if (popped && typeof popped.exit === 'function') {
          try { popped.exit(); } catch (e) { /* swallow */ }
        }
      }
    }
    return { push, replace, back, current, depth, reset };
  })();
  // Expose for handlers that live outside the IIFE scope (event delegation,
  // window.__bloomNav references, etc).
  try { window.__bloomNav = NavStack; } catch (e) {}

  // mountShell — renders a sticky top bar into a container. Used by every
  // non-game screen so the contest, challenge, profile, and spectator
  // surfaces all share one header (UX audit §2.1 — "feels like one app").
  //
  // opts = {
  //   target:    HTMLElement or selector to receive the shell (required)
  //   title:     screen title (string)
  //   subtitle:  optional small text under the title
  //   onBack:    function called when [←] is tapped. Defaults to NavStack.back.
  //              Pass null to hide the back button (e.g. on Home).
  //   actions:   array of { id, label, ariaLabel, icon, onClick } to render
  //              on the right side. Limit ~2 for layout sanity.
  // }
  function mountShell(opts) {
    opts = opts || {};
    const target = (typeof opts.target === 'string')
      ? document.querySelector(opts.target)
      : opts.target;
    if (!target) return null;

    // Remove any existing shell in this container — re-mounting is fine.
    const existing = target.querySelector(':scope > .shell');
    if (existing) existing.remove();

    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.setAttribute('role', 'banner');

    let html = '';
    // Back button (right side in RTL = visually leading)
    if (opts.onBack !== null) {
      html += '<button class="shell-back" id="shell-back" aria-label="חזור">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>';
    } else {
      html += '<div class="shell-back-spacer" aria-hidden="true"></div>';
    }

    // Title + optional subtitle
    html += '<div class="shell-title-wrap">' +
      '<div class="shell-title">' + escapeShellText(opts.title || 'BLOOM') + '</div>' +
      (opts.subtitle ? '<div class="shell-subtitle">' + escapeShellText(opts.subtitle) + '</div>' : '') +
    '</div>';

    // Right-side actions
    html += '<div class="shell-actions">';
    if (Array.isArray(opts.actions)) {
      opts.actions.slice(0, 3).forEach(function(a) {
        if (!a) return;
        html += '<button class="shell-action" data-shell-action-id="' + escapeShellText(a.id || '') + '"' +
          (a.ariaLabel ? ' aria-label="' + escapeShellText(a.ariaLabel) + '"' : '') + '>' +
          (a.icon || escapeShellText(a.label || '')) +
        '</button>';
      });
    }
    html += '</div>';

    shell.innerHTML = html;
    // Insert at the top of the target so it sticks above content.
    target.insertBefore(shell, target.firstChild);

    // Wire handlers
    const backBtn = shell.querySelector('#shell-back');
    if (backBtn) {
      backBtn.onclick = function() {
        if (typeof opts.onBack === 'function') { opts.onBack(); return; }
        NavStack.back();
      };
    }
    if (Array.isArray(opts.actions)) {
      opts.actions.forEach(function(a) {
        if (!a || typeof a.onClick !== 'function') return;
        const el = shell.querySelector('[data-shell-action-id="' + (a.id || '') + '"]');
        if (el) el.onclick = a.onClick;
      });
    }
    return shell;
  }
  function escapeShellText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Expose for screens implemented outside the IIFE direct-access pattern.
  try {
    window.__bloomMountShell = mountShell;
  } catch (e) {}

  // ============ THEME (light/dark/auto) ============
  // Cycle through three states from the mute popover. The actual <html
  // data-theme="…"> swap happens here AND in the early head script (so
  // first paint matches the saved preference — no flash of wrong theme).
  function getThemePref() {
    return localStorage.getItem('bloom_theme') || 'auto';
  }
  function applyTheme(pref) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = pref === 'dark' || (pref === 'auto' && prefersDark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1A1816' : '#F5F5F0');
  }
  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const cur = getThemePref();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    try { localStorage.setItem('bloom_theme', next); } catch (e) {}
    applyTheme(next);
  }
  function syncThemeRow() {
    const lbl = document.getElementById('theme-label');
    const st  = document.getElementById('theme-state');
    if (!lbl || !st) return;
    const cur = getThemePref();
    const txt = cur === 'auto' ? 'אוטומטי' : cur === 'dark' ? 'כהה' : 'בהיר';
    const icon = cur === 'auto' ? '🖥️' : cur === 'dark' ? '🌙' : '☀️';
    lbl.textContent = txt;
    st.textContent = icon;
  }
  // Re-apply theme when OS preference changes (only matters in 'auto' mode).
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function() {
      if (getThemePref() === 'auto') applyTheme('auto');
    });
  }

  function openMuteMenu(anchor) {
    const existing = document.getElementById('mute-menu');
    if (existing) { closeMuteMenu(); return; }
    ensureAudio();
    // Append to home-screen when opened from home (so it's above the home overlay).
    // Otherwise append to .app for the regular in-game context.
    const parent = (anchor === 'home' && document.getElementById('home-screen'))
      || document.querySelector('.app');
    if (!parent) return;
    const menu = document.createElement('div');
    menu.id = 'mute-menu';
    menu.className = 'mute-menu mute-menu-volumes ' + (anchor === 'home' ? 'from-home' : 'from-top');
    menu.innerHTML =
      volSliderHtml('music', musicVolume) +
      volSliderHtml('sfx', sfxVolume) +
      '<div class="mute-item mute-item-theme" data-kind="theme">' +
        '<div class="mute-item-icon">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
        '</div>' +
        '<div class="mute-item-label">מצב <span id="theme-label">—</span></div>' +
        '<div class="mute-item-state" id="theme-state">—</div>' +
      '</div>' +
      '<div class="mute-item mute-item-all" data-kind="all">' +
        '<div class="mute-item-label">השתק הכל</div>' +
      '</div>' +
      '<div class="mute-item mute-item-reset" data-kind="reset" style="background:linear-gradient(135deg,#9FE1CB,#4FBD8B);color:#04342C;cursor:pointer">' +
        '<div class="mute-item-label" style="font-weight:800">🔊 איפוס סאונד</div>' +
        '<div class="mute-item-state" style="font-size:11px;opacity:0.8">לחיצה חוזרת אם הסאונד נעלם</div>' +
      '</div>';
    parent.appendChild(menu);
    syncMuteMenuItems();

    // Slider inputs — live update both per-channel state and the playing audio.
    menu.querySelectorAll('input.vol-slider').forEach(function(slider) {
      const kind = slider.getAttribute('data-slider');
      slider.addEventListener('input', function() {
        const v = (parseInt(this.value, 10) | 0) / 100;
        if (kind === 'music') setMusicVolume(v);
        else if (kind === 'sfx') setSfxVolume(v, { silent: true });
      });
      // Confirm chirp at the END of an SFX drag (not during) — once
      slider.addEventListener('change', function() {
        if (kind === 'sfx' && !isSfxMuted()) {
          tone({ freq: 523, duration: 0.07, type: 'sine', vol: 0.12 });
        }
      });
    });

    // Mute-all / unmute-all row
    const allBtn = menu.querySelector('[data-kind="all"]');
    if (allBtn) allBtn.onclick = function(e) {
      e.stopPropagation();
      if (isMusicMuted() && isSfxMuted()) unmuteAll(); else muteAll();
    };

    // Audio reset button — re-creates the audio context, restores volumes
    // to defaults if they collapsed to zero, plays a test chirp. Recovery
    // path for the "I lost all sound" complaint.
    const resetBtn = menu.querySelector('[data-kind="reset"]');
    if (resetBtn) resetBtn.onclick = function(e) {
      e.stopPropagation();
      if (typeof window.__bloomResetAudio === 'function') window.__bloomResetAudio();
    };

    // Theme cycle: auto → light → dark → auto
    const themeBtn = menu.querySelector('[data-kind="theme"]');
    if (themeBtn) themeBtn.onclick = function(e) {
      e.stopPropagation();
      cycleTheme();
      syncThemeRow();
    };
    syncThemeRow();

    setTimeout(function() {
      const onOutside = function(e) {
        if (!menu.contains(e.target) && !e.target.closest('#mute, #home-mute')) {
          closeMuteMenu();
          document.removeEventListener('pointerdown', onOutside, true);
        }
      };
      document.addEventListener('pointerdown', onOutside, true);
      menu.__outsideHandler = onOutside;
    }, 0);
  }
  function closeMuteMenu() {
    const menu = document.getElementById('mute-menu');
    if (!menu) return;
    if (menu.__outsideHandler) document.removeEventListener('pointerdown', menu.__outsideHandler, true);
    menu.remove();
  }
  function syncMuteMenuItems() {
    const menu = document.getElementById('mute-menu');
    if (!menu) return;
    const updates = [
      { kind: 'music', vol: musicVolume, muted: isMusicMuted() },
      { kind: 'sfx',   vol: sfxVolume,   muted: isSfxMuted() }
    ];
    updates.forEach(function(u) {
      const row = menu.querySelector('[data-kind="' + u.kind + '"]');
      if (!row) return;
      row.classList.toggle('off', u.muted);
      const pct = menu.querySelector('[data-pct="' + u.kind + '"]');
      if (pct) pct.textContent = Math.round(u.vol * 100) + '%';
      const slider = menu.querySelector('input[data-slider="' + u.kind + '"]');
      // Only set value if it doesn't match — avoids fighting an active drag.
      if (slider) {
        const want = String(Math.round(u.vol * 100));
        if (slider.value !== want) slider.value = want;
      }
    });
    const allItem = menu.querySelector('[data-kind="all"]');
    if (allItem) {
      allItem.querySelector('.mute-item-label').textContent =
        (isMusicMuted() && isSfxMuted()) ? 'הפעל הכל' : 'השתק הכל';
    }
  }

  /* ============ STREAK + ACHIEVEMENTS ============ */
  let currentGameMaxChain = 0;
  let streakBumpedThisSession = false;

  // Per-game stats for the game-over summary
  let gameMergesPerTier = {}; // tier → count of merges that CREATED this tier
  let gamePointsPerTier = {}; // tier → total points earned from this tier
  let gameBestMergeTier = 0;  // highest tier created from a single merge
  let gameTotalMerges = 0;    // total merge events
  let gameStartTime = 0;      // Date.now() when game started
  let bestBeatenThisGame = false; // live best tracking
  let usedContinue = false;       // second chance (once per game)
  const TOTAL_PLAY_TIME_KEY = 'bloom_total_play_ms';

  // ──────────────────────────────────────────────────────────────────────
  // Transient banner helper — all celebratory overlays (Crown Merge, score
  // milestones, new-best, etc.) go through this. Guarantees:
  //  - Always tagged `data-bloom-banner` so init() can sweep stuck ones on
  //    a new game (the original bug: setTimeout never firing on tab-blur or
  //    page-restore left modals stuck on the board).
  //  - Click-to-dismiss (pointer-events:auto on the banner itself), with a
  //    safety-net force-remove at hold + fade + 1500ms.
  //  - Idempotent — calling dispose twice is a no-op.
  function showTransientBanner(opts) {
    opts = opts || {};
    var holdMs = opts.holdMs != null ? opts.holdMs : 1500;
    var fadeMs = opts.fadeMs != null ? opts.fadeMs : 300;
    var banner = document.createElement('div');
    banner.setAttribute('data-bloom-banner', opts.tag || '1');
    banner.style.cssText = (opts.style || '') + ';cursor:pointer';
    banner.innerHTML = opts.html || '';
    var removed = false;
    function dispose() {
      if (removed) return;
      removed = true;
      try { banner.remove(); } catch (e) {}
    }
    function startFade() {
      if (removed) return;
      banner.style.transition = 'opacity ' + (fadeMs / 1000) + 's, transform ' + (fadeMs / 1000) + 's';
      banner.style.opacity = '0';
      if (opts.exitTransform) banner.style.transform = opts.exitTransform;
    }
    banner.addEventListener('click', dispose);
    document.body.appendChild(banner);
    if (opts.afterAppend) try { opts.afterAppend(banner); } catch (e) {}
    setTimeout(startFade, holdMs);
    setTimeout(dispose, holdMs + fadeMs);
    // Safety net: tab-throttling or page-hide can pause setTimeout. A delayed
    // force-cleanup catches any straggler when the user comes back.
    setTimeout(dispose, holdMs + fadeMs + 1500);
    return banner;
  }

  // Sweep any leftover banners — called by init() when a new game starts so
  // a celebration from the previous round can't carry over to a fresh board.
  function clearTransientBanners() {
    var els = document.querySelectorAll('[data-bloom-banner]');
    for (var i = 0; i < els.length; i++) els[i].remove();
  }

  // ============ §3.4 GENERIC TOAST HELPER ============
  // The audit asked for a single `showToast(text, type)` so every async
  // action (join contest, submit name, ad watch, etc) can confirm itself
  // in a consistent way. Implemented as a thin wrapper over the existing
  // transient-banner machinery so we don't duplicate the cleanup logic.
  //
  //   showToast('הצטרפת לתחרות הקיץ ✓');                     // info
  //   showToast('שגיאת חיבור — נסה שוב', 'error');           // error
  //   showToast('הציון נשמר!', 'success');                   // success
  function showToast(text, type) {
    if (!text) return null;
    type = type || 'info';
    var palette = {
      info:    { bg: '#FFF',     fg: '#1C1A18', border: 'rgba(0,0,0,0.10)' },
      success: { bg: '#2E8B6F',  fg: '#FFF',    border: 'transparent' },
      error:   { bg: '#FF8C42',  fg: '#FFF',    border: 'transparent' },
      warning: { bg: '#FAC775',  fg: '#412402', border: 'transparent' }
    };
    var p = palette[type] || palette.info;
    // De-dupe by tag so rapid successive toasts of the same type stack
    // gracefully (the previous banner gets cleaned up by its own timer).
    var safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return showTransientBanner({
      tag: 'toast-' + type,
      style: 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);' +
             'background:' + p.bg + ';color:' + p.fg + ';' +
             'border:1px solid ' + p.border + ';' +
             'padding:10px 18px;border-radius:10px;z-index:10005;' +
             'box-shadow:0 6px 24px rgba(0,0,0,0.18);direction:rtl;' +
             'font-size:14px;font-weight:600;letter-spacing:0.01em;' +
             'max-width:80vw;text-align:center;',
      html: safe,
      holdMs: 2400,
      fadeMs: 350,
      exitTransform: 'translateX(-50%) translateY(10px)'
    });
  }
  // Expose globally so screens defined outside the IIFE direct-access
  // pattern (or future src/15-ftue.js etc) can still call it.
  try { window.__bloomToast = showToast; } catch (e) {}

  function showNewBestBanner() {
    showTransientBanner({
      tag: 'new-best',
      holdMs: 1500, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#FAC775,#BA7517);border-radius:20px;padding:18px 30px;pointer-events:auto;text-align:center;box-shadow:0 0 30px rgba(250,199,117,0.5);min-width:180px',
      html: '<div style="font-size:22px;font-weight:800;color:#1C1A18">🎉 שיא חדש!</div><div style="font-size:28px;font-weight:900;color:#412402;margin-top:4px">' + score.toLocaleString() + '</div>',
    });
    buzz([80, 40, 80, 40, 80]);
    showConfetti(25);
    var bestShake = parseInt(getEventConfig('shake_new_best', '4'), 10) || 0;
    if (bestShake > 0) shakeGrid(bestShake);
  }

  // Per-game tracking: which milestone tiers have already paid their bonus.
  // Reset in init() at the start of each game. The bonuses fire ONCE per
  // game when the player's highestTier crosses 5/6/7/8 for the first time.
  let tierUpHit = {};
  const TIER_UP_BONUS = { 5: 500, 6: 1500, 7: 5000, 8: 15000 };

  function loadStreak() {
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      if (!raw) return { count: 0, lastPlayed: null };
      const v = JSON.parse(raw);
      return { count: v.count | 0, lastPlayed: v.lastPlayed || null };
    } catch (e) { return { count: 0, lastPlayed: null }; }
  }
  function saveStreak(s) { try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch (e) {} }
  function daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00Z');
    const db = new Date(b + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }
  function bumpStreak() {
    const today = todayInIsrael();
    const s = loadStreak();
    if (s.lastPlayed === today) return s;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) === 1) s.count = (s.count | 0) + 1;
    else s.count = 1;
    s.lastPlayed = today;
    saveStreak(s);
    bumpLifetimeMax(BEST_STREAK_KEY, s.count);
    renderStreakBadge();
    checkAchievements({ streakNow: s.count });
    // Earn streak credits at milestones
    if (!window.__bloomBotActive) {
      if (s.count === 3) earnCredits('streak_3');
      else if (s.count === 7) earnCredits('streak_7');
      else if (s.count === 30) earnCredits('streak_30');
    }
    return s;
  }
  function renderStreakBadge() {
    const el = document.getElementById('streak');
    if (!el) return;
    const s = loadStreak();
    const today = todayInIsrael();
    let n = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) n = 0;
    el.textContent = '🔥 ' + n;
    if (n > 0) el.classList.remove('zero');
    else el.classList.add('zero');
  }

  const ACH_GROUPS = [
    { id: 'tier', name: 'דרגות' },
    { id: 'chain', name: 'שרשראות' },
    { id: 'score', name: 'ניקוד' },
    { id: 'streak', name: 'רצף ימים' },
    { id: 'general', name: 'כללי' }
  ];
  const ACHIEVEMENTS = [
    { id: 'tier_fire',   group: 'tier',    name: 'אש',             desc: 'הגעת לדרגת אש',     check: function(s){ return s.highestTier >= 4; } },
    { id: 'tier_star',   group: 'tier',    name: 'כוכב',            desc: 'הגעת לדרגת כוכב',   check: function(s){ return s.highestTier >= 6; } },
    { id: 'tier_crown',  group: 'tier',    name: 'כתר',             desc: 'הגעת לדרגת כתר',    check: function(s){ return s.highestTier >= 8; } },
    { id: 'chain_2',     group: 'chain',   name: 'שרשרת ×1.5',      desc: 'שרשרת של 2 מיזוגים',  check: function(s){ return s.maxChain >= 2; } },
    { id: 'chain_3',     group: 'chain',   name: 'שרשרת ×2',        desc: 'שרשרת של 3 מיזוגים',  check: function(s){ return s.maxChain >= 3; } },
    { id: 'chain_5',     group: 'chain',   name: 'שרשרת ×3',        desc: 'שרשרת של 5 מיזוגים',  check: function(s){ return s.maxChain >= 5; } },
    { id: 'score_10k',   group: 'score',   name: '10,000',          desc: 'הגעת ל-10K במשחק אחד', check: function(s){ return s.score >= 10000; } },
    { id: 'score_50k',   group: 'score',   name: '50,000',          desc: 'הגעת ל-50K במשחק אחד', check: function(s){ return s.score >= 50000; } },
    { id: 'score_100k',  group: 'score',   name: '100,000',         desc: 'הגעת ל-100K במשחק אחד',check: function(s){ return s.score >= 100000; } },
    { id: 'streak_3',    group: 'streak',  name: '3 ימים',          desc: 'שיחקת 3 ימים רצוף',    check: function(s){ return s.streakNow >= 3; } },
    { id: 'streak_7',    group: 'streak',  name: 'שבוע',            desc: '7 ימים רצוף',          check: function(s){ return s.streakNow >= 7; } },
    { id: 'streak_30',   group: 'streak',  name: 'חודש',            desc: '30 ימים רצוף',         check: function(s){ return s.streakNow >= 30; } },
    { id: 'first_play',  group: 'general', name: 'המשחק הראשון',    desc: 'התחלת לשחק',          check: function(s){ return (s.gamesPlayed | 0) >= 1; } },
    { id: 'games_10',    group: 'general', name: '10 משחקים',       desc: 'סיימת 10 משחקים',      check: function(s){ return (s.gamesPlayed | 0) >= 10; } },
    { id: 'games_50',    group: 'general', name: '50 משחקים',       desc: 'סיימת 50 משחקים',      check: function(s){ return (s.gamesPlayed | 0) >= 50; } }
  ];
  const ACH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 1-3 3"/></svg>';

  function loadUnlocked() {
    try {
      const raw = localStorage.getItem(ACH_KEY);
      if (!raw) return {};
      const arr = JSON.parse(raw);
      const m = {};
      for (let i = 0; i < arr.length; i++) m[arr[i]] = true;
      return m;
    } catch (e) { return {}; }
  }
  function saveUnlocked(map) {
    try {
      const ids = Object.keys(map).filter(function(k){ return map[k]; });
      localStorage.setItem(ACH_KEY, JSON.stringify(ids));
    } catch (e) {}
  }
  function unlockedSnapshot() { return loadUnlocked(); }
  function loadGamesPlayed() {
    try { return parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) | 0; } catch (e) { return 0; }
  }
  function incrementGamesPlayed() {
    const n = loadGamesPlayed() + 1;
    try { localStorage.setItem(GAMES_COUNT_KEY, String(n)); } catch (e) {}
    return n;
  }
  // Generic int helpers for the lifetime "personal best" trackers.
  function loadLifetimeInt(key) {
    try { return parseInt(localStorage.getItem(key) || '0', 10) | 0; } catch (e) { return 0; }
  }
  function bumpLifetimeMax(key, candidate) {
    const c = candidate | 0;
    if (c <= 0) return;
    const cur = loadLifetimeInt(key);
    if (c > cur) { try { localStorage.setItem(key, String(c)); } catch (e) {} }
  }
  function addLifetimeTotal(key, delta) {
    const d = delta | 0;
    if (d <= 0) return;
    const cur = loadLifetimeInt(key);
    try { localStorage.setItem(key, String(cur + d)); } catch (e) {}
  }

  function currentAchievementState(extra) {
    const s = loadStreak();
    const today = todayInIsrael();
    let streakNow = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakNow = 0;
    return Object.assign({
      score: score | 0,
      highestTier: highestTier | 0,
      maxChain: currentGameMaxChain | 0,
      streakNow: streakNow,
      gamesPlayed: loadGamesPlayed()
    }, extra || {});
  }

  function checkAchievements(extra) {
    const state = currentAchievementState(extra);
    const unlocked = loadUnlocked();
    const newly = [];
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      if (unlocked[a.id]) continue;
      try {
        if (a.check(state)) { unlocked[a.id] = true; newly.push(a); }
      } catch (e) {}
    }
    if (newly.length) {
      saveUnlocked(unlocked);
      for (let i = 0; i < newly.length; i++) {
        (function(a, idx) {
          setTimeout(function() { showAchievementToast(a); }, idx * 700);
        })(newly[i], i);
      }
    }
  }

  function showAchievementToast(a) {
    const t = document.createElement('div');
    t.className = 'ach-unlock-toast';
    t.innerHTML = ACH_ICON_SVG + '<span>הישג חדש: ' + a.name + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3200);
    tone({ freq: 659, duration: 0.12, type: 'triangle', vol: 0.12 });
    tone({ freq: 784, duration: 0.16, type: 'triangle', vol: 0.12, delay: 0.08 });
  }

  function openAchievementsModal() {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('ach-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'ach-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="ach-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="info-title">הישגים</div>' +
        '<div id="ach-modal-body"></div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('ach-modal-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    renderAchievementsBody();
  }

  function renderAchievementsBody() {
    const body = document.getElementById('ach-modal-body');
    if (!body) return;
    const unlocked = loadUnlocked();
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter(function(a){ return unlocked[a.id]; }).length;

    // Lifetime stats panel
    const bestTier = loadLifetimeInt(BEST_TIER_KEY);
    const bestTierName = (bestTier > 0 && getActiveTiers()[bestTier]) ? getActiveTiers()[bestTier].name : '—';
    const stats = [
      { label: 'משחקים',         value: loadGamesPlayed().toLocaleString() },
      { label: 'שיא במשחק',      value: (best | 0).toLocaleString() },
      { label: 'דרגה מקסימלית',  value: bestTierName },
      { label: 'שרשרת ארוכה',    value: loadLifetimeInt(BEST_CHAIN_KEY) || '—' },
      { label: 'רצף שיא',         value: loadLifetimeInt(BEST_STREAK_KEY) || '—' },
      { label: 'ניקוד מצטבר',    value: loadLifetimeInt(TOTAL_SCORE_KEY).toLocaleString() }
    ];
    let statsHtml = '<div class="stats-grid">';
    for (let i = 0; i < stats.length; i++) {
      statsHtml += '<div class="stat-card">' +
        '<div class="stat-card-label">' + stats[i].label + '</div>' +
        '<div class="stat-card-value">' + stats[i].value + '</div>' +
      '</div>';
    }
    statsHtml += '</div>';

    let html = '<div class="ach-summary">המספרים שלך · פתחת <b>' + got + '</b> מתוך ' + total + ' הישגים</div>';
    html += statsHtml;
    for (let g = 0; g < ACH_GROUPS.length; g++) {
      const grp = ACH_GROUPS[g];
      const items = ACHIEVEMENTS.filter(function(a){ return a.group === grp.id; });
      if (!items.length) continue;
      html += '<div class="ach-group-title">' + grp.name + '</div>';
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const isUnlocked = !!unlocked[a.id];
        html += '<div class="ach-row ' + (isUnlocked ? 'unlocked' : 'locked') + '">' +
          '<div class="ach-icon">' + ACH_ICON_SVG + '</div>' +
          '<div class="ach-text"><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + '</div></div>' +
        '</div>';
      }
    }
    body.innerHTML = html;
  }

  /* ============ HOME SCREEN ============ */
  function showHome() {
    // ── Home delegation chain: v2 (default) → v1 (legacy fallback) ──
    // v3 (the star-mascot + tile-legend variant) was rolled back after
    // the user explicitly didn't like it. Its source files stay in the
    // repo for reference, but it's no longer reachable from this entry
    // point. Anyone who had `bloom_home_v3` set is cleared on boot via
    // the migration block in src/05a-home-v2.js.
    if (typeof homeV2Enabled === 'function' && homeV2Enabled()
        && typeof showHomeV2 === 'function') {
      try { return showHomeV2(); }
      catch (e) {
        console.error('[home] v2 failed, falling back to v1:', e);
        try { if (typeof disableHomeV2 === 'function') disableHomeV2(); } catch (_) {}
      }
    }
    stopEventSystem(); // don't run events behind home screen
    if (typeof purgeEventOverlays === 'function') purgeEventOverlays();
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    // Mark the app so CSS can hide the game UI behind the home overlay.
    app.setAttribute('data-home', 'active');
    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen';
    h.innerHTML =
      '<button class="home-mute" id="home-mute" aria-label="השתק">' +
        '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
      '</button>' +
      // §1.4 — social-proof pulse bar. Hidden until first /api/stats/live
      // response lands; refreshed every 15s while home is visible.
      '<div class="home-live-pulse" id="home-live-pulse" style="display:none">' +
        '<span class="home-live-dot"></span>' +
        '<span class="home-live-text" id="home-live-text">טוען…</span>' +
      '</div>' +
      '<div class="home-icons" id="home-icons-tap">' +
        '<div class="home-icon" style="background:#CECBF6;color:#26215C">' + SVG.crown + '</div>' +
        '<div class="home-icon" style="background:#9FE1CB;color:#04342C">' + SVG.star + '</div>' +
        '<div class="home-icon" style="background:#F5C4B3;color:#4A1B0C">' + SVG.flame + '</div>' +
        '<div class="home-icon" style="background:#F4C0D1;color:#4B1528">' + SVG.flower + '</div>' +
        '<div class="home-icon" style="background:#C0DD97;color:#173404">' + SVG.leaf + '</div>' +
      '</div>' +
      '<div class="home-brand">BLOOM</div>' +
      '<div class="home-sub">מזג חפצים, גלה דרגות חדשות, והגע עד לכתר</div>' +
      '<div class="home-player-id" id="home-player-id"></div>' +
      '<div id="home-streak-host"></div>' +
      '<div class="home-stats-bubble" id="home-stats-bubble" style="display:none"></div>' +
      // Primary CTA
      (hasSeenTour()
        ? '<button class="home-start" id="home-start">שחק עכשיו</button>'
        : '<button class="home-start" id="home-start">בוא נתחיל</button>') +
      '<div class="home-social" id="home-social"></div>' +
      // Weekly challenge + jackpot
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +
      // Contest + Challenge grid (2 columns)
      '<div class="home-actions-grid">' +
        (activeContestCode
          ? '<button class="home-action-btn home-action-contest active" id="home-contest"><span class="home-action-badge active">פעיל</span>תחרות חברים</button>'
          : '<button class="home-action-btn home-action-contest" id="home-contest"><span class="home-action-badge">חדש</span>תחרות חברים</button>') +
        '<button class="home-action-btn home-action-challenge" id="home-challenge">' +
          '<span class="home-action-badge prize">פרס</span>' +
          '<span id="home-challenge-label">אתגרי BLOOM</span>' +
        '</button>' +
      '</div>' +
      // Skins + Duel grid
      '<div class="home-actions-grid" style="margin-top:8px">' +
        '<button class="home-action-btn home-action-secondary" id="home-skin-shop">🎨 סקינים</button>' +
        '<button class="home-action-btn home-action-secondary" id="home-duel-btn">⚔️ דו-קרב 1v1</button>' +
      '</div>' +
      // Single invite button
      '<button class="home-invite-wa" id="home-invite-wa">' +
        '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
        '<span>📱 הזמן חבר דרך WhatsApp</span>' +
      '</button>' +
      // Tour link (bottom)
      (!hasSeenTour()
        ? '<button class="home-skip" id="home-skip">אני יודע לשחק, דלג</button>'
        : '<button class="home-skip" id="home-tour-btn" style="margin-top:8px;color:#BA7517">📖 איך משחקים?</button>') +
      // v2 is now the default. Anyone landing on v1 explicitly asked
      // for it (via ?home=v1 or the v2 toggle button) so we surface a
      // "back to recommended" hint instead of the old "try v2" CTA.
      '<button class="home-v1-try-v2" id="home-v1-back-to-v2">↩ חזור לגירסה החדשה (מומלץ)</button>' +
      '<div style="text-align:center;margin-top:14px;font-size:11px;opacity:.6"><a href="/privacy" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">מדיניות פרטיות</a></div>';
    app.appendChild(h);
    syncHomeMuteUI();
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      ensureAudio();
      openMuteMenu('home');
    };
    const enter = function() {
      ensureAudio();
      hideHome();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      if (onOverScreen) init('practice');
      playMusic('game');
      // Start/restart event system when entering the game
      startEventSystem();

      // If we're returning to a paused contest game, make sure the overtake
      // watcher is running again (it was stopped when navigating away).
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };
    // Tap tier icons → reveal hidden stats bubble
    var iconsTap = document.getElementById('home-icons-tap');
    var statsBubble = document.getElementById('home-stats-bubble');
    if (iconsTap && statsBubble) {
      iconsTap.style.cursor = 'pointer';
      iconsTap.onclick = function() {
        var isOpen = statsBubble.style.display !== 'none';
        statsBubble.style.display = isOpen ? 'none' : '';
        if (!isOpen) statsBubble.style.animation = 'bubblePop 0.25s ease-out';
      };
      // Tap outside bubble → close it
      document.addEventListener('pointerdown', function(e) {
        if (statsBubble.style.display === 'none') return;
        if (statsBubble.contains(e.target) || iconsTap.contains(e.target)) return;
        statsBubble.style.display = 'none';
      });
    }

    document.getElementById('home-start').onclick = function() {
      ensureAudio();
      if (!hasSeenTour()) { showTour({ onDone: enter }); }
      else { enter(); }
    };
    const skipBtn = document.getElementById('home-skip');
    if (skipBtn) skipBtn.onclick = enter;
    const contestBtn = document.getElementById('home-contest');
    if (contestBtn) contestBtn.onclick = function() {
      ensureAudio();
      if (mode === 'practice') savePracticeGameState();
      showContestMenu();
    };
    refreshHomeChallengeCta();
    refreshHomeSocialProof();
    refreshHomeJackpot();
    refreshHomeStreak();
    refreshHomeWeekly();
    // WhatsApp invite button
    var waInvite = document.getElementById('home-invite-wa');
    if (waInvite) waInvite.onclick = function(e) {
      e.stopPropagation();
      var link = window.location.origin + window.location.pathname;
      var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
      var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
      var playerNm = (getPlayerName() || '').trim();
      var text = '🌸 ';
      if (playerNm) text += playerNm + ' מזמין/ה אותך ל-BLOOM!\n\n';
      else text += 'הזמנה ל-BLOOM!\n\n';
      text += 'משחק מיזוג ממכר בעברית 🎮\n';
      if (totalGames > 0) text += 'כבר שיחקתי ' + totalGames + ' משחקים';
      if (totalMs > 60000) {
        var h = Math.floor(totalMs / 3600000);
        var m = Math.floor((totalMs % 3600000) / 60000);
        text += h > 0 ? ' (' + h + ' שעות ו-' + m + ' דקות 🤯)' : ' (' + m + ' דקות!)';
      }
      text += '\n\nנסה וגלה אם תצליח לנצח אותי:\n' + link;
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      trackEvent('share', { method: 'whatsapp', type: 'invite' });
    };
    // Wire the "איך משחקים?" link
    const tourLink = document.getElementById('home-tour-btn');
    if (tourLink) tourLink.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    // "Back to v2" toggle — clears the v1-force flag and re-renders.
    // (Renamed from the old "try v2" CTA since v2 is now the default.)
    const backToV2Btn = document.getElementById('home-v1-back-to-v2');
    if (backToV2Btn) backToV2Btn.onclick = function() {
      if (typeof enableHomeV2 === 'function') enableHomeV2();
      hideHome();
      showHome(); // delegation in showHome will route to v2
    };
    var skinShopBtn = document.getElementById('home-skin-shop');
    if (skinShopBtn) skinShopBtn.onclick = function() { showSkinShop(); };
    var duelBtn = document.getElementById('home-duel-btn');
    if (duelBtn) duelBtn.onclick = function() { showDuelModal(); };

    // Show player code on home + profile link
    var pidEl = document.getElementById('home-player-id');
    function renderHomePid() {
      if (!pidEl || !playerCode) return;
      var lvlText = playerLevel > 1 ? ' · ' + getLevelIcon() + ' Lv.' + playerLevel : '';
      var nm = (getPlayerName() || '').trim();
      var nameBit = nm && nm !== 'אנונימי'
        ? '<span class="pid-name">' + nm + '</span> <button class="pid-edit-name" type="button" title="ערוך שם" aria-label="ערוך שם">✏️</button> · '
        : '<button class="pid-edit-name" type="button" title="בחר שם" aria-label="בחר שם">✏️ בחר שם</button> · ';
      pidEl.innerHTML = nameBit +
        '<span class="pid-code">' + playerCode + '</span> · <span class="pid-balance">' + playerBalance + ' 💎</span>' + lvlText +
        '<a href="/player/' + playerCode + '" target="_blank" class="pid-profile-link">👤 הפרופיל שלי</a>';
      var codeEl = pidEl.querySelector('.pid-code');
      if (codeEl) codeEl.onclick = function(e) {
        e.stopPropagation();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(playerCode);
          codeEl.textContent = '✓ הועתק!';
          setTimeout(function() { codeEl.textContent = playerCode; }, 1500);
        }
      };
      var editBtn = pidEl.querySelector('.pid-edit-name');
      if (editBtn) editBtn.onclick = function(e) {
        e.stopPropagation();
        promptForName(function() { renderHomePid(); }, { edit: true });
      };
    }
    renderHomePid();
    // First-ever-visit: gently auto-open the tour after the home settles in.
    // We defer it so the home animations land first, and only fire if the
    // player hasn't seen the tour AND hasn't already started learning the
    // game via the in-game coach toasts.
    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        // Re-check in case they navigated away in the meantime
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
    playMusic('lobby');
    // Daily login reward — show after home settles
    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    // §1.4 — social proof: fetch live counts immediately, then every 15s
    // while home is visible. The interval is torn down by hideHome().
    startHomeLivePulse();
  }

  // ============ §1.4 LIVE PULSE (social proof) ============
  // Keeps a 15-second polling loop alive while the home screen is mounted.
  // The bar shows "🟢 N שחקנים פעילים · M משחקים היום" — both numbers come
  // from GET /api/stats/live. We hide it until first response so an empty
  // value doesn't flash on cold open.
  let homeLivePulseTimer = null;
  function startHomeLivePulse() {
    stopHomeLivePulse();
    refreshHomeLivePulse();
    homeLivePulseTimer = setInterval(refreshHomeLivePulse, 15000);
  }
  function stopHomeLivePulse() {
    if (homeLivePulseTimer) { clearInterval(homeLivePulseTimer); homeLivePulseTimer = null; }
  }
  function refreshHomeLivePulse() {
    fetch(API_BASE + '/api/stats/live').then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
      if (!data) return;
      const pulse = document.getElementById('home-live-pulse');
      const text  = document.getElementById('home-live-text');
      if (!pulse || !text) return;
      const playing = (data.playingNow != null) ? data.playingNow : 0;
      const games   = (data.gamesToday != null) ? data.gamesToday : 0;
      // Only render the bar if we have at least *some* signal — empty
      // bars feel ghost-towny and undermine the social-proof goal.
      if (playing < 1 && games < 1) {
        pulse.style.display = 'none';
        return;
      }
      // Wording mirrors what the audit asked for, with a small fudge for
      // the cold-start case where activeNow is genuinely 0 — fall back
      // to playingNow (visited recently) so the bar still says *something*.
      var parts = [];
      if (playing > 0) parts.push('<strong>' + playing.toLocaleString() + '</strong> שחקנים פעילים');
      if (games > 0)   parts.push('<strong>' + games.toLocaleString() + '</strong> משחקים היום');
      text.innerHTML = parts.join(' · ');
      pulse.style.display = '';
    }).catch(function() { /* silent — social proof is best-effort */ });
  }

  function hideHome() {
    stopHomeLivePulse();
    const h = document.getElementById('home-screen');
    if (h) h.remove();
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('data-home');
  }
  function syncHomeMuteUI() { updateMuteUI(); }

  /* ============ FRIENDS CONTEST SCREENS ============ */

  // ============================================================
  // Home v2 — second-generation home screen (HOME_AUDIT.md)
  // ============================================================
  // Built side-by-side with the legacy home in src/05-home.js. Both
  // versions live in the build and the player picks via URL param
  // (?home=v2 / ?home=v1) or the small toggle link at the bottom of
  // each layout. The choice persists in localStorage.bloom_home_v2.
  //
  // Once the user signs off, the delegation in src/05-home.js can
  // flip to default-v2 and the legacy home becomes the opt-out path.
  //
  // Coverage vs HOME_AUDIT.md tasks:
  //   A1 ✅  Personal hero banner (streak / best-score / urgency)
  //   A2 ✅  Live-pulse bar with tiered fallback — never disappears
  //   A3 ✅  WhatsApp invite demoted to a small bottom link
  //   A4 ✅  Player-ID across 3 readable lines
  //   B1 ✅  Notification badges on action buttons (duels + challenges)
  //   B2 ✅  Featured-action picker by activity state
  //   B3 ⏭   Stats-bubble affordance (deferred — bubble already exists)
  //   C1 ⏭   Animated brand mark (deferred — would need new assets)
  //   C2 ⏭   "What's new" banner (deferred)
  //   C3 ✅  safe-area-inset-bottom on the bottom padding
  // ============================================================

  // v2 is now the canonical home. v1 stays available as opt-out via
  // ?home=v1 or the toggle inside v2 — useful for screenshot diffs +
  // a quick rollback if something visual regresses on a player's setup.
  const HOME_V1_FORCE_KEY = 'bloom_home_v1_force';
  const HOME_V2_KEY = 'bloom_home_v2'; // legacy — read-only for migration
  // One-shot migration: clear the v3 opt-in flag for anyone who had it
  // set when we rolled v3 back. Runs once per page load — cheap.
  try { localStorage.removeItem('bloom_home_v3'); } catch (e) {}

  function homeV2Enabled() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('home');
      if (v === 'v1') { localStorage.setItem(HOME_V1_FORCE_KEY, '1'); return false; }
      if (v === 'v2') { localStorage.removeItem(HOME_V1_FORCE_KEY); return true; }
      // No URL param: v2 is default unless v1 was explicitly forced.
      return localStorage.getItem(HOME_V1_FORCE_KEY) !== '1';
    } catch (e) { return true; }
  }

  function enableHomeV2() {
    try { localStorage.removeItem(HOME_V1_FORCE_KEY); } catch (e) {}
  }
  function disableHomeV2() {
    try { localStorage.setItem(HOME_V1_FORCE_KEY, '1'); } catch (e) {}
  }

  function showHomeV2() {
    stopEventSystem();
    if (typeof purgeEventOverlays === 'function') purgeEventOverlays();
    // Going home = leaving any dynamic-board session. Next game starts vanilla.
    if (typeof clearDynamicBoardSession === 'function') clearDynamicBoardSession();
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    // Mark the app so CSS can hide the game UI behind the home overlay.
    app.setAttribute('data-home', 'active');
    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen home-v2';

    h.innerHTML =
      // ── Top bar: mute + always-visible social proof (§A2) ──
      '<div class="home-v2-topbar">' +
        '<button class="home-v2-mute" id="home-mute" aria-label="השתק">' +
          '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
        '</button>' +
        '<div class="home-v2-live-pulse" id="home-v2-live-pulse">' +
          '<span class="home-v2-live-dot"></span>' +
          '<span class="home-v2-live-text" id="home-v2-live-text">טוען…</span>' +
        '</div>' +
      '</div>' +

      // ── Compact brand area ──
      '<div class="home-v2-brand-wrap">' +
        '<div class="home-icons home-v2-icons" id="home-icons-tap">' +
          '<div class="home-icon" style="background:#CECBF6;color:#26215C">' + SVG.crown + '</div>' +
          '<div class="home-icon" style="background:#9FE1CB;color:#04342C">' + SVG.star + '</div>' +
          '<div class="home-icon" style="background:#F5C4B3;color:#4A1B0C">' + SVG.flame + '</div>' +
          '<div class="home-icon" style="background:#F4C0D1;color:#4B1528">' + SVG.flower + '</div>' +
          '<div class="home-icon" style="background:#C0DD97;color:#173404">' + SVG.leaf + '</div>' +
        '</div>' +
        '<div class="home-v2-brand">BLOOM</div>' +
      '</div>' +

      // ── Personal hero banner (§A1) — adaptive ──
      '<div class="home-v2-hero" id="home-v2-hero"></div>' +

      // ── Player identity across 3 lines (§A4) ──
      '<div class="home-v2-pid" id="home-v2-pid"></div>' +

      // ── Primary CTA — bigger, with optional daily badge ──
      '<button class="home-v2-cta" id="home-v2-start">' +
        '<span class="home-v2-cta-label" id="home-v2-cta-label">🎮 שחק עכשיו</span>' +
        '<span class="home-v2-cta-sub" id="home-v2-cta-sub"></span>' +
      '</button>' +

      // ── Your week stats — single line, scannable ──
      '<div class="home-v2-mystats" id="home-v2-mystats"></div>' +

      // ── Featured action (§B2) — dynamic ──
      '<div class="home-v2-featured" id="home-v2-featured"></div>' +

      // ── Secondary actions grid 2x2 with badges (§B1) ──
      '<div class="home-v2-actions">' +
        '<button class="home-v2-action" id="home-v2-contest" data-action="contest">' +
          '<span class="home-v2-badge" id="home-v2-contest-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">👥</span>' +
          '<span class="home-v2-action-label">תחרות</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-challenge" data-action="challenge">' +
          '<span class="home-v2-badge home-v2-badge-prize" id="home-v2-challenge-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">🏆</span>' +
          '<span class="home-v2-action-label">אתגרים</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-duel" data-action="duel">' +
          '<span class="home-v2-badge" id="home-v2-duel-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">⚔️</span>' +
          '<span class="home-v2-action-label">דו-קרב</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-skins" data-action="skins">' +
          '<span class="home-v2-action-icon">🎨</span>' +
          '<span class="home-v2-action-label">סקינים</span>' +
        '</button>' +
      '</div>' +

      // ── Dynamic Boards entry — only visible when boards are available.
      // Hidden by default; updateDynamicBoardsButton() flips display
      // after the /api/boards/available fetch resolves.
      '<button class="home-v2-boards" id="home-v2-boards" style="display:none">' +
        '<span class="home-v2-boards-icon">🎯</span>' +
        '<span class="home-v2-boards-text">' +
          '<span class="home-v2-boards-title">לוחות דינמיים</span>' +
          '<span class="home-v2-boards-count">לוחות זמינים</span>' +
        '</span>' +
        '<span class="home-v2-boards-arrow">›</span>' +
      '</button>' +

      // ── Weekly + Jackpot (reuse v1 hosts so the existing refresh* helpers work as-is) ──
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +

      // ── Bottom links area ──
      // v3 "try it" link removed (rolled back per user feedback).
      '<div class="home-v2-bottom">' +
        (hasSeenTour()
          ? '<button class="home-v2-link" id="home-v2-tour">📖 איך משחקים?</button>'
          : '<button class="home-v2-link home-v2-link-skip" id="home-v2-skip">דלג על הסיור</button>') +
        '<button class="home-v2-link" id="home-v2-invite">📱 הזמן חבר</button>' +
        '<button class="home-v2-link home-v2-switch" id="home-v2-switch">↩ הגירסה הישנה</button>' +
        '<a class="home-v2-link" href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a>' +
      '</div>';

    app.appendChild(h);
    syncHomeMuteUI();

    // ── Wire up handlers ──
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      ensureAudio();
      openMuteMenu('home');
    };

    const enter = function() {
      ensureAudio();
      hideHomeV2();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      if (onOverScreen) init('practice');
      playMusic('game');
      startEventSystem();
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };

    document.getElementById('home-v2-start').onclick = function() {
      ensureAudio();
      if (!hasSeenTour()) { showTour({ onDone: enter }); }
      else { enter(); }
    };

    document.getElementById('home-v2-contest').onclick = function() {
      ensureAudio();
      if (mode === 'practice') savePracticeGameState();
      showContestMenu();
    };
    document.getElementById('home-v2-challenge').onclick = function() {
      ensureAudio();
      if (typeof showChallengesList === 'function') showChallengesList('home-v2');
    };
    document.getElementById('home-v2-duel').onclick = function() {
      ensureAudio();
      if (typeof showDuelModal === 'function') showDuelModal();
    };
    document.getElementById('home-v2-skins').onclick = function() {
      if (typeof showSkinShop === 'function') showSkinShop();
    };
    document.getElementById('home-v2-boards').onclick = function() {
      ensureAudio();
      if (typeof showDynamicBoardsPicker === 'function') showDynamicBoardsPicker();
    };
    // Sync visibility immediately in case the boards-list was already loaded.
    if (typeof updateDynamicBoardsButton === 'function') updateDynamicBoardsButton();

    // Tier-icons tap → reveal stats bubble (same behaviour as v1)
    var iconsTap = document.getElementById('home-icons-tap');
    if (iconsTap) {
      iconsTap.style.cursor = 'pointer';
      iconsTap.onclick = function() {
        // For v2 the bubble lives in the hero area — show a transient toast instead.
        try { if (window.__bloomToast) window.__bloomToast(buildPlayerHistoryToast(), 'info'); } catch (e) {}
      };
    }

    // Bottom links
    var tourBtn = document.getElementById('home-v2-tour');
    if (tourBtn) tourBtn.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    var skipBtn = document.getElementById('home-v2-skip');
    if (skipBtn) skipBtn.onclick = enter;
    var inviteBtn = document.getElementById('home-v2-invite');
    if (inviteBtn) inviteBtn.onclick = function(e) {
      e.stopPropagation();
      whatsappInviteV2();
    };
    var switchBtn = document.getElementById('home-v2-switch');
    if (switchBtn) switchBtn.onclick = function() {
      disableHomeV2();
      hideHomeV2();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('home');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
      showHome(); // v1 fallback
    };
    // v3 "try it" handler removed (button no longer rendered).

    // ── Populate dynamic sections ──
    renderHeroBannerV2();
    renderPlayerIdV2();
    renderMyStatsV2();
    refreshHomeV2LivePulse();
    refreshHomeV2Badges();
    refreshFeaturedActionV2();
    refreshHomeChallengeCta();    // reuses v1 helper — paints the challenge button label
    refreshHomeJackpot();
    refreshHomeWeekly();
    startHomeV2LivePulse();

    playMusic('lobby');

    // Daily login reward — same delay as v1
    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    // Addiction triggers — checked after the daily login modal has had
    // a chance to render. Order matters: comeback wins over streak-danger
    // because comeback fires for absent players (more urgent re-engage).
    setTimeout(function() {
      if (!document.getElementById('home-screen')) return;
      if (typeof maybeShowComebackBonus === 'function') {
        if (maybeShowComebackBonus()) return; // showed comeback, skip streak-danger
      }
      if (typeof maybeShowStreakDangerBanner === 'function') maybeShowStreakDangerBanner();
    }, 1200);

    // Gift inbox poll — single fetch on home open. Recipient sees a
    // banner for any unseen player-to-player gifts. The server marks
    // them seen on read so we never re-toast the same gift.
    setTimeout(function() {
      if (typeof pollGiftInbox === 'function') pollGiftInbox();
    }, 1500);

    // Auto-tour for first-time visitors (mirrors v1 behaviour)
    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
  }

  function hideHomeV2() {
    stopHomeV2LivePulse();
    // Stop the dynamic-boards FOMO tick so we don't keep updating a
    // detached DOM node every minute.
    if (typeof window.stopDynamicBoardsTick === 'function') window.stopDynamicBoardsTick();
    const h = document.getElementById('home-screen');
    if (h) h.remove();
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('data-home');
  }

  // ============================================================
  // ADDICTION TRIGGERS — streak danger / comeback / gift inbox
  // ============================================================

  // §Streak danger — fires once per evening when a player with a real
  // streak (≥3 days) opens the app late and HASN'T played today yet.
  // The point isn't to punish, it's to give the player a clear "you
  // worked for this, don't lose it" reminder when the loss window is
  // closing. Persists a "dismissed for today" flag so a player who
  // saw the banner already isn't re-nagged on every navigation.
  function maybeShowStreakDangerBanner() {
    try {
      if (typeof loadStreak !== 'function') return;
      const s = loadStreak();
      if (!s || (s.count | 0) < 3) return;
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (!today) return;
      const playedToday = !!localStorage.getItem(DAILY_PLAYED_PREFIX + today);
      if (playedToday) return;
      // Israel local time check
      const israelNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
      const hour = israelNow.getHours();
      if (hour < 19) return; // only after 19:00 IL
      // Dismissed-today guard so we don't re-fire on every home re-render
      const dismissKey = 'bloom_streak_danger_dismissed:' + today;
      if (localStorage.getItem(dismissKey)) return;
      const hoursLeft = 24 - hour;
      const minutesLeft = 60 - israelNow.getMinutes();
      const timeText = hoursLeft > 1
        ? hoursLeft + ' שעות'
        : (minutesLeft + ' דקות');
      const banner = document.createElement('div');
      banner.id = 'streak-danger-banner';
      banner.style.cssText =
        'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
        'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
        'z-index:9999;background:linear-gradient(135deg,#FF6B6B,#FAC775);' +
        'border-radius:14px;padding:12px 18px;direction:rtl;' +
        'font-family:inherit;font-size:13px;color:#1C1A18;font-weight:700;' +
        'box-shadow:0 8px 24px rgba(255,107,107,0.35);cursor:pointer;' +
        'max-width:340px;width:calc(100vw - 32px);';
      banner.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="font-size:28px">🔥</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:900;font-size:14px">רצף ' + (s.count | 0) + ' ימים בסכנה!</div>' +
            '<div style="font-size:11px;opacity:0.85;margin-top:2px">נשארו ' + timeText + ' · לחץ לשחק</div>' +
          '</div>' +
          '<div style="font-size:14px;opacity:0.7">✕</div>' +
        '</div>';
      document.body.appendChild(banner);
      requestAnimationFrame(function() {
        banner.style.opacity = '1';
        banner.style.transform = 'translateX(-50%) translateY(0)';
      });
      const dismiss = function() {
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(function() { banner.remove(); }, 250);
        try { localStorage.setItem(dismissKey, '1'); } catch (e) {}
      };
      banner.onclick = function(e) {
        if (e.target && e.target.textContent === '✕') { dismiss(); return; }
        dismiss();
        // Tap = "I'll play now" — open the daily challenge.
        hideHomeV2();
        if (typeof init === 'function') init('daily');
      };
      // Auto-hide after 9 seconds so we don't block the home indefinitely
      setTimeout(dismiss, 9000);
    } catch (e) { /* never throw from a notification path */ }
  }

  // §Comeback bonus — fires when the player returns after a ≥2-day
  // absence. Server enforces the actual reward amount via the new
  // 'comeback' earn action; the client only requests it. Tracks
  // last_play_date locally so we know how long they were away.
  const LAST_PLAY_KEY = 'bloom_last_play_date';
  function recordLastPlayDate() {
    try {
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (today) localStorage.setItem(LAST_PLAY_KEY, today);
    } catch (e) {}
  }
  try { window.__bloomRecordLastPlay = recordLastPlayDate; } catch (e) {}

  function maybeShowComebackBonus() {
    try {
      const lastPlay = localStorage.getItem(LAST_PLAY_KEY);
      if (!lastPlay) {
        // First time we have this signal — seed it and skip (we don't
        // know how long they were away). Will trigger correctly next time.
        recordLastPlayDate();
        return false;
      }
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (!today || today === lastPlay) return false;
      // Compute day delta. todayInIsrael returns 'YYYY-MM-DD', parseable as UTC.
      const daysSince = Math.floor((new Date(today) - new Date(lastPlay)) / (24 * 60 * 60 * 1000));
      if (daysSince < 2) return false;
      if (daysSince > 365) return false; // sanity — probably a clock skew
      // Per-day dedup so a player who opens the app 5 times today only
      // sees the comeback modal once.
      const claimedKey = 'bloom_comeback_claimed:' + today;
      if (localStorage.getItem(claimedKey)) return false;
      // Fire the server reward + show the modal
      try { localStorage.setItem(claimedKey, '1'); } catch (e) {}
      const expectedReward = daysSince >= 30 ? 200 : daysSince >= 7 ? 100 : 50;
      // Show modal immediately with an optimistic amount; server confirms it
      showComebackModal(daysSince, expectedReward);
      if (typeof earnCredits === 'function') {
        earnCredits('comeback', { daysSince: daysSince });
      }
      // Update the last-play date so we don't double-fire tomorrow
      recordLastPlayDate();
      return true;
    } catch (e) { return false; }
  }

  function showComebackModal(daysSince, reward) {
    if (document.getElementById('comeback-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'comeback-modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;' +
      'display:flex;align-items:center;justify-content:center;direction:rtl;' +
      'animation:fadeIn 0.25s ease-out;';
    const headline = daysSince >= 30 ? 'מזמן לא ראינו אותך!' : daysSince >= 7 ? 'ברוך השב!' : 'נחמד שחזרת';
    const sub = daysSince >= 30 ? 'חודש שלם בלעדיך' : daysSince + ' ימים בלעדיך';
    overlay.innerHTML =
      '<div style="background:linear-gradient(180deg,#FFF,#FFF8E7);border-radius:20px;padding:28px 24px;' +
        'max-width:320px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);' +
        'border:2px solid #FAC775;animation:comebackPop 0.5s cubic-bezier(.2,1.4,.4,1)">' +
        '<div style="font-size:48px;margin-bottom:8px">🎁</div>' +
        '<div style="font-size:22px;font-weight:900;color:#1C1A18">' + headline + '</div>' +
        '<div style="font-size:13px;color:#6F6E68;margin-top:6px">' + sub + '</div>' +
        '<div style="margin:20px 0;padding:16px;background:linear-gradient(135deg,#FAC775,#BA7517);' +
          'border-radius:14px;color:#FFF">' +
          '<div style="font-size:11px;font-weight:600;opacity:0.85">בונוס חזרה</div>' +
          '<div style="font-size:34px;font-weight:900;line-height:1.1;margin-top:2px">+' + reward + ' 💎</div>' +
        '</div>' +
        '<button id="comeback-claim" style="width:100%;padding:14px;border:none;border-radius:12px;' +
          'background:#1C1A18;color:#FAC775;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit">' +
          'בוא נשחק! 🎮' +
        '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    const close = function() {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.25s ease-in';
      setTimeout(function() { overlay.remove(); }, 250);
    };
    document.getElementById('comeback-claim').onclick = function() {
      close();
      hideHomeV2();
      if (typeof init === 'function') init('practice', { fresh: true });
    };
    overlay.onclick = function(e) { if (e.target === overlay) close(); };
  }

  // §Player gift inbox — fetches unseen player-to-player gifts and
  // surfaces them as toast banners. Server marks them seen on read.
  // We also dedup client-side via localStorage to defend against the
  // rare race where the server's UPDATE failed silently.
  const GIFT_SEEN_KEY = 'bloom_gift_seen_ids';
  function loadSeenGifts() {
    try { return new Set(JSON.parse(localStorage.getItem(GIFT_SEEN_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function markGiftSeen(id) {
    try {
      const seen = loadSeenGifts();
      seen.add(id);
      const arr = Array.from(seen);
      // Cap at 500 ids
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      localStorage.setItem(GIFT_SEEN_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  }
  // Exposed globally so the unified social refresh loop in 13-boot.js
  // can call it on the same cadence as duel notifications (every 10s
  // while visible + on visibility/focus). Without this, gifts only
  // polled once-on-home-mount and were invisible to a recipient who
  // was mid-game when the gift landed.
  try { window.__bloomPollGiftInbox = pollGiftInbox; } catch (e) {}

  function pollGiftInbox() {
    if (typeof deviceId === 'undefined' || !deviceId) return;
    fetch(API_BASE + '/api/player/gifts/inbox?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.gifts) || !data.gifts.length) return;
        const seen = loadSeenGifts();
        let delay = 0;
        data.gifts.forEach(function(g) {
          if (seen.has(g.id)) return; // we already surfaced this one
          // Stagger banners so a player who got 3 gifts at once sees
          // them sequentially, not stacked on top of each other.
          setTimeout(function() { showGiftBanner(g); }, delay);
          markGiftSeen(g.id);
          delay += 800;
        });
        // The server credited the balance already — pull a fresh value
        // so the home pid balance refreshes immediately.
        if (data.gifts.length && typeof fetchPlayerCode === 'function') fetchPlayerCode();
      })
      .catch(function() { /* silent — best-effort polling */ });
  }
  function showGiftBanner(gift) {
    const senderName = (gift.sender_name || gift.sender_code || 'שחקן').toString().slice(0, 40);
    const amount = gift.amount | 0;
    const msg = (gift.message || '').toString().slice(0, 120);
    const banner = document.createElement('div');
    banner.style.cssText =
      'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
      'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
      'z-index:9999;background:linear-gradient(135deg,#1C1A18,#2A2724);' +
      'border:2px solid #FAC775;border-radius:14px;padding:12px 16px;direction:rtl;' +
      'font-family:inherit;font-size:13px;color:#FAC775;' +
      'box-shadow:0 8px 24px rgba(186,117,23,0.4);cursor:pointer;' +
      'max-width:340px;width:calc(100vw - 32px);';
    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="font-size:30px">🎁</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:900;color:#FFF;font-size:14px">' +
            (typeof escapeHtml === 'function' ? escapeHtml(senderName) : senderName) +
            ' שלח/ה לך מתנה!</div>' +
          '<div style="font-size:16px;font-weight:800;margin-top:4px">+' + amount + ' 💎</div>' +
          (msg ? '<div style="font-size:11px;color:#A8A6A0;margin-top:4px;font-style:italic">"' +
            (typeof escapeHtml === 'function' ? escapeHtml(msg) : msg) + '"</div>' : '') +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(function() {
      banner.style.opacity = '1';
      banner.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Tactile + tonal alert so the player FEELS the gift arriving,
    // not just sees it. Both are no-ops on browsers that don't
    // support them — buzz() guards internally + soundDrop guards
    // via ensureAudio.
    try { if (typeof buzz === 'function') buzz([8, 20, 8, 20, 16]); } catch (e) {}
    try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
    const dismiss = function() {
      banner.style.opacity = '0';
      banner.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(function() { banner.remove(); }, 250);
    };
    banner.onclick = dismiss;
    setTimeout(dismiss, 5500);
  }

  // ── §A1: personal hero banner ──
  // Picks the single most-relevant message for the player's current
  // state. Returning streak holders get FOMO; players with a real
  // best score get a "beat it" CTA; cold dead-hours fall back to
  // urgency about the daily challenge.
  function renderHeroBannerV2() {
    const el = document.getElementById('home-v2-hero');
    if (!el) return;
    const streak = (typeof loadStreak === 'function') ? loadStreak() : { count: 0 };
    const todayKey = (typeof DAILY_PLAYED_PREFIX !== 'undefined') ? (DAILY_PLAYED_PREFIX + dailyDate) : null;
    const todayPlayed = todayKey && !!localStorage.getItem(todayKey);
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    const totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const hours = new Date().getHours();

    let html = '';

    // Highest-priority hero: a paused contest game. The state was saved
    // on beforeunload / visibilitychange / per-drop autosave; without
    // surfacing it on home the player has to navigate manually back into
    // the contest to resume — friction that loses runs the player would
    // otherwise have finished.
    const pausedContest = findPausedContestGame();
    if (pausedContest) {
      const ageMin = Math.max(1, Math.round((Date.now() - pausedContest.ts) / 60000));
      const ageText = ageMin < 60 ? ageMin + ' דק׳' : Math.round(ageMin / 60) + ' שע׳';
      // After 12h the run almost certainly isn't worth resuming — soft-warn
      // instead of celebrating, but still offer the path back.
      const stale = ageMin > 12 * 60;
      const cls = stale ? 'hero-card hero-card-done' : 'hero-card hero-card-best';
      const icon = stale ? '⏱' : '⏸';
      const title = stale
        ? 'יש משחק ישן מושהה'
        : 'המשך משחק בתחרות';
      const sub = (pausedContest.contestName ? pausedContest.contestName + ' · ' : '') +
        'ניקוד: ' + (pausedContest.score | 0).toLocaleString() + ' · נשמר לפני ' + ageText;
      el.innerHTML = '<div class="' + cls + '" id="hero-resume-contest" role="button" tabindex="0" style="cursor:pointer">' +
        '<span class="hero-icon">' + icon + '</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">' + escapeHtml(title) + '</div>' +
          '<div class="hero-sub">' + escapeHtml(sub) + '</div>' +
        '</div>' +
      '</div>';
      el.style.display = '';
      const resumeEl = document.getElementById('hero-resume-contest');
      if (resumeEl) {
        const go = function() {
          if (typeof setActiveContest === 'function') setActiveContest(pausedContest.code);
          if (typeof hideHome === 'function') hideHome();
          if (typeof init === 'function') init('contest');
        };
        resumeEl.onclick = go;
        resumeEl.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      }
      return;
    }

    if (totalGames === 0) {
      // Brand-new player: leave the hero empty (the FTUE/tour will handle them)
      el.style.display = 'none';
      return;
    }

    if (streak.count >= 7) {
      html = '<div class="hero-card hero-card-streak hero-card-hot">' +
        '<span class="hero-icon">🔥🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף!</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'כל הכבוד — חזרת היום' : 'אל תאבד את הרצף — יש לך עד חצות') + '</div>' +
        '</div>' +
      '</div>';
    } else if (streak.count >= 3) {
      html = '<div class="hero-card hero-card-streak">' +
        '<span class="hero-icon">🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'נשמר ליום נוסף ✓' : 'שחק היום ותגיע ליום ' + (streak.count + 1)) + '</div>' +
        '</div>' +
      '</div>';
    } else if (bestEver >= 5000 && !todayPlayed) {
      html = '<div class="hero-card hero-card-best">' +
        '<span class="hero-icon">🏆</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">השיא שלך: ' + bestEver.toLocaleString() + '</div>' +
          '<div class="hero-sub">תנצח את עצמך היום?</div>' +
        '</div>' +
      '</div>';
    } else if (hours >= 21 && !todayPlayed) {
      const hoursLeft = 24 - hours;
      html = '<div class="hero-card hero-card-urgent">' +
        '<span class="hero-icon">⏰</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">עוד ' + hoursLeft + ' שעות לאתגר היומי</div>' +
          '<div class="hero-sub">אל תפספס</div>' +
        '</div>' +
      '</div>';
    } else if (todayPlayed) {
      html = '<div class="hero-card hero-card-done">' +
        '<span class="hero-icon">✅</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">סיימת את האתגר היומי</div>' +
          '<div class="hero-sub">המשך לפרקטיס או הזמן חבר לדו-קרב</div>' +
        '</div>' +
      '</div>';
    } else {
      // Regular player, mid-day, no special state — keep it soft
      el.style.display = 'none';
      return;
    }

    el.innerHTML = html;
    el.style.display = '';
  }

  // ── §A4: compact 3-line player-ID ──
  function renderPlayerIdV2() {
    const el = document.getElementById('home-v2-pid');
    if (!el) return;
    const nm = (getPlayerName() || '').trim();
    const isReal = (typeof hasRealPlayerName === 'function') ? hasRealPlayerName() : !!nm;
    const lvl = (typeof playerLevel !== 'undefined' && playerLevel > 1)
      ? '<span class="pid2-meta-item">' + getLevelIcon() + ' Lv.' + playerLevel + '</span>'
      : '';
    const code = (typeof playerCode !== 'undefined' && playerCode) ? playerCode : '';
    const bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;

    const nameLine = isReal
      ? '<span class="pid2-name">' + escapeHtmlV2(nm) + '</span> <button class="pid2-edit" type="button" aria-label="ערוך שם">✏️</button>'
      : '<button class="pid2-edit pid2-edit-prompt" type="button">✏️ קבע את השם שלך</button>';

    el.innerHTML =
      '<div class="pid2-line pid2-line-name">' + nameLine + '</div>' +
      (code ?
        '<div class="pid2-line pid2-line-meta" dir="ltr">' +
          '<button class="pid2-code" type="button" aria-label="העתק קוד">' + code + '</button>' +
          '<span class="pid2-meta-sep">·</span>' +
          '<span class="pid2-meta-item pid2-balance">💎 ' + bal.toLocaleString() + '</span>' +
          (lvl ? '<span class="pid2-meta-sep">·</span>' + lvl : '') +
        '</div>' : '') +
      (code ?
        '<div class="pid2-line pid2-line-profile">' +
          '<a class="pid2-profile-link" href="/player/' + encodeURIComponent(code) + '" target="_blank" rel="noopener">👤 הפרופיל שלי</a>' +
        '</div>' : '');

    const editBtn = el.querySelector('.pid2-edit');
    if (editBtn) editBtn.onclick = function() {
      promptForName(function() { renderPlayerIdV2(); }, { edit: true });
    };
    const codeBtn = el.querySelector('.pid2-code');
    if (codeBtn) codeBtn.onclick = function(e) {
      e.stopPropagation();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code);
        const orig = codeBtn.textContent;
        codeBtn.textContent = '✓ הועתק';
        setTimeout(function() { codeBtn.textContent = orig; }, 1400);
      }
    };
  }

  // ── Your week stats — small scannable line ──
  function renderMyStatsV2() {
    const el = document.getElementById('home-v2-mystats');
    if (!el) return;
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    const totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    if (total === 0) { el.style.display = 'none'; return; }
    const totalH = Math.floor(totalMs / 3600000);
    const totalM = Math.floor((totalMs % 3600000) / 60000);
    const timeText = totalH > 0 ? totalH + 'ש ' + totalM + 'ד' : totalM + ' דקות';
    el.innerHTML =
      '<span class="mystats2-item">🎮 ' + total.toLocaleString() + ' משחקים</span>' +
      (bestEver > 0 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">🏆 שיא ' + bestEver.toLocaleString() + '</span>' : '') +
      (totalMs > 60000 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">⏱ ' + timeText + '</span>' : '');
    el.style.display = '';
  }

  // ── §A2: live-pulse with tiered fallback (never hides) ──
  let homeV2PulseTimer = null;
  function startHomeV2LivePulse() {
    stopHomeV2LivePulse();
    refreshHomeV2LivePulse();
    homeV2PulseTimer = setInterval(refreshHomeV2LivePulse, 15000);
  }
  function stopHomeV2LivePulse() {
    if (homeV2PulseTimer) { clearInterval(homeV2PulseTimer); homeV2PulseTimer = null; }
  }
  function refreshHomeV2LivePulse() {
    fetch(API_BASE + '/api/stats/live').then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
      if (!data) return;
      const el = document.getElementById('home-v2-live-text');
      const wrap = document.getElementById('home-v2-live-pulse');
      if (!el || !wrap) return;
      const playing = data.playingNow | 0;
      const games   = data.gamesToday | 0;
      const hour    = data.activeThisHour | 0;
      const week    = data.gamesThisWeek | 0;

      let html = '';
      if (playing >= 3) {
        html = '<strong>' + playing.toLocaleString() + '</strong> שחקנים פעילים עכשיו';
        wrap.classList.add('home-v2-live-hot');
      } else if (games > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + games.toLocaleString() + '</strong> משחקים היום';
      } else if (hour > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + hour.toLocaleString() + '</strong> שחקנים בשעה האחרונה';
      } else if (week > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + week.toLocaleString() + '</strong> משחקים השבוע';
      } else {
        // Genuinely brand-new universe — be honest, not ghost-towny
        wrap.classList.remove('home-v2-live-hot');
        html = '🌸 הצטרף לראשונים';
      }
      el.innerHTML = html;
      wrap.style.display = '';
    }).catch(function() { /* silent */ });
  }

  // ── §B1: notification badges on the action grid ──
  //
  // Acknowledgement persistence: previously the "seen" set lived in
  // sessionStorage, so closing the tab made every duel "unseen" again
  // and the red badge re-appeared forever. Moved to localStorage with
  // a stable schema. The set is bounded (cleanupAcknowledgedDuels)
  // so it can't grow unbounded.
  const DUEL_ACK_KEY = 'bloom_ack_duel_ids';
  function loadAcknowledgedDuels() {
    try {
      const raw = localStorage.getItem(DUEL_ACK_KEY);
      if (!raw) {
        // One-shot migration from the legacy sessionStorage key.
        const legacy = sessionStorage.getItem('bloom_seen_duel_notifications');
        if (legacy) {
          try { localStorage.setItem(DUEL_ACK_KEY, legacy); } catch (e) {}
          try { sessionStorage.removeItem('bloom_seen_duel_notifications'); } catch (e) {}
          return JSON.parse(legacy) || [];
        }
        return [];
      }
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveAcknowledgedDuels(arr) {
    try {
      // Cap at the most recent 500 ids — anything beyond that is rotational
      // noise (settled duels we'll never see again).
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      localStorage.setItem(DUEL_ACK_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  }
  function isDuelAcknowledged(id) {
    return loadAcknowledgedDuels().indexOf(id) >= 0;
  }
  function markDuelAcknowledged(id) {
    if (id == null) return;
    const arr = loadAcknowledgedDuels();
    if (arr.indexOf(id) < 0) {
      arr.push(id);
      saveAcknowledgedDuels(arr);
    }
  }
  function markAllDuelsAcknowledged(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const arr = loadAcknowledgedDuels();
    let changed = false;
    ids.forEach(function(id) {
      if (id != null && arr.indexOf(id) < 0) { arr.push(id); changed = true; }
    });
    if (changed) {
      saveAcknowledgedDuels(arr);
      // Re-paint the home badge immediately so the change is visible
      // the moment the modal closes (the home stays in the DOM behind
      // the modal, so the badge element is updatable from here).
      if (document.getElementById('home-v2-duel-badge')) {
        try { refreshHomeV2Badges(); } catch (e) {}
      }
    }
  }
  // Expose for src/02-shop.js to call from inside the duel modal — both
  // when the modal opens (mass-ack) and when the user declines a duel
  // (single-ack). Also used by acceptDuel via the same path.
  try {
    window.__bloomMarkDuelAcknowledged = markDuelAcknowledged;
    window.__bloomMarkAllDuelsAcknowledged = markAllDuelsAcknowledged;
  } catch (e) {}

  function refreshHomeV2Badges() {
    if (typeof deviceId === 'undefined' || !deviceId) return;
    // Duels: count ids the player has NOT yet acknowledged. Once they
    // open the duel modal (which calls markAllDuelsAcknowledged), the
    // badge clears. New duels that arrive later are unacknowledged so
    // the badge re-appears with just the new count.
    fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.duels)) return;
        var unseen = 0;
        data.duels.forEach(function(d) {
          // Only "meaningful" statuses count toward the badge:
          //   - pending where I'm the opponent (action needed)
          //   - settled/tie (result to read)
          // 'accepted' duels in progress aren't surfaced as a notification
          // (the player knows — they're in the middle of playing).
          const isPendingForMe = d.opponent_code === playerCode && d.status === 'pending';
          const isResolved = d.status === 'settled' || d.status === 'tie';
          if (!isPendingForMe && !isResolved) return;
          if (!isDuelAcknowledged(d.id)) unseen++;
        });
        paintBadgeV2('home-v2-duel-badge', unseen);
      })
      .catch(function() {});

    // Active prize challenges — show the prize value as the badge
    fetch(API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.challenges)) return;
        const active = data.challenges.filter(function(c) {
          return c.status === 'active' && !(c.myEntry && c.myEntry.status === 'completed');
        });
        paintBadgeV2('home-v2-challenge-badge', active.length);
      })
      .catch(function() {});
  }
  function paintBadgeV2(elId, n) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!n || n < 1) { el.style.display = 'none'; return; }
    el.textContent = n > 9 ? '9+' : String(n);
    el.style.display = '';
  }

  // ── §B2: featured-action picker ──
  // Decides the single most-urgent secondary action and surfaces it
  // as a prominent gradient card above the regular 2x2 grid.
  function refreshFeaturedActionV2() {
    const el = document.getElementById('home-v2-featured');
    if (!el || typeof deviceId === 'undefined' || !deviceId) return;
    // Priority order (first hit wins):
    //   1. Pending duel where I'm the opponent
    //   2. Active contest with my row dropping behind
    //   3. Active prize challenge I haven't entered
    //   4. Nothing → hide
    el.style.display = 'none';
    el.innerHTML = '';

    fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.duels)) throw new Error('skip');
        const pending = data.duels.find(function(d) {
          return d.opponent_code === playerCode && d.status === 'pending';
        });
        if (pending) {
          const oppName = pending.challenger_name || pending.challenger_code || 'יריב';
          paintFeaturedV2('duel', '⚔️', 'דו-קרב ממתין!', oppName + ' אתגר אותך', '#FF6B6B', function() {
            if (typeof showDuelModal === 'function') showDuelModal();
          });
          return Promise.reject('done');
        }
        return null;
      })
      .then(function() {
        // Fallback: try active challenges
        return fetch(API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId)).then(function(r) { return r.ok ? r.json() : null; });
      })
      .then(function(data) {
        if (!data || !Array.isArray(data.challenges)) return;
        const fresh = data.challenges.find(function(c) {
          return c.status === 'active' && (!c.myEntry || c.myEntry.status !== 'completed');
        });
        if (fresh) {
          const prize = fresh.prize_text ? ('פרס: ' + fresh.prize_text) : 'פעיל עכשיו';
          paintFeaturedV2('challenge', '🏆', escapeHtmlV2(fresh.name || 'אתגר פעיל'), prize, '#FAC775', function() {
            if (typeof showChallengeDetail === 'function') showChallengeDetail(fresh.slug);
            else if (typeof showChallengesList === 'function') showChallengesList('home-v2-featured');
          });
        }
      })
      .catch(function() { /* `done` skips the rest, that's intentional */ });
  }
  function paintFeaturedV2(kind, icon, title, sub, color, onClick) {
    const el = document.getElementById('home-v2-featured');
    if (!el) return;
    el.innerHTML =
      '<button class="home-v2-feat home-v2-feat-' + kind + '" style="--feat-color:' + color + '">' +
        '<span class="home-v2-feat-icon">' + icon + '</span>' +
        '<div class="home-v2-feat-body">' +
          '<div class="home-v2-feat-title">' + title + '</div>' +
          '<div class="home-v2-feat-sub">' + sub + '</div>' +
        '</div>' +
        '<span class="home-v2-feat-arrow">←</span>' +
      '</button>';
    el.style.display = '';
    const btn = el.querySelector('.home-v2-feat');
    if (btn) btn.onclick = function() {
      ensureAudio();
      if (typeof onClick === 'function') onClick();
    };
  }

  // ── WhatsApp invite (same as v1 but triggered from the small bottom link) ──
  function whatsappInviteV2() {
    var link = window.location.origin + window.location.pathname;
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    var playerNm = (getPlayerName() || '').trim();
    var text = '🌸 ';
    if (playerNm) text += playerNm + ' מזמין/ה אותך ל-BLOOM!\n\n';
    else text += 'הזמנה ל-BLOOM!\n\n';
    text += 'משחק מיזוג ממכר בעברית 🎮\n';
    if (totalGames > 0) text += 'כבר שיחקתי ' + totalGames + ' משחקים';
    if (totalMs > 60000) {
      var h2 = Math.floor(totalMs / 3600000);
      var m2 = Math.floor((totalMs % 3600000) / 60000);
      text += h2 > 0 ? ' (' + h2 + ' שעות ו-' + m2 + ' דקות 🤯)' : ' (' + m2 + ' דקות!)';
    }
    text += '\n\nנסה וגלה אם תצליח לנצח אותי:\n' + link;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    try { trackEvent('share', { method: 'whatsapp', type: 'invite_v2' }); } catch (e) {}
  }

  // ── Helpers ──
  function buildPlayerHistoryToast() {
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    if (total === 0) return 'עוד לא שיחקת — התחל עכשיו';
    return 'שיחקת ' + total + ' משחקים · שיא: ' + bestEver.toLocaleString();
  }
  function escapeHtmlV2(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // ============================================================
  // Home v3 — premium-tier home screen (HOME_AUDIT.md targets 9.5+)
  // ============================================================
  // Builds on v2's information architecture and layers in every
  // improvement called out in the self-score: animated brand mark,
  // flower mascot with face, pre-game tier-up teaser, week-over-week
  // stats comparison, accessibility (skip-link + aria-live + lazy
  // badges), animated background mesh, and a "what's new" banner.
  //
  // Same opt-in pattern as v2: ?home=v3 / localStorage.bloom_home_v3.
  // Once approved the delegation flips to default-v3.
  // ============================================================

  const HOME_V3_KEY = 'bloom_home_v3';
  const WEEK_STATS_KEY = 'bloom_week_stats_v3';
  const WHATS_NEW_KEY  = 'bloom_whats_new_seen';
  const WHATS_NEW_VERSION = 'v20260520n';
  const WHATS_NEW_BODY = '✨ סקין Aurora עם אנימציות + מיני-מסקוט בבית + מסך משחק חדש';

  function homeV3Enabled() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('home');
      if (v === 'v3') { localStorage.setItem(HOME_V3_KEY, '1'); return true; }
      if (v === 'v2' || v === 'v1') { localStorage.removeItem(HOME_V3_KEY); return false; }
      return localStorage.getItem(HOME_V3_KEY) === '1';
    } catch (e) { return false; }
  }
  function enableHomeV3() { try { localStorage.setItem(HOME_V3_KEY, '1'); } catch (e) {} }
  function disableHomeV3() { try { localStorage.removeItem(HOME_V3_KEY); } catch (e) {} }

  // Calculate the player's tier-up goal for this session. Uses their
  // historical best score as the heuristic and picks the next tier
  // they should aim for. Returns null for players with no signal.
  function calculatePregameGoal() {
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    // Best-score → suggested-target-tier brackets.
    // The reward is the existing TIER_UP_BONUS for that tier (real points
    // the engine already awards when the player first reaches it). The
    // teaser tells them about a reward they can ACTUALLY collect, just
    // surfaces it more visibly than the in-game milestone banner.
    let targetTier = null;
    if (best < 1500)        targetTier = 4;  // Flame ← entry players
    else if (best < 5000)   targetTier = 5;  // Bolt
    else if (best < 15000)  targetTier = 6;  // Star
    else if (best < 40000)  targetTier = 7;  // Diamond
    else                    targetTier = 8;  // Crown — for veterans
    if (!targetTier) return null;
    const rewardMap = { 4: 200, 5: 500, 6: 1500, 7: 5000, 8: 15000 };
    const tiers = getActiveTiers ? getActiveTiers() : [];
    const ti = tiers[targetTier] || {};
    return {
      tier: targetTier,
      reward: rewardMap[targetTier] || 500,
      name: ti.name || ('דרגה ' + targetTier),
      emoji: ti.emoji || '⭐'
    };
  }

  // Persist this session's goal so the engine can verify hit on game-over.
  function persistPregameGoal(goal) {
    if (!goal) return;
    try {
      localStorage.setItem('bloom_pregame_goal', JSON.stringify({
        tier: goal.tier, reward: goal.reward, ts: Date.now()
      }));
    } catch (e) {}
  }

  // Track week-over-week stats client-side. Each day records games-count;
  // we compare today's running total against 7 days ago.
  function recordWeekStats() {
    try {
      const today = todayInIsrael();
      const raw = localStorage.getItem(WEEK_STATS_KEY);
      let history = {};
      if (raw) {
        try { history = JSON.parse(raw) || {}; } catch (e) {}
      }
      const currentTotal = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
      history[today] = currentTotal;
      // Keep only the last 14 days
      const keys = Object.keys(history).sort();
      while (keys.length > 14) {
        delete history[keys.shift()];
      }
      localStorage.setItem(WEEK_STATS_KEY, JSON.stringify(history));
    } catch (e) {}
  }
  function getWeekDelta() {
    try {
      const raw = localStorage.getItem(WEEK_STATS_KEY);
      if (!raw) return null;
      const history = JSON.parse(raw) || {};
      const keys = Object.keys(history).sort();
      if (keys.length < 2) return null;
      const today = keys[keys.length - 1];
      const todayTotal = history[today] || 0;
      const sevenDaysAgoKey = keys.find(function(k) {
        const d = new Date(k);
        const t = new Date(today);
        return (t - d) / 86400000 >= 7;
      });
      if (!sevenDaysAgoKey) {
        // Not enough history — use the oldest available
        const earliestKey = keys[0];
        const earliestTotal = history[earliestKey] || 0;
        return {
          thisWeek: todayTotal - earliestTotal,
          delta: null,
          daysOfData: keys.length
        };
      }
      const sevenAgoTotal = history[sevenDaysAgoKey] || 0;
      const earlierKey = keys[Math.max(0, keys.indexOf(sevenDaysAgoKey) - 7)];
      const earlierTotal = history[earlierKey] || 0;
      const thisWeek  = todayTotal    - sevenAgoTotal;
      const prevWeek  = sevenAgoTotal - earlierTotal;
      return { thisWeek: thisWeek, prevWeek: prevWeek, delta: thisWeek - prevWeek };
    } catch (e) { return null; }
  }

  function showHomeV3() {
    stopEventSystem();
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    // Belt-and-suspenders overlay enforcement: also set a data attribute
    // so CSS can hide game-UI siblings even when :has() isn't supported.
    app.setAttribute('data-home', 'active');
    recordWeekStats();

    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen home-v3';

    const goal = calculatePregameGoal();
    if (goal) persistPregameGoal(goal);

    h.innerHTML =
      // Accessibility: skip link (first focusable element)
      '<a class="home-v3-skip-link" href="#home-v3-start">דלג ל-CTA הראשי</a>' +

      // Floating background mesh — purely decorative, aria-hidden
      '<div class="home-v3-mesh" aria-hidden="true">' +
        '<span class="mesh-tile mesh-t1"></span>' +
        '<span class="mesh-tile mesh-t2"></span>' +
        '<span class="mesh-tile mesh-t3"></span>' +
        '<span class="mesh-tile mesh-t4"></span>' +
        '<span class="mesh-tile mesh-t5"></span>' +
        '<span class="mesh-tile mesh-t6"></span>' +
        '<span class="mesh-tile mesh-t7"></span>' +
      '</div>' +

      // Topbar: mute + always-visible social proof (aria-live)
      '<div class="home-v3-topbar">' +
        '<button class="home-v2-mute" id="home-mute" aria-label="השתק">' +
          '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
        '</button>' +
        '<div class="home-v2-live-pulse" id="home-v2-live-pulse" role="status" aria-live="polite" aria-atomic="true">' +
          '<span class="home-v2-live-dot"></span>' +
          '<span class="home-v2-live-text" id="home-v2-live-text">טוען…</span>' +
        '</div>' +
      '</div>' +

      // "What's new" banner — conditional
      buildWhatsNewBanner() +

      // Brand area: smiling-star mascot (universally appealing across
      // demographics, ties into the tier-6 "star" goal in-game) + the
      // wordmark + the new tile legend that replaces the old animated
      // brand-mark loop.
      '<div class="home-v3-brand-area">' +
        '<div class="home-v3-mascot" id="home-v3-mascot">' + buildFlowerMascotSvg() + '</div>' +
        '<div class="home-v3-brand">BLOOM</div>' +
        '<div class="home-v3-tagline">מזג, גדל, הגע לכתר 👑</div>' +
      '</div>' +

      // §"חוקים לפי האריחים" — the player explicitly asked for the tier
      // ladder to be visible on the home screen as a learning aid.
      buildTileLegend() +

      // Personal hero banner — adaptive
      '<div class="home-v2-hero" id="home-v2-hero"></div>' +

      // Player identity (3 lines)
      '<div class="home-v2-pid" id="home-v2-pid"></div>' +

      // Pre-game teaser — surfaces existing tier-up bonuses as a goal
      (goal ? buildPregameTeaserHtml(goal) : '') +

      // Primary CTA
      '<button class="home-v2-cta home-v3-cta" id="home-v3-start" aria-label="התחל לשחק">' +
        '<span class="home-v2-cta-label" id="home-v2-cta-label">🎮 שחק עכשיו</span>' +
        '<span class="home-v2-cta-sub" id="home-v2-cta-sub"></span>' +
      '</button>' +

      // Mystats with week-over-week comparison
      '<div class="home-v2-mystats home-v3-mystats" id="home-v2-mystats"></div>' +

      // Featured action
      '<div class="home-v2-featured" id="home-v2-featured"></div>' +

      // Secondary 2x2 grid
      '<div class="home-v2-actions">' +
        '<button class="home-v2-action" id="home-v2-contest" data-action="contest" aria-label="תחרות חברים">' +
          '<span class="home-v2-badge" id="home-v2-contest-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">👥</span>' +
          '<span class="home-v2-action-label">תחרות</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-challenge" data-action="challenge" aria-label="אתגרי BLOOM">' +
          '<span class="home-v2-badge home-v2-badge-prize" id="home-v2-challenge-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">🏆</span>' +
          '<span class="home-v2-action-label">אתגרים</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-duel" data-action="duel" aria-label="דו-קרב 1v1">' +
          '<span class="home-v2-badge" id="home-v2-duel-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">⚔️</span>' +
          '<span class="home-v2-action-label">דו-קרב</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-skins" data-action="skins" aria-label="חנות סקינים">' +
          '<span class="home-v2-action-icon" aria-hidden="true">🎨</span>' +
          '<span class="home-v2-action-label">סקינים</span>' +
        '</button>' +
      '</div>' +

      // Weekly + Jackpot (reuse hosts so v1/v2 helpers paint them)
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +

      // Bottom links area
      '<div class="home-v2-bottom">' +
        (hasSeenTour()
          ? '<button class="home-v2-link" id="home-v2-tour">📖 איך משחקים?</button>'
          : '<button class="home-v2-link home-v2-link-skip" id="home-v2-skip">דלג על הסיור</button>') +
        '<button class="home-v2-link" id="home-v2-invite">📱 הזמן חבר</button>' +
        '<button class="home-v2-link home-v2-switch" id="home-v3-back">↩ הגירסה הקודמת</button>' +
        '<a class="home-v2-link" href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a>' +
      '</div>';

    app.appendChild(h);
    syncHomeMuteUI();

    // Wire handlers (mostly reuse v2's enter() pattern)
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      ensureAudio();
      openMuteMenu('home');
    };

    const enter = function() {
      ensureAudio();
      hideHomeV3();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      if (onOverScreen) init('practice');
      playMusic('game');
      startEventSystem();
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };

    document.getElementById('home-v3-start').onclick = function() {
      ensureAudio();
      if (!hasSeenTour()) { showTour({ onDone: enter }); }
      else { enter(); }
    };

    document.getElementById('home-v2-contest').onclick = function() {
      ensureAudio();
      if (mode === 'practice') savePracticeGameState();
      showContestMenu();
    };
    document.getElementById('home-v2-challenge').onclick = function() {
      ensureAudio();
      if (typeof showChallengesList === 'function') showChallengesList('home-v3');
    };
    document.getElementById('home-v2-duel').onclick = function() {
      ensureAudio();
      if (typeof showDuelModal === 'function') showDuelModal();
    };
    document.getElementById('home-v2-skins').onclick = function() {
      if (typeof showSkinShop === 'function') showSkinShop();
    };

    // Mascot easter-egg: tap to wink + soundDrop
    const mascot = document.getElementById('home-v3-mascot');
    if (mascot) {
      mascot.style.cursor = 'pointer';
      mascot.style.pointerEvents = 'auto';
      mascot.onclick = function() {
        mascot.classList.add('mascot-wink');
        try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
        setTimeout(function() { mascot.classList.remove('mascot-wink'); }, 600);
      };
    }

    // Tile-legend tap → toast with the rule for that tier. Teaches the
    // mechanic on demand without crowding the static layout with text.
    const legendEls = document.querySelectorAll('.home-v3-legend .legend-tile');
    legendEls.forEach(function(el) {
      el.onclick = function() {
        const tier = parseInt(el.getAttribute('data-tier'), 10);
        if (!tier || !window.__bloomToast) return;
        const tiers = (typeof getActiveTiers === 'function') ? getActiveTiers() : [];
        const ti = tiers[tier] || {};
        const value = tierMergeValueV3(tier);
        let msg;
        if (tier === 1) {
          msg = '🪨 ' + (ti.name || 'אבן') + ' — נופלת ראשונה. מזג 3 כדי לקבל ' + ((tiers[2] && tiers[2].name) || 'עלה') + ' (+' + tierMergeValueV3(2) + ' נק׳)';
        } else if (tier === 8) {
          msg = '👑 ' + (ti.name || 'כתר') + ' — הדרגה הגבוהה ביותר! +' + value.toLocaleString() + ' נק׳ למיזוג';
        } else {
          const prev = (tiers[tier - 1] && tiers[tier - 1].name) || 'הדרגה הקודמת';
          const next = (tiers[tier + 1] && tiers[tier + 1].name) || 'הדרגה הבאה';
          msg = (ti.name || 'דרגה ' + tier) + ' — מזג 3 ' + prev + ' כדי לקבל. +' + value.toLocaleString() + ' נק׳ למיזוג שלה. ממוזגת ל-' + next + '.';
        }
        try { window.__bloomToast(msg, 'info'); } catch (e) {}
      };
    });

    // What's-new dismiss
    const wnDismiss = document.getElementById('home-v3-wn-dismiss');
    if (wnDismiss) wnDismiss.onclick = function() {
      try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW_VERSION); } catch (e) {}
      const banner = document.getElementById('home-v3-whats-new');
      if (banner) banner.style.display = 'none';
    };

    // Bottom links
    const tourBtn = document.getElementById('home-v2-tour');
    if (tourBtn) tourBtn.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    const skipBtn = document.getElementById('home-v2-skip');
    if (skipBtn) skipBtn.onclick = enter;
    const inviteBtn = document.getElementById('home-v2-invite');
    if (inviteBtn) inviteBtn.onclick = function(e) {
      e.stopPropagation();
      if (typeof whatsappInviteV2 === 'function') whatsappInviteV2();
    };
    const backBtn = document.getElementById('home-v3-back');
    if (backBtn) backBtn.onclick = function() {
      disableHomeV3();
      hideHomeV3();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('home');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
      showHome(); // falls through to v2 (current default)
    };

    // Reuse v2 painters where possible
    if (typeof renderHeroBannerV2 === 'function')        renderHeroBannerV2();
    if (typeof renderPlayerIdV2 === 'function')          renderPlayerIdV2();
    renderMyStatsV3();
    if (typeof refreshHomeV2LivePulse === 'function')    refreshHomeV2LivePulse();
    if (typeof refreshFeaturedActionV2 === 'function')   refreshFeaturedActionV2();
    if (typeof refreshHomeChallengeCta === 'function')   refreshHomeChallengeCta();
    if (typeof refreshHomeJackpot === 'function')        refreshHomeJackpot();
    if (typeof refreshHomeWeekly === 'function')         refreshHomeWeekly();
    if (typeof startHomeV2LivePulse === 'function')      startHomeV2LivePulse();

    // F5: lazy-load badges — defer fetch by 300ms so they don't block
    // the first paint. requestIdleCallback when available.
    function deferBadges() {
      if (typeof refreshHomeV2Badges === 'function') refreshHomeV2Badges();
    }
    if (window.requestIdleCallback) {
      requestIdleCallback(deferBadges, { timeout: 800 });
    } else {
      setTimeout(deferBadges, 300);
    }

    playMusic('lobby');

    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
  }

  function hideHomeV3() {
    if (typeof stopHomeV2LivePulse === 'function') stopHomeV2LivePulse();
    const h = document.getElementById('home-screen');
    if (h) h.remove();
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('data-home');
  }

  function buildWhatsNewBanner() {
    try {
      const seen = localStorage.getItem(WHATS_NEW_KEY);
      if (seen === WHATS_NEW_VERSION) return '';
    } catch (e) {}
    return '<div class="home-v3-whats-new" id="home-v3-whats-new">' +
      '<span class="home-v3-wn-sparkle">✨</span>' +
      '<span class="home-v3-wn-text">' + WHATS_NEW_BODY + '</span>' +
      '<button class="home-v3-wn-dismiss" id="home-v3-wn-dismiss" aria-label="סגור">✕</button>' +
    '</div>';
  }

  function buildPregameTeaserHtml(goal) {
    return '<div class="home-v3-teaser" id="home-v3-teaser" role="note">' +
      '<span class="teaser-icon">🎯</span>' +
      '<span class="teaser-text">' +
        'הגע ל-<strong>' + escapeV3(goal.name) + ' ' + escapeV3(goal.emoji) + '</strong> במשחק הבא — ' +
        'בונוס של <strong>+' + goal.reward.toLocaleString() + ' נקודות</strong>' +
      '</span>' +
    '</div>';
  }

  function renderMyStatsV3() {
    const el = document.getElementById('home-v2-mystats');
    if (!el) return;
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    if (total === 0) { el.style.display = 'none'; return; }

    const wkDelta = getWeekDelta();
    const totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    const totalH = Math.floor(totalMs / 3600000);
    const totalM = Math.floor((totalMs % 3600000) / 60000);
    const timeText = totalH > 0 ? totalH + 'ש ' + totalM + 'ד' : totalM + ' דקות';

    let weekBit = '';
    if (wkDelta && wkDelta.thisWeek > 0) {
      let arrow = '';
      if (wkDelta.delta != null) {
        if (wkDelta.delta > 0)      arrow = ' <span class="mystats3-up">↑' + wkDelta.delta + '</span>';
        else if (wkDelta.delta < 0) arrow = ' <span class="mystats3-down">↓' + Math.abs(wkDelta.delta) + '</span>';
        else                        arrow = ' <span class="mystats3-flat">=</span>';
      }
      weekBit = '<span class="mystats2-item">📅 השבוע <strong>' + wkDelta.thisWeek + '</strong>' + arrow + '</span>';
    }

    el.innerHTML =
      '<span class="mystats2-item">🎮 <strong>' + total.toLocaleString() + '</strong></span>' +
      (weekBit ? '<span class="mystats2-sep">·</span>' + weekBit : '') +
      (bestEver > 0 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">🏆 <strong>' + bestEver.toLocaleString() + '</strong></span>' : '') +
      (totalMs > 60000 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">⏱ ' + timeText + '</span>' : '');
    el.style.display = '';
  }

  // ===== Star mascot SVG (Claude Design — gold star with smiley face) =====
  // Replaces the previous flower mascot. The flower read as gendered to
  // some players; a smiling gold star is the cross-cultural "premium
  // aspiration" symbol that big merge/casual games (Royal Match, Toy
  // Blast, Best Fiends) lean on. It also ties directly into BLOOM's
  // mechanic — the player's actual goal is to merge their way up to
  // the Star tier (tier 6) and beyond.
  function buildFlowerMascotSvg() {
    return '<svg viewBox="0 0 110 100" xmlns="http://www.w3.org/2000/svg" class="mascot-svg" aria-hidden="true">' +
      '<defs>' +
        '<radialGradient id="starGlow" cx="50%" cy="50%" r="55%">' +
          '<stop offset="0%" stop-color="#FFE194" stop-opacity="0.55"/>' +
          '<stop offset="100%" stop-color="#FAC775" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="starBody" x1="0%" y1="0%" x2="0%" y2="100%">' +
          '<stop offset="0%" stop-color="#FFE194"/>' +
          '<stop offset="50%" stop-color="#FAC775"/>' +
          '<stop offset="100%" stop-color="#E59B2C"/>' +
        '</linearGradient>' +
      '</defs>' +
      // Outer glow halo (slow pulse via CSS)
      '<circle class="mascot-glow" cx="55" cy="50" r="48" fill="url(#starGlow)"/>' +
      // 5-pointed star
      '<polygon class="mascot-star-body" points="55,15 65,40 92,42 70,60 78,88 55,72 32,88 40,60 18,42 45,40" ' +
        'fill="url(#starBody)" stroke="#9C5E0F" stroke-width="2.5" stroke-linejoin="round"/>' +
      // Inner highlight (top-left, sells the 3D feel)
      '<polygon points="55,22 60,40 76,42 65,52" fill="#FFF1C2" opacity="0.65"/>' +
      // Rosy cheeks
      '<circle cx="44" cy="58" r="3.2" fill="#FF8FA8" opacity="0.65"/>' +
      '<circle cx="66" cy="58" r="3.2" fill="#FF8FA8" opacity="0.65"/>' +
      // Eyes — each in its own group so they can blink in unison
      '<g class="mascot-eye mascot-eye-left">' +
        '<ellipse cx="47" cy="52" rx="2.6" ry="3.2" fill="#1C1A18"/>' +
        '<circle cx="47.9" cy="50.8" r="0.95" fill="#FFF"/>' +
      '</g>' +
      '<g class="mascot-eye mascot-eye-right">' +
        '<ellipse cx="63" cy="52" rx="2.6" ry="3.2" fill="#1C1A18"/>' +
        '<circle cx="63.9" cy="50.8" r="0.95" fill="#FFF"/>' +
      '</g>' +
      // Mouth — friendly slight smile
      '<path d="M49 62 Q55 68 61 62" stroke="#1C1A18" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      // Surrounding sparkles (animated independently)
      '<g class="mascot-sparkles">' +
        '<text x="10" y="22" font-size="11" class="mascot-spark mascot-spark-1">✨</text>' +
        '<text x="92" y="28" font-size="10" class="mascot-spark mascot-spark-2">✦</text>' +
        '<text x="14" y="82" font-size="9"  class="mascot-spark mascot-spark-3">✦</text>' +
        '<text x="93" y="80" font-size="11" class="mascot-spark mascot-spark-4">✨</text>' +
      '</g>' +
    '</svg>';
  }

  // ===== Tile legend (the 8 tiers, with Hebrew names + per-merge value) =====
  // Educational element that doubles as gameplay hook: new players learn
  // the ladder ("מאבן עד כתר"), returning players see a visual reminder
  // of what they're working toward. The 8 tiles map 1:1 to the in-game
  // tier bar above the board, so muscle memory transfers cleanly.
  function tierMergeValueV3(t) {
    // Mirrors pointsFor(tier, 1) in the engine: tier × 10 × (1 + (tier-1)*0.3) × 2
    return Math.round(t * 10 * (1 + (t - 1) * 0.3) * 2);
  }
  function buildTileLegend() {
    const tiers = (typeof getActiveTiers === 'function') ? getActiveTiers() : [];
    let html = '<div class="home-v3-legend-wrap" aria-label="סולם הדרגות במשחק">' +
                 '<div class="home-v3-legend-title">' +
                   '<span class="legend-title-text">סולם המיזוג</span>' +
                   '<span class="legend-title-hint">מזג 3 כדי לעלות דרגה</span>' +
                 '</div>' +
                 '<div class="home-v3-legend" role="list">';
    for (let i = 1; i <= 8; i++) {
      const ti = tiers[i] || {};
      const value = tierMergeValueV3(i);
      const bg = ti.bg || '#F2EFE9';
      const fg = ti.fg || '#1C1A18';
      const svg = ti.svg || ('<span style="font-size:18px">' + (ti.emoji || '?') + '</span>');
      const name = ti.name || ('דרגה ' + i);
      html += '<div class="legend-tile" role="listitem" data-tier="' + i + '" style="--tile-bg:' + bg + ';--tile-fg:' + fg + '">' +
                '<div class="legend-tile-icon" style="background:' + bg + ';color:' + fg + '">' + svg + '</div>' +
                '<div class="legend-tile-name">' + escapeV3(name) + '</div>' +
                '<div class="legend-tile-pts">+' + value + '</div>' +
              '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function escapeV3(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // ============================================================
  // Dynamic Boards picker (May 2026)
  //
  // Boards are an OPT-IN game mode. The home screen shows a single
  // "🎯 לוחות דינמיים" button — only when the admin has at least one
  // available board AND it's currently in its schedule window. Tapping
  // the button opens a picker; tapping a board there starts a new
  // 'dynamic' mode session with that board's multipliers applied.
  //
  // Daily / contest / duel / challenge / default-practice never see
  // any of this — same engine, same vanilla pointsFor() chokepoint
  // (column multiplier = null when nothing is selected).
  // ============================================================

  // ============================================================
  // FOMO time helpers (Phase 6 — LiveOps urgency layer).
  //
  // Boards can carry starts_at + ends_at timestamps. We use them
  // to create scarcity: "💕 ולנטיין מסתיים בעוד 4ש 12ד" forces
  // the player to return to the home screen to check what's
  // available before it disappears. Wordle-style daily reset
  // psychology applied to special boards.
  // ============================================================
  function boardEndsInMs(board) {
    if (!board || !board.ends_at) return Infinity;
    var t = Date.parse(board.ends_at);
    if (!Number.isFinite(t)) return Infinity;
    return t - Date.now();
  }
  function boardJustStarted(board) {
    if (!board || !board.starts_at) return false;
    var t = Date.parse(board.starts_at);
    if (!Number.isFinite(t)) return false;
    var age = Date.now() - t;
    return age >= 0 && age < 24 * 3600 * 1000;
  }
  // Urgency tier: 'new' (just started <24h) / 'critical' (<4h ends) /
  // 'soon' (<24h ends) / 'normal' (>24h or no ends_at).
  function boardUrgency(board) {
    var endsIn = boardEndsInMs(board);
    if (endsIn !== Infinity && endsIn <= 0) return 'expired';
    if (endsIn !== Infinity && endsIn < 4 * 3600 * 1000)   return 'critical';
    if (endsIn !== Infinity && endsIn < 24 * 3600 * 1000)  return 'soon';
    if (boardJustStarted(board))                            return 'new';
    return 'normal';
  }
  function fmtCountdown(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    var totalMin = Math.floor(ms / 60000);
    var d = Math.floor(totalMin / (60 * 24));
    var h = Math.floor((totalMin % (60 * 24)) / 60);
    var m = totalMin % 60;
    if (d > 0) return d + 'י ' + h + 'ש';
    if (h > 0) return h + 'ש ' + (m < 10 ? '0' : '') + m + 'ד';
    return m + ' דקות';
  }
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var dd = d.getDate();
    var mm = d.getMonth() + 1;
    return dd + '/' + mm;
  }
  // Pick the board the player should care about MOST right now: a critical
  // one wins over a new one, which wins over a soon one. Returns null if
  // every board is "normal" (no FOMO to surface).
  function pickFocusBoard(boards) {
    if (!Array.isArray(boards) || !boards.length) return null;
    var byUrgency = { critical: [], new: [], soon: [] };
    for (var i = 0; i < boards.length; i++) {
      var u = boardUrgency(boards[i]);
      if (byUrgency[u]) byUrgency[u].push(boards[i]);
    }
    if (byUrgency.critical.length) {
      // Closest-to-ending first
      return byUrgency.critical.sort(function(a, b) { return boardEndsInMs(a) - boardEndsInMs(b); })[0];
    }
    if (byUrgency.new.length) return byUrgency.new[0];
    if (byUrgency.soon.length) {
      return byUrgency.soon.sort(function(a, b) { return boardEndsInMs(a) - boardEndsInMs(b); })[0];
    }
    return null;
  }
  function urgencyEmoji(u) {
    return u === 'critical' ? '🔥' : u === 'new' ? '🆕' : u === 'soon' ? '⏰' : '';
  }

  // 60s tick that updates every visible countdown — home button + picker
  // cards. Started by updateDynamicBoardsButton, torn down when boards
  // disappear from the home (e.g., player navigated away).
  var _fomoTickHandle = null;
  function startFomoTick() {
    if (_fomoTickHandle) return;
    _fomoTickHandle = setInterval(function() {
      updateDynamicBoardsButton();
      // Re-render picker cards if open — countdowns roll.
      var pickerOpen = document.getElementById('dynamic-boards-picker');
      if (pickerOpen && typeof refreshPickerTimers === 'function') refreshPickerTimers();
    }, 60 * 1000);
  }
  function stopFomoTick() {
    if (_fomoTickHandle) { clearInterval(_fomoTickHandle); _fomoTickHandle = null; }
  }

  // Called by the audio module after /api/boards/available resolves.
  // Toggles the home button's visibility. Safe to call when home isn't
  // mounted yet — it just no-ops.
  function updateDynamicBoardsButton() {
    var btn = document.getElementById('home-v2-boards');
    if (!btn) return;
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    if (!boards.length) {
      btn.style.display = 'none';
      stopFomoTick();
      return;
    }
    btn.style.display = '';
    var countEl = btn.querySelector('.home-v2-boards-count');
    var focus = pickFocusBoard(boards);
    if (countEl) {
      // Default label
      var defaultLabel = boards.length + ' ' + (boards.length === 1 ? 'לוח זמין' : 'לוחות זמינים');
      if (focus) {
        var u = boardUrgency(focus);
        var endsIn = boardEndsInMs(focus);
        var label = '';
        if (u === 'critical') {
          label = '🔥 ' + (focus.name || 'לוח') + ' מסתיים בעוד ' + fmtCountdown(endsIn);
        } else if (u === 'new') {
          label = '🆕 ' + (focus.name || 'לוח') + ' — חדש היום';
        } else if (u === 'soon') {
          label = '⏰ ' + (focus.name || 'לוח') + ' — נשאר ' + fmtCountdown(endsIn);
        } else {
          label = defaultLabel;
        }
        countEl.textContent = label;
      } else {
        countEl.textContent = defaultLabel;
      }
    }
    // Add urgency CSS class to the button so we can pulse it for critical.
    btn.classList.remove('fomo-critical', 'fomo-new', 'fomo-soon');
    if (focus) {
      var fu = boardUrgency(focus);
      if (fu === 'critical' || fu === 'new' || fu === 'soon') btn.classList.add('fomo-' + fu);
    }
    startFomoTick();
  }

  // Expose so the audio-module fetch can poke us.
  window.updateDynamicBoardsButton = updateDynamicBoardsButton;
  window.stopDynamicBoardsTick = stopFomoTick;

  // ============================================================
  // Per-board personal best — the "beat your score" addiction loop.
  //
  // Each board carries its own localStorage record so a player who
  // hit 47K on the Valentine board sees that target every time the
  // board appears in the picker, plus an in-game pill that tracks
  // it live. Score chase is the single strongest engine in puzzle
  // games — Wordle / Suika / Tetris all run on it.
  //
  // Keyed by board id (server-issued), not name, because two boards
  // can share a display name across edits but the id is stable.
  // ============================================================
  function boardBestKey(boardId) { return 'bloom_board_best_' + boardId; }
  function getBoardBest(boardId) {
    if (boardId == null) return null;
    try {
      var raw = localStorage.getItem(boardBestKey(boardId));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.score !== 'number') return null;
      return obj;
    } catch (e) { return null; }
  }
  function setBoardBest(boardId, score, tier) {
    if (boardId == null) return false;
    var prev = getBoardBest(boardId);
    if (prev && prev.score >= score) return false;
    try {
      localStorage.setItem(boardBestKey(boardId), JSON.stringify({
        score: score | 0,
        tier:  tier | 0,
        ts:    Date.now()
      }));
    } catch (e) {}
    return true;
  }
  function formatBoardScore(n) {
    if (!Number.isFinite(n)) return String(n);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'מ';
    if (n >= 10000)   return Math.round(n / 1000) + 'K';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  window.getBoardBest        = getBoardBest;
  window.setBoardBest        = setBoardBest;
  window.formatBoardScore    = formatBoardScore;

  // Human-readable labels for themes / shapes so the player can tell the
  // boards apart before clicking — boring rectangular cards = no clicks.
  var THEME_LABELS = {
    hanukkah:      { icon: '🕎', label: 'חנוכה' },
    valentine:     { icon: '💕', label: 'ולנטיין' },
    yom_haatzmaut: { icon: '🇮🇱', label: 'יום העצמאות' },
    passover:      { icon: '🍷', label: 'פסח' }
  };
  var SHAPE_LABELS = {
    heart:   { icon: '❤️', label: 'לב' },
    diamond: { icon: '💎', label: 'יהלום' },
    tree:    { icon: '🌲', label: 'עץ' },
    pyramid: { icon: '🔺', label: 'פירמידה' }
  };
  // Per-cell-type label for the "special cells preview" line.
  var CELL_TYPE_ICON = {
    gold: '✨', bonus: '🪙', frozen: '❄️',
    electric: '⚡', locked: '🔒', teleport: '🌀'
  };
  function describeBoard(board) {
    if (!board || !board.definition) return '';
    var def = board.definition;
    if (board.type === 'multipliers' && Array.isArray(def.multipliers)) {
      return def.multipliers.map(function(m) {
        var v = Number(m);
        return '×' + (Number.isInteger(v) ? v : v.toFixed(1));
      }).join(' · ');
    }
    if (board.type === 'special_cells' || board.type === 'themed') {
      var parts = [];
      if (def.theme_id && THEME_LABELS[def.theme_id]) {
        parts.push(THEME_LABELS[def.theme_id].icon + ' ' + THEME_LABELS[def.theme_id].label);
      }
      if (def.shape_id && SHAPE_LABELS[def.shape_id]) {
        parts.push(SHAPE_LABELS[def.shape_id].icon + ' ' + SHAPE_LABELS[def.shape_id].label);
      }
      var cells = Array.isArray(def.cells) ? def.cells : [];
      if (cells.length) {
        var byType = {};
        cells.forEach(function(c) {
          if (!c || !c.type) return;
          byType[c.type] = (byType[c.type] || 0) + 1;
        });
        var cellSummary = Object.keys(byType).map(function(t) {
          return (CELL_TYPE_ICON[t] || '') + '×' + byType[t];
        }).join(' ');
        if (cellSummary) parts.push(cellSummary);
      }
      return parts.join(' · ');
    }
    return '';
  }

  function boardTypeBadge(type) {
    var map = {
      multipliers:   { icon: '🎯', label: 'מכפילי עמודות' },
      special_cells: { icon: '🔮', label: 'תאים מיוחדים' },
      shape:         { icon: '🟦', label: 'צורת לוח' },
      themed:        { icon: '🎄', label: 'חג' },
      mode:          { icon: '⏱', label: 'וריאציית חוקים' },
      vip:           { icon: '👑', label: 'בלעדי' }
    };
    return map[type] || { icon: '🎯', label: 'מותאם' };
  }

  function showDynamicBoardsPicker() {
    closeDynamicBoardsPicker();
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    var overlay = document.createElement('div');
    overlay.id = 'dynamic-boards-picker';
    overlay.className = 'dyn-boards-overlay';
    overlay.innerHTML =
      '<div class="dyn-boards-modal">' +
        '<div class="dyn-boards-head">' +
          '<button class="dyn-boards-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-boards-title">🎯 לוחות דינמיים</div>' +
          '<div class="dyn-boards-sub">בחר לוח לסשן חד-פעמי. הניקוד לא נשמר בלוחות המובילים — חוויית משחק טהורה.</div>' +
        '</div>' +
        '<div class="dyn-boards-list" id="dyn-boards-list"></div>' +
        '<div class="dyn-boards-foot">' +
          '<button class="dyn-boards-cancel">חזרה לבית</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var listEl = document.getElementById('dyn-boards-list');
    if (!boards.length) {
      listEl.innerHTML =
        '<div class="dyn-boards-empty">' +
          '<div class="dyn-boards-empty-icon">🌱</div>' +
          '<div class="dyn-boards-empty-title">אין לוחות זמינים כרגע</div>' +
          '<div class="dyn-boards-empty-sub">המנהל לא הפעיל לוחות, או שכולם בתאריך עתידי. נסה שוב מאוחר יותר.</div>' +
        '</div>';
    } else {
      // Card backgrounds per theme — match css/boards.css body.theme-X-active
      // hue so the picker already feels like the board you're about to enter.
      var THEME_TINTS = {
        hanukkah:      'linear-gradient(135deg, rgba(14,42,91,0.18), rgba(30,79,170,0.12))',
        valentine:     'linear-gradient(135deg, rgba(255,122,168,0.18), rgba(255,209,220,0.18))',
        yom_haatzmaut: 'linear-gradient(135deg, rgba(11,124,196,0.20), rgba(232,243,255,0.14))',
        passover:      'linear-gradient(135deg, rgba(122,26,26,0.22), rgba(192,57,43,0.12))'
      };
      var html = '';
      for (var i = 0; i < boards.length; i++) {
        var b = boards[i];
        var badge = boardTypeBadge(b.type);
        var desc = describeBoard(b);
        var def = b.definition || {};
        var tint = (def.theme_id && THEME_TINTS[def.theme_id]) ? THEME_TINTS[def.theme_id] : '';
        var extraStyle = tint ? (' style="background:' + tint + '"') : '';
        // Pretty chip row — themed boards add an extra row of visual identity
        // pills so the player can see what they're picking before tapping.
        var chips = [];
        if (def.theme_id && THEME_LABELS[def.theme_id]) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-theme">' + THEME_LABELS[def.theme_id].icon + ' ' + THEME_LABELS[def.theme_id].label + '</span>');
        }
        if (def.shape_id && SHAPE_LABELS[def.shape_id]) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-shape">' + SHAPE_LABELS[def.shape_id].icon + ' ' + SHAPE_LABELS[def.shape_id].label + '</span>');
        }
        var cells = Array.isArray(def.cells) ? def.cells : [];
        if (cells.length) {
          var byT = {};
          cells.forEach(function(c) { if (c && c.type) byT[c.type] = (byT[c.type] || 0) + 1; });
          Object.keys(byT).forEach(function(t) {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-cell">' + (CELL_TYPE_ICON[t] || '') + ' ×' + byT[t] + '</span>');
          });
        }
        // Personal-best chip — the most addictive item on the card.
        // Empty record: gentle "🌱" pioneer chip (also drives "be the
        // first" psychology). Has a record: gold "🏆" chip with score.
        var best = getBoardBest(b.id);
        if (best && best.score > 0) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-best">🏆 שיא ' + formatBoardScore(best.score) + '</span>');
        } else {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-pioneer">🌱 חדש לך</span>');
        }
        // Global per-board leader — the social half of the addiction loop.
        // When you're #1: special crown chip. Otherwise: shows the leader's
        // score as a clear target.
        if (b.leader_name && b.leader_score) {
          var imLeader = best && best.score >= b.leader_score;
          if (imLeader) {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-king">👑 אתה מוביל!</span>');
          } else {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-leader">👑 ' + escapeHtml(b.leader_name) + ': ' + formatBoardScore(b.leader_score) + '</span>');
          }
        }
        if (b.players && b.players > 0) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-players">👥 ' + b.players + ' שיחקו</span>');
        }
        var chipsHtml = chips.length ? ('<div class="dyn-boards-card-chips">' + chips.join('') + '</div>') : '';
        // Per-card urgency badge (Phase 6 LiveOps). data-board-id +
        // data-ends-at on the card so refreshPickerTimers() can re-paint
        // without a full re-render every minute.
        var u = boardUrgency(b);
        var endsAttr = b.ends_at ? (' data-ends-at="' + escapeHtml(b.ends_at) + '"') : '';
        var startsAttr = b.starts_at ? (' data-starts-at="' + escapeHtml(b.starts_at) + '"') : '';
        var classExtra = (u === 'critical' || u === 'new' || u === 'soon') ? (' fomo-' + u) : '';
        html +=
          '<button class="dyn-boards-card' + classExtra + '" data-board-id="' + b.id + '"' + endsAttr + startsAttr + extraStyle + '>' +
            '<div class="dyn-boards-card-icon">' + badge.icon + '</div>' +
            '<div class="dyn-boards-card-body">' +
              '<div class="dyn-boards-card-name">' + escapeHtml(b.name || 'לוח') + '</div>' +
              '<div class="dyn-boards-card-type">' + badge.label + (desc && b.type === 'multipliers' ? ' · ' + desc : '') + '</div>' +
              chipsHtml +
              '<div class="dyn-boards-card-fomo" data-fomo-host="1">' + renderFomoBadge(b) + '</div>' +
            '</div>' +
            '<div class="dyn-boards-card-cta">שחק ←</div>' +
          '</button>';
      }
      listEl.innerHTML = html;
      listEl.addEventListener('click', function(e) {
        var card = e.target.closest('.dyn-boards-card');
        if (!card) return;
        var id = parseInt(card.getAttribute('data-board-id'), 10);
        var board = boards.find(function(x) { return x.id === id; });
        if (board) startDynamicBoard(board);
      });
    }

    overlay.querySelector('.dyn-boards-close').onclick = closeDynamicBoardsPicker;
    overlay.querySelector('.dyn-boards-cancel').onclick = closeDynamicBoardsPicker;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDynamicBoardsPicker();
    });
  }

  // Renders the per-card FOMO badge — pure function of the board's
  // urgency tier. Empty string when nothing's urgent (keeps the card
  // clean for the boring case).
  function renderFomoBadge(board) {
    var u = boardUrgency(board);
    var endsIn = boardEndsInMs(board);
    if (u === 'critical') {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-critical">🔥 מסתיים בעוד ' + fmtCountdown(endsIn) + '</span>';
    }
    if (u === 'new') {
      var endStr = board.ends_at ? (' · עד ' + shortDate(board.ends_at)) : '';
      return '<span class="dyn-fomo-pill dyn-fomo-pill-new">🆕 חדש היום' + endStr + '</span>';
    }
    if (u === 'soon') {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-soon">⏰ נשאר ' + fmtCountdown(endsIn) + '</span>';
    }
    if (board.ends_at) {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-cal">📅 עד ' + shortDate(board.ends_at) + '</span>';
    }
    return '';
  }

  // 60s tick callback when picker is open. Re-renders ONLY the badge
  // hosts — keeps focus / scroll position intact.
  function refreshPickerTimers() {
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    var byId = {};
    boards.forEach(function(b) { byId[b.id] = b; });
    document.querySelectorAll('#dyn-boards-list .dyn-boards-card').forEach(function(card) {
      var id = parseInt(card.getAttribute('data-board-id'), 10);
      var b = byId[id];
      if (!b) return;
      var host = card.querySelector('[data-fomo-host]');
      if (host) host.innerHTML = renderFomoBadge(b);
      // Re-apply urgency class — it may have changed tier (e.g. soon→critical).
      card.classList.remove('fomo-critical', 'fomo-new', 'fomo-soon');
      var u = boardUrgency(b);
      if (u === 'critical' || u === 'new' || u === 'soon') card.classList.add('fomo-' + u);
    });
  }
  window.refreshPickerTimers = refreshPickerTimers;

  function closeDynamicBoardsPicker() {
    var el = document.getElementById('dynamic-boards-picker');
    if (el) el.remove();
  }

  function startDynamicBoard(board) {
    if (!board || !board.definition) return;
    closeDynamicBoardsPicker();
    if (board.type === 'multipliers' && Array.isArray(board.definition.multipliers)) {
      setColumnMultipliers(board.definition.multipliers);
    } else {
      setColumnMultipliers(null);
    }
    window._activeDynamicBoard = board;
    if (typeof hideHomeV2 === 'function') hideHomeV2();
    if (typeof hideHome === 'function') hideHome();
    ensureAudio();
    init('dynamic', { fresh: true });
    playMusic('game');
    if (typeof startEventSystem === 'function') startEventSystem();
  }

  // When the player leaves dynamic mode (back to home, switching to
  // contest, etc.), clear the multiplier so the next non-dynamic game
  // is vanilla.
  function clearDynamicBoardSession() {
    setColumnMultipliers(null);
    window._activeDynamicBoard = null;
  }

  window.showDynamicBoardsPicker  = showDynamicBoardsPicker;
  window.closeDynamicBoardsPicker = closeDynamicBoardsPicker;
  window.clearDynamicBoardSession = clearDynamicBoardSession;

  // ============================================================
  // showSpecialBoardToast — fired by init() when a board (daily /
  // practice / duel / dynamic) is active for this session. The "wow"
  // moment that turns a routine daily into "today is different!".
  // De-duped per board id so a quick replay doesn't spam.
  // ============================================================
  var _lastToastedBoardId = null;
  function showSpecialBoardToast(board) {
    if (!board) return;
    var boardKey = (board.id != null) ? board.id : (board.name || JSON.stringify(board.definition || {}));
    if (_lastToastedBoardId === boardKey) return;
    _lastToastedBoardId = boardKey;
    var mults = (board.definition && Array.isArray(board.definition.multipliers))
      ? board.definition.multipliers.map(function(m) {
          return '×' + (Number.isInteger(m) ? m : Number(m).toFixed(1));
        }).join(' · ')
      : '';
    // Clean up any prior banner with the same tag.
    document.querySelectorAll('.special-board-toast').forEach(function(el) { el.remove(); });
    var toast = document.createElement('div');
    toast.className = 'special-board-toast';
    toast.innerHTML =
      '<div class="sb-toast-icon">🎯</div>' +
      '<div class="sb-toast-body">' +
        '<div class="sb-toast-title">לוח מיוחד פעיל</div>' +
        '<div class="sb-toast-name">' + escapeHtml(board.name || 'לוח') + '</div>' +
        (mults ? '<div class="sb-toast-mults">' + mults + '</div>' : '') +
      '</div>';
    document.body.appendChild(toast);
    // Auto-remove after the slide-in + 3s display + fade.
    setTimeout(function() {
      toast.classList.add('sb-toast-out');
      setTimeout(function() { toast.remove(); }, 350);
    }, 3200);
    // Tap to dismiss early.
    toast.addEventListener('click', function() {
      toast.classList.add('sb-toast-out');
      setTimeout(function() { toast.remove(); }, 350);
    });
  }
  window.showSpecialBoardToast = showSpecialBoardToast;

  // Reset the toast dedup when leaving home/changing modes so the next
  // game can re-trigger. clearDynamicBoardSession already runs on home.
  var _origClear = clearDynamicBoardSession;
  clearDynamicBoardSession = function() {
    _lastToastedBoardId = null;
    return _origClear.apply(this, arguments);
  };
  window.clearDynamicBoardSession = clearDynamicBoardSession;
  function hideContestScreens() {
    stopContestRefresh();
    stopMyContestsRefresh();
    // Live in-game HUD: tear down whenever the player navigates away from
    // the contest game to any non-game screen (leaderboard, home, etc).
    // init('contest') re-mounts it cleanly when they return.
    if (typeof stopContestHud === 'function') stopContestHud();
    const el = document.getElementById('contest-screen');
    if (el) el.remove();
  }

  function createBackButton(action) {
    return '<button class="contest-back-btn" data-back="' + action + '" aria-label="חזור">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>';
  }

  // Event delegation for back buttons — replaces inline onclick="window.__bloom*()"
  document.querySelector('.app').addEventListener('click', function(e) {
    const btn = e.target.closest('[data-back]');
    if (!btn) return;
    const action = btn.getAttribute('data-back');
    const handlers = {
      'home': function() { hideContestScreens(); showHome(); },
      'contest-menu': function() { hideContestScreens(); showContestMenu(); },
      'challenges': navigateBackFromChallenges,
      'challenges-list': function() { showChallengesList(); },
      'home-from-challenges': function() { hideChallengeScreens(); showHome(); }
    };
    if (handlers[action]) handlers[action]();
  });

  function showContestMenu() {
    const app = document.querySelector('.app');
    hideContestScreens();
    hideHome();
    const screen = document.createElement('div');
    screen.id = 'contest-screen';
    screen.className = 'contest-screen';
    const continueCard = activeContestCode
      ? '<div class="contest-card contest-card-continue" id="contest-mine-card">' +
          '<div class="contest-card-icon" style="background:#C7EDDE;color:#04342C">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v6M16 4v6"/></svg>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="contest-card-title">התחרויות שלי</div>' +
            '<div class="contest-card-desc" id="contest-mine-desc">טוען רשימה…</div>' +
            '<div class="contest-card-sub-meta" id="contest-mine-meta"></div>' +
          '</div>' +
        '</div>'
      : '';
    screen.innerHTML =
      createBackButton('home') +
      '<div class="contest-title">תחרות חברים</div>' +
      '<div class="contest-sub">בחר את התפקיד שלך</div>' +
      '<div class="contest-cards">' +
        continueCard +
        '<div class="contest-card" id="contest-create-card">' +
          '<div class="contest-card-icon" style="background:#FAEEDA;color:#854F0B">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '</div>' +
          '<div>' +
            '<div class="contest-card-title">צור תחרות חדשה</div>' +
            '<div class="contest-card-desc">הזמן חברים בוואטסאפ</div>' +
          '</div>' +
        '</div>' +
        '<div class="contest-card" id="contest-join-card">' +
          '<div class="contest-card-icon" style="background:#E1F5EE;color:#04342C">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="9" r="3"/><path d="M17 14c2 0 4 1 4 4v3"/></svg>' +
          '</div>' +
          '<div>' +
            '<div class="contest-card-title">הצטרף לתחרות</div>' +
            '<div class="contest-card-desc">קיבלת קוד? הכנס כאן</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    app.appendChild(screen);
    document.getElementById('contest-create-card').onclick = showCreateContestForm;
    document.getElementById('contest-join-card').onclick = showJoinContestForm;
    const mineEl = document.getElementById('contest-mine-card');
    if (mineEl) {
      mineEl.onclick = showMyContestsList;
      // Async-fill the card with the count + most recent contest name
      fetchMyContests().then(function(contests) {
        const stillThere = document.getElementById('contest-mine-card');
        if (!stillThere) return;
        const descEl = document.getElementById('contest-mine-desc');
        const metaEl = document.getElementById('contest-mine-meta');
        if (!contests || contests.length === 0) {
          if (descEl) descEl.textContent = 'לחץ כדי לראות את הרשימה';
          if (metaEl) metaEl.textContent = '';
          return;
        }
        const n = contests.length;
        if (descEl) descEl.textContent = n === 1 ? contests[0].name : n + ' תחרויות פעילות';
        if (metaEl && n > 1) metaEl.textContent = 'האחרונה: ' + contests[0].name;
        else if (metaEl) metaEl.textContent = '';
      });
    }
  }

  function renderMyContestsRowsHtml(contests) {
    return contests.map(function(c) {
      const ended = new Date(c.ends_at) < new Date();
      const isActive = activeContestCode === c.code;
      const rankClass = c.my.rank === 1 ? ' rank-1' : '';
      const statusHtml = ended
        ? '<span class="my-contest-status">הסתיים</span>'
        : (isActive ? '<span class="my-contest-status active-tag">פעילה עכשיו</span>'
                    : '<span class="my-contest-status">' + formatTimeLeft(c.ends_at) + '</span>');
      return '<div class="my-contest-row' + (isActive ? ' active' : '') + (ended ? ' ended' : '') +
        '" data-code="' + c.code + '">' +
        '<div class="my-contest-row-top">' +
          '<div class="my-contest-name">' + escapeHtml(c.name) + '</div>' +
          statusHtml +
        '</div>' +
        '<div class="my-contest-meta">' +
          '<span>מארח: ' + escapeHtml(c.host_name || 'אנונימי') + '</span>' +
          '<span class="my-contest-meta-mid">' + (c.member_count | 0) + ' שחקנים</span>' +
          '<span class="my-contest-rank' + rankClass + '">#' + (c.my.rank | 0) + ' · ' + (c.my.score | 0).toLocaleString() + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function bindMyContestsRowClicks(body) {
    if (!body) return;
    body.querySelectorAll('.my-contest-row').forEach(function(row) {
      row.onclick = function() {
        const code = row.getAttribute('data-code');
        if (!code) return;
        setActiveContest(code);
        showContestLeaderboard(code);
      };
    });
  }

  function renderMyContestsBody(contests) {
    const body = document.getElementById('mclb-body');
    const subEl = document.getElementById('mclb-sub');
    if (!body) return;
    if (!contests) {
      body.innerHTML = '<div class="contest-board-empty">שגיאת חיבור</div>';
      if (subEl) subEl.textContent = '';
      return;
    }
    if (contests.length === 0) {
      if (subEl) subEl.textContent = 'עדיין לא הצטרפת לאף תחרות';
      body.innerHTML = '<div class="contest-board-empty">צור תחרות חדשה או הצטרף עם קוד</div>';
      return;
    }
    if (subEl) {
      subEl.innerHTML = '<span class="contest-live-dot"></span>' +
        contests.length + ' תחרויות פעילות';
    }
    body.innerHTML = '<div class="my-contest-list">' + renderMyContestsRowsHtml(contests) + '</div>';
    bindMyContestsRowClicks(body);
  }

  let myContestsRefreshTimer = null;
  function stopMyContestsRefresh() {
    if (myContestsRefreshTimer) { clearInterval(myContestsRefreshTimer); myContestsRefreshTimer = null; }
  }
  function startMyContestsRefresh() {
    stopMyContestsRefresh();
    myContestsRefreshTimer = setInterval(async function() {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!document.getElementById('mclb-body')) { stopMyContestsRefresh(); return; }
      const contests = await fetchMyContests({ fresh: true });
      if (!document.getElementById('mclb-body')) return;
      renderMyContestsBody(contests);
    }, 30000);
  }

  async function showMyContestsList() {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">התחרויות שלי</div>' +
      '<div class="contest-sub" id="mclb-sub">טוען…</div>' +
      '<div id="mclb-body"><div class="contest-loading">טוען…</div></div>';

    const contests = await fetchMyContests();
    renderMyContestsBody(contests);
    if (contests && contests.length > 0) startMyContestsRefresh();
  }

  function showCreateContestForm() {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">תחרות חדשה</div>' +
      '<div class="contest-sub">פרטים בסיסיים בלבד</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">שם התחרות</div>' +
        '<input class="contest-input" id="ctf-name" placeholder="משפחת כהן · פסח" maxlength="100" />' +
        '<div class="contest-form-label">השם שלך בלוח</div>' +
        '<input class="contest-input" id="ctf-host" autocapitalize="words" placeholder="סבא משה" maxlength="50" value="' + escapeHtml(getPlayerName()) + '" />' +
        '<div class="contest-form-label">משך התחרות</div>' +
        '<div class="contest-duration-row" id="ctf-duration">' +
          '<div class="contest-duration-pill" data-days="1">יום</div>' +
          '<div class="contest-duration-pill selected" data-days="7">שבוע</div>' +
          '<div class="contest-duration-pill" data-days="30">חודש</div>' +
        '</div>' +
        '<div class="contest-form-label">סוג הלוח</div>' +
        '<div class="contest-duration-row" id="ctf-board-type">' +
          '<div class="contest-duration-pill selected" data-board="shared">משותף</div>' +
          '<div class="contest-duration-pill" data-board="free">חופשי</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-board-hint">כולם מקבלים את אותו לוח — השוואה הוגנת</div>' +
        '<div class="contest-form-label">💪 רמת קושי <span style="color:#A8A6A0;font-weight:400">(לכל המשתתפים)</span></div>' +
        '<div class="contest-duration-row" id="ctf-difficulty" style="flex-wrap:wrap">' +
          '<div class="contest-duration-pill selected" data-diff="default">📦 רגיל</div>' +
          '<div class="contest-duration-pill" data-diff="easy">😊 קל</div>' +
          '<div class="contest-duration-pill" data-diff="medium">🎯 בינוני</div>' +
          '<div class="contest-duration-pill" data-diff="hard">🔥 קשה</div>' +
          '<div class="contest-duration-pill" data-diff="insane">💀 גהינום</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-difficulty-hint">המארגן בוחר רמה אחת לכולם — כך התחרות הוגנת</div>' +
        '<div class="contest-form-label">🏆 איך סופרים נקודות?</div>' +
        '<div class="contest-duration-row" id="ctf-score-mode">' +
          '<div class="contest-duration-pill selected" data-mode="cumulative">🧮 מצטבר</div>' +
          '<div class="contest-duration-pill" data-mode="best">🏆 הכי גבוה</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-mode-hint">כל המשחקים מצטרפים לסכום אחד — שחק הרבה כדי לטפס</div>' +
        '<div class="contest-form-label">🎰 הימור (אופציונלי)</div>' +
        '<div style="display:flex;align-items:center;gap:8px;direction:rtl;margin-bottom:4px">' +
          '<input type="number" class="contest-input" id="ctf-wager" placeholder="0" min="0" max="500" value="0" style="width:80px;text-align:center;font-weight:700" />' +
          '<span style="font-size:12px;color:#6F6E68">💎 כל משתתף · קופה מחולקת לזוכים</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0;direction:rtl;margin-bottom:8px">היתרה שלך: <strong style="color:#BA7517">' + playerBalance + ' 💎</strong> · מינימום הימור: 10 · 0 = ללא הימור</div>' +
        '<button class="contest-submit-btn" id="ctf-submit">צור והעתק קוד</button>' +
        '<div class="contest-error" id="ctf-error"></div>' +
      '</div>';

    let selectedDays = 7;
    let selectedBoardType = 'shared';
    let selectedDifficulty = 'default';
    let selectedScoreMode = 'cumulative';
    const MODE_HINTS = {
      cumulative: 'כל המשחקים מצטרפים לסכום אחד — שחק הרבה כדי לטפס',
      best:       'רק המשחק הכי טוב נספר — איכות מנצחת כמות'
    };
    const DIFF_HINTS = {
      default: 'המארגן בוחר רמה אחת לכולם — כך התחרות הוגנת',
      easy:    '😊 קל · אריחים נמוכים שולטים — נעים לחימום',
      medium:  '🎯 בינוני · יותר אריחים גבוהים, פחות מקום לטעויות',
      hard:    '🔥 קשה · בעיקר tier 3-5 נופלים — ניקוד גבוה אבל game-over מהיר',
      insane:  '💀 גהינום · אבן/עלה לא נופלים בכלל — לרוצחים סדרתיים בלבד'
    };
    document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedDays = parseInt(pill.dataset.days, 10);
      };
    });
    document.querySelectorAll('#ctf-board-type .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-board-type .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedBoardType = pill.dataset.board;
        const hint = document.getElementById('ctf-board-hint');
        if (hint) hint.textContent = selectedBoardType === 'free'
          ? 'לוח אקראי לכל שחקן — תחרות ניקוד טהורה'
          : 'כולם מקבלים את אותו לוח — השוואה הוגנת';
      };
    });
    document.querySelectorAll('#ctf-difficulty .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-difficulty .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedDifficulty = pill.dataset.diff;
        const hint = document.getElementById('ctf-difficulty-hint');
        if (hint) hint.textContent = DIFF_HINTS[selectedDifficulty] || DIFF_HINTS.default;
      };
    });
    document.querySelectorAll('#ctf-score-mode .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-score-mode .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedScoreMode = pill.dataset.mode;
        const hint = document.getElementById('ctf-mode-hint');
        if (hint) hint.textContent = MODE_HINTS[selectedScoreMode] || MODE_HINTS.cumulative;
      };
    });

    document.getElementById('ctf-submit').onclick = async function() {
      const nameVal = document.getElementById('ctf-name').value.trim();
      const hostVal = document.getElementById('ctf-host').value.trim();
      const errEl = document.getElementById('ctf-error');
      errEl.textContent = '';
      if (!nameVal) { errEl.textContent = 'נא לתת שם לתחרות'; return; }
      if (!hostVal) { errEl.textContent = 'נא להזין שם תצוגה'; return; }

      const wagerVal = parseInt(document.getElementById('ctf-wager').value, 10) || 0;

      // Client-side balance check BEFORE sending
      if (wagerVal > 0 && playerBalance < wagerVal) {
        errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + '). צריך ' + wagerVal + ' 💎';
        return;
      }

      this.disabled = true;
      this.textContent = 'יוצר...';

      try {
        const res = await fetch(API_BASE + '/api/contests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nameVal,
            hostName: hostVal,
            deviceId: deviceId,
            token: deviceToken,
            durationDays: selectedDays,
            boardType: selectedBoardType,
            wagerAmount: wagerVal,
            difficulty: selectedDifficulty,
            scoreMode: selectedScoreMode
          })
        });
        if (res.status === 429) {
          errEl.textContent = 'יצרת יותר מדי תחרויות. נסה שוב בעוד שעה.';
          this.disabled = false;
          this.textContent = 'צור והעתק קוד';
          return;
        }
        const data = await res.json();
        if (!res.ok || !data.ok) {
          var errorMsg = 'שגיאה ביצירת התחרות';
          if (data.error === 'insufficient_balance') errorMsg = '💎 אין מספיק קרדיטים להימור. יש לך ' + playerBalance + ' 💎';
          else if (data.error === 'bad_name') errorMsg = 'שם התחרות לא תקין';
          else if (data.error === 'bad_device') errorMsg = 'שגיאת מכשיר — רענן את הדף';
          errEl.textContent = errorMsg;
          this.disabled = false;
          this.textContent = 'צור והעתק קוד';
          return;
        }
        // Success — update balance if wager was paid
        if (wagerVal > 0) {
          playerBalance = Math.max(0, playerBalance - wagerVal);
          try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
          updateBalanceDisplay();
        }
        setPlayerName(hostVal);
        setContestDisplayName(data.contest.code, hostVal);
        setActiveContest(data.contest.code);
        showContestShareScreen(data.contest);
      } catch (e) {
        errEl.textContent = 'שגיאת רשת — בדוק חיבור ונסה שוב';
        this.disabled = false;
        this.textContent = 'צור והעתק קוד';
      }
    };
  }

  function showContestShareScreen(contest) {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    const link = buildContestShareLink(contest.code);
    const shareText = (contest.host_name || 'מישהו') + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' +
      'כל המשפחה משחקת — מי יביא את הציון הכי גבוה?\n' + link;

    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">התחרות מוכנה!</div>' +
      '<div class="contest-sub">שתף את הקוד עם המשפחה</div>' +
      '<div class="contest-link-card">' +
        '<div class="contest-link-label">קוד התחרות</div>' +
        '<div class="contest-link-code">' + contest.code + '</div>' +
      '</div>' +
      '<div class="contest-share-row">' +
        '<button class="contest-share-btn contest-share-wa" id="ctsh-wa">' +
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.05 4.91A9.8 9.8 0 0 0 12.03 2c-5.45 0-9.89 4.43-9.89 9.88 0 1.74.45 3.44 1.31 4.94L2 22l5.31-1.39c1.45.79 3.08 1.21 4.71 1.21h.01c5.45 0 9.89-4.43 9.89-9.88 0-2.64-1.03-5.12-2.9-6.99l.03-.04zM12.04 20.15c-1.46 0-2.89-.39-4.13-1.13l-.3-.18-3.06.8.82-2.99-.2-.31c-.81-1.29-1.24-2.79-1.24-4.33 0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.39 1.54 1.54 2.39 3.59 2.39 5.77 0 4.5-3.66 8.16-8.16 8.16l-.06-.02zm4.48-6.13c-.25-.12-1.45-.71-1.67-.8-.22-.08-.39-.12-.55.12-.17.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.03-.38-1.95-1.21-.72-.65-1.21-1.45-1.36-1.69-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.43-.14 0-.31-.02-.46-.02s-.41.06-.62.31c-.21.25-.81.79-.81 1.93 0 1.13.83 2.23.95 2.39.12.16 1.62 2.49 3.93 3.48.55.24 1 .39 1.34.49.56.18 1.07.15 1.48.09.45-.07 1.45-.59 1.66-1.16.21-.58.21-1.07.14-1.16-.06-.11-.22-.18-.46-.31l-.02-.02z"/></svg>' +
          '<span>וואטסאפ</span>' +
        '</button>' +
        '<button class="contest-share-btn contest-share-copy" id="ctsh-copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span id="ctsh-copy-label">העתק קישור</span>' +
        '</button>' +
      '</div>' +
      '<div class="contest-form" style="margin-top:14px">' +
        '<button class="contest-submit-btn" id="ctsh-leaderboard">לוח התחרות</button>' +
        '<button class="contest-secondary-btn" id="ctsh-play">שחק עכשיו</button>' +
      '</div>';

    document.getElementById('ctsh-wa').onclick = function() {
      // Some mobile browsers block window.open if it isn't a direct user click
      // gesture — fall back to copying the link with a "הועתק" flash.
      const w = window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      if (!w) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareText).catch(function() {});
        }
        const wa = document.getElementById('ctsh-wa');
        const span = wa.querySelector('span');
        if (span) {
          const orig = span.textContent;
          span.textContent = '✓ הטקסט הועתק';
          setTimeout(function() { span.textContent = orig; }, 1700);
        }
      }
    };
    document.getElementById('ctsh-copy').onclick = function() {
      const lbl = document.getElementById('ctsh-copy-label');
      const orig = lbl.textContent;
      const flash = function() {
        lbl.textContent = '✓ הועתק';
        setTimeout(function() { lbl.textContent = orig; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(flash, flash);
      } else {
        flash();
      }
    };
    document.getElementById('ctsh-leaderboard').onclick = function() {
      showContestLeaderboard(contest.code);
    };
    document.getElementById('ctsh-play').onclick = function() {
      // Defensive: re-set the active code in case any earlier screen drifted it
      // (the new contest was set as active at creation time, but this guarantees
      // correctness even if state was perturbed by a fast user).
      setActiveContest(contest.code);
      hideContestScreens();
      init('contest', { fresh: true });
    };
  }

  function showJoinContestForm() {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">הצטרף לתחרות</div>' +
      '<div class="contest-sub">הכנס את הקוד שקיבלת</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">קוד התחרות (6 תווים)</div>' +
        '<input class="contest-input" id="cjf-code" placeholder="ABC123" maxlength="8" style="text-transform:uppercase;letter-spacing:0.25em;font-size:20px;text-align:center;font-weight:700" />' +
        '<button class="contest-submit-btn" id="cjf-submit" style="margin-top:8px">חפש תחרות</button>' +
        '<div class="contest-error" id="cjf-error"></div>' +
      '</div>';

    document.getElementById('cjf-submit').onclick = function() {
      const code = document.getElementById('cjf-code').value.trim().toUpperCase();
      if (!code) {
        document.getElementById('cjf-error').textContent = 'נא להזין קוד';
        return;
      }
      showContestPreview(code);
    };
  }

  async function showContestPreview(code) {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML = '<div class="contest-loading">טוען תחרות...</div>';
    const data = await fetchContest(code);
    if (!data) {
      screen.innerHTML =
        createBackButton('contest-menu') +
        '<div class="contest-title" style="margin-top:60px">תחרות לא נמצאה</div>' +
        '<div class="contest-sub">בדוק את הקוד ונסה שוב</div>';
      return;
    }
    // If the player is already a member, skip the join form
    const alreadyMember = (data.players || []).some(function(p) { return p.you; });
    if (alreadyMember) {
      setActiveContest(code);
      showContestLeaderboard(code);
      return;
    }
    const ended = new Date(data.contest.ends_at) < new Date();
    const topScore = data.players.length ? data.players[0].score : 0;

    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">' + data.contest.name + '</div>' +
      '<div class="contest-sub">' + (ended ? 'התחרות הסתיימה' : (data.contest.host_device_id === deviceId ? 'התחרות שיצרת' : 'הוזמנת על ידי ' + escapeHtml(data.contest.host_name))) + '</div>' +
      '<div class="contest-info-card">' +
        '<div class="contest-info-row"><span>שחקנים</span><span>' + data.players.length + '</span></div>' +
        '<div class="contest-info-row"><span>ציון מוביל</span><span>' + topScore.toLocaleString() + '</span></div>' +
        '<div class="contest-info-row"><span>זמן שנותר</span><span>' + formatTimeLeft(data.contest.ends_at) + '</span></div>' +
      '</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">השם שלך בלוח</div>' +
        '<input class="contest-input" id="cjp-name" autocapitalize="words" placeholder="הנכד דניאל" maxlength="50" value="' + escapeHtml(getContestDisplayName(code)) + '" />' +
        '<button class="contest-submit-btn" id="cjp-join" ' + (ended ? 'disabled' : '') + '>' + (ended ? 'התחרות הסתיימה' : 'הצטרף ושחק') + '</button>' +
        '<div class="contest-error" id="cjp-error"></div>' +
      '</div>';

    if (!ended) {
      document.getElementById('cjp-join').onclick = async function() {
        const nameVal = document.getElementById('cjp-name').value.trim();
        if (!nameVal) {
          document.getElementById('cjp-error').textContent = 'נא להזין שם';
          return;
        }
        this.disabled = true;
        this.textContent = 'מצטרף...';
        try {
          const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(code) + '/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: deviceId, token: deviceToken, displayName: nameVal })
          });
          if (res.status === 429) {
            document.getElementById('cjp-error').textContent = 'יותר מדי ניסיונות. נסה שוב בעוד שעה.';
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          if (res.status === 409) {
            document.getElementById('cjp-error').textContent = 'השם תפוס. בחר שם אחר.';
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          if (!res.ok) {
            var errData = {};
            try { errData = await res.json(); } catch(e) {}
            var errMsg = 'שגיאה. נסה שוב.';
            if (errData.error === 'insufficient_balance') errMsg = '💎 אין מספיק קרדיטים להימור. צריך ' + (errData.wagerRequired || '?') + ' 💎, יש לך ' + playerBalance;
            else if (errData.error === 'ended') errMsg = 'התחרות הסתיימה';
            else if (errData.error === 'not_found') errMsg = 'תחרות לא נמצאה';
            document.getElementById('cjp-error').textContent = errMsg;
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          // Update balance if wager was paid
          fetchPlayerCode(); // refresh balance from server
          setPlayerName(nameVal);
          setContestDisplayName(code, nameVal);
          setActiveContest(code);
          trackEvent('contest_join', { code: code });
          hideContestScreens();
          init('contest');
        } catch (e) {
          document.getElementById('cjp-error').textContent = 'שגיאה. נסה שוב.';
          this.disabled = false;
          this.textContent = 'הצטרף ושחק';
        }
      };
    }
  }

  // Module-level state for the smart-board UX. Reset whenever the contest
  // screen is unmounted (via stopContestRefresh -> teardown is implicit).
  var contestBoardExpanded = false;
  var contestBoardSearchTerm = '';

  // displayScore: server already ranks by score+liveScore, but the row
  // numbers should match — so add the live delta into the displayed total.
  function contestDisplayScore(p) {
    return (p.score | 0) + (p.liveScore == null ? 0 : (p.liveScore | 0));
  }

  // Render a (sub)set of player rows. The full ordered list is used for:
  //   - leader-relative delta (so a slice in the middle still shows
  //     "−12,420" to the top player, not to the slice-top)
  //   - "next target" lookup for the player above ME, even when MY row
  //     happens to be at the slice's top edge
  // startIdx = rank offset for this slice (1-indexed rank = startIdx + i + 1).
  function renderContestBoardRows(players, allPlayers, startIdx) {
    if (!players || players.length === 0) {
      return '<div class="contest-board-empty">אין עדיין שחקנים</div>';
    }
    var all = allPlayers || players;
    var base = startIdx | 0;
    var topScore = contestDisplayScore(all[0]);
    return players.map(function(p, sliceI) {
      var i = base + sliceI;
      var rank = i + 1;
      // Top-3 podium tinting (gold/silver/bronze) — visual status for the
      // top of every contest, regardless of how many players are below.
      var podiumCls = '';
      if (i === 0) podiumCls = ' first podium-gold';
      else if (i === 1) podiumCls = ' podium-silver';
      else if (i === 2) podiumCls = ' podium-bronze';
      const cls = 'contest-board-row' + podiumCls + (p.you ? ' me' : '');
      const youBadge = p.you ? ' <small>(אתה)</small>' : '';
      const games = p.games | 0;
      const tierIdx = (p.liveTier != null && p.liveTier > 0) ? (p.liveTier | 0) : (p.tier | 0);
      const last = formatRelativeTime(p.last);
      const watching = Array.isArray(p.watchers) ? p.watchers.length : 0;
      const watchBadge = watching > 0
        ? '<span class="contest-board-watch" title="צופים עכשיו"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' + watching + '</span>'
        : '';
      let metaLine;
      if (games === 0 && p.liveScore == null) {
        metaLine = '<div class="contest-board-meta">' + (p.you ? 'טרם שיחקת בתחרות' : 'טרם שיחק') + '</div>';
      } else {
        const parts = [];
        if (games > 0) parts.push(games + (games === 1 ? ' משחק' : ' משחקים'));
        if (getActiveTiers()[tierIdx] && tierIdx > 0) parts.push('עד ' + getActiveTiers()[tierIdx].name);
        if (p.liveScore == null && last) parts.push(last);
        metaLine = '<div class="contest-board-meta">' + parts.join(' · ') + '</div>';
      }
      const total = contestDisplayScore(p);
      const delta = (i === 0) ? 0 : topScore - total;
      const deltaLine = delta > 0
        ? '<div class="contest-board-delta">−' + delta.toLocaleString() + '</div>'
        : '';
      const livePill = (p.liveScore != null)
        ? '<div class="contest-board-live">+' + (p.liveScore | 0).toLocaleString() + '<span style="font-weight:600;margin-right:2px;">חי</span></div>'
        : '';
      const tierObj = getActiveTiers()[tierIdx];
      const tierBadge = ((games > 0 || p.liveScore != null) && tierObj && tierIdx > 0)
        ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '" title="' + escapeHtml(tierObj.name) + '">' + tierObj.svg + '</div>'
        : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
      // Mark this row clickable-to-spectate only if it's another player who's
      // currently live. The delegated handler in `showContestLeaderboard`
      // dispatches on this data attribute.
      const spectatable = !p.you && p.liveScore != null && p.deviceId;
      const rowAttrs = spectatable
        ? ' role="button" tabindex="0" data-spectate-target="' + escapeHtml(p.deviceId) + '" data-spectate-name="' + escapeHtml(p.name || '') + '"'
        : '';
      const spectatableCls = spectatable ? ' spectatable' : '';
      const spectateHint = spectatable
        ? '<div class="contest-spectate-hint" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>צפה</div>'
        : '';
      // Rank badge — top-3 get the medal glyph in place of the number.
      var rankBadge = (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank);
      const avatarHtml = renderAvatarHtml(p.deviceId || p.name, 'sm');
      var rowHtml = '<div class="' + cls + spectatableCls + '"' + rowAttrs + '>' +
        '<div class="contest-board-rank">' + rankBadge + '</div>' +
        tierBadge +
        '<div class="contest-board-name-col">' +
          '<div class="contest-board-name">' + watchBadge + avatarHtml + escapeHtml(p.name || 'אנונימי') + youBadge + '</div>' +
          metaLine +
        '</div>' +
        '<div class="contest-board-score-col">' +
          '<div class="contest-board-score">' + total.toLocaleString() + '</div>' +
          livePill +
          spectateHint +
          deltaLine +
        '</div>' +
      '</div>';
      // "Next target" pill — attached to MY row when there's someone
      // directly above me. The single most-addictive contest moment is
      // "you need just N more to overtake X" — surface it persistently
      // instead of waiting for the overtake-alert poll to fire.
      if (p.you && i > 0) {
        var above = all[i - 1];
        if (above) {
          var gap = contestDisplayScore(above) - total;
          if (gap > 0) {
            rowHtml += '<div class="contest-next-target">' +
              '<span class="contest-next-target-arrow">⚔️</span>' +
              '<span>עוד <strong>' + gap.toLocaleString() + '</strong> כדי לעקוף את <strong>' + escapeHtml(above.name || 'אנונימי') + '</strong></span>' +
            '</div>';
          }
        }
      }
      return rowHtml;
    }).join('');
  }

  // Smart contest board — keeps the flat layout for small contests and
  // switches to a "top 5 + you ± neighbors" compact view (with optional
  // expand-all + search) once the participant count makes the flat list
  // feel like a scroll-wall. Single entry point for showContestLeaderboard
  // + refreshContestBoardSilently so both stay in sync.
  function renderContestSmartBoard(players) {
    if (!players || players.length === 0) {
      return '<div class="contest-board-empty">אין עדיין שחקנים</div>';
    }
    var total = players.length;
    var SMART_THRESHOLD = 12;   // below this we render flat (no benefit from sectioning)
    var SEARCH_THRESHOLD = 20;  // search input only kicks in for genuinely long lists

    // Find ME in the list
    var myIdx = -1;
    for (var k = 0; k < players.length; k++) {
      if (players[k].you) { myIdx = k; break; }
    }

    // Flat list path — small contests OR user explicitly expanded
    if (total <= SMART_THRESHOLD || contestBoardExpanded) {
      var controlsHtml = '';
      var filtered = players;
      if (contestBoardExpanded && total > SMART_THRESHOLD) {
        if (total >= SEARCH_THRESHOLD) {
          controlsHtml +=
            '<div class="contest-board-search-wrap">' +
              '<input type="text" class="contest-board-search" id="clb-search" placeholder="חיפוש לפי שם…" value="' + escapeHtml(contestBoardSearchTerm) + '" autocomplete="off">' +
            '</div>';
        }
        controlsHtml +=
          '<button type="button" class="contest-board-collapse-btn" id="clb-collapse">' +
            '⌃ חזרה לתצוגה קומפקטית' +
          '</button>';
        var q = (contestBoardSearchTerm || '').trim().toLowerCase();
        if (q) {
          filtered = players.filter(function(p) {
            return (p.name || '').toLowerCase().indexOf(q) >= 0;
          });
        }
      }
      // When filtering, we still want rank numbers to reflect actual
      // contest position — pass startIdx=0 + the full ordered list so
      // ranks aren't compressed by the filter.
      var rowsHtml;
      if (filtered.length === 0) {
        rowsHtml = '<div class="contest-board-empty">לא נמצאו שחקנים מתאימים</div>';
      } else if (filtered === players) {
        rowsHtml = renderContestBoardRows(players, players, 0);
      } else {
        // Filtered list: render each row with its true rank (re-map by indexOf in players).
        // Cheap because filter is rare and player counts are bounded by contest size.
        var indexed = filtered.map(function(p) { return { p: p, i: players.indexOf(p) }; });
        rowsHtml = indexed.map(function(entry) {
          return renderContestBoardRows([entry.p], players, entry.i);
        }).join('');
      }
      return controlsHtml + rowsHtml;
    }

    // Smart compact path: top-5 + (optional) my-window + expand button
    var TOP_N = 5;
    var WINDOW = 2;
    var html = '';

    // TOP section — always
    html += '<div class="contest-board-section-label">🏆 המובילים</div>';
    html += renderContestBoardRows(players.slice(0, TOP_N), players, 0);

    // MY window — only if I'm beyond top-N
    if (myIdx >= TOP_N) {
      var fromIdx = Math.max(TOP_N, myIdx - WINDOW);
      var toIdx = Math.min(total, myIdx + WINDOW + 1);
      // Gap indicator if my-window doesn't touch the top section
      if (fromIdx > TOP_N) {
        html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      }
      html += '<div class="contest-board-section-label">📍 המיקום שלך · #' + (myIdx + 1) + ' מתוך ' + total + '</div>';
      html += renderContestBoardRows(players.slice(fromIdx, toIdx), players, fromIdx);
      if (toIdx < total) {
        html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      }
    } else if (myIdx === -1 && total > TOP_N) {
      // Not playing yet but the contest is big — give a hint
      html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      html += '<div class="contest-board-section-label">📍 הצטרף כדי לראות את המיקום שלך</div>';
    }

    // Expand-all CTA
    html += '<button type="button" class="contest-board-expand-btn" id="clb-expand">' +
      'הצג את כל ' + total + ' השחקנים' +
    '</button>';

    return html;
  }

  // Wire expand/collapse/search controls inside the contest board. Called
  // after every board render (initial mount + silent refresh) so handlers
  // stay attached to the freshly-rebuilt DOM.
  function wireContestBoardControls(boardEl, players) {
    if (!boardEl) return;
    var expandBtn = boardEl.querySelector('#clb-expand');
    if (expandBtn) expandBtn.onclick = function() {
      contestBoardExpanded = true;
      contestBoardSearchTerm = '';
      boardEl.innerHTML = renderContestSmartBoard(players);
      wireContestBoardControls(boardEl, players);
      // Scroll my row into view so the expanded list lands centered on me,
      // not on row #1 — the whole reason for expanding is "show me the
      // full picture relative to where I stand."
      var me = boardEl.querySelector('.contest-board-row.me');
      if (me && typeof me.scrollIntoView === 'function') {
        try { me.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
      }
    };
    var collapseBtn = boardEl.querySelector('#clb-collapse');
    if (collapseBtn) collapseBtn.onclick = function() {
      contestBoardExpanded = false;
      contestBoardSearchTerm = '';
      boardEl.innerHTML = renderContestSmartBoard(players);
      wireContestBoardControls(boardEl, players);
    };
    var searchEl = boardEl.querySelector('#clb-search');
    if (searchEl) {
      // Debounce so every keystroke doesn't trigger a full re-render
      // (which would also drop the focus we just restored).
      var searchTimer = null;
      searchEl.oninput = function() {
        var val = searchEl.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function() {
          contestBoardSearchTerm = val;
          var caret = searchEl.selectionStart;
          boardEl.innerHTML = renderContestSmartBoard(players);
          wireContestBoardControls(boardEl, players);
          var refocus = boardEl.querySelector('#clb-search');
          if (refocus) {
            refocus.focus();
            if (caret != null) try { refocus.setSelectionRange(caret, caret); } catch(e) {}
          }
        }, 140);
      };
    }
  }

  function stopContestRefresh() {
    if (contestRefreshTimer) { clearInterval(contestRefreshTimer); contestRefreshTimer = null; }
    contestRefreshCode = null;
  }

  async function refreshContestBoardSilently() {
    if (!contestRefreshCode) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const data = await fetchContest(contestRefreshCode);
    if (!data) return;
    updateMyWatchersFromContestData(data);
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    const boardEl = screen.querySelector('.contest-board');
    if (boardEl) {
      // Preserve focus + caret position on the search input across silent
      // refreshes — otherwise typing eats keystrokes every 20s.
      var oldSearch = boardEl.querySelector('#clb-search');
      var hadFocus = oldSearch && document.activeElement === oldSearch;
      var caret = hadFocus ? oldSearch.selectionStart : null;
      boardEl.innerHTML = renderContestSmartBoard(data.players || []);
      wireContestBoardControls(boardEl, data.players || []);
      if (hadFocus) {
        var newSearch = boardEl.querySelector('#clb-search');
        if (newSearch) {
          newSearch.focus();
          if (caret != null) try { newSearch.setSelectionRange(caret, caret); } catch(e) {}
        }
      }
    }
    const subEl = document.getElementById('clb-sub');
    if (subEl) {
      subEl.innerHTML = '<span class="contest-live-dot"></span>' +
        (data.players || []).length + ' שחקנים · ' + formatTimeLeft(data.contest.ends_at);
    }
  }

  function updateMyWatchersFromContestData(data) {
    if (!data || !Array.isArray(data.players)) return;
    const me = data.players.find(function(p) { return p.you; });
    if (!me) return;
    meWatchers = Array.isArray(me.watchers) ? me.watchers : [];
    meHasWatchers = !!me.hasWatchers;
    meWatcherCount = meWatchers.length;
    renderAudienceBadge();
  }

  function startContestRefresh(code) {
    stopContestRefresh();
    contestRefreshCode = code;
    contestRefreshTimer = setInterval(refreshContestBoardSilently, 20000);
  }

  /* ============ OVERTAKE WATCH (toast when someone passes me) ============ */
  // Polls the active contest every 45s. The first poll seeds a baseline
  // silently; subsequent polls compare each opponent's score to the baseline
  // and fire a toast for anyone who crossed above my score since the last
  // check. Names are used as identifiers (the contest endpoint does not
  // expose device_id) — fine for friends groups; rare name collisions just
  // cause one missed toast.
  let overtakeTimer = null;
  let overtakeCode = null;
  let overtakeBaseline = null;          // { myScore, myRank, others: Map(name -> {score, rank}) }
  let overtakeMyLiveScore = 0;          // track local score for comparison

  function snapshotFromContestData(data) {
    const sorted = (data.players || []).slice().sort(function(a, b) { return (b.score | 0) - (a.score | 0); });
    const me = sorted.find(function(p) { return p.you; });
    const myScore = me ? (me.score | 0) : 0;
    const myRank = me ? sorted.indexOf(me) + 1 : 999;
    const others = new Map();
    sorted.forEach(function(p, idx) {
      if (!p.you) others.set(p.name, { score: p.score | 0, rank: idx + 1 });
    });
    return { myScore: myScore, myRank: myRank, others: others, leader: sorted[0] ? sorted[0].name : '' };
  }

  async function refreshOvertake() {
    if (!overtakeCode || !overtakeBaseline) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (mode !== 'contest' || activeContestCode !== overtakeCode) return;
    var data;
    try { data = await fetchContest(overtakeCode); } catch(e) { return; }
    if (!data) return;
    if (!overtakeTimer) return;

    const prev = overtakeBaseline;
    const next = snapshotFromContestData(data);

    // Use local score if higher (we may not have submitted yet)
    var realMyScore = Math.max(next.myScore, score || 0);

    // --- 1. Someone overtook you ---
    var overtakers = [];
    next.others.forEach(function(info, name) {
      var prevInfo = prev.others.get(name);
      var prevScore = prevInfo ? prevInfo.score : 0;
      if (info.score > realMyScore && prevScore <= prev.myScore) {
        overtakers.push({ name: name, score: info.score, rank: info.rank });
      }
    });

    // --- 2. You took back #1 ---
    var youTookFirst = prev.myRank > 1 && next.myRank === 1;

    // --- 3. Someone else took #1 (not you) ---
    var newLeader = null;
    if (next.leader !== prev.leader && next.leader !== '' && next.myRank > 1) {
      var leaderInfo = next.others.get(next.leader);
      if (leaderInfo) newLeader = { name: next.leader, score: leaderInfo.score };
    }

    // --- 4. Gap closing: you're close to overtaking someone ---
    var almostOvertake = null;
    if (next.myRank > 1) {
      // Find player just above me
      var aboveMe = null;
      next.others.forEach(function(info, name) {
        if (info.rank === next.myRank - 1) aboveMe = { name: name, score: info.score };
      });
      if (aboveMe) {
        var gap = aboveMe.score - realMyScore;
        var gapPct = parseFloat(getEventConfig('contest_alert_gap_pct', '0.1')) || 0.1;
        var gapMax = getEventNum('contest_alert_gap_max', 5000);
        if (gap > 0 && gap < realMyScore * gapPct && gap < gapMax) {
          almostOvertake = { name: aboveMe.name, gap: gap };
        }
      }
    }

    overtakeBaseline = next;

    // --- Show notifications (priority order) ---
    if (overtakers.length > 0) {
      overtakers.sort(function(a, b) { return a.rank - b.rank; });
      showContestAlert('overtake', overtakers[0], overtakers.length - 1);
    } else if (youTookFirst) {
      showContestAlert('you_first', null, 0);
    } else if (newLeader) {
      showContestAlert('new_leader', newLeader, 0);
    } else if (almostOvertake) {
      showContestAlert('almost', almostOvertake, 0);
    }
  }

  function startOvertakeWatch(code) {
    stopOvertakeWatch();
    if (!code) return;
    overtakeCode = code;
    // Seed baseline immediately, then poll every 12 seconds
    (async function() {
      try {
        var data = await fetchContest(code);
        if (data) overtakeBaseline = snapshotFromContestData(data);
      } catch(e) {}
      if (overtakeCode) {
        var pollMs = getEventNum('contest_alert_interval', 12) * 1000;
        overtakeTimer = setInterval(refreshOvertake, pollMs);
      }
    })();
  }

  function stopOvertakeWatch() {
    if (overtakeTimer) { clearTimeout(overtakeTimer); clearInterval(overtakeTimer); overtakeTimer = null; }
    overtakeCode = null;
    overtakeBaseline = null;
  }

  // ============================================================
  // CONTEST LIVE HUD — persistent in-game widget
  // ============================================================
  // The duel mode has a live opponent HUD pinned at the top while playing.
  // The contest mode used to have *only* periodic overtake banners — by the
  // time those fire you've already missed multiple opponent score updates,
  // and on a fresh game there's no ambient "where do I stand" signal at
  // all. The contest HUD fixes that: a compact 3-column bar showing my
  // live rank + score in the middle, the player I'm chasing on one side,
  // and the player chasing me on the other. Tap = open the full contest
  // leaderboard. Self-mounts on init('contest'), self-tears-down on game
  // over or mode switch (mirrors the duel HUD lifecycle).
  var _contestHudPoller = null;
  var _contestHudTick = null;
  var _contestHudCode = null;
  var _contestHudLastRank = null;
  // Cache the most-recent /api/contests/:code response so the 400ms tick
  // can re-run the full paint (incl. gap/lead recomputation) without a
  // network round-trip. The old approach updated the score in isolation —
  // displayed "10,546" while the rank+gap calc used accumulated+10,546,
  // so the three HUD numbers were silently from different totals.
  var _contestHudCachedPlayers = null;
  // Cross-call flag: when set, the next showContestLeaderboard mount will
  // route its back button back into the running game (init('contest')
  // restores from the saved state). Consumed once and reset.
  var _contestHudJustOpenedLb = false;

  function startContestHud(code) {
    stopContestHud();
    if (!code) return;
    _contestHudCode = code;
    renderContestHudShell();
    // Fast first paint (no waiting on the slow data poll).
    refreshContestHudData();
    // Data refresh — same cadence as the existing overtake watch (~5s)
    // so we don't double the contest-fetch load. Frequent enough that the
    // HUD reflects opponents' real-time scores between drops.
    _contestHudPoller = setInterval(refreshContestHudData, 5000);
    // My-score tick — reads the local `score` global every 400ms so my
    // own number updates instantly between merges, without waiting on
    // the network round-trip.
    _contestHudTick = setInterval(syncContestHudMyScore, 400);
  }

  function stopContestHud() {
    if (_contestHudPoller) { clearInterval(_contestHudPoller); _contestHudPoller = null; }
    if (_contestHudTick)   { clearInterval(_contestHudTick);   _contestHudTick   = null; }
    var hud = document.getElementById('contest-hud');
    if (hud) hud.remove();
    _contestHudCode = null;
    _contestHudLastRank = null;
    _contestHudCachedPlayers = null;
  }

  function renderContestHudShell() {
    if (document.getElementById('contest-hud')) return;
    var hud = document.createElement('div');
    hud.id = 'contest-hud';
    hud.className = 'contest-hud';
    // Each side shows: name → ABSOLUTE score → small delta line below.
    // The previous "Hadas 4,194" was a delta but read like a score, which
    // led to the user thinking Hadas was gaining points as their own
    // score grew. Now the big number is always the OTHER player's actual
    // total; the delta with ↑/↓ sits underneath as secondary info.
    hud.innerHTML =
      '<div class="contest-hud-side contest-hud-target" id="contest-hud-target">' +
        '<div class="contest-hud-name" id="contest-hud-target-name">—</div>' +
        '<div class="contest-hud-score" id="contest-hud-target-score">--</div>' +
        '<div class="contest-hud-delta" id="contest-hud-target-delta">לעקוף ⚔️</div>' +
      '</div>' +
      '<div class="contest-hud-side contest-hud-me">' +
        '<div class="contest-hud-rank" id="contest-hud-rank">#?</div>' +
        '<div class="contest-hud-score contest-hud-my-score" id="contest-hud-my-score">0</div>' +
        '<div class="contest-hud-label" id="contest-hud-mode-label">אתה</div>' +
      '</div>' +
      '<div class="contest-hud-side contest-hud-chaser" id="contest-hud-chaser">' +
        '<div class="contest-hud-name" id="contest-hud-chaser-name">—</div>' +
        '<div class="contest-hud-score" id="contest-hud-chaser-score">--</div>' +
        '<div class="contest-hud-delta" id="contest-hud-chaser-delta">רודף 👀</div>' +
      '</div>' +
      '<button class="contest-hud-expand" id="contest-hud-expand" aria-label="פתח לוח מובילים" type="button">⤢</button>';
    document.body.appendChild(hud);
    // Tap-to-expand → opens the full leaderboard. Save my current game
    // state first (same as the existing pause/resume flow) so coming
    // back picks up where I left off. The `_contestHudJustOpenedLb`
    // flag tells the leaderboard mount to route its back button back
    // into init('contest') instead of home, so a one-tap return works.
    var expandBtn = document.getElementById('contest-hud-expand');
    if (expandBtn) expandBtn.onclick = function(e) {
      e.stopPropagation();
      try { if (typeof saveContestGameState === 'function') saveContestGameState(); } catch(err) {}
      try { if (typeof stopLivePush === 'function') stopLivePush(); } catch(err) {}
      _contestHudJustOpenedLb = true;
      showContestLeaderboard(_contestHudCode);
    };
  }

  // Tick: re-paint the HUD using the cached players list so the displayed
  // score, rank, and gaps are computed from one consistent set of numbers
  // (the previous split between "tick writes score" and "poll writes rank"
  // produced numbers that came from different totals — the inconsistency
  // the user reported as "המספרים לא אמיתיים").
  function syncContestHudMyScore() {
    if (!_contestHudCachedPlayers) return;
    if (!document.getElementById('contest-hud')) return;
    paintContestHud(_contestHudCachedPlayers);
  }

  function refreshContestHudData() {
    if (!_contestHudCode) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (mode !== 'contest' || activeContestCode !== _contestHudCode) return;
    fetchContest(_contestHudCode).then(function(data) {
      if (!data || !document.getElementById('contest-hud')) return;
      _contestHudCachedPlayers = data.players || [];
      paintContestHud(_contestHudCachedPlayers);
    }).catch(function() {});
  }

  function paintContestHud(players) {
    if (!players.length) return;
    // Score mode resolution: for 'best' contests the projection is
    // max(accumulated_best, this_game) instead of accumulated + this_game.
    // The mode is on activeContestData (which init('contest') populates
    // before we ever mount the HUD).
    var bestMode = activeContestData && activeContestData.score_mode === 'best';
    var myLiveScore = (typeof score === 'number' ? score : 0) | 0;
    var ranked = players.map(function(p) {
      var total;
      if (p.you) {
        if (bestMode) {
          // For other players, p.score already holds their best so far.
          // For me, take the max of my accumulated best and this game.
          total = Math.max(p.score | 0, myLiveScore);
        } else {
          total = (p.score | 0) + myLiveScore;
        }
      } else {
        var live = p.liveScore == null ? 0 : (p.liveScore | 0);
        if (bestMode) {
          // Their projection = max(their stored best, their live game).
          total = Math.max(p.score | 0, live);
        } else {
          total = (p.score | 0) + live;
        }
      }
      return { p: p, total: total };
    });
    ranked.sort(function(a, b) { return b.total - a.total; });
    var myIdx = -1;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].p.you) { myIdx = i; break; }
    }
    if (myIdx === -1) return; // not a member (shouldn't happen mid-game)
    var myRank = myIdx + 1;
    var total = ranked.length;
    var myTotal = ranked[myIdx].total | 0;
    var target = myIdx > 0 ? ranked[myIdx - 1] : null;       // player above me
    var chaser = myIdx < ranked.length - 1 ? ranked[myIdx + 1] : null; // below me

    // My displayed score = PROJECTED total (accumulated contest score +
    // current in-progress game in cumulative mode; max-of in best mode).
    // Same number drives the rank + the gaps so the three HUD readings
    // never disagree.
    var myScoreEl = document.getElementById('contest-hud-my-score');
    if (myScoreEl) myScoreEl.textContent = myTotal.toLocaleString();
    // Mode label under my score — small but always visible, so the
    // player knows whether they're playing "every game counts" or
    // "best one wins".
    var modeLabelEl = document.getElementById('contest-hud-mode-label');
    if (modeLabelEl) modeLabelEl.textContent = bestMode ? 'אתה · 🏆 הכי גבוה' : 'אתה';

    // Rank
    var rankEl = document.getElementById('contest-hud-rank');
    if (rankEl) {
      rankEl.textContent = '#' + myRank + ' / ' + total;
      // Pulse on rank improvement — small but powerful dopamine hit
      if (_contestHudLastRank != null && myRank < _contestHudLastRank) {
        rankEl.classList.remove('rank-up'); void rankEl.offsetWidth;
        rankEl.classList.add('rank-up');
      } else if (_contestHudLastRank != null && myRank > _contestHudLastRank) {
        rankEl.classList.remove('rank-down'); void rankEl.offsetWidth;
        rankEl.classList.add('rank-down');
      }
      _contestHudLastRank = myRank;
    }

    // Target side (player above me). Big number = their ACTUAL score;
    // small line below = the gap I need to close. This is the layout
    // that broke the "Hadas is gaining points" misreading — the user
    // sees the opponent's real score, not a delta in disguise.
    var tName = document.getElementById('contest-hud-target-name');
    var tScore = document.getElementById('contest-hud-target-score');
    var tDelta = document.getElementById('contest-hud-target-delta');
    var targetWrap = document.getElementById('contest-hud-target');
    if (target) {
      if (tName) tName.textContent = target.p.name || 'אנונימי';
      if (tScore) tScore.textContent = (target.total | 0).toLocaleString();
      var gap = target.total - myTotal;
      if (tDelta) tDelta.textContent = '↑ ' + gap.toLocaleString() + ' לעקוף';
      if (targetWrap) targetWrap.classList.remove('contest-hud-empty');
    } else {
      // I'm #1 — celebrate
      if (tName) tName.textContent = '🏆 ראשון';
      if (tScore) tScore.textContent = '';
      if (tDelta) tDelta.textContent = 'אין מעליך';
      if (targetWrap) targetWrap.classList.add('contest-hud-empty');
    }

    // Chaser side (player below me) — same pattern: their score on top,
    // my lead in the small delta line. The chaser's number stays put as
    // their score grows on their own merges; my LEAD over them changes
    // as I score — and the lead label says exactly that.
    var cName = document.getElementById('contest-hud-chaser-name');
    var cScore = document.getElementById('contest-hud-chaser-score');
    var cDelta = document.getElementById('contest-hud-chaser-delta');
    var chaserWrap = document.getElementById('contest-hud-chaser');
    if (chaser) {
      if (cName) cName.textContent = chaser.p.name || 'אנונימי';
      if (cScore) cScore.textContent = (chaser.total | 0).toLocaleString();
      var lead = myTotal - chaser.total;
      if (cDelta) cDelta.textContent = '↓ ' + lead.toLocaleString() + ' לפניך';
      if (chaserWrap) chaserWrap.classList.remove('contest-hud-empty');
    } else {
      // I'm last (or alone)
      if (cName) cName.textContent = '—';
      if (cScore) cScore.textContent = '';
      if (cDelta) cDelta.textContent = '';
      if (chaserWrap) chaserWrap.classList.add('contest-hud-empty');
    }
  }

  function showContestAlert(type, player, extraCount) {
    // Check if alerts are enabled
    if (getEventConfig('contest_alerts_enabled', 'true') !== 'true') return;

    var emoji, text, bgColor, borderColor, shakeInt;

    if (type === 'overtake') {
      emoji = '⚡';
      var extra = extraCount > 0 ? ' (+' + extraCount + ' נוספים)' : '';
      text = escapeHtml(player.name) + ' עבר אותך!' + extra + ' · ' + (player.score | 0).toLocaleString();
      bgColor = '#C8472F';
      borderColor = '#FF6B35';
      shakeInt = getEventNum('contest_alert_shake_overtake', 3);
    } else if (type === 'you_first') {
      emoji = '👑';
      text = 'אתה מוביל את התחרות!';
      bgColor = '#BA7517';
      borderColor = '#FAC775';
      shakeInt = getEventNum('contest_alert_shake_first', 4);
    } else if (type === 'new_leader') {
      emoji = '🔥';
      text = escapeHtml(player.name) + ' תפס את המקום הראשון! · ' + (player.score | 0).toLocaleString();
      bgColor = '#8B0000';
      borderColor = '#C8472F';
      shakeInt = getEventNum('contest_alert_shake_leader', 2);
    } else if (type === 'almost') {
      emoji = '💪';
      text = 'עוד ' + player.gap.toLocaleString() + ' נקודות לעבור את ' + escapeHtml(player.name) + '!';
      bgColor = '#2E8B6F';
      borderColor = '#9FE1CB';
      shakeInt = 0;
    }

    var displayMs = getEventNum('contest_alert_duration', 3500);

    // Dramatic banner
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:14px 16px;text-align:center;direction:rtl;font-weight:700;font-size:14px;color:#FFF;pointer-events:none;background:' + bgColor + ';border-bottom:3px solid ' + borderColor + ';transform:translateY(-100%);transition:transform 0.3s ease-out;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
    banner.innerHTML = '<span style="font-size:20px;margin-left:6px">' + emoji + '</span> ' + text;
    document.body.appendChild(banner);

    // Slide in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { banner.style.transform = 'translateY(0)'; });
    });

    // Shake + vibration
    if (shakeInt > 0) shakeGrid(shakeInt);
    if (!isSfxMuted()) buzz([40, 60, 40]);
    if (!isSfxMuted() && type === 'overtake') {
      tone({ freq: 392, bendTo: 294, duration: 0.22, type: 'sawtooth', vol: 0.09, filter: 2400 });
    }
    if (!isSfxMuted() && type === 'you_first') {
      tone({ freq: 523, duration: 0.12, type: 'sine', vol: 0.08 });
      setTimeout(function() { tone({ freq: 659, duration: 0.12, type: 'sine', vol: 0.08 }); }, 120);
      setTimeout(function() { tone({ freq: 784, duration: 0.2, type: 'sine', vol: 0.08 }); }, 240);
    }

    // Slide out
    setTimeout(function() {
      banner.style.transform = 'translateY(-100%)';
      setTimeout(function() { banner.remove(); }, 400);
    }, displayMs);
  }

  async function showContestLeaderboard(code) {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML = '<div class="contest-loading">טוען לוח...</div>';
    const data = await fetchContest(code);
    if (!data) {
      screen.innerHTML =
        createBackButton('home') +
        '<div class="contest-title" style="margin-top:60px">שגיאת חיבור</div>';
      return;
    }

    // Reset smart-board state on every fresh mount so the player always
    // lands on the compact view (and a stale search term from a previous
    // visit doesn't filter the new list to "no results").
    contestBoardExpanded = false;
    contestBoardSearchTerm = '';
    const playersHtml = renderContestSmartBoard(data.players || []);
    const link = buildContestShareLink(code);

    // If we just arrived here from the in-game HUD's ⤢ button, the back
    // arrow should resume the paused game (init('contest') restores from
    // the saved state). Consume the flag so the next mount goes back to
    // the regular home/contest-menu routing.
    const returnToGame = _contestHudJustOpenedLb;
    _contestHudJustOpenedLb = false;
    // Back: if player has 2+ contests, go to my-contests list; else home.
    const clbBackTarget = myContestsCountSync() >= 2 ? 'contest-menu' : 'home';
    // §2.1 — render via mountShell (unified header). The old back-button +
    // <div class="contest-title"> is gone; mountShell injects both.
    screen.innerHTML =
      '<div class="contest-code-row">' +
        '<button class="contest-code-pill" id="clb-code-pill" aria-label="העתק קוד התחרות">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>קוד</span>' +
          '<code>' + escapeHtml(data.contest.code) + '</code>' +
        '</button>' +
      '</div>' +
      '<div class="contest-sub" id="clb-sub" style="display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<span><span class="contest-live-dot"></span>' +
        (data.players || []).length + ' שחקנים · ' + formatTimeLeft(data.contest.ends_at) + '</span>' +
        '<button id="clb-refresh" style="background:none;border:1px solid rgba(0,0,0,0.1);border-radius:6px;padding:3px 6px;cursor:pointer;display:inline-flex;align-items:center" aria-label="רענן">' +
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="contest-scoring-note">' +
        (data.contest.score_mode === 'best'
          ? '🏆 הכי גבוה — רק המשחק הטוב ביותר נספר'
          : '🧮 ניקוד מצטבר — כל משחק מצטרף לסך הכל'
        ) +
      '</div>' +
      '<div class="contest-board" id="clb-board">' + playersHtml + '</div>' +
      '<div class="contest-form" style="margin-top:18px">' +
        (returnToGame ? '<button class="contest-submit-btn" id="clb-resume" style="background:linear-gradient(135deg,#2E8B6F,#1A6B53);color:#FFFFFF">↩ חזור למשחק שלך</button>' : '') +
        '<button class="contest-submit-btn" id="clb-play"' + (returnToGame ? ' style="background:#FFFFFF;color:#1C1A18;border:1.5px solid rgba(0,0,0,0.12)"' : '') + '>' + (returnToGame ? 'התחל משחק חדש' : 'שחק עכשיו') + '</button>' +
        '<button class="contest-secondary-btn" id="clb-spectate" style="display:none">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '<span id="clb-spectate-label">צפה במשחק חי</span>' +
          '</span>' +
        '</button>' +
        '<button class="contest-secondary-btn" id="clb-share">שתף קישור</button>' +
        (myContestsCountSync() >= 2 ? '<button class="contest-secondary-btn" id="clb-switch" style="margin-top:6px">↕ החלפת תחרות (' + myContestsCountSync() + ')</button>' : '') +
        '<button class="contest-ghost-btn" id="clb-leave">נתק ממכשיר זה</button>' +
      '</div>';

    // §2.1 — unified shell at the top of this screen. Back reuses the
    // legacy back-target logic (home vs contest-menu) so behavior is
    // unchanged; visually it now matches the rest of the new shell.
    // EXCEPTION: when we arrived from the in-game HUD's ⤢ button, back
    // resumes the paused game instead — the player just wanted to peek
    // at the standings, not abandon their run.
    mountShell({
      target: screen,
      title: data.contest.name,
      subtitle: returnToGame
        ? '⏸ המשחק שלך מושהה'
        : 'תחרות חברים · ' + (data.players || []).length + ' שחקנים',
      onBack: function() {
        if (returnToGame) {
          // Resume — the game state was saved by the HUD before the LB mount,
          // so init('contest') restores it.
          hideContestScreens();
          if (typeof init === 'function') init('contest');
          return;
        }
        if (clbBackTarget === 'contest-menu') {
          hideContestScreens();
          showContestMenu();
        } else {
          hideContestScreens();
          if (typeof showHome === 'function') showHome();
        }
      }
    });
    // Wire the explicit "resume game" CTA (only present when returnToGame).
    var resumeBtn = document.getElementById('clb-resume');
    if (resumeBtn) resumeBtn.onclick = function() {
      hideContestScreens();
      if (typeof init === 'function') init('contest');
    };

    // Wire smart-board controls (expand/collapse/search) on first mount.
    // Silent refreshes re-call this themselves so the handlers stay alive
    // after every 20s board re-render.
    var initialBoardEl = document.getElementById('clb-board');
    if (initialBoardEl) wireContestBoardControls(initialBoardEl, data.players || []);

    document.getElementById('clb-play').onclick = function() {
      setActiveContest(code);
      stopContestRefresh();
      hideContestScreens();
      // In returnToGame mode the label is "התחל משחק חדש" — must wipe
      // the saved mid-game state so init doesn't restore the paused game.
      init('contest', returnToGame ? { fresh: true } : undefined);
    };
    const refreshBtn = document.getElementById('clb-refresh');
    if (refreshBtn) refreshBtn.onclick = function() {
      refreshBtn.style.opacity = '0.4';
      refreshContestBoardSilently().then(function() {
        refreshBtn.style.opacity = '1';
      });
    };
    const codePill = document.getElementById('clb-code-pill');
    if (codePill) codePill.onclick = function() {
      const text = buildContestShareLink(code);
      const setCopied = function() {
        codePill.classList.add('copied');
        setTimeout(function() { codePill.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(setCopied, setCopied);
      } else {
        setCopied();
      }
    };
    document.getElementById('clb-share').onclick = function() {
      const btn = this;
      const orig = btn.textContent;
      const flash = function() {
        btn.textContent = '✓ הקישור הועתק';
        setTimeout(function() { btn.textContent = orig; }, 1700);
      };
      const shareText = data.contest.host_name + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' + link;
      if (navigator.share) {
        navigator.share({ text: shareText }).catch(function() {
          // user cancelled the share sheet — fall through to copy as a fallback
          if (navigator.clipboard) navigator.clipboard.writeText(link).then(flash, flash);
          else flash();
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(flash, flash);
      } else {
        flash();
      }
    };
    const switchBtn = document.getElementById('clb-switch');
    if (switchBtn) switchBtn.onclick = showMyContestsList;
    const leaveBtn = document.getElementById('clb-leave');
    if (leaveBtn) leaveBtn.onclick = async function() {
      if (!confirm('לנתק את המכשיר מהתחרות? הציון נשמר בלוח ותוכל להצטרף מחדש עם הקוד.')) return;
      // Server-side soft-leave FIRST — without this the contest pops back
      // into /api/contests/mine on the next page load and the leave looks
      // broken. Fire-and-forget is intentional: the local cleanup below is
      // what makes the UI feel responsive; the server call just ensures
      // the row is flagged before the next /mine fetch.
      try {
        await apiPost('/api/contests/' + encodeURIComponent(code) + '/leave', {});
      } catch (e) { /* network blip — the user still sees the local exit */ }
      clearContestGameState(code);
      clearContestDisplayName(code);
      stopContestRefresh();
      invalidateMyContestsCache();

      const isLeavingActive = activeContestCode === code;

      if (isLeavingActive) {
        stopOvertakeWatch();
        // Find another contest to switch to so the "חברים" tab stays alive.
        const remaining = await fetchMyContests({ fresh: true });
        const others = (remaining || []).filter(function(c) { return c.code !== code; });
        if (others.length > 0) {
          setActiveContest(others[0].code);
          activeContestData = null;
          if (others.length === 1) {
            showContestLeaderboard(others[0].code);
          } else {
            showMyContestsList();
          }
        } else {
          setActiveContest(null);
          activeContestData = null;
          hideContestScreens();
          showHome();
        }
      } else {
        // Leaving a non-active contest — just go back to the list.
        // Don't touch activeContestCode.
        if (myContestsCountSync() >= 2) {
          showMyContestsList();
        } else {
          hideContestScreens();
          showHome();
        }
      }
    };

    // Delegated spectate handler — fires on any leaderboard row that's
    // tagged spectatable (=another player who is currently live). We use
    // delegation because the inner HTML of `.contest-board` is rewritten
    // every 20s by `refreshContestBoardSilently`.
    const boardEl = document.getElementById('clb-board');
    if (boardEl) {
      const dispatchSpectate = function(target, name) {
        if (!target) return;
        openSpectatorPicker('contest-screen');
        // Once the picker mounted, jump straight into spectating this specific
        // target — saves a click since the user already chose who to watch.
        setTimeout(function() {
          const modal = document.getElementById('spectator-picker-modal');
          if (modal) modal.remove();
          startSpectator(target, name, 'contest-screen');
        }, 0);
      };
      boardEl.addEventListener('click', function(ev) {
        const row = ev.target.closest('[data-spectate-target]');
        if (!row) return;
        dispatchSpectate(row.getAttribute('data-spectate-target'),
                         row.getAttribute('data-spectate-name'));
      });
      boardEl.addEventListener('keydown', function(ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const row = ev.target.closest('[data-spectate-target]');
        if (!row) return;
        ev.preventDefault();
        dispatchSpectate(row.getAttribute('data-spectate-target'),
                         row.getAttribute('data-spectate-name'));
      });
    }

    // Top-level "watch live games" button — also visible mid-game so the
    // player can take a peek without losing their run.
    const specOpenBtn = document.getElementById('clb-spectate');
    function refreshSpectateBtnVisibility() {
      const liveCount = (activeContestData ? 0 : 0) + 0; // placeholder; recomputed below
      // Recompute count from currently-rendered board so we don't double-fetch.
      const rows = document.querySelectorAll('#clb-board [data-spectate-target]');
      if (!specOpenBtn) return;
      if (rows.length > 0) {
        specOpenBtn.style.display = '';
        const label = document.getElementById('clb-spectate-label');
        if (label) label.textContent = rows.length === 1
          ? 'צפה במשחק חי'
          : 'צפה במשחק חי (' + rows.length + ')';
      } else {
        specOpenBtn.style.display = 'none';
      }
    }
    if (specOpenBtn) specOpenBtn.onclick = function() { openSpectatorPicker('contest-screen'); };
    refreshSpectateBtnVisibility();
    // The 20s board refresh rewrites the board HTML — observe it to keep
    // the spectate button's count fresh without piggybacking on every poll.
    if (boardEl && 'MutationObserver' in window) {
      new MutationObserver(refreshSpectateBtnVisibility).observe(boardEl, { childList: true, subtree: false });
    }

    // Leaderboard view has its own 20 s refresh — pause the overtake watcher
    // to avoid hitting the same endpoint twice on different cadences.
    stopOvertakeWatch();
    startContestRefresh(code);
  }

  // Wires up scroll-detection on a freshly-rendered .overlay so the
  // fade-out hint at the bottom only shows when there's actually more to
  // scroll to. Call this after every wrap.innerHTML = '<div class="overlay">…'.
  function equipOverlay() {
    const overlay = document.querySelector('#grid-wrap .overlay');
    if (!overlay) return;
    function syncBottomState() {
      // "at-bottom" = nothing more to reveal by scrolling
      const fits   = overlay.scrollHeight <= overlay.clientHeight + 2;
      const ended  = overlay.scrollTop + overlay.clientHeight >= overlay.scrollHeight - 2;
      overlay.classList.toggle('at-bottom', fits || ended);
    }
    // Initial check after layout settles
    setTimeout(syncBottomState, 0);
    overlay.addEventListener('scroll', syncBottomState, { passive: true });
    window.addEventListener('resize', syncBottomState);
  }

  // Sizes the .grid element with SQUARE cells. Fits within BOTH the
  // available width and height of .grid-wrap so the board never scrolls.
  // On very short screens the cells shrink proportionally instead of
  // overflowing vertically.
  function fitGrid() {
    const wrap = document.getElementById('grid-wrap');
    const grid = document.getElementById('grid');
    if (!wrap || !grid) return;
    const padX = 6;                // matches CSS .grid-wrap horizontal padding
    const padY = 12;               // matches CSS .grid-wrap bottom padding
    const gap = 5;                 // matches CSS .grid gap
    const cols = getBoardCols();
    const rows = getBoardRows();
    const W = Math.max(0, wrap.clientWidth - 2 * padX);
    const H = Math.max(0, wrap.clientHeight - padY - 6);
    if (W <= 0 || H <= 0) return;  // not yet laid out
    const cellByW = Math.floor((W - (cols - 1) * gap) / cols);
    const cellByH = Math.floor((H - (rows - 1) * gap) / rows);
    const cell = Math.max(1, Math.min(cellByW, cellByH));
    grid.style.width  = (cell * cols + (cols - 1) * gap) + 'px';
    grid.style.height = (cell * rows + (rows - 1) * gap) + 'px';
    // Layout diagnostics — only log when the cell size or wrap dimensions
    // CHANGE. Logging on every render flooded the console with 90+ identical
    // lines per game. The viewport-bound state is the interesting signal.
    if (window.__bloomLayoutLog !== false) {
      var sig = cell + '|' + wrap.clientWidth + 'x' + wrap.clientHeight + '|' + window.innerWidth + 'x' + window.innerHeight;
      if (window.__bloomLayoutSig !== sig) {
        window.__bloomLayoutSig = sig;
        var bound = cellByW < cellByH ? 'WIDTH-bound' : 'HEIGHT-bound';
        var mb = document.getElementById('mode-bar');
        var tb = document.getElementById('tier-bar');
        var mbH = mb ? mb.getBoundingClientRect().height : 0;
        var tbH = tb ? tb.getBoundingClientRect().height : 0;
        console.log('[fitGrid]',
          'cell=' + cell + 'px',
          '(' + bound + ')',
          'wrap=' + wrap.clientWidth + 'x' + wrap.clientHeight,
          'mode-bar=' + Math.round(mbH) + 'px',
          'tier-bar=' + Math.round(tbH) + 'px',
          'viewport=' + window.innerWidth + 'x' + window.innerHeight
        );
      }
    }
  }
  // Re-fit on resize/orientation/dpr changes — phones rotate, browser
  // address bar shows/hides, etc.
  window.addEventListener('resize', function() {
    if (typeof fitGrid === 'function') fitGrid();
  });

  // Score per merge. The (1 + (tier-1)*0.3) factor weights higher tiers more
  // heavily — Crown (tier 8) merges are worth ~3.1× a flat formula. This
  // turns the late-game grind into a payoff: a Crown achievement now scores
  // ~62K (versus ~15K with the old linear formula) without touching the
  // chain ladder (which would invalidate existing leaderboards).
  //
  // The optional `col` argument is the survivor column of the merge. When a
  // Dynamic Boards column-multiplier is active (getColumnMultipliers() !== null),
  // it multiplies the base. If col is undefined or no multiplier is active,
  // the function returns the vanilla score with zero overhead — pure refactor
  // for the default case.
  function pointsFor(tier, groupSize, chainMult, col) {
    var base = tier * 10 * (1 + (tier - 1) * 0.3) * groupSize * chainMult;
    var mults = getColumnMultipliers();
    if (mults && typeof col === 'number' && col >= 0 && col < mults.length) {
      base = base * mults[col];
    }
    return Math.round(base);
  }
  function pieceValue(tier) {
    return pointsFor(tier, 2, 1);
  }

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function todayInIsrael() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
  }
  function formatDateHe(iso) {
    const parts = iso.split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }
  function msUntilNextIsraelMidnight() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = fmt.formatToParts(now).reduce(function(o,p){ o[p.type]=p.value; return o; }, {});
    const h = parseInt(parts.hour,10), m = parseInt(parts.minute,10), s = parseInt(parts.second,10);
    const elapsed = (h * 3600 + m * 60 + s) * 1000;
    return 24*3600*1000 - elapsed;
  }
  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }

  // ============ PER-GAME ID (used for ad-watch dedup) ============
  // Stable across refresh in the same tab (sessionStorage), regenerated when
  // a new game actually starts (init() with opts.fresh=true). The watch-ad
  // claim is tied to this id server-side, so a player who finishes a game and
  // F5-spams cannot claim multiple ad rewards for the same game. Server also
  // enforces a daily cap + 30s cooldown as a second line of defense.
  var GAME_ID_KEY = 'bloom_active_game_id';
  function _newGameIdString() {
    // 16 random bytes → base36 ~= 25 chars. Cheap, no crypto API dep.
    var s = 'g';
    for (var i = 0; i < 4; i++) {
      s += Math.floor(Math.random() * 0xFFFFFFFF).toString(36);
    }
    return s + Date.now().toString(36);
  }
  function getCurrentGameId() {
    try {
      var existing = sessionStorage.getItem(GAME_ID_KEY);
      if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    } catch (e) {}
    return regenerateGameId();
  }
  function regenerateGameId() {
    var id = _newGameIdString();
    try { sessionStorage.setItem(GAME_ID_KEY, id); } catch (e) {}
    return id;
  }
  // Did the current game already claim its ad reward? Persists across refresh
  // in the same tab so the button stays hidden until a new game starts.
  function adClaimedForCurrentGame() {
    try { return !!sessionStorage.getItem('bloom_ad_claimed_' + getCurrentGameId()); }
    catch (e) { return false; }
  }
  function markAdClaimedForCurrentGame() {
    try { sessionStorage.setItem('bloom_ad_claimed_' + getCurrentGameId(), '1'); }
    catch (e) {}
  }

  let grid, score, nextPiece, busy, highestTier, dropsCount;
  let mode = 'daily';
  let dailyDate = todayInIsrael();
  let rng = Math.random;
  let dailySubmitted = false;
  let dailyRank = null;
  let dailyTotal = null;
  let leaderboard = [];
  let leaderboardLoading = false;
  let countdownTimer = null;
  let best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  let prevBest = best;
  let playerName = localStorage.getItem(NAME_KEY) || '';

  // ============ FRIENDS CONTEST STATE ============
  const CONTEST_CODE_KEY = 'bloom_active_contest';
  const CONTEST_STATE_KEY = 'bloom_contest_game_state';        // legacy single-state key (kept for migration)
  const CONTEST_STATE_KEY_PREFIX = 'bloom_contest_state_';      // new per-contest scheme
  const CONTEST_STATE_TTL_MS = 24 * 60 * 60 * 1000;
  // Last final score we posted for this contest — used as the "score" we
  // show to the player we're now spectating, so they can see how far each
  // of their watchers got.
  const CONTEST_LAST_FINAL_PREFIX = 'bloom_contest_last_final_';
  function contestStateKey(code) { return CONTEST_STATE_KEY_PREFIX + code; }
  function getLastFinalScore(code) {
    if (!code) return 0;
    const raw = parseInt(localStorage.getItem(CONTEST_LAST_FINAL_PREFIX + code) || '0', 10);
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  function setLastFinalScore(code, value) {
    if (!code) return;
    try { localStorage.setItem(CONTEST_LAST_FINAL_PREFIX + code, String(Math.max(0, value | 0))); } catch (e) {}
  }
  let activeContestCode = localStorage.getItem(CONTEST_CODE_KEY) || null;
  let activeContestData = null;
  // Which contest the IN-MEMORY game state (grid/score/highestTier/nextPiece)
  // actually belongs to. Decoupled from `activeContestCode` so that switching
  // contests via the My Contests list does NOT cause the prior contest's
  // grid to be saved into the new contest's localStorage slot. Set to a
  // contest code when init('contest') restores/starts a game, cleared on
  // game-over or when leaving contest mode.
  let activeGameContestCode = null;
  let contestSubmitted = false;
  let contestRefreshTimer = null;
  let contestRefreshCode = null;
  let myContestsCache = null;        // last fetched /api/contests/mine result
  let myContestsCacheTs = 0;
  const MY_CONTESTS_CACHE_TTL_MS = 30 * 1000;  // refresh every 30s on demand

  // ============ LIVE CONTEST STATE (real-time score + spectators) ============
  // Demand-driven design: we only send the (heavier) grid frame when the
  // last server response said someone is actually watching. An idle contest
  // costs nothing beyond the existing 20s leaderboard poll.
  let liveScoreLastSentAt = 0;          // ms timestamp of last /live-score POST
  let liveScoreLastSentValue = -1;      // score value last sent (skip duplicates)
  let liveScoreFlushTimer = null;       // pending throttled flush
  let meHasWatchers = false;            // from /live-score response or leaderboard fetch
  let meWatchers = [];                  // [{name, lastScore}] — populated by leaderboard poll (every 20s)
  let meWatcherCount = 0;               // updated more frequently by /live-score response
  let audienceBadgeOpen = false;        // dropdown expanded?
  const LIVE_SCORE_MIN_INTERVAL_MS = 1000;
  let spectatorSession = null;          // { code, targetDeviceId, name, lastScore, pollTimer, heartbeatTimer, missCount, lastSnap }

  // ============ AVATAR ============
  // Stable per-deviceId emoji + color pair. The same player always gets the
  // same avatar across sessions; different players are visually distinct in
  // leaderboards even if their display names overlap. No PII, pure hash.
  const AVATAR_EMOJIS = [
    '🦁','🐯','🦊','🐺','🐻','🐼','🐰','🐹','🐮','🐷','🐸','🦉','🐢','🐬','🐙','🦋','🦄','🦖','🐳','🐝',
    '🌵','🌻','🌸','🌹','🍀','🍎','🍒','🍓','🥑','🍕','🌶','🌽','🥨','🍩','🌮','🍪','🌟','⚡','🔥','💎'
  ];
  const AVATAR_COLORS = [
    ['#FFE0B2', '#5D2E00'], ['#FFCDD2', '#5D1010'], ['#F8BBD0', '#5C1532'],
    ['#E1BEE7', '#3E1452'], ['#D1C4E9', '#23195C'], ['#C5CAE9', '#0F1B5C'],
    ['#BBDEFB', '#0D3D6D'], ['#B3E5FC', '#0F4A6D'], ['#B2EBF2', '#0E4F5C'],
    ['#B2DFDB', '#0F4F45'], ['#C8E6C9', '#194A1F'], ['#DCEDC8', '#324F11'],
    ['#FFF9C4', '#5C4A0E'], ['#FFE082', '#5C3D0E'], ['#FFCC80', '#5C2E0E']
  ];
  function avatarHash(deviceId) {
    let h = 2166136261 >>> 0;
    const s = String(deviceId || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function getAvatar(deviceId) {
    const h = avatarHash(deviceId);
    const emoji = AVATAR_EMOJIS[h % AVATAR_EMOJIS.length];
    const [bg, fg] = AVATAR_COLORS[(h >>> 8) % AVATAR_COLORS.length];
    return { emoji, bg, fg };
  }
  function renderAvatarHtml(deviceId, sizeClass) {
    const a = getAvatar(deviceId);
    return '<span class="avatar' + (sizeClass ? ' ' + sizeClass : '') +
      '" style="background:' + a.bg + ';color:' + a.fg + '">' + a.emoji + '</span>';
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
      else id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // ============ DEFAULT PLAYER NAME (1.2-mod, no upfront friction) ============
  // The UX audit calls out that asking for a name before the player has
  // experienced the game is the #1 drop-off. We now give every brand-new
  // player a stable, deterministic placeholder ("שחקן 4F2C") derived from
  // their deviceId so they can play immediately and *opt into* a real name
  // later — either via the ✏️ on the home pid, or the "קבע שם אמיתי" CTA
  // that appears on game-over while the name is still a default.
  function defaultPlayerName(devId) {
    var suffix = String(devId || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
    if (suffix.length < 4) suffix = (suffix + '0000').slice(0, 4);
    return 'שחקן ' + suffix;
  }
  // Anyone who actually picked a real name has it in localStorage. The
  // default is computed lazily and never persisted — that's how the rest
  // of the app distinguishes "still using the placeholder" from "this
  // player chose their name".
  function hasRealPlayerName() {
    return !!(localStorage.getItem(NAME_KEY) || '').trim();
  }
  if (!playerName) {
    playerName = defaultPlayerName(deviceId);
  }

  // ============ COUNTRY (for the country/world leaderboard tabs) ============
  // Player-chosen ISO-3166 alpha-2. Set once via the flag picker after the
  // name prompt, then sent with every score submission. Null = not chosen
  // (player skipped); those scores are excluded from the country tab.
  const COUNTRY_KEY = 'bloom_country';
  // Hebrew-labeled set covering ~95% of actual + plausible BLOOM players.
  // Add to the list rather than relying on locale APIs so the modal renders
  // identically on every browser (Safari iOS lacks Intl.DisplayNames in some
  // older builds, which would silently degrade to ISO codes).
  const COUNTRY_LIST = [
    ['IL', 'ישראל'], ['US', 'ארה״ב'], ['GB', 'בריטניה'], ['CA', 'קנדה'],
    ['DE', 'גרמניה'], ['FR', 'צרפת'], ['IT', 'איטליה'], ['ES', 'ספרד'],
    ['PT', 'פורטוגל'], ['NL', 'הולנד'], ['BE', 'בלגיה'], ['CH', 'שווייץ'],
    ['AT', 'אוסטריה'], ['SE', 'שוודיה'], ['NO', 'נורווגיה'], ['DK', 'דנמרק'],
    ['FI', 'פינלנד'], ['PL', 'פולין'], ['CZ', 'צ׳כיה'], ['HU', 'הונגריה'],
    ['RO', 'רומניה'], ['BG', 'בולגריה'], ['GR', 'יוון'], ['IE', 'אירלנד'],
    ['RU', 'רוסיה'], ['UA', 'אוקראינה'], ['TR', 'טורקיה'], ['EG', 'מצרים'],
    ['MA', 'מרוקו'], ['SA', 'ערב הסעודית'], ['AE', 'איחוד האמירויות'],
    ['JO', 'ירדן'], ['LB', 'לבנון'], ['ZA', 'דרום אפריקה'],
    ['AU', 'אוסטרליה'], ['NZ', 'ניו זילנד'], ['BR', 'ברזיל'],
    ['AR', 'ארגנטינה'], ['MX', 'מקסיקו'], ['CL', 'צ׳ילה'],
    ['JP', 'יפן'], ['KR', 'דרום קוריאה'], ['CN', 'סין'], ['HK', 'הונג קונג'],
    ['SG', 'סינגפור'], ['TH', 'תאילנד'], ['VN', 'וייטנאם'], ['ID', 'אינדונזיה'],
    ['PH', 'הפיליפינים'], ['MY', 'מלזיה'], ['IN', 'הודו'], ['PK', 'פקיסטן'],
    ['NG', 'ניגריה'], ['KE', 'קניה'], ['ET', 'אתיופיה']
  ];
  function countryName(cc) {
    if (!cc) return '';
    for (var i = 0; i < COUNTRY_LIST.length; i++) if (COUNTRY_LIST[i][0] === cc) return COUNTRY_LIST[i][1];
    return cc;
  }
  function flagEmoji(cc) {
    if (!cc || typeof cc !== 'string' || cc.length !== 2) return '🏳️';
    var s = cc.toUpperCase();
    try {
      return String.fromCodePoint(
        0x1F1E6 + (s.charCodeAt(0) - 65),
        0x1F1E6 + (s.charCodeAt(1) - 65)
      );
    } catch (e) { return '🏳️'; }
  }
  function getCountry() {
    var c = localStorage.getItem(COUNTRY_KEY) || '';
    return /^[A-Z]{2}$/.test(c) ? c : '';
  }
  function setCountry(cc) {
    var v = cc ? String(cc).toUpperCase().slice(0, 2) : '';
    if (v && !/^[A-Z]{2}$/.test(v)) v = '';
    try {
      if (v) localStorage.setItem(COUNTRY_KEY, v);
      else localStorage.removeItem(COUNTRY_KEY);
    } catch (e) {}
    // Fire-and-forget — server stores it on player_profiles so the v2
    // leaderboard can resolve the country tab even if the client forgets
    // to pass it explicitly later.
    try {
      fetch(API_BASE + '/api/profile/country', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken, country: v || null })
      }).catch(function() {});
    } catch (e) {}
  }
  var playerCountry = getCountry();

  // Device token — HMAC proof that this deviceId was registered server-side.
  // Fetched once, stored forever. Sent with score submissions for anti-spoofing.
  const DEVICE_TOKEN_KEY = 'bloom_device_token';
  let deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY) || null;
  function ensureDeviceToken() {
    if (deviceToken) return;
    fetch(API_BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    }).then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.token) {
          deviceToken = data.token;
          try { localStorage.setItem(DEVICE_TOKEN_KEY, data.token); } catch (e) {}
        }
      }).catch(function() {});
  }
  ensureDeviceToken();

  // apiPost — POST helper that always injects deviceId + token so every
  // state-mutating request lands at the server with a verifiable identity.
  // Existing call sites that build their own body remain valid (server's
  // softDeviceAuth rejects only present-and-invalid tokens), but new code
  // should prefer this helper. Pass {raw: true} to skip auto-injection.
  function apiPost(path, body, opts) {
    const o = opts || {};
    const fullBody = (o.raw === true)
      ? (body || {})
      : Object.assign({}, body || {}, { deviceId: deviceId, token: deviceToken });
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullBody)
    });
  }

  // ============ PLAYER CODE (BLOOM-XXXX) + REFERRALS ============
  const PLAYER_CODE_KEY = 'bloom_player_code';
  const PLAYER_BALANCE_KEY = 'bloom_balance';
  const PLAYER_XP_KEY = 'bloom_xp';
  const PLAYER_LEVEL_KEY = 'bloom_level';
  const PLAYER_LEVEL_TITLE_KEY = 'bloom_level_title';
  let playerCode = localStorage.getItem(PLAYER_CODE_KEY) || null;
  let playerBalance = parseInt(localStorage.getItem(PLAYER_BALANCE_KEY) || '0', 10) || 0;
  let playerXp = parseInt(localStorage.getItem(PLAYER_XP_KEY) || '0', 10) || 0;
  let playerLevel = parseInt(localStorage.getItem(PLAYER_LEVEL_KEY) || '1', 10) || 1;
  let playerLevelTitle = localStorage.getItem(PLAYER_LEVEL_TITLE_KEY) || 'מתחיל';

  var LEVEL_ICONS = { 1: '🌱', 2: '🌱', 3: '🌿', 5: '😊', 8: '🎮', 10: '🎮', 15: '⭐', 20: '⭐', 30: '🔥', 50: '👑', 100: '💎' };
  function getLevelIcon() {
    var icon = '🌱';
    for (var k in LEVEL_ICONS) { if (playerLevel >= parseInt(k, 10)) icon = LEVEL_ICONS[k]; }
    return icon;
  }

  function fetchPlayerCode() {
    fetch(API_BASE + '/api/player/code?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.code) {
          playerCode = d.code;
          playerBalance = d.balance | 0;
          if (d.xp != null) playerXp = d.xp | 0;
          if (d.level) {
            playerLevel = d.level.level || 1;
            playerLevelTitle = d.level.title || 'מתחיל';
          }
          try {
            localStorage.setItem(PLAYER_CODE_KEY, d.code);
            localStorage.setItem(PLAYER_BALANCE_KEY, String(d.balance | 0));
            localStorage.setItem(PLAYER_XP_KEY, String(playerXp));
            localStorage.setItem(PLAYER_LEVEL_KEY, String(playerLevel));
            localStorage.setItem(PLAYER_LEVEL_TITLE_KEY, playerLevelTitle);
          } catch(e) {}
          updateBalanceDisplay();
          processReferral();
        }
      }).catch(function() {});
  }
  function processReferral() {
    var refCode = new URLSearchParams(window.location.search).get('ref');
    if (!refCode || refCode === playerCode) return;
    if (localStorage.getItem('bloom_ref_done')) return; // already processed
    fetch(API_BASE + '/api/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken, refCode: refCode })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.ok) {
        localStorage.setItem('bloom_ref_done', '1');
        playerBalance += (d.referredReward || 0);
        try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      }
    }).catch(function() {});
  }
  fetchPlayerCode();

  // ============ SKINS — server-authoritative ownership ============
  // Server is now source of truth (player_skins table). localStorage is a
  // cache. On boot we do a one-time legacy migration: declare any skins
  // currently in localStorage (so legitimate buyers don't lose their
  // cosmetics), then sync down the server list. After the migration flag
  // is set, declare is never called again from this device.
  var SKINS_MIGRATED_KEY = 'bloom_skins_grace_done';
  function syncOwnedSkinsFromServer() {
    fetch(API_BASE + '/api/player/skins?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.ok) return;
        // classic is free for everyone — always present.
        var serverOwned = (data.skins || []).concat(['classic']);
        var merged = [];
        var seen = {};
        for (var i = 0; i < serverOwned.length; i++) {
          if (!seen[serverOwned[i]]) { merged.push(serverOwned[i]); seen[serverOwned[i]] = true; }
        }
        if (typeof ownedSkins !== 'undefined') {
          ownedSkins.length = 0;
          for (var j = 0; j < merged.length; j++) ownedSkins.push(merged[j]);
          try { localStorage.setItem('bloom_owned_skins', JSON.stringify(ownedSkins)); } catch (e) {}
          // If the currently-active skin isn't actually owned, fall back to classic.
          if (typeof activeSkinId !== 'undefined' && ownedSkins.indexOf(activeSkinId) === -1) {
            activeSkinId = 'classic';
            try { localStorage.setItem('bloom_active_skin', 'classic'); } catch (e) {}
            if (typeof buildTierBar === 'function') buildTierBar(true);
          }
        }
      })
      .catch(function() {});
  }
  function migrateOwnedSkinsOnce() {
    if (localStorage.getItem(SKINS_MIGRATED_KEY)) {
      syncOwnedSkinsFromServer();
      return;
    }
    var localOwned = [];
    try { localOwned = JSON.parse(localStorage.getItem('bloom_owned_skins') || '[]'); } catch (e) {}
    // Only the non-default ones are worth declaring — classic is free.
    var nonDefault = localOwned.filter(function(s) { return s && s !== 'classic'; });
    if (!nonDefault.length) {
      try { localStorage.setItem(SKINS_MIGRATED_KEY, '1'); } catch (e) {}
      syncOwnedSkinsFromServer();
      return;
    }
    apiPost('/api/player/skins/declare', { skins: nonDefault })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (d && d.ok) {
          try { localStorage.setItem(SKINS_MIGRATED_KEY, '1'); } catch (e) {}
        }
        syncOwnedSkinsFromServer();
      })
      .catch(function() { syncOwnedSkinsFromServer(); });
  }
  setTimeout(migrateOwnedSkinsOnce, 800);

  function getShareLink() {
    return window.location.origin + (playerCode ? '/?ref=' + playerCode : '');
  }
  var _earnedThisSession = {};
  function earnCredits(action, meta) {
    // Client-side session dedup — except event_gift which can fire multiple times
    if (action !== 'event_gift') {
      var dedupKey = action + (meta ? ':' + JSON.stringify(meta) : '');
      if (_earnedThisSession[dedupKey]) return;
      _earnedThisSession[dedupKey] = true;
    }
    fetch(API_BASE + '/api/player/earn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken, action: action, meta: meta || null })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.ok && d.reward > 0) {
        playerBalance = d.newBalance;
        try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
        showCreditToast(d.reward, action);
        // XP + Level
        if (d.xpGain) {
          playerXp = (d.level && d.level.xp) || (playerXp + d.xpGain);
          try { localStorage.setItem(PLAYER_XP_KEY, String(playerXp)); } catch(e) {}
        }
        if (d.level) {
          playerLevel = d.level.level || playerLevel;
          playerLevelTitle = d.level.title || playerLevelTitle;
          try { localStorage.setItem(PLAYER_LEVEL_KEY, String(playerLevel)); localStorage.setItem(PLAYER_LEVEL_TITLE_KEY, playerLevelTitle); } catch(e) {}
        }
        if (d.leveledUp) {
          showLevelUpToast(d.level);
        }
        updateBalanceDisplay();
      }
    }).catch(function() {});
  }
  function showLevelUpToast(level) {
    trackEvent('level_up', { level: level.level, title: level.title });
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.style.background = 'linear-gradient(135deg, #9B59B6, #6C3483)';
    t.style.color = '#FFF';
    t.innerHTML = '<span style="font-size:20px">🎉 רמה ' + (level.level || '') + '!</span><span style="font-size:12px">' + getLevelIcon() + ' ' + (level.title || '') + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 3500);
  }
  function showCreditToast(amount, action) {
    var labels = { daily_complete: 'אתגר יומי', daily_login: '🎁 בונוס יומי', streak_3: 'רצף 3 ימים!', streak_7: 'רצף 7 ימים!', streak_30: 'רצף 30 ימים!',
      contest_1st: 'מקום ראשון!', contest_2nd: 'מקום שני!', contest_3rd: 'מקום שלישי!', event_gift: '🎁 מתנה!', comeback: '👋 ברוך שובך!' };
    var label = labels[action] || '';
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.innerHTML = '<span>+' + amount + ' 💎</span>' + (label ? '<span style="font-size:11px;opacity:0.8">' + label + '</span>' : '');
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 2800);
  }

  // ============ FRIENDS CONTEST HELPERS ============
  function setActiveContest(code) {
    const prev = activeContestCode;
    activeContestCode = code || null;
    if (code) localStorage.setItem(CONTEST_CODE_KEY, code);
    else localStorage.removeItem(CONTEST_CODE_KEY);
    // CRITICAL: when the code changes, drop the cached activeContestData.
    // Otherwise init('contest') reads the OLD contest's board_seed and the
    // new contest's game gets the previous contest's piece sequence.
    if (prev !== activeContestCode) activeContestData = null;
    // The list of contests-I'm-in may have changed (joined/created/left)
    invalidateMyContestsCache();
  }

  function getPlayerName() {
    return localStorage.getItem(NAME_KEY) || '';
  }

  function setPlayerName(name) {
    if (name) localStorage.setItem(NAME_KEY, String(name).trim().slice(0, 50));
  }

  // Per-contest display names — a player may want different identities in
  // different contests ("סבא משה" at home, "המנהל" at the office). The
  // global name still acts as the default for new contests.
  const CONTEST_NAME_KEY_PREFIX = 'bloom_contest_name_';
  function getContestDisplayName(code) {
    if (!code) return getPlayerName();
    try {
      const name = localStorage.getItem(CONTEST_NAME_KEY_PREFIX + code);
      return (name && name.trim()) || getPlayerName();
    } catch (e) { return getPlayerName(); }
  }
  function setContestDisplayName(code, name) {
    if (!code || !name) return;
    try {
      localStorage.setItem(CONTEST_NAME_KEY_PREFIX + code, String(name).trim().slice(0, 50));
    } catch (e) {}
  }
  function clearContestDisplayName(code) {
    if (!code) return;
    try { localStorage.removeItem(CONTEST_NAME_KEY_PREFIX + code); } catch (e) {}
  }

  async function fetchMyContests(opts) {
    opts = opts || {};
    const fresh = !!opts.fresh;
    if (!fresh && myContestsCache && (Date.now() - myContestsCacheTs) < MY_CONTESTS_CACHE_TTL_MS) {
      return myContestsCache;
    }
    try {
      const url = API_BASE + '/api/contests/mine?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return myContestsCache;
      const data = await res.json();
      myContestsCache = (data && data.contests) || [];
      myContestsCacheTs = Date.now();
      return myContestsCache;
    } catch (e) {
      console.warn('fetchMyContests failed', e);
      return myContestsCache;
    }
  }
  function myContestsCountSync() {
    return myContestsCache ? myContestsCache.length : 0;
  }
  function invalidateMyContestsCache() {
    myContestsCache = null; myContestsCacheTs = 0;
  }

  async function fetchContest(code) {
    try {
      const url = API_BASE + '/api/contests/' + encodeURIComponent(code) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('fetchContest failed', e);
      return null;
    }
  }

  async function submitContestScore(code, scoreValue, tierValue) {
    try {
      const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(code) + '/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          token: deviceToken,
          displayName: getContestDisplayName(code) || 'אנונימי',
          score: scoreValue,
          tier: tierValue
        })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('submitContestScore failed', e);
      return null;
    }
  }

  function buildContestShareLink(code) {
    const origin = window.location.origin + window.location.pathname;
    return origin + '?c=' + encodeURIComponent(code);
  }

  function saveContestGameState() {
    // Save to the contest the IN-MEMORY game state actually belongs to —
    // NOT to whatever activeContestCode currently is. Otherwise switching
    // contests via the My Contests list (which mutates activeContestCode
    // without resetting the grid) would write the previous contest's mid-game
    // state into the new contest's localStorage slot.
    const targetCode = activeGameContestCode || activeContestCode;
    if (mode !== 'contest' || !targetCode || !grid) return;
    // Don't save a fresh board (nothing on it yet)
    const hasPiece = grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (!hasPiece && (score | 0) === 0) {
      clearContestGameState(targetCode);
      return;
    }
    try {
      localStorage.setItem(contestStateKey(targetCode), JSON.stringify({
        code: targetCode,
        grid: grid,
        score: score | 0,
        highestTier: highestTier | 0,
        nextPiece: nextPiece,
        maxChain: currentGameMaxChain | 0,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function loadContestGameState(code) {
    if (!code) return null;
    try {
      let raw = localStorage.getItem(contestStateKey(code));
      // Migration: prior versions used a single key for the (only) active contest's state
      if (!raw) {
        const legacy = localStorage.getItem(CONTEST_STATE_KEY);
        if (legacy) {
          try {
            const s = JSON.parse(legacy);
            if (s && s.code === code) {
              raw = legacy;
              localStorage.setItem(contestStateKey(code), legacy);
            }
          } catch (e) {}
          localStorage.removeItem(CONTEST_STATE_KEY);
        }
      }
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.code !== code) return null;
      if (Date.now() - (s.ts || 0) > CONTEST_STATE_TTL_MS) return null;
      if (!Array.isArray(s.grid) || s.grid.length !== getBoardRows()) return null;
      return s;
    } catch (e) { return null; }
  }
  function clearContestGameState(code) {
    const target = code || activeContestCode;
    try {
      if (target) localStorage.removeItem(contestStateKey(target));
      // Also wipe the legacy single key so it can't shadow a future load
      localStorage.removeItem(CONTEST_STATE_KEY);
    } catch (e) {}
  }

  // Used by the home-screen hero card to surface "you have a paused
  // game in contest X — tap to resume". Scans localStorage for every
  // saved contest state and returns the freshest one (or null). Also
  // garbage-collects entries that have expired the TTL or that point
  // to a contest the player has since left.
  function findPausedContestGame() {
    try {
      const all = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(CONTEST_STATE_KEY_PREFIX) !== 0) continue;
        let s;
        try { s = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { continue; }
        if (!s || !s.code || !Array.isArray(s.grid)) continue;
        if (Date.now() - (s.ts || 0) > CONTEST_STATE_TTL_MS) {
          // GC stale entries opportunistically — we're already iterating
          try { localStorage.removeItem(k); } catch (e) {}
          continue;
        }
        // Must have actual progress (a piece on the board OR a score > 0).
        const hasPiece = s.grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
        if (!hasPiece && (s.score | 0) === 0) continue;
        all.push(s);
      }
      if (!all.length) return null;
      all.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      // Best-effort: attach the contest name from cached list (if any)
      const top = all[0];
      try {
        const cache = JSON.parse(localStorage.getItem('bloom_my_contests_cache') || 'null');
        if (cache && Array.isArray(cache.list)) {
          const match = cache.list.find(function(c) { return c.code === top.code; });
          if (match && match.name) top.contestName = match.name;
        }
      } catch (e) {}
      return top;
    } catch (e) { return null; }
  }

  // ============ PRACTICE STATE SAVE/RESTORE ============
  // Mirrors the contest state pattern so switching tabs mid-game doesn't
  // lose the player's board. TTL: 1 hour (practice is low-stakes).
  const PRACTICE_STATE_KEY = 'bloom_practice_state';
  const PRACTICE_STATE_TTL_MS = 60 * 60 * 1000;

  function savePracticeGameState() {
    if (mode !== 'practice' || !grid || skinTrialMode) return;
    const hasPiece = grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (!hasPiece && (score | 0) === 0) { clearPracticeGameState(); return; }
    try {
      localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify({
        grid: grid,
        score: score | 0,
        highestTier: highestTier | 0,
        nextPiece: nextPiece,
        maxChain: currentGameMaxChain | 0,
        drops: dropsCount | 0,
        mergesPerTier: gameMergesPerTier,
        pointsPerTier: gamePointsPerTier,
        totalMerges: gameTotalMerges,
        startTime: gameStartTime,
        usedContinue: usedContinue,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function loadPracticeGameState() {
    try {
      const raw = localStorage.getItem(PRACTICE_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.grid) || s.grid.length !== getBoardRows()) return null;
      if (Date.now() - (s.ts || 0) > PRACTICE_STATE_TTL_MS) return null;
      return s;
    } catch (e) { return null; }
  }
  function clearPracticeGameState() {
    try { localStorage.removeItem(PRACTICE_STATE_KEY); } catch (e) {}
  }

  function formatTimeLeft(endsAt) {
    const ms = new Date(endsAt) - new Date();
    if (ms <= 0) return 'הסתיים';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return days + ' ימים';
    if (hours > 0) return hours + ' שעות';
    return 'פחות משעה';
  }

  // ================================================================
  // ONBOARDING COACH — 3 progressive toasts on a brand-new player's
  // first game. Each step persists in localStorage so it never repeats.
  // The toasts are pinned to grid-wrap, dismissable, auto-fade after 6s.
  // ================================================================

  function dismissCoach() {
    const t = document.querySelector('.coach-toast');
    if (t) t.remove();
    const a = document.querySelector('.coach-arrow');
    if (a) a.remove();
  }

  function showCoach(step, title, body, opts) {
    // Don't pile multiple toasts.
    dismissCoach();
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    opts = opts || {};
    const t = document.createElement('div');
    t.className = 'coach-toast';
    t.innerHTML =
      '<div class="coach-title">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>' +
        'BLOOM · שלב ' + step + ' מתוך 3' +
      '</div>' +
      escapeHtml(title) + '<br>' +
      '<span style="font-weight:500;color:#D6D5D1">' + escapeHtml(body) + '</span>' +
      (opts.dismiss !== false ? '<br><button class="coach-dismiss" id="coach-dismiss">הבנתי →</button>' : '');
    wrap.appendChild(t);
    const btn = document.getElementById('coach-dismiss');
    if (btn) btn.onclick = function() { dismissCoach(); };
    // Optional: a pointer arrow over a specific column.
    if (opts.arrowCol != null) {
      const arrow = document.createElement('div');
      arrow.className = 'coach-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22L4 12h5V2h6v10h5z"/></svg>';
      // Position over the chosen column (0-indexed, right-to-left since RTL but grid is LTR).
      // grid-wrap has padding 12px + 5px gap; each cell ~ (w - 24 - 15) / 4.
      const c = opts.arrowCol | 0;
      arrow.style.bottom = '24px';
      arrow.style.left   = 'calc(' + (12 + (c + 0.5) * 25) + '% - 18px)';
      // Use a CSS calc on percentage approximated via the grid columns.
      arrow.style.left = 'calc(12px + ' + ((c + 0.5) * 100 / 4) + '% - 18px - 12px)';
      wrap.appendChild(arrow);
    }
  }

  // Hooks called at key moments — they no-op if onboarding is already past.
  function maybeOnboardStep1() {
    if (getOnboardStep() >= 1) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    // Show after the grid renders. setTimeout makes it appear smoothly.
    setTimeout(function() {
      showCoach(1,
        'הקש על עמודה כדי להפיל את החלק',
        'החלק "הבא" (מסומן בסולם למעלה) ייפול לעמודה שתבחר.',
        { arrowCol: 1 });
      setOnboardStep(1);
    }, 350);
  }
  function maybeOnboardStep2() {
    if (getOnboardStep() >= 2) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    showCoach(2,
      'צרף 2 שווים → מיזוג + ניקוד',
      'אריחים אנכיים או אופקיים מאותו סוג מתמזגים לדרגה הבאה.');
    setOnboardStep(2);
  }
  function maybeOnboardStep3() {
    if (getOnboardStep() >= 3) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    showCoach(3,
      'יפה! שרשרת = ניקוד גבוה יותר',
      'מיזוג שגורר מיזוג נוסף = שרשרת. תוכל לשרשר 5? היעד: כתר 👑.');
    setOnboardStep(3);
  }

  // ================================================================
  // BLOOM CHALLENGES (state + fetch helpers + screens)
  // ================================================================
  // Public single-shot prize contests. Distinct from Friends Contests in that:
  // - One attempt per device per challenge (server-enforced via PK).
  // - No reset, no pause, no game-state save. Closing the tab = forfeit.
  // - Score posts to /score on every drop; the server's score-only-grows
  //   guard means a closed tab still has a meaningful final score.

  let challengesCache = null;          // most recent /api/challenges payload
  let challengesCacheTs = 0;
  const CHALLENGES_CACHE_TTL_MS = 30 * 1000;
  let activeChallenge = null;          // { slug, name, prizeText, thresholdScore, thresholdTier, type, winnersCount, isWinner, winnerRank, drops }
  const CHALLENGE_DROPS_KEY_PREFIX = 'bloom_challenge_drops_';

  function challengeDropsKey(slug) { return CHALLENGE_DROPS_KEY_PREFIX + slug; }
  function readChallengeDrops(slug) {
    try { return parseInt(localStorage.getItem(challengeDropsKey(slug)) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function writeChallengeDrops(slug, n) {
    try { localStorage.setItem(challengeDropsKey(slug), String(n | 0)); } catch (e) {}
  }
  function clearChallengeDrops(slug) {
    try { localStorage.removeItem(challengeDropsKey(slug)); } catch (e) {}
  }

  async function fetchChallenges(opts) {
    opts = opts || {};
    if (!opts.fresh && challengesCache && (Date.now() - challengesCacheTs) < CHALLENGES_CACHE_TTL_MS) {
      return challengesCache;
    }
    try {
      const url = API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return challengesCache;
      const data = await res.json();
      challengesCache = (data && data.challenges) || [];
      challengesCacheTs = Date.now();
      return challengesCache;
    } catch (e) { return challengesCache; }
  }

  async function fetchChallenge(slug) {
    try {
      const url = API_BASE + '/api/challenges/' + encodeURIComponent(slug) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function challengeTypeLabel(c) {
    const t = c.challengeType;
    if (t === 'race')          return 'מרוץ ל-' + (c.thresholdScore || 0).toLocaleString();
    if (t === 'top_n')         return 'Top ' + (c.winnersCount || 1);
    if (t === 'beat')          return 'עבור ' + (c.thresholdScore || 0).toLocaleString();
    if (t === 'first_to_tier' && getActiveTiers()[c.thresholdTier|0]) return 'ראשון ל-' + getActiveTiers()[c.thresholdTier|0].name;
    if (t === 'first_to_tier') return 'ראשון לדרגה ' + (c.thresholdTier || '?');
    return t;
  }

  function challengeTimeLeft(endsAt) {
    const ms = new Date(endsAt) - new Date();
    if (ms <= 0) return 'הסתיים';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return days + ' ימים';
    if (hours > 0) return hours + ' שעות';
    if (minutes > 0) return minutes + ' דקות';
    return 'פחות מדקה';
  }

  // Personal-stats chip — visible only if the returning player has played
  // at least one game. Pulls from localStorage lifetime values + best score.
  function refreshHomeMyStats() {
    const host = document.getElementById('home-mystats-host');
    if (host) host.innerHTML = ''; // keep home clean
    const bubble = document.getElementById('home-stats-bubble');
    if (!bubble) return;
    const bestScore  = parseInt(localStorage.getItem(BEST_KEY)        || '0', 10) || 0;
    const bestTier   = parseInt(localStorage.getItem(BEST_TIER_KEY)   || '0', 10) || 0;
    const totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    if (bestScore <= 0 && totalGames <= 0) { bubble.innerHTML = ''; return; }
    const playerNm = (getPlayerName() || '').trim();
    const tierName = (getActiveTiers()[bestTier] && getActiveTiers()[bestTier].name) || '—';

    var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY);
    if (totalMs < 60000 && totalGames > 0) {
      totalMs = totalGames * 180000;
      try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
    }
    var h = Math.floor(totalMs / 3600000);
    var m = Math.floor((totalMs % 3600000) / 60000);
    var timeText = totalMs >= 60000 ? (h > 0 ? h + ' שעות ו-' + m + ' דק\'' : m + ' דקות') : '';
    var level = playerLevel > 1 ? getLevelIcon() + ' Lv.' + playerLevel + ' ' + playerLevelTitle : '';

    bubble.innerHTML =
      '<div class="hsb-arrow"></div>' +
      '<div class="hsb-header">' +
        renderAvatarHtml(deviceId, 'sm') +
        '<strong>' + (playerNm ? escapeHtml(playerNm) : 'שחקן') + '</strong>' +
        (level ? '<span class="hsb-level">' + level + '</span>' : '') +
      '</div>' +
      (playerCode ? '<div class="hsb-code">' + playerCode + (playerBalance > 0 ? ' · <span class="hsb-balance">' + playerBalance + ' 💎</span>' : '') + '</div>' : '') +
      '<div class="hsb-grid">' +
        '<div class="hsb-cell"><div class="hsb-val">' + bestScore.toLocaleString() + '</div><div class="hsb-lbl">🏆 שיא</div></div>' +
        '<div class="hsb-cell"><div class="hsb-val">' + escapeHtml(tierName) + '</div><div class="hsb-lbl">דרגה</div></div>' +
        '<div class="hsb-cell"><div class="hsb-val">' + totalGames + '</div><div class="hsb-lbl">משחקים</div></div>' +
        (timeText ? '<div class="hsb-cell"><div class="hsb-val">' + timeText + '</div><div class="hsb-lbl">🕐 זמן</div></div>' : '') +
      '</div>' +
      '<button class="hsb-share" id="hsb-share-btn">📤 שתף את הפרופיל</button>' +
      (playerCode ? '<a href="/player/' + playerCode + '" target="_blank" style="display:block;text-align:center;font-size:11px;color:#6F6E68;margin-top:6px;text-decoration:underline">צפה בפרופיל הציבורי</a>' : '');

    document.getElementById('hsb-share-btn').onclick = function(e) {
      e.stopPropagation();
      var text = '🌸 BLOOM — ' + (playerNm || 'שחקן') + '\n' +
        '🏆 שיא: ' + bestScore.toLocaleString() + ' · ' + tierName + '\n' +
        '🎮 ' + totalGames + ' משחקים' + (timeText ? ' · 🕐 ' + timeText : '') + '\n' +
        (level ? level + '\n' : '') +
        '\nשחק גם: ' + getShareLink();
      if (navigator.share) navigator.share({ text: text }).catch(function(){});
      else if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        this.textContent = '✓ הועתק!';
        var btn = this;
        setTimeout(function() { btn.textContent = '📤 שתף את הפרופיל'; }, 1500);
      }
    };
  }

  // Social-proof line under the primary CTA. Pulls from the existing
  // /api/leaderboard/:date endpoint — one extra GET per home-visit.
  async function refreshHomeSocialProof() {
    const el = document.getElementById('home-social');
    if (!el) return;
    try {
      const res = await fetch(API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate));
      if (!res.ok) return;
      const data = await res.json();
      const total = (data && data.total) | 0;
      const list = (data && data.list) || [];
      if (total === 0) {
        el.innerHTML = '<span class="live-dot"></span> אתה הראשון היום — תהיה בראש הלוח';
      } else {
        var medals = ['🥇','🥈','🥉'];
        var html = '<span class="live-dot"></span> ' + '<strong>' + total + '</strong> שיחקו היום';
        if (list.length > 0) {
          html += '<div class="home-mini-lb">';
          for (var i = 0; i < Math.min(3, list.length); i++) {
            var p = list[i];
            var isMe = p.device_id === deviceId;
            html += '<div class="mini-lb-row' + (isMe ? ' mini-lb-me' : '') + '">' +
              '<span class="mini-lb-medal">' + medals[i] + '</span>' +
              '<span class="mini-lb-name">' + escapeHtml(p.name || 'אנונימי') + '</span>' +
              '<span class="mini-lb-score">' + (p.score | 0).toLocaleString() + '</span>' +
            '</div>';
          }
          html += '</div>';
        }
        el.innerHTML = html;
      }
    } catch (e) {}
  }

  async function refreshHomeJackpot() {
    var el = document.getElementById('home-jackpot');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/jackpot/today');
      var d = await r.json();
      if (!d || !d.enabled || (d.pool | 0) === 0) { el.innerHTML = ''; return; }
      el.innerHTML = '🎰 קופת הג\'קפוט היומי: <span class="jp-pool">' + (d.pool | 0) + ' 💎</span>' +
        '<br><span style="font-size:11px;font-weight:400">' + (d.entries | 0) + ' משתתפים · הזוכים מקבלים בחצות</span>';
    } catch (e) { el.innerHTML = ''; }
  }

  // ── Daily Login Reward ──
  var DAILY_LOGIN_KEY = 'bloom_daily_login';

  function getDailyLoginState() {
    try {
      var raw = localStorage.getItem(DAILY_LOGIN_KEY);
      if (!raw) return { lastClaimed: null, claimed: false };
      return JSON.parse(raw);
    } catch (e) { return { lastClaimed: null, claimed: false }; }
  }

  function hasDailyLoginReward() {
    var state = getDailyLoginState();
    var today = todayInIsrael();
    return state.lastClaimed !== today;
  }

  function getDailyRewardAmount(streakDay) {
    // Escalating visual display — actual server reward is from game_config
    if (streakDay >= 30) return 200;
    if (streakDay >= 7) return 100;
    if (streakDay >= 3) return 50;
    return 25;
  }

  function showDailyLoginReward() {
    if (!hasDailyLoginReward()) return;
    if (document.getElementById('daily-reward-overlay')) return;
    // Don't show to brand new players (no games played yet)
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    if (totalGames === 0) return;

    var s = loadStreak();
    var today = todayInIsrael();
    var streakN = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakN = 0;
    // If they played today already, streak was bumped; if not, show what it WILL be
    var displayStreak = streakN > 0 ? streakN : 1;
    var displayReward = getDailyRewardAmount(displayStreak);

    var emoji = displayStreak >= 7 ? '🎉' : displayStreak >= 3 ? '🔥' : '🎁';
    var streakMsg = displayStreak >= 7 ? 'שבוע שלם ברצף! 💪'
      : displayStreak >= 3 ? displayStreak + ' ימים ברצף!'
      : displayStreak > 1 ? 'יום ' + displayStreak + ' ברצף'
      : 'ברוך שובך!';

    var tomorrowReward = getDailyRewardAmount(displayStreak + 1);
    var tomorrowExtra = tomorrowReward > displayReward ? ' (x' + Math.round(tomorrowReward / 25) + '!)' : '';

    // The server now applies tiered config keyed by streak (see
    // /api/player/earn for action='daily_login'). gameConfig is fetched at
    // boot, so we can pick the matching key locally without a round trip.
    // Final number on the slot reel = max(display tier, server tier) so a
    // generous admin tweak surfaces in the UI and a misconfig can never
    // undercut what the overlay teased.
    var resolvedReward = displayReward;
    try {
      if (typeof gameConfig === 'object' && gameConfig) {
        var srvKey = displayStreak >= 30 ? 'daily_login_reward_streak_30'
                   : displayStreak >= 7  ? 'daily_login_reward_streak_7'
                   : displayStreak >= 3  ? 'daily_login_reward_streak_3'
                   : 'daily_login_reward';
        var srvVal = parseInt(gameConfig[srvKey], 10) || 0;
        if (srvVal > 0) resolvedReward = Math.max(displayReward, srvVal);
      }
    } catch (e) {}

    var overlay = document.createElement('div');
    overlay.id = 'daily-reward-overlay';
    overlay.className = 'daily-reward-overlay';
    overlay.innerHTML =
      '<div class="daily-reward-card">' +
        '<button class="dr-close" id="dr-close">✕</button>' +
        '<div class="dr-emoji">' + emoji + '</div>' +
        '<div class="dr-title">בונוס יומי!</div>' +
        '<div class="dr-streak"><strong>' + streakMsg + '</strong></div>' +
        // §1.7 — Variable-reward slot animation. The actual payout is
        // deterministic (rises with streak length), but the *experience*
        // of seeing the number spin and land turns a flat "+25💎" into
        // an event. The reel starts blurred and fast, decelerates over
        // ~1.4s, and snaps to the true reward with a soundMilestone +
        // scale-up landing animation.
        '<div class="dr-reward dr-reward-spinning" id="dr-reward-num">+??? 💎</div>' +
        '<button class="dr-claim-btn" id="dr-claim">אסוף בונוס</button>' +
        '<div class="dr-tomorrow">חזור מחר ל-<strong>' + tomorrowReward + ' 💎' + tomorrowExtra + '</strong></div>' +
      '</div>';
    document.body.appendChild(overlay);

    // §1.7 reel: cycle random values, slowing down with each iteration,
    // then snap to the real reward.
    (function runRewardReel() {
      var el = document.getElementById('dr-reward-num');
      if (!el) return;
      var ticks = 0;
      var maxTicks = 22;
      var delay = 50;
      // Sample values straddle the real reward so the reel doesn't
      // visually contradict the outcome.
      var low  = Math.max(5,  Math.floor(resolvedReward * 0.4));
      var high = Math.max(50, Math.floor(resolvedReward * 2.2));
      function tick() {
        if (!document.getElementById('dr-reward-num')) return;
        ticks++;
        if (ticks >= maxTicks) {
          el.textContent = '+' + resolvedReward + ' 💎';
          el.classList.remove('dr-reward-spinning');
          el.classList.add('dr-reward-landed');
          try { if (typeof soundMilestone === 'function') soundMilestone(Math.min(8, 3 + Math.floor(displayStreak / 3))); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([10, 30, 10]); } catch (e) {}
          return;
        }
        var fake = low + Math.floor(Math.random() * (high - low));
        el.textContent = '+' + fake + ' 💎';
        // Ease-out: each tick gets a bit slower
        delay = Math.min(180, delay + (ticks > maxTicks - 8 ? 18 : 4));
        setTimeout(tick, delay);
      }
      // Tiny initial delay so the overlay finishes its entrance animation
      // before the reel starts spinning.
      setTimeout(tick, 220);
    })();

    var claimed = false;
    function claim() {
      if (claimed) return;
      claimed = true;
      // Mark as claimed for today
      try { localStorage.setItem(DAILY_LOGIN_KEY, JSON.stringify({ lastClaimed: todayInIsrael() })); } catch(e) {}
      // Earn credits via server. Streak passes through so the server picks
      // the matching tier — without it, the wallet got the flat base
      // amount even though the overlay teased the streak-tiered number.
      earnCredits('daily_login', { streak: displayStreak });
      // Animate out
      var card = overlay.querySelector('.daily-reward-card');
      if (card) {
        card.style.transition = 'transform 0.3s, opacity 0.3s';
        card.style.transform = 'scale(1.1)';
        card.style.opacity = '0';
      }
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(function() {
        overlay.style.opacity = '0';
        setTimeout(function() { overlay.remove(); }, 300);
      }, 200);
      trackEvent('daily_login_claimed', { streak: displayStreak, reward: resolvedReward });
    }

    document.getElementById('dr-claim').onclick = claim;
    document.getElementById('dr-close').onclick = function() {
      // Closing without claiming = still claim (they saw it)
      claim();
    };
    overlay.onclick = function(e) {
      if (e.target === overlay) claim();
    };
  }

  // ── Home: Streak hero badge ──
  function refreshHomeStreak() {
    var host = document.getElementById('home-streak-host');
    if (!host) return;
    var s = loadStreak();
    var today = todayInIsrael();
    var n = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) n = 0;
    var bestStreak = parseInt(localStorage.getItem(BEST_STREAK_KEY) || '0', 10) || 0;
    if (n === 0 && bestStreak === 0) {
      host.innerHTML =
        '<div class="home-streak zero">' +
          '<span class="streak-fire">🔥</span>' +
          '<span class="streak-num">0</span>' +
          '<div class="streak-label">שחק היום ותתחיל <strong>רצף יומי!</strong></div>' +
        '</div>';
    } else if (n === 0) {
      host.innerHTML =
        '<div class="home-streak zero">' +
          '<span class="streak-fire">💔</span>' +
          '<span class="streak-num">0</span>' +
          '<div class="streak-label">הרצף נשבר! שיא: <strong>' + bestStreak + ' ימים</strong><br>שחק עכשיו להתחיל מחדש</div>' +
        '</div>';
    } else {
      var msg = n >= 30 ? '🏆 אלוף!' : n >= 7 ? '💪 שבוע שלם!' : n >= 3 ? '🔥 ממשיכים!' : 'חזור מחר!';
      host.innerHTML =
        '<div class="home-streak">' +
          '<span class="streak-fire">🔥</span>' +
          '<span class="streak-num">' + n + '</span>' +
          '<div class="streak-label"><strong>' + n + ' ימים ברצף</strong><br>' + msg + '</div>' +
        '</div>';
    }
  }

  // ── Home: Mini leaderboard — shows player rank if not in top 3 ──
  // The top-3 is already shown by refreshHomeSocialProof. This adds the
  // player's own rank row when they're ranked 4th or lower.
  async function refreshHomeMiniLb() {
    var host = document.getElementById('home-mini-lb-host');
    if (!host) return;
    try {
      var res = await fetch(API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate) + '?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) return;
      var data = await res.json();
      var myRank = data.rank | 0;
      if (myRank <= 3 || myRank === 0) { host.innerHTML = ''; return; }
      var list = (data && data.list) || [];
      var myEntry = list.find(function(p) { return p.device_id === deviceId; });
      if (!myEntry) { host.innerHTML = ''; return; }
      host.innerHTML =
        '<div class="home-mini-lb">' +
          '<div class="home-mini-lb-row me">' +
            '<span class="home-mini-lb-rank" style="color:#6F6E68">#' + myRank + '</span>' +
            '<span class="home-mini-lb-name">' + escapeHtml(myEntry.name || 'אנונימי') + ' (את/ה)</span>' +
            '<span class="home-mini-lb-score">' + (myEntry.score | 0).toLocaleString() + '</span>' +
          '</div>' +
        '</div>';
    } catch (e) {}
  }

  // ── Home: Addiction badge (total play time) ──
  function refreshHomeAddiction() {
    var host = document.getElementById('home-addiction-host');
    if (!host) return;
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    if (totalMs < 60000) { host.innerHTML = ''; return; }
    var totalHours = Math.floor(totalMs / 3600000);
    var totalMins = Math.floor((totalMs % 3600000) / 60000);
    var emoji, text;
    if (totalHours >= 10) { emoji = '🤯'; text = 'שיחקת <strong>' + totalHours + ' שעות ו-' + totalMins + ' דקות</strong> ב-BLOOM. אין עליך!'; }
    else if (totalHours >= 1) { emoji = '⏰'; text = 'כבר <strong>' + totalHours + ' שעות ו-' + totalMins + ' דקות</strong> ב-BLOOM!'; }
    else { emoji = '🕐'; text = '<strong>' + totalMins + ' דקות</strong> ב-BLOOM עד עכשיו'; }
    host.innerHTML =
      '<div class="home-addiction">' +
        '<span class="addiction-emoji">' + emoji + '</span>' +
        '<span>' + text + '</span>' +
      '</div>' +
      '<div class="home-addiction-share-row">' +
        '<button class="home-addiction-share-btn" id="home-addiction-share">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5L15.4 17.5M15.4 6.5L8.6 10.5"/></svg>' +
          'שתף התמכרות' +
        '</button>' +
        '<button class="home-addiction-share-btn home-addiction-share-wa" id="home-addiction-share-wa">' +
          '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
          'WhatsApp' +
        '</button>' +
      '</div>';
    var shareBtn = document.getElementById('home-addiction-share');
    if (shareBtn) shareBtn.onclick = function() { shareAddiction('share'); };
    var waBtn = document.getElementById('home-addiction-share-wa');
    if (waBtn) waBtn.onclick = function() { shareAddiction('whatsapp'); };
  }

  // ── Home: Weekly Challenge Banner ──
  async function refreshHomeWeekly() {
    var host = document.getElementById('home-weekly-host');
    if (!host) return;
    try {
      var res = await fetch(API_BASE + '/api/weekly?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) { host.innerHTML = ''; return; }
      var data = await res.json();
      if (!data || !data.weekly) { host.innerHTML = ''; return; }
      var w = data.weekly;
      var endsAt = new Date(w.endsAt);
      var now = new Date();
      var hoursLeft = Math.max(0, Math.round((endsAt - now) / 3600000));
      var timeLeft = hoursLeft >= 24 ? Math.ceil(hoursLeft / 24) + ' ימים' : hoursLeft + ' שעות';
      var statusText = w.joined
        ? 'הציון שלך: <strong>' + (w.myScore | 0).toLocaleString() + '</strong> · ' + (w.myGames || 0) + ' משחקים'
        : (w.players || 0) > 0
          ? '<strong>' + (w.players || 0) + '</strong> משתתפים · הצטרף עכשיו!'
          : 'היה הראשון להצטרף! 🏅';

      host.innerHTML =
        '<div class="home-weekly" id="home-weekly-btn">' +
          '<div class="home-weekly-title">🏆 ' + escapeHtml(w.name) + '</div>' +
          '<div class="home-weekly-prize">פרס: ' + (w.prize || 500) + ' 💎 · נגמר בעוד ' + timeLeft + '</div>' +
          '<div class="home-weekly-meta">' + statusText + '</div>' +
          '<span class="home-weekly-arrow">←</span>' +
        '</div>';

      var btn = document.getElementById('home-weekly-btn');
      if (btn) btn.onclick = function() {
        ensureAudio();
        if (mode === 'practice') savePracticeGameState();
        // Navigate to the weekly contest
        activeContestCode = w.code;
        try { localStorage.setItem('bloom_active_contest', w.code); } catch(e) {}
        hideHome();
        showContestLeaderboard(w.code);
      };
    } catch (e) { host.innerHTML = ''; }
  }

  function refreshHomeChallengeCta() {
    const btn = document.getElementById('home-challenge');
    if (!btn) return;
    fetchChallenges().then(function(list) {
      if (!list || !list.length) { btn.classList.remove('visible'); return; }
      btn.classList.add('visible');
      const lbl = document.getElementById('home-challenge-label');
      if (lbl) lbl.textContent = list.length === 1
        ? 'אתגר פרס פעיל — ' + list[0].prizeText
        : list.length + ' אתגרי פרס פעילים';
      btn.onclick = function() {
        ensureAudio();
        if (mode === 'practice') savePracticeGameState();
        showChallengesList('home');
      };
    });
  }

  function hideChallengeScreens() {
    const el = document.getElementById('challenge-screen');
    if (el) el.remove();
  }

  // Tracks where the user came from before opening the challenges hub, so the
  // back button routes intelligently: from the home screen → back home; from
  // a mid-game mode-tap → back into the game; from a contest screen → back
  // there. Set by EVERY entry point into showChallengesList().
  let challengeListEntryFrom = 'home';
  // Tabs state for the challenges hub.
  let challengeListTab = 'active';   // 'active' | 'history'
  let historyChallengesCache = null;
  let historyChallengesCacheTs = 0;
  const HISTORY_CACHE_TTL_MS = 60 * 1000;

  async function fetchHistoryChallenges(opts) {
    opts = opts || {};
    if (!opts.fresh && historyChallengesCache && (Date.now() - historyChallengesCacheTs) < HISTORY_CACHE_TTL_MS) {
      return historyChallengesCache;
    }
    try {
      const res = await fetch(API_BASE + '/api/challenges/history?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) return historyChallengesCache;
      const data = await res.json();
      historyChallengesCache = (data && data.challenges) || [];
      historyChallengesCacheTs = Date.now();
      return historyChallengesCache;
    } catch (e) { return historyChallengesCache; }
  }

  function navigateBackFromChallenges() {
    hideChallengeScreens();
    if (challengeListEntryFrom === 'in-game') {
      // The player tapped the "אתגרים" mode tab from inside a game — go back
      // to the appropriate game screen for the current mode.
      if (mode === 'contest' && activeContestCode) {
        // Resume their saved contest game state.
        init('contest');
      } else if (mode === 'daily' || mode === 'practice') {
        init(mode);
      } else {
        showHome();
      }
    } else if (challengeListEntryFrom === 'contest-screen') {
      if (activeContestCode) showContestLeaderboard(activeContestCode);
      else showContestMenu();
    } else {
      showHome();
    }
  }

  async function showChallengesList(entryFrom) {
    if (entryFrom) challengeListEntryFrom = entryFrom;
    const app = document.querySelector('.app');
    if (!app) return;
    hideHome();
    hideContestScreens();
    hideChallengeScreens();
    const screen = document.createElement('div');
    screen.id = 'challenge-screen';
    screen.className = 'contest-screen';
    screen.innerHTML =
      createBackButton('challenges') +
      '<div class="contest-title">אתגרי BLOOM</div>' +
      '<div class="contest-sub">ניסיון אחד. פרס אמיתי.</div>' +
      '<div class="lb-tabs" id="cl-tabs" style="max-width:340px;margin:8px auto 4px">' +
        '<button class="lb-tab' + (challengeListTab === 'active' ? ' active' : '') + '" data-tab="active">פעילים</button>' +
        '<button class="lb-tab' + (challengeListTab === 'history' ? ' active' : '') + '" data-tab="history">היסטוריה</button>' +
      '</div>' +
      '<div class="challenge-list" id="challenge-list"><div class="contest-loading">טוען…</div></div>';
    app.appendChild(screen);
    document.querySelectorAll('#cl-tabs .lb-tab').forEach(function(b) {
      b.onclick = function() {
        const tab = b.getAttribute('data-tab');
        if (tab === challengeListTab) return;
        challengeListTab = tab;
        document.querySelectorAll('#cl-tabs .lb-tab').forEach(function(x) { x.classList.toggle('active', x === b); });
        renderChallengeListBody();
      };
    });
    renderChallengeListBody();
  }

  async function renderChallengeListBody() {
    const host = document.getElementById('challenge-list');
    if (!host) return;
    host.innerHTML = '<div class="contest-loading">טוען…</div>';
    let list;
    if (challengeListTab === 'history') {
      list = await fetchHistoryChallenges({ fresh: true });
    } else {
      list = await fetchChallenges({ fresh: true });
    }
    if (!host.isConnected) return;  // user navigated away mid-fetch
    if (!list || !list.length) {
      host.innerHTML = '<div class="contest-board-empty">' +
        (challengeListTab === 'history' ? 'אין עדיין אתגרים שהסתיימו' : 'אין אתגרים פעילים כרגע. נסה מחר.') +
        '</div>';
      return;
    }
    host.innerHTML = list.map(function(c) {
      const entered = !!c.myEntry;
      const winnersFilled = c.winnersFilled | 0;
      const isHistory = challengeListTab === 'history';
      const meta = entered
        ? (c.myEntry.is_winner ? '👑 זכית · מקום ' + c.myEntry.winner_rank : '✓ השתתפת · ' + (c.myEntry.score | 0).toLocaleString() + ' נק׳')
        : (winnersFilled > 0 ? winnersFilled + '/' + c.winnersCount + ' זוכים כבר נסגרו' : c.entriesCount + ' משתתפים');
      const rightSide = isHistory
        ? 'הסתיים <strong>' + escapeHtml(formatRelativeTime(c.endsAt) || fmtEndsDate(c.endsAt)) + '</strong>'
        : 'נותרו <strong>' + escapeHtml(challengeTimeLeft(c.endsAt)) + '</strong>';
      // Top winners line (history only): show the names of who won.
      let winnersLine = '';
      if (isHistory && c.topWinners && c.topWinners.length) {
        const txt = c.topWinners.map(function(w) {
          return '👑 ' + escapeHtml(w.name) + ' (' + (w.score | 0).toLocaleString() + ')';
        }).join(' · ');
        winnersLine = '<div class="challenge-card-desc" style="color:#BA7517;font-weight:600;margin-top:4px">' + txt + '</div>';
      } else if (isHistory) {
        winnersLine = '<div class="challenge-card-desc" style="font-style:italic">לא נקבעו זוכים</div>';
      }
      return '<button class="challenge-card' + (entered ? ' entered' : '') + (isHistory ? ' ended' : '') + '" data-slug="' + escapeHtml(c.slug) + '">' +
        '<div class="challenge-card-top">' +
          '<div class="challenge-card-name">' + escapeHtml(c.name) + '</div>' +
          '<div class="challenge-card-prize">🎁 ' + escapeHtml(c.prizeText) + '</div>' +
        '</div>' +
        (c.description ? '<div class="challenge-card-desc">' + escapeHtml(c.description) + '</div>' : '') +
        winnersLine +
        '<div class="challenge-card-meta">' +
          '<div><span class="challenge-type-pill">' + escapeHtml(challengeTypeLabel(c)) + '</span>' + escapeHtml(meta) + '</div>' +
          '<div>' + rightSide + '</div>' +
        '</div>' +
      '</button>';
    }).join('');
    host.querySelectorAll('.challenge-card').forEach(function(b) {
      b.onclick = function() { showChallengeDetail(b.getAttribute('data-slug')); };
    });
  }
  function fmtEndsDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('he-IL'); } catch (e) { return iso; }
  }

  async function showChallengeDetail(slug) {
    const app = document.querySelector('.app');
    if (!app) return;
    hideHome();
    hideContestScreens();
    hideChallengeScreens();
    const screen = document.createElement('div');
    screen.id = 'challenge-screen';
    screen.className = 'contest-screen';
    screen.innerHTML =
      createBackButton('challenges-list') +
      '<div class="contest-loading">טוען…</div>';
    app.appendChild(screen);
    const data = await fetchChallenge(slug);
    if (!data || !data.challenge) {
      screen.innerHTML =
        createBackButton('challenges-list') +
        '<div class="contest-title" style="margin-top:60px">לא נמצא אתגר</div>';
      return;
    }
    const c = data.challenge;
    const myEntry = c.myEntry;
    const entered = !!myEntry;
    const inProgress = entered && myEntry.status === 'in_progress';
    const completed  = entered && myEntry.status === 'completed';
    const isWinner   = entered && myEntry.is_winner;
    const winnersFull = (c.winnersFilled | 0) >= (c.winnersCount | 0) && c.challengeType !== 'top_n' && c.challengeType !== 'beat';
    const standingsHtml = (data.standings || []).slice(0, 10).map(function(s, i) {
      const rank = s.winner_rank ? s.winner_rank : (i + 1);
      return '<div class="challenge-standings-row' + (s.is_winner ? ' winner' : '') + '">' +
        '<div class="challenge-standings-rank">' + (s.is_winner ? '<span class="challenge-crown">👑</span>' : rank) + '</div>' +
        '<div class="challenge-standings-name">' + renderAvatarHtml(s.display_name, 'sm') + escapeHtml(s.display_name) + '</div>' +
        '<div class="challenge-standings-score">' + (s.score | 0).toLocaleString() + '</div>' +
      '</div>';
    }).join('');
    const prizeImg = c.prizeImageUrl
      ? '<img src="' + escapeHtml(c.prizeImageUrl) + '" alt="' + escapeHtml(c.prizeText) + '" onerror="this.style.display=\'none\'">'
      : '';
    let actionHtml;
    if (winnersFull && !isWinner) {
      actionHtml = '<button class="btn" disabled style="opacity:0.5">כל הזוכים נסגרו</button>';
    } else if (isWinner) {
      actionHtml = '<button class="btn" id="chal-claim">👑 השאר פרטים לקבלת הפרס</button>';
    } else if (completed) {
      actionHtml = '<button class="btn secondary" disabled>כבר השתתפת — ניקוד ' + (myEntry.score | 0).toLocaleString() + '</button>';
    } else if (inProgress) {
      actionHtml = '<button class="btn secondary" disabled>המשחק שלך הסתיים — ניקוד אחרון ' + (myEntry.score | 0).toLocaleString() + '</button>';
    } else {
      actionHtml = '<button class="btn" id="chal-start">התחל אתגר →</button>';
    }
    screen.innerHTML =
      createBackButton('challenges-list') +
      '<div class="contest-title">' + escapeHtml(c.name) + '</div>' +
      '<div class="contest-sub">' + escapeHtml(challengeTypeLabel(c)) + ' · ' + (c.winnersCount | 0) + ' זוכים · נותרו ' + challengeTimeLeft(c.endsAt) + '</div>' +
      '<div class="challenge-prize-banner">' +
        prizeImg +
        '<div class="label">הפרס</div>' +
        '<div class="prize">🎁 ' + escapeHtml(c.prizeText) + '</div>' +
        (c.description ? '<div class="sub">' + escapeHtml(c.description) + '</div>' : '') +
      '</div>' +
      (c.rulesText ? '<div class="challenge-rules">' + escapeHtml(c.rulesText) + '</div>' : '') +
      (standingsHtml
        ? '<div class="challenge-standings"><h4>הניקודים המובילים</h4>' + standingsHtml + '</div>'
        : '') +
      '<div class="contest-form">' + actionHtml + '</div>';
    const startBtn = document.getElementById('chal-start');
    if (startBtn) startBtn.onclick = function() { showChallengePreEnter(c); };
    const claimBtn = document.getElementById('chal-claim');
    if (claimBtn) claimBtn.onclick = function() { showChallengeClaim(c); };
  }

  function showChallengePreEnter(c) {
    const wrap = document.getElementById('challenge-screen') || document.querySelector('.app');
    if (!wrap) return;
    let modal = document.getElementById('chal-pre-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'chal-pre-modal';
    modal.className = 'info-modal';
    const prefillName = (getPlayerName() || '').trim();
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="chal-pre-close" aria-label="סגור"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '<div class="info-title">🎁 ' + escapeHtml(c.name) + '</div>' +
        '<div class="info-sub">פרס: ' + escapeHtml(c.prizeText) + '</div>' +
        '<div class="challenge-warn">' +
          '<strong>זה הניסיון היחיד שלך.</strong><br>אין reset, אין pause, אין חזרה. ברגע שתתחיל — המשחק רץ עד הסוף. מוכן?' +
        '</div>' +
        '<div class="contest-form">' +
          '<div class="contest-form-label">השם שלך בלוח</div>' +
          '<input class="contest-input" id="chal-name" autocapitalize="words" placeholder="כתוב את שמך" maxlength="50" value="' + escapeHtml(prefillName) + '" />' +
          (c.rulesText ? '<label class="challenge-checkbox-row"><input type="checkbox" id="chal-agree"> קראתי את התקנון</label>' : '') +
          '<button class="contest-submit-btn" id="chal-go">התחל אתגר</button>' +
          '<button class="contest-secondary-btn" id="chal-cancel" style="margin-top:6px">ביטול</button>' +
          '<div class="contest-error" id="chal-err"></div>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('chal-pre-close').onclick = function() { modal.remove(); };
    document.getElementById('chal-cancel').onclick    = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    document.getElementById('chal-go').onclick = async function() {
      const nameInput = document.getElementById('chal-name');
      const errEl = document.getElementById('chal-err');
      const name = (nameInput.value || '').trim();
      if (!name) { errEl.textContent = 'נא להזין שם'; return; }
      const agreeEl = document.getElementById('chal-agree');
      if (agreeEl && !agreeEl.checked) { errEl.textContent = 'יש לאשר את התקנון'; return; }
      this.disabled = true; this.textContent = 'מתחיל…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(c.slug) + '/enter', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, displayName: name })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          errEl.textContent = data.error === 'already_entered' ? 'כבר השתתפת באתגר הזה.'
            : data.error === 'rate_limited' ? 'יותר מדי ניסיונות. נסה בעוד שעה.'
            : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'התחל אתגר';
          return;
        }
        setPlayerName(name);
        modal.remove();
        hideChallengeScreens();
        trackEvent('challenge_enter', { slug: c.slug, type: c.challengeType });
        beginChallengeRun(c, data);
      } catch (e) {
        errEl.textContent = 'שגיאת חיבור. נסה שוב.';
        this.disabled = false; this.textContent = 'התחל אתגר';
      }
    };
  }

  function showChallengeClaim(c) {
    const wrap = document.getElementById('challenge-screen') || document.querySelector('.app');
    if (!wrap) return;
    let modal = document.getElementById('chal-claim-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'chal-claim-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="chal-claim-close" aria-label="סגור"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '<div class="info-title">🎉 ניצחת באתגר!</div>' +
        '<div class="info-sub">פרס: ' + escapeHtml(c.prizeText) + ' — מלא פרטים ויצור קשר.</div>' +
        '<div class="challenge-claim-form">' +
          '<input id="cc-name" autocapitalize="words" placeholder="שם מלא"        maxlength="80"  />' +
          '<input id="cc-phone" placeholder="טלפון / WhatsApp" maxlength="40" />' +
          '<input id="cc-email" placeholder="אימייל (אופציונלי)" maxlength="120" />' +
          '<button class="contest-submit-btn" id="cc-go">שלח לאדמין</button>' +
          '<div class="contest-error" id="cc-err"></div>' +
          '<div class="help" style="font-size:11px;color:#A8A6A0;margin-top:8px;text-align:right">הפרטים שלך נשמרים בדשבורד פרטי בלבד. ייצרו איתך קשר תוך 48 שעות.</div>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('chal-claim-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    document.getElementById('cc-go').onclick = async function() {
      const name  = document.getElementById('cc-name').value.trim();
      const phone = document.getElementById('cc-phone').value.trim();
      const email = document.getElementById('cc-email').value.trim();
      const err = document.getElementById('cc-err');
      if (!name) { err.textContent = 'שם הוא חובה'; return; }
      if (!phone && !email) { err.textContent = 'נא להזין טלפון או אימייל'; return; }
      this.disabled = true; this.textContent = 'שולח…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(c.slug) + '/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, contactName: name, contactPhone: phone, contactEmail: email })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          err.textContent = data.error === 'not_winner_or_already_claimed' ? 'כבר נשלחו פרטים.' : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'שלח לאדמין';
          return;
        }
        modal.innerHTML = '<div class="info-card"><div class="info-title">✓ הפרטים נשלחו!</div><div class="info-sub">ייצרו איתך קשר תוך 48 שעות.</div><button class="btn" id="cc-done" style="margin-top:14px">סגור</button></div>';
        document.getElementById('cc-done').onclick = function() { modal.remove(); showChallengeDetail(c.slug); };
      } catch (e) {
        err.textContent = 'שגיאת חיבור.';
        this.disabled = false; this.textContent = 'שלח לאדמין';
      }
    };
  }

  // ================================================================
  // CHALLENGE RUN — the in-game side of a prize attempt.
  // ================================================================
  // beginChallengeRun() is the single entry point. It locks the player into
  // challenge mode (no reset, no pause, no save), pushes the live grid to the
  // server on every drop, and routes to the result screen on game-over.

  function beginChallengeRun(challengeMeta, enterResp) {
    activeChallenge = {
      slug:           challengeMeta.slug,
      name:           challengeMeta.name,
      prizeText:      challengeMeta.prizeText || enterResp.prizeText,
      challengeType:  enterResp.challengeType,
      thresholdScore: enterResp.thresholdScore,
      thresholdTier:  enterResp.thresholdTier,
      winnersCount:   enterResp.winnersCount,
      boardSeed:      enterResp.boardSeed,
      drops:          0,           // running count synced to localStorage
      isWinner:       false,
      winnerRank:     null
    };
    clearChallengeDrops(challengeMeta.slug);
    hideChallengeScreens();
    init('challenge', { fresh: true });
  }

  let challengeScoreInflight = false;
  async function pushChallengeScore() {
    if (mode !== 'challenge' || !activeChallenge) return;
    if (challengeScoreInflight) return;  // one in-flight at a time — drop the older heartbeat
    challengeScoreInflight = true;
    try {
      const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(activeChallenge.slug) + '/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          score: score | 0,
          tier: highestTier | 0,
          drops: activeChallenge.drops | 0,
          token: deviceToken
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.isWinner && !activeChallenge.isWinner) {
          activeChallenge.isWinner = true;
          activeChallenge.winnerRank = data.winnerRank;
          // Don't pop the modal mid-game — let the result screen handle it.
          // But do show a one-shot toast so the player feels the moment.
          showChallengeWinToast();
        }
      }
    } catch (e) { /* silent — challenge writes are best-effort during play */ }
    challengeScoreInflight = false;
  }

  function showChallengeWinToast() {
    const t = document.createElement('div');
    t.className = 'spectator-toast';
    t.style.background = '#1B5E20';
    t.textContent = '🎉 חצית את הרף — אתה זוכה!';
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  async function completeChallengeRun() {
    if (!activeChallenge) return null;
    try {
      const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(activeChallenge.slug) + '/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          score: score | 0,
          tier: highestTier | 0,
          drops: activeChallenge.drops | 0,
          token: deviceToken
        })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function challengePrizeChipHtml() {
    if (!activeChallenge) return '';
    return '<div class="challenge-prize-chip">' +
      '<span class="live-mini">LIVE</span>' +
      '🎁 ' + escapeHtml(activeChallenge.prizeText) +
    '</div>';
  }

  function renderChallengeResult(data) {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || !activeChallenge) return;
    const finalScore  = data && data.finalScore != null ? data.finalScore : score;
    const isWinner    = !!(data && data.isWinner) || activeChallenge.isWinner;
    const winnerRank  = (data && data.winnerRank) || activeChallenge.winnerRank;
    const rank        = data && data.rank;
    const total       = data && data.totalEntries;
    const threshold   = activeChallenge.thresholdScore;
    const slug        = activeChallenge.slug;
    const name        = activeChallenge.name;
    const prizeText   = activeChallenge.prizeText;

    let resultHtml;
    if (isWinner) {
      resultHtml =
        '<div class="over-title" style="color:#1B5E20">🎉 מזל טוב! זכית באתגר</div>' +
        '<div class="over-score">' + (finalScore | 0).toLocaleString() + '</div>' +
        '<div class="over-sub">מקום ' + (winnerRank || 1) + ' באתגר "' + escapeHtml(name) + '"</div>' +
        '<div class="challenge-prize-banner" style="margin-top:14px">' +
          '<div class="label">הפרס שלך</div>' +
          '<div class="prize">🎁 ' + escapeHtml(prizeText) + '</div>' +
        '</div>' +
        '<div class="challenge-warn"><strong>צעד אחרון:</strong> השאר פרטים ליצירת קשר.</div>' +
        '<div class="challenge-claim-form">' +
          '<input id="cr-name" autocapitalize="words" placeholder="שם מלא"        maxlength="80"  value="' + escapeHtml(getPlayerName() || '') + '"/>' +
          '<input id="cr-phone" placeholder="טלפון / WhatsApp" maxlength="40" />' +
          '<input id="cr-email" placeholder="אימייל (אופציונלי)" maxlength="120" />' +
          '<button class="btn" id="cr-submit">שלח לאדמין</button>' +
          '<div class="contest-error" id="cr-err"></div>' +
        '</div>';
    } else {
      const distance = (threshold != null && finalScore < threshold)
        ? '<div class="over-sub" style="margin-top:8px">חסרו לך ' + (threshold - finalScore).toLocaleString() + ' נקודות לפרס</div>'
        : '';
      resultHtml =
        '<div class="over-title">האתגר הסתיים</div>' +
        '<div class="over-score">' + (finalScore | 0).toLocaleString() + '</div>' +
        '<div class="over-sub">' + (rank ? 'מקום ' + rank + ' מתוך ' + total + ' משתתפים' : 'תוצאה נשלחה') + '</div>' +
        distance +
        '<div class="challenge-warn" style="background:#FAFAF6;color:#6F6E68;border-color:#F0EDE3"><strong>זה היה הניסיון היחיד שלך באתגר הזה.</strong> בהצלחה באתגר הבא!</div>';
    }

    wrap.innerHTML =
      '<div class="overlay">' +
        resultHtml +
        '<button class="btn" id="cr-back">חזור לאתגרים</button>' +
        '<button class="btn secondary" id="cr-share">שתף תוצאה</button>' +
      '</div>';

    document.getElementById('cr-back').onclick = function() {
      const slugSaved = slug;
      activeChallenge = null;
      mode = 'practice';
      showChallengeDetail(slugSaved);
    };
    document.getElementById('cr-share').onclick = function() {
      const txt = (isWinner ? 'ניצחתי באתגר BLOOM וזכיתי ב-' + prizeText + '!\n' : 'ניקוד ' + finalScore.toLocaleString() + ' באתגר BLOOM.\n')
        + window.location.origin + window.location.pathname;
      if (navigator.share) navigator.share({ text: txt }).catch(function() {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt);
    };
    const submitBtn = document.getElementById('cr-submit');
    if (submitBtn) submitBtn.onclick = async function() {
      const nm = document.getElementById('cr-name').value.trim();
      const ph = document.getElementById('cr-phone').value.trim();
      const em = document.getElementById('cr-email').value.trim();
      const err = document.getElementById('cr-err');
      if (!nm) { err.textContent = 'שם הוא חובה'; return; }
      if (!ph && !em) { err.textContent = 'נא להזין טלפון או אימייל'; return; }
      this.disabled = true; this.textContent = 'שולח…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(slug) + '/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, contactName: nm, contactPhone: ph, contactEmail: em })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          err.textContent = data.error === 'not_winner_or_already_claimed' ? 'כבר נשלחו פרטים.' : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'שלח לאדמין'; return;
        }
        this.textContent = '✓ נשלח. ייצרו איתך קשר.';
        this.classList.add('secondary');
      } catch (e) {
        err.textContent = 'שגיאת חיבור.';
        this.disabled = false; this.textContent = 'שלח לאדמין';
      }
    };
    // Challenge result is content-tall (banner + score + position + form +
    // share/back buttons); equip the overlay so the bottom buttons are
    // reachable via internal scroll on shorter phones.
    equipOverlay();
  }

  // beforeunload — warn if mid-game with meaningful score.
  window.addEventListener('beforeunload', function(e) {
    // Always save state before leaving
    if (mode === 'practice') savePracticeGameState();
    if (mode === 'contest') saveContestGameState();
    // Warn if mid-game
    var hasScore = (score | 0) > 100;
    var midGame = !isGameOver() && hasScore && !document.getElementById('home-screen');
    if (midGame) {
      e.preventDefault();
      var msg = mode === 'challenge' ? 'אתה באמצע אתגר פרס. הניקוד הסופי יהיה הניקוד הנוכחי.'
        : mode === 'contest' ? 'אתה באמצע תחרות. המשחק ישמר.'
        : 'אתה באמצע משחק עם ' + score.toLocaleString() + ' נקודות. בטוח לצאת?';
      e.returnValue = msg;
      return msg;
    }
  });

  // ================================================================
  // LIVE SCORE PUSH (sender side — the player who is currently playing)
  // ================================================================
  // Throttle: at most one POST per LIVE_SCORE_MIN_INTERVAL_MS. If the score
  // hasn't changed since the last successful send, skip entirely.

  function liveSnapshot() {
    return {
      deviceId: deviceId,
      token: deviceToken,
      displayName: getContestDisplayName(activeContestCode) || 'אנונימי',
      liveScore: score | 0,
      tier: highestTier | 0
    };
  }

  function flattenGrid() {
    const flat = new Array(getBoardRows() * getBoardCols());
    for (let r = 0; r < getBoardRows(); r++) {
      for (let c = 0; c < getBoardCols(); c++) flat[r * getBoardCols() + c] = grid[r][c] | 0;
    }
    return flat;
  }

  async function pushLiveScore() {
    if (mode !== 'contest' || !activeContestCode) return;
    liveScoreLastSentAt = Date.now();
    liveScoreLastSentValue = score | 0;
    try {
      const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(activeContestCode) + '/live-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveSnapshot())
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.hasWatchers === 'boolean') {
        const prev = meHasWatchers;
        meHasWatchers = data.hasWatchers;
        if (typeof data.watcherCount === 'number') meWatcherCount = data.watcherCount | 0;
        else meWatcherCount = meHasWatchers ? Math.max(meWatcherCount, 1) : 0;
        // If we just learned a watcher arrived, push a state frame now so
        // they see the live grid without waiting for the next drop.
        if (!prev && meHasWatchers) pushLiveState();
        renderAudienceBadge();
      }
    } catch (e) {
      // Silent — live score is non-critical.
    }
  }

  function scheduleLiveScorePush() {
    if (mode !== 'contest' || !activeContestCode) return;
    if ((score | 0) === liveScoreLastSentValue) return;
    const elapsed = Date.now() - liveScoreLastSentAt;
    if (elapsed >= LIVE_SCORE_MIN_INTERVAL_MS) {
      if (liveScoreFlushTimer) { clearTimeout(liveScoreFlushTimer); liveScoreFlushTimer = null; }
      pushLiveScore();
      return;
    }
    if (liveScoreFlushTimer) return; // already queued
    liveScoreFlushTimer = setTimeout(function() {
      liveScoreFlushTimer = null;
      pushLiveScore();
    }, LIVE_SCORE_MIN_INTERVAL_MS - elapsed);
  }

  async function pushLiveState() {
    if (mode !== 'contest' || !activeContestCode || !meHasWatchers) return;
    if (!Array.isArray(grid)) return;
    const body = Object.assign({}, liveSnapshot(), {
      nextTier: typeof nextPiece === 'number' ? (nextPiece | 0) : null,
      gridJson: flattenGrid()
    });
    try {
      await fetch(API_BASE + '/api/contests/' + encodeURIComponent(activeContestCode) + '/live-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Silent.
    }
  }

  // Called by the game-over flow to make sure spectators stop seeing the
  // dead board quickly. Server TTL would handle it within 10s anyway.
  function stopLivePush() {
    if (liveScoreFlushTimer) { clearTimeout(liveScoreFlushTimer); liveScoreFlushTimer = null; }
    liveScoreLastSentValue = -1;
    meHasWatchers = false;
    meWatchers = [];
    meWatcherCount = 0;
    renderAudienceBadge();
  }

  // ================================================================
  // AUDIENCE BADGE (the active player's "👁 N" floating indicator)
  // ================================================================

  function ensureAudienceBadge() {
    let wrap = document.getElementById('grid-wrap');
    if (!wrap) return null;
    let badge = document.getElementById('audience-badge');
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'audience-badge';
      badge.className = 'audience-badge';
      badge.setAttribute('aria-label', 'הקהל שצופה בך');
      badge.onclick = function(e) {
        e.stopPropagation();
        audienceBadgeOpen = !audienceBadgeOpen;
        renderAudienceBadge();
      };
      wrap.appendChild(badge);
      document.addEventListener('click', function(ev) {
        const list = document.getElementById('audience-list');
        if (!audienceBadgeOpen) return;
        if (list && (list === ev.target || list.contains(ev.target))) return;
        if (badge === ev.target || badge.contains(ev.target)) return;
        audienceBadgeOpen = false;
        renderAudienceBadge();
      });
    }
    return badge;
  }

  function removeAudienceBadge() {
    const badge = document.getElementById('audience-badge');
    if (badge) badge.remove();
    const list = document.getElementById('audience-list');
    if (list) list.remove();
    audienceBadgeOpen = false;
  }

  function renderAudienceBadge() {
    const visible = mode === 'contest'
      && activeContestCode
      && !spectatorSession
      && (meWatchers.length > 0 || meHasWatchers || meWatcherCount > 0);
    if (!visible) { removeAudienceBadge(); return; }
    const badge = ensureAudienceBadge();
    if (!badge) return;
    const count = Math.max(meWatchers.length, meWatcherCount | 0);
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' +
      '</svg>' +
      '<span>' + count + '</span>';
    const wrap = document.getElementById('grid-wrap');
    let list = document.getElementById('audience-list');
    if (audienceBadgeOpen && meWatchers.length) {
      if (!list) {
        list = document.createElement('div');
        list.id = 'audience-list';
        list.className = 'audience-list';
        wrap.appendChild(list);
      }
      const rowsHtml = meWatchers.map(function(w) {
        return '<div class="audience-list-row">' +
          '<span class="audience-list-name">' + renderAvatarHtml(w.name, 'sm') + escapeHtml(w.name || 'אנונימי') + '</span>' +
          '<span class="audience-list-score">' + (w.lastScore | 0).toLocaleString() + ' נק׳</span>' +
        '</div>';
      }).join('');
      list.innerHTML = '<div class="audience-list-title">צופים בך · נקודה אחרונה</div>' + rowsHtml;
    } else if (list) {
      list.remove();
    }
  }

  // ================================================================
  // SPECTATOR (viewer side — for a player who chose to watch)
  // ================================================================

  // entryFrom: 'game-over' (default), 'contest-screen', or 'in-game'. Drives
  // where the spectator's "exit" button returns to.
  let pendingSpectatorEntry = 'game-over';
  function openSpectatorPicker(entryFrom) {
    if (!activeContestCode) return;
    pendingSpectatorEntry = entryFrom || 'game-over';
    // Anchor the modal inside whatever is currently visible: contest-screen
    // overlays grid-wrap (higher z-index), so attaching there keeps the modal
    // visible when the picker is opened mid-game from the contest leaderboard.
    const host = document.getElementById('contest-screen') || document.getElementById('grid-wrap');
    if (!host) return;
    let modal = document.getElementById('spectator-picker-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'spectator-picker-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="spm-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="info-title">צפייה במשחקים חיים</div>' +
        '<div class="info-sub">בחר שחקן שמשחק עכשיו ותעבור לצפייה חיה</div>' +
        '<div id="spm-body"><div class="spectator-picker-empty">טוען…</div></div>' +
      '</div>';
    host.appendChild(modal);
    document.getElementById('spm-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    refreshSpectatorPicker();
  }

  async function refreshSpectatorPicker() {
    const body = document.getElementById('spm-body');
    if (!body) return;
    const data = await fetchContest(activeContestCode);
    if (!body.isConnected) return; // modal closed mid-fetch
    if (!data || !Array.isArray(data.players)) {
      body.innerHTML = '<div class="spectator-picker-empty">שגיאת חיבור. נסה שוב.</div>';
      return;
    }
    const live = data.players.filter(function(p) {
      return p.liveScore !== null && p.deviceId && p.deviceId !== deviceId;
    });
    live.sort(function(a, b) { return (b.liveScore | 0) - (a.liveScore | 0); });
    if (!live.length) {
      body.innerHTML = '<div class="spectator-picker-empty">אין כרגע שחקנים פעילים בתחרות.<br>נסה שוב בעוד כמה רגעים.</div>';
      return;
    }
    const rows = live.map(function(p) {
      const tierObj = (getActiveTiers()[p.liveTier | 0] || getActiveTiers()[p.tier | 0]);
      const tierBadge = tierObj
        ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '">' + tierObj.svg + '</div>'
        : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
      return '<button class="spectator-picker-row" data-target="' + escapeHtml(p.deviceId) + '" data-name="' + escapeHtml(p.name || '') + '">' +
        tierBadge +
        '<div style="flex:1;min-width:0">' +
          '<div class="spectator-picker-name">' + renderAvatarHtml(p.deviceId || p.name, 'sm') + escapeHtml(p.name || 'אנונימי') + '</div>' +
          '<div class="spectator-picker-meta">' + (p.score | 0).toLocaleString() + ' נצברו · ' + (p.tier | 0 ? 'עד ' + (getActiveTiers()[p.tier | 0] && getActiveTiers()[p.tier | 0].name || '') : 'משחק ראשון') + '</div>' +
        '</div>' +
        '<div class="spectator-picker-score">+' + (p.liveScore | 0).toLocaleString() + '</div>' +
      '</button>';
    }).join('');
    body.innerHTML = '<div class="spectator-picker-list">' + rows + '</div>';
    body.querySelectorAll('.spectator-picker-row').forEach(function(btn) {
      btn.onclick = function() {
        const target = btn.getAttribute('data-target');
        const name   = btn.getAttribute('data-name');
        const modal = document.getElementById('spectator-picker-modal');
        if (modal) modal.remove();
        startSpectator(target, name, pendingSpectatorEntry);
      };
    });
  }

  function startSpectator(targetDeviceId, fallbackName, entryFrom) {
    if (!activeContestCode || !targetDeviceId) return;
    if (spectatorSession) stopSpectator(null);
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    const from = entryFrom || 'game-over';
    // If the spectate starts mid-game, snapshot the current run so we can
    // resume it cleanly on exit. The grid-wrap is about to be replaced.
    if (from !== 'game-over' && !contestSubmitted && mode === 'contest') {
      saveContestGameState();
    }
    // Tear down our own contest-screen overlay (if it's open behind the picker)
    // so the spectator view has the stage to itself.
    if (from === 'contest-screen') {
      const el = document.getElementById('contest-screen');
      if (el) { stopContestRefresh(); el.remove(); }
    }
    // Stop heartbeating my OWN game while I'm watching someone else — my
    // contest_live_state row will fade within 10s on the server side.
    stopLivePush();
    // Tear down the in-game contest HUD too — it shows MY rank + targets
    // which is irrelevant (and visually distracting) while I'm spectating
    // someone else. stopSpectator() will re-mount it on exit if we're
    // resuming a mid-game session.
    if (typeof stopContestHud === 'function') stopContestHud();
    spectatorSession = {
      code: activeContestCode,
      targetDeviceId: targetDeviceId,
      name: fallbackName || 'שחקן',
      lastScore: 0,
      missCount: 0,
      lastSnap: null,
      pollTimer: null,
      heartbeatTimer: null,
      entryFrom: from
    };
    removeAudienceBadge();
    renderSpectatorView();
    // Initial heartbeat + first snapshot tick.
    spectatorHeartbeat();
    spectatorTick(true);
    spectatorSession.pollTimer = setInterval(spectatorTick, 1000);
    spectatorSession.heartbeatTimer = setInterval(spectatorHeartbeat, 5000);
  }

  async function spectatorHeartbeat() {
    const s = spectatorSession;
    if (!s) return;
    const myName = getContestDisplayName(s.code) || 'אנונימי';
    // If the spectator entered mid-game (paused their run), the score they
    // expose to the watched player is their *current in-progress* score —
    // that's more truthful than the last completed game's score.
    let myScore = getLastFinalScore(s.code);
    const midGamePause = s.entryFrom !== 'game-over'
      && mode === 'contest'
      && !contestSubmitted
      && Array.isArray(grid)
      && grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (midGamePause) myScore = score | 0;
    try {
      await fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) + '/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          watcherDeviceId: deviceId,
          watcherName: myName,
          watcherLastScore: myScore,
          targetDeviceId: s.targetDeviceId
        })
      });
    } catch (e) { /* silent */ }
  }

  async function spectatorTick(forceRender) {
    const s = spectatorSession;
    if (!s) return;
    let res;
    try {
      res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) +
        '/live-state/' + encodeURIComponent(s.targetDeviceId));
    } catch (e) {
      return;
    }
    if (!spectatorSession || spectatorSession !== s) return;
    if (res.status === 404) {
      s.missCount++;
      if (s.missCount >= 2) {
        showSpectatorToast('המשחק הסתיים');
        stopSpectator(true);
      }
      return;
    }
    if (!res.ok) return;
    let data;
    try { data = await res.json(); } catch (e) { return; }
    if (!spectatorSession || spectatorSession !== s) return;
    s.missCount = 0;
    if (data && data.live) {
      s.lastSnap = data.live;
      if (data.live.name) s.name = data.live.name;
      renderSpectatorView();
    } else if (forceRender) {
      renderSpectatorView();
    }
  }

  function renderSpectatorView() {
    const s = spectatorSession;
    if (!s) return;
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    const snap = s.lastSnap;
    const tier = snap ? (snap.tier | 0) : 0;
    const tierObj = getActiveTiers()[tier];
    const tierBadge = tierObj
      ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '">' + tierObj.svg + '</div>'
      : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
    let cellsHtml = '';
    if (snap && Array.isArray(snap.grid) && snap.grid.length === 24) {
      for (let i = 0; i < 24; i++) {
        const t = snap.grid[i] | 0;
        if (t > 0 && getActiveTiers()[t]) {
          const ti = getActiveTiers()[t];
          cellsHtml += '<div class="cell filled" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>';
        } else {
          cellsHtml += '<div class="cell"></div>';
        }
      }
    } else {
      for (let i = 0; i < 24; i++) cellsHtml += '<div class="cell"></div>';
    }
    const liveScoreText = snap ? (snap.score | 0).toLocaleString() : '—';
    const tierName = (tierObj && tierObj.name) ? tierObj.name : '—';
    // Choose exit label based on where the spectate started — the player
    // should see "back to my game" if they came from mid-game.
    const willResumeGame = s.entryFrom !== 'game-over' && !contestSubmitted && mode === 'contest';
    const exitLabel = willResumeGame ? 'חזור למשחק שלי'
      : s.entryFrom === 'contest-screen' ? 'חזור ללוח התחרות'
      : 'צא מהצפייה';
    wrap.innerHTML =
      '<div class="spectator-view">' +
        '<div class="spectator-header">' +
          '<div>' +
            '<div class="spectator-header-name">' + tierBadge +
              '<span>צופה ב ' + escapeHtml(s.name || 'שחקן') + '</span>' +
              '<span class="live-tag">LIVE</span>' +
            '</div>' +
            '<div class="spectator-header-meta">דרגה: ' + escapeHtml(tierName) + '</div>' +
          '</div>' +
          '<div class="spectator-header-score">' + liveScoreText + '</div>' +
        '</div>' +
        '<div class="spectator-grid"><div class="grid" id="spectator-grid-el">' + cellsHtml + '</div></div>' +
        '<div class="spectator-controls">' +
          '<button class="btn secondary" id="spec-switch">החלפת שחקן</button>' +
          '<button class="btn" id="spec-exit">' + exitLabel + '</button>' +
        '</div>' +
      '</div>';
    const sw = document.getElementById('spec-switch');
    const ex = document.getElementById('spec-exit');
    if (sw) sw.onclick = function() {
      const fromBeforeExit = s.entryFrom;
      stopSpectator(null);
      openSpectatorPicker(fromBeforeExit);
    };
    if (ex) ex.onclick = function() {
      stopSpectator('exit');
    };
  }

  // exit: null → internal cleanup only (e.g., before switching player).
  //       'exit' → user-initiated exit; route based on entryFrom + game state.
  function stopSpectator(exit) {
    const s = spectatorSession;
    if (!s) return;
    if (s.pollTimer) { clearInterval(s.pollTimer); s.pollTimer = null; }
    if (s.heartbeatTimer) { clearInterval(s.heartbeatTimer); s.heartbeatTimer = null; }
    // Best-effort unwatch — the server TTL will clean us up regardless.
    try {
      fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) + '/unwatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watcherDeviceId: deviceId, targetDeviceId: s.targetDeviceId })
      });
    } catch (e) {}
    const from = s.entryFrom;
    spectatorSession = null;
    if (exit !== 'exit') return;
    if (from !== 'game-over' && !contestSubmitted && mode === 'contest' && activeContestCode) {
      // Mid-game spectate ended → resume the saved game.
      init('contest');
      return;
    }
    if (from === 'contest-screen' && activeContestCode) {
      showContestLeaderboard(activeContestCode);
      return;
    }
    // Default — back to the game-over view.
    render({ over: true });
  }

  function showSpectatorToast(text) {
    const t = document.createElement('div');
    t.className = 'spectator-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const ms = new Date() - new Date(iso);
    if (isNaN(ms) || ms < 0) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'עכשיו';
    const min = Math.floor(sec / 60);
    if (min < 60) return 'לפני ' + min + ' דק׳';
    const hours = Math.floor(min / 60);
    if (hours < 24) return 'לפני ' + hours + ' שע׳';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'אתמול';
    if (days < 7) return 'לפני ' + days + ' ימים';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  // ============================================================
  // Dynamic Boards — apply helpers (phase 3)
  // Centralises "given a board object, set up engine state for it"
  // so daily/practice/duel/dynamic all use the same logic. Supports:
  //   - type 'multipliers' → setColumnMultipliers(def.multipliers)
  //   - type 'special_cells' → setSpecialCells(def.cells)
  //   - definition.theme_id (any type) → applies a body class for
  //     visual theming (phase 4: holiday backgrounds + floating decor)
  // ============================================================
  // Phase 4 theme registry. Adding a new theme requires:
  //   1. Add an entry here
  //   2. Add server-side validation in validateBoardDefinition
  //   3. Add CSS rules under body.theme-{id}-active in boards.css
  var BOARD_THEMES = {
    hanukkah:       { name: 'חנוכה',         emoji: '🕎', cls: 'theme-hanukkah-active' },
    valentine:      { name: 'ולנטיין',       emoji: '💕', cls: 'theme-valentine-active' },
    yom_haatzmaut:  { name: 'יום העצמאות',   emoji: '🇮🇱', cls: 'theme-yom-haatzmaut-active' },
    passover:       { name: 'פסח',           emoji: '🍷', cls: 'theme-passover-active' }
  };
  function clearBoardThemeClasses() {
    var body = document.body;
    if (!body) return;
    Object.keys(BOARD_THEMES).forEach(function(k) {
      body.classList.remove(BOARD_THEMES[k].cls);
    });
  }
  function applyBoardTheme(themeId) {
    clearBoardThemeClasses();
    if (!themeId) return;
    var theme = BOARD_THEMES[themeId];
    if (!theme || !document.body) return;
    document.body.classList.add(theme.cls);
  }

  function applyBoardToSession(board) {
    if (!board || !board.definition || !board.type) {
      clearBoardThemeClasses();
      return false;
    }
    var def = board.definition;
    var ok = false;
    if (board.type === 'multipliers' && Array.isArray(def.multipliers)) {
      setColumnMultipliers(def.multipliers);
      ok = true;
    }
    if (board.type === 'special_cells' && Array.isArray(def.cells)) {
      setSpecialCells(def.cells);
      ok = true;
    }
    // 'themed' boards can carry cells + multipliers + theme_id in one
    // definition. We accept the type label and apply whatever's defined.
    if (board.type === 'themed') {
      if (Array.isArray(def.cells))       setSpecialCells(def.cells);
      if (Array.isArray(def.multipliers)) setColumnMultipliers(def.multipliers);
      ok = true;
    }
    if (!ok) {
      clearBoardThemeClasses();
      return false;
    }
    // Apply the visual theme last so it overlays everything.
    applyBoardTheme(def.theme_id);
    window._activeSpecialBoard = board;
    return true;
  }

  function applyDuelBoardSnapshot(duelRow) {
    // Duels currently snapshot only board_multipliers (phase 3 server
    // POST /api/duels). Special-cells duel snapshot lands in a future
    // phase — until then, treat missing fields as a vanilla duel.
    if (!duelRow) return false;
    var mults = duelRow.board_multipliers;
    if (typeof mults === 'string') {
      try { mults = JSON.parse(mults); } catch (e) { mults = null; }
    }
    if (Array.isArray(mults)) {
      setColumnMultipliers(mults);
      window._activeSpecialBoard = {
        name: duelRow.board_name || 'דו-קרב מיוחד',
        type: 'multipliers',
        definition: { multipliers: mults }
      };
      return true;
    }
    return false;
  }

  async function init(nextMode, opts) {
    opts = opts || {};
    const fresh = !!opts.fresh;
    // A FRESH game gets a new gameId — the ad-watch flow uses this id for
    // server-side per-game dedup (one ad reward per finished game). Non-fresh
    // re-inits (e.g., daily-already-played replay screen, contest mode
    // restore) keep the existing id so refreshing doesn't issue a new one.
    if (fresh && typeof regenerateGameId === 'function') regenerateGameId();
    // Sweep any celebration banners left over from the previous round —
    // setTimeout can be paused by tab-blur or skipped on page-hide, leaving
    // a stuck modal over the board. clearTransientBanners is idempotent.
    if (typeof clearTransientBanners === 'function') clearTransientBanners();
    // Dynamic Boards (phase 3): clear ANY leftover board state at the top
    // of every init (column multipliers + special cells + theme class).
    // Each mode then re-applies its own board (if any) via the per-mode
    // resolution below. Guarantees that going from one mode to another
    // never leaks state.
    if (typeof setColumnMultipliers === 'function') setColumnMultipliers(null);
    if (typeof setSpecialCells === 'function') setSpecialCells(null);
    if (typeof clearBoardThemeClasses === 'function') clearBoardThemeClasses();
    window._activeSpecialBoard = null;
    if (nextMode) mode = nextMode;
    dailyDate = todayInIsrael();
    // Resolve per-game difficulty BEFORE the first board paint. Daily stays
    // admin-only so its leaderboard is comparable. Practice reads from
    // localStorage. Contest/duel pull from their fetched row (set later).
    sessionDifficulty = null;
    if (mode === 'practice') sessionDifficulty = readPracticeDifficulty();
    grid = Array.from({length: getBoardRows()}, function() { return Array(getBoardCols()).fill(0); });
    score = 0; highestTier = 1; busy = false; dropsCount = 0;
    window.__bloomGameOver = false; // new game = active again
    currentGameMaxChain = 0;
    tierUpHit = {};   // reset milestone-bonus tracker for this fresh game
    scoreMilestonesHit = {}; // reset score milestones
    _frozenThawProgress = {};   // reset frozen-cell thaw counters (phase 3D+)
    bestBeatenThisGame = false; // reset live best tracking
    usedContinue = false; // reset second chance
    // Clear duel mode unless this init was called from startDuelGame
    if (!opts.keepDuel) { window._duelMode = false; window._duelOpponentName = ''; }
    gameMergesPerTier = {};
    gamePointsPerTier = {};
    gameBestMergeTier = 0;
    gameTotalMerges = 0;
    gameStartTime = Date.now();
    trackEvent('game_start', { mode: mode });
    // Touch the "last play date" tracker so the comeback bonus on home
    // can compute days-since-last-play accurately. Side-effect free
    // (write-only); never throws.
    try { if (window.__bloomRecordLastPlay) window.__bloomRecordLastPlay(); } catch (e) {}
    leaderboard = [];
    dailyRank = null;
    dailyTotal = null;
    prevBest = best;
    // Cleared at top of init: by the time we know we're entering contest mode,
    // we'll re-set this to the contest code the new game belongs to. For non-
    // contest modes it stays null — saveContestGameState() then no-ops.
    activeGameContestCode = null;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    if (mode === 'daily') {
      const seed = hashSeed('bloom-' + dailyDate);
      rng = mulberry32(seed);
      const priorRaw = localStorage.getItem(DAILY_PLAYED_PREFIX + dailyDate);
      if (priorRaw) {
        dailySubmitted = true;
        try {
          const prior = JSON.parse(priorRaw);
          score = prior.score || 0;
          highestTier = prior.tier || 1;
        } catch (e) {}
        nextPiece = pickPiece();
        updateModeBar();
        render({ over: true, alreadyPlayed: true });
        loadLeaderboard();
        return;
      }
      dailySubmitted = false;
    } else {
      rng = Math.random;
      dailySubmitted = false;
    }
    let restoredContestState = false;
    // Reset all live-broadcast state for a fresh game in this contest. The
    // server side fades within LIVE_FRESH_SECONDS regardless, but resetting
    // here means there's no flicker of stale data when toggling modes.
    if (spectatorSession) stopSpectator(false);
    stopLivePush();
    if (mode === 'contest') {
      contestSubmitted = false;
      if (activeContestCode) {
        // AWAIT the fetch — without this, switching contests uses the previous
        // contest's board_seed for the new game (visual state-leak that the
        // user reported: "המערכת זוכרת את המשחק שלו רק מאחת מהתחרויות").
        // We only block if activeContestData is missing or stale; if the cache
        // already matches activeContestCode the fetch is best-effort.
        if (!activeContestData || activeContestData.code !== activeContestCode) {
          const data = await fetchContest(activeContestCode).catch(function() { return null; });
          if (data && data.contest) {
            activeContestData = data.contest;
          } else if (!activeContestData) {
            // Fetch failed and no cached data — can't determine board seed.
            // Fall back to practice so the player isn't stuck on a broken board.
            console.warn('[init] contest fetch failed, falling back to practice');
            mode = 'practice';
            rng = Math.random;
            updateModeBar();
            render();
            maybeOnboardStep1();
            return;
          }
        } else {
          fetchContest(activeContestCode).then(function(data) {
            if (data && data.contest) activeContestData = data.contest;
          }).catch(function() {});
        }
        fetchMyContests().then(function() { updateModeBar(); }).catch(function() {});
      }
      rng = activeContestData && activeContestData.board_seed != null
        ? mulberry32(activeContestData.board_seed)
        : Math.random;
      // Apply the host-chosen difficulty to this contest game. Stored on
      // the contest row at creation time so changing the preset table
      // later never re-balances live contests.
      if (activeContestData && activeContestData.difficulty_weights) {
        sessionDifficulty = {
          label: activeContestData.difficulty_label || 'custom',
          weights: activeContestData.difficulty_weights,
          speed_pct: activeContestData.difficulty_speed_pct || null
        };
      }
      if (fresh) {
        clearContestGameState();
      } else if (activeContestCode) {
        const saved = loadContestGameState(activeContestCode);
        if (saved) {
          grid = saved.grid;
          score = saved.score | 0;
          highestTier = saved.highestTier || 1;
          currentGameMaxChain = saved.maxChain || 0;
          if (saved.nextPiece) {
            nextPiece = saved.nextPiece;
            restoredContestState = true;
          }
        }
      }
      // Tag the in-memory game with its owning contest BEFORE any save can fire.
      // From this point, saveContestGameState() routes by activeGameContestCode
      // — so switching activeContestCode (My Contests row click) won't pollute
      // the new contest's saved slot with this contest's grid.
      activeGameContestCode = activeContestCode;
    } else if (mode === 'challenge') {
      // Challenges run on a fixed seed shared across all entrants for fairness.
      // No save/restore — closing the tab = forfeit, by design.
      if (activeChallenge && activeChallenge.boardSeed != null) {
        rng = mulberry32(activeChallenge.boardSeed);
      } else {
        rng = Math.random;
      }
    } else if (mode === 'practice') {
      // Restore practice state when switching back from another tab.
      if (fresh) {
        clearPracticeGameState();
      } else {
        const saved = loadPracticeGameState();
        if (saved) {
          grid = saved.grid;
          score = saved.score | 0;
          highestTier = saved.highestTier || 1;
          currentGameMaxChain = saved.maxChain || 0;
          dropsCount = saved.drops || 0;
          gameMergesPerTier = saved.mergesPerTier || {};
          gamePointsPerTier = saved.pointsPerTier || {};
          gameTotalMerges = saved.totalMerges || 0;
          if (saved.startTime) gameStartTime = saved.startTime;
          usedContinue = saved.usedContinue || false;
          if (saved.nextPiece) {
            nextPiece = saved.nextPiece;
            restoredContestState = true; // reuse flag to skip pickPiece
          }
        }
      }
    } else if (mode === 'dynamic') {
      // Dynamic Boards mode — practice-like but bound to a selected board.
      // The board was applied by the picker BEFORE calling init('dynamic');
      // we restore it from window._activeDynamicBoard since the top-of-init
      // wiped the state.
      if (window._activeDynamicBoard) {
        applyBoardToSession(window._activeDynamicBoard);
      }
    }

    // Per-mode board apply (phase 3). Daily / practice / duel may have an
    // active board from the admin. Each branch resolves its source then
    // hands off to applyBoardToSession which knows how to apply BOTH
    // multipliers boards AND special_cells boards (and future types).
    // Fairness: practice + active board → submitPracticeOrDuelScore is
    // skipped by the leaderboard guard further down (see practiceFair...).
    try {
      if (mode === 'daily' && !dailySubmitted && typeof fetchBoardForMode === 'function') {
        const dailyBoard = await fetchBoardForMode('daily');
        if (dailyBoard) applyBoardToSession(dailyBoard);
      } else if (mode === 'practice' && !sessionDifficulty && !window._duelMode &&
                 typeof fetchBoardForMode === 'function') {
        const practiceBoard = await fetchBoardForMode('practice');
        if (practiceBoard) applyBoardToSession(practiceBoard);
      } else if (mode === 'practice' && window._duelMode && opts.duel) {
        // Duel snapshot: server stored the board on the duel row at
        // creation time. Use that directly — never re-fetch (would risk
        // mid-duel divergence between players).
        applyDuelBoardSnapshot(opts.duel);
      }
    } catch (boardErr) {
      // Board apply is best-effort. Failure = vanilla game (zero risk).
    }

    if (!restoredContestState) nextPiece = pickPiece();
    updateModeBar();
    render();
    // Toast at game start when a special board is active — the "wow"
    // moment that turns a routine daily into "today is different!".
    if (window._activeSpecialBoard && typeof showSpecialBoardToast === 'function') {
      try { showSpecialBoardToast(window._activeSpecialBoard); } catch (e) {}
    }
    // Watch for opponents passing my score while I'm mid-game in a contest.
    // The contest live HUD shares the same lifecycle — both mount on
    // contest-init and tear down on any other mode.
    if (mode === 'contest' && activeContestCode) {
      startOvertakeWatch(activeContestCode);
      if (typeof startContestHud === 'function') startContestHud(activeContestCode);
    } else {
      stopOvertakeWatch();
      if (typeof stopContestHud === 'function') stopContestHud();
    }
    // First-drop ping so spectators / leaderboards see the entry immediately.
    if (mode === 'challenge' && activeChallenge) pushChallengeScore();
    // Onboarding: nudge the first-time player on the very first board paint.
    maybeOnboardStep1();
    // Persist current mode so page refresh restores context.
    try { localStorage.setItem('bloom_last_mode', mode); } catch (e) {}
    // Start event drops system
    startEventSystem();
  }

  function updateModeBar() {
    const bar = document.getElementById('mode-bar');
    const title = document.getElementById('mode-title');
    const sub = document.getElementById('mode-sub');
    const tabsEl = document.getElementById('mode-tabs');
    const infoEl = document.getElementById('mode-info');
    const chevEl = document.getElementById('mode-info-chevron');
    if (!bar) return;

    // Title + subtitle reflect the current mode
    if (mode === 'daily') {
      bar.classList.remove('practice');
      title.textContent = 'אתגר יומי · ' + formatDateHe(dailyDate);
      sub.textContent = "אותו דאנג'ן לכולם היום";
    } else if (mode === 'contest') {
      bar.classList.remove('practice');
      title.textContent = 'תחרות חברים';
      var contestDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var contestDiffStr = contestDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + contestDiffPreset.emoji + ' ' + contestDiffPreset.name
        : '';
      sub.textContent = (activeContestData ? activeContestData.name : 'תחרות פעילה') + contestDiffStr;
    } else if (mode === 'challenge' && activeChallenge) {
      bar.classList.remove('practice');
      title.textContent = '🎁 אתגר פרס';
      sub.textContent = activeChallenge.name || activeChallenge.prizeText || 'אתגר פעיל';
    } else if (skinTrialMode && skinTrialId) {
      bar.classList.add('practice');
      var trialPack = SKIN_PACKS[skinTrialId];
      title.textContent = '🎨 ניסיון · ' + (trialPack ? trialPack.name : '');
      sub.textContent = 'ניקוד לא נשמר · שחק ותחליט';
    } else if (window._duelMode && activeDuelId) {
      bar.classList.remove('practice');
      title.textContent = '⚔️ דו-קרב 1v1';
      var duelDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var duelDiffStr = duelDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + duelDiffPreset.emoji + ' ' + duelDiffPreset.name
        : '';
      sub.textContent = 'vs ' + (window._duelOpponentName || 'יריב') + duelDiffStr;
    } else if (mode === 'dynamic' && window._activeDynamicBoard) {
      // Dynamic-board mode — surface the personal best AND the global
      // leader as target chips. The personal-best chip is the in-game
      // half of the "beat your score" loop; when score exceeds the
      // target it auto-swaps to a 👑 crown badge (handled in
      // bumpScore() so it updates per drop). The leader chip provides
      // the social goal: "you're chasing דניאל".
      bar.classList.add('practice');
      var dbName = window._activeDynamicBoard.name || 'לוח דינמי';
      title.textContent = '🎯 ' + dbName;
      var bbRec = (typeof getBoardBest === 'function') ? getBoardBest(window._activeDynamicBoard.id) : null;
      var selfChip;
      if (bbRec && bbRec.score > 0) {
        selfChip = '<span class="dyn-target-chip" id="dyn-target-chip" data-target="' + bbRec.score + '">🏆 לעבור: <strong>' + bbRec.score.toLocaleString() + '</strong></span>';
      } else {
        selfChip = '<span class="dyn-target-chip dyn-target-chip-pioneer">🌱 הצב את השיא הראשון שלך</span>';
      }
      // Leader chip — only when the leader is someone OTHER than the
      // current player (i.e. there's something to chase). If the
      // player IS the leader, surface that instead.
      var leaderChip = '';
      var brd = window._activeDynamicBoard;
      if (brd.leader_name && brd.leader_score) {
        var bestSoFar = bbRec ? bbRec.score : 0;
        if (bestSoFar >= brd.leader_score) {
          leaderChip = ' <span class="dyn-leader-chip dyn-leader-chip-king">👑 אתה מוביל</span>';
        } else {
          leaderChip = ' <span class="dyn-leader-chip" id="dyn-leader-chip" data-leader="' + (brd.leader_score | 0) + '">👑 ' + escapeHtml(brd.leader_name) + ': ' + brd.leader_score.toLocaleString() + '</span>';
        }
      }
      sub.innerHTML = selfChip + leaderChip;
    } else {
      bar.classList.add('practice');
      title.textContent = 'משחק חופשי';
      var pdiff = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label]
        ? DIFFICULTY_PRESETS[sessionDifficulty.label]
        : DIFFICULTY_PRESETS.default;
      // Compact single-line subtitle. Previously this was "<chip> · תתחרה על
      // לוח המובילים 🏆" which wrapped to a second line on narrow phones,
      // stealing pixels from grid-wrap → fitGrid shrank every cell. Now: chip
      // + small trophy icon for "counts toward leaderboard" (or muted "off"
      // when difficulty != default). Tooltip on hover gives the full meaning.
      var lbBadge = sessionDifficulty
        ? '<span title="לא נספר ללוח המובילים" style="color:#A8A6A0;font-size:11px;margin-right:6px">⊘</span>'
        : '<span title="נספר ללוח המובילים" style="margin-right:6px;font-size:12px">🏆</span>';
      sub.innerHTML = '<button class="practice-diff-chip" id="practice-diff-chip" type="button" aria-label="החלף רמת קושי">' +
        pdiff.emoji + ' ' + pdiff.name + ' <span style="opacity:0.6">⌄</span></button>' + lbBadge;
    }
    // Wire the practice difficulty chip (added in practice branch above).
    var pdBtn = document.getElementById('practice-diff-chip');
    if (pdBtn) {
      pdBtn.onclick = function(e) {
        e.stopPropagation();
        showPracticeDifficultyPicker();
      };
    }

    // In contest mode, the mode-info area becomes a tap target that opens
    // the contest leaderboard — this is the fastest "show me the players"
    // path while in-game. Chevron hints that it's interactive.
    if (infoEl) {
      if (mode === 'contest' && activeContestCode) {
        infoEl.classList.add('clickable');
        if (chevEl) chevEl.style.display = '';
        infoEl.onclick = function() {
          saveContestGameState();
          showContestLeaderboard(activeContestCode);
        };
      } else {
        infoEl.classList.remove('clickable');
        if (chevEl) chevEl.style.display = 'none';
        infoEl.onclick = null;
      }
    }

    // Build/update the segmented tab control. The "חברים" tab appears only
    // when the player has an active contest code. Tapping it: with 2+
    // contests, opens the My Contests list so the player can choose; with 1,
    // jumps straight into that contest like before.
    if (!tabsEl) return;
    const tabs = [{ id: 'daily', label: 'יומי' }];
    if (activeContestCode) tabs.push({ id: 'contest', label: 'חברים' });
    tabs.push({ id: 'challenge', label: 'אתגרים' });
    tabs.push({ id: 'practice', label: 'חופשי' });
    tabsEl.innerHTML = tabs.map(function(t) {
      return '<button class="mode-tab' + (t.id === mode ? ' active' : '') +
        '" data-mode="' + t.id + '">' + t.label + '</button>';
    }).join('');
    tabsEl.querySelectorAll('.mode-tab').forEach(function(btn) {
      btn.onclick = function() {
        const target = btn.getAttribute('data-mode');
        if (target === mode && target !== 'contest' && target !== 'challenge') return;
        buzz([12]); // subtle haptic on tab switch
        if (mode === 'contest') saveContestGameState();
        if (mode === 'practice') savePracticeGameState();
        // No saveChallengeGameState — challenges intentionally don't survive navigation.
        if (target === 'contest' && myContestsCountSync() >= 2) {
          showMyContestsList();
          return;
        }
        if (target === 'challenge') {
          // The "אתגרים" tab opens the public challenges hub. It's not an
          // in-game mode you can flip into — you have to pick a specific
          // challenge from the list and confirm before starting.
          // Track entry point so the back arrow returns to the game, not home.
          showChallengesList('in-game');
          return;
        }
        init(target);
      };
    });
  }

  // Picker modal for practice difficulty. Player chooses, we save to
  // localStorage and restart the practice game so the new weights take
  // effect cleanly on a fresh board. Daily/contest/duel use other paths.
  function showPracticeDifficultyPicker() {
    var existing = document.getElementById('pdp-modal');
    if (existing) existing.remove();
    var current = (sessionDifficulty && sessionDifficulty.label) || 'default';
    var modal = document.createElement('div');
    modal.id = 'pdp-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var optionsHtml = '';
    var order = ['default', 'easy', 'medium', 'hard', 'insane'];
    var hints = {
      default: 'משקלי האדמין (ברירת מחדל). הניקוד נספר ללוח המובילים היומי.',
      easy:    'אריחים נמוכים שולטים — נעים לחימום. הניקוד לא נספר ללוח.',
      medium:  'בעיקר tier 2-4 — יותר אתגר. הניקוד לא נספר ללוח.',
      hard:    'בעיקר tier 3-5 — לוח מתמלא מהר, ניקוד גבוה למיזוגים. הניקוד לא נספר ללוח.',
      insane:  'אבן ועלה לא נופלים בכלל. רק לרוצחים סדרתיים. הניקוד לא נספר ללוח.'
    };
    for (var k = 0; k < order.length; k++) {
      var key = order[k];
      var p = DIFFICULTY_PRESETS[key];
      var isCur = key === current;
      optionsHtml += '<button class="pdp-opt" data-diff="' + key + '" style="display:block;width:100%;text-align:right;direction:rtl;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid ' + (isCur ? '#BA7517' : 'rgba(0,0,0,0.08)') + ';background:' + (isCur ? '#FFF6E6' : '#FFFFFF') + ';cursor:pointer;font-family:inherit">' +
        '<div style="font-size:14px;font-weight:700;color:#1C1A18">' + p.emoji + ' ' + p.name + (isCur ? '  <span style="color:#BA7517;font-size:11px">✓ נבחר</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:#6F6E68;margin-top:2px">' + hints[key] + '</div>' +
      '</button>';
    }
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:6px">💪 רמת קושי · אימון חופשי</div>' +
      '<div style="font-size:11px;color:#6F6E68;margin-bottom:12px">בחירת רמה תפתח משחק חדש. רק "רגיל" נספר בלוח המובילים היומי.</div>' +
      optionsHtml +
      '<button class="btn secondary" id="pdp-cancel" style="width:100%;margin-top:6px">בטל</button>' +
    '</div>';
    document.body.appendChild(modal);
    document.getElementById('pdp-cancel').onclick = function() { modal.remove(); };
    modal.querySelectorAll('.pdp-opt').forEach(function(btn) {
      btn.onclick = function() {
        var label = btn.getAttribute('data-diff') || 'default';
        writePracticeDifficulty(label === 'default' ? null : label);
        modal.remove();
        // Fresh game with the new weights — never carry old grid into new difficulty.
        init('practice', { fresh: true });
      };
    });
  }

  function startCountdown() {
    function tick() {
      const el = document.getElementById('countdown-val');
      if (!el) { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
      const remaining = msUntilNextIsraelMidnight();
      el.textContent = formatCountdown(remaining);
      if (remaining <= 0) {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        init('daily');
      }
    }
    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function renderLeaderboard() {
    const isContest = mode === 'contest';
    const headerText = isContest
      ? ((activeContestData && activeContestData.name) ? activeContestData.name : 'תחרות חברים')
      : 'טבלת מובילים · ' + formatDateHe(dailyDate);
    const emptyText = isContest ? 'אין עדיין שחקנים בתחרות' : 'אתה הראשון היום!';
    if (leaderboardLoading) {
      return '<div class="leaderboard"><div class="lb-head"><span>' + escapeHtml(headerText) + '</span></div><div class="lb-loading">טוען…</div></div>';
    }
    if (!leaderboard.length) {
      return '<div class="leaderboard"><div class="lb-head"><span>' + escapeHtml(headerText) + '</span></div><div class="lb-empty">' + emptyText + '</div></div>';
    }
    const topScore = leaderboard[0] ? leaderboard[0].score : 1;
    const rows = leaderboard.slice(0, 15).map(function(row, i) {
      const isYou = row.you;
      const rank = i + 1;
      const seed = isYou ? deviceId : (row.name || 'anon');
      var rankClass = rank === 1 ? ' lb-top1' : rank === 2 ? ' lb-top2' : rank === 3 ? ' lb-top3' : '';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
      // Gap to player above
      var gapText = '';
      if (rank > 1 && isYou && i > 0) {
        var above = leaderboard[i - 1];
        var gap = (above.score || 0) - (row.score || 0);
        if (gap > 0) gapText = '<div class="lb-gap you-gap">↑ עוד ' + gap.toLocaleString() + ' למקום ' + (rank - 1) + '</div>';
      }
      return '<div class="lb-row' + rankClass + (isYou ? ' you' : '') + '">' +
        '<div class="lb-rank">' + medal + '</div>' +
        renderAvatarHtml(seed, 'sm') +
        '<div style="flex:1;overflow:hidden">' +
          '<div class="lb-name">' + escapeHtml(row.name || 'אנונימי') + (isYou ? ' <span style="font-size:10px;opacity:0.7">(אתה)</span>' : '') + '</div>' +
          gapText +
        '</div>' +
        '<div class="lb-score">' + (row.score || 0).toLocaleString() + '</div>' +
      '</div>';
    }).join('');
    var yourRank = -1;
    var yourGapText = '';
    for (var j = 0; j < leaderboard.length; j++) {
      if (leaderboard[j].you) {
        yourRank = j + 1;
        if (j > 0) {
          var gap = (leaderboard[j-1].score || 0) - (leaderboard[j].score || 0);
          if (gap > 0) yourGapText = ' (עוד ' + gap.toLocaleString() + ' נקודות)';
        }
        break;
      }
    }
    var motivationText = '';
    if (yourRank === 1) motivationText = '👑 אתה מוביל!';
    else if (yourRank > 0 && yourRank <= 3) motivationText = '🔥 אתה בטופ 3!' + yourGapText;
    else if (yourRank > 0 && yourRank <= 5) motivationText = '💪 מקום ' + yourRank + yourGapText;
    else if (yourRank > 0) motivationText = '🎯 מקום ' + yourRank + yourGapText;

    return '<div class="leaderboard">' +
      '<div class="lb-head"><span>' + escapeHtml(headerText) + '</span><span>' + leaderboard.length + ' שחקנים</span></div>' +
      '<div class="lb-list">' + rows + '</div>' +
      (motivationText ? '<div style="text-align:center;font-size:12px;font-weight:600;margin-top:8px;color:#BA7517">' + motivationText + '</div>' : '') +
    '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  async function submitAndShowLeaderboard() {
    // Skip score submission during skin trial
    if (skinTrialMode) {
      await loadLeaderboard();
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dailyDate,
          deviceId: deviceId,
          name: (playerName || 'אנונימי').slice(0, 24),
          score: score,
          tier: highestTier,
          drops: dropsCount | 0,
          token: deviceToken,
          country: getCountry() || null
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.rank === 'number') dailyRank = data.rank;
        if (data && typeof data.total === 'number') dailyTotal = data.total;
        // Earn credits for daily completion
        if (!window.__bloomBotActive && mode === 'daily') earnCredits('daily_complete');
        trackEvent('game_over', { mode: mode, score: score, tier: highestTier });
      }
    } catch (e) {
      console.warn('Submit failed:', e);
    }
    // Practice + duel scores also feed the difficulty leaderboard. Daily
    // mode is excluded by design (fairness — the daily seed is uniform and
    // its difficulty is admin-controlled, never per-player).
    submitPracticeOrDuelScore();
    await loadLeaderboard();
  }

  // Writes one row to difficulty_scores per game so the "לפי קושי" tab can
  // aggregate best-per-difficulty across practice + duel without polluting
  // the daily leaderboard. No-op for daily mode and during skin trials.
  function submitPracticeOrDuelScore() {
    if (skinTrialMode) return;
    if (mode !== 'practice') return; // engine uses practice mode for duels too
    if (window.__bloomBotActive) return;
    var label = (sessionDifficulty && sessionDifficulty.label) || 'default';
    var source = window._duelMode ? 'duel' : 'practice';
    try {
      fetch(API_BASE + '/api/score/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dailyDate,
          deviceId: deviceId,
          name: (playerName || 'אנונימי').slice(0, 24),
          score: score,
          tier: highestTier,
          drops: dropsCount | 0,
          token: deviceToken,
          country: getCountry() || null,
          difficulty: label,
          source: source
        })
      }).catch(function() {});
    } catch (e) {}
  }

  async function loadLeaderboard() {
    leaderboardLoading = true;
    const wrap = document.getElementById('grid-wrap');
    if (wrap && wrap.querySelector('.leaderboard')) {
      wrap.querySelector('.leaderboard').outerHTML = renderLeaderboard();
    }
    try {
      const url = API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        leaderboard = (data && data.list) || [];
        if (data && typeof data.rank === 'number') dailyRank = data.rank;
        if (data && typeof data.total === 'number') dailyTotal = data.total;
      }
    } catch (e) {
      console.warn('Load leaderboard failed:', e);
    }
    leaderboardLoading = false;
    if (wrap) render({ over: true, alreadyPlayed: dailySubmitted });
  }

  async function loadContestLeaderboard() {
    if (!activeContestCode) return;
    leaderboardLoading = true;
    const wrap = document.getElementById('grid-wrap');
    if (wrap && wrap.querySelector('.leaderboard')) {
      wrap.querySelector('.leaderboard').outerHTML = renderLeaderboard();
    }
    const data = await fetchContest(activeContestCode);
    if (data && data.players) {
      updateMyWatchersFromContestData(data);
      leaderboard = data.players.map(function(p) {
        const total = (p.score | 0) + (p.liveScore == null ? 0 : (p.liveScore | 0));
        return { name: p.name, score: total, tier: p.tier, you: !!p.you, liveScore: p.liveScore };
      });
      if (data.contest) activeContestData = data.contest;
    }
    leaderboardLoading = false;
    if (wrap) render({ over: true });
  }

  /* ============ LEADERBOARD MODAL (scope × time × difficulty) ============ */
  // Two-axis filter: scope (world / country / difficulty) + period (day/week/month).
  // Difficulty scope adds a third pill row to pick the preset. Admin can hide
  // any scope via gameConfig.leaderboard_tabs_enabled. Last selection persisted
  // to localStorage so a returning player lands where they left off.
  const LB_SCOPE_KEY = 'bloom_lb_scope';
  const LB_PERIOD_KEY = 'bloom_lb_period';
  const LB_DIFF_KEY = 'bloom_lb_difficulty';
  let lbModalScope = localStorage.getItem(LB_SCOPE_KEY) || 'world';
  let lbModalPeriod = localStorage.getItem(LB_PERIOD_KEY) || 'day';
  let lbModalDifficulty = localStorage.getItem(LB_DIFF_KEY) || 'default';
  let lbModalList = [];
  let lbModalLoading = false;
  let lbModalRange = null;
  let lbModalRank = null;
  let lbModalNeedsCountry = false;

  function getEnabledLbTabs() {
    var raw = (typeof gameConfig === 'object' && gameConfig && gameConfig.leaderboard_tabs_enabled) || 'world,country,difficulty';
    var arr = String(raw).split(',').map(function(s) { return s.trim(); })
      .filter(function(s) { return s === 'world' || s === 'country' || s === 'difficulty'; });
    return arr.length ? arr : ['world'];
  }

  function lbScopeLabel(s) {
    if (s === 'country') {
      var cc = getCountry();
      return cc ? (flagEmoji(cc) + ' מדינתי') : '🇮🇱 מדינתי';
    }
    if (s === 'difficulty') return '🎚️ קושי';
    return '🌍 עולמי';
  }
  function lbPeriodLabel(p) { return p === 'month' ? 'חודשי' : p === 'week' ? 'שבועי' : 'יומי'; }

  function openLeaderboardModal() {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('lb-modal')) return;
    const enabled = getEnabledLbTabs();
    if (enabled.indexOf(lbModalScope) < 0) lbModalScope = enabled[0];
    const modal = document.createElement('div');
    modal.id = 'lb-modal';
    modal.className = 'info-modal';

    const scopeBtns = enabled.map(function(s) {
      return '<button class="lb-tab lb-scope-tab" data-scope="' + s + '">' + lbScopeLabel(s) + '</button>';
    }).reverse().join(''); // reversed because the row is direction:ltr inside RTL

    modal.innerHTML =
      '<div class="info-card lb-modal-card" style="direction:rtl;max-width:380px">' +
        '<button class="info-close" id="lb-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div style="text-align:center;margin-bottom:4px"><span style="font-size:22px">🏆</span></div>' +
        '<div class="info-title" style="margin-bottom:6px">טבלת מובילים</div>' +
        (enabled.length > 1 ?
          '<div class="lb-tabs" style="direction:ltr;margin-bottom:4px">' + scopeBtns + '</div>' : '') +
        '<div class="lb-tabs lb-period-tabs" style="direction:ltr;margin-bottom:4px">' +
          '<button class="lb-tab lb-period-tab" data-period="month">חודשי</button>' +
          '<button class="lb-tab lb-period-tab" data-period="week">שבועי</button>' +
          '<button class="lb-tab lb-period-tab" data-period="day">יומי</button>' +
        '</div>' +
        '<div id="lb-diff-row" class="lb-tabs lb-diff-tabs" style="direction:ltr;margin-bottom:4px;display:none">' +
          '<button class="lb-tab lb-diff-tab" data-diff="insane">💀 גהינום</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="hard">🔥 קשה</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="medium">🎯 בינוני</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="easy">😊 קל</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="default">📦 ברירת מחדל</button>' +
        '</div>' +
        '<div id="lb-modal-range" style="font-size:11px;color:#A8A6A0;text-align:center;margin-bottom:6px"></div>' +
        '<div id="lb-modal-body" style="max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch"></div>' +
        '<div id="lb-modal-footer" style="text-align:center;margin-top:8px"></div>' +
        '<div style="text-align:center;margin-top:8px">' +
          '<button class="btn secondary" id="lb-flag-edit" type="button" style="font-size:11px;padding:6px 12px">' +
            (getCountry() ? (flagEmoji(getCountry()) + ' החלף דגל') : '🌍 בחר דגל') +
          '</button>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('lb-modal-close').onclick = closeLeaderboardModal;
    modal.onclick = function(e) { if (e.target === modal) closeLeaderboardModal(); };
    modal.querySelectorAll('.lb-scope-tab').forEach(function(t) {
      t.onclick = function() { switchLbScope(t.getAttribute('data-scope')); };
    });
    modal.querySelectorAll('.lb-period-tab').forEach(function(t) {
      t.onclick = function() { switchLbPeriod(t.getAttribute('data-period')); };
    });
    modal.querySelectorAll('.lb-diff-tab').forEach(function(t) {
      t.onclick = function() { switchLbDifficulty(t.getAttribute('data-diff')); };
    });
    document.getElementById('lb-flag-edit').onclick = function() {
      closeLeaderboardModal();
      promptForCountry(function() { openLeaderboardModal(); });
    };
    refreshLbActiveStates();
    loadLbModal();
  }

  function closeLeaderboardModal() {
    const m = document.getElementById('lb-modal');
    if (m) m.remove();
  }

  function refreshLbActiveStates() {
    document.querySelectorAll('#lb-modal .lb-scope-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-scope') === lbModalScope);
    });
    document.querySelectorAll('#lb-modal .lb-period-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-period') === lbModalPeriod);
    });
    document.querySelectorAll('#lb-modal .lb-diff-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-diff') === lbModalDifficulty);
    });
    const diffRow = document.getElementById('lb-diff-row');
    if (diffRow) diffRow.style.display = lbModalScope === 'difficulty' ? '' : 'none';
  }

  function switchLbScope(scope) {
    lbModalScope = scope;
    try { localStorage.setItem(LB_SCOPE_KEY, scope); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }
  function switchLbPeriod(period) {
    lbModalPeriod = period;
    try { localStorage.setItem(LB_PERIOD_KEY, period); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }
  function switchLbDifficulty(d) {
    lbModalDifficulty = d;
    try { localStorage.setItem(LB_DIFF_KEY, d); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }

  async function loadLbModal() {
    lbModalLoading = true;
    lbModalNeedsCountry = false;
    renderLbModalBody();
    try {
      var qs = 'scope=' + encodeURIComponent(lbModalScope) +
        '&period=' + encodeURIComponent(lbModalPeriod) +
        '&endDate=' + encodeURIComponent(dailyDate) +
        '&deviceId=' + encodeURIComponent(deviceId);
      if (lbModalScope === 'difficulty') qs += '&difficulty=' + encodeURIComponent(lbModalDifficulty);
      if (lbModalScope === 'country' && getCountry()) qs += '&country=' + encodeURIComponent(getCountry());
      const url = API_BASE + '/api/leaderboard/v2?' + qs;
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        lbModalList = (data && data.list) || [];
        lbModalRange = data ? { from: data.from, to: data.to, total: data.total } : null;
        lbModalRank = data && typeof data.rank === 'number' ? data.rank : null;
        lbModalNeedsCountry = !!(data && data.needsCountry);
      } else {
        lbModalList = []; lbModalRange = null; lbModalRank = null;
      }
    } catch (e) {
      console.warn('Load lb-modal failed:', e);
      lbModalList = []; lbModalRange = null; lbModalRank = null;
    }
    lbModalLoading = false;
    renderLbModalBody();
  }

  function renderLbModalBody() {
    const body = document.getElementById('lb-modal-body');
    const rangeEl = document.getElementById('lb-modal-range');
    const footerEl = document.getElementById('lb-modal-footer');
    if (!body) return;
    if (lbModalLoading) {
      body.innerHTML = '<div class="lb-loading">טוען…</div>';
      if (rangeEl) rangeEl.textContent = '';
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    // Range text
    if (rangeEl && lbModalRange) {
      var rangeStr = (lbModalPeriod === 'day')
        ? formatDateHe(lbModalRange.to) + ' · ' + (lbModalRange.total || 0) + ' שחקנים'
        : formatDateHe(lbModalRange.from) + ' – ' + formatDateHe(lbModalRange.to) + ' · ' + (lbModalRange.total || 0) + ' שחקנים';
      if (lbModalScope === 'difficulty') {
        var DIFF_NAMES = { default: '📦 ברירת מחדל', easy: '😊 קל', medium: '🎯 בינוני', hard: '🔥 קשה', insane: '💀 גהינום' };
        rangeStr = (DIFF_NAMES[lbModalDifficulty] || lbModalDifficulty) + ' · ' + rangeStr;
      } else if (lbModalScope === 'country' && getCountry()) {
        rangeStr = flagEmoji(getCountry()) + ' ' + countryName(getCountry()) + ' · ' + rangeStr;
      }
      rangeEl.textContent = rangeStr;
    }
    if (lbModalNeedsCountry) {
      body.innerHTML =
        '<div class="lb-empty" style="padding:24px 16px;text-align:center">' +
          '<div style="font-size:32px;margin-bottom:8px">🌍</div>' +
          '<div style="margin-bottom:10px">בחר את המדינה שלך כדי לראות את הטבלה המדינית</div>' +
          '<button class="btn" type="button" id="lb-empty-flag">בחר דגל</button>' +
        '</div>';
      var btn = document.getElementById('lb-empty-flag');
      if (btn) btn.onclick = function() {
        closeLeaderboardModal();
        promptForCountry(function() { openLeaderboardModal(); });
      };
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    if (!lbModalList.length) {
      body.innerHTML = '<div class="lb-empty">אין עדיין ניקודים בטווח הזה</div>';
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    const topScore = lbModalList[0] ? lbModalList[0].score : 1;
    const showFlag = lbModalScope === 'world';
    const rows = lbModalList.slice(0, 50).map(function(row, i) {
      const isYou = row.you;
      const rank = i + 1;
      const seed = isYou ? deviceId : (row.name || 'anon');
      var rankClass = rank === 1 ? ' lb-top1' : rank === 2 ? ' lb-top2' : rank === 3 ? ' lb-top3' : '';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
      var gapText = '';
      if (rank > 1 && isYou && i > 0) {
        var above = lbModalList[i - 1];
        var gap = (above.score || 0) - (row.score || 0);
        if (gap > 0) gapText = '<div class="lb-gap you-gap">↑ עוד ' + gap.toLocaleString() + ' למקום ' + (rank - 1) + '</div>';
      }
      var flagHtml = '';
      if (showFlag) {
        var rowCc = row.country || '';
        flagHtml = '<span class="lb-flag" title="' + (rowCc ? countryName(rowCc) : 'לא צוין') + '">' +
          (rowCc ? flagEmoji(rowCc) : '🏳️') + '</span>';
      }
      // Challenge affordance — only on rows with a known BLOOM code and not "you".
      var canChallenge = !isYou && row.player_code && /^BLOOM-[A-HJ-NP-Z2-9]{4}$/.test(row.player_code);
      var rowExtra = canChallenge ? ' lb-row-challengeable" data-pcode="' + row.player_code + '" data-pname="' + escapeHtml(row.name || 'אנונימי') + '"' : '"';
      var challengeBtn = canChallenge ? '<button class="lb-row-challenge" type="button" data-challenge title="אתגר ל-1v1">⚔️</button>' : '';
      return '<div class="lb-row' + rankClass + (isYou ? ' you' : '') + rowExtra + '>' +
        '<div class="lb-rank">' + medal + '</div>' +
        renderAvatarHtml(seed, 'sm') +
        '<div style="flex:1;overflow:hidden">' +
          '<div class="lb-name">' + escapeHtml(row.name || 'אנונימי') + flagHtml + (isYou ? ' <span style="font-size:10px;opacity:0.7">(אתה)</span>' : '') + '</div>' +
          gapText +
        '</div>' +
        '<div class="lb-score">' + (row.score || 0).toLocaleString() + '</div>' +
        challengeBtn +
      '</div>';
    }).join('');
    body.innerHTML = '<div class="lb-list">' + rows + '</div>';

    // Delegated click handler — challenge a leaderboard row by tapping it or
    // the ⚔️ button. Opens the duel modal with the suffix pre-filled.
    var listEl = body.querySelector('.lb-list');
    if (listEl) {
      listEl.addEventListener('click', function(e) {
        var rowEl = e.target.closest('.lb-row-challengeable');
        if (!rowEl) return;
        var code = rowEl.getAttribute('data-pcode') || '';
        if (!code) return;
        var suffix = code.replace(/^BLOOM-/, '');
        closeLeaderboardModal();
        if (typeof showDuelModal === 'function') {
          setTimeout(function() { showDuelModal({ prefillSuffix: suffix }); }, 120);
        }
      });
    }

    // Motivation footer
    if (footerEl) {
      var yourRank = lbModalRank || -1;
      if (yourRank <= 0) {
        for (var j = 0; j < lbModalList.length; j++) { if (lbModalList[j].you) { yourRank = j + 1; break; } }
      }
      var mot = '';
      var gapToAbove = '';
      if (yourRank > 1) {
        for (var k = 0; k < lbModalList.length; k++) {
          if (lbModalList[k].you && k > 0) {
            var gap = (lbModalList[k-1].score || 0) - (lbModalList[k].score || 0);
            if (gap > 0) gapToAbove = ' (עוד ' + gap.toLocaleString() + ' נקודות)';
            break;
          }
        }
      }
      if (yourRank === 1) mot = '<span style="font-size:13px;font-weight:700;color:#BA7517">👑 אתה מוביל!</span>';
      else if (yourRank > 0 && yourRank <= 3) mot = '<span style="font-size:13px;font-weight:700;color:#BA7517">🔥 אתה בטופ 3!' + gapToAbove + '</span>';
      else if (yourRank > 0 && yourRank <= 5) mot = '<span style="font-size:12px;font-weight:600;color:#BA7517">💪 מקום #' + yourRank + gapToAbove + '</span>';
      else if (yourRank > 0 && yourRank <= 10) mot = '<span style="font-size:12px;font-weight:600;color:#6F6E68">⬆️ מקום #' + yourRank + gapToAbove + '</span>';
      else if (yourRank > 0) mot = '<span style="font-size:12px;color:#6F6E68">🎯 מקום #' + yourRank + gapToAbove + '</span>';
      footerEl.innerHTML = mot;
    }
  }

  // Flag picker — shown once after the name picker on first home view, then
  // never again unless the user reopens it from the leaderboard modal. Null
  // (skipped) is a valid final state: country tab simply excludes those rows.
  function promptForCountry(cb) {
    var wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('country-modal')) { cb && cb(); return; }
    var modal = document.createElement('div');
    modal.id = 'country-modal';
    modal.className = 'info-modal';
    var grid = COUNTRY_LIST.map(function(row) {
      return '<button class="country-cell" data-cc="' + row[0] + '" type="button">' +
        '<div style="font-size:28px;line-height:1">' + flagEmoji(row[0]) + '</div>' +
        '<div style="font-size:11px;margin-top:2px;color:#1C1A18">' + row[1] + '</div>' +
      '</button>';
    }).join('');
    modal.innerHTML =
      '<div class="info-card" style="direction:rtl;max-width:420px">' +
        '<button class="info-close" id="country-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div style="text-align:center;margin-bottom:6px"><span style="font-size:28px">🌍</span></div>' +
        '<div class="info-title" style="margin-bottom:2px">מאיפה אתה משחק?</div>' +
        '<div class="info-sub" style="margin-bottom:10px">הדגל יופיע ליד הניקוד שלך בטבלה. נשמר במכשיר — אפשר לשנות בהמשך.</div>' +
        '<input class="name-input" id="country-search" type="search" autocapitalize="words" placeholder="🔎 חפש מדינה..." style="margin-bottom:10px" />' +
        '<div id="country-grid" class="country-grid" style="max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:4px 0">' + grid + '</div>' +
        '<div style="margin-top:10px;text-align:center"><button class="btn secondary" id="country-skip" type="button">העדפתי לא לומר</button></div>' +
      '</div>';
    wrap.appendChild(modal);
    var grid_el = document.getElementById('country-grid');
    var search = document.getElementById('country-search');
    function pick(cc) {
      setCountry(cc);
      playerCountry = cc || '';
      trackEvent('country_selected', { country: cc || 'skip' });
      modal.remove();
      cb && cb();
    }
    grid_el.addEventListener('click', function(e) {
      var t = e.target.closest('.country-cell');
      if (!t) return;
      pick(t.getAttribute('data-cc'));
    });
    document.getElementById('country-skip').onclick = function() { pick(''); };
    document.getElementById('country-modal-close').onclick = function() { pick(''); };
    modal.addEventListener('click', function(e) { if (e.target === modal) pick(''); });
    search.addEventListener('input', function() {
      var q = (search.value || '').trim().toLowerCase();
      var cells = grid_el.querySelectorAll('.country-cell');
      cells.forEach(function(c) {
        if (!q) { c.style.display = ''; return; }
        var cc = (c.getAttribute('data-cc') || '').toLowerCase();
        var name = (c.textContent || '').toLowerCase();
        c.style.display = (cc.indexOf(q) >= 0 || name.indexOf(q) >= 0) ? '' : 'none';
      });
    });
    setTimeout(function() { search && search.focus(); }, 50);
  }

  function promptForName(cb, opts) {
    opts = opts || {};
    const wrap = document.getElementById('grid-wrap') || document.body;
    if (!wrap || document.getElementById('name-modal')) { cb && cb(); return; }
    const modal = document.createElement('div');
    modal.id = 'name-modal';
    modal.className = 'info-modal';
    const isEdit = !!opts.edit;
    const prefillVal = (opts.prefill || (isEdit ? (playerName || '') : '')).replace(/"/g, '&quot;');
    modal.innerHTML =
      '<div class="info-card">' +
        '<div class="info-title">' + (isEdit ? 'עריכת שם' : 'איך לקרוא לך בטבלת המובילים?') + '</div>' +
        '<div class="info-sub">' + (isEdit ? 'השם יתעדכן בכל הטבלאות מיד.' : 'השם יישמר במכשיר ויופיע ליד התוצאה שלך.') + '</div>' +
        '<input class="name-input" id="name-input" autocapitalize="words" maxlength="24" placeholder="השם שלך" value="' + prefillVal + '" />' +
        '<button class="btn" id="name-save">שמור</button>' +
        '<button class="btn secondary" id="name-skip">' + (isEdit ? 'בטל' : 'דלג') + '</button>' +
      '</div>';
    wrap.appendChild(modal);
    const input = document.getElementById('name-input');
    setTimeout(function() {
      if (input) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
      }
    }, 50);
    function maybeChainCountry(after) {
      // Only chain the flag picker on the very first name-pick (no stored
      // country yet). Returning users keep the picker behind the leaderboard
      // modal's "edit my flag" affordance — don't interrupt their flow.
      if (isEdit) { after(); return; }
      if (!getCountry()) promptForCountry(after);
      else after();
    }
    function syncServerName(name) {
      if (!name || name === 'אנונימי') return;
      try {
        fetch(API_BASE + '/api/profile/name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, name: name })
        }).catch(function() {});
      } catch (e) {}
    }
    function save() {
      const v = (input.value || '').trim().slice(0, 24);
      if (v) {
        playerName = v;
        localStorage.setItem(NAME_KEY, v);
        syncServerName(v);
      }
      modal.remove();
      maybeChainCountry(function() { cb && cb(); });
    }
    function skip() {
      // 1.2-mod — playerName always has at least the deterministic default
      // ("שחקן XXXX"), so we don't fall back to "אנונימי" anymore. Skipping
      // simply leaves whatever was there (default or previously-saved name).
      modal.remove();
      if (isEdit) { cb && cb(); return; }
      maybeChainCountry(function() { cb && cb(); });
    }
    document.getElementById('name-save').onclick = save;
    document.getElementById('name-skip').onclick = skip;
    input.onkeydown = function(e) { if (e.key === 'Enter') save(); };
  }

  // Drop pool resolution order:
  //   1) sessionDifficulty (per-game override: contest host / duel challenger / practice picker)
  //   2) gameConfig.drop_weights (admin global)
  //   3) WEIGHTS (the original 55/28/12/5 fallback)
  // Empty/malformed/all-zero at any layer falls through to the next.
  function getDropWeights() {
    var raw = '';
    if (sessionDifficulty && sessionDifficulty.weights) {
      raw = sessionDifficulty.weights;
    } else if (typeof gameConfig === 'object' && gameConfig && gameConfig.drop_weights) {
      raw = gameConfig.drop_weights;
    }
    if (!raw) return WEIGHTS;
    var parts = String(raw).split(',').map(function(x) { return parseInt(x, 10) || 0; });
    while (parts.length < 8) parts.push(0);
    parts.length = 8;
    var total = parts.reduce(function(a,b) { return a + Math.max(0, b); }, 0);
    if (total <= 0) return WEIGHTS;
    // Prepend the always-zero tier-0 slot so indices line up with the rest
    // of the engine (grid uses 1..MAX_TIER, 0 = empty).
    return [0, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]];
  }

  function pickPiece() {
    var weights = getDropWeights();
    var total = 0;
    for (var k = 1; k < weights.length; k++) total += Math.max(0, weights[k]);
    if (total <= 0) return 1;
    var r = rng() * total;
    for (var i = 1; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return i;
    }
    return 1;
  }

  // Speed resolution mirrors getDropWeights: session override → admin global
  // → default 100%. 50 = 2× faster, 100 = default, 200 = half-speed. Clamped
  // to [25, 400] so misconfig can't make the engine instant or unplayably slow.
  function gameSpeedScale() {
    var pct = 100;
    if (sessionDifficulty && sessionDifficulty.speed_pct) {
      pct = parseInt(sessionDifficulty.speed_pct, 10) || 100;
    } else {
      pct = parseInt((gameConfig && gameConfig.game_speed_pct) || '100', 10) || 100;
    }
    if (pct < 25) pct = 25;
    if (pct > 400) pct = 400;
    return pct / 100;
  }
  function gsleep(ms) { return sleep(Math.round(ms * gameSpeedScale())); }

  // Helper: is the tile at (r,c) "frozen" — i.e. sitting on a frozen
  // special cell? Frozen tiles are anchored: they don't fall with
  // gravity, and they refuse to participate in merge groups. The cell
  // itself stays frozen even after the tile clears (it's a board
  // property, not a per-tile state).
  function isFrozenAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'frozen');
  }
  function isElectricAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'electric');
  }
  // Locked: blocks drops + gravity until gameTotalMerges reaches its
  // unlock_after threshold, at which point the cell becomes regular
  // (unlocked flag set on the entry). The check returns true ONLY for
  // still-locked cells — open cells behave as plain empty squares.
  function isLockedAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'locked' && !sc.unlocked);
  }
  function isTeleportAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'teleport');
  }

  // Teleport spiral animation (phase 3G).
  // A purple spiral at the OLD position (tile vanishes) + matching
  // spiral at the NEW position (tile materializes). Fires before/after
  // the actual grid mutation in the drop handler.
  function triggerTeleportAnimation(fromR, fromC, toR, toC) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cols = getBoardCols();
    var fromCell = gridEl.children[fromR * cols + fromC];
    var toCell = gridEl.children[toR * cols + toC];
    function spawnSpiral(rect, kind) {
      var spiral = document.createElement('div');
      spiral.className = 'teleport-spiral teleport-spiral-' + kind;
      spiral.style.left = (rect.left + rect.width / 2) + 'px';
      spiral.style.top  = (rect.top + rect.height / 2) + 'px';
      spiral.textContent = '🌀';
      document.body.appendChild(spiral);
      setTimeout(function() { spiral.remove(); }, 600);
    }
    if (fromCell) spawnSpiral(fromCell.getBoundingClientRect(), 'out');
    if (toCell) {
      var toRect = toCell.getBoundingClientRect();
      setTimeout(function() { spawnSpiral(toRect, 'in'); }, 220);
    }
    if (typeof soundDrop === 'function') {
      try { soundDrop(); } catch (e) {}
    }
  }

  // Locked-cell unlock check (phase 3F).
  // After each merge, scan locked cells: if gameTotalMerges has reached
  // the cell's unlock_after threshold, flip its unlocked flag. The cell
  // visually transforms from a 🔒 wall to a regular empty square — the
  // unlock burst is fired here too.
  function checkLockedUnlocks() {
    if (typeof getSpecialCells !== 'function') return;
    var cells = getSpecialCells();
    if (!cells || !cells.length) return;
    for (var i = 0; i < cells.length; i++) {
      var sc = cells[i];
      if (sc.type !== 'locked' || sc.unlocked) continue;
      if (gameTotalMerges < (sc.unlock_after | 0)) continue;
      sc.unlocked = true;
      try { triggerUnlockBurst(sc.row, sc.col); } catch (e) {}
    }
  }

  function triggerUnlockBurst(r, c) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cell = gridEl.children[r * getBoardCols() + c];
    if (!cell) return;
    var rect = cell.getBoundingClientRect();
    var burst = document.createElement('div');
    burst.className = 'unlock-burst';
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top  = (rect.top + rect.height / 2) + 'px';
    burst.innerHTML =
      '<span class="ub-icon">🔓</span>' +
      '<span class="ub-flash"></span>' +
      '<span class="ub-label">נפתח!</span>';
    document.body.appendChild(burst);
    setTimeout(function() { burst.remove(); }, 900);
    if (typeof soundMilestone === 'function') {
      try { soundMilestone(3); } catch (e) {}
    }
    if (typeof buzz === 'function') buzz([30, 50, 30]);
    // Re-render so the cell loses its locked class immediately.
    if (typeof render === 'function') render();
  }

  // Electric flash + bolt burst (phase 3E).
  // Fired after every merge whose group included at least one tile on an
  // electric special cell. All cells in the group flash yellow; from each
  // electric cell, 8 ⚡ emojis shoot outward in cardinal + diagonal
  // directions for a "lightning strike" feel. The bigger the group, the
  // more dramatic the visual.
  function triggerElectricFlash(groupCells) {
    if (!groupCells || !groupCells.length) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cols = getBoardCols();
    var electricSeeds = [];
    // Flash every cell in the merge group with a yellow electric pulse.
    for (var i = 0; i < groupCells.length; i++) {
      var p = groupCells[i];
      var idx = p[0] * cols + p[1];
      var cellEl = gridEl.children[idx];
      if (cellEl) {
        cellEl.classList.add('electric-flash');
        // self-cleanup: the animation is 500ms; remove right after so a
        // subsequent merge can flash the same cell again.
        (function(el) {
          setTimeout(function() { el.classList.remove('electric-flash'); }, 520);
        })(cellEl);
      }
      if (isElectricAt(p[0], p[1])) electricSeeds.push(p);
    }
    // Burst ⚡ emojis from each electric cell — 8 directions per cell.
    var DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    for (var i = 0; i < electricSeeds.length; i++) {
      var p = electricSeeds[i];
      var idx = p[0] * cols + p[1];
      var cellEl = gridEl.children[idx];
      if (!cellEl) continue;
      var rect = cellEl.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var bolt = document.createElement('div');
        bolt.className = 'electric-bolt electric-bolt-' + DIRECTIONS[d];
        bolt.textContent = '⚡';
        bolt.style.left = cx + 'px';
        bolt.style.top = cy + 'px';
        document.body.appendChild(bolt);
        (function(b) {
          setTimeout(function() { b.remove(); }, 720);
        })(bolt);
      }
    }
    // Audio: at least a chain-style zap if the helper exists.
    try {
      if (electricSeeds.length && typeof soundChain === 'function') {
        soundChain(Math.min(4, groupCells.length));
      }
      if (typeof buzz === 'function') buzz([20, 30, 20]);
    } catch (e) {}
  }

  // Frozen-cell adjacent-thaw mechanic (phase 3D+).
  // When a merge happens at (mergeRow, mergeCol), any frozen-with-tile
  // cell that's orthogonally adjacent gets a crack. After 3 cracks the
  // tile shatters: it's removed, score gets a shatter bonus, and the
  // frozen cell goes back to empty (ready to freeze the next tile).
  // This turns frozen from "stuck until bomb" → strategic puzzle:
  // merge near the ice to thaw it.
  function checkFrozenThawAdjacent(mergeRow, mergeCol) {
    var deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var rows = getBoardRows(), cols = getBoardCols();
    for (var i = 0; i < deltas.length; i++) {
      var nr = mergeRow + deltas[i][0];
      var nc = mergeCol + deltas[i][1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (!isFrozenAt(nr, nc) || grid[nr][nc] === 0) continue;
      var key = nr + ',' + nc;
      _frozenThawProgress[key] = (_frozenThawProgress[key] || 0) + 1;
      if (_frozenThawProgress[key] >= FROZEN_THAW_THRESHOLD) {
        thawFrozenTile(nr, nc);
        delete _frozenThawProgress[key];
      }
    }
  }

  // Read-only accessor for render() to paint crack frames.
  function getFrozenThawCount(r, c) {
    return _frozenThawProgress[r + ',' + c] || 0;
  }

  function thawFrozenTile(r, c) {
    if (grid[r][c] === 0) return;
    score += FROZEN_SHATTER_BONUS;
    grid[r][c] = 0;
    try {
      var gridElT = document.getElementById('grid');
      if (gridElT) {
        var tIdx = r * getBoardCols() + c;
        var tCell = gridElT.children[tIdx];
        if (tCell) {
          // Burst overlay anchored to the cell. CSS handles the
          // shatter animation (icicle pieces flying out).
          var rect = tCell.getBoundingClientRect();
          var burst = document.createElement('div');
          burst.className = 'frozen-shatter-burst';
          burst.style.left = (rect.left + rect.width / 2) + 'px';
          burst.style.top = (rect.top + rect.height / 2) + 'px';
          burst.innerHTML =
            '<span class="fs-ice fs-ice-1">❄️</span>' +
            '<span class="fs-ice fs-ice-2">❄️</span>' +
            '<span class="fs-ice fs-ice-3">❄️</span>' +
            '<span class="fs-ice fs-ice-4">❄️</span>' +
            '<span class="fs-burst-amount">+' + FROZEN_SHATTER_BONUS + '</span>';
          document.body.appendChild(burst);
          setTimeout(function() { burst.remove(); }, 900);
        }
      }
      if (typeof soundMerge === 'function') soundMerge(2);
      if (typeof buzz === 'function') buzz([30, 50]);
    } catch (e) {}

    // Phase 3D++: relocate the frozen cell to a random empty spot if
    // admin enabled the "shatter relocate" mode for this board. Runs
    // AFTER the shatter burst (550ms) so the player sees: shatter at
    // old position → toast → new ice forming at new position.
    var board = window._activeSpecialBoard;
    var relocateMode = (board && board.definition && board.definition.relocate_mode) || 'static';
    if (relocateMode === 'shatter') {
      setTimeout(function() { relocateFrozenCellRandomly(r, c); }, 550);
    }
  }

  // Pick a random empty non-special cell on the board and move the frozen
  // cell at (fromR, fromC) there. If no candidate exists (rare — full
  // board or all special), the frozen cell silently disappears.
  function relocateFrozenCellRandomly(fromR, fromC) {
    if (typeof moveSpecialCellInPlace !== 'function') return;
    var rows = getBoardRows(), cols = getBoardCols();
    var candidates = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (r === fromR && c === fromC) continue;
        if (getSpecialCellAt(r, c)) continue;     // skip other special cells
        if (grid[r][c] !== 0) continue;            // skip filled cells
        candidates.push([r, c]);
      }
    }
    if (!candidates.length) {
      // Nowhere to go — frozen cell disappears. Drop it from the map.
      if (typeof setSpecialCells === 'function' && typeof getSpecialCells === 'function') {
        var cur = getSpecialCells() || [];
        var filtered = cur.filter(function(x) { return !(x.row === fromR && x.col === fromC); });
        setSpecialCells(filtered);
        if (typeof render === 'function') render();
      }
      return;
    }
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    var moved = moveSpecialCellInPlace(fromR, fromC, pick[0], pick[1]);
    if (!moved) return;
    showFrozenRelocateToast(pick[0], pick[1]);
    if (typeof render === 'function') render();
  }

  // Per-type visual identity for the relocate animations. Keep parallel
  // to the in-game .cell.special-* CSS so the flying emoji matches the
  // ring it's about to land in.
  var SPECIAL_FLY_STYLE = {
    gold:   { emoji: '✨', color: '#FAC775' },
    bonus:  { emoji: '🪙', color: '#4FBD8B' },
    frozen: { emoji: '❄️', color: '#6FB7E0' }
  };

  // Reshuffle every empty special cell to a new random empty non-special
  // position. Cells with tiles on them stay put (a frozen-with-tile is
  // still a puzzle to solve, gold/bonus cells with merging tiles in
  // mid-chain shouldn't be yanked mid-action).
  // Each move animates: a flying emoji arcs from old → new position
  // while a sparkle bursts at arrival. Moves are STAGGERED 110ms apart
  // so the player can see each one — feels like the board is alive.
  function reshuffleAllSpecialCells() {
    if (typeof getSpecialCells !== 'function' || typeof moveSpecialCellInPlace !== 'function') return;
    var cells = getSpecialCells();
    if (!cells || !cells.length) return;
    var rows = getBoardRows(), cols = getBoardCols();

    // Only cells without a tile on them are eligible for reshuffle.
    // Locked cells are also pinned — their position is the contract
    // between board state and player expectation ("close until N merges").
    var shuffleable = [];
    for (var i = 0; i < cells.length; i++) {
      var sc = cells[i];
      if (sc.type === 'locked' && !sc.unlocked) continue;   // locked stays
      if (grid[sc.row][sc.col] === 0) {
        // Preserve per-type fields when shuffling. The mover only
        // mutates row/col on the same entry object.
        shuffleable.push({ row: sc.row, col: sc.col, type: sc.type });
      }
    }
    if (!shuffleable.length) return;

    // Enumerate empty non-special positions as candidate targets.
    // Locked cells aren't empty in the gameplay sense — exclude them.
    var targets = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (getSpecialCellAt(r, c)) continue;
        if (isLockedAt(r, c)) continue;
        if (grid[r][c] !== 0) continue;
        targets.push([r, c]);
      }
    }
    if (!targets.length) return;

    // Fisher–Yates shuffle the target pool.
    for (var i = targets.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = targets[i]; targets[i] = targets[j]; targets[j] = t;
    }

    // Pair each shuffleable cell with a unique target.
    var moves = [];
    for (var i = 0; i < Math.min(shuffleable.length, targets.length); i++) {
      var src = shuffleable[i];
      var dst = targets[i];
      // Skip no-ops (target same as source — rare but possible after RNG).
      if (src.row === dst[0] && src.col === dst[1]) continue;
      moves.push({ from: [src.row, src.col], to: [dst[0], dst[1]], type: src.type });
    }
    if (!moves.length) return;

    // Capture pre-move bounding rects BEFORE mutating — DOM coords don't
    // change during render (grid size is stable) but capturing now keeps
    // the animation independent of any concurrent re-render races.
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var coords = moves.map(function(m) {
      var fIdx = m.from[0] * cols + m.from[1];
      var tIdx = m.to[0] * cols + m.to[1];
      var fEl = gridEl.children[fIdx];
      var tEl = gridEl.children[tIdx];
      return {
        from: fEl ? fEl.getBoundingClientRect() : null,
        to:   tEl ? tEl.getBoundingClientRect() : null
      };
    });

    // Mutate special cells + re-render so the new rings appear at the
    // destinations. The flying emojis play ON TOP, drawing the eye
    // from old → new so the player can follow each move.
    for (var i = 0; i < moves.length; i++) {
      moveSpecialCellInPlace(moves[i].from[0], moves[i].from[1], moves[i].to[0], moves[i].to[1]);
    }
    if (typeof render === 'function') render();

    // Stagger the fly animations so each one is individually visible.
    for (var i = 0; i < moves.length; i++) {
      (function(m, c, delay) {
        setTimeout(function() {
          if (c.from && c.to) animateSpecialCellFly(c.from, c.to, m.type);
        }, delay);
      })(moves[i], coords[i], i * 110);
    }

    // One soft chime for the whole reshuffle — not per-move (would be loud).
    try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
  }

  // The flight animation: a big emoji shoots from `fromRect` to `toRect`
  // along a curved path (CSS arc via translate), spinning 720° and
  // briefly scaling up. Lands with a sparkle burst at the destination.
  function animateSpecialCellFly(fromRect, toRect, type) {
    var style = SPECIAL_FLY_STYLE[type] || SPECIAL_FLY_STYLE.gold;
    // Mid-point lifted UP for a satisfying arc (visual gravity reversed).
    var midX = (fromRect.left + toRect.left) / 2 + fromRect.width / 2;
    var midY = Math.min(fromRect.top, toRect.top) - 40;  // 40px above the higher of the two
    // Flying emoji
    var flyer = document.createElement('div');
    flyer.className = 'special-fly special-fly-' + type;
    flyer.textContent = style.emoji;
    flyer.style.left = (fromRect.left + fromRect.width / 2) + 'px';
    flyer.style.top  = (fromRect.top + fromRect.height / 2) + 'px';
    // CSS variables drive the keyframe's `to` translate. The browser
    // interpolates linearly between keyframe stops; we add one mid-stop
    // for the arc.
    flyer.style.setProperty('--fly-mid-x', (midX - fromRect.left - fromRect.width / 2) + 'px');
    flyer.style.setProperty('--fly-mid-y', (midY - fromRect.top - fromRect.height / 2) + 'px');
    flyer.style.setProperty('--fly-end-x', (toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2) + 'px');
    flyer.style.setProperty('--fly-end-y', (toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2) + 'px');
    document.body.appendChild(flyer);
    setTimeout(function() { flyer.remove(); }, 700);

    // Sparkle burst at arrival (fires ~500ms in so the emoji is landing).
    setTimeout(function() {
      var arrive = document.createElement('div');
      arrive.className = 'special-arrive special-arrive-' + type;
      arrive.style.left = (toRect.left + toRect.width / 2) + 'px';
      arrive.style.top  = (toRect.top + toRect.height / 2) + 'px';
      arrive.innerHTML =
        '<span class="sa-spark sa-spark-1"></span>' +
        '<span class="sa-spark sa-spark-2"></span>' +
        '<span class="sa-spark sa-spark-3"></span>' +
        '<span class="sa-spark sa-spark-4"></span>';
      document.body.appendChild(arrive);
      setTimeout(function() { arrive.remove(); }, 600);
    }, 520);
  }

  // Top-of-screen toast announcing the relocation + a "❄️ poof" overlay
  // anchored to the new cell so the player can locate it instantly.
  function showFrozenRelocateToast(newR, newC) {
    try {
      // Top banner
      var toast = document.createElement('div');
      toast.className = 'frozen-relocate-toast';
      toast.textContent = '❄️ הקרח קפץ למיקום חדש!';
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 1800);
      // Pulse at new position (after render places the new ice ring there)
      setTimeout(function() {
        var gridEl = document.getElementById('grid');
        if (!gridEl) return;
        var idx = newR * getBoardCols() + newC;
        var cellEl = gridEl.children[idx];
        if (!cellEl) return;
        var rect = cellEl.getBoundingClientRect();
        var pulse = document.createElement('div');
        pulse.className = 'frozen-relocate-pulse';
        pulse.style.left = (rect.left + rect.width / 2) + 'px';
        pulse.style.top = (rect.top + rect.height / 2) + 'px';
        document.body.appendChild(pulse);
        setTimeout(function() { pulse.remove(); }, 1100);
      }, 80);
      if (typeof soundDrop === 'function') soundDrop();
    } catch (e) {}
  }

  function findGroup(sr, sc, tier) {
    const visited = new Set();
    const group = [];
    const stack = [[sr, sc]];
    while (stack.length) {
      const pos = stack.pop();
      const r = pos[0], c = pos[1];
      const k = r * getBoardCols() + c;
      if (visited.has(k)) continue;
      if (r < 0 || r >= getBoardRows() || c < 0 || c >= getBoardCols()) continue;
      // Shape voids (phase 5) — inactive cells are walls; BFS can't
      // cross them OR be seeded by them.
      if (isShapeInactiveAt(r, c)) continue;
      if (grid[r][c] !== tier) continue;
      // Dynamic Boards — Frozen (phase 3D): tiles sitting on a frozen
      // special cell are inert. They count as "blocked" — the BFS treats
      // them as if they were the wrong tier. This prevents both being a
      // group seed AND being absorbed into a neighbor's group.
      if (isFrozenAt(r, c)) continue;
      visited.add(k);
      group.push([r, c]);
      stack.push([r-1,c], [r+1,c], [r,c-1], [r,c+1]);
      // Dynamic Boards — Electric (phase 3E): when the BFS visits a
      // tile on an electric cell, it ALSO queues 8 extra positions —
      // the 4 diagonals + the 4 orthogonals at radius 2. This means an
      // electric cell can absorb same-tier tiles that aren't directly
      // adjacent, producing cross-board mega-merges. visited keeps the
      // BFS bounded (each cell processed once even if multiple electric
      // cells reach it).
      if (isElectricAt(r, c)) {
        stack.push(
          [r-2, c], [r+2, c], [r, c-2], [r, c+2],          // radius-2 orthogonals
          [r-1, c-1], [r-1, c+1], [r+1, c-1], [r+1, c+1]   // diagonals
        );
      }
    }
    return group;
  }

  function applyGravity() {
    var moves = 0;
    for (let c = 0; c < getBoardCols(); c++) {
      // Walk bottom-up. Anchors block gravity:
      //   - frozen tiles (cell + tile combo) — phase 3D
      //   - locked cells (empty but closed) — phase 3F
      // Both snap the write cursor to row-1 so subsequent falling
      // tiles stack ABOVE the anchor without overwriting.
      let w = getBoardRows() - 1;
      for (let r = getBoardRows() - 1; r >= 0; r--) {
        // Shape voids (phase 5) — walls that block gravity downward.
        // Snap the write cursor above them just like locked / frozen.
        if (isShapeInactiveAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        // Locked cells are empty walls — block before checking grid.
        if (isLockedAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        if (grid[r][c] === 0) continue;
        if (isFrozenAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        if (r !== w) { grid[w][c] = grid[r][c]; grid[r][c] = 0; moves++; }
        w--;
      }
    }
    if (window.__bloomEngineLog) console.log('[gravity]', 'moves=' + moves, 'grid=' + serializeGrid());
  }
  // Compact one-line grid serialization for engine logs. Each row is printed
  // bottom-up as 4 digits (0 = empty, 1-8 = tier). Lets the user paste a
  // console line and instantly see the board state at that moment.
  function serializeGrid() {
    var s = '';
    for (var r = getBoardRows() - 1; r >= 0; r--) {
      var row = '';
      for (var c = 0; c < getBoardCols(); c++) row += (grid[r][c] | 0);
      s += row + (r === 0 ? '' : '|');
    }
    return s;
  }
  // Expose to window so the user can call from devtools console to dump
  // state at any moment ("why is this tile floating?").
  window.__bloomDumpGrid = function() {
    var lines = [];
    for (var r = 0; r < getBoardRows(); r++) {
      var row = '';
      for (var c = 0; c < getBoardCols(); c++) {
        var v = grid[r][c] | 0;
        row += v === 0 ? '·' : v;
      }
      lines.push('r' + r + ' ' + row);
    }
    console.log('[grid dump]\n' + lines.join('\n'));
    return grid.map(function(r) { return r.slice(); });
  };

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function showFloatingScore(row, col, points, chainCount) {
    const gridEl = document.getElementById('grid');
    if (!gridEl) return;
    const cellIdx = row * getBoardCols() + col;
    const cell = gridEl.children[cellIdx];
    if (!cell) return;
    const cellRect = cell.getBoundingClientRect();
    const fl = document.createElement('div');
    fl.className = 'float-score';
    fl.textContent = '+' + points.toLocaleString();
    if (chainCount >= 3) { fl.style.fontSize = '18px'; fl.style.background = '#EF9F27'; fl.style.color = '#412402'; fl.style.boxShadow = '0 4px 12px rgba(239,159,39,0.4)'; }
    else if (chainCount >= 2) { fl.style.fontSize = '16px'; }
    fl.style.position = 'fixed';
    fl.style.left = cellRect.left + cellRect.width / 2 + 'px';
    fl.style.top = cellRect.top + 'px';
    document.body.appendChild(fl);
    setTimeout(function() { fl.remove(); }, 1100);
  }

  function showChainBadge(chainCount, multiplier) {
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#EF9F27;color:#412402;font-weight:900;font-size:' + (18 + chainCount * 2) + 'px;padding:10px 24px;border-radius:24px;letter-spacing:0.05em;pointer-events:none;text-align:center;box-shadow:0 6px 20px rgba(239,159,39,0.4);animation:chainPop 0.75s ease-out forwards';
    badge.textContent = '🔥 שרשרת ×' + multiplier;
    document.body.appendChild(badge);
    setTimeout(function() { badge.remove(); }, 750);
  }

  // First-time-tier-up celebration. Bigger, slower, gold-on-black banner.
  // Fires at most once per (tier, game) — checked at the call site.
  function showMilestoneBanner(tier, bonusPts) {
    const t = (getActiveTiers() && getActiveTiers()[tier]) || { name: 'דרגה ' + tier, emoji: '⭐' };
    showTransientBanner({
      tag: 'tier-up',
      holdMs: 1200, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#1C1A18,#412402);color:#FAC775;border:2px solid #FAC775;border-radius:18px;padding:16px 26px;pointer-events:auto;text-align:center;direction:rtl;box-shadow:0 12px 36px rgba(0,0,0,0.35);min-width:180px',
      html: '<div style="font-size:16px;font-weight:700;color:#FFD37A;margin-bottom:4px">' + t.emoji + ' ' + escapeHtml(t.name) + '</div>' +
        '<div style="font-size:32px;font-weight:900">+' + bonusPts.toLocaleString() + '</div>' +
        '<div style="font-size:10px;color:#BA7517;margin-top:4px">בונוס פעם-ראשונה!</div>',
    });
  }

  // Crown Merge explosion — gold wave across the row
  function showCrownExplosion(row) {
    // Full-screen gold flash — uses the same data-bloom-banner sweep so a
    // stuck flash from the previous round can't linger.
    var flash = document.createElement('div');
    flash.setAttribute('data-bloom-banner', 'crown-flash');
    flash.style.cssText = 'position:fixed;inset:0;background:rgba(250,199,117,0.25);z-index:9998;pointer-events:none';
    document.body.appendChild(flash);
    var flashGone = false;
    function killFlash() { if (flashGone) return; flashGone = true; try { flash.remove(); } catch (e) {} }
    setTimeout(function() { flash.style.transition = 'opacity 0.3s'; flash.style.opacity = '0'; }, 200);
    setTimeout(killFlash, 500);
    setTimeout(killFlash, 2000); // safety net for tab-throttling
    // Banner — click-to-dismiss + auto-cleanup via showTransientBanner
    var banner = showTransientBanner({
      tag: 'crown',
      holdMs: 1500, fadeMs: 500,
      exitTransform: 'translate(-50%,-60%) scale(0.9)',
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.5);opacity:0;z-index:9999;background:linear-gradient(135deg,#1C1A18,#412402);color:#FAC775;border:3px solid #FAC775;border-radius:20px;padding:20px 32px;pointer-events:auto;text-align:center;box-shadow:0 0 40px rgba(250,199,117,0.5);min-width:200px;transition:transform 0.3s,opacity 0.2s',
      html: '<div style="font-size:22px;font-weight:800">💥 Crown Merge! 👑</div><div style="font-size:32px;font-weight:900;margin-top:4px">+50,000</div><div style="font-size:12px;color:#BA7517;margin-top:4px">שורה נמחקה!</div>',
      afterAppend: function(el) {
        requestAnimationFrame(function() { el.style.transform = 'translate(-50%,-50%) scale(1)'; el.style.opacity = '1'; });
      },
    });
    showConfetti(40);
    // Flash grid row gold + scale
    var gridEl = document.getElementById('grid');
    if (gridEl) {
      for (var cc = 0; cc < getBoardCols(); cc++) {
        var idx = row * getBoardCols() + cc;
        var cell = gridEl.children[idx];
        if (cell) {
          cell.style.transition = 'background 0.15s,transform 0.15s';
          cell.style.background = '#FAC775';
          cell.style.transform = 'scale(1.1)';
          (function(c) { setTimeout(function() { c.style.background = ''; c.style.transform = ''; c.style.transition = ''; }, 600); })(cell);
        }
      }
    }
  }

  // Score milestone celebrations during gameplay. Tiers MUST match the
  // server's ALLOWED_MILESTONES allowlist in /api/player/earn — anything
  // outside it gets paid the flat base reward instead of the tier amount.
  // Reward values are also mirrored in schema.sql as score_milestone_reward_*
  // so the banner number is what actually lands in the wallet.
  var SCORE_MILESTONES = [
    { at: 10000,   label: '🔥 10K!',   reward: 2 },
    { at: 25000,   label: '⚡ 25K!',   reward: 3 },
    { at: 50000,   label: '⭐ 50K!',   reward: 5 },
    { at: 100000,  label: '💎 100K!',  reward: 10 },
    { at: 250000,  label: '👑 250K!',  reward: 25 },
    { at: 500000,  label: '🌟 500K!',  reward: 50 },
    { at: 1000000, label: '🏆 1M!',    reward: 100 }
  ];
  var scoreMilestonesHit = {};
  // Frozen-cell thaw progress (phase 3D+): "r,c" → adjacent-merge count.
  // When a frozen tile accumulates 3 adjacent merges, it shatters and
  // awards a shatter bonus. Map is reset in init() per fresh game.
  var _frozenThawProgress = {};
  var FROZEN_THAW_THRESHOLD = 3;
  var FROZEN_SHATTER_BONUS = 200;

  function checkScoreMilestones() {
    for (var i = 0; i < SCORE_MILESTONES.length; i++) {
      var m = SCORE_MILESTONES[i];
      if (score >= m.at && !scoreMilestonesHit[m.at]) {
        scoreMilestonesHit[m.at] = true;
        showScoreMilestoneBanner(m.label, m.reward);
        if (m.reward > 0 && !window.__bloomBotActive && !skinTrialMode) {
          // Was 'event_gift' which is clamped to [event_gift_credits_min,
          // event_gift_credits_max] and rate-limited (30s + 20/hr). That
          // both lied about the displayed amount and silently dropped
          // milestones that hit within 30s of each other during chains.
          // Use the dedicated 'score_milestone' action — per-milestone
          // dedup, no rate-limit, tiered amount via score_milestone_reward_<at>.
          earnCredits('score_milestone', { milestone: m.at });
        }
      }
    }
  }

  function showScoreMilestoneBanner(label, reward) {
    showTransientBanner({
      tag: 'milestone',
      holdMs: 1000, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#0F0D0B,#1C1A18);color:#FAC775;border:1px solid rgba(250,199,117,0.3);border-radius:18px;padding:14px 24px;pointer-events:auto;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.3);min-width:160px',
      html: '<div style="font-size:24px;font-weight:900;letter-spacing:0.05em">' + label + '</div>' +
        (reward > 0 ? '<div style="font-size:16px;font-weight:700;color:#BA7517;margin-top:4px">+' + reward + ' 💎</div>' : ''),
    });
    bumpScore();
    buzz([40, 60]);
    var msShake = parseInt(getEventConfig('shake_milestone', '2'), 10) || 0;
    if (msShake > 0) shakeGrid(msShake);
  }

  // Triple/Quad merge celebration
  function showMultiMergeBadge(count) {
    if (count < 3) return;
    var badge = document.createElement('div');
    var label = count === 3 ? '✨ Triple!' : count === 4 ? '💥 Quad!' : '🌟 MEGA ×' + count;
    badge.style.cssText = 'position:fixed;top:38%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:' + (count >= 4 ? '#FAC775' : '#EF9F27') + ';color:#412402;font-weight:900;font-size:' + (20 + count * 2) + 'px;padding:12px 28px;border-radius:24px;pointer-events:none;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.3);animation:chainPop 0.9s ease-out forwards';
    badge.textContent = label;
    document.body.appendChild(badge);
    buzz([60, 40]);
    var mmShake = parseInt(getEventConfig('shake_multi_merge', count >= 4 ? '6' : '3'), 10) || 0;
    if (mmShake > 0) shakeGrid(mmShake);
    setTimeout(function() { badge.remove(); }, 900);
  }

  // Screen shake — makes big merges feel impactful
  function shakeGrid(intensity) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var i = intensity || 3;
    gridEl.style.transition = 'none';
    var shakeCount = 0;
    var shakeInterval = setInterval(function() {
      var x = (Math.random() - 0.5) * i * 2;
      var y = (Math.random() - 0.5) * i * 2;
      gridEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      shakeCount++;
      if (shakeCount > 6) {
        clearInterval(shakeInterval);
        gridEl.style.transition = 'transform 0.1s';
        gridEl.style.transform = '';
      }
    }, 40);
  }

  let _scoreAnimFrame = 0;
  function bumpScore() {
    const el = document.getElementById('score');
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    // Dynamic-board target chip: when score crosses the previous best,
    // swap the chip to a "👑 עברת את השיא" celebration so the player
    // gets immediate feedback during gameplay, not just at game-over.
    var dynTargetEl = document.getElementById('dyn-target-chip');
    if (dynTargetEl) {
      var tgt = parseInt(dynTargetEl.getAttribute('data-target') || '0', 10) || 0;
      if (tgt > 0 && score > tgt && !dynTargetEl.classList.contains('dyn-target-chip-passed')) {
        dynTargetEl.classList.add('dyn-target-chip-passed');
        dynTargetEl.innerHTML = '👑 עברת את עצמך! +' + (score - tgt).toLocaleString();
        // Audio reward — milestone tone + buzz so it feels earned.
        try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([40, 40, 80]); } catch (e) {}
      } else if (tgt > 0 && score > tgt && dynTargetEl.classList.contains('dyn-target-chip-passed')) {
        // Keep updating the overage number live as score grows.
        dynTargetEl.innerHTML = '👑 עברת את עצמך! +' + (score - tgt).toLocaleString();
      }
    }
    // Dynamic-board global leader chip — same live-overtake feedback,
    // even bigger reward (overtaking another player is the strongest
    // dopamine spike a casual game can give).
    var dynLeaderEl = document.getElementById('dyn-leader-chip');
    if (dynLeaderEl) {
      var leaderTgt = parseInt(dynLeaderEl.getAttribute('data-leader') || '0', 10) || 0;
      if (leaderTgt > 0 && score > leaderTgt) {
        dynLeaderEl.classList.add('dyn-leader-chip-king');
        dynLeaderEl.innerHTML = '👑 חצית את המוביל! +' + (score - leaderTgt).toLocaleString();
        // Fire celebration ONCE.
        if (!dynLeaderEl.dataset.celebrated) {
          dynLeaderEl.dataset.celebrated = '1';
          try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 60, 60, 60, 100]); } catch (e) {}
        }
      }
    }
    // Count-up animation: smoothly roll the displayed number to current score
    var displayedScore = parseInt((el.textContent || '0').replace(/[^\d]/g, ''), 10) || 0;
    if (displayedScore >= score) return; // already at or past target
    var from = displayedScore, to = score;
    var token = ++_scoreAnimFrame;
    var start = performance.now();
    var duration = Math.min(320, Math.max(120, (to - from) / 8));
    function tick(now) {
      if (token !== _scoreAnimFrame) return; // superseded by newer animation
      var t = Math.min(1, (now - start) / duration);
      t = t * t * (3 - 2 * t); // ease-in-out smoothstep
      el.textContent = Math.round(from + (to - from) * t).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Smart survivor picker: for each cell in the merge group, simulate placing
  // the merged-up tile there, run gravity on a clone, then score the resulting
  // position. Picks the cell whose outcome is best for the player.
  // Scoring (highest wins):
  //   sameAdj  × 1,000,000  → an immediate chain (post-gravity neighbor of same tier)
  //   upAdj    ×     1,000  → ladder setup (neighbor of the next-up tier)
  //   landRow  ×       100  → prefer landing lower on the board (more headroom)
  //   surviveR ×        10  → among ties, prefer the bottommost original survivor (visual)
  //   anchor bonus          → small penalty for landing column far from drop column
  function pickSmartSurvivor(group, anchorC, newTier) {
    var rows = getBoardRows(), cols = getBoardCols();
    var bestScore = -Infinity, bestR = -1, bestC = -1;
    var SENTINEL = -1;
    for (var i = 0; i < group.length; i++) {
      var sr = group[i][0], sc = group[i][1];
      // Clone grid
      var sim = new Array(rows);
      for (var rr = 0; rr < rows; rr++) sim[rr] = grid[rr].slice();
      // Apply merge: clear all group cells, place sentinel at candidate survivor
      for (var j = 0; j < group.length; j++) {
        sim[group[j][0]][group[j][1]] = 0;
      }
      sim[sr][sc] = SENTINEL;
      // Apply gravity in-place on the clone (same algorithm as applyGravity)
      for (var c = 0; c < cols; c++) {
        var w = rows - 1;
        for (var r = rows - 1; r >= 0; r--) {
          if (sim[r][c] !== 0) {
            if (r !== w) { sim[w][c] = sim[r][c]; sim[r][c] = 0; }
            w--;
          }
        }
      }
      // Find the sentinel post-gravity
      var landR = -1, landC = -1;
      for (var rr2 = 0; rr2 < rows && landR < 0; rr2++) {
        for (var cc = 0; cc < cols; cc++) {
          if (sim[rr2][cc] === SENTINEL) { landR = rr2; landC = cc; sim[rr2][cc] = newTier; break; }
        }
      }
      if (landR < 0) continue;
      // Score adjacency
      var sameAdj = 0, upAdj = 0;
      var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var d = 0; d < 4; d++) {
        var nr = landR + dirs[d][0], nc = landC + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var v = sim[nr][nc];
        if (v === newTier) sameAdj++;
        else if (v === newTier + 1) upAdj++;
      }
      var ac = (anchorC != null ? anchorC : sc);
      var anchorBonus = -Math.abs(landC - ac);
      var score = sameAdj * 1000000 + upAdj * 1000 + landR * 100 + sr * 10 + anchorBonus;
      if (score > bestScore) { bestScore = score; bestR = sr; bestC = sc; }
    }
    if (bestR < 0) return null;
    return [bestR, bestC];
  }

  async function processChains(anchorRow, anchorCol) {
    // anchorRow/anchorCol: where the piece was dropped (first merge prefers
    // this cell as the survivor). For chain reactions after gravity, the
    // anchor shifts to the last merge position for natural visual flow.
    let chainCount = 0;
    const prevHighestTier = highestTier;
    while (true) {
      let merged = null;
      let mergedTier = 0;
      let mergeSize = 0;
      outer: for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const t = grid[r][c];
          if (t === 0) continue;
          const group = findGroup(r, c, t);
          if (group.length >= 2) {
            // ── CROWN MERGE SPECIAL: two crowns → explosion ──
            if (t === MAX_TIER && gameConfig.crown_merge_enabled !== 'false') {
              // Clear ALL crowns in the group
              for (let i = 0; i < group.length; i++) {
                grid[group[i][0]][group[i][1]] = 0;
              }
              // Clear the row where the bottommost crown was
              let clearRow = 0;
              for (let i = 0; i < group.length; i++) {
                if (group[i][0] > clearRow) clearRow = group[i][0];
              }
              for (let cc = 0; cc < getBoardCols(); cc++) grid[clearRow][cc] = 0;
              chainCount++;
              var crownBonus = parseInt(gameConfig.crown_merge_bonus, 10) || 50000;
              score += crownBonus;
              gameTotalMerges++;
              gameMergesPerTier[MAX_TIER] = (gameMergesPerTier[MAX_TIER] || 0) + 1;
              gamePointsPerTier[MAX_TIER] = (gamePointsPerTier[MAX_TIER] || 0) + crownBonus;
              showFloatingScore(clearRow, 1, crownBonus, chainCount);
              showCrownExplosion(clearRow);
              soundMilestone(MAX_TIER);
              bumpScore();
              checkScoreMilestones();
              buzz([100, 60, 120, 60, 100]);
              var crownShake = parseInt(getEventConfig('shake_crown_merge', '8'), 10) || 0;
              if (crownShake > 0) shakeGrid(crownShake);
              merged = [clearRow, 1];
              mergedTier = MAX_TIER;
              mergeSize = group.length;
              if (chainCount > currentGameMaxChain) currentGameMaxChain = chainCount;
              bumpLifetimeMax(BEST_CHAIN_KEY, chainCount);
              break outer;
            }
            // If crown merge disabled, skip crown tiles entirely (old behavior)
            if (t === MAX_TIER) continue;
            // ── REGULAR MERGE ──
            // Choose survivor cell. Modes (admin-controlled via gameConfig.merge_mode):
            //   'anchor'  → bottommost row; tie → closest to drop column (default)
            //   'classic' → bottommost row; tie → leftmost (Suika-style)
            //   'smart'   → simulate each candidate after gravity and pick the
            //               one that yields the best follow-up for the player
            //               (adjacent same-tier = chain potential, adjacent next-
            //               tier = ladder setup), tie-break by board depth then
            //               anchor proximity.
            let kr = -1, kc = -1;
            var mergeMode = gameConfig.merge_mode || 'anchor';
            var nextTierForPick = Math.min(t + 1, MAX_TIER);
            if (mergeMode === 'smart') {
              var smartPick = pickSmartSurvivor(group, anchorCol, nextTierForPick);
              if (smartPick) { kr = smartPick[0]; kc = smartPick[1]; }
            }
            if (kr < 0) {
              var useAnchor = mergeMode !== 'classic';
              for (let i = 0; i < group.length; i++) {
                const gr = group[i][0], gc = group[i][1];
                if (gr > kr) {
                  kr = gr; kc = gc;
                } else if (gr === kr) {
                  if (useAnchor) {
                    var distNew = Math.abs(gc - (anchorCol != null ? anchorCol : 0));
                    var distOld = Math.abs(kc - (anchorCol != null ? anchorCol : 0));
                    if (distNew < distOld) { kc = gc; }
                  } else {
                    if (gc < kc) { kc = gc; } // classic: leftmost wins
                  }
                }
              }
            }
            for (let i = 0; i < group.length; i++) {
              const gr = group[i][0], gc = group[i][1];
              if (gr === kr && gc === kc) continue;
              grid[gr][gc] = 0;
            }
            const nt = Math.min(t + 1, MAX_TIER);
            grid[kr][kc] = nt;
            chainCount++;
            // DIAGNOSTIC: log the merge BEFORE any potentially-throwing side
            // effects (showMilestoneBanner / showFloatingScore / etc) so even
            // if those break, we still see the merge in the console. Catches
            // the case where chain merges silently mutate grid without the
            // [merge] log firing (user reported floating tile after a chain).
            if (window.__bloomEngineLog) console.log('[merge-early]',
              'chain=' + chainCount, 'tier=t' + nt, 'size=' + group.length,
              'at=' + kr + ',' + kc, 'grid=' + serializeGrid());
            const multiplier = 1 + (chainCount - 1) * 0.5;
            var eventMult = getFeverMultiplier() * checkTargetMerge(nt);
            // Pass survivor column (kc) so an active column-multiplier is
            // applied at the chokepoint. When no multiplier is active,
            // pointsFor returns the vanilla score with zero overhead.
            const points = Math.round(pointsFor(nt, group.length, multiplier, kc) * eventMult);
            score += points;
            // Dynamic Boards — Special Cell: Bonus (phase 3C, May 2026).
            // If the merge survivor lands on a bonus cell, add the cell's
            // configured amount to the score on top of the regular reward.
            // The bonus is per-merge — chains hitting the same bonus cell
            // multiple times collect each time. Fires BEFORE the milestone
            // banner so the +N badge stacks naturally with any tier-up FX.
            var __bonusCell = (typeof getSpecialCellAt === 'function') ? getSpecialCellAt(kr, kc) : null;
            if (__bonusCell && __bonusCell.type === 'bonus' && __bonusCell.amount > 0) {
              score += __bonusCell.amount;
              try {
                var gridElB = document.getElementById('grid');
                if (gridElB) {
                  var bIdx = kr * getBoardCols() + kc;
                  var bCell = gridElB.children[bIdx];
                  if (bCell) {
                    var bRect = bCell.getBoundingClientRect();
                    // Animated coin + bold "+N נקודות" badge. The coin is
                    // a span we can CSS-spin independently; the parent badge
                    // does the entry pop. Distinct from the 💎 credits emoji
                    // (which is also tier-7 — triple-overloaded) so the
                    // player never confuses bonus points with currency.
                    var bBadge = document.createElement('div');
                    bBadge.className = 'bonus-burst';
                    bBadge.style.left = (bRect.left + bRect.width / 2) + 'px';
                    bBadge.style.top  = (bRect.top + bRect.height / 2 - 6) + 'px';
                    bBadge.innerHTML =
                      '<span class="bonus-coin">🪙</span>' +
                      '<span class="bonus-amount">+' + __bonusCell.amount.toLocaleString() + '</span>' +
                      '<span class="bonus-label">נקודות</span>';
                    document.body.appendChild(bBadge);
                    setTimeout(function() { bBadge.remove(); }, 1400);
                  }
                }
              } catch (e) {}
            }
            if (nt > highestTier) highestTier = nt;
            // Track per-tier merge stats for game-over summary
            gameMergesPerTier[nt] = (gameMergesPerTier[nt] || 0) + 1;
            gamePointsPerTier[nt] = (gamePointsPerTier[nt] || 0) + points;
            gameTotalMerges++;
            if (nt > gameBestMergeTier) gameBestMergeTier = nt;
            // First-time-tier-up bonus: when this merge brings the player's
            // highestTier to a milestone they haven't hit YET this game,
            // award the bonus. Drives the dopamine of "I just got Crown!".
            if (TIER_UP_BONUS[nt] && !tierUpHit[nt]) {
              tierUpHit[nt] = true;
              const bonusPts = TIER_UP_BONUS[nt];
              score += bonusPts;
              showMilestoneBanner(nt, bonusPts);
              soundMilestone(nt);
              bumpScore();
              buzz([60, 40, 80]);
              var tierShake = parseInt(getEventConfig('shake_tier_up', nt >= 7 ? '5' : '3'), 10) || 0;
              if (tierShake > 0) shakeGrid(tierShake);
            }
            merged = [kr, kc];
            mergedTier = nt;
            mergeSize = group.length;
            // Update anchor to last merge position — chain reactions follow the flow
            anchorRow = kr; anchorCol = kc;
            // SIDE EFFECTS (UI + audio + stats) — wrapped in try/catch so a
            // single broken DOM/audio call CAN'T derail the merge loop. Before
            // this guard, a TypeError inside showComboCounter (string vs Number)
            // skipped the trailing [merge] log + applyGravity, leaving a floating
            // tile that the render-time invariant had to clean up after the fact.
            try {
              showFloatingScore(kr, kc, points, chainCount);
              // Dynamic Boards phase 1 — celebrate ≥2× column landings.
              // Small companion badge near the merge cell. Only fires when a
              // column multiplier is active AND the survivor column is ≥2×.
              (function maybeShowMultBonus() {
                if (typeof getColumnMultipliers !== 'function') return;
                var mults = getColumnMultipliers();
                if (!mults) return;
                var m = mults[kc];
                if (!m || m < 2) return;
                var gridElTmp = document.getElementById('grid');
                if (!gridElTmp) return;
                var cellIdx = kr * getBoardCols() + kc;
                var cellEl = gridElTmp.children[cellIdx];
                if (!cellEl) return;
                var rect = cellEl.getBoundingClientRect();
                var badge = document.createElement('div');
                badge.className = 'float-score';
                badge.textContent = '×' + (Number.isInteger(m) ? m : m.toFixed(1)) + ' עמודה!';
                badge.style.cssText = 'position:fixed;left:' + (rect.left + rect.width / 2) + 'px;top:' + (rect.top - 18) + 'px;background:linear-gradient(135deg,#FFB95C,#FF6B9D);color:#fff;font-weight:900;font-size:14px;padding:4px 10px;border-radius:12px;box-shadow:0 4px 14px rgba(255,107,157,0.45);pointer-events:none;z-index:9998';
                document.body.appendChild(badge);
                setTimeout(function() { badge.remove(); }, 1100);
              })();
              bumpScore();
              soundMerge(nt);
              checkScoreMilestones();
              // Frozen-thaw: every merge "cracks" any frozen-with-tile
              // cell that's orthogonally adjacent to the merge survivor.
              // 3 cracks → shatter + +200 bonus. Lets players actively
              // unstick frozen tiles via skill instead of waiting for a
              // random bomb event.
              try { checkFrozenThawAdjacent(kr, kc); } catch (e) {}
              // Locked-cell unlock: walks all locked cells, opens any
              // whose unlock_after threshold has been reached. Fires
              // the 🔓 burst + soundMilestone for each newly-opened.
              try { checkLockedUnlocks(); } catch (e) {}
              // Electric flash: if any cell in the merge group was on an
              // electric special cell, fire the lightning visual. The
              // BFS extension above already pulled in radius-2 cells, so
              // the group itself contains the extended cells.
              try {
                var hasElectric = false;
                for (var __ei = 0; __ei < group.length; __ei++) {
                  if (isElectricAt(group[__ei][0], group[__ei][1])) { hasElectric = true; break; }
                }
                if (hasElectric) triggerElectricFlash(group);
              } catch (e) {}
              if (group.length >= 3) showMultiMergeBadge(group.length);
              if (chainCount > currentGameMaxChain) currentGameMaxChain = chainCount;
              bumpLifetimeMax(BEST_CHAIN_KEY, chainCount);
              // Onboarding: first merge → step 2; first chain (≥2) → step 3.
              if (chainCount === 1) maybeOnboardStep2();
              else if (chainCount >= 2) maybeOnboardStep3();
              if (chainCount >= 2) {
                const m = chainCount === 2 ? 1.5 : chainCount === 3 ? 2 : chainCount === 4 ? 2.5 : 3;
                showChainBadge(chainCount, m);
                soundChain(chainCount);
                showComboCounter(chainCount, m);
              }
            } catch (sideEffectErr) {
              if (window.__bloomEngineLog) console.warn('[merge] side-effect failed (ignored)', sideEffectErr);
            }
            break outer;
          }
        }
      }
      if (!merged) break;
      if (window.__bloomEngineLog) console.log('[merge]', 'chain=' + chainCount, 'tier=t' + mergedTier, 'size=' + mergeSize, 'at=' + merged[0] + ',' + merged[1]);
      // Run gravity BEFORE the merge-highlight render so the player never
      // sees a "floating tile" sitting above a hole. Previously gravity ran
      // AFTER a 150ms pause — that window let a screenshot catch a tile
      // hanging in row 3 with row 4 empty. The merge cell (kr, kc) is the
      // bottom-most of the group, so gravity never moves IT — only the
      // tiles above the destroyed cells, which now slot in seamlessly
      // during the highlight pulse.
      applyGravity();
      render({ merging: merged, mergeChain: chainCount });
      // Aurora juice: text burst on chains 2+, score bump on every merge,
      // particles fly from the merged cell to the score counter. All no-op
      // for non-Aurora skins.
      if (typeof auroraShowTextBurst === 'function') auroraShowTextBurst(chainCount);
      if (typeof auroraScoreBump === 'function') auroraScoreBump();
      if (typeof auroraFlyParticlesToScore === 'function') {
        var mergedCellEl = document.querySelector(
          '#grid .cell[data-r="' + merged[0] + '"][data-c="' + merged[1] + '"]'
        );
        if (mergedCellEl) auroraFlyParticlesToScore(mergedCellEl, Math.min(6, 2 + chainCount));
      }
      await gsleep(150);
      render();
      await gsleep(80);
    }
    if (highestTier > prevHighestTier) {
      soundMilestone(highestTier);
      buzz([30, 40, 30]);
    }
    checkAchievements();
  }

  function isGameOver() {
    // Game-over when every column's topmost playable cell is filled.
    // Shape voids in row 0 don't count — those columns are still
    // playable as long as some lower row is empty + reachable. To
    // keep this simple: for each column, find the first non-void
    // row from the top; if it's filled (or locked), that column
    // is full. If every column is full, game over.
    var cols = getBoardCols();
    var rows = getBoardRows();
    for (var c = 0; c < cols; c++) {
      var columnFull = true;
      for (var r = 0; r < rows; r++) {
        if (isShapeInactiveAt(r, c)) continue;  // skip voids
        if (isLockedAt(r, c)) continue;          // skip walls
        if (grid[r][c] === 0) { columnFull = false; break; }
      }
      if (!columnFull) return false;  // there's still a slot in this column
    }
    return true;
  }

  let queuedCol = -1; // next move queued while busy

  async function drop(col) {
    if (busy) {
      // Queue the next move — drops as soon as current finishes
      queuedCol = col;
      return;
    }
    let row = -1;
    for (let r = getBoardRows() - 1; r >= 0; r--) {
      // Shape voids (phase 5) — not part of the playable area.
      if (isShapeInactiveAt(r, col)) continue;
      // Locked cells block drops (treat as occupied) until unlocked.
      if (isLockedAt(r, col)) continue;
      if (grid[r][col] === 0) { row = r; break; }
    }
    if (row === -1) {
      // Column is full — check if the whole board is game-over
      if (isGameOver()) {
        busy = true; // prevent further taps
        window.__bloomGameOver = true; // stop heartbeat
        if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
        stopEventSystem();
        // Save best score BEFORE rendering game-over
        var isNewBest = score > best && !skinTrialMode;
        if (isNewBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
        soundGameOver();
        buzz([60, 80, 100]);
        playMusic('fail');
        if (!window.__bloomBotActive && !skinTrialMode) {
          incrementGamesPlayed();
          bumpLifetimeMax(BEST_TIER_KEY, highestTier);
          addLifetimeTotal(TOTAL_SCORE_KEY, score);
          var gameDuration = Date.now() - (gameStartTime || Date.now());
          var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY) + gameDuration;
          try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
        }
        checkAchievements();
        // Challenge game-over
        if (mode === 'challenge' && activeChallenge) {
          var w = document.getElementById('grid-wrap');
          if (w) w.innerHTML = '<div class="overlay"><div class="over-title">האתגר הסתיים</div><div class="contest-loading" style="margin-top:14px">שולח תוצאה…</div></div>';
          (async function() {
            var result = await completeChallengeRun();
            renderChallengeResult(result);
          })();
          return;
        }
        // Daily + Practice: submit to leaderboard.
        // PRACTICE EXCLUSION: if the player chose a non-default difficulty in
        // practice, the score is incomparable to the global daily leaderboard
        // and must NOT be submitted (fairness). Personal-best in localStorage
        // is still tracked above. Duels also run inside the practice mode
        // engine — never submit those to the daily leaderboard either.
        // Phase 3 (May 2026): a practice-board with multipliers also breaks
        // comparability — skip leaderboard submit when one is active.
        var practiceFairForLeaderboard = (mode === 'practice') &&
                                          !sessionDifficulty &&
                                          !window._duelMode &&
                                          !window._activeSpecialBoard;
        if (((mode === 'daily') || practiceFairForLeaderboard) && !dailySubmitted) {
          if (mode === 'daily') {
            dailySubmitted = true;
            localStorage.setItem(DAILY_PLAYED_PREFIX + dailyDate, JSON.stringify({ score: score, tier: highestTier, ts: Date.now() }));
          }
          render({ over: true, isNewBest: isNewBest });
          if (!window.__bloomBotActive && !skinTrialMode) {
            // 1.2-mod — auto-submit with default name; player can choose a
            // real name via the ✏️ CTA on game-over (or the home pid) when
            // they're actually ready to commit, not before their first play.
            submitAndShowLeaderboard();
          }
        } else {
          render({ over: true, isNewBest: isNewBest });
          // Non-fair practice/duel still feed the difficulty leaderboard —
          // submitAndShowLeaderboard() (which calls this) is skipped for them.
          if (mode === 'practice') submitPracticeOrDuelScore();
        }
        // Contest: submit score
        if (mode === 'contest' && !contestSubmitted && activeContestCode) {
          contestSubmitted = true;
          clearContestGameState();
          stopOvertakeWatch();
          if (typeof stopContestHud === 'function') stopContestHud();
          setLastFinalScore(activeContestCode, score | 0);
          stopLivePush();
          activeGameContestCode = null;
          (async function() {
            await submitContestScore(activeContestCode, score, highestTier);
            await loadContestLeaderboard();
            if (!window.__bloomBotActive && leaderboard.length > 0) {
              for (var i = 0; i < Math.min(3, leaderboard.length); i++) {
                if (leaderboard[i].you) {
                  earnCredits(['contest_1st', 'contest_2nd', 'contest_3rd'][i]);
                  break;
                }
              }
            }
          })();
        }
        if (mode === 'practice') clearPracticeGameState();
        if (activeDuelId) submitDuelScore(score);
      }
      return;
    }
    busy = true;
    var _busyTimer = setTimeout(function() {
      // Safety valve: if busy stuck for 5 seconds, force-recover
      if (busy) { busy = false; try { render(); } catch(e) {} }
    }, 5000);
    queuedCol = -1;
    dropsCount++;
    ensureAudio();
    playMusic('game');
    soundDrop();
    if (!isSfxMuted()) buzz([8]);
    if (!streakBumpedThisSession) {
      bumpStreak();
      streakBumpedThisSession = true;
    }
    grid[row][col] = nextPiece;
    if (nextPiece > highestTier) highestTier = nextPiece;
    if (window.__bloomEngineLog) console.log('[drop]', 'col=' + col, '→ row=' + row, 'piece=t' + nextPiece, 'grid(after)=' + serializeGrid());
    // Dynamic Boards — Special Cell: Gold (phase 3A, May 2026).
    // If the tile lands on a gold cell, upgrade it one tier (capped at
    // MAX_TIER = crown). Fires before the appearing animation so the
    // upgraded tile is what the player sees emerge. The gold ring stays
    // (it's a permanent board property, not a one-shot consumable).
    if (typeof getSpecialCellAt === 'function') {
      var goldHit = getSpecialCellAt(row, col);
      if (goldHit && goldHit.type === 'gold' && grid[row][col] < MAX_TIER) {
        grid[row][col] = grid[row][col] + 1;
        if (grid[row][col] > highestTier) highestTier = grid[row][col];
        // Visual + audio feedback: a tier-up celebration without the
        // big milestone banner (which is reserved for first-time-tier).
        try {
          soundMerge(grid[row][col]);
          buzz([20, 40]);
          if (typeof showFloatingScore === 'function') {
            // No score awarded here (the upgrade is its own reward —
            // the higher tier will score more in subsequent merges) —
            // a "✨ זהב!" badge marks the moment.
            var gridEl = document.getElementById('grid');
            if (gridEl) {
              var idx = row * getBoardCols() + col;
              var cellEl = gridEl.children[idx];
              if (cellEl) {
                var rect = cellEl.getBoundingClientRect();
                var badge = document.createElement('div');
                badge.className = 'float-score';
                badge.textContent = '✨ זהב!';
                badge.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2) + 'px;top:' + (rect.top - 18) + 'px;background:linear-gradient(135deg,#FFD37A,#FAC775);color:#412402;font-weight:900;font-size:14px;padding:4px 10px;border-radius:12px;box-shadow:0 4px 14px rgba(250,199,117,0.55);pointer-events:none;z-index:9998';
                document.body.appendChild(badge);
                setTimeout(function() { badge.remove(); }, 1100);
              }
            }
          }
        } catch (goldFxErr) {}
      }
    }
    // Dynamic Boards — Teleport (phase 3G): if the tile landed on a
    // teleport cell, relocate it to a random empty non-special non-locked
    // cell. The tile vanishes with a purple spiral at the old position
    // and materializes at the new one. The teleport cell itself stays
    // put (the next tile that lands here teleports too). All subsequent
    // chain processing uses the NEW (row, col).
    if (isTeleportAt(row, col)) {
      var rowsT = getBoardRows(), colsT = getBoardCols();
      var candidatesT = [];
      for (var rr = 0; rr < rowsT; rr++) {
        for (var cc = 0; cc < colsT; cc++) {
          if (rr === row && cc === col) continue;
          if (grid[rr][cc] !== 0) continue;
          if (isLockedAt(rr, cc)) continue;
          if (getSpecialCellAt(rr, cc)) continue;  // skip other specials
          candidatesT.push([rr, cc]);
        }
      }
      if (candidatesT.length) {
        var pickT = candidatesT[Math.floor(Math.random() * candidatesT.length)];
        var tileT = grid[row][col];
        grid[row][col] = 0;
        try { triggerTeleportAnimation(row, col, pickT[0], pickT[1]); } catch (e) {}
        // Show the tile vanish first, then re-place at new position.
        render();
        await gsleep(280);
        grid[pickT[0]][pickT[1]] = tileT;
        row = pickT[0];
        col = pickT[1];
        render({ appearing: [row, col] });
        await gsleep(200);
      }
    }
    var pendingEvent = (activeEvent && activeEvent.col === col) ? activeEvent : null;
    dismissCoach();
    render({ appearing: [row, col] });
    try {
    await gsleep(80);
    // Trigger the event FIRST when the player drops in the event column —
    // otherwise long chain reactions push the explosion off by 1-2s, which
    // feels like an unrelated event ("delay" bug the user reported). The
    // event itself handles its own gravity+render before chains continue.
    if (pendingEvent && activeEvent === pendingEvent) {
      triggerEvent(pendingEvent, row);
      // Brief pause so the explosion is visible before chain merges start
      // shifting the board around it.
      await gsleep(120);
    }
    // Snapshot total-merges BEFORE the chain so we can detect what this
    // drop actually produced. Used to trigger the special-cells reshuffle
    // when the admin's selected mode matches.
    var _preMerges = gameTotalMerges;
    await processChains(row, col);
    var _thisDropMerges = gameTotalMerges - _preMerges;
    rollNextPiece();
    render();
    // Phase 3D+++ — Special-cells board-wide reshuffle.
    // 'on_merge': any merge this drop triggers the shuffle.
    // 'on_chain': only chains (≥2 merges) trigger.
    // 'shatter' and 'static' are handled elsewhere (thawFrozenTile / never).
    try {
      var __board = window._activeSpecialBoard;
      var __mode = __board && __board.definition && __board.definition.relocate_mode;
      var __shouldShuffle =
        (__mode === 'on_merge' && _thisDropMerges > 0) ||
        (__mode === 'on_chain' && _thisDropMerges >= 2);
      if (__shouldShuffle && typeof reshuffleAllSpecialCells === 'function') {
        // Tiny delay so the chain's settle-render paints before the
        // shuffle starts moving rings around.
        setTimeout(function() { reshuffleAllSpecialCells(); }, 120);
      }
    } catch (e) {}
    var isNewBest = score > best && !skinTrialMode;
    if (isNewBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    if (isGameOver()) {
      clearTimeout(_busyTimer);
      window.__bloomGameOver = true; // stop heartbeat
      if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
      stopEventSystem();
      soundGameOver();
      buzz([60, 80, 100]);
      playMusic('fail');
      // Skip stat tracking when bot is playing (keep graphs clean)
      if (!window.__bloomBotActive && !skinTrialMode) {
        incrementGamesPlayed();
        bumpLifetimeMax(BEST_TIER_KEY, highestTier);
        addLifetimeTotal(TOTAL_SCORE_KEY, score);
        // Track total play time
        var gameDuration = Date.now() - (gameStartTime || Date.now());
        var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY) + gameDuration;
        try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
      }
      checkAchievements();
      // Challenges short-circuit the regular game-over screen — they get
      // their own bespoke "you won / you didn't" view from /complete.
      if (mode === 'challenge' && activeChallenge) {
        const w = document.getElementById('grid-wrap');
        if (w) w.innerHTML = '<div class="overlay"><div class="over-title">האתגר הסתיים</div><div class="contest-loading" style="margin-top:14px">שולח תוצאה…</div></div>';
        (async function() {
          const result = await completeChallengeRun();
          renderChallengeResult(result);
        })();
        return;
      }
      if (mode === 'daily' && !dailySubmitted) {
        dailySubmitted = true;
        localStorage.setItem(DAILY_PLAYED_PREFIX + dailyDate, JSON.stringify({ score: score, tier: highestTier, ts: Date.now() }));
        render({ over: true, isNewBest: isNewBest });
        // 1.2-mod — auto-submit with default name (see src/07-identity.js).
        submitAndShowLeaderboard();
      } else if (mode === 'practice') {
        render({ over: true, isNewBest: isNewBest });
        // Practice scores go to the daily leaderboard, but ONLY when the
        // player is on the default difficulty — non-default would inflate
        // (or deflate) the score relative to other players. Duel games
        // also reuse the practice engine; never submit those to daily.
        var fair = !sessionDifficulty && !window._duelMode;
        if (fair && !window.__bloomBotActive && !skinTrialMode) {
          submitAndShowLeaderboard();
        } else if (!fair && !window.__bloomBotActive && !skinTrialMode) {
          // Non-default practice or duel — feeds only the difficulty board.
          submitPracticeOrDuelScore();
        }
      } else if (mode === 'dynamic' && window._activeDynamicBoard && !window.__bloomBotActive && !skinTrialMode) {
        // Per-board personal best — the addictive "beat your own score" loop.
        // Capture the previous record BEFORE the write so the over screen
        // can show the delta (or the "you missed it by N" near-miss banner).
        var __boardId = window._activeDynamicBoard.id;
        var __prevBoardBest = (typeof getBoardBest === 'function') ? getBoardBest(__boardId) : null;
        var __isBoardBest = false;
        try {
          if (typeof setBoardBest === 'function') {
            __isBoardBest = setBoardBest(__boardId, score, highestTier);
          }
        } catch (e) {}
        // Fire the global per-board leaderboard submit + render the
        // game-over screen optimistically. The fetch returns rank+total
        // which we paint into the screen once it resolves (so the
        // primary "🏆 שיא חדש" feedback is instant — leaderboard
        // numbers slot in 200-400ms later, no jank).
        var __submitPayload = {
          deviceId: deviceToken && getDeviceId ? getDeviceId() : '',
          token: typeof deviceToken !== 'undefined' ? deviceToken : null,
          name: getPlayerName ? getPlayerName() : 'אנונימי',
          score: score,
          tier: highestTier,
          drops: window.__bloomDropCount || 0,
          country: (typeof getCountry === 'function') ? getCountry() : null
        };
        render({
          over: true,
          isNewBest: isNewBest,
          boardBest: __prevBoardBest,
          isBoardBest: __isBoardBest,
          activeBoard: window._activeDynamicBoard,
          boardLeader: { pending: true }
        });
        (function() {
          try {
            fetch('/api/boards/' + __boardId + '/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(__submitPayload)
            })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; })
              .then(function(d) {
                if (!d || !d.ok) return;
                // Patch the rendered over screen with the rank pill in place
                // — no full re-render, just inject the missing data.
                var host = document.getElementById('over-board-rank-host');
                if (!host) return;
                var total = d.total | 0;
                var rank = d.rank | 0;
                if (!total || !rank) return;
                var percentile = total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
                var emoji = rank === 1 ? '👑' : rank <= 3 ? '🏆' : rank <= 10 ? '⭐' : '🎯';
                var label;
                if (rank === 1) label = emoji + ' מקום ראשון בלוח <strong>' + escapeHtml(window._activeDynamicBoard.name || 'לוח') + '</strong>!';
                else if (total >= 5) label = emoji + ' #' + rank + ' מתוך ' + total + ' · עברת ' + percentile + '% מהשחקנים';
                else label = emoji + ' #' + rank + ' מתוך ' + total;
                host.innerHTML = label;
                host.classList.add('over-board-rank-loaded');
                if (rank === 1) host.classList.add('over-board-rank-king');
              });
          } catch (e) {}
        })();
      } else {
        render({ over: true, isNewBest: isNewBest });
      }
      if (mode === 'practice') clearPracticeGameState();
      // Submit duel score if this was a duel game
      if (activeDuelId) submitDuelScore(score);
      if (mode === 'contest' && !contestSubmitted && activeContestCode) {
        contestSubmitted = true;
        clearContestGameState();
        stopOvertakeWatch();
        if (typeof stopContestHud === 'function') stopContestHud();
        setLastFinalScore(activeContestCode, score | 0);
        stopLivePush();
        // Detach the in-memory state from the contest — future saveContestGameState()
        // calls (e.g. from beforeunload) won't pollute the just-cleared slot.
        activeGameContestCode = null;
        (async function() {
          await submitContestScore(activeContestCode, score, highestTier);
          await loadContestLeaderboard();
          // Award credits based on contest rank
          if (!window.__bloomBotActive && leaderboard.length > 0) {
            for (var i = 0; i < Math.min(3, leaderboard.length); i++) {
              if (leaderboard[i].you) {
                var actions = ['contest_1st', 'contest_2nd', 'contest_3rd'];
                earnCredits(actions[i]);
                break;
              }
            }
          }
        })();
      }
    }
    else {
      clearTimeout(_busyTimer);
      busy = false;
      render();
      // Save state after every move (prevents loss on refresh)
      if (mode === 'practice') savePracticeGameState();
      // Auto-play queued move (fast tapping)
      if (queuedCol >= 0) {
        var nextCol = queuedCol;
        queuedCol = -1;
        setTimeout(function() { drop(nextCol); }, 10);
        return;
      }
      if (mode === 'contest') {
        saveContestGameState();
        scheduleLiveScorePush();
        if (meHasWatchers) pushLiveState();
      }
      if (mode === 'challenge' && activeChallenge) {
        activeChallenge.drops = (activeChallenge.drops | 0) + 1;
        writeChallengeDrops(activeChallenge.slug, activeChallenge.drops);
        pushChallengeScore();
      }
      // In a 1v1 duel, push a heartbeat immediately after every drop so the
      // opponent's live spectator widget updates within ~1.5s (poll cadence)
      // instead of waiting up to 5s for the next periodic heartbeat.
      if (window._duelMode && typeof sendHeartbeat === 'function') {
        try { sendHeartbeat(); } catch (e) {}
      }
    }
    } catch(e) {
      // Error during drop/merge — recover so board doesn't freeze
      clearTimeout(_busyTimer);
      busy = false;
      try { render(); } catch(e2) {}
    }
  }

  function buildShareText() {
    var emojis = [];
    for (var t = 1; t <= highestTier; t++) emojis.push(getActiveTiers()[t].emoji);
    var gameDur = Date.now() - (gameStartTime || Date.now());
    var durMin = Math.floor(gameDur / 60000);
    var durSec = Math.floor((gameDur % 60000) / 1000);
    var durText = durMin > 0 ? durMin + ':' + String(durSec).padStart(2, '0') : durSec + ' שנ\'';
    var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY);
    var totalH = Math.floor(totalMs / 3600000);
    var totalM = Math.floor((totalMs % 3600000) / 60000);
    var totalText = totalH > 0 ? totalH + ' שעות ו-' + totalM + ' דקות' : totalM + ' דקות';
    var chainText = currentGameMaxChain >= 2 ? ' · 🔗×' + currentGameMaxChain : '';

    var header;
    if (mode === 'daily') {
      header = '🌸 BLOOM · אתגר יומי ' + formatDateHe(dailyDate) + '\n' + score.toLocaleString() + ' נקודות';
      if (dailyRank) header += ' · מקום #' + dailyRank;
    } else {
      header = '🌸 BLOOM — ' + score.toLocaleString() + ' נקודות';
    }
    var statsLine = '⏱' + durText + chainText + ' · 🎯' + gameTotalMerges + ' מיזוגים';
    var addictionLine = '🕐 סה"כ ' + totalText + ' ב-BLOOM';
    return header + '\n' + emojis.join('') + '\n' + statsLine + '\n' + addictionLine + '\n\nשחק גם: ' + getShareLink();
  }

  function shareResult() {
    var text = buildShareText();
    if (navigator.share) {
      navigator.share({ text: text }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        var btn = document.getElementById('share-btn');
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = '✓ הועתק ללוח';
          setTimeout(function() { btn.textContent = orig; }, 1600);
        }
      });
    }
  }

  function shareResultWhatsApp() {
    var text = buildShareText();
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    trackEvent('share', { method: 'whatsapp', type: 'result' });
  }

  function buildAddictionShareText() {
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    var totalHours = Math.floor(totalMs / 3600000);
    var totalMins = Math.floor((totalMs % 3600000) / 60000);
    var timeStr = totalHours > 0 ? totalHours + ' שעות ו-' + totalMins + ' דקות' : totalMins + ' דקות';
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    var bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    var s = loadStreak();
    var today = todayInIsrael();
    var streakN = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakN = 0;

    var text = '🕐 שיחקתי ' + timeStr + ' ב-BLOOM!\n';
    if (totalGames > 0) text += '🎮 ' + totalGames + ' משחקים';
    if (bestScore > 0) text += ' · 🏆 שיא: ' + bestScore.toLocaleString();
    if (streakN > 0) text += ' · 🔥 ' + streakN + ' ימים ברצף';
    text += '\n\nמסוגל/ת לנצח אותי? 😏\n' + getShareLink();
    return text;
  }

  function shareAddiction(via) {
    var text = buildAddictionShareText();
    trackEvent('share', { method: via, type: 'addiction' });
    if (via === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    } else if (navigator.share) {
      navigator.share({ text: text }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }

  // ================================================================
  // TOUR — multi-step guided tutorial covering rules, merging, chains,
  // tier-up bonuses, and the 4 game modes. Reachable from a button in
  // showInfo() and proactively offered to first-time visitors. Uses real
  // TIER svgs for illustrations so the player learns the actual icon set.
  // ================================================================
  const TOUR_KEY = 'bloom_tour_seen';
  function tourTile(tier, sizeClass) {
    const t = (getActiveTiers() && getActiveTiers()[tier]) || null;
    const cls = 'tour-tile' + (sizeClass ? ' ' + sizeClass : '');
    if (!t) return '<span class="' + cls + ' tour-tile-empty"></span>';
    return '<span class="' + cls + '" style="background:' + t.bg + ';color:' + t.fg + '">' + t.svg + '</span>';
  }

  function tourSteps() {
    return [
      // 1 — Welcome
      {
        illustration:
          '<div class="tour-welcome">' +
            '<div class="icons-row">' +
              tourTile(8, 'tour-tile-lg') + tourTile(7, 'tour-tile-lg') + tourTile(6, 'tour-tile-lg') +
            '</div>' +
            '<div class="brand">BLOOM</div>' +
          '</div>',
        title: 'ברוכים הבאים ל-BLOOM',
        desc: 'משחק מיזוג בעברית. מטרה אחת: <strong>להגיע לכתר 👑</strong>. הסיור הזה ייקח 60 שניות.'
      },
      // 2 — The Board
      {
        illustration: (function() {
          const cells = [];
          for (let i = 0; i < 24; i++) cells.push('<span class="tour-tile tour-tile-empty"></span>');
          return '<div class="tour-mini-grid">' + cells.join('') + '</div>';
        })(),
        title: 'הלוח',
        desc: '<strong>4 עמודות × 6 שורות</strong>. כל הקשה על עמודה מפילה את החלק "הבא" לתחתית העמודה.'
      },
      // 3 — The Tier ladder
      {
        illustration:
          '<div class="tour-row">' +
            tourTile(1, 'tour-tile-sm') + tourTile(2, 'tour-tile-sm') + tourTile(3, 'tour-tile-sm') +
            tourTile(4, 'tour-tile-sm') + tourTile(5, 'tour-tile-sm') + tourTile(6, 'tour-tile-sm') +
            tourTile(7, 'tour-tile-sm') + tourTile(8, 'tour-tile-sm') +
          '</div>',
        title: '8 דרגות — מאבן עד כתר',
        desc: 'אבן → עלה → פרח → אש → ⚡ ברק → ⭐ כוכב → 💎 יהלום → 👑 <strong>כתר</strong>. הסולם בראש המסך מציג את הדרגה הבאה שתיפול.'
      },
      // 4 — Simple merge
      {
        illustration:
          '<div class="tour-row">' +
            tourTile(2) + tourTile(2) +
            '<span class="tour-arrow">→</span>' +
            tourTile(3) +
          '</div>',
        title: 'שני זהים → מיזוג',
        desc: 'אריחים זהים שצמודים <strong>אופקית או אנכית</strong> מתמזגים אוטומטית לדרגה הבאה. <strong>שני עלים = פרח אחד</strong>.'
      },
      // 5 — Group merge
      {
        illustration:
          '<div class="tour-row">' +
            '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:3px">' +
              tourTile(3, 'tour-tile-sm') + tourTile(3, 'tour-tile-sm') +
              tourTile(3, 'tour-tile-sm') + tourTile(3, 'tour-tile-sm') +
            '</div>' +
            '<span class="tour-arrow">→</span>' +
            tourTile(4) +
          '</div>',
        title: 'מיזוג גדול = ניקוד גדול',
        desc: 'מיזוג של <strong>3, 4 או יותר אריחים בו-זמנית</strong> נותן ניקוד <strong>פי 3, פי 4 ויותר</strong>. תכנן קבוצות גדולות לפני המיזוג.'
      },
      // 6 — Chains
      {
        illustration:
          '<div class="tour-welcome">' +
            '<div class="tour-row">' +
              tourTile(2, 'tour-tile-sm') + tourTile(2, 'tour-tile-sm') +
              '<span class="tour-arrow">→</span>' + tourTile(3, 'tour-tile-sm') +
            '</div>' +
            '<div class="tour-row">' +
              tourTile(3, 'tour-tile-sm') + tourTile(3, 'tour-tile-sm') +
              '<span class="tour-arrow">→</span>' + tourTile(4, 'tour-tile-sm') +
            '</div>' +
            '<div class="tour-row" style="margin-top:6px">' +
              '<span style="background:#FAC775;color:#412402;padding:3px 10px;border-radius:999px;font-weight:800;font-size:12px">שרשרת ×3</span>' +
            '</div>' +
          '</div>',
        title: 'שרשרת — מכפיל ניקוד',
        desc: 'מיזוג שגורר מיזוג נוסף = <strong>שרשרת</strong>. כל קישור מכפיל את הניקוד: ×1.5, ×2, ×2.5, עד <strong>×3 על שרשרת ארוכה</strong>.'
      },
      // 7 — Tier-up bonuses
      {
        illustration:
          '<div class="tour-bonus-list">' +
            '<div class="tour-bonus-row"><span class="name">' + tourTile(5, 'tour-tile-sm') + 'ברק</span><span class="pts">+500</span></div>' +
            '<div class="tour-bonus-row"><span class="name">' + tourTile(6, 'tour-tile-sm') + 'כוכב</span><span class="pts">+1,500</span></div>' +
            '<div class="tour-bonus-row"><span class="name">' + tourTile(7, 'tour-tile-sm') + 'יהלום</span><span class="pts">+5,000</span></div>' +
            '<div class="tour-bonus-row"><span class="name">' + tourTile(8, 'tour-tile-sm') + 'כתר</span><span class="pts">+15,000</span></div>' +
          '</div>',
        title: 'בונוס פעם-ראשונה',
        desc: 'בכל משחק, פעם <strong>הראשונה</strong> שמגיעים לדרגה גבוהה — בונוס ניקוד מיידי + פיצוץ ויזואלי. <strong>כתר אחד = +15,000</strong>.'
      },
      // 8 — Game over
      {
        illustration: (function() {
          const cells = [];
          // First row full, rest empty — the game-over condition
          const filled = [2, 3, 4, 5];
          for (let i = 0; i < 4; i++) cells.push(tourTile(filled[i], 'tour-tile-sm'));
          for (let i = 0; i < 20; i++) cells.push('<span class="tour-tile tour-tile-empty" style="width:32px;height:32px;border-radius:6px"></span>');
          return '<div class="tour-mini-grid">' + cells.join('') + '</div>';
        })(),
        title: 'סיום משחק',
        desc: 'המשחק נגמר כששורה ה<strong>עליונה מתמלאת</strong>. אז תקבל מסך תוצאות — שתף את הציון, ראה את מקומך בלוח, ונסה שוב.'
      },
      // 9 — 4 modes
      {
        illustration:
          '<div class="tour-modes-grid">' +
            '<div class="tour-mode-card"><div class="ic">📅</div><div class="lbl">יומי</div><div class="desc">אותו לוח לכולם, פעם ביום</div></div>' +
            '<div class="tour-mode-card"><div class="ic">🎮</div><div class="lbl">אימון</div><div class="desc">חופשי, ללא לוח מובילים</div></div>' +
            '<div class="tour-mode-card"><div class="ic">👥</div><div class="lbl">חברים</div><div class="desc">תחרות פרטית עם קוד</div></div>' +
            '<div class="tour-mode-card"><div class="ic">🎁</div><div class="lbl">אתגרים</div><div class="desc">פרסים אמיתיים</div></div>' +
          '</div>',
        title: '4 מצבי משחק',
        desc: 'אותו משחק, ארבעה דרכים לשחק. תוכל להחליף ביניהם בטאבים שמתחת לסולם.'
      },
      // 10 — Ready
      {
        illustration:
          '<div class="tour-welcome">' +
            tourTile(8, 'tour-tile-lg') +
            '<div style="font-size:32px">🎯</div>' +
          '</div>',
        title: 'מוכן? קדימה!',
        desc: 'עכשיו אתה יודע הכל. תקיש על "<strong>בוא נתחיל</strong>" ונראה אותך מגיע לכתר.'
      }
    ];
  }

  let tourCurrentStep = 0;
  let _tourOnDone = null;
  function showTour(opts) {
    opts = opts || {};
    tourCurrentStep = (typeof opts.step === 'number') ? opts.step : 0;
    if (opts.onDone) _tourOnDone = opts.onDone;
    const existing = document.getElementById('tour-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'tour-modal';
    modal.className = 'info-modal';
    modal.innerHTML = '<div class="tour-card" id="tour-card"></div>';
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) closeTour({ markSeen: true }); };
    renderTourStep();
  }
  function renderTourStep() {
    const card = document.getElementById('tour-card');
    if (!card) return;
    const steps = tourSteps();
    const total = steps.length;
    if (tourCurrentStep < 0) tourCurrentStep = 0;
    if (tourCurrentStep >= total) { closeTour({ markSeen: true }); return; }
    const step = steps[tourCurrentStep];
    const dots = [];
    for (let i = 0; i < total; i++) {
      const cls = i < tourCurrentStep ? 'done' : (i === tourCurrentStep ? 'active' : '');
      dots.push('<div class="tour-progress-dot ' + cls + '"></div>');
    }
    const isLast = tourCurrentStep === total - 1;
    const isFirst = tourCurrentStep === 0;
    card.innerHTML =
      '<div class="tour-header">' +
        '<span class="tour-step-pill">שלב ' + (tourCurrentStep + 1) + ' מתוך ' + total + '</span>' +
        '<button class="tour-skip" id="tour-skip">דלג ✕</button>' +
      '</div>' +
      '<div class="tour-progress">' + dots.join('') + '</div>' +
      '<div class="tour-body">' +
        '<div class="tour-illustration">' + step.illustration + '</div>' +
        '<div class="tour-title">' + step.title + '</div>' +
        '<div class="tour-desc">' + step.desc + '</div>' +
      '</div>' +
      '<div class="tour-footer">' +
        (isFirst ? '' : '<button class="btn secondary" id="tour-prev">‹ הקודם</button>') +
        '<button class="btn" id="tour-next">' + (isLast ? 'בוא נתחיל!' : 'הבא ›') + '</button>' +
      '</div>';
    document.getElementById('tour-skip').onclick = function() { closeTour({ markSeen: true }); };
    document.getElementById('tour-next').onclick = function() {
      tourCurrentStep++;
      renderTourStep();
    };
    const prev = document.getElementById('tour-prev');
    if (prev) prev.onclick = function() {
      tourCurrentStep--;
      renderTourStep();
    };
  }
  function closeTour(opts) {
    opts = opts || {};
    const m = document.getElementById('tour-modal');
    if (m) m.remove();
    if (opts.markSeen !== false) {
      try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
      trackEvent('tutorial_complete');
    }
    if (_tourOnDone) { const cb = _tourOnDone; _tourOnDone = null; cb(); }
  }
  function hasSeenTour() {
    try {
      if (localStorage.getItem(TOUR_KEY) === '1') return true;
      // Existing players who played before the tour was added — treat as "seen"
      // so they get "שחק עכשיו" instead of the onboarding flow.
      var games = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10);
      if (games > 0) {
        localStorage.setItem(TOUR_KEY, '1'); // persist so we don't check again
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function showInfo() {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('info-modal')) return;
    const rows = [];
    for (let t = 1; t <= MAX_TIER; t++) {
      const ti = getActiveTiers()[t];
      rows.push(
        '<div class="tier-row reached" style="text-align:right;">' +
          '<div class="tier-icon-sm" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
          '<div class="tier-name">' + ti.name + '</div>' +
          '<div class="tier-pts">' + pieceValue(t).toLocaleString() + ' נק׳ במיזוג זוג</div>' +
        '</div>'
      );
    }
    const modal = document.createElement('div');
    modal.id = 'info-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="info-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="info-title">איך משחקים</div>' +
        '<div class="info-sub" style="margin-bottom:12px">הטל חלקים לעמודות. שני חלקים זהים שגובלים (אופקי/אנכי) — מתמזגים לדרגה הבאה.<br>המשחק נגמר כשהשורה העליונה מלאה.</div>' +
        '<div class="info-title" style="font-size:13px;margin-top:4px">ניקוד</div>' +
        '<div class="info-sub">דרגה × 10 × (1 + 0.3·דרגה) × גודל הקבוצה × שרשרת.<br>בנוסף: בונוס פעם-ראשונה במשחק — ⚡ ברק +500 · ⭐ כוכב +1,500 · 💎 יהלום +5,000 · 👑 כתר +15,000.</div>' +
        '<button class="btn" id="info-tour-btn" style="margin: 4px 0 12px">📖 פתח את המדריך המלא</button>' +
        '<div class="tier-table">' + rows.join('') + '</div>' +
        '<div class="credits">' +
          'מוזיקה: שלושה טראקים של Manuel Graf (לובי, משחק, סיום), רישיון CC BY 4.0.<br>' +
          '<a href="https://manuelgraf.com" target="_blank" rel="noopener">manuelgraf.com</a>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('info-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    const tourBtn = document.getElementById('info-tour-btn');
    if (tourBtn) tourBtn.onclick = function() { modal.remove(); showTour(); };
  }

  function buildTierBar(forceRebuild) {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    if (!forceRebuild && bar.children.length) return;
    bar.innerHTML = '';
    for (let t = 1; t <= MAX_TIER; t++) {
      const tier = getActiveTiers()[t];
      const cell = document.createElement('div');
      cell.className = 'tier-cell';
      cell.dataset.tier = String(t);
      cell.style.setProperty('--ring', tier.bg);
      const icon = document.createElement('div');
      icon.className = 'tier-icon';
      icon.style.background = tier.bg;
      icon.style.color = tier.fg;
      icon.innerHTML = tier.svg;
      const score = document.createElement('div');
      score.className = 'tier-score';
      score.textContent = pieceValue(t).toLocaleString();
      cell.appendChild(icon);
      cell.appendChild(score);
      bar.appendChild(cell);
    }
  }

  function highlightNextTier(tier) {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    const cells = bar.querySelectorAll('.tier-cell');
    cells.forEach(function(c) {
      c.classList.remove('active');
      c.classList.remove('cycling');
    });
    const cell = bar.querySelector('.tier-cell[data-tier="' + tier + '"]');
    if (cell) cell.classList.add('active');
  }

  // Token bumps with each new roll so a stale animation (still cycling from
  // the previous drop) bails out the moment a new pick arrives.
  let revealToken = 0;

  // Dramatic slot-machine animation. Three full passes through tiers 1..N
  // (admin-controlled), decelerating like a real slot, then a landing bounce
  // on the chosen tier. Cost-aware: bails out the moment a newer roll fires.
  async function revealNextTier(finalTier) {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;

    // Admin kill-switch: if disabled, just snap and skip the animation.
    if ((gameConfig && gameConfig.slot_enabled) === 'false') {
      highlightNextTier(finalTier);
      return;
    }

    const myToken = ++revealToken;
    const cells = bar.querySelectorAll('.tier-cell');
    cells.forEach(function(c) {
      const tier = parseInt(c.getAttribute('data-tier'), 10);
      if (tier !== finalTier) c.classList.remove('active');
      c.classList.remove('cycling');
      c.classList.remove('slot-landed');
    });

    // Admin-tunable spin parameters
    var maxSpinTier = parseInt((gameConfig && gameConfig.slot_intensity) || '8', 10) || 8;
    if (maxSpinTier < 1) maxSpinTier = 1;
    if (maxSpinTier > MAX_TIER) maxSpinTier = MAX_TIER;
    var totalDur = parseInt((gameConfig && gameConfig.slot_duration_ms) || '650', 10) || 650;
    if (totalDur < 150) totalDur = 150;
    if (totalDur > 2500) totalDur = 2500;
    // Speed scale also affects the slot — a faster game gets a faster slot.
    totalDur = Math.round(totalDur * (typeof gameSpeedScale === 'function' ? gameSpeedScale() : 1));

    // Build the spin: 3 full passes through 1..maxSpinTier, then land on finalTier.
    const sweep = [];
    const passes = 3;
    for (let p = 0; p < passes; p++) {
      for (let t = 1; t <= maxSpinTier; t++) sweep.push(t);
    }
    sweep.push(finalTier);

    // Per-frame durations: ease-in-quad (fast → slow), then normalize so
    // the sum lands exactly on totalDur.
    const n = sweep.length;
    const startMs = 22;
    const endMs = Math.max(70, totalDur / 8);
    const rawDurs = [];
    for (let i = 0; i < n; i++) {
      const prog = n > 1 ? i / (n - 1) : 1;
      rawDurs.push(startMs + (endMs - startMs) * (prog * prog));
    }
    const sumRaw = rawDurs.reduce(function(a,b) { return a+b; }, 0);
    const scale = sumRaw > 0 ? totalDur / sumRaw : 1;

    for (let i = 0; i < sweep.length; i++) {
      if (myToken !== revealToken) return;
      cells.forEach(function(c) { c.classList.remove('cycling'); });
      const cell = bar.querySelector('.tier-cell[data-tier="' + sweep[i] + '"]');
      if (cell) cell.classList.add('cycling');
      await sleep(Math.round(rawDurs[i] * scale));
    }

    if (myToken !== revealToken) return;
    cells.forEach(function(c) { c.classList.remove('cycling'); });
    const finalCell = bar.querySelector('.tier-cell[data-tier="' + finalTier + '"]');
    if (finalCell) {
      finalCell.classList.add('active');
      // Landing bounce — short bouncy scale-up so the slot feels like it "clicks" home.
      finalCell.classList.add('slot-landed');
      setTimeout(function() {
        if (finalCell) finalCell.classList.remove('slot-landed');
      }, 380);
    }
  }

  // Pick the next piece IMMEDIATELY so a fast tapper can drop again the
  // moment processChains() returns. The fancy cycling animation runs as
  // a non-blocking visual indicator (~600ms total) — it never gates input.
  function rollNextPiece() {
    const chosen = pickPiece();
    nextPiece = chosen;
    // Snap the tier bar to the new piece right now (the animation may still
    // be playing; revealToken makes it a no-op if a newer roll fired).
    highlightNextTier(chosen);
    // Fire-and-forget the cycle. If the player taps fast, the next call to
    // rollNextPiece will bump revealToken and the in-flight animation bails.
    revealNextTier(chosen);
  }

  function render(opts) {
    opts = opts || {};
    document.getElementById('score').textContent = score.toLocaleString();
    // Auto-shrink font for large scores
    var scoreEl = document.getElementById('score');
    if (scoreEl) {
      scoreEl.classList.remove('score-lg', 'score-xl');
      if (score >= 1000000) scoreEl.classList.add('score-xl');
      else if (score >= 100000) scoreEl.classList.add('score-lg');
    }
    var bestStatEl = document.getElementById('best');
    bestStatEl.textContent = best.toLocaleString();
    bestStatEl.classList.remove('val-lg', 'val-xl');
    if (best >= 1000000) bestStatEl.classList.add('val-xl');
    else if (best >= 100000) bestStatEl.classList.add('val-lg');
    updateBalanceDisplay();
    // Live best update — when score passes best during gameplay, update immediately
    if (score > best && best > 0 && !skinTrialMode && !opts.over) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch(e) {}
      document.getElementById('best').textContent = best.toLocaleString();
      // One-time "new best!" celebration during gameplay
      if (!bestBeatenThisGame) {
        bestBeatenThisGame = true;
        var bestEl2 = document.getElementById('best');
        if (bestEl2) { bestEl2.classList.add('new-best-live'); }
        showNewBestBanner();
      }
    }
    // "Near best" cue — once the current run gets within 10% of the personal
    // best, the best value pulses in gold to invite a record attempt.
    const bestEl = document.getElementById('best');
    if (bestEl) {
      if (best > 0 && score >= best * 0.9 && score < best) bestEl.classList.add('near-best');
      else if (!bestBeatenThisGame) bestEl.classList.remove('near-best');
    }
    buildTierBar();
    highlightNextTier(nextPiece);
    const wrap = document.getElementById('grid-wrap');

    if (opts.over) {
      const tierRows = [];
      for (let t = 1; t <= MAX_TIER; t++) {
        const ti = getActiveTiers()[t];
        const reached = t <= highestTier;
        tierRows.push(
          '<div class="tier-row ' + (reached ? 'reached' : 'locked') + '">' +
            '<div class="tier-icon-sm" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
            '<div class="tier-name">' + ti.name + '</div>' +
            '<div class="tier-pts">' + pieceValue(t).toLocaleString() + ' נק׳ למיזוג</div>' +
          '</div>'
        );
      }
      const emojis = [];
      for (let t = 1; t <= highestTier; t++) emojis.push(getActiveTiers()[t].emoji);

      let title;
      if (opts.isNewBest) title = '🎉 שיא אישי חדש!';
      else if (mode === 'daily' && opts.alreadyPlayed) title = '✅ סיימת את האתגר היומי';
      else if (score >= 100000) title = '🔥 מטורף! ' + score.toLocaleString();
      else if (score >= 50000) title = '💪 משחק אדיר!';
      else if (score >= 20000) title = '⭐ יפה מאוד!';
      else if (highestTier >= 7) title = '💎 הגעת ליהלום!';
      else if (highestTier >= 6) title = '⭐ הגעת לכוכב!';
      else if (score > best * 0.9 && best > 0) title = '😱 כמעט שיא!';
      else title = '🎮 סיום משחק';

      let shareHeader;
      if (mode === 'daily') {
        shareHeader = 'BLOOM · אתגר ' + formatDateHe(dailyDate) + '<br>' + score.toLocaleString() + ' נק\'';
      } else {
        shareHeader = 'BLOOM — ' + score.toLocaleString() + ' pts';
      }

      const showCountdown = mode === 'daily';
      const showLeaderboard = mode === 'daily' || mode === 'contest' || mode === 'practice';
      const isContestOver = mode === 'contest' && activeContestCode;
      const againLabel = isContestOver ? 'שחק עוד משחק בתחרות'
        : (mode === 'daily') ? 'שחק עוד משחק' : 'שחק שוב';
      const spectateBtn = isContestOver
        ? '<button class="btn secondary" id="spec-open"><span style="display:inline-flex;align-items:center;gap:6px;justify-content:center"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>צא לצפייה במשחקים חיים</span></button>'
        : '';

      // Build rival / motivation text from leaderboard data
      var rivalHtml = '';
      if (leaderboard.length > 0) {
        for (var ri = 0; ri < leaderboard.length; ri++) {
          if (leaderboard[ri].you && ri > 0) {
            var rivalAbove = leaderboard[ri - 1];
            var rivalGap = (rivalAbove.score || 0) - (leaderboard[ri].score || 0);
            if (rivalGap > 0 && rivalGap < score * 0.5) {
              rivalHtml = '<div class="over-rival">🎯 עוד <strong>' + rivalGap.toLocaleString() + '</strong> נקודות לנצח את <strong>' + escapeHtml(rivalAbove.name || 'אנונימי') + '</strong></div>';
            }
            break;
          }
        }
        if (!rivalHtml && leaderboard.length > 0 && leaderboard[0].you) {
          rivalHtml = '<div class="over-rival" style="color:#BA7517">👑 אתה מוביל את הטבלה!</div>';
        }
      }

      // Second chance: continue playing (once per game)
      // Note: alreadyPlayed only blocks continue in DAILY mode (where each player
      // gets ONE attempt per day). In practice/contest/duel modes, you can always
      // continue as long as usedContinue is false.
      var continuePrice = getEventNum('continue_price', 200);
      var continueBlockedByMode = (mode === 'daily' && opts.alreadyPlayed) || mode === 'challenge';
      var canContinue = !continueBlockedByMode && !usedContinue && score > 5000;
      var continueHtml = '';
      if (canContinue) {
        continueHtml =
          '<div style="display:flex;gap:8px;justify-content:center;margin:10px 0">' +
            '<button class="btn" id="continue-ad" style="background:#2E8B6F;color:#FFF;padding:10px 18px;font-size:13px;border-radius:12px;font-weight:700">▶️ צפה בפרסומת והמשך</button>' +
            '<button class="btn" id="continue-pay" style="background:transparent;border:1px solid #BA7517;color:#BA7517;padding:10px 14px;font-size:12px;border-radius:12px;font-weight:600">' + continuePrice + '💎 המשך</button>' +
          '</div>';
      }
      // Watch ad for credits. ONE claim per gameId — refreshing the page
      // doesn't bring back the offer for the same finished game, and the
      // server enforces both per-game dedup and a per-day cap so even
      // sessionStorage-clearing attacks can't farm credits.
      var adCredits = getEventNum('ad_watch_reward', 30);
      var alreadyClaimedAd = (typeof adClaimedForCurrentGame === 'function') && adClaimedForCurrentGame();
      var watchAdHtml = alreadyClaimedAd
        ? '<div style="margin-top:6px;font-size:11px;color:#6F6E68">✓ קיבלת ' + adCredits + '💎 על המשחק הזה</div>'
        : '<button class="btn" id="watch-ad-btn" style="background:transparent;border:1px solid #2E8B6F;color:#2E8B6F;padding:8px 16px;font-size:12px;border-radius:10px;margin-top:6px;font-weight:600">▶️ צפה בפרסומת וקבל ' + adCredits + '💎</button>';

      // ============ EMOTIONAL CONTEXT (1.3 game-over upgrade) ============
      // Rank pill with total players so #23 doesn't read as "23 out of nowhere"
      var rankPillHtml = '';
      if (dailyRank) {
        var rankPillBody = '🏆 מקום <strong>#' + dailyRank + '</strong>';
        if (dailyTotal && dailyTotal > 0) {
          rankPillBody += ' מתוך ' + dailyTotal.toLocaleString();
        }
        rankPillHtml = '<div class="lb-rank-pill">' + rankPillBody + '</div>';
      }

      // 1.2-mod — invite the player to claim a real name (replaces the
      // pre-game prompt). Only renders when the name is still the default
      // placeholder, so returning players never see it.
      var claimNameHtml = '';
      if (typeof hasRealPlayerName === 'function' && !hasRealPlayerName() && dailyRank && (mode === 'daily' || mode === 'practice')) {
        claimNameHtml = '<button class="btn over-claim-name" id="over-claim-name">✏️ קבע שם אמיתי בלוח</button>';
      }

      // Best-score delta — "+2,300 שיא חדש" / "החמצת ב-180" / "הגעת לשיא"
      var bestDeltaHtml = '';
      if (opts.isNewBest && prevBest > 0 && score > prevBest) {
        var delta = score - prevBest;
        bestDeltaHtml = '<div class="over-best-delta over-best-delta-up">🎉 שיא אישי חדש! <strong>+' + delta.toLocaleString() + '</strong> מעל הקודם</div>';
      } else if (prevBest > 0 && score < prevBest) {
        var miss = prevBest - score;
        var missPct = score / prevBest;
        if (missPct >= 0.9) {
          bestDeltaHtml = '<div class="over-best-delta over-best-delta-near">😱 קרוב לשיא! החמצת ב-<strong>' + miss.toLocaleString() + '</strong> בלבד</div>';
        }
      }

      // ──────────────────────────────────────────────────────────
      // Dynamic-board personal best banner (separate from the
      // global personal-best banner above). Drives "one more game
      // on THIS specific board" — the strongest puzzle-game loop.
      // ──────────────────────────────────────────────────────────
      var boardBestHtml = '';
      if (mode === 'dynamic' && opts.activeBoard) {
        var bbName = escapeHtml(opts.activeBoard.name || 'לוח');
        if (opts.isBoardBest) {
          var prevBb = (opts.boardBest && opts.boardBest.score > 0) ? opts.boardBest.score : 0;
          if (prevBb > 0) {
            var bbDelta = score - prevBb;
            boardBestHtml = '<div class="over-board-best over-board-best-up">🏆 שיא חדש ב<strong>' + bbName + '</strong>! +' + bbDelta.toLocaleString() + ' מעל ' + prevBb.toLocaleString() + '</div>';
          } else {
            boardBestHtml = '<div class="over-board-best over-board-best-up">🏆 הצבת את השיא הראשון שלך ב<strong>' + bbName + '</strong>!</div>';
          }
        } else if (opts.boardBest && opts.boardBest.score > 0) {
          var bbMiss = opts.boardBest.score - score;
          if (bbMiss > 0) {
            var bbMissPct = score / opts.boardBest.score;
            if (bbMissPct >= 0.85) {
              boardBestHtml = '<div class="over-board-best over-board-best-near">😱 כמעט עברת את עצמך ב<strong>' + bbName + '</strong>! חסר ' + bbMiss.toLocaleString() + '</div>';
            } else {
              boardBestHtml = '<div class="over-board-best over-board-best-target">🎯 השיא שלך ב<strong>' + bbName + '</strong>: ' + opts.boardBest.score.toLocaleString() + ' · נסה שוב!</div>';
            }
          }
        }
      }

      // Gap to next TOP-N tier — uses the top-50 list we already have
      var rankTierHtml = '';
      if (dailyRank && leaderboard && leaderboard.length > 0) {
        var TIER_TARGETS = [3, 10, 20, 50, 100];
        for (var ti2 = 0; ti2 < TIER_TARGETS.length; ti2++) {
          var target = TIER_TARGETS[ti2];
          if (dailyRank > target && leaderboard[target - 1]) {
            var targetScore = leaderboard[target - 1].score || 0;
            var gap = targetScore - score + 1;
            if (gap > 0 && gap < score * 2 + 10000) {
              rankTierHtml = '<div class="over-rank-tier">⬆️ עוד <strong>' + gap.toLocaleString() + '</strong> נקודות והיית ב-TOP ' + target + '</div>';
              break;
            }
          }
        }
      }
      // ====================================================================

      wrap.innerHTML =
        '<div class="overlay">' +
          '<div class="over-title">' + title + '</div>' +
          '<div class="over-score">' + score.toLocaleString() + '</div>' +
          '<div class="over-sub">הגעת ל' + getActiveTiers()[highestTier].name + ' · ' + highestTier + '/' + MAX_TIER + ' דרגות</div>' +
          rankPillHtml +
          claimNameHtml +
          bestDeltaHtml +
          boardBestHtml +
          (opts.boardLeader ? '<div class="over-board-rank" id="over-board-rank-host">⏳ מחשב דירוג בלוח…</div>' : '') +
          rankTierHtml +
          rivalHtml +
          continueHtml +
          // PRIMARY CTA — right after score
          '<button class="btn over-again-btn" id="again">' + againLabel + '</button>' +
          watchAdHtml +
          (function() {
            if (mode !== 'daily' && mode !== 'practice') return '';
            var s = loadStreak();
            var n = s.count | 0;
            var tomorrowReward = getDailyRewardAmount((n || 0) + 1);
            // §1.5 — streak FOMO. Sharper tone the longer the streak runs;
            // brand-new players get the gentler "+bonus tomorrow" version.
            if (n >= 7) return '<div class="over-streak over-streak-hot">🔥🔥 רצף של <strong>' + n + ' ימים</strong> — אל תאבד אותו! חזור מחר ל-<strong>' + tomorrowReward + ' 💎</strong></div>';
            if (n >= 3) return '<div class="over-streak over-streak-mid">🔥 רצף של <strong>' + n + ' ימים</strong> — חזור מחר ל-<strong>' + tomorrowReward + ' 💎</strong> בונוס</div>';
            if (n >= 1) return '<div class="over-streak over-streak-low">🔥 ' + n + ' ימים ברצף! חזור מחר ל-<strong>' + tomorrowReward + ' 💎</strong> בונוס</div>';
            return '<div class="over-streak over-streak-cold">💪 חזור מחר לאתגר יומי + <strong>' + tomorrowReward + ' 💎</strong> בונוס יומי 🔥</div>';
          })() +
          (showCountdown ? '<div class="countdown" id="countdown"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>אתגר חדש בעוד <span id="countdown-val">--:--:--</span></span></div>' : '') +
          // §1.6 — "already played today" funnel. The audit calls out that
          // the countdown screen is a dead-end and proposes practice /
          // contests / challenges as forward actions. Only renders when the
          // player has already completed today's daily.
          ((mode === 'daily' && opts.alreadyPlayed) ?
            '<div class="over-funnel">' +
              '<div class="over-funnel-title">אבל למה לחכות?</div>' +
              '<div class="over-funnel-grid">' +
                '<button class="over-funnel-btn over-funnel-practice" id="over-funnel-practice">🎮 שחק פרקטיס</button>' +
                '<button class="over-funnel-btn over-funnel-contest" id="over-funnel-contest">👥 תחרות חברים</button>' +
                '<button class="over-funnel-btn over-funnel-challenge" id="over-funnel-challenge">🏆 אתגרי BLOOM</button>' +
              '</div>' +
            '</div>'
          : '') +
          (showLeaderboard ? renderLeaderboard() : '') +
          '<div class="tier-table">' + tierRows.join('') + '</div>' +
          // Game stats summary
          (function() {
            if (gameTotalMerges === 0) return '';
            var gameDur = Date.now() - (gameStartTime || Date.now());
            var durMin = Math.floor(gameDur / 60000);
            var durSec = Math.floor((gameDur % 60000) / 1000);
            var durText = durMin > 0 ? durMin + ' דק\' ' + durSec + ' שנ\'' : durSec + ' שניות';

            // Find the tier that scored the most points
            var topTier = 0, topTierPts = 0;
            for (var tt = 2; tt <= MAX_TIER; tt++) {
              if ((gamePointsPerTier[tt] || 0) > topTierPts) { topTier = tt; topTierPts = gamePointsPerTier[tt]; }
            }

            var statsHtml = '<div class="game-stats-summary">';
            statsHtml += '<div class="gss-title">📊 סיכום המשחק</div>';

            // Time badge
            statsHtml += '<div class="gss-time">⏱ ' + durText + '</div>';

            statsHtml += '<div class="gss-grid">';
            for (var t = 2; t <= MAX_TIER; t++) {
              var count = gameMergesPerTier[t] || 0;
              var pts = gamePointsPerTier[t] || 0;
              if (count === 0 && t > highestTier) continue;
              var ti = getActiveTiers()[t];
              var isTop = (t === topTier && topTierPts > 0);
              var barWidth = gameTotalMerges > 0 ? Math.max(4, Math.round(count / gameTotalMerges * 100)) : 0;
              statsHtml += '<div class="gss-row' + (isTop ? ' gss-top' : '') + '">' +
                '<div class="gss-icon" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
                '<div class="gss-bar-wrap"><div class="gss-bar" style="width:' + barWidth + '%;background:' + ti.bg + '"></div></div>' +
                '<div class="gss-merge-count">×' + (count || '—') + '</div>' +
                '<div class="gss-pts">' + (pts > 0 ? pts.toLocaleString() : '—') + '</div>' +
                (isTop ? '<div class="gss-crown">🔥</div>' : '') +
              '</div>';
            }
            statsHtml += '</div>';

            // Chain explanation + moves
            var chainText = currentGameMaxChain >= 4 ? '🔥🔥 שרשרת אגדית ×' + currentGameMaxChain + '!'
              : currentGameMaxChain >= 3 ? '🔥 שרשרת מרשימה ×' + currentGameMaxChain
              : currentGameMaxChain >= 2 ? '🔗 שרשרת ×' + currentGameMaxChain
              : '🔗 ללא שרשרת';

            statsHtml += '<div class="gss-footer">' +
              '<span>' + chainText + '</span>' +
              '<span>🎮 ' + (dropsCount || 0) + ' מהלכים</span>' +
              '<span>🎯 ' + gameTotalMerges + ' מיזוגים</span>' +
            '</div>';

            // Total play time "addiction badge"
            var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY) + gameDur;
            var totalHours = Math.floor(totalMs / 3600000);
            var totalMins = Math.floor((totalMs % 3600000) / 60000);
            var totalText = totalHours > 0 ? totalHours + ' שעות ו-' + totalMins + ' דקות' : totalMins + ' דקות';
            statsHtml += '<div class="gss-addiction">' +
              '<span class="gss-addiction-icon">🕐</span>' +
              '<span>סה"כ שיחקת <strong>' + totalText + '</strong> ב-BLOOM</span>' +
            '</div>' +
            '<div class="gss-addiction-share">' +
              '<button class="gss-addiction-share-btn" id="gss-addiction-share">📤 שתף את ההתמכרות שלך</button>' +
            '</div>';

            statsHtml += '</div>';
            return statsHtml;
          })() +
          (playerBalance > 0 || playerCode ? '<div style="text-align:center;margin:8px 0;font-size:12px;direction:ltr">' +
            (playerCode ? '<span style="color:#6F6E68;letter-spacing:0.08em;font-weight:600">' + playerCode + '</span>' : '') +
            (playerBalance > 0 ? ' · <span style="color:#BA7517;font-weight:700">' + playerBalance.toLocaleString() + ' 💎</span>' : '') +
          '</div>' : '') +
          '<div class="share-label">התוצאה לשיתוף</div>' +
          (function() {
            var gameDur = Date.now() - (gameStartTime || Date.now());
            var durMin = Math.floor(gameDur / 60000);
            var durSec = Math.floor((gameDur % 60000) / 1000);
            var durText = durMin > 0 ? durMin + ':' + String(durSec).padStart(2, '0') : durSec + '"';
            var chainBit = currentGameMaxChain >= 2 ? ' · 🔗×' + currentGameMaxChain : '';
            var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY);
            var totalH = Math.floor(totalMs / 3600000);
            var totalM = Math.floor((totalMs % 3600000) / 60000);
            var totalText = totalH > 0 ? totalH + ' שעות ו-' + totalM + ' דק\'' : totalM + ' דקות';
            return '<div class="share-card">' + shareHeader + '<br>' + emojis.join('') +
              '<br><span style="font-size:11px;opacity:0.8">⏱' + durText + chainBit + ' · 🎯' + gameTotalMerges + ' מיזוגים</span>' +
              '<br><span style="font-size:10px;opacity:0.6">🕐 סה"כ ' + totalText + ' ב-BLOOM</span>' +
              '<br><br>🎮 ' + (window.location.host || 'bloom-game') + '</div>';
          })() +
          '<div class="share-actions">' +
            '<button class="btn" id="share-btn">שתף תוצאה</button>' +
            '<button class="share-wa-btn" id="share-wa-btn">' +
              '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
              '<span>WhatsApp</span>' +
            '</button>' +
          '</div>' +
          spectateBtn +
        '</div>';
      document.getElementById('again').onclick = function() {
        if (isContestOver) init('contest', { fresh: true });
        else init('practice', { fresh: true });
      };

      // §1.6 — already-played-today funnel CTAs. Only present when the
      // game-over is the "you've already played daily" variant.
      var fnlPractice = document.getElementById('over-funnel-practice');
      if (fnlPractice) fnlPractice.onclick = function() {
        init('practice', { fresh: true });
      };
      var fnlContest = document.getElementById('over-funnel-contest');
      if (fnlContest) fnlContest.onclick = function() {
        if (typeof showContestMenu === 'function') showContestMenu();
      };
      var fnlChallenge = document.getElementById('over-funnel-challenge');
      if (fnlChallenge) fnlChallenge.onclick = function() {
        if (typeof showChallengesList === 'function') showChallengesList('game-over-funnel');
      };

      // 1.2-mod — "claim a real name" CTA wiring. Opens the existing
      // promptForName in edit mode (pre-filled with default), then
      // re-submits + re-renders so the leaderboard row picks up the
      // new name without waiting for the next game.
      var claimNameBtn = document.getElementById('over-claim-name');
      if (claimNameBtn) claimNameBtn.onclick = function() {
        promptForName(function() {
          if (typeof submitAndShowLeaderboard === 'function') submitAndShowLeaderboard();
          render({ over: true, isNewBest: !!opts.isNewBest, alreadyPlayed: !!opts.alreadyPlayed });
        }, { edit: true });
      };

      // Continue (second chance) — watch ad or pay
      var continueAdBtn = document.getElementById('continue-ad');
      var continuePayBtn = document.getElementById('continue-pay');
      if (continueAdBtn) continueAdBtn.onclick = function() {
        this.disabled = true; this.textContent = '⏳ טוען פרסומת...';
        simulateAdWatch(function() {
          usedContinue = true;
          // Clear top 2 rows
          for (var r = 0; r < 2; r++)
            for (var c = 0; c < getBoardCols(); c++) grid[r][c] = 0;
          applyGravity();
          busy = false;
          startEventSystem();
          playMusic('game');
          render();
          showEventBanner('💪 חיים נוספים!', 'המשך לשחק!', 'continue');
          shakeGrid(3);
          if (mode === 'practice') savePracticeGameState();
        });
      };
      if (continuePayBtn) continuePayBtn.onclick = function() {
        var price = getEventNum('continue_price', 200);
        if (playerBalance < price) {
          this.textContent = 'אין מספיק 💎';
          this.disabled = true;
          return;
        }
        this.disabled = true; this.textContent = '⏳...';
        fetch(API_BASE + '/api/player/spend', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, 'X-Device-Token': deviceToken },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, amount: price, reason: 'continue' })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            usedContinue = true;
            fetchPlayerCode();
            for (var r = 0; r < 2; r++)
              for (var c = 0; c < getBoardCols(); c++) grid[r][c] = 0;
            applyGravity();
            busy = false;
            startEventSystem();
            playMusic('game');
            render();
            showEventBanner('💪 חיים נוספים!', 'המשך לשחק!', 'continue');
            shakeGrid(3);
            if (mode === 'practice') savePracticeGameState();
          } else {
            continuePayBtn.textContent = 'אין מספיק 💎';
          }
        }).catch(function() { continuePayBtn.textContent = 'שגיאה'; });
      };

      // Watch ad for free credits.
      // Goes through POST /api/player/ad-watch with the current gameId.
      // Server enforces per-game dedup + daily cap + 30s cooldown, so the
      // F5-spam exploit (refresh resets local state, button reappears,
      // event_gift cooldown only 30s = ~200💎/hr forever) is now bounded
      // to a fixed daily ceiling.
      var watchAdBtn = document.getElementById('watch-ad-btn');
      if (watchAdBtn) watchAdBtn.onclick = function() {
        this.disabled = true; this.textContent = '⏳ טוען פרסומת...';
        var self = this;
        simulateAdWatch(function() {
          var gameId = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : null;
          if (!gameId) { self.textContent = 'שגיאה'; return; }
          apiPost('/api/player/ad-watch', { gameId: gameId })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              if (d && d.ok) {
                if (typeof markAdClaimedForCurrentGame === 'function') markAdClaimedForCurrentGame();
                self.textContent = '✓ קיבלת ' + (d.reward | 0) + '💎';
                self.style.background = '#2E8B6F';
                self.style.color = '#FFF';
                if (typeof d.newBalance === 'number') {
                  playerBalance = d.newBalance | 0;
                  try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch (e) {}
                  if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                }
              } else if (d && d.reason === 'already_claimed') {
                if (typeof markAdClaimedForCurrentGame === 'function') markAdClaimedForCurrentGame();
                self.textContent = '✓ כבר נדרש';
                self.disabled = true;
              } else if (d && d.reason === 'daily_cap') {
                self.textContent = 'הגעת למקסימום היומי (' + (d.dailyCap | 0) + ')';
                self.disabled = true;
              } else if (d && d.reason === 'rate_limited') {
                var secs = Math.ceil((d.cooldownMs | 0) / 1000) || 30;
                self.textContent = 'נסה שוב בעוד ' + secs + 'ש\'';
                setTimeout(function() {
                  self.textContent = '▶️ צפה בפרסומת וקבל ' + getEventNum('ad_watch_reward', 30) + '💎';
                  self.disabled = false;
                }, secs * 1000);
              } else {
                self.textContent = 'שגיאה';
                setTimeout(function() {
                  self.textContent = '▶️ צפה בפרסומת וקבל ' + getEventNum('ad_watch_reward', 30) + '💎';
                  self.disabled = false;
                }, 3000);
              }
            })
            .catch(function() { self.textContent = 'שגיאת רשת'; });
        });
      };

      document.getElementById('share-btn').onclick = shareResult;
      var waShareBtn = document.getElementById('share-wa-btn');
      if (waShareBtn) waShareBtn.onclick = function() { shareResultWhatsApp(); };
      var gssAddictionShare = document.getElementById('gss-addiction-share');
      if (gssAddictionShare) gssAddictionShare.onclick = function() { shareAddiction('whatsapp'); };
      const specBtn = document.getElementById('spec-open');
      if (specBtn) specBtn.onclick = function() { openSpectatorPicker('game-over'); };
      if (showCountdown) startCountdown();
      equipOverlay();
      return;
    }

    let gridEl = document.getElementById('grid');
    if (!gridEl) {
      wrap.innerHTML = '<div class="grid" id="grid"></div>';
      gridEl = document.getElementById('grid');
    } else {
      gridEl.innerHTML = '';
    }
    // Size the grid to fit the available area on BOTH axes (CSS aspect-ratio
    // alone can't constrain by both width and height cross-browser).
    fitGrid();
    // Dynamic Boards (phase 3, May 2026) — column multiplier pills.
    // The bar is shown whenever there's an active column multiplier,
    // regardless of mode. The per-mode `init()` branch decides whether
    // to apply a board (daily/practice/duel/dynamic); if it did,
    // getColumnMultipliers() returns non-null and the bar renders here.
    // Otherwise the bar is invisible — same as it was before phase 3.
    // Mounted as a sibling of #grid-wrap, width-matched to the grid.
    (function syncColumnMultiplierBar() {
      var mults = (typeof getColumnMultipliers === 'function') ? getColumnMultipliers() : null;
      var pageHost = wrap.parentNode;
      var existing = pageHost && pageHost.querySelector('.col-mult-bar');
      if (!pageHost || !mults || opts.over) {
        if (existing) existing.remove();
        return;
      }
      var bar = existing || document.createElement('div');
      bar.className = 'col-mult-bar';
      bar.style.width = gridEl.style.width || '100%';
      bar.innerHTML = '';
      for (var ci = 0; ci < mults.length; ci++) {
        var m = mults[ci] || 1;
        var pill = document.createElement('div');
        var tierClass = m >= 6 ? 'tier-6x' : (m >= 4 ? 'tier-4x' : (m >= 2 ? 'tier-2x' : 'tier-1x'));
        pill.className = 'col-mult-pill ' + tierClass;
        pill.textContent = '×' + (Number.isInteger(m) ? m : m.toFixed(1));
        bar.appendChild(pill);
      }
      if (!existing) {
        pageHost.insertBefore(bar, wrap);  // sits between #tier-bar and #grid-wrap
      }
    })();
    // `?debug=1` (or window.__bloomEngineLog) draws a tiny "r,c · tN" tag
    // on every cell so the user can verify exactly which square got which
    // tile — and which cells a bomb actually destroyed vs the visual blast.
    var debugCells = !!window.__bloomEngineLog;
    // RENDER-TIME INVARIANT CHECK — catches the "floating tile" class of
    // bug exactly when it manifests on screen, not via offline simulation.
    // If a column has an empty cell BELOW a filled cell, it's a bug — the
    // grid must always be gravity-stable when render() runs. We auto-heal
    // (apply gravity) and loudly log so the next session captures the
    // state that triggered the violation.
    if (!opts.over) {
      var violated = false;
      var violationDetail = '';
      for (var cc = 0; cc < getBoardCols(); cc++) {
        var seenFilled = false;
        for (var rr = 0; rr < getBoardRows(); rr++) {
          if (grid[rr][cc] !== 0) seenFilled = true;
          else if (seenFilled) {
            violated = true;
            violationDetail = 'col=' + cc + ' row=' + rr + ' is EMPTY below a filled tile';
            break;
          }
        }
        if (violated) break;
      }
      if (violated) {
        console.warn('[render] ❌ GRAVITY VIOLATION detected — auto-healing', violationDetail,
          'grid=' + (typeof serializeGrid === 'function' ? serializeGrid() : '?'));
        applyGravity();
        console.warn('[render] ✓ gravity applied, new state grid=' + (typeof serializeGrid === 'function' ? serializeGrid() : '?'));
      }
    }
    // Dynamic Boards — special-cell lookup (phase 3A). Build a quick
    // map from row,col → cell so the per-tile render below can paint a
    // gold ring. Null when no special-cells board is active.
    var _specCells = (typeof getSpecialCells === 'function') ? getSpecialCells() : null;
    var _specByPos = null;
    if (_specCells && _specCells.length) {
      _specByPos = {};
      for (var sci = 0; sci < _specCells.length; sci++) {
        var sc = _specCells[sci];
        _specByPos[sc.row + ',' + sc.col] = sc;
      }
    }
    // Phase 3D+: compute which empty cells sit BELOW a frozen tile in
    // the same column. They get a .frozen-shadow tint so the player
    // understands the empty area is intentionally blocked by ice from
    // above, not just an empty hole. Walk top-down per column, find the
    // topmost frozen-with-tile, then mark empty cells below it (stop
    // at the next non-empty cell).
    var _frozenShadowed = null;
    if (_specByPos && Array.isArray(grid)) {
      _frozenShadowed = {};
      for (var fc = 0; fc < getBoardCols(); fc++) {
        var anchor = -1;
        for (var fr = 0; fr < getBoardRows(); fr++) {
          var spp = _specByPos[fr + ',' + fc];
          if (spp && spp.type === 'frozen' && grid[fr][fc] !== 0) { anchor = fr; break; }
        }
        if (anchor >= 0) {
          for (var fr2 = anchor + 1; fr2 < getBoardRows(); fr2++) {
            if (grid[fr2][fc] === 0) {
              _frozenShadowed[fr2 + ',' + fc] = true;
            } else {
              break;
            }
          }
        }
      }
    }
    for (let r = 0; r < getBoardRows(); r++) {
      for (let c = 0; c < getBoardCols(); c++) {
        const t = grid[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        // Phase 5 — shape voids. If this cell is masked off, paint it
        // as void and skip everything else (no tile, no special ring,
        // no events). The cell still occupies its grid slot so fitGrid
        // dimensions stay rectangular, but visually disappears.
        if (typeof isShapeInactiveAt === 'function' && isShapeInactiveAt(r, c)) {
          cell.classList.add('shape-void');
          gridEl.appendChild(cell);
          continue;
        }
        // Mark special cells BEFORE the tile-fill branch so the ring shows
        // even on empty squares (player needs to know where to aim).
        if (_specByPos) {
          var spec = _specByPos[r + ',' + c];
          if (spec) {
            cell.classList.add('special-' + spec.type);
            // Frozen-cell crack progression: if there's a tile here and
            // its thaw count > 0, paint cracks. After 3 cracks the tile
            // shatters (handled by the engine — by render time, the tile
            // is already gone, so this only fires while count is 1-2).
            if (spec.type === 'frozen' && t > 0 && typeof getFrozenThawCount === 'function') {
              var thawN = getFrozenThawCount(r, c);
              if (thawN > 0) cell.classList.add('frozen-crack-' + Math.min(3, thawN));
            }
          }
        }
        // Shadow indicator: empty cell below a frozen anchor in the
        // same column — gravity is blocked by the ice above.
        if (_frozenShadowed && _frozenShadowed[r + ',' + c]) {
          cell.classList.add('frozen-shadow');
        }
        if (t > 0) {
          cell.classList.add('filled');
          // tier-N (1..8) class — used by Aurora CSS for per-tier shadows,
          // shimmer (tier-8), breathing (tier-6/7). Other skins ignore it.
          cell.classList.add('tier-' + t);
          if (t >= 5 && t < MAX_TIER) cell.classList.add('tier-high');
          if (t === MAX_TIER) cell.classList.add('tier-crown');
          const ti = getActiveTiers()[t];
          cell.style.background = ti.bg;
          cell.style.color = ti.fg;
          cell.innerHTML = ti.svg;
          if (opts.appearing && opts.appearing[0] === r && opts.appearing[1] === c) cell.classList.add('appearing');
          if (opts.merging && opts.merging[0] === r && opts.merging[1] === c) {
            cell.classList.add('merging');
            // Aurora variance + chain class — controls auroraMergeBig variant
            // and randomises the scale peak. No-op for non-Aurora skins.
            if (opts.mergeChain && opts.mergeChain >= 2) {
              cell.classList.add('chain-' + Math.min(8, opts.mergeChain));
            }
            if (typeof auroraSetMergeVariance === 'function') auroraSetMergeVariance(cell);
          }
        }
        if (debugCells) {
          var tag = document.createElement('span');
          tag.className = 'cell-debug-tag';
          tag.textContent = r + ',' + c + (t > 0 ? '·t' + t : '');
          cell.appendChild(tag);
        }
        (function(rowIdx, colIdx) {
          cell.onclick = function() {
            if (activePowerup && handlePowerupClick(rowIdx, colIdx)) return;
            drop(colIdx);
          };
        })(r, c);
        gridEl.appendChild(cell);
      }
    }
    // Near-death warning: red glow when board is almost full
    if (!opts.over) {
      var filledRows = countFilledRows();
      if (filledRows >= 4) gridEl.classList.add('near-death');
      else gridEl.classList.remove('near-death');
      // Music tempo: speed up as board fills (Tetris style)
      updateMusicTempo(filledRows);
    }
    // Challenge-mode visual: pin the prize chip over the grid + hide the reset
    // button (which would otherwise let the player rage-restart their only attempt).
    const resetEl = document.getElementById('reset');
    if (resetEl) resetEl.style.display = (mode === 'challenge' && activeChallenge) ? 'none' : '';
    if (mode === 'challenge' && activeChallenge) {
      const existingChip = wrap.querySelector('.challenge-prize-chip');
      if (!existingChip) {
        const chip = document.createElement('div');
        chip.innerHTML = challengePrizeChipHtml();
        if (chip.firstChild) wrap.appendChild(chip.firstChild);
      }
    }
    // Reposition event overlay (it's fixed on body, needs coord update after grid rebuild)
    if (activeEvent && !opts.over) {
      requestAnimationFrame(repositionEventOverlay);
    }
  }

  document.getElementById('reset').onclick = function() {
    if (mode === 'contest') {
      if (!confirm('אתה בתחרות! התחלה מחדש תאפס את הניקוד. להמשיך?')) return;
    }
    var hasPiece = grid && grid.some(function(r) { return r.some(function(c) { return c > 0; }); });
    if (hasPiece && score > 100) {
      if (!confirm('להתחיל מחדש? המשחק הנוכחי (' + score.toLocaleString() + ' נק\') יימחק.')) return;
    }
    init(undefined, { fresh: true });
  };
  document.getElementById('info').onclick = showInfo;
  // Tile shop
  document.getElementById('tile-shop-stat').onclick = function() { showTileShop(); };
  loadTilePrices();
  updateBalanceDisplay();
  document.getElementById('mute').onclick = function() { openMuteMenu('top'); };
  document.getElementById('leaderboard').onclick = openLeaderboardModal;
  document.getElementById('achievements').onclick = openAchievementsModal;
  document.getElementById('home-btn').onclick = function() {
    if (skinTrialMode) endSkinTrial();
    if (mode === 'contest') saveContestGameState();
    if (mode === 'practice') savePracticeGameState();
    showHome();
  };
  // Mode navigation is now wired inside updateModeBar() via the segmented
  // .mode-tabs control — every tab routes to its mode directly and saves
  // contest state when leaving contest. No single mode-switch button anymore.

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      pauseAllMusic();
      if (mode === 'contest') saveContestGameState();
      if (mode === 'practice') savePracticeGameState();
    } else if (document.visibilityState === 'visible' && !isMusicMuted()) {
      resumeCurrentMusic();
    }
    // Resume an immediate contest-board refresh when the tab regains focus
    if (document.visibilityState === 'visible' && contestRefreshCode) {
      refreshContestBoardSilently();
    }
    // Same for the My Contests list, if it's open
    if (document.visibilityState === 'visible' && document.getElementById('mclb-body')) {
      fetchMyContests({ fresh: true }).then(function(c) { renderMyContestsBody(c); });
    }
    // And for the in-game overtake watcher
    if (document.visibilityState === 'visible' && overtakeCode && overtakeTimer) {
      refreshOvertake();
    }
  });
  window.addEventListener('beforeunload', function() {
    if (mode === 'contest') saveContestGameState();
    if (mode === 'practice') savePracticeGameState();
  });

  /* Browsers block audio until the first user interaction.
     Prime once on any pointer/touch/key event so the lobby track
     (queued by showHome) actually starts playing. */
  let audioPrimed = false;
  function primeAudio() {
    if (audioPrimed) return;
    audioPrimed = true;
    ensureAudio();
    if (currentTrack && !isMusicMuted()) {
      const t = MUSIC_TRACKS[currentTrack];
      if (t && !t.source) fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
    }
  }
  document.addEventListener('pointerdown', primeAudio, { once: true, capture: true });
  document.addEventListener('touchstart',  primeAudio, { once: true, capture: true });
  document.addEventListener('keydown',     primeAudio, { once: true, capture: true });

  // ============================================================
  // PLAYER HEARTBEAT — tells the server this player is active
  // so the admin live view shows ALL players, not just contests.
  // ============================================================
  var _heartbeatTimer = null;
  function sendHeartbeat() {
    if (document.visibilityState === 'hidden') return;
    if (document.getElementById('home-screen')) return;
    if (window.__bloomBotActive) return; // bot games don't appear in admin stats
    // Don't send heartbeat if game is over (admin shouldn't see finished players as "active")
    if (window.__bloomGameOver) return;
    // Don't send heartbeat if no game is active (no grid initialized)
    if (!Array.isArray(grid) || grid.length === 0) return;
    var gridData = grid.map(function(row) { return row.slice(); });
    fetch(API_BASE + '/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        token: deviceToken,
        displayName: getPlayerName() || 'אנונימי',
        mode: mode,
        score: score | 0,
        highestTier: highestTier | 0,
        grid: gridData
      })
    }).catch(function() {});
  }
  _heartbeatTimer = setInterval(sendHeartbeat, 5000);
  // Send first heartbeat immediately on interaction
  sendHeartbeat();

  // Called from game-over to immediately remove player from admin live view
  window.endHeartbeat = function() {
    try {
      fetch(API_BASE + '/api/heartbeat/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
      }).catch(function() {});
    } catch(e) {}
  };

  // Register the service worker for offline play. Silent if unsupported
  // (older Safari) — the game still works fine without it.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(e) {
        console.warn('SW registration failed', e);
      });
    });
  }

  updateMuteUI();
  renderStreakBadge();

  // ============================================================
  // SOCIAL NOTIFICATIONS REFRESH LOOP — instant in-app delivery
  // ============================================================
  // Unified poller that scans BOTH /api/duels/mine AND
  // /api/player/gifts/inbox so every social event (duel invite,
  // result, decline, expire, gift) surfaces inside ~10 seconds
  // while the app is foregrounded. Previously duels polled every
  // 60s and gifts polled exactly once on home open — meaning a
  // gift sent mid-game was invisible to the recipient until they
  // navigated back to home.
  //
  // Triggered on:
  //   (1) boot (after 1.5s warmup so deviceId is ready)
  //   (2) setInterval every 10s while the tab is visible
  //   (3) visibilitychange → visible
  //   (4) window.focus (some browsers fire one event but not the other)
  //
  // True device-level push (closed-app notifications) requires
  // PWA web push + VAPID keys + iOS Add-to-Home-Screen install —
  // tracked separately. This loop covers the in-app case at the
  // sub-perception threshold.
  var isSpectator = new URLSearchParams(window.location.search).has('watch');
  if (!isSpectator) {
    function refreshSocial() {
      if (document.visibilityState === 'hidden') return;
      try {
        if (typeof window.__bloomCheckIncomingDuels === 'function') {
          window.__bloomCheckIncomingDuels();
        }
      } catch (e) { console.warn('[social] duel check failed', e); }
      try {
        if (typeof window.__bloomPollGiftInbox === 'function') {
          window.__bloomPollGiftInbox();
        }
      } catch (e) { console.warn('[social] gift check failed', e); }
    }
    setTimeout(refreshSocial, 1500);
    setInterval(refreshSocial, 10000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') refreshSocial();
    });
    window.addEventListener('focus', refreshSocial);
  }

  // Restore last active mode on refresh so players don't lose context.
  // Default to 'daily' for first-time visitors.
  var LAST_MODE_KEY = 'bloom_last_mode';
  var savedMode = localStorage.getItem(LAST_MODE_KEY) || 'daily';
  // Challenge can't be resumed, contest needs fresh fetch — safe to restore daily/practice.
  if (savedMode !== 'daily' && savedMode !== 'practice') savedMode = 'daily';

  // ============================================================
  // EARLY: Admin spectator check — must happen BEFORE init/home/contest
  // so the spectator doesn't accidentally trigger user's game state,
  // contest preview, or home screen render.
  // ============================================================
  const urlParams = new URLSearchParams(window.location.search);
  var watchTarget = urlParams.get('watch');
  if (watchTarget) {
    // Bypass everything. Don't init game, don't show home, don't fire contest preview.
    document.title = '👁 צפייה — BLOOM';
    // Make sure the grid container exists; we re-render it ourselves
    startUniversalSpectator(watchTarget);
    return; // ← stop the rest of boot
  }

  init(savedMode);

  // Show home only for genuine first-timers or if the player was idle.
  // Returning mid-game players go straight to their game.
  var hasHistory = loadGamesPlayed() > 0;
  var hasPracticeState = !!loadPracticeGameState();
  if (!hasHistory || (savedMode === 'daily' && !hasPracticeState)) {
    // §1.1 — first-time players see the 3-step FTUE before the home
    // screen. Returning players (anyone with the bloom_ftue_done flag,
    // or anyone with games_played > 0) skip straight to home.
    if (typeof ftueShouldRun === 'function' && ftueShouldRun() && !hasHistory) {
      startFTUE(function() { showHome(); });
    } else {
      showHome();
    }
  }

  // Persist mode on every init so we can restore on refresh.
  // (the save is inside init() itself — see 'bloom_last_mode' setItem)

  // Visit ping — fire-and-forget. Lets the admin dashboard distinguish
  // "visited but didn't play" from "didn't visit at all" (bounce rate).
  try {
    fetch(API_BASE + '/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
    }).catch(function() {});
  } catch (e) {}

  // Check for contest link
  const contestCodeFromURL = urlParams.get('c');
  if (contestCodeFromURL) {
    setTimeout(function() {
      showContestPreview(contestCodeFromURL.toUpperCase());
    }, 100);
  }

  // Universal spectator — works for ALL modes (practice, daily, contest, challenge)
  var _uniSpecTimer = null;
  function startUniversalSpectator(targetId) {
    if (_uniSpecTimer) { clearInterval(_uniSpecTimer); _uniSpecTimer = null; }
    var wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    var ROWS = getBoardRows(), COLS = getBoardCols();
    var cellsHtml = '';
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        cellsHtml += '<div class="cell"></div>';
      }
    }
    wrap.innerHTML =
      '<div style="text-align:center;padding:16px 0;direction:rtl">' +
        '<div style="font-size:15px;font-weight:700;color:#1C1A18" id="uspec-name">⏳ מתחבר לשחקן...</div>' +
        '<div style="font-size:12px;color:#6F6E68;margin-top:4px" id="uspec-meta">ממתין לנתונים</div>' +
        '<div style="font-size:36px;font-weight:700;margin:10px 0;color:#1C1A18" id="uspec-score">—</div>' +
      '</div>' +
      '<div class="spectator-grid"><div class="grid" id="uspec-grid">' + cellsHtml + '</div></div>' +
      '<div style="text-align:center;margin-top:14px">' +
        '<div style="font-size:10px;color:#A8A6A0;margin-bottom:8px" id="uspec-status">polling…</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn" id="uspec-back" style="background:#1C1A18;color:#FAC775;font-weight:700">← חזרה לאדמין</button>' +
          '<button class="btn secondary" id="uspec-close">סגור</button>' +
        '</div>' +
      '</div>';
    // Both buttons: try multiple navigation strategies for max compatibility
    function closeSpectator() {
      if (_uniSpecTimer) { clearInterval(_uniSpecTimer); _uniSpecTimer = null; }
      // Strategy 1: close tab if opened by admin (target=_blank with rel=noopener)
      try { window.close(); } catch(e) {}
      // Strategy 2: navigate back via referrer (set on open)
      var ref = document.referrer;
      if (ref && ref.indexOf(location.origin) === 0 && ref.indexOf('?watch=') === -1) {
        location.href = ref;
        return;
      }
      // Strategy 3: history.back if there's actually history
      if (history.length > 1) {
        history.back();
        return;
      }
      // Strategy 4: navigate to admin root if known via referrer indicator
      if (ref && ref.indexOf('/admin') !== -1) {
        location.href = ref.split('?')[0];
        return;
      }
      // Last resort: clear ?watch param
      location.href = location.origin + '/';
    }
    document.getElementById('uspec-back').onclick = closeSpectator;
    document.getElementById('uspec-close').onclick = closeSpectator;
    var pollCount = 0;
    var foundOnce = false;
    function poll() {
      pollCount++;
      var statusEl = document.getElementById('uspec-status');
      fetch(API_BASE + '/api/live-state/' + encodeURIComponent(targetId))
        .then(function(r) {
          if (r.status === 404) return { _notFound: true };
          return r.ok ? r.json() : null;
        })
        .then(function(d) {
          if (!d) {
            if (statusEl) statusEl.textContent = foundOnce ? '🔴 השחקן הפסיק לשחק' : 'ממתין לשחקן... (ניסיון ' + pollCount + ')';
            return;
          }
          if (d._notFound) {
            if (statusEl) {
              if (foundOnce) {
                statusEl.innerHTML = '🔴 השחקן סיים את המשחק';
              } else {
                statusEl.innerHTML = '⚠️ שחקן לא נמצא · ID: <span style="direction:ltr">' + targetId.slice(0, 16) + '...</span><br><span style="font-size:10px">ייתכן שהבוט כבר סיים. חזור לאדמין ובחר אחר.</span>';
              }
            }
            return;
          }
          foundOnce = true;
          if (statusEl) statusEl.textContent = '🟢 מחובר · מתעדכן כל 2 שניות';
          var nameEl = document.getElementById('uspec-name');
          var metaEl = document.getElementById('uspec-meta');
          var scoreEl = document.getElementById('uspec-score');
          var gridEl = document.getElementById('uspec-grid');
          if (nameEl) nameEl.textContent = '👁 צופה ב-' + (d.name || 'אנונימי');
          var modeLabel = d.mode === 'daily' ? 'יומי' : d.mode === 'practice' ? 'אימון' : d.mode === 'challenge' ? 'אתגר' : d.mode;
          if (metaEl) metaEl.textContent = modeLabel + ' · tier ' + (d.tier || 1);
          if (scoreEl) scoreEl.textContent = (d.score || 0).toLocaleString();
          if (gridEl && d.grid && Array.isArray(d.grid)) {
            var cells = gridEl.children;
            var idx = 0;
            for (var r = 0; r < d.grid.length; r++) {
              for (var c = 0; c < (d.grid[r] || []).length; c++) {
                var cell = cells[idx];
                if (cell) {
                  var t = d.grid[r][c] || 0;
                  if (t > 0) {
                    var ti = getActiveTiers()[t];
                    cell.className = 'cell filled';
                    cell.style.background = ti ? ti.bg : '#ccc';
                    cell.style.color = ti ? ti.fg : '#333';
                    cell.innerHTML = ti ? ti.svg : '';
                  } else {
                    cell.className = 'cell';
                    cell.style.background = '';
                    cell.style.color = '';
                    cell.innerHTML = '';
                  }
                }
                idx++;
              }
            }
          }
        })
        .catch(function() {
          if (statusEl) statusEl.textContent = '⚠️ שגיאת רשת';
        });
    }
    poll();
    _uniSpecTimer = setInterval(poll, 2000);
  }

  // ============================================================
  // BloomDebug — internal API exposed for the auto-play bot.
  // Only used when ?bot=1 (or ?botui) is in the URL.
  // ============================================================
  const _dbgParams = new URLSearchParams(window.location.search);

  // Engine log switch — `?debug=1` enables verbose per-drop/per-merge/
  // per-gravity tracing. Off by default. Layout logs (`[fitGrid]`) are on
  // by default; set `window.__bloomLayoutLog = false` from console to silence.
  // NOTE: this MUST come after _dbgParams is declared, otherwise it lives
  // in the TDZ and throws "Cannot access uninitialized variable" on Safari.
  if (_dbgParams.has('debug')) {
    window.__bloomEngineLog = true;
    console.log('[BLOOM] engine logging ON · drop/merge/gravity events will be printed');
    console.log('[BLOOM] type __bloomDumpGrid() to see the current board state');
  }

  if (_dbgParams.has('bot') || _dbgParams.has('botui')) {
    window.BloomDebug = {
      ready: function() {
        return Array.isArray(grid) && grid.length === getBoardRows() && typeof nextPiece === 'number';
      },
      getGrid: function() {
        if (!Array.isArray(grid)) return null;
        return grid.map(function(row) { return row.slice(); });
      },
      getCurrentPiece: function() { return nextPiece; },
      getScore: function() { return score | 0; },
      getHighestTier: function() { return highestTier | 0; },
      isGameOver: function() {
        if (!Array.isArray(grid) || !grid[0]) return false;
        return isGameOver();
      },
      isBusy: function() {
        if (Array.isArray(grid) && grid[0] && isGameOver()) return false;
        return !!busy;
      },
      drop: function(col) { return drop(col); },
      restart: function() { init('practice'); },
    };
  }

  // Always-on dev hooks for Dynamic Boards testing — exposed in plain prod
  // so admins/developers can experiment from devtools without ?bot=1.
  // Not a security risk: setColumnMultipliers is client-side only and the
  // server score-submit path runs its own anti-cheat (drops-vs-score + token).
  window.__bloomDebug = window.__bloomDebug || {};
  window.__bloomDebug.setColumnMultipliers = function(arr) {
    var ok = setColumnMultipliers(arr);
    if (ok && typeof render === 'function') render();
    return ok;
  };
  window.__bloomDebug.getColumnMultipliers = function() { return getColumnMultipliers(); };
  window.__bloomDebug.restart = function(mode) { init(mode || 'practice'); };

  // ============ PWA INSTALL PROMPTS ============
  // iOS: show banner after 3 games (Safari doesn't auto-prompt)
  function maybeShowInstallPrompt() {
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    var dismissed = localStorage.getItem('bloom_install_dismissed');
    if (!isIos || isStandalone || dismissed) return;
    var games = parseInt(localStorage.getItem('bloom_total_games') || '0', 10);
    if (games < 3) return;
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1C1A18;color:#FFF;padding:14px 16px;z-index:9999;display:flex;align-items:center;gap:10px;direction:rtl;font-family:-apple-system,sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,0.2);border-radius:16px 16px 0 0';
    banner.innerHTML = '<img src="/assets/icon-192.png" style="width:40px;height:40px;border-radius:10px">' +
      '<div style="flex:1"><div style="font-size:13px;font-weight:700">התקן את BLOOM</div><div style="font-size:11px;color:#A8A6A0">לחץ <strong>שתף ⬆️</strong> → <strong>הוסף למסך הבית</strong></div></div>' +
      '<button style="background:none;border:none;color:#A8A6A0;font-size:18px;cursor:pointer;padding:4px" onclick="this.parentElement.remove();localStorage.setItem(\'bloom_install_dismissed\',\'1\')">✕</button>';
    document.body.appendChild(banner);
  }
  setTimeout(maybeShowInstallPrompt, 5000);

  // Android: catch beforeinstallprompt
  window.addEventListener('beforeinstallprompt', function(e) { e.preventDefault(); });
  // ============================================================
  // EVENT DROPS — special items that appear on the board
  // ============================================================
  window.__bloomEventsLoaded = true;

  var activeEvent = null;       // { type, row, col, timer, maxTimer, interval }
  var lastEventTime = 0;        // timestamp of last event end
  var eventSpawnTimer = null;    // setInterval handle
  var eventInitTimer = null;     // setTimeout for the "force first event" boot
  var eventSystemRunning = false; // gates async callbacks scheduled before stop
  var feverActive = false;       // is Fever mode on?
  var feverEndTime = 0;          // when Fever ends
  var feverMultiplier = 1;       // current multiplier (1 = normal)
  var targetTier = 0;            // which tier is targeted (🎯)
  var targetActive = false;

  // Home/menu screens overlay the game but don't unmount the grid, so the
  // grid still has non-zero bounding rects. Without this guard a pending
  // event spawn would build a position:fixed overlay at the grid cell's
  // viewport coords — which on a desktop browser sits OUTSIDE the centered
  // .app column and visibly leaks next to the home card. Any code path
  // that paints into the grid checks this first.
  function isGameSurfaceVisible() {
    if (document.getElementById('home-screen')) return false;
    if (document.getElementById('contest-screen')) return false;
    if (document.getElementById('challenge-screen')) return false;
    if (document.getElementById('spectator-screen')) return false;
    return true;
  }

  var EVENT_TYPES = [
    { id: 'bomb',   emoji: '💣', label: 'פצצה' },
    { id: 'star',   emoji: '⭐', label: 'כוכב זהב' },
    { id: 'gift',   emoji: '🎁', label: 'מתנה' },
    { id: 'fever',  emoji: '🔥', label: 'טירוף' },
    { id: 'freeze', emoji: '❄️', label: 'הקפאה' },
    { id: 'target', emoji: '🎯', label: 'מטרה' }
  ];

  function getEventConfig(key, fallback) {
    if (gameConfig && gameConfig[key] !== undefined) return gameConfig[key];
    return fallback;
  }
  function getEventNum(key, fallback) {
    return parseInt(getEventConfig(key, fallback), 10) || fallback;
  }

  function eventsEnabled() {
    return getEventConfig('events_enabled', 'true') === 'true';
  }

  function startEventSystem() {
    stopEventSystem();
    if (!eventsEnabled()) return;
    eventSystemRunning = true;
    lastEventTime = Date.now();
    eventSpawnTimer = setInterval(function() {
      if (!eventSystemRunning) return;
      try { trySpawnEvent(); } catch(e) { /* silent */ }
    }, 1000);
    // Force first event after 3 seconds. Tracked so stopEventSystem can
    // cancel it — without that, a player who entered the game and bounced
    // back to home within 3s would see a bomb tile spawn at the (now
    // hidden) grid coords and "leak" beside the home card.
    eventInitTimer = setTimeout(function() {
      eventInitTimer = null;
      if (!eventSystemRunning) return;
      if (!isGameSurfaceVisible()) return;
      try {
        if (!activeEvent && !feverActive && !targetActive && grid) {
          spawnRandomEvent();
        }
      } catch(e) { /* silent */ }
    }, 3000);
  }

  function stopEventSystem() {
    eventSystemRunning = false;
    if (eventSpawnTimer) { clearInterval(eventSpawnTimer); eventSpawnTimer = null; }
    if (eventInitTimer) { clearTimeout(eventInitTimer); eventInitTimer = null; }
    clearActiveEvent();
    clearComboCounter();
    feverActive = false;
    feverMultiplier = 1;
    targetActive = false;
    targetTier = 0;
    var feverBar = document.getElementById('fever-bar');
    if (feverBar) feverBar.remove();
    var targetHL = document.querySelector('.tier-target-highlight');
    if (targetHL) targetHL.classList.remove('tier-target-highlight');
  }

  // Belt-and-suspenders: any non-game screen calls this to nuke a stray
  // overlay even if the lifecycle above was bypassed somehow. Cheap and
  // idempotent — safe to call as often as needed.
  function purgeEventOverlays() {
    var el = document.getElementById('event-drop-overlay');
    if (el) el.remove();
    var fxes = document.querySelectorAll('.fx-overlay');
    for (var i = 0; i < fxes.length; i++) fxes[i].remove();
  }
  window.__bloomPurgeEventOverlays = purgeEventOverlays;

  // Resize/orientation: the overlay is position:fixed at the cell's old
  // viewport coords, so if the grid moves (window resize, soft-keyboard,
  // device rotation), the overlay would drift. Reposition follows; if the
  // game surface is gone, we just purge.
  var _resizeRaf = 0;
  window.addEventListener('resize', function() {
    if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(function() {
      _resizeRaf = 0;
      if (!isGameSurfaceVisible()) { purgeEventOverlays(); return; }
      repositionEventOverlay();
    });
  });
  window.addEventListener('orientationchange', function() {
    setTimeout(function() {
      if (!isGameSurfaceVisible()) { purgeEventOverlays(); return; }
      repositionEventOverlay();
    }, 250);
  });

  function clearActiveEvent() {
    if (activeEvent) {
      if (activeEvent.interval) clearInterval(activeEvent.interval);
      activeEvent = null;
    }
    var el = document.getElementById('event-drop-overlay');
    if (el) el.remove();
  }

  function repositionEventOverlay() {
    if (!activeEvent) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var idx = activeEvent.row * getBoardCols() + activeEvent.col;
    var cell = gridEl.children[idx];
    if (!cell) return;
    var overlay = document.getElementById('event-drop-overlay');
    if (!overlay) return;
    var rect = cell.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function countEmptyCells() {
    var count = 0;
    for (var r = 0; r < getBoardRows(); r++)
      for (var c = 0; c < getBoardCols(); c++)
        if (grid[r][c] === 0) count++;
    return count;
  }

  function countFilledRows() {
    var count = 0;
    for (var r = 0; r < getBoardRows(); r++) {
      var full = true;
      for (var c = 0; c < getBoardCols(); c++) {
        if (grid[r][c] === 0) { full = false; break; }
      }
      if (full) count++;
    }
    return count;
  }

  function trySpawnEvent() {
    if (!eventsEnabled() || busy) return;
    if (!eventSystemRunning) return;
    if (!isGameSurfaceVisible()) return;
    if (activeEvent || feverActive || targetActive) return;

    var startDelay = getEventNum('events_start_delay', 15) * 1000;
    if (Date.now() - gameStartTime < startDelay) return;

    var minGap = getEventNum('events_min_gap', 15) * 1000;
    var maxGap = getEventNum('events_max_gap', 35) * 1000;
    var elapsed = Date.now() - lastEventTime;
    if (elapsed < minGap) return;

    var minEmpty = getEventNum('events_min_empty_cells', 4);
    if (countEmptyCells() < minEmpty) return;

    // Probability increases linearly from 0% at minGap to 100% at maxGap
    var prob = Math.min(1, (elapsed - minGap) / (maxGap - minGap));
    if (Math.random() > prob * 0.4) return; // ~40% check per second at max

    spawnRandomEvent();
  }

  function spawnRandomEvent() {
    if (!grid || !grid.length) return;
    if (!isGameSurfaceVisible()) return;
    // Build weighted list of enabled events
    var pool = [];
    var totalWeight = 0;
    EVENT_TYPES.forEach(function(et) {
      if (getEventConfig('event_' + et.id + '_enabled', 'true') !== 'true') return;
      // Freeze only when board is mostly full
      if (et.id === 'freeze') {
        var minFilled = getEventNum('event_freeze_min_filled_rows', 3);
        if (countFilledRows() < minFilled) return;
      }
      var w = getEventNum('event_' + et.id + '_weight', 15);
      if (w <= 0) return;
      totalWeight += w;
      pool.push({ type: et, weight: w, cumWeight: totalWeight });
    });
    if (pool.length === 0) return;

    // Weighted random pick
    var roll = Math.random() * totalWeight;
    var chosen = pool[0].type;
    for (var i = 0; i < pool.length; i++) {
      if (roll <= pool[i].cumWeight) { chosen = pool[i].type; break; }
    }

    // Target is special — doesn't go on a cell
    if (chosen.id === 'target') {
      spawnTargetEvent();
      return;
    }

    // Find columns with empty cells — pick the BOTTOM-MOST empty cell
    // (where the next tile would actually land)
    var candidates = [];
    for (var c = 0; c < getBoardCols(); c++) {
      for (var r = getBoardRows() - 1; r >= 0; r--) {
        if (grid[r][c] === 0) {
          candidates.push([r, c]);
          break; // only bottom-most empty per column
        }
      }
    }
    if (candidates.length === 0) return;

    var cell = candidates[Math.floor(Math.random() * candidates.length)];
    var timerSec = getEventNum('event_' + chosen.id + '_timer', 8);

    activeEvent = {
      type: chosen.id,
      emoji: chosen.emoji,
      label: chosen.label,
      row: cell[0],
      col: cell[1],
      maxTimer: timerSec,
      timer: timerSec,
      startTime: Date.now()
    };

    renderEventOnCell(activeEvent);
    // Sound: "ding!" when event appears
    if (!isSfxMuted()) {
      tone({ freq: 880, duration: 0.08, type: 'sine', vol: 0.06 });
      setTimeout(function() { tone({ freq: 1100, duration: 0.06, type: 'sine', vol: 0.05 }); }, 80);
    }

    // Countdown + near-expiry vibration
    var warnedExpiry = false;
    activeEvent.interval = setInterval(function() {
      if (!activeEvent) return;
      var elapsed = (Date.now() - activeEvent.startTime) / 1000;
      activeEvent.timer = Math.max(0, activeEvent.maxTimer - elapsed);
      updateEventTimer(activeEvent);
      // Vibrate warning at 25% time remaining
      if (!warnedExpiry && activeEvent.timer < activeEvent.maxTimer * 0.25 && activeEvent.timer > 0) {
        warnedExpiry = true;
        if (!isSfxMuted()) buzz([20, 30, 20]);
      }
      if (activeEvent.timer <= 0) {
        clearActiveEvent();
        lastEventTime = Date.now();
      }
    }, 100);
  }

  function renderEventOnCell(evt) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    if (!isGameSurfaceVisible()) return;

    // Remove existing overlay
    var old = document.getElementById('event-drop-overlay');
    if (old) old.remove();

    var idx = evt.row * getBoardCols() + evt.col;
    var cell = gridEl.children[idx];
    if (!cell) return;

    var rect = cell.getBoundingClientRect();
    if (rect.width === 0) return; // not laid out yet
    // Final guard: if the cell's center sits outside the .app's box, the
    // grid isn't really showing — refuse to mount. Belt-and-suspenders
    // for any future overlay that the home/menu screens forget to hide.
    var appEl = document.querySelector('.app');
    if (appEl) {
      var appRect = appEl.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      if (cx < appRect.left || cx > appRect.right || cy < appRect.top || cy > appRect.bottom) return;
    }

    var overlay = document.createElement('div');
    overlay.id = 'event-drop-overlay';
    overlay.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;z-index:100;pointer-events:none;border-radius:12px;border:3px solid #FAC775;background:radial-gradient(circle,rgba(28,26,24,0.95) 0%,rgba(28,26,24,0.75) 100%);box-shadow:0 0 20px rgba(250,199,117,0.6),inset 0 0 12px rgba(250,199,117,0.3);animation:eventAppear 0.3s ease-out';
    // Layered structure: ring (SVG) absolutely positioned around the emoji+timer column.
    // Emoji shrunk slightly to leave room for the timer below it, and emoji+timer are stacked
    // in a flex column at the center, so the SVG ring never overlaps the digits.
    overlay.innerHTML =
      '<svg width="' + (rect.width - 8) + '" height="' + (rect.height - 8) + '" viewBox="0 0 36 36" style="position:absolute;top:4px;left:4px;pointer-events:none">' +
        '<circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>' +
        '<circle id="event-ring-fg" cx="18" cy="18" r="16" fill="none" stroke="#2E8B6F" stroke-width="2.5" stroke-dasharray="100.5" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 18 18)" style="filter:drop-shadow(0 0 4px currentColor);transition:stroke 200ms ease"/>' +
      '</svg>' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">' +
        '<span style="font-size:24px;line-height:1;animation:eventBob 1s ease-in-out infinite;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">' + evt.emoji + '</span>' +
        '<span id="event-timer-text" style="font-size:11px;font-weight:900;color:#FFF;line-height:1;letter-spacing:0.5px;text-shadow:0 1px 4px rgba(0,0,0,0.95),0 0 8px rgba(250,199,117,0.4);font-variant-numeric:tabular-nums">' + evt.maxTimer.toFixed(1) + 's</span>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function updateEventTimer(evt) {
    var ring = document.getElementById('event-ring-fg');
    var text = document.getElementById('event-timer-text');
    if (!ring || !text) return;
    var pct = evt.timer / evt.maxTimer;
    var offset = 100.5 * (1 - pct);
    ring.style.strokeDashoffset = offset;
    if (pct > 0.5) ring.style.stroke = '#2E8B6F';
    else if (pct > 0.25) ring.style.stroke = '#FAC775';
    else ring.style.stroke = '#C8472F';
    // Timer text changes color too, matching urgency
    if (pct > 0.5) text.style.color = '#FFF';
    else if (pct > 0.25) text.style.color = '#FAC775';
    else text.style.color = '#FF6B5B';
    text.textContent = evt.timer.toFixed(1) + 's';
    var overlay = document.getElementById('event-drop-overlay');
    if (overlay) {
      if (pct < 0.25) overlay.style.animation = 'eventUrgent 0.3s ease-in-out infinite';
    }
  }

  // Called when a tile is placed at (row, col)
  function checkEventTrigger(row, col) {
    if (!activeEvent) return false;
    // Trigger if tile dropped in the same COLUMN as the event
    // (not exact cell — tile falls to bottom, event can be anywhere)
    if (activeEvent.col === col) {
      triggerEvent(activeEvent, row);
      return true;
    }
    return false;
  }

  function triggerEvent(evt, landingRow) {
    var type = evt.type;
    clearActiveEvent();
    lastEventTime = Date.now();
    buzz([60, 40]);

    if (type === 'bomb') triggerBomb(evt);
    else if (type === 'star') triggerStar(evt, landingRow);
    else if (type === 'gift') triggerGift(evt);
    else if (type === 'fever') triggerFever(evt);
    else if (type === 'freeze') triggerFreeze(evt);
  }

  // Spawn an explosion overlay (position:fixed) over a cell's rect. Lives in
  // <body> so render() rebuilding <#grid> can't wipe it. Cleans itself up.
  // CSS classes: 'fx-explode' (orange bomb), 'fx-freeze' (blue freeze).
  function spawnFxOverlay(cellRect, klass, delayMs) {
    var el = document.createElement('div');
    el.className = 'fx-overlay ' + klass;
    var size = Math.max(cellRect.width, cellRect.height) * 1.6;
    el.style.cssText =
      'position:fixed;left:' + (cellRect.left + cellRect.width / 2 - size / 2) + 'px;' +
      'top:' + (cellRect.top + cellRect.height / 2 - size / 2) + 'px;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'pointer-events:none;z-index:9500;border-radius:50%';
    if (delayMs > 0) {
      setTimeout(function() {
        document.body.appendChild(el);
        setTimeout(function() { el.remove(); }, 720);
      }, delayMs);
    } else {
      document.body.appendChild(el);
      setTimeout(function() { el.remove(); }, 720);
    }
  }
  function fxAtCell(r, c, klass, delayMs) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var idx = r * getBoardCols() + c;
    var cell = gridEl.children[idx];
    if (!cell) return;
    var rect = cell.getBoundingClientRect();
    if (rect.width === 0) return;
    spawnFxOverlay(rect, klass, delayMs || 0);
  }

  // ── 💣 BOMB ──
  function triggerBomb(evt) {
    var radius = getEventNum('event_bomb_radius', 1);
    var ptsPerTile = getEventNum('event_bomb_points_per_tile', 2000);
    var destroyed = 0;
    var destroyedCells = []; // (r,c,tier) of every tile actually destroyed
    var blastZoneCells = []; // EVERY cell in the (2*radius+1)² blast area,
                             // including empty ones — so the user sees the
                             // full footprint even when some cells were empty.

    // SHIFT the blast center so the (2*radius+1)² area ALWAYS fits on the
    // board. Without this, a bomb at col 3 (rightmost) clips to a 2×3 = 6-
    // cell blast, which the user perceives as "the bomb didn't really do
    // 3×3". Now the center slides inward to keep all 9 cells on the board.
    var bcRow = evt.row, bcCol = evt.col;
    if (bcRow - radius < 0) bcRow = radius;
    if (bcRow + radius > getBoardRows() - 1) bcRow = getBoardRows() - 1 - radius;
    if (bcCol - radius < 0) bcCol = radius;
    if (bcCol + radius > getBoardCols() - 1) bcCol = getBoardCols() - 1 - radius;

    // Stage 1: capture cell rects BEFORE clearing the grid (so we know
    // where to spawn explosion overlays, independent of render()).
    var hitCells = [];
    for (var dr = -radius; dr <= radius; dr++) {
      for (var dc = -radius; dc <= radius; dc++) {
        var r = bcRow + dr, c = bcCol + dc;
        if (r < 0 || r >= getBoardRows() || c < 0 || c >= getBoardCols()) continue;
        var dist = Math.max(Math.abs(dr), Math.abs(dc));
        hitCells.push({ r: r, c: c, dist: dist, hadTile: grid[r][c] !== 0 });
        blastZoneCells.push({ r: r, c: c }); // ALL cells in the radius
        // Destroy every non-empty cell in the blast zone — INCLUDING the
        // center. Previously the center was excluded with the reasoning
        // "don't bomb the bomb's own cell", but when a player drops a tile
        // into the bomb's column, that tile lands AT the bomb's cell and
        // was then surviving the explosion ("מאחורי הפצצה יש אריח"). The
        // dropped tile is the trigger; it should be consumed by the blast.
        if (grid[r][c] !== 0) {
          destroyedCells.push({ r: r, c: c, tier: grid[r][c] });
          grid[r][c] = 0;
          destroyed++;
        }
      }
    }

    // Stage 2: spawn explosion overlays staggered by distance (center → out).
    // These live in <body> so render() can't destroy them, fixing the
    // "explosion never visible" bug where cell.style.background was wiped.
    for (var i = 0; i < hitCells.length; i++) {
      fxAtCell(hitCells[i].r, hitCells[i].c, 'fx-explode', hitCells[i].dist * 55);
    }

    var bonus = destroyed * ptsPerTile;
    score += bonus;
    // BONUS VERIFICATION — log the full blast footprint (3×3 for radius=1) so
    // the user can see EXACTLY which cells the bomb scanned and which actually
    // contained tiles. Visual FX overlays scale to ~2.1× cell size and
    // visually overflow, but the destruction footprint is exact.
    if (window.__bloomEngineLog) {
      console.log('[bomb] center=' + evt.row + ',' + evt.col,
        'radius=' + radius,
        'blast_zone=' + blastZoneCells.length + 'cells (' + (2*radius+1) + '×' + (2*radius+1) + ' max)',
        'destroyed=' + destroyed + 'tiles',
        '+' + bonus + 'pts',
        'destroyed_at=[' + destroyedCells.map(function(d) { return d.r + ',' + d.c + '(t' + d.tier + ')'; }).join(' | ') + ']',
        'blast_at=[' + blastZoneCells.map(function(b) { return b.r + ',' + b.c; }).join(' | ') + ']'
      );
    }
    showEventBanner('💣 BOOM! ' + (2*radius+1) + '×' + (2*radius+1), '+' + bonus.toLocaleString() + ' · ' + destroyed + ' אריחים', 'bomb');
    var shakeInt = getEventNum('event_bomb_shake', 6);
    buzz([100, 60, 100, 60, 100]);
    if (shakeInt > 0) shakeGrid(shakeInt);
    bumpScore();
    checkScoreMilestones();
    // Aurora juice — score bump animation. No-op for non-Aurora skins.
    if (typeof auroraScoreBump === 'function') auroraScoreBump();
    // Apply gravity so tiles don't float after explosion
    applyGravity();
    render();
    // AFTER render() — mark the FULL blast zone (light orange) so the user
    // sees the 3×3 footprint even when some cells were empty, then layer the
    // destroyed cells with a stronger orange + tier label fade-out. Two-tier
    // visual makes the bomb's actual reach unmistakable.
    markBonusHitCells(blastZoneCells, 'bonus-blast', 900);
    markBonusHitCells(destroyedCells, 'bonus-hit', 900);
  }

  // Mark a list of cells with a CSS class that lingers visually. Cleared by
  // a setTimeout, and self-resilient to render() rebuilds (we re-query the
  // grid's current children, not cached refs from before render).
  function markBonusHitCells(cells, klass, durationMs) {
    if (!cells || !cells.length) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var COLS = getBoardCols();
    cells.forEach(function(c) {
      var idx = c.r * COLS + c.c;
      var cell = gridEl.children[idx];
      if (cell) cell.classList.add(klass);
    });
    setTimeout(function() {
      var g = document.getElementById('grid');
      if (!g) return;
      cells.forEach(function(c) {
        var idx = c.r * COLS + c.c;
        var cell = g.children[idx];
        if (cell) cell.classList.remove(klass);
      });
    }, durationMs || 800);
  }

  // ── ⭐ STAR ──
  function triggerStar(evt, landingRow) {
    var upgrade = getEventNum('event_star_upgrade', 1);
    var pts = getEventNum('event_star_points', 500);
    var tRow = (landingRow != null) ? landingRow : evt.row;
    var tile = grid[tRow][evt.col];
    if (tile > 0 && tile < MAX_TIER) {
      var oldTier = tile;
      grid[tRow][evt.col] = Math.min(tile + upgrade, MAX_TIER);
      var newTier = grid[tRow][evt.col];
      if (newTier > highestTier) highestTier = newTier;
      var tierInfo = getActiveTiers()[newTier];
      score += pts;
      if (window.__bloomEngineLog) {
        console.log('[star] cell=' + tRow + ',' + evt.col,
          't' + oldTier + ' → t' + newTier,
          '(' + tierInfo.name + ')',
          '+' + pts + 'pts');
      }
      showEventBanner('⭐ Level Up!', tierInfo.name + '! +' + pts, 'star');
      bumpScore();
      checkScoreMilestones();
      // Aurora juice — score bump + variance on the upgraded cell. No-op
      // for non-Aurora skins.
      if (typeof auroraScoreBump === 'function') auroraScoreBump();
      render();
      if (typeof auroraSetMergeVariance === 'function') {
        var starCell = document.querySelector('#grid .cell[data-r="' + tRow + '"][data-c="' + evt.col + '"]');
        if (starCell) auroraSetMergeVariance(starCell);
      }
      markBonusHitCells([{ r: tRow, c: evt.col }], 'bonus-star', 900);
    } else if (tile === MAX_TIER) {
      score += pts * 5;
      if (window.__bloomEngineLog) {
        console.log('[star] cell=' + tRow + ',' + evt.col,
          'CROWN ×5', '+' + (pts * 5) + 'pts');
      }
      showEventBanner('⭐ כתר מוזהב!', '+' + (pts * 5).toLocaleString(), 'star');
      bumpScore();
      checkScoreMilestones();
    }
  }

  // ── 🎁 GIFT ──
  // Server-decided. The client used to roll the jackpot dice and POST the
  // resulting amount to /api/player/earn (action='event_gift'), but that let
  // a DevTools loop pump credits — the server's cap was 500 and there was no
  // proof the event actually happened in-game. Now we call /api/player/gift
  // which rolls the dice and pays the reward server-side, capped by config.
  function triggerGift(evt) {
    if (window.__bloomBotActive || skinTrialMode) return;
    apiPost('/api/player/gift', {})
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.ok) return;
        var amount = d.reward | 0;
        if (d.isJackpot) {
          showEventBanner('🎁 JACKPOT!!!', '+' + amount + ' 💎', 'gift-jackpot');
          buzz([80, 40, 80, 40, 80, 40, 80]);
          showConfetti(35);
          // Aurora juice — extra score bump on jackpot moment. No-op for
          // non-Aurora skins.
          if (typeof auroraScoreBump === 'function') auroraScoreBump();
        } else {
          showEventBanner('🎁 מתנה!', '+' + amount + ' 💎', 'gift');
        }
        if (window.__bloomEngineLog) {
          console.log('[gift] cell=' + evt.row + ',' + evt.col,
            (d.isJackpot ? 'JACKPOT' : 'normal'),
            '+' + amount + '💎');
        }
        if (typeof d.newBalance === 'number') {
          playerBalance = d.newBalance | 0;
        } else {
          playerBalance = (playerBalance | 0) + amount;
        }
        try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch (e) {}
        if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
      })
      .catch(function() {});
  }

  // ── 🔥 FEVER ──
  function triggerFever(evt) {
    var duration = getEventNum('event_fever_duration', 10);
    var mult = getEventNum('event_fever_multiplier', 3);
    feverActive = true;
    feverMultiplier = mult;
    feverEndTime = Date.now() + duration * 1000;

    if (window.__bloomEngineLog) {
      console.log('[fever] activated', 'multiplier=×' + mult, 'duration=' + duration + 's', 'ends_at=' + new Date(feverEndTime).toLocaleTimeString());
    }
    showEventBanner('🔥 FEVER MODE!', '×' + mult + ' ניקוד למשך ' + duration + 's', 'fever');
    buzz([80, 40, 80]);

    // Add fever bar
    var wrap = document.getElementById('grid-wrap');
    if (wrap) {
      var bar = document.createElement('div');
      bar.id = 'fever-bar';
      bar.className = 'fever-bar';
      bar.innerHTML = '<div class="fever-bar-fill" id="fever-bar-fill"></div><span class="fever-bar-text">🔥 ×' + mult + '</span>';
      wrap.appendChild(bar);
    }

    // Add fever border
    var gridEl = document.getElementById('grid');
    if (gridEl) gridEl.classList.add('fever-active');

    // Update fever countdown
    var feverInterval = setInterval(function() {
      var remaining = feverEndTime - Date.now();
      if (remaining <= 0) {
        feverActive = false;
        feverMultiplier = 1;
        clearInterval(feverInterval);
        var fb = document.getElementById('fever-bar');
        if (fb) fb.remove();
        if (gridEl) gridEl.classList.remove('fever-active');
        return;
      }
      var pct = remaining / (duration * 1000);
      var fill = document.getElementById('fever-bar-fill');
      if (fill) fill.style.width = (pct * 100) + '%';
    }, 50);
  }

  // ── ❄️ FREEZE ──
  function triggerFreeze(evt) {
    var clearRows = getEventNum('event_freeze_clear_rows', 1);
    var pts = getEventNum('event_freeze_points', 1000);
    var clearedCells = []; // tiles that actually got destroyed
    var rowZoneCells = []; // ALL cells in the cleared rows, including empties

    // Same fix as bomb: spawn overlays before render() wipes the grid.
    // Walk top rows left→right with staggered delays so the freeze "sweeps".
    for (var r = 0; r < clearRows && r < getBoardRows(); r++) {
      for (var c = 0; c < getBoardCols(); c++) {
        fxAtCell(r, c, 'fx-freeze', c * 45);
        rowZoneCells.push({ r: r, c: c });
        if (grid[r][c] !== 0) {
          clearedCells.push({ r: r, c: c, tier: grid[r][c] });
          grid[r][c] = 0;
        }
      }
    }

    score += pts;
    if (window.__bloomEngineLog) {
      console.log('[freeze] rows_cleared=' + clearRows,
        'zone_cells=' + rowZoneCells.length,
        'tiles_removed=' + clearedCells.length,
        '+' + pts + 'pts',
        'cleared_at=[' + clearedCells.map(function(d) { return d.r + ',' + d.c + '(t' + d.tier + ')'; }).join(' | ') + ']');
    }
    var shakeInt = getEventNum('event_freeze_shake', 4);
    showEventBanner('❄️ הצלה!', clearRows + ' שורות · ' + clearedCells.length + ' אריחים · +' + pts.toLocaleString(), 'freeze');
    buzz([60, 40, 60]);
    if (shakeInt > 0) shakeGrid(shakeInt);
    bumpScore();
    checkScoreMilestones();
    // Aurora juice — score bump animation. No-op for non-Aurora skins.
    if (typeof auroraScoreBump === 'function') auroraScoreBump();
    // Apply gravity so tiles above fall down
    applyGravity();
    render();
    // Show the full row(s) cleared with the freeze tint, then mark the
    // specific destroyed tiles more strongly so the user sees both
    // "row swept" and "X tiles removed".
    markBonusHitCells(rowZoneCells, 'bonus-freeze-zone', 900);
    markBonusHitCells(clearedCells, 'bonus-freeze', 900);
  }

  // ── 🎯 TARGET ──
  function spawnTargetEvent() {
    var timerSec = getEventNum('event_target_timer', 12);
    // Pick a random tier 2-6
    targetTier = 2 + Math.floor(Math.random() * 5);
    targetActive = true;

    // Highlight in tier bar
    var tierBar = document.getElementById('tier-bar');
    if (tierBar) {
      var items = tierBar.querySelectorAll('.tier-item');
      if (items[targetTier]) {
        items[targetTier].classList.add('tier-target-highlight');
      }
    }

    if (window.__bloomEngineLog) {
      console.log('[target] activated', 'target_tier=t' + targetTier, '(' + getActiveTiers()[targetTier].name + ')', 'duration=' + timerSec + 's');
    }
    showEventBanner('🎯 מטרה!', 'מזג ' + getActiveTiers()[targetTier].name + ' תוך ' + timerSec + 's!', 'target');
    lastEventTime = Date.now();

    // Timer
    setTimeout(function() {
      if (targetActive) {
        targetActive = false;
        targetTier = 0;
        var items2 = document.querySelectorAll('.tier-target-highlight');
        items2.forEach(function(el) { el.classList.remove('tier-target-highlight'); });
      }
    }, timerSec * 1000);
  }

  // Called when any merge happens — check if it matches target
  function checkTargetMerge(newTier) {
    if (!targetActive || newTier !== targetTier) return 1;
    // Hit!
    targetActive = false;
    var mult = getEventNum('event_target_multiplier', 5);
    var items = document.querySelectorAll('.tier-target-highlight');
    items.forEach(function(el) { el.classList.remove('tier-target-highlight'); });
    if (window.__bloomEngineLog) {
      console.log('[target] HIT', 'tier=t' + newTier, 'multiplier=×' + mult);
    }
    showEventBanner('🎯 פגיעה!', '×' + mult + ' בונוס!', 'target');
    buzz([60, 40, 60, 40, 60]);
    targetTier = 0;
    return mult;
  }

  // Get current fever multiplier
  function getFeverMultiplier() {
    if (!feverActive) return 1;
    if (Date.now() > feverEndTime) { feverActive = false; feverMultiplier = 1; return 1; }
    return feverMultiplier;
  }

  // Show event banner — exact same approach as the green diagnostic (which works!)
  function showEventBanner(title, sub, cssClass) {
    showTransientBanner({
      tag: 'event-' + (cssClass || 'generic'),
      holdMs: 1200, fadeMs: 400,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;padding:20px 30px;border-radius:18px;text-align:center;direction:rtl;min-width:200px;pointer-events:auto;background:#1C1A18;color:#FAC775;border:2px solid #FAC775;box-shadow:0 12px 36px rgba(0,0,0,0.5)',
      html: '<div style="font-size:18px;font-weight:700;margin-bottom:6px">' + title + '</div><div style="font-size:28px;font-weight:900">' + sub + '</div>',
    });
  }

  // ============================================================
  // AD SYSTEM — simulate ad watching (replace with real SDK later)
  // ============================================================
  var lastAdWatchTime = 0;

  function simulateAdWatch(callback) {
    // Rate limit: 1 ad per 30 seconds
    if (Date.now() - lastAdWatchTime < 30000) {
      showEventBanner('⏰ המתן', 'פרסומת חדשה בעוד מעט', '');
      return;
    }
    // Show "ad" overlay (replace with real ad SDK integration)
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#FFF;font-family:inherit;direction:rtl';
    overlay.innerHTML =
      '<div style="font-size:14px;color:#888;margin-bottom:20px">פרסומת</div>' +
      '<div style="font-size:48px;font-weight:900" id="ad-countdown">3</div>' +
      '<div style="font-size:13px;color:#666;margin-top:20px">הפרסומת תסתיים בעוד מספר שניות...</div>' +
      '<div style="width:200px;height:4px;background:#333;border-radius:2px;margin-top:16px;overflow:hidden"><div id="ad-progress" style="width:0%;height:100%;background:#FAC775;transition:width 1s linear"></div></div>';
    document.body.appendChild(overlay);

    var sec = 3;
    var countEl = overlay.querySelector('#ad-countdown');
    var progEl = overlay.querySelector('#ad-progress');
    requestAnimationFrame(function() { progEl.style.width = '33%'; });

    var adInterval = setInterval(function() {
      sec--;
      if (countEl) countEl.textContent = sec > 0 ? sec : '✓';
      if (progEl) progEl.style.width = ((3 - sec) / 3 * 100) + '%';
      if (sec <= 0) {
        clearInterval(adInterval);
        lastAdWatchTime = Date.now();
        setTimeout(function() {
          overlay.remove();
          if (callback) callback();
        }, 500);
      }
    }, 1000);
  }

  // ============================================================
  // CONFETTI — CSS-only particles for celebrations
  // ============================================================
  var CONFETTI_COLORS = ['#FAC775','#EF9F27','#FF6B35','#C8472F','#9B8AE8','#2E8B6F','#4ECDC4','#F4C0D1'];

  function showConfetti(count) {
    count = count || 30;
    var host = document.createElement('div');
    host.className = 'confetti-host';
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.animationDuration = (1 + Math.random() * 1) + 's';
      p.style.width = (4 + Math.random() * 8) + 'px';
      p.style.height = (4 + Math.random() * 6) + 'px';
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function() { host.remove(); }, 2500);
  }

  // ============================================================
  // COMBO COUNTER — persistent chain display during gameplay
  // ============================================================
  var comboEl = null;
  var comboTimeout = null;

  function showComboCounter(chainCount, multiplier) {
    if (chainCount < 2) return;
    if (comboTimeout) clearTimeout(comboTimeout);

    if (!comboEl) {
      comboEl = document.createElement('div');
      comboEl.className = 'combo-counter';
      document.body.appendChild(comboEl);
    }
    // multiplier can arrive as a string ('1.5', '2', '2.5', '3') from the
    // call site in src/11-game.js. Coerce to a Number for .toFixed(). The
    // string-multiplier path threw TypeError, which propagated out of the
    // merge logic and SKIPPED the trailing [merge] log + applyGravity() —
    // leaving a floating tile that the render-time invariant had to
    // auto-heal. Tracked down by user-supplied [merge-early] vs missing
    // [merge] log evidence.
    var multNum = Number(multiplier);
    if (!Number.isFinite(multNum)) multNum = 1;
    comboEl.innerHTML = '🔥 ×' + chainCount + '<span class="combo-mult">×' + multNum.toFixed(1) + '</span>';
    comboEl.style.animation = 'none';
    comboEl.style.opacity = '1';
    void comboEl.offsetWidth;
    comboEl.style.animation = 'comboPop 0.2s ease-out';
    comboEl.style.fontSize = Math.min(20 + chainCount * 3, 36) + 'px';

    comboTimeout = setTimeout(function() {
      if (comboEl && comboEl.parentNode) {
        comboEl.style.transition = 'opacity 0.3s';
        comboEl.style.opacity = '0';
        setTimeout(function() { clearComboCounter(); }, 300);
      }
      comboTimeout = null;
    }, 3000);
  }

  function clearComboCounter() {
    if (comboTimeout) { clearTimeout(comboTimeout); comboTimeout = null; }
    if (comboEl && comboEl.parentNode) comboEl.remove();
    comboEl = null;
  }
  // ============================================================
  // FTUE — First-Time User Experience (UX audit §1.1)
  // ============================================================
  // The single highest-leverage retention surface per the audit:
  // a brand-new player who doesn't grok merge mechanics in the first
  // 30 seconds leaves. Three short choreographed steps teach the
  // three core moves (tap, merge, chain) on a real-looking 4×6 board
  // before the audit-targeted "מוכן? בוא נשחק" handoff to showHome().
  //
  // Storage: a single `bloom_ftue_done='1'` localStorage flag. The boot
  // sequence in 13-boot.js reads `ftueShouldRun()` and calls
  // `startFTUE(onDone)` instead of showHome() when the flag is missing.
  //
  // Implementation note: this is a *demo* tutorial, not the live engine
  // running on a seeded board. The choreography is fully scripted —
  // cheap, predictable, no engine-state surprises. The player taps to
  // advance each beat; the visuals reuse the same tile/cell DOM and
  // animation keyframes (pop/merge) as the real game so the muscle
  // memory transfers cleanly to first real play.

  const FTUE_KEY = 'bloom_ftue_done';
  function ftueAlreadyDone() {
    try { return !!localStorage.getItem(FTUE_KEY); } catch (e) { return false; }
  }
  function ftueShouldRun() {
    // Skip in bot / spectator / watch contexts — those have URL params.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('bot') || params.get('botui') || params.get('watch')) return false;
    } catch (e) {}
    return !ftueAlreadyDone();
  }
  function ftueMarkDone() {
    try { localStorage.setItem(FTUE_KEY, '1'); } catch (e) {}
  }

  // Three choreographed steps. Each step describes:
  //   pre:   the board state (24 cells, row-major top→bottom) to render
  //   next:  the "next piece" tier shown to the player
  //   col:   the column the arrow points at (and the only acceptable tap)
  //   teach: the instruction text shown above the board
  //   after: { type, col, row, mergedTier, chain } — what the engine should
  //          *animate* after the player taps. type ∈ 'drop' / 'merge' / 'chain'.
  //   cheer: the celebration text + sound + extra effects (vibrate/confetti).
  const FTUE_STEPS = [
    {
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      next:  1,
      col:   1,
      teach: 'הקש על העמודה כדי להפיל את האבן',
      after: { type: 'drop', col: 1, row: 5 },
      cheer: { text: '🎯 כל הכבוד! זו הייתה ההפלה הראשונה שלך', sound: 'drop' }
    },
    {
      // Two tier-1 tiles already sitting in column 1 (rows 4,5). The player
      // drops a third tier-1 there → 3 in a column → merge to tier-2.
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0, 0,1,0,0],
      next:  1,
      col:   1,
      teach: 'שלוש אבנים זהות → מיזוג! שדרוג לדרגה הבאה',
      after: { type: 'merge', col: 1, row: 5, mergedTier: 2 },
      cheer: { text: 'WOW! המיזוג הראשון שלך 🎉', sound: 'merge', vibrate: true }
    },
    {
      // Column 1 has tier-1 at rows 4,5. Column 2 has a tier-2 at row 5.
      // Player drops tier-1 in column 1 → 3-tier-1 merge → tier-2 at row 5.
      // That new tier-2 is now adjacent to the existing tier-2 in column 2
      // (still at row 5 after gravity). Chain ×2 → tier-3.
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0, 0,1,2,0],
      next:  1,
      col:   1,
      teach: 'מיזוג שגורר עוד מיזוג = שרשרת ×2!',
      after: { type: 'chain', col: 1, row: 5, mergedTier: 3, chain: 2 },
      cheer: { text: '🔥 שרשרת ×2! עכשיו אתה תופס איך זה עובד', sound: 'chain', confetti: true }
    }
  ];

  let ftueState = null; // { stepIdx, overlay, gridEl, nextEl, bubbleEl, arrowEl, onDone, locked }

  function startFTUE(onDone) {
    if (ftueState) return; // already running
    ftueState = {
      stepIdx: 0,
      overlay: null,
      gridEl: null,
      nextEl: null,
      bubbleEl: null,
      arrowEl: null,
      onDone: typeof onDone === 'function' ? onDone : function() {},
      locked: false
    };
    // Audio: pre-warm the AudioContext on the first user gesture (browser
    // requires a user-initiated activation). The first tap inside FTUE
    // gives us that gesture.
    buildOverlay();
    renderStep(0);
  }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ftue-overlay';
    overlay.className = 'ftue-overlay';
    overlay.innerHTML =
      '<div class="ftue-card">' +
        '<div class="ftue-step-dots">' +
          '<span class="ftue-dot active"></span>' +
          '<span class="ftue-dot"></span>' +
          '<span class="ftue-dot"></span>' +
        '</div>' +
        '<div class="ftue-brand">🌸 ברוכים הבאים ל-BLOOM</div>' +
        '<div class="ftue-bubble" id="ftue-bubble">הוראות הצעד...</div>' +
        '<div class="ftue-next-row">' +
          '<span class="ftue-next-label">הבא:</span>' +
          '<div class="ftue-next-tile" id="ftue-next"></div>' +
        '</div>' +
        '<div class="ftue-grid-wrap">' +
          '<div class="ftue-arrow" id="ftue-arrow">⬇️</div>' +
          '<div class="ftue-grid" id="ftue-grid"></div>' +
        '</div>' +
        '<button class="ftue-skip" id="ftue-skip">דלג על המדריך</button>' +
      '</div>';
    document.body.appendChild(overlay);
    ftueState.overlay = overlay;
    ftueState.gridEl = overlay.querySelector('#ftue-grid');
    ftueState.nextEl = overlay.querySelector('#ftue-next');
    ftueState.bubbleEl = overlay.querySelector('#ftue-bubble');
    ftueState.arrowEl = overlay.querySelector('#ftue-arrow');
    overlay.querySelector('#ftue-skip').onclick = function() {
      try { trackEvent('tutorial_skip', { step: (ftueState && ftueState.stepIdx) || 0 }); } catch (e) {}
      finishFTUE(false);
    };
  }

  function renderStep(idx) {
    if (!ftueState) return;
    ftueState.stepIdx = idx;
    ftueState.locked = false;
    const step = FTUE_STEPS[idx];

    // Step dots
    const dots = ftueState.overlay.querySelectorAll('.ftue-dot');
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === idx);
      d.classList.toggle('done', i < idx);
    });

    // Instruction bubble
    ftueState.bubbleEl.textContent = step.teach;
    // Pre-render bubble in (fades) — restart by toggling class
    ftueState.bubbleEl.classList.remove('show');
    void ftueState.bubbleEl.offsetWidth; // reflow → restart animation
    ftueState.bubbleEl.classList.add('show');

    // Next piece preview
    renderFtueTile(ftueState.nextEl, step.next);

    // Board
    renderFtueGrid(step.pre, step.col);

    // Arrow positioning — anchor over the hinted column
    positionArrowOverColumn(step.col);

    // Analytics
    try { trackEvent('tutorial_step', { step: idx }); } catch (e) {}
  }

  function renderFtueGrid(state, hintCol) {
    const cols = 4, rows = 6;
    ftueState.gridEl.innerHTML = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'ftue-cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        if (c === hintCol) cell.classList.add('hint-col');
        const tier = state[r * cols + c];
        if (tier > 0) {
          cell.appendChild(buildFtueTileNode(tier));
        }
        cell.onclick = function() { onCellTap(c); };
        ftueState.gridEl.appendChild(cell);
      }
    }
  }

  function renderFtueTile(container, tier) {
    container.innerHTML = '';
    container.appendChild(buildFtueTileNode(tier));
  }

  function buildFtueTileNode(tier) {
    const tiers = (typeof getActiveTiers === 'function') ? getActiveTiers() : [];
    const ti = tiers[tier] || { bg: '#FAC775', fg: '#412402', svg: tier };
    const t = document.createElement('div');
    t.className = 'ftue-tile';
    t.style.background = ti.bg;
    t.style.color = ti.fg;
    t.innerHTML = ti.svg || '';
    return t;
  }

  function positionArrowOverColumn(col) {
    // Wait one frame so the grid actually has layout, then place the arrow
    // above the right column of the FTUE grid.
    requestAnimationFrame(function() {
      if (!ftueState) return;
      const cell = ftueState.gridEl.querySelector('[data-row="0"][data-col="' + col + '"]');
      if (!cell) return;
      const gridRect = ftueState.gridEl.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const left = (cellRect.left - gridRect.left) + (cellRect.width / 2);
      ftueState.arrowEl.style.left = left + 'px';
      ftueState.arrowEl.style.opacity = '1';
    });
  }

  function onCellTap(col) {
    if (!ftueState || ftueState.locked) return;
    const step = FTUE_STEPS[ftueState.stepIdx];
    if (col !== step.col) {
      // Gentle nudge: shake the arrow, don't penalize
      ftueState.arrowEl.classList.add('ftue-arrow-nudge');
      setTimeout(function() { ftueState.arrowEl && ftueState.arrowEl.classList.remove('ftue-arrow-nudge'); }, 400);
      return;
    }
    ftueState.locked = true;
    ftueState.arrowEl.style.opacity = '0';
    performStepAnimation(step);
  }

  function performStepAnimation(step) {
    const cols = 4;
    const after = step.after;
    // Build the falling tile at the top of the target column
    const targetCell = ftueState.gridEl.querySelector('[data-row="' + after.row + '"][data-col="' + after.col + '"]');
    if (!targetCell) { advanceAfterCheer(step); return; }

    // Drop animation: clone a tile at the top, animate it down to target row.
    const topCell = ftueState.gridEl.querySelector('[data-row="0"][data-col="' + after.col + '"]');
    const dropTile = buildFtueTileNode(step.next);
    dropTile.classList.add('ftue-drop-anim');
    topCell.appendChild(dropTile);

    // Use a CSS transition driven by the row gap
    const cellH = topCell.getBoundingClientRect().height;
    const translateY = cellH * after.row;
    requestAnimationFrame(function() {
      dropTile.style.transform = 'translateY(' + translateY + 'px)';
    });

    // After the drop, run the step-type-specific animation
    setTimeout(function() {
      // Move the tile into the target cell so the row remains correct after
      // any merge/chain anims that follow.
      if (dropTile.parentElement) dropTile.parentElement.removeChild(dropTile);
      const landed = buildFtueTileNode(step.next);
      landed.classList.add('pop');
      targetCell.appendChild(landed);
      try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([6]); } catch (e) {}

      if (after.type === 'drop') {
        celebrate(step);
        return;
      }

      // For merge / chain we need to crunch the column. Run a small
      // animation that pops the matching tiles, then place the merged
      // tile at the target cell.
      setTimeout(function() {
        animateMergeAt(after.col, after.row, after.mergedTier, function() {
          if (after.type === 'chain') {
            // Adjacent merge: locate any tile sharing the merged tier in
            // a neighbor cell, animate a second merge into a tier+1 result.
            const upTier = after.mergedTier + 1;
            // The pre-state put a same-tier neighbor at (row=5, col=2)
            const neighborCol = 2, neighborRow = 5;
            animateChainHop(after.col, after.row, neighborCol, neighborRow, upTier, function() {
              celebrate(step);
            });
          } else {
            celebrate(step);
          }
        });
      }, 220);
    }, 380);
  }

  function animateMergeAt(col, row, mergedTier, cb) {
    // Pop the bottom 3 tiles in this column (positions row, row-1, row-2)
    // then replace the bottom with the merged tier.
    const targets = [];
    for (let r = row; r >= Math.max(0, row - 2); r--) {
      const c = ftueState.gridEl.querySelector('[data-row="' + r + '"][data-col="' + col + '"]');
      if (c && c.firstChild) targets.push({ cellEl: c, tileEl: c.firstChild });
    }
    targets.forEach(function(t) { t.tileEl.classList.add('merge'); });
    try { if (typeof soundMerge === 'function') soundMerge(mergedTier); } catch (e) {}
    setTimeout(function() {
      // Clear them
      targets.forEach(function(t) { t.cellEl.innerHTML = ''; });
      // Place merged tile at the bottom target
      const bottom = ftueState.gridEl.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
      if (bottom) {
        const merged = buildFtueTileNode(mergedTier);
        merged.classList.add('pop');
        bottom.appendChild(merged);
      }
      cb && cb();
    }, 260);
  }

  function animateChainHop(fromCol, fromRow, toCol, toRow, upTier, cb) {
    const fromCell = ftueState.gridEl.querySelector('[data-row="' + fromRow + '"][data-col="' + fromCol + '"]');
    const toCell = ftueState.gridEl.querySelector('[data-row="' + toRow + '"][data-col="' + toCol + '"]');
    if (!fromCell || !toCell) { cb && cb(); return; }
    // Pop both
    if (fromCell.firstChild) fromCell.firstChild.classList.add('merge');
    if (toCell.firstChild) toCell.firstChild.classList.add('merge');
    try { if (typeof soundChain === 'function') soundChain(2); } catch (e) {}
    setTimeout(function() {
      fromCell.innerHTML = '';
      toCell.innerHTML = '';
      // Place the higher-tier merged tile in the "to" cell (visually anchored
      // to the neighbor that triggered the chain).
      const merged = buildFtueTileNode(upTier);
      merged.classList.add('pop');
      toCell.appendChild(merged);
      // Banner: "שרשרת ×2"
      showChainBanner(2);
      cb && cb();
    }, 280);
  }

  function showChainBanner(n) {
    if (!ftueState || !ftueState.overlay) return;
    const banner = document.createElement('div');
    banner.className = 'ftue-chain-banner';
    banner.textContent = 'שרשרת ×' + n;
    ftueState.overlay.appendChild(banner);
    setTimeout(function() { banner.remove(); }, 1400);
  }

  function celebrate(step) {
    const cheer = step.cheer || {};
    // Big "WOW!" / chain banner
    if (ftueState && ftueState.overlay) {
      const wow = document.createElement('div');
      wow.className = 'ftue-wow';
      wow.textContent = cheer.text || '🎉';
      ftueState.overlay.appendChild(wow);
      setTimeout(function() { wow.remove(); }, 1700);
    }
    if (cheer.vibrate && typeof buzz === 'function') {
      try { buzz([12, 30, 12, 30, 60]); } catch (e) {}
    }
    if (cheer.confetti && typeof showConfetti === 'function') {
      try { showConfetti(40); } catch (e) {}
    }
    advanceAfterCheer(step);
  }

  function advanceAfterCheer(step) {
    setTimeout(function() {
      if (!ftueState) return;
      const nextIdx = ftueState.stepIdx + 1;
      if (nextIdx >= FTUE_STEPS.length) {
        finishFTUE(true);
      } else {
        renderStep(nextIdx);
      }
    }, 1300);
  }

  function finishFTUE(completed) {
    if (!ftueState) return;
    ftueMarkDone();
    try {
      trackEvent(completed ? 'tutorial_complete' : 'tutorial_skip', {
        step: ftueState.stepIdx,
        completed: !!completed
      });
    } catch (e) {}
    const overlay = ftueState.overlay;
    const onDone = ftueState.onDone;
    ftueState = null;
    if (overlay) {
      overlay.classList.add('ftue-leaving');
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        onDone && onDone();
      }, 320);
    } else {
      onDone && onDone();
    }
  }
  // ============================================================
  // WEB PUSH NOTIFICATIONS — closed-app delivery for social events
  // ============================================================
  // Subscribes the player to PWA push notifications so duel invites,
  // gifts, and results land on their device even when BLOOM isn't
  // open. The whole flow is silent until the player takes a social
  // action (sends a duel, accepts a gift, etc.), at which point we
  // present a soft prompt rather than the hard browser permission
  // dialog out of the blue.
  //
  // Browser support:
  //   • Chrome / Edge / Firefox (any OS, any modern version)
  //   • Safari macOS 16+
  //   • Safari iOS 16.4+ ONLY if the site is installed as a PWA
  //     (Share → "Add to Home Screen"). Otherwise no push.
  // ============================================================

  const PUSH_PROMPT_SHOWN_KEY = 'bloom_push_prompt_shown';
  const PUSH_SUBSCRIBED_KEY   = 'bloom_push_subscribed';

  function pushSupportedHere() {
    return ('serviceWorker' in navigator) &&
           ('PushManager' in window) &&
           (typeof Notification !== 'undefined');
  }
  function pushPermissionState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  // Convert the server's base64url-encoded VAPID public key into the
  // Uint8Array shape pushManager.subscribe() expects.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // Idempotent subscribe — safe to call any number of times.
  // Returns true if a subscription is active afterwards, false otherwise.
  async function subscribeToPush() {
    if (!pushSupportedHere()) return false;
    if (pushPermissionState() !== 'granted') return false;
    try {
      const sw = await navigator.serviceWorker.ready;
      let sub = await sw.pushManager.getSubscription();
      if (!sub) {
        const vapidResp = await fetch(API_BASE + '/api/push/vapid-public');
        const vapidData = await vapidResp.json();
        if (!vapidData || !vapidData.key) return false;
        sub = await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.key)
        });
      }
      const sj = sub.toJSON();
      const sendResp = await fetch(API_BASE + '/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          token: deviceToken,
          endpoint: sj.endpoint,
          keys: sj.keys
        })
      });
      const sendJson = await sendResp.json().catch(function() { return null; });
      const ok = !!(sendJson && sendJson.ok);
      try { localStorage.setItem(PUSH_SUBSCRIBED_KEY, ok ? '1' : '0'); } catch (e) {}
      return ok;
    } catch (e) {
      console.warn('[push] subscribe failed', e && e.message);
      return false;
    }
  }

  // Soft pre-prompt UX — overlay modal that explains what the player
  // will get, with two buttons. Tapping "כן" triggers the hard browser
  // permission dialog. Tapping "אחר כך" defers (with a long cooldown).
  // This dramatically increases permission-grant rates vs firing the
  // raw browser dialog out of nowhere.
  function showPushPrePrompt(reasonTextHe) {
    if (document.getElementById('push-pre-prompt')) return Promise.resolve(false);
    return new Promise(function(resolve) {
      const overlay = document.createElement('div');
      overlay.id = 'push-pre-prompt';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10005;' +
        'display:flex;align-items:center;justify-content:center;direction:rtl;padding:18px;' +
        'animation:fadeIn 0.25s ease-out';
      overlay.innerHTML =
        '<div style="background:linear-gradient(180deg,#FFF,#FFF8E7);border-radius:20px;' +
          'padding:24px 22px;max-width:340px;width:100%;text-align:center;' +
          'box-shadow:0 20px 60px rgba(0,0,0,0.35);border:2px solid #FAC775">' +
          '<div style="font-size:48px;line-height:1;margin-bottom:8px">🔔</div>' +
          '<div style="font-size:20px;font-weight:900;color:#1C1A18">הפעל התראות מיידיות</div>' +
          '<div style="font-size:13px;color:#6F6E68;margin:10px 0 18px;line-height:1.5">' +
            (reasonTextHe || 'כשמישהו יאתגר אותך או ישלח לך מתנה — תקבל הודעה מיד, גם כשהמשחק סגור.') +
          '</div>' +
          '<button id="push-prompt-yes" style="width:100%;padding:14px;border:none;border-radius:12px;' +
            'background:linear-gradient(135deg,#FAC775,#BA7517);color:#FFF;font-size:16px;font-weight:800;' +
            'cursor:pointer;font-family:inherit;margin-bottom:8px">' +
            '✅ הפעל התראות' +
          '</button>' +
          '<button id="push-prompt-no" style="width:100%;padding:10px;border:none;' +
            'background:transparent;color:#6F6E68;font-size:13px;font-weight:500;' +
            'cursor:pointer;font-family:inherit">' +
            'אחר כך' +
          '</button>' +
        '</div>';
      document.body.appendChild(overlay);
      const close = function(answer) {
        overlay.style.transition = 'opacity 0.2s';
        overlay.style.opacity = '0';
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve(answer);
        }, 200);
      };
      document.getElementById('push-prompt-yes').onclick = function() { close(true); };
      document.getElementById('push-prompt-no').onclick = function() { close(false); };
      overlay.onclick = function(e) { if (e.target === overlay) close(false); };
    });
  }

  // Public API the rest of the app calls when a social action makes
  // a great moment to ask. Marks "shown" so we don't re-prompt for
  // a configurable cooldown (3 days). Idempotent — repeated calls
  // are no-ops once the user has answered.
  async function maybeAskForPushPermission(reasonTextHe) {
    if (!pushSupportedHere()) return false;
    const state = pushPermissionState();
    if (state === 'granted') {
      // Already granted — just (re)subscribe quietly.
      await subscribeToPush();
      return true;
    }
    if (state === 'denied') return false; // can't re-ask, user said no in browser settings
    // 'default' — we can ask, but only if we haven't already in the cooldown.
    try {
      const lastShown = parseInt(localStorage.getItem(PUSH_PROMPT_SHOWN_KEY) || '0', 10) || 0;
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastShown < threeDays) return false;
    } catch (e) {}

    const wantsIt = await showPushPrePrompt(reasonTextHe);
    try { localStorage.setItem(PUSH_PROMPT_SHOWN_KEY, String(Date.now())); } catch (e) {}
    if (!wantsIt) return false;

    // The hard browser permission dialog. The pre-prompt above means
    // most users tap "allow" — and the ones who don't never see this
    // dialog at all.
    try {
      const result = await Notification.requestPermission();
      if (result !== 'granted') return false;
      await subscribeToPush();
      return true;
    } catch (e) {
      console.warn('[push] permission request failed', e);
      return false;
    }
  }
  try { window.__bloomMaybeAskPush = maybeAskForPushPermission; } catch (e) {}

  // Listen for messages from the service worker:
  //   - 'bloom-push-click' — user tapped a notification; deep-link.
  //   - 'bloom-push-resubscribe' — endpoint rotated; re-POST subscribe.
  if (pushSupportedHere() && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function(event) {
      const d = event.data || {};
      if (d.type === 'bloom-push-click') {
        // Deep-link routing. For now we just navigate to the URL and
        // rely on the page-level handler (showDuelModal, showGiftFriend
        // etc.) to pick up the ?action=... param if present.
        try {
          const u = new URL(d.url, window.location.origin);
          if (u.pathname === window.location.pathname) {
            // Same page — fire the action param locally without reload.
            const action = u.searchParams.get('action');
            if (action === 'duels' && typeof showDuelModal === 'function') showDuelModal();
            else if (action === 'gift' && typeof showGiftFriendModal === 'function') showGiftFriendModal();
            else window.location.href = u.toString();
          } else {
            window.location.href = u.toString();
          }
        } catch (e) {}
      } else if (d.type === 'bloom-push-resubscribe' && d.subscription) {
        // Server-side re-subscribe with the rotated endpoint
        fetch(API_BASE + '/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: deviceId,
            token: deviceToken,
            endpoint: d.subscription.endpoint,
            keys: d.subscription.keys
          })
        }).catch(function() {});
      }
    });
  }

  // On every page load, if permission is ALREADY granted, refresh the
  // subscription server-side. This catches the case where the server
  // wiped the subscription (user marked themselves as opted out via
  // some other path) but the browser still has the subscription —
  // we'd then be silent when we shouldn't be.
  if (pushPermissionState() === 'granted') {
    setTimeout(function() { subscribeToPush(); }, 2500);
  }
})();
