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
  // FT.2 — the demo runs on the REAL engine (findGroup + applyGravity via
  // withTutGrid), not a scripted animation, so it can never teach a rule the
  // game doesn't enforce. Each step only declares the controlled board (`pre`),
  // the piece to drop (`next`), the hinted column (`col`), copy, and `expect`
  // (how many merges the real engine should produce — a runtime drift guard).
  // The demo speaks leaf→flower→fire (tiers 2/3/4): colourful + recognizable +
  // consistent with the in-game tour ("שני עלים = פרח אחד"), not the plain
  // tier-1 stone.
  var FTUE_STEPS = [
    {
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      next:  2,
      col:   1,
      teach: 'הקש על העמודה כדי להפיל את החלק',
      expect: 0,
      cheer: { text: '🎯 כל הכבוד! זו הייתה ההפלה הראשונה שלך', sound: 'drop' }
    },
    {
      // ONE leaf at the bottom of col 1. Drop a 2nd leaf → two leaves meet →
      // flower (2+2→3), resolved by the real engine.
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,2,0,0],
      next:  2,
      col:   1,
      teach: 'שני עלים זהים נפגשים → פרח! כל 2 זהים שנוגעים משדרגים לדרגה הבאה',
      expect: 1,
      cheer: { text: 'WOW! המיזוג הראשון שלך 🎉', sound: 'merge', vibrate: true }
    },
    {
      // col 1 = leaf, col 2 = flower. Drop a leaf in col 1 → leaf+leaf = flower
      // → that flower meets the neighbour flower → fire (3+3→4). Two real
      // same-tier merges from ONE drop = a chain.
      pre:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,2,3,0],
      next:  2,
      col:   1,
      teach: 'מיזוג שגורר עוד מיזוג = שרשרת! בונוס ניקוד ענק 🔥',
      expect: 2,
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
      tutGrid: null,  // FT.2 — local 6×4 board the real engine resolves on
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
            '<div>🌱 מזגו ' + ftueMinGroup() + ' אריחים זהים שנוגעים (אופקי/אנכי) → שדרוג</div>' +
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

    // Board — load the controlled board into the local engine grid + render
    ftueLoadStep(step);
    renderTutGrid(step.col);

    // Arrow positioning — anchor over the hinted column
    positionArrowOverColumn(step.col);

    // Analytics
    try { trackEvent('tutorial_step', { step: idx }); } catch (e) {}
  }

  // Safe accessor for the engine's shared merge threshold. mergeMinGroup() is
  // defined in 11-game.js (same IIFE) and called at runtime, so it's available;
  // the fallback covers any unexpected load-order edge.
  function ftueMinGroup() {
    try { return (typeof mergeMinGroup === 'function') ? mergeMinGroup() : 2; } catch (e) { return 2; }
  }

  // FT.2 — run a real engine function (findGroup / applyGravity, which operate
  // on the module-global `grid`) against the tutorial's local board. At FTUE
  // time there is NO live game, so `grid` is undefined; we point it at tutGrid
  // for the synchronous call and restore it in `finally`. The swap window is
  // synchronous-only, so nothing else ever observes the swapped grid.
  function withTutGrid(fn) {
    var saved = grid;
    grid = ftueState.tutGrid;
    try { return fn(); } finally { grid = saved; }
  }

  // Load a step's flat 24-cell `pre` into the 6×4 2D board the engine reads.
  function ftueLoadStep(step) {
    if (!ftueState) return;
    var g = [];
    for (var r = 0; r < 6; r++) { g[r] = []; for (var c = 0; c < 4; c++) g[r][c] = step.pre[r * 4 + c] || 0; }
    ftueState.tutGrid = g;
  }

  // Render the local board into the FTUE DOM (same cell/tile markup as the real
  // game). opts.pop = [r,c] marks a freshly-placed tile for the pop animation.
  function renderTutGrid(hintCol, opts) {
    opts = opts || {};
    if (!ftueState || !ftueState.gridEl || !ftueState.tutGrid) return;
    try {
      ftueState.gridEl.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 4; c++) {
          const cell = document.createElement('div');
          cell.className = 'ftue-cell';
          cell.dataset.row = r;
          cell.dataset.col = c;
          if (c === hintCol) cell.classList.add('hint-col');
          const tier = ftueState.tutGrid[r][c];
          if (tier > 0) {
            const tile = buildFtueTileNode(tier);
            if (opts.pop && opts.pop[0] === r && opts.pop[1] === c) tile.classList.add('pop');
            cell.appendChild(tile);
          }
          (function(cc) { cell.onclick = function() { onCellTap(cc); }; })(c);
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
    ftueDrop(step);
  }

  // ===== FT.2 engine-driven resolution =====
  // The dropped piece + every merge/chain are resolved by the REAL engine
  // (findGroup + applyGravity, via withTutGrid). The boards are choreographed so
  // the outcome is guaranteed (drop / merge / chain×2), but the RULE is the
  // game's own — the demo can never drift from what the engine actually does.

  // Drop step.next into the hinted column: animate it falling to the lowest
  // empty row (real gravity destination), commit it to tutGrid, then resolve.
  function ftueDrop(step) {
    if (!ftueState || !ftueState.tutGrid) { celebrate(step); return; }
    const col = step.col;
    let landRow = -1;
    for (let r = 5; r >= 0; r--) { if (ftueState.tutGrid[r][col] === 0) { landRow = r; break; } }
    if (landRow < 0) { celebrate(step); return; }

    const topCell = ftueState.gridEl.querySelector('[data-row="0"][data-col="' + col + '"]');
    const dropTile = buildFtueTileNode(step.next);
    dropTile.classList.add('ftue-drop-anim');
    if (topCell) topCell.appendChild(dropTile);
    const cellH = topCell ? topCell.getBoundingClientRect().height : 0;
    requestAnimationFrame(function() { dropTile.style.transform = 'translateY(' + (cellH * landRow) + 'px)'; });

    setTimeout(function() {
      if (!ftueState) return;
      ftueState.tutGrid[landRow][col] = step.next;
      renderTutGrid(step.col, { pop: [landRow, col] });
      try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([6]); } catch (e) {}
      setTimeout(function() { ftueResolve(step, 0); }, 200);
    }, 380);
  }

  // Find the first mergeable group on the local board using the REAL engine
  // rule (findGroup + the shared MERGE_MIN_GROUP threshold).
  function ftueFindMergeable() {
    const g = ftueState.tutGrid;
    const min = ftueMinGroup();
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        const t = g[r][c];
        if (!t) continue;
        const group = withTutGrid(function() { return findGroup(r, c, t); });
        if (group && group.length >= min) return { group: group, tier: t };
      }
    }
    return null;
  }

  // Survivor = bottom-most cell of the group; tie-break toward the drop column.
  function ftuePickSurvivor(group, dropCol) {
    return group.slice().sort(function(a, b) {
      if (b[0] !== a[0]) return b[0] - a[0];
      return Math.abs(a[1] - dropCol) - Math.abs(b[1] - dropCol);
    })[0];
  }

  // Resolve merges/chains one link at a time, animating each, until the engine
  // reports no more groups. `chain` is the running merge count for this drop.
  function ftueResolve(step, chain) {
    if (!ftueState) return;
    const found = ftueFindMergeable();
    if (!found) { ftueFinalizeStep(step, chain); return; }

    chain += 1;
    const group = found.group;
    const resultTier = found.tier + 1;
    const survivor = ftuePickSurvivor(group, step.col);

    // Pop the matching tiles.
    group.forEach(function(rc) {
      const cell = ftueState.gridEl.querySelector('[data-row="' + rc[0] + '"][data-col="' + rc[1] + '"]');
      if (cell && cell.firstChild) cell.firstChild.classList.add('merge');
    });
    try {
      if (chain >= 2 && typeof soundChain === 'function') soundChain(chain);
      else if (typeof soundMerge === 'function') soundMerge(resultTier);
    } catch (e) {}

    setTimeout(function() {
      if (!ftueState) return;
      // Commit the merge to the board, then let the REAL gravity settle it.
      group.forEach(function(rc) { ftueState.tutGrid[rc[0]][rc[1]] = 0; });
      ftueState.tutGrid[survivor[0]][survivor[1]] = resultTier;
      withTutGrid(function() { applyGravity(); });
      // Find where the merged tile ended up after gravity, for the pop accent.
      renderTutGrid(step.col, { pop: ftueLowestOf(resultTier, survivor[1]) });
      if (chain >= 2) showChainBanner(chain);
      setTimeout(function() { ftueResolve(step, chain); }, 320);
    }, 260);
  }

  // Locate a tile of `tier` in column `col` (post-gravity) for the pop accent.
  function ftueLowestOf(tier, col) {
    const g = ftueState.tutGrid;
    for (let r = 5; r >= 0; r--) if (g[r][col] === tier) return [r, col];
    return null;
  }

  // Runtime drift guard: if the real engine produced a different number of
  // merges than the choreographed board expects, the engine rule changed out
  // from under the tutorial — warn loudly (dev console) so it's caught.
  function ftueFinalizeStep(step, chain) {
    if (step.expect != null && chain !== step.expect) {
      try { console.warn('[bloom][FTUE] step ' + (ftueState && ftueState.stepIdx) +
        ' expected ' + step.expect + ' merge(s) but the engine produced ' + chain +
        ' — MERGE rule may have drifted from the tutorial board.'); } catch (e) {}
    }
    celebrate(step);
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
