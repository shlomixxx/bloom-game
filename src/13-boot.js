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
        body: JSON.stringify({ deviceId: deviceId })
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

  // Duel notifications: scan for pending challenges / unread results on boot,
  // then re-check every 60s while the tab is visible. The scan is cheap (one
  // GET) and de-duped via sessionStorage so it can't spam toasts.
  // SKIP entirely in spectator mode (?watch=...) — admin shouldn't see duel banners.
  var isSpectator = new URLSearchParams(window.location.search).has('watch');
  if (!isSpectator && typeof window.__bloomCheckIncomingDuels === 'function') {
    setTimeout(window.__bloomCheckIncomingDuels, 1500); // delay so deviceId is ready
    setInterval(function() {
      if (typeof window.__bloomCheckIncomingDuels === 'function') {
        window.__bloomCheckIncomingDuels();
      }
    }, 60000);
    // Also re-check when the tab regains focus — covers the case where a
    // duel result lands while the player is in another app.
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && typeof window.__bloomCheckIncomingDuels === 'function') {
        window.__bloomCheckIncomingDuels();
      }
    });
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
    showHome();
  }

  // Persist mode on every init so we can restore on refresh.
  // (the save is inside init() itself — see 'bloom_last_mode' setItem)

  // Visit ping — fire-and-forget. Lets the admin dashboard distinguish
  // "visited but didn't play" from "didn't visit at all" (bounce rate).
  try {
    fetch(API_BASE + '/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
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
