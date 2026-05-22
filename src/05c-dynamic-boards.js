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
    // Streak status — if the player is on day ≥3 and HASN'T played
    // today, that's the highest-priority headline (loss aversion).
    var streakSt = (typeof getDynamicStreak === 'function') ? getDynamicStreak() : { count: 0, last: null };
    var streakDanger = (typeof isStreakInDanger === 'function') && isStreakInDanger();
    if (countEl) {
      // Default label
      var defaultLabel = boards.length + ' ' + (boards.length === 1 ? 'לוח זמין' : 'לוחות זמינים');
      var label;
      // Streak-in-danger overrides FOMO countdowns because losing a
      // streak is a stronger signal than missing a single special board.
      if (streakDanger) {
        label = '🔥 הרצף שלך בסכנה! ' + streakSt.count + ' ימים — שחק היום';
      } else if (focus) {
        var u = boardUrgency(focus);
        var endsIn = boardEndsInMs(focus);
        if (u === 'critical') {
          label = '🔥 ' + (focus.name || 'לוח') + ' מסתיים בעוד ' + fmtCountdown(endsIn);
        } else if (u === 'new') {
          label = '🆕 ' + (focus.name || 'לוח') + ' — חדש היום';
        } else if (u === 'soon') {
          label = '⏰ ' + (focus.name || 'לוח') + ' — נשאר ' + fmtCountdown(endsIn);
        } else if (streakSt.count >= 1) {
          // Calm-state streak surfacing — even without urgency, show
          // the streak so the player knows what they're protecting.
          label = '🔥 רצף ' + streakSt.count + (streakSt.count === 1 ? ' יום' : ' ימים') + ' · ' + defaultLabel;
        } else {
          label = defaultLabel;
        }
      } else if (streakSt.count >= 1) {
        label = '🔥 רצף ' + streakSt.count + (streakSt.count === 1 ? ' יום' : ' ימים') + ' · ' + defaultLabel;
      } else {
        label = defaultLabel;
      }
      countEl.textContent = label;
    }
    // Add urgency CSS class to the button so we can pulse it for critical.
    btn.classList.remove('fomo-critical', 'fomo-new', 'fomo-soon', 'fomo-streak-danger');
    if (streakDanger) {
      btn.classList.add('fomo-streak-danger');
    } else if (focus) {
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

  // ============================================================
  // Cross-board streak (Phase 5 — multi-day return loop)
  //
  // The streak counts CONSECUTIVE Asia/Jerusalem days on which the
  // player has finished at least one dynamic-board game. Missing a
  // day resets the streak (no auto-freeze in v1 — losing it on
  // purpose makes the regain feel earned).
  //
  // Milestones: 3, 7, 14, 30 days. Each milestone fires a celebratory
  // game-over banner + grants credits via earnCredits('event_gift').
  // The home button + picker header surface the running streak so
  // the player is reminded every time they return to the app.
  // ============================================================
  var DYN_STREAK_KEY = 'bloom_dyn_streak';
  var DYN_STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];
  var DYN_STREAK_REWARDS    = { 3: 50, 7: 150, 14: 300, 30: 600, 60: 1000, 100: 2000 };
  function getDynamicStreak() {
    try {
      var raw = localStorage.getItem(DYN_STREAK_KEY);
      if (!raw) return { count: 0, last: null, milestonesClaimed: [] };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.count !== 'number') return { count: 0, last: null, milestonesClaimed: [] };
      if (!Array.isArray(obj.milestonesClaimed)) obj.milestonesClaimed = [];
      return obj;
    } catch (e) {
      return { count: 0, last: null, milestonesClaimed: [] };
    }
  }
  function setDynamicStreak(obj) {
    try { localStorage.setItem(DYN_STREAK_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  // Returns YYYY-MM-DD in Asia/Jerusalem — same epoch as the daily seed.
  function streakToday() {
    if (typeof todayInIsrael === 'function') return todayInIsrael();
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function dayDiffDates(a, b) {
    if (!a || !b) return Infinity;
    var ad = new Date(a + 'T00:00:00');
    var bd = new Date(b + 'T00:00:00');
    return Math.round((bd - ad) / (24 * 60 * 60 * 1000));
  }
  // Called when player FINISHES a dynamic-board game. Returns a status
  // object: { streakBefore, streakAfter, milestoneHit, reward }.
  function recordDynamicStreakDay() {
    var st = getDynamicStreak();
    var today = streakToday();
    var before = st.count | 0;
    var milestoneHit = null;
    if (st.last === today) {
      // Already counted today — no-op, return current state.
      return { streakBefore: before, streakAfter: before, milestoneHit: null, alreadyToday: true };
    }
    var gap = dayDiffDates(st.last, today);
    if (st.last && gap === 1) {
      st.count = (st.count | 0) + 1;
    } else {
      // First play OR a day was skipped → reset to 1.
      st.count = 1;
      // Reset claimed milestones so the player can re-earn them on the next streak.
      st.milestonesClaimed = [];
    }
    st.last = today;
    setDynamicStreak(st);
    var after = st.count;
    // Milestone check — only the first time it's hit per streak.
    if (DYN_STREAK_MILESTONES.indexOf(after) !== -1 && st.milestonesClaimed.indexOf(after) === -1) {
      milestoneHit = after;
      st.milestonesClaimed = (st.milestonesClaimed || []).concat([after]);
      setDynamicStreak(st);
    }
    return {
      streakBefore: before,
      streakAfter: after,
      milestoneHit: milestoneHit,
      reward: milestoneHit ? DYN_STREAK_REWARDS[milestoneHit] : 0,
      alreadyToday: false
    };
  }
  // Returns the next milestone target above the current streak — used
  // for the "עוד N לבאדג׳" progress line.
  function nextStreakMilestone(currentCount) {
    for (var i = 0; i < DYN_STREAK_MILESTONES.length; i++) {
      if (DYN_STREAK_MILESTONES[i] > currentCount) return DYN_STREAK_MILESTONES[i];
    }
    return null;
  }
  // True when the player has a streak ≥3 and HASN'T played today (yet).
  // The streak is at risk — drives the loss-aversion FOMO banner.
  function isStreakInDanger() {
    var st = getDynamicStreak();
    if (!st || (st.count | 0) < 3) return false;
    return st.last !== streakToday();
  }
  window.getDynamicStreak       = getDynamicStreak;
  window.recordDynamicStreakDay = recordDynamicStreakDay;
  window.nextStreakMilestone    = nextStreakMilestone;
  window.isStreakInDanger       = isStreakInDanger;
  window.DYN_STREAK_REWARDS     = DYN_STREAK_REWARDS;

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
    // Streak banner — sits between the title and the list. Three states:
    //  - none / single day → muted "🌱 התחל רצף היום" pioneer copy
    //  - active streak, played today → calm "🔥 רצף N — שמרת אותו היום!"
    //  - active streak, NOT played today → red-orange "🔥 הרצף בסכנה!"
    var streakSt2 = (typeof getDynamicStreak === 'function') ? getDynamicStreak() : { count: 0, last: null };
    var streakDanger2 = (typeof isStreakInDanger === 'function') && isStreakInDanger();
    var streakBannerHtml = '';
    if (streakSt2.count >= 1) {
      var nextM = (typeof nextStreakMilestone === 'function') ? nextStreakMilestone(streakSt2.count) : null;
      var nextMRew = (window.DYN_STREAK_REWARDS || {})[nextM] || 0;
      var progressLine = nextM
        ? '<div class="dyn-streak-progress">עוד <strong>' + (nextM - streakSt2.count) + ' ימים</strong> לבאדג׳ ' + nextM + (nextMRew ? ' (+' + nextMRew + '💎)' : '') + '</div>'
        : '<div class="dyn-streak-progress">🏆 הרצף הארוך בהיסטוריה שלך!</div>';
      if (streakDanger2) {
        streakBannerHtml =
          '<div class="dyn-streak-banner dyn-streak-banner-danger">' +
            '<div class="dyn-streak-banner-icon">🔥</div>' +
            '<div class="dyn-streak-banner-body">' +
              '<div class="dyn-streak-banner-title">הרצף בסכנה! <strong>' + streakSt2.count + ' ימים</strong></div>' +
              '<div class="dyn-streak-banner-sub">שחק כל לוח דינמי עד חצות (אסיה/ירושלים) כדי לשמור עליו</div>' +
              progressLine +
            '</div>' +
          '</div>';
      } else {
        streakBannerHtml =
          '<div class="dyn-streak-banner dyn-streak-banner-safe">' +
            '<div class="dyn-streak-banner-icon">🔥</div>' +
            '<div class="dyn-streak-banner-body">' +
              '<div class="dyn-streak-banner-title">רצף <strong>' + streakSt2.count + ' ימים</strong> · שמרת אותו היום ✓</div>' +
              progressLine +
            '</div>' +
          '</div>';
      }
    } else {
      streakBannerHtml =
        '<div class="dyn-streak-banner dyn-streak-banner-pioneer">' +
          '<div class="dyn-streak-banner-icon">🌱</div>' +
          '<div class="dyn-streak-banner-body">' +
            '<div class="dyn-streak-banner-title">התחל רצף לוחות דינמיים היום</div>' +
            '<div class="dyn-streak-banner-sub">סיים לוח אחד כל יום · יום 3 = 50💎, יום 7 = 150💎, יום 14 = 300💎, יום 30 = 600💎</div>' +
          '</div>' +
        '</div>';
    }
    var overlay = document.createElement('div');
    overlay.id = 'dynamic-boards-picker';
    overlay.className = 'dyn-boards-overlay';
    overlay.innerHTML =
      '<div class="dyn-boards-modal">' +
        '<div class="dyn-boards-head">' +
          '<button class="dyn-boards-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-boards-title">🎯 לוחות דינמיים</div>' +
          '<div class="dyn-boards-sub">בחר לוח לסשן חד-פעמי. הניקוד נשמר בלוח המובילים של הלוח הזה.</div>' +
          streakBannerHtml +
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
          '<div class="dyn-boards-card-wrap">' +
            '<button class="dyn-boards-card' + classExtra + '" data-board-id="' + b.id + '" data-action="play"' + endsAttr + startsAttr + extraStyle + '>' +
              '<div class="dyn-boards-card-icon">' + badge.icon + '</div>' +
              '<div class="dyn-boards-card-body">' +
                '<div class="dyn-boards-card-name">' + escapeHtml(b.name || 'לוח') + '</div>' +
                '<div class="dyn-boards-card-type">' + badge.label + (desc && b.type === 'multipliers' ? ' · ' + desc : '') + '</div>' +
                chipsHtml +
                '<div class="dyn-boards-card-fomo" data-fomo-host="1">' + renderFomoBadge(b) + '</div>' +
              '</div>' +
              '<div class="dyn-boards-card-cta">שחק ←</div>' +
            '</button>' +
            // Trophy button — independent action, opens the per-board top-50.
            '<button class="dyn-boards-trophy-btn" data-board-id="' + b.id + '" data-action="trophy" aria-label="לוח מובילים">🏆</button>' +
          '</div>';
      }
      listEl.innerHTML = html;
      listEl.addEventListener('click', function(e) {
        // Trophy button is checked FIRST so it doesn't fall through to play.
        var trophyBtn = e.target.closest('.dyn-boards-trophy-btn');
        if (trophyBtn) {
          var tbId = parseInt(trophyBtn.getAttribute('data-board-id'), 10);
          var tBoard = boards.find(function(x) { return x.id === tbId; });
          if (tBoard) showBoardLeaderboard(tBoard);
          return;
        }
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

  // ============================================================
  // Per-board leaderboard modal — top 50 + my rank with explicit
  // gap-to-next-rank target. Sits on top of the picker (doesn't
  // close it) so the player can flip between boards quickly.
  // Live refresh every 30s while open.
  // ============================================================
  var _boardLbRefreshHandle = null;
  var _boardLbCurrentBoard = null;
  function closeBoardLeaderboard() {
    var el = document.getElementById('board-lb-overlay');
    if (el) el.remove();
    if (_boardLbRefreshHandle) { clearInterval(_boardLbRefreshHandle); _boardLbRefreshHandle = null; }
    _boardLbCurrentBoard = null;
  }
  function showBoardLeaderboard(board) {
    if (!board || !board.id) return;
    closeBoardLeaderboard();
    _boardLbCurrentBoard = board;
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var theme = THEME_LABELS[board.definition && board.definition.theme_id];
    var shape = SHAPE_LABELS[board.definition && board.definition.shape_id];
    var hero = '';
    if (theme) hero = theme.icon + ' ' + theme.label;
    if (shape) hero += (hero ? ' · ' : '') + shape.icon + ' ' + shape.label;
    var overlay = document.createElement('div');
    overlay.id = 'board-lb-overlay';
    overlay.className = 'board-lb-overlay';
    overlay.innerHTML =
      '<div class="board-lb-modal">' +
        '<div class="board-lb-head">' +
          '<button class="board-lb-close" aria-label="סגור">✕</button>' +
          '<div class="board-lb-title">🏆 לוח מובילים</div>' +
          '<div class="board-lb-board-name">' + escapeHtml(board.name || 'לוח') + (hero ? ' <span class="board-lb-hero-meta">· ' + hero + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="board-lb-body" id="board-lb-body">' +
          '<div class="board-lb-loading">⏳ טוען מובילים…</div>' +
        '</div>' +
        '<div class="board-lb-foot">' +
          '<button class="board-lb-back">← חזור</button>' +
          '<button class="board-lb-play">▶ שחק עכשיו</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.board-lb-close').onclick = closeBoardLeaderboard;
    overlay.querySelector('.board-lb-back').onclick = closeBoardLeaderboard;
    overlay.querySelector('.board-lb-play').onclick = function() {
      var b = _boardLbCurrentBoard;
      closeBoardLeaderboard();
      if (b) startDynamicBoard(b);
    };
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeBoardLeaderboard();
    });
    function paint(data) {
      var body = document.getElementById('board-lb-body');
      if (!body || _boardLbCurrentBoard !== board) return;
      var list = (data && data.list) || [];
      var total = (data && data.total) | 0;
      var myRank = (data && data.myRank) | 0;
      var myScore = (data && data.myScore) | 0;
      if (!list.length) {
        body.innerHTML = '<div class="board-lb-empty">🌱 עדיין אין מובילים<br><span class="board-lb-empty-sub">היה הראשון להתעלף עם השיא!</span></div>';
        return;
      }
      var rows = '';
      var leaderScore = list[0].score;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var rank = i + 1;
        var rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
        var youCls = p.you ? ' board-lb-row-you' : '';
        var topCls = rank <= 3 ? (' board-lb-row-top board-lb-row-top-' + rank) : '';
        var flagHtml = '<span class="board-lb-flag"></span>';
        if (p.country) {
          try {
            var cc = String(p.country).toUpperCase();
            if (cc.length === 2) {
              flagHtml = '<span class="board-lb-flag">' +
                String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65) +
                String.fromCodePoint(0x1F1E6 + cc.charCodeAt(1) - 65) +
                '</span>';
            }
          } catch (e) {}
        }
        rows +=
          '<div class="board-lb-row' + youCls + topCls + '">' +
            '<span class="board-lb-rank">' + rankBadge + '</span>' +
            flagHtml +
            '<span class="board-lb-name">' + escapeHtml(p.name || 'אנונימי') + (p.you ? ' (אתה)' : '') + '</span>' +
            '<span class="board-lb-score">' + (p.score || 0).toLocaleString() + '</span>' +
          '</div>';
      }
      // Footer "your rank" pill — only when player has a score AND isn't
      // already on the visible top-50.
      var myRankHtml = '';
      if (myRank && myScore && myRank > list.length) {
        // Off-list (>50). Show their position separately.
        myRankHtml =
          '<div class="board-lb-row board-lb-row-you board-lb-row-off">' +
            '<span class="board-lb-rank">#' + myRank + '</span>' +
            '<span class="board-lb-flag"></span>' +
            '<span class="board-lb-name">אתה</span>' +
            '<span class="board-lb-score">' + myScore.toLocaleString() + '</span>' +
          '</div>';
      }
      // Persistent "beat the next player" target — strongest single hook.
      // Computed against the row directly above the player.
      var nextTargetHtml = '';
      if (myScore && myRank && myRank > 1) {
        var aboveScore = 0, aboveName = '';
        if (myRank <= list.length && list[myRank - 2]) {
          aboveScore = list[myRank - 2].score;
          aboveName = list[myRank - 2].name;
        }
        if (aboveScore > myScore) {
          var gap = aboveScore - myScore;
          nextTargetHtml =
            '<div class="board-lb-next-target">' +
              '⚔️ עוד <strong>' + gap.toLocaleString() + '</strong> נקודות כדי לעקוף את <strong>' + escapeHtml(aboveName || 'הבא בתור') + '</strong>' +
            '</div>';
        }
      } else if (myScore && myRank === 1) {
        nextTargetHtml = '<div class="board-lb-next-target board-lb-next-target-king">👑 אתה המוביל! · המקום השני: ' + (list[1] ? list[1].score.toLocaleString() : '—') + '</div>';
      }
      var totalHtml = '<div class="board-lb-total">סה״כ ' + total + ' שחקנים · המוביל: ' + (leaderScore || 0).toLocaleString() + '</div>';
      body.innerHTML = totalHtml + nextTargetHtml + '<div class="board-lb-list">' + rows + myRankHtml + '</div>';
    }
    function load() {
      var url = '/api/boards/' + board.id + '/leaderboard?limit=50' + (deviceId ? '&deviceId=' + encodeURIComponent(deviceId) : '');
      fetch(url, { cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; })
        .then(function(d) { paint(d); });
    }
    load();
    // 30s live refresh while open. Cleared in closeBoardLeaderboard.
    _boardLbRefreshHandle = setInterval(load, 30 * 1000);
  }
  window.showBoardLeaderboard = showBoardLeaderboard;
  window.closeBoardLeaderboard = closeBoardLeaderboard;

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
