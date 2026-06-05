  // ============================================================
  // GAME v2 — board mechanics layered INTO the classic engine (GV.4)
  // ============================================================
  // This file is concatenated INSIDE the main IIFE (no wrapper), so it can call
  // the classic engine directly (drop/render/pickPiece/grid/nextPiece/...).
  // EVERYTHING here is gated by v2On() (src/01-constants.js) — when the admin
  // flag is OFF, v2On() is false and none of this runs: pure classic, instant
  // revert. Adds: hold/swap slot, ghost-landing preview + drag-to-aim + same-
  // tier pulse, and a beta feedback prompt. Board stays 4×6 + classic scoring,
  // so every meta system (trophies/BP/leaderboards/...) is untouched.

  var _v2LastAimCol = -1;
  var _v2Wired = false;

  // ---- Hold / swap slot ----
  function v2SwapHold() {
    if (!v2On() || busy || window.__bloomGameOver) return;
    if (typeof nextPiece === 'undefined' || typeof pickPiece !== 'function') return;
    if (heldPiece == null) { heldPiece = nextPiece; nextPiece = pickPiece(); }
    else { var t = heldPiece; heldPiece = nextPiece; nextPiece = t; }
    try { if (typeof highlightNextTier === 'function') highlightNextTier(nextPiece); } catch (e) {}
    paintV2Launch();
    try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([18]); } catch (e) {}
  }
  // The v2 launch row: Hold · Current · Next (replaces the old floating chip).
  // "Current" = nextPiece (what drops on tap); "Next" = the v2NextUp lookahead.
  function paintV2Launch() {
    if (!v2On()) return;
    var row = document.getElementById('v2-launch'); if (!row) return;
    if (typeof v2NextUp !== 'undefined' && v2NextUp == null && typeof pickPiece === 'function') {
      try { v2NextUp = pickPiece(); } catch (e) {}
    }
    if (!row.dataset.built) {
      row.dataset.built = '1';
      row.innerHTML =
        '<div class="v2-slot"><span class="v2-slot-lbl">החזקה</span>' +
          '<button class="v2-slot-box v2-hold" id="v2-hold-box" type="button" aria-label="החלף אריח"></button></div>' +
        '<div class="v2-slot v2-slot-cur"><span class="v2-slot-lbl">נוכחי</span>' +
          '<div class="v2-slot-box v2-cur" id="v2-cur-box"></div></div>' +
        '<div class="v2-slot"><span class="v2-slot-lbl">הבא</span>' +
          '<div class="v2-slot-box v2-next" id="v2-next-box"></div></div>';
      var hb = document.getElementById('v2-hold-box');
      if (hb) hb.addEventListener('click', function(e) { e.stopPropagation(); v2SwapHold(); });
    }
    var tiers = (typeof getActiveTiers === 'function') ? getActiveTiers() : null;
    function fill(id, tier) {
      var el = document.getElementById(id); if (!el) return;
      if (tier && tiers && tiers[tier]) { el.classList.add('has-tile'); el.style.background = tiers[tier].bg; el.style.color = tiers[tier].fg; el.innerHTML = tiers[tier].svg; }
      else { el.classList.remove('has-tile'); el.style.background = ''; el.innerHTML = ''; }
    }
    fill('v2-hold-box', heldPiece);
    fill('v2-cur-box', (typeof nextPiece !== 'undefined' ? nextPiece : 0));
    fill('v2-next-box', (typeof v2NextUp !== 'undefined' ? v2NextUp : 0));
  }

  // ---- Aim overlay: ghost landing preview + column highlight + neighbor pulse ----
  function v2LandingRow(col) {
    if (typeof grid === 'undefined' || !grid) return -1;
    var rows = (typeof getBoardRows === 'function') ? getBoardRows() : grid.length;
    for (var r = rows - 1; r >= 0; r--) {
      var row = grid[r]; if (!row) continue;
      if (row[col] === 0) {
        // respect shape voids if the helper exists (dynamic boards); else accept.
        if (typeof isShapeInactiveAt === 'function' && isShapeInactiveAt(r, col)) continue;
        return r;
      }
    }
    return -1;
  }
  function v2ClearAim() {
    var hi = document.getElementById('v2-col-hi'), ghost = document.getElementById('v2-ghost');
    if (hi) hi.style.display = 'none';
    if (ghost) ghost.style.display = 'none';
    v2ClearPulse();
  }
  function v2ClearPulse() {
    var els = document.querySelectorAll('.cell.v2-pulse');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('v2-pulse');
  }
  function paintV2Aim(col) {
    if (!v2On()) return;
    var wrap = document.getElementById('grid-wrap'), gridEl = document.getElementById('grid');
    if (!wrap || !gridEl) return;
    var aim = document.getElementById('v2-aim');
    if (!aim) {
      aim = document.createElement('div'); aim.id = 'v2-aim';
      aim.innerHTML = '<div class="v2-col-hi" id="v2-col-hi"></div><div class="v2-ghost-tile" id="v2-ghost"></div>';
      wrap.appendChild(aim);
    }
    var hi = document.getElementById('v2-col-hi'), ghost = document.getElementById('v2-ghost');
    _v2LastAimCol = (col == null ? -1 : col);
    if (col == null || col < 0 || busy || window.__bloomGameOver) { v2ClearAim(); return; }
    var wr = wrap.getBoundingClientRect();
    var anyCell = gridEl.querySelector('.cell[data-c="' + col + '"]');
    if (!anyCell) { v2ClearAim(); return; }
    var ar = anyCell.getBoundingClientRect();
    if (hi) { hi.style.display = 'block'; hi.style.left = (ar.left - wr.left) + 'px'; hi.style.width = ar.width + 'px'; }
    var lr = v2LandingRow(col);
    if (lr < 0) { if (ghost) ghost.style.display = 'none'; v2ClearPulse(); return; }
    var landCell = gridEl.querySelector('.cell[data-r="' + lr + '"][data-c="' + col + '"]');
    var tiers = (typeof getActiveTiers === 'function') ? getActiveTiers() : null;
    if (ghost && landCell && tiers && tiers[nextPiece]) {
      var lcr = landCell.getBoundingClientRect();
      ghost.style.display = 'flex';
      ghost.style.left = (lcr.left - wr.left) + 'px'; ghost.style.top = (lcr.top - wr.top) + 'px';
      ghost.style.width = lcr.width + 'px'; ghost.style.height = lcr.height + 'px';
      ghost.style.background = tiers[nextPiece].bg; ghost.innerHTML = tiers[nextPiece].svg;
    }
    v2PaintPulse(lr, col);
  }
  function v2PaintPulse(lr, col) {
    v2ClearPulse();
    if (lr < 0 || typeof grid === 'undefined') return;
    var gridEl = document.getElementById('grid'); if (!gridEl) return;
    var rows = (typeof getBoardRows === 'function') ? getBoardRows() : grid.length;
    var cols = (typeof getBoardCols === 'function') ? getBoardCols() : (grid[0] || []).length;
    var nb = [[lr - 1, col], [lr + 1, col], [lr, col - 1], [lr, col + 1]];
    for (var k = 0; k < 4; k++) {
      var rr = nb[k][0], cc = nb[k][1];
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && grid[rr] && grid[rr][cc] === nextPiece) {
        var cell = gridEl.querySelector('.cell[data-r="' + rr + '"][data-c="' + cc + '"]');
        if (cell) cell.classList.add('v2-pulse');
      }
    }
  }
  function v2ColFromEvent(e) {
    var x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var y = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    if (x == null) return -1;
    var el = document.elementFromPoint(x, y);
    var cell = el && el.closest ? el.closest('.cell') : null;
    if (!cell || cell.dataset == null || cell.dataset.c == null) return -1;
    var c = parseInt(cell.dataset.c, 10);
    return Number.isFinite(c) ? c : -1;
  }
  function v2WireAim() {
    if (_v2Wired) return;
    var wrap = document.getElementById('grid-wrap'); if (!wrap) return;
    _v2Wired = true;
    var onMove = function(e) { if (!v2On() || busy || window.__bloomGameOver) return; var c = v2ColFromEvent(e); if (c >= 0) paintV2Aim(c); };
    wrap.addEventListener('pointerdown', onMove);   // aim preview only — never preventDefault, so the cell onclick still drops
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', function() { if (v2On()) v2ClearAim(); });
    wrap.addEventListener('pointerup', function() { /* the cell's onclick performs the drop; render() repaints */ });
  }

  // ---- Gravity settle: FLIP-slide tiles from old→new row after a merge ----
  // applyGravity() recorded the exact {toR,fromR,c} moves; we render the tile at
  // its NEW cell but start it offset to its OLD position and transition to rest,
  // so it visibly slides down instead of teleporting. Classic rebuilds the grid
  // DOM each render (no persistent tiles), so this FLIP is how we animate it.
  function playV2GravitySlide() {
    if (!v2On()) return;
    if (typeof _v2GravityMoves === 'undefined' || !_v2GravityMoves || !_v2GravityMoves.length) return;
    var moves = _v2GravityMoves.slice();
    _v2GravityMoves.length = 0; // consume
    var gridEl = document.getElementById('grid'); if (!gridEl) return;
    for (var i = 0; i < moves.length; i++) {
      (function(m) {
        try {
          var toCell = gridEl.querySelector('.cell[data-r="' + m.toR + '"][data-c="' + m.c + '"]');
          var fromCell = gridEl.querySelector('.cell[data-r="' + m.fromR + '"][data-c="' + m.c + '"]');
          if (!toCell || !fromCell) return;
          var dy = toCell.getBoundingClientRect().top - fromCell.getBoundingClientRect().top; // >0 = moved down
          if (!dy) return;
          toCell.style.transition = 'none';
          toCell.style.transform = 'translateY(' + (-dy) + 'px)';
          void toCell.offsetWidth; // reflow so the start position registers
          toCell.style.transition = 'transform .17s cubic-bezier(.34,1.08,.64,1)';
          toCell.style.transform = 'translateY(0)';
          setTimeout(function() { try { toCell.style.transition = ''; toCell.style.transform = ''; } catch (e) {} }, 230);
        } catch (e) {}
      })(moves[i]);
    }
  }

  // ---- v2 drop fall: the dropped tile FALLS from the top of the column down
  // through every empty row to its landing cell (row,col). Classic .appearing is
  // a pop-in-place; this is the demo's real fall. drop() AWAITS this (gated) right
  // after render({appearing}), so the full fall plays before any merge render.
  // Same FLIP idea as the gravity slide, but the start offset is the whole column
  // height above the grid's top edge. Returns a Promise (resolves when it lands).
  function v2PlayFall(row, col) {
    return new Promise(function(resolve) {
      try {
        if (!v2On()) { resolve(); return; }
        try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { resolve(); return; } } catch (e) {}
        var gridEl = document.getElementById('grid'); if (!gridEl) { resolve(); return; }
        var cell = gridEl.querySelector('.cell[data-r="' + row + '"][data-c="' + col + '"]');
        if (!cell) { resolve(); return; }
        // render() just rebuilt the grid DOM and fitGrid may not have re-applied
        // to the fresh cells yet, so a brand-new cell can momentarily report a
        // collapsed rect (~tiny). Force the sizer, then derive the fall distance
        // from BOTH the cell rect AND the grid height (take the max) so a
        // not-yet-sized cell can never shrink the fall. The tile starts one
        // cell-height above the grid's TOP edge → it streaks down through every
        // empty row above the landing cell (those rows are always empty: the tile
        // fell to the lowest empty slot, so nothing floats above it).
        try { if (typeof fitGrid === 'function') fitGrid(); } catch (e) {}
        var gridRect = gridEl.getBoundingClientRect();
        var cellRect = cell.getBoundingClientRect();
        var rows = (typeof getBoardRows === 'function') ? getBoardRows() : 6;
        // grid.style.height is the inline px the sizer (fitGrid) set; it persists
        // across render()'s innerHTML rebuild and stays correct even when a freshly
        // built cell — or the grid's own box — momentarily reports a COLLAPSED
        // getBoundingClientRect at this exact synchronous instant (which happens on
        // quick successive drops). Prefer it; fall back to the live rects.
        var gh = parseFloat(gridEl.style.height) || gridRect.height || gridEl.clientHeight || 0;
        var byCell = (cellRect.top - gridRect.top) + cellRect.height;
        var byGrid = (rows > 0 && gh > 0) ? ((row + 1) * (gh / rows)) : 0;
        var dist = Math.round(Math.max(byCell, byGrid));
        if (!(dist > 6)) { resolve(); return; } // landed at the very top → no real fall
        var dur = Math.min(360, Math.max(150, Math.round(dist * 1.05)));
        try { if (typeof gameSpeedScale === 'function') dur = Math.max(90, Math.round(dur * gameSpeedScale())); } catch (e) {}
        cell.style.willChange = 'transform';
        cell.style.transition = 'none';
        cell.style.transform = 'translateY(' + (-dist) + 'px)';
        cell.style.opacity = '1';
        void cell.offsetWidth; // reflow so the start offset registers before the transition
        cell.style.transition = 'transform ' + dur + 'ms cubic-bezier(.45,.03,.85,.5)'; // accelerating = gravity
        cell.style.transform = 'translateY(0)';
        var done = false;
        var finish = function() {
          if (done) return; done = true;
          try {
            cell.style.transition = ''; cell.style.transform = ''; cell.style.opacity = ''; cell.style.willChange = '';
            cell.classList.add('v2-landed'); // brief squash
            setTimeout(function() { try { cell.classList.remove('v2-landed'); } catch (e) {} }, 200);
          } catch (e) {}
          resolve();
        };
        cell.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, dur + 70); // safety fallback if transitionend doesn't fire
      } catch (e) { resolve(); }
    });
  }

  // ---- Repaint hook, called from render() (gated) ----
  function paintV2Layers() {
    if (!v2On()) return;
    try { v2WireAim(); } catch (e) {}
    try { paintV2Launch(); } catch (e) {}
    // cells were rebuilt by render() → ghost geometry + pulse are stale; clear
    // them. They reappear on the next pointer hover/drag.
    try { v2ClearAim(); } catch (e) {}
  }

  // ---- Beta feedback (reuses GV.2 /api/feedback + admin panel) ----
  var FB_DONE_KEY = 'bloom_v2_feedback_done';
  var _v2GameOvers = 0, _fbRating = 0, _fbSubmitting = false;
  function v2FbDone() { try { return !!localStorage.getItem(FB_DONE_KEY); } catch (e) { return false; } }
  function v2BuildFeedbackPanel() {
    if (document.getElementById('v2-fb-overlay')) return;
    var ov = document.createElement('div'); ov.id = 'v2-fb-overlay';
    ov.innerHTML =
      '<div class="v2-fb-card">' +
        '<button type="button" class="v2-fb-x" aria-label="סגור">✕</button>' +
        '<div class="v2-fb-title" id="v2-fb-title">איך הלוח החדש?</div>' +
        '<div class="v2-fb-rate">' +
          '<button type="button" class="v2-fb-up" data-r="1">👍</button>' +
          '<button type="button" class="v2-fb-down" data-r="-1">👎</button>' +
        '</div>' +
        '<input type="text" class="v2-fb-input" id="v2-fb-input" maxlength="500" placeholder="ספר/י לנו (לא חובה)">' +
        '<button type="button" class="v2-fb-send" id="v2-fb-send">שלח</button>' +
        '<div class="v2-fb-thanks" id="v2-fb-thanks" hidden>תודה! 🙏</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.v2-fb-x').addEventListener('click', function() { v2CloseFeedback(true); });
    ov.addEventListener('click', function(e) { if (e.target === ov) v2CloseFeedback(true); });
    ov.querySelectorAll('.v2-fb-rate button').forEach(function(b) {
      b.addEventListener('click', function() {
        _fbRating = parseInt(b.getAttribute('data-r'), 10) || 0;
        ov.querySelector('.v2-fb-up').classList.toggle('sel', _fbRating === 1);
        ov.querySelector('.v2-fb-down').classList.toggle('sel', _fbRating === -1);
      });
    });
    ov.querySelector('#v2-fb-send').addEventListener('click', v2SubmitFeedback);
  }
  function v2OpenFeedback(isAuto) {
    if (!v2On()) return;
    v2BuildFeedbackPanel();
    var ov = document.getElementById('v2-fb-overlay'); if (!ov) return;
    var t = document.getElementById('v2-fb-title');
    if (t) t.textContent = isAuto ? 'נהנית מהלוח החדש?' : '💬 ספר/י לנו מה דעתך';
    ov.classList.add('show');
  }
  function v2CloseFeedback(markDone) {
    var ov = document.getElementById('v2-fb-overlay'); if (ov) ov.classList.remove('show');
    if (markDone) { try { localStorage.setItem(FB_DONE_KEY, '1'); } catch (e) {} }
  }
  function v2SubmitFeedback() {
    if (_fbSubmitting) return;
    var input = document.getElementById('v2-fb-input');
    var comment = input ? (input.value || '').trim().slice(0, 500) : '';
    if (!_fbRating && !comment) { var t = document.getElementById('v2-fb-title'); if (t) t.textContent = 'בחר/י 👍 או 👎 (או כתוב/כתבי משהו)'; return; }
    _fbSubmitting = true;
    var did = ''; try { did = localStorage.getItem('bloom_device_id') || ''; } catch (e) {}
    var sc = 0; try { sc = (typeof score === 'number') ? Math.floor(score) : 0; } catch (e) {}
    try {
      fetch(API_BASE + '/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: _fbRating || null, comment: comment || null, score: sc, variant: 'v2', deviceId: did })
      }).catch(function() {});
    } catch (e) {}
    try { localStorage.setItem(FB_DONE_KEY, '1'); } catch (e) {}
    var thanks = document.getElementById('v2-fb-thanks'); if (thanks) thanks.hidden = false;
    ['#v2-fb-title', '.v2-fb-rate', '#v2-fb-input', '#v2-fb-send'].forEach(function(s) { var el = document.querySelector('#v2-fb-overlay ' + s); if (el) el.style.display = 'none'; });
    setTimeout(function() { v2CloseFeedback(true); }, 1300);
  }
  // Called from the game-over render (gated). Auto-prompts once, after the 2nd
  // real game-over of the session.
  function v2OnGameOver() {
    if (!v2On()) return;
    if (window.__bloomBotActive || (typeof skinTrialMode !== 'undefined' && skinTrialMode)) return;
    _v2GameOvers++;
    if (_v2GameOvers === 2 && !v2FbDone()) { setTimeout(function() { v2OpenFeedback(true); }, 1100); }
  }

  // Expose for cross-file callers / debugging.
  try {
    window.__bloomV2 = {
      swapHold: v2SwapHold, paintLayers: paintV2Layers, onGameOver: v2OnGameOver,
      playFall: v2PlayFall, openFeedback: function() { v2OpenFeedback(false); }
    };
  } catch (e) {}
