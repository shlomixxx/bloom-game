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

  // `var` (not `const`) — read by ftueAlreadyDone() which is called from
  // 13-boot.js at module-eval time (BEFORE this file evaluates). const would
  // be in TDZ; var hoists with `undefined` so the localStorage.getItem call
  // gracefully no-ops (returns null) in the catch path.
  var FTUE_KEY = 'bloom_ftue_done';
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
  // `var` (not `const`) — read by renderStep() which is reached through
  // startFTUE() → buildOverlay() → renderStep(0) when 13-boot.js triggers
  // first-time FTUE at module-eval time. const would be in TDZ at that point.
  var FTUE_STEPS = [
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

  // Note: must be `var` (not `let`) because 13-boot.js — which is concatenated
  // BEFORE this file — calls startFTUE() at module-eval time on first-time
  // visitors (no localStorage history). `let` would be in TDZ at that point;
  // `var` is hoisted with `undefined` so `if (ftueState) return;` still works.
  var ftueState = null; // { stepIdx, overlay, gridEl, nextEl, bubbleEl, arrowEl, onDone, locked }

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
    // Bug #20 — if the overlay DOM didn't materialize (grid missing), don't
    // strand a first-time player on a broken tutorial with no home + no game.
    // Tear down and hand off to onDone (→ showHome) so they still land safely.
    if (!ftueState.gridEl) {
      var failCb = ftueState.onDone;
      try { overlay.remove(); } catch (e) {}
      ftueState = null;
      if (typeof failCb === 'function') { try { failCb(); } catch (e) {} }
      return;
    }
    var skipBtn = overlay.querySelector('#ftue-skip');
    if (skipBtn) skipBtn.onclick = function() {
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
    // Bug #20 — guard against a missing grid element / bad state so the
    // tutorial fails soft instead of throwing on a first-time player.
    if (!ftueState || !ftueState.gridEl || !Array.isArray(state)) return;
    const cols = 4, rows = 6;
    try {
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
    } catch (e) {
      try { console.warn('[bloom] FTUE grid render failed', e && e.message); } catch (_) {}
    }
  }

  function renderFtueTile(container, tier) {
    if (!container) return;
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
