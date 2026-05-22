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
