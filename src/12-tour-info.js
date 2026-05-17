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
  async function revealNextTier(finalTier) {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    const myToken = ++revealToken;
    const cells = bar.querySelectorAll('.tier-cell');
    // Keep the 'active' highlight on the chosen tier throughout the cycle —
    // a fast player needs to know what they're about to drop, even mid-anim.
    cells.forEach(function(c) {
      const tier = parseInt(c.getAttribute('data-tier'), 10);
      if (tier !== finalTier) c.classList.remove('active');
      c.classList.remove('cycling');
    });
    const sweep = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4];
    sweep.push(finalTier);
    const startMs = 28;
    const endMs = 95;
    for (let i = 0; i < sweep.length; i++) {
      // If a newer roll started, abandon this cycle — highlightNextTier
      // (called synchronously by rollNextPiece) has already snapped the bar
      // to the new chosen tier.
      if (myToken !== revealToken) return;
      cells.forEach(function(c) { c.classList.remove('cycling'); });
      const cell = bar.querySelector('.tier-cell[data-tier="' + sweep[i] + '"]');
      if (cell) cell.classList.add('cycling');
      const t = sweep.length > 1 ? i / (sweep.length - 1) : 1;
      const dur = Math.round(startMs + (endMs - startMs) * (t * t));
      await sleep(dur);
    }
    if (myToken !== revealToken) return;
    cells.forEach(function(c) { c.classList.remove('cycling'); });
    const finalCell = bar.querySelector('.tier-cell[data-tier="' + finalTier + '"]');
    if (finalCell) finalCell.classList.add('active');
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
    document.getElementById('best').textContent = best.toLocaleString();
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
      var continuePrice = getEventNum('continue_price', 200);
      var canContinue = !opts.alreadyPlayed && !usedContinue && score > 5000 && mode !== 'challenge';
      var continueHtml = '';
      if (canContinue) {
        continueHtml =
          '<div style="display:flex;gap:8px;justify-content:center;margin:10px 0">' +
            '<button class="btn" id="continue-ad" style="background:#2E8B6F;color:#FFF;padding:10px 18px;font-size:13px;border-radius:12px;font-weight:700">▶️ צפה בפרסומת והמשך</button>' +
            '<button class="btn" id="continue-pay" style="background:transparent;border:1px solid #BA7517;color:#BA7517;padding:10px 14px;font-size:12px;border-radius:12px;font-weight:600">' + continuePrice + '💎 המשך</button>' +
          '</div>';
      }
      // Watch ad for credits (always available)
      var adCredits = getEventNum('ad_watch_reward', 30);
      var watchAdHtml = '<button class="btn" id="watch-ad-btn" style="background:transparent;border:1px solid #2E8B6F;color:#2E8B6F;padding:8px 16px;font-size:12px;border-radius:10px;margin-top:6px;font-weight:600">▶️ צפה בפרסומת וקבל ' + adCredits + '💎</button>';

      wrap.innerHTML =
        '<div class="overlay">' +
          '<div class="over-title">' + title + '</div>' +
          '<div class="over-score">' + score.toLocaleString() + '</div>' +
          '<div class="over-sub">הגעת ל' + getActiveTiers()[highestTier].name + ' · ' + highestTier + '/' + MAX_TIER + ' דרגות</div>' +
          (dailyRank ? '<div class="lb-rank-pill">המקום שלך היום: #' + dailyRank + '</div>' : '') +
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
            if (n >= 2) return '<div style="margin:8px 0;font-size:13px;color:#BA7517;font-weight:600">🔥 ' + n + ' ימים ברצף! חזור מחר ל-<strong>' + tomorrowReward + ' 💎</strong> בונוס</div>';
            return '<div style="margin:8px 0;font-size:13px;color:#6F6E68">💪 חזור מחר לאתגר יומי + <strong style="color:#BA7517">' + tomorrowReward + ' 💎</strong> בונוס יומי 🔥</div>';
          })() +
          (showCountdown ? '<div class="countdown" id="countdown"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>אתגר חדש בעוד <span id="countdown-val">--:--:--</span></span></div>' : '') +
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
        });
      };
      if (continuePayBtn) continuePayBtn.onclick = function() {
        var price = getEventNum('continue_price', 200);
        if ((parseInt(document.getElementById('tile-shop-stat').textContent.replace(/[^\d]/g,''),10)||0) < price) {
          this.textContent = 'אין מספיק 💎';
          this.disabled = true;
          return;
        }
        this.disabled = true; this.textContent = '⏳...';
        fetch(API_BASE + '/api/player/spend', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId },
          body: JSON.stringify({ deviceId: deviceId, amount: price, reason: 'continue' })
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
          } else {
            continuePayBtn.textContent = 'אין מספיק 💎';
          }
        }).catch(function() { continuePayBtn.textContent = 'שגיאה'; });
      };

      // Watch ad for free credits
      var watchAdBtn = document.getElementById('watch-ad-btn');
      if (watchAdBtn) watchAdBtn.onclick = function() {
        this.disabled = true; this.textContent = '⏳ טוען פרסומת...';
        var self = this;
        simulateAdWatch(function() {
          var reward = getEventNum('ad_watch_reward', 30);
          earnCredits('event_gift', { amount: reward });
          self.textContent = '✓ קיבלת ' + reward + '💎';
          self.style.background = '#2E8B6F'; self.style.color = '#FFF';
          fetchPlayerCode();
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
    for (let r = 0; r < getBoardRows(); r++) {
      for (let c = 0; c < getBoardCols(); c++) {
        const t = grid[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (t > 0) {
          cell.classList.add('filled');
          const ti = getActiveTiers()[t];
          cell.style.background = ti.bg;
          cell.style.color = ti.fg;
          cell.innerHTML = ti.svg;
          if (opts.appearing && opts.appearing[0] === r && opts.appearing[1] === c) cell.classList.add('appearing');
          if (opts.merging && opts.merging[0] === r && opts.merging[1] === c) cell.classList.add('merging');
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

