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

  // FTUE_KEY is used by ftueMarkDone() (runs at finishFTUE time — well after
  // module-eval, so the assignment below has already landed). ftueAlreadyDone()
  // is DIFFERENT: 13-boot.js (concatenated BEFORE this file) calls it
  // SYNCHRONOUSLY at module-eval time — BEFORE this `var FTUE_KEY = ...`
  // assignment executes. At that instant the hoisted `FTUE_KEY` is still
  // `undefined`, so reading via FTUE_KEY would do localStorage.getItem(undefined)
  // → always null → the done-flag would be IGNORED and the FTUE re-fires on
  // every visit (masked only by the games_played>0 gate in boot — so it bit the
  // narrow cohort who saw the tutorial but hadn't finished a game yet). Fix:
  // read the LITERAL key string here so it's independent of concat/eval order.
  var FTUE_KEY = 'bloom_ftue_done';
  function ftueAlreadyDone() {
    try { return !!localStorage.getItem('bloom_ftue_done'); } catch (e) { return false; }
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
  // The REAL engine rule (src/11-game.js findGroup + `group.length >= 2`):
  // TWO or more identical tiles that touch ORTHOGONALLY (horizontally OR
  // vertically) merge automatically into the next tier. The demo MUST match
  // this — an earlier version taught "three identical" and pre-stacked two
  // un-merged same-tier tiles (a board state that's impossible in the real
  // engine, since two adjacent equals would have already merged). Each `after`
  // descriptor fully drives the animation (no hardcoded row math):
  //   landRow  — where the dropped tile lands (top of the existing stack)
  //   popCells — the cells that visually pop during the merge
  //   mergedAt — where the merged (next-tier) tile is placed
  //   chainWith / chainResultAt / chainTier — the follow-on adjacent merge
  var FTUE_STEPS = [
    {
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      next:  1,
      col:   1,
      teach: 'הקש על העמודה כדי להפיל את האבן',
      after: { type: 'drop', col: 1, landRow: 5 },
      cheer: { text: '🎯 כל הכבוד! זו הייתה ההפלה הראשונה שלך', sound: 'drop' }
    },
    {
      // ONE tier-1 sits at the bottom of column 1 (row 5). The player drops a
      // SECOND tier-1 on top (row 4) → two identical touch vertically → merge
      // to tier-2. This matches the real "two equals → merge" rule exactly.
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
      next:  1,
      col:   1,
      teach: 'שתי אבנים זהות שנפגשות → מתמזגות ומשדרגות לדרגה הבאה!',
      after: { type: 'merge', col: 1, landRow: 4, popCells: [[4,1],[5,1]], mergedTier: 2, mergedAt: [5,1] },
      cheer: { text: 'WOW! המיזוג הראשון שלך 🎉', sound: 'merge', vibrate: true }
    },
    {
      // Column 1 has ONE tier-1 (row 5). Column 2 has a tier-2 (row 5). The
      // player drops a tier-1 in column 1 → the two tier-1 merge → tier-2 at
      // [5,1], now HORIZONTALLY adjacent to the tier-2 at [5,2] → they chain
      // → tier-3. Teaches "a merge that triggers another merge = a chain".
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,2,0],
      next:  1,
      col:   1,
      teach: 'מיזוג שגורר עוד מיזוג = שרשרת! בונוס ניקוד ענק 🔥',
      after: { type: 'chain', col: 1, landRow: 4, popCells: [[4,1],[5,1]], mergedTier: 2, mergedAt: [5,1],
               chainWith: [5,2], chainTier: 3, chainResultAt: [5,1], chain: 2 },
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
    if (!ftueState) return;   // buildOverlay tears down on a missing grid
    showFtueWelcome();
  }

  // UX audit 2026-06-02 — value-prop welcome phase (shown before the demo) +
  // a graduation "let's play" CTA (shown after the last step) so the first
  // session opens with desire and ends with a deliberate commit, not a chore
  // and a passive dump to home.
  function showFtueWelcome() {
    if (!ftueState || !ftueState.overlay) return;
    var ladder = ftueState.overlay.querySelector('#ftue-welcome-ladder');
    if (ladder) {
      ladder.innerHTML = '';
      var maxT = (typeof MAX_TIER !== 'undefined') ? MAX_TIER : 8;
      for (var t = 1; t <= maxT; t++) ladder.appendChild(buildFtueTileNode(t));
    }
    var startBtn = ftueState.overlay.querySelector('#ftue-welcome-start');
    if (startBtn) startBtn.onclick = function() {
      try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}
      beginFtueSteps();
    };
    var skipW = ftueState.overlay.querySelector('#ftue-skip-welcome');
    if (skipW) skipW.onclick = function() {
      try { trackEvent('tutorial_skip', { step: -1 }); } catch (e) {}
      finishFTUE(false);
    };
    try { trackEvent('tutorial_welcome', {}); } catch (e) {}
  }
  function beginFtueSteps() {
    if (!ftueState || !ftueState.overlay) return;
    var welcome = ftueState.overlay.querySelector('#ftue-welcome');
    var steps = ftueState.overlay.querySelector('#ftue-steps');
    if (welcome) welcome.style.display = 'none';
    if (steps) steps.style.display = '';
    renderStep(0);
  }
  function showFtueGraduation() {
    if (!ftueState || !ftueState.overlay) { finishFTUE(true); return; }
    var steps = ftueState.overlay.querySelector('#ftue-steps');
    var welcome = ftueState.overlay.querySelector('#ftue-welcome');
    if (steps) steps.style.display = 'none';
    if (!welcome) { finishFTUE(true); return; }
    welcome.style.display = '';
    // Complaint #1 fix — the demo never explained the special tiles that show
    // up during play (bomb/star/gift/fever/freeze/target). We teach them here,
    // at the LAST screen before play, as a recognition card (icon + one-liner)
    // rather than 6 more forced interactions — so the player knows what each
    // tile does the first time it appears, without overloading the tutorial.
    welcome.innerHTML =
      '<div class="ftue-grad-emoji">🌸</div>' +
      '<div class="ftue-welcome-title">כמעט מוכן!</div>' +
      '<div class="ftue-grad-sub">תוך כדי משחק יופיעו אריחים מיוחדים — הכירו אותם:</div>' +
      '<div class="ftue-bonus-grid">' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">💣</span><div><b>פצצה</b><span>מפוצצת אזור שלם</span></div></div>' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">⭐</span><div><b>כוכב</b><span>משדרג אריח בדרגה</span></div></div>' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">🎁</span><div><b>מתנה</b><span>יהלומים חינם</span></div></div>' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">🔥</span><div><b>טירוף</b><span>ניקוד כפול לזמן קצר</span></div></div>' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">❄️</span><div><b>הקפאה</b><span>אריח קפוא — מזגו לידו</span></div></div>' +
        '<div class="ftue-bonus-item"><span class="ftue-bonus-emoji">🎯</span><div><b>מטרה</b><span>הגיעו לדרגת היעד</span></div></div>' +
      '</div>' +
      '<button class="ftue-welcome-start" id="ftue-grad-start">🎮 התחל לשחק 👑</button>';
    var gb = welcome.querySelector('#ftue-grad-start');
    if (gb) gb.onclick = function() {
      try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}
      finishFTUE(true);
    };
    try { if (typeof showConfetti === 'function') showConfetti(30); } catch (e) {}
    try { trackEvent('tutorial_graduation', {}); } catch (e) {}
  }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ftue-overlay';
    overlay.className = 'ftue-overlay';
    overlay.innerHTML =
      '<div class="ftue-card">' +
        // UX audit 2026-06-02 — a value-prop "welcome" moment BEFORE the demo
        // (the old flow opened straight into a chore on an empty grid). The
        // 3-step scripted demo below (#ftue-steps) is unchanged.
        '<div class="ftue-welcome" id="ftue-welcome">' +
          '<div class="ftue-brand">🌸 BLOOM</div>' +
          '<div class="ftue-welcome-title">מזגו פרחים. הגיעו לכתר 👑</div>' +
          '<div class="ftue-welcome-ladder" id="ftue-welcome-ladder"></div>' +
          '<div class="ftue-welcome-bullets">' +
            '<div>🌱 מזגו 2 אבנים זהות שנוגעות (אופקי/אנכי) → שדרוג</div>' +
            '<div>👑 טפסו 8 דרגות עד הכתר</div>' +
            '<div>🏆 התחרו על המקום הראשון בעולם</div>' +
          '</div>' +
          '<button class="ftue-welcome-start" id="ftue-welcome-start">בוא נתחיל 🌸</button>' +
          '<button class="ftue-skip" id="ftue-skip-welcome">דלג על המדריך</button>' +
        '</div>' +
        '<div class="ftue-steps" id="ftue-steps" style="display:none">' +
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
        '</div>' +
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
    const after = step.after;
    const landRow = (after.landRow != null) ? after.landRow : 5;
    // The cell the dropped tile lands in (top of the existing stack).
    const targetCell = ftueState.gridEl.querySelector('[data-row="' + landRow + '"][data-col="' + after.col + '"]');
    if (!targetCell) { advanceAfterCheer(step); return; }

    // Drop animation: spawn a tile at the top of the column, slide it down.
    const topCell = ftueState.gridEl.querySelector('[data-row="0"][data-col="' + after.col + '"]');
    const dropTile = buildFtueTileNode(step.next);
    dropTile.classList.add('ftue-drop-anim');
    topCell.appendChild(dropTile);
    const cellH = topCell.getBoundingClientRect().height;
    requestAnimationFrame(function() {
      dropTile.style.transform = 'translateY(' + (cellH * landRow) + 'px)';
    });

    setTimeout(function() {
      if (dropTile.parentElement) dropTile.parentElement.removeChild(dropTile);
      const landed = buildFtueTileNode(step.next);
      landed.classList.add('pop');
      targetCell.appendChild(landed);
      try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([6]); } catch (e) {}

      if (after.type === 'drop') { celebrate(step); return; }

      // merge / chain — pop the matching tiles, then place the merged tile.
      setTimeout(function() {
        animateMergeAt(after.popCells, after.mergedTier, after.mergedAt, function() {
          if (after.type === 'chain') {
            animateChainHop(after.mergedAt, after.chainWith, after.chainTier, after.chainResultAt, function() {
              celebrate(step);
            });
          } else {
            celebrate(step);
          }
        });
      }, 220);
    }, 380);
  }

  // Pop every cell in popCells (the matching same-tier tiles), then place the
  // merged next-tier tile at mergedAt. Driven entirely by the step descriptor
  // so it stays correct for a 2-tile merge (the real rule) — no hardcoded
  // "bottom 3 in the column".
  function animateMergeAt(popCells, mergedTier, mergedAt, cb) {
    const targets = [];
    (popCells || []).forEach(function(rc) {
      const c = ftueState.gridEl.querySelector('[data-row="' + rc[0] + '"][data-col="' + rc[1] + '"]');
      if (c && c.firstChild) targets.push(c);
    });
    targets.forEach(function(c) { c.firstChild.classList.add('merge'); });
    try { if (typeof soundMerge === 'function') soundMerge(mergedTier); } catch (e) {}
    setTimeout(function() {
      targets.forEach(function(c) { c.innerHTML = ''; });
      const at = mergedAt || (popCells && popCells[popCells.length - 1]);
      const bottom = at && ftueState.gridEl.querySelector('[data-row="' + at[0] + '"][data-col="' + at[1] + '"]');
      if (bottom) {
        const merged = buildFtueTileNode(mergedTier);
        merged.classList.add('pop');
        bottom.appendChild(merged);
      }
      cb && cb();
    }, 260);
  }

  // The follow-on adjacent merge: the just-merged tile at fromRC and the
  // existing same-tier tile at withRC both pop, and the higher-tier result
  // lands at resultAtRC. [r,c] arrays everywhere — no hardcoded neighbor.
  function animateChainHop(fromRC, withRC, resultTier, resultAtRC, cb) {
    const fromCell = fromRC && ftueState.gridEl.querySelector('[data-row="' + fromRC[0] + '"][data-col="' + fromRC[1] + '"]');
    const withCell = withRC && ftueState.gridEl.querySelector('[data-row="' + withRC[0] + '"][data-col="' + withRC[1] + '"]');
    if (!fromCell || !withCell) { cb && cb(); return; }
    if (fromCell.firstChild) fromCell.firstChild.classList.add('merge');
    if (withCell.firstChild) withCell.firstChild.classList.add('merge');
    try { if (typeof soundChain === 'function') soundChain(2); } catch (e) {}
    setTimeout(function() {
      fromCell.innerHTML = '';
      withCell.innerHTML = '';
      const at = resultAtRC || fromRC;
      const resCell = ftueState.gridEl.querySelector('[data-row="' + at[0] + '"][data-col="' + at[1] + '"]');
      if (resCell) {
        const merged = buildFtueTileNode(resultTier);
        merged.classList.add('pop');
        resCell.appendChild(merged);
      }
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
        // UX audit 2026-06-02 — graduate with a deliberate "let's play" CTA
        // instead of silently dumping the player on home.
        showFtueGraduation();
      } else {
        renderStep(nextIdx);
      }
    }, 1000);
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
