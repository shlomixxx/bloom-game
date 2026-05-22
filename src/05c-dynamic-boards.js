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

  // Called by the audio module after /api/boards/available resolves.
  // Toggles the home button's visibility. Safe to call when home isn't
  // mounted yet — it just no-ops.
  function updateDynamicBoardsButton() {
    var btn = document.getElementById('home-v2-boards');
    if (!btn) return;
    var boards = (window._availableBoards && window._availableBoards.length) || 0;
    if (boards > 0) {
      btn.style.display = '';
      var countEl = btn.querySelector('.home-v2-boards-count');
      if (countEl) countEl.textContent = boards + ' ' + (boards === 1 ? 'לוח זמין' : 'לוחות זמינים');
    } else {
      btn.style.display = 'none';
    }
  }

  // Expose so the audio-module fetch can poke us.
  window.updateDynamicBoardsButton = updateDynamicBoardsButton;

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
        var chipsHtml = chips.length ? ('<div class="dyn-boards-card-chips">' + chips.join('') + '</div>') : '';
        html +=
          '<button class="dyn-boards-card" data-board-id="' + b.id + '"' + extraStyle + '>' +
            '<div class="dyn-boards-card-icon">' + badge.icon + '</div>' +
            '<div class="dyn-boards-card-body">' +
              '<div class="dyn-boards-card-name">' + escapeHtml(b.name || 'לוח') + '</div>' +
              '<div class="dyn-boards-card-type">' + badge.label + (desc && b.type === 'multipliers' ? ' · ' + desc : '') + '</div>' +
              chipsHtml +
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
