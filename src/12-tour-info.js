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
    // Mount on body — grid-wrap is display:none while home is showing,
    // which would otherwise make this info modal invisible.
    const wrap = document.body;
    if (document.getElementById('info-modal')) return;
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
    // AB.1 — continuous "above best" delta pill. After the one-shot
    // showNewBestBanner fires, the player keeps climbing past their
    // pre-game record but gets NO continuing feedback. This pill
    // sits above the #best stat and updates live with "+247" — every
    // drop above the record adds visible momentum. Pure pull from
    // Suika/Royal Match where seeing the delta climb in real-time is
    // the dopamine pump that drives "one more drop".
    if (!opts.over && prevBest > 0 && score > prevBest && !skinTrialMode) {
      var bestParent = bestEl && bestEl.parentNode;
      if (bestParent) {
        var pill = document.getElementById('above-best-pill');
        if (!pill) {
          pill = document.createElement('div');
          pill.id = 'above-best-pill';
          pill.className = 'above-best-pill';
          bestParent.appendChild(pill);
          bestParent.classList.add('has-above-best');
        }
        var delta = score - prevBest;
        // Compact format for big numbers so the pill stays narrow.
        var formatted;
        if (delta >= 1000000) formatted = (delta / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        else if (delta >= 1000) formatted = (delta / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        else formatted = delta.toLocaleString();
        pill.textContent = '+' + formatted;
        // Threshold-driven amplification — at +50K/+100K the pill gets
        // a louder variant so the player feels successive milestones
        // ON TOP of beating their best.
        pill.classList.remove('above-best-pill-hot', 'above-best-pill-huge');
        if (delta >= 100000) pill.classList.add('above-best-pill-huge');
        else if (delta >= 25000) pill.classList.add('above-best-pill-hot');
      }
    } else {
      var stalePill = document.getElementById('above-best-pill');
      if (stalePill) {
        if (stalePill.parentNode) stalePill.parentNode.classList.remove('has-above-best');
        stalePill.remove();
      }
    }
    buildTierBar();
    if (opts.over) {
      highlightNextTier(highestTier || nextPiece);
    } else {
      highlightNextTier(nextPiece);
    }
    // DG.1 — refresh danger-mode state after every render. Cheap: walks
    // 24 cells max. The function is a no-op when the danger state hasn't
    // changed, so no sound/buzz spam during sustained tension.
    if (!opts.over && typeof updateDangerMode === 'function') {
      try { updateDangerMode(); } catch (e) {}
    }
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
      // Combined achievements get combined headlines — a player who broke
      // their best AND reached crown deserves both surfaced, not collapsed.
      // Crown (tier 8) is THE ultimate goal; it outranks score thresholds.
      if (opts.isNewBest && highestTier >= 8) title = '👑🎉 שיא חדש + כתר!';
      else if (opts.isNewBest && highestTier >= 7) title = '💎🎉 שיא חדש + יהלום!';
      else if (opts.isNewBest) title = '🎉 שיא אישי חדש!';
      else if (mode === 'daily' && opts.alreadyPlayed) title = '✅ סיימת את האתגר היומי';
      else if (highestTier >= 8) title = '👑 הגעת לכתר!';
      else if (highestTier >= 7) title = '💎 הגעת ליהלום!';
      else if (score >= 100000) title = '🔥 מטורף! ' + score.toLocaleString();
      else if (score >= 50000) title = '💪 משחק אדיר!';
      else if (highestTier >= 6) title = '⭐ הגעת לכוכב!';
      else if (score >= 20000) title = '⭐ יפה מאוד!';
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
      // TA.1 — block "continue" on restored over screens. The grid is
      // empty after restore (we only restored visual score+tier), so
      // continuing would hand the player a free fresh game with the
      // prior score preserved — clear exploit. Force a fresh start
      // via the "משחק חדש" button instead.
      var continueBlockedByMode = (mode === 'daily' && opts.alreadyPlayed) || mode === 'challenge' || !!opts.restored;
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
      // Rank pill with total players so #23 doesn't read as "23 out of nowhere".
      // Podium (top 3) gets a louder gold/silver/bronze variant — the strongest
      // status-flex moment in the entire game; not surfacing it loses the snap.
      var rankPillHtml = '';
      if (dailyRank) {
        var rankPillExtra = '';
        var rankPillPrefix = '🏆';
        var rankPillClass = 'lb-rank-pill';
        if (dailyRank === 1) {
          rankPillPrefix = '👑';
          rankPillExtra = ' מקום ראשון!';
          rankPillClass += ' lb-rank-pill-gold';
        } else if (dailyRank === 2) {
          rankPillPrefix = '🥈';
          rankPillClass += ' lb-rank-pill-silver';
        } else if (dailyRank === 3) {
          rankPillPrefix = '🥉';
          rankPillClass += ' lb-rank-pill-bronze';
        }
        var rankPillBody = rankPillPrefix + ' מקום <strong>#' + dailyRank + '</strong>' + rankPillExtra;
        if (dailyTotal && dailyTotal > 0 && dailyRank !== 1) {
          rankPillBody += ' מתוך ' + dailyTotal.toLocaleString();
        }
        rankPillHtml = '<div class="' + rankPillClass + '">' + rankPillBody + '</div>';
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

      // TA.1 — Restored banner. Renders when the over screen was rebuilt
      // from a refresh-survival snapshot rather than a freshly-finished
      // game. Gives the player a clear "this is your last game" anchor
      // plus an explicit fresh-restart CTA so they don't feel trapped.
      var restoredBannerHtml = '';
      if (opts.restored) {
        restoredBannerHtml =
          '<div class="over-restored-banner">' +
            '<div class="over-restored-icon">💾</div>' +
            '<div class="over-restored-body">' +
              '<div class="over-restored-title">המשחק שלך נשמר</div>' +
              '<div class="over-restored-sub">חזרת אחרי רענון · הציון והשיא נשמרו</div>' +
            '</div>' +
            '<button class="over-restored-new btn" id="over-restored-new">🎮 משחק חדש</button>' +
          '</div>';
      }
      wrap.innerHTML =
        '<div class="overlay">' +
          restoredBannerHtml +
          '<div class="over-title">' + title + '</div>' +
          '<div class="over-score">' + score.toLocaleString() + '</div>' +
          '<div class="over-sub">הגעת ל' + getActiveTiers()[highestTier].name + ' · ' + highestTier + '/' + MAX_TIER + ' דרגות</div>' +
          rankPillHtml +
          claimNameHtml +
          bestDeltaHtml +
          boardBestHtml +
          (opts.boardLeader ? '<div class="over-board-rank" id="over-board-rank-host">⏳ מחשב דירוג בלוח…</div>' : '') +
          (function() {
            // Stage 15 — Daily Special banner. Gold-pink pulsing card that
            // tells the player "you grabbed today's biggest reward". Only
            // renders for dynamic mode where boardId matches today's special.
            try {
              var ds = window._dailySpecial;
              if (!ds || !ds.enabled || !ds.id) return '';
              var br = window._activeDynamicBoard;
              if (!br || br.id !== ds.id) return '';
              var xpL = (ds.xpMult % 1 === 0) ? ds.xpMult + '×' : ds.xpMult.toFixed(1) + '×';
              var rwL = (ds.rewardMult % 1 === 0) ? ds.rewardMult + '×' : ds.rewardMult.toFixed(1) + '×';
              return '<div class="over-daily-special-banner">' +
                '<div class="over-daily-special-icon">🌟</div>' +
                '<div class="over-daily-special-body">' +
                  '<div class="over-daily-special-title">שיחקת את הלוח של היום!</div>' +
                  '<div class="over-daily-special-perks">קיבלת <strong>' + xpL + ' XP</strong> + <strong>' + rwL + ' פרסים</strong> על המשחק הזה</div>' +
                '</div>' +
              '</div>';
            } catch (e) { return ''; }
          })() +
          (function() {
            var sr = opts.streakResult;
            if (!sr || sr.alreadyToday) return '';
            var after = sr.streakAfter | 0;
            if (after < 1) return '';
            // Special variant — the freeze auto-applied (saved the streak).
            // Loss-aversion psychology: this is the moment the player
            // realises the 200💎 they spent was worth it. Highlight loud.
            var freezeBanner = '';
            if (sr.freezeUsed) {
              freezeBanner = '<div class="over-streak-banner over-streak-banner-freeze">' +
                '🛡 הקפאת רצף הצילה אותך!' +
                '<div class="over-streak-progress">איבדת יום אבל הרצף ממשיך</div>' +
              '</div>';
            }
            if (sr.milestoneHit) {
              return freezeBanner + '<div class="over-streak-banner over-streak-banner-milestone">' +
                '🎉 רצף לוחות דינמיים: <strong>' + after + ' ימים!</strong>' +
                '<div class="over-streak-reward">+' + (sr.reward || 0) + '💎 בונוס באדג׳!</div>' +
              '</div>';
            }
            var nextMile = (typeof nextStreakMilestone === 'function') ? nextStreakMilestone(after) : null;
            var prog = '';
            if (nextMile) {
              var gap = nextMile - after;
              var reward = (window.DYN_STREAK_REWARDS || {})[nextMile] || 0;
              prog = '<div class="over-streak-progress">עוד <strong>' + gap + ' ימים</strong> לבאדג׳ ' + nextMile + (reward ? ' (+' + reward + '💎)' : '') + '</div>';
            }
            return freezeBanner + '<div class="over-streak-banner">' +
              '🔥 רצף לוחות דינמיים: <strong>' + after + ' ימים</strong>' +
              prog +
            '</div>';
          })() +
          (function() {
            // Achievement unlocks — gold-pink pulsing card per unlock.
            // Stacked vertically when multiple fire at once (rare but
            // possible: e.g. "score 10K" + "score 50K" on a big run).
            var unlocks = opts.achUnlocks || [];
            if (!unlocks.length) return '';
            var html = '';
            for (var i = 0; i < unlocks.length; i++) {
              var u = unlocks[i];
              html +=
                '<div class="over-ach-banner">' +
                  '<div class="over-ach-icon">' + (u.icon || '🏅') + '</div>' +
                  '<div class="over-ach-body">' +
                    '<div class="over-ach-title">הישג חדש! <strong>' + escapeHtml(u.label || '') + '</strong></div>' +
                    '<div class="over-ach-reward">+' + (u.reward || 0) + '💎</div>' +
                  '</div>' +
                '</div>';
            }
            return html;
          })() +
          (function() {
            // Daily quest completions — green pulsing card per quest
            // completed THIS game. Sends the player to claim via the
            // picker → quests modal.
            var qcomp = opts.questsCompleted || [];
            if (!qcomp.length) return '';
            var html = '';
            for (var i = 0; i < qcomp.length; i++) {
              var q = qcomp[i];
              html +=
                '<div class="over-quest-banner">' +
                  '<div class="over-quest-icon">🎯</div>' +
                  '<div class="over-quest-body">' +
                    '<div class="over-quest-title">משימה הושלמה! <strong>' + escapeHtml(q.label || '') + '</strong></div>' +
                    '<div class="over-quest-reward">🎁 ' + (q.reward || 0) + '💎 ממתין במודאל המשימות</div>' +
                  '</div>' +
                '</div>';
            }
            return html;
          })() +
          rankTierHtml +
          rivalHtml +
          continueHtml +
          // PRIMARY CTA — right after score
          '<button class="btn over-again-btn" id="again">' + againLabel + '</button>' +
          // Stage 32 — Replay Share button. Only when score crosses threshold.
          // Pulsing pink-purple to draw the eye. Most addictive viral surface.
          (function() {
            try {
              if (typeof shouldOfferReplayShare === 'function' && shouldOfferReplayShare(score)) {
                return '<button class="btn over-replay-share-btn" id="over-replay-share">📤 שתף את הניצחון שלך</button>';
              }
            } catch (e) {}
            return '';
          })() +
          watchAdHtml +
          (function() {
            // Daily login streak applies to every game mode (any game played
            // today counts toward the streak). Showing the FOMO banner only on
            // daily/practice was leaving contest/duel/dynamic finishers with
            // zero retention nudge — they'd close the game with a 7-day
            // streak and no reminder to come back tomorrow.
            if (mode === 'challenge') return '';
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
          // AD.6 — "next reward" countdown. Gives every non-duel game-over a
          // concrete return-time hook ("come back in HH:MM:SS for your daily
          // rewards"). Anchored to Israel midnight (spin + login-cal + daily-
          // deal + daily-special all reset then). Skipped when the daily
          // countdown above already shows (daily mode) to avoid two timers.
          // Admin-gated by next_reward_countdown_enabled; ticker wired after mount.
          ((!showCountdown && !window._duelMode) ? (function() {
            try {
              if (typeof gameConfig === 'object' && gameConfig && gameConfig.next_reward_countdown_enabled === 'false') return '';
              if (typeof msUntilNextIsraelMidnight !== 'function' || typeof formatCountdown !== 'function') return '';
              return '<div class="over-next-reward" id="over-next-reward">' +
                '<span class="onr-icon">🎁</span>' +
                '<span class="onr-text">הפרסים היומיים הבאים בעוד <strong id="onr-countdown">' +
                  formatCountdown(msUntilNextIsraelMidnight()) + '</strong></span>' +
                '</div>';
            } catch (e) { return ''; }
          })() : '') +
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
        else if (mode === 'dynamic' && window._activeDynamicBoard) init('dynamic', { fresh: true });
        else init('practice', { fresh: true });
      };
      // TA.4 — Count-up animation on the over-score. The score jumps
      // from 0 to its final value with an ease-out cubic curve over
      // ~1.2s. Skipped for restored over-screens (the player already
      // saw the number before the refresh — re-animating would feel
      // like the game is gaslighting them about their score) and for
      // the "already-played-today" daily case (same logic).
      try {
        var __overScoreEl = document.getElementById('over-score-num') ||
                            (function() {
                              var el = document.querySelector('.over-score');
                              if (el && !el.id) el.id = 'over-score-num';
                              return el;
                            })();
        if (__overScoreEl && !opts.restored && !opts.alreadyPlayed && (score | 0) > 0) {
          var __finalScore = score | 0;
          // Render 0 immediately so the eye catches the climb from
          // the start rather than seeing the final number flash and
          // then re-animate down.
          __overScoreEl.textContent = '0';
          var __animStart = 0;
          var __animDur = 1200;
          var __animTick = function(now) {
            if (!__animStart) __animStart = now;
            var t = Math.min(1, (now - __animStart) / __animDur);
            // ease-out cubic
            var eased = 1 - Math.pow(1 - t, 3);
            __overScoreEl.textContent = Math.floor(__finalScore * eased).toLocaleString();
            if (t < 1) requestAnimationFrame(__animTick);
          };
          // Small delay (~120ms) so the over-screen entrance settles
          // before the digits start climbing — feels more deliberate.
          setTimeout(function() { requestAnimationFrame(__animTick); }, 120);
        }
      } catch (e) {}
      // TA.3 — Personal-best celebration. The existing Stage 32 already
      // mounts a 📤 share button when the score crosses its threshold;
      // this block adds the missing dopamine pop that the audit called
      // out: confetti shower + stronger sound when isNewBest is true.
      // Skipped for restored over-screens (the player already saw the
      // celebration once — replaying it would feel hollow), bot games,
      // and skin trials. Lands ~250ms after the count-up starts so the
      // confetti drops over the climbing digits.
      try {
        if (opts.isNewBest && !opts.restored && !opts.alreadyPlayed &&
            !window.__bloomBotActive && !skinTrialMode &&
            typeof showConfetti === 'function') {
          setTimeout(function() {
            try { showConfetti(48); } catch (e) {}
            try { if (typeof soundMilestone === 'function') soundMilestone(7); } catch (e) {}
            try { if (typeof buzz === 'function') buzz([40, 30, 60, 30, 90]); } catch (e) {}
          }, 250);
        }
      } catch (e) {}
      // TA.1 — Restored game-over: explicit "🎮 משחק חדש" CTA in the
      // restored banner. Clears the snapshot so a click can't re-enter
      // the restored over screen, then inits a fresh game in the same
      // mode so a refresh-survival doesn't shove the player into a
      // different mode than they were playing.
      var restoredNewBtn = document.getElementById('over-restored-new');
      if (restoredNewBtn) {
        restoredNewBtn.onclick = function() {
          try { if (typeof window.__bloomClearLastGame === 'function') window.__bloomClearLastGame(); } catch (e) {}
          if (mode === 'contest') init('contest', { fresh: true });
          else if (mode === 'dynamic') init('dynamic', { fresh: true });
          else init('practice', { fresh: true });
        };
      }
      // Stage 32 — Replay share button (only present when score crossed threshold).
      var replayBtn = document.getElementById('over-replay-share');
      if (replayBtn && typeof showReplayShareModal === 'function') {
        replayBtn.onclick = function() {
          try {
            var playerName = '';
            try { playerName = (localStorage.getItem(NAME_KEY) || '').trim(); } catch (e) {}
            showReplayShareModal({
              score: score,
              tier: highestTier,
              mode: mode,
              isNewBest: !!opts.isNewBest,
              playerName: playerName
            });
          } catch (e) {}
        };
      }

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
        var btn = this;
        // TA.2 — server-side dedup before the ad runs. Closes the
        // refresh-spam exploit where a player could keep re-claiming
        // the continue by reloading the over screen. `usedContinue`
        // resets every init() so the client-only flag wasn't enough.
        var gid = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : null;
        if (!gid) {
          // Old gameId helper not loaded — bail safely so the player
          // sees an error instead of a silent half-broken flow.
          btn.textContent = 'שגיאה';
          btn.disabled = true;
          return;
        }
        btn.disabled = true; btn.textContent = '⏳ טוען פרסומת...';
        fetch(API_BASE + '/api/player/continue-ad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, 'X-Device-Token': deviceToken },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, gameId: gid })
        }).then(function(r) { return r.json(); })
          .catch(function() { return null; })
          .then(function(d) {
            if (!d || !d.ok) {
              var reason = (d && d.reason) || 'error';
              if (reason === 'already_continued') {
                btn.textContent = '✓ כבר השתמשת';
              } else if (reason === 'daily_cap') {
                btn.textContent = 'הגעת ל-' + (d.dailyCap || 3) + ' המשכים היום';
              } else if (reason === 'rate_limited') {
                var sec = Math.ceil(((d && d.cooldownMs) || 30000) / 1000);
                btn.textContent = '⏰ עוד ' + sec + ' שניות';
              } else {
                btn.textContent = 'לא ניתן כעת';
              }
              return;
            }
            // Server gave the green light → run the actual ad + apply
            // the row-clear effect. usedContinue still gates client
            // re-clicks in the same session for instant feedback.
            simulateAdWatch(function() {
              usedContinue = true;
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
        var watchFn = (typeof window.simulatePromoWatch === 'function') ? window.simulatePromoWatch : simulateAdWatch;
        watchFn(function() {
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
      try { startNextRewardCountdown(); } catch (e) {}
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

