  // ============================================================
  // TC.4 — Orphaned skin-trial recovery (May 2026)
  // ============================================================
  // If a player started a trial and closed the tab before the 60s
  // timer fired (or right around the 60s mark, where the timer
  // might not have a chance to run), ACTIVE_SKIN_KEY in localStorage
  // is still set to the trial skin — meaning they keep using it
  // free. We catch this at boot: any persisted SKIN_TRIAL_DEADLINE
  // means the trial wasn't cleanly closed. Revert ACTIVE_SKIN_KEY
  // to whatever SKIN_TRIAL_ORIGINAL_KEY remembers (or 'classic' as
  // a safe default), unless the player has since legitimately
  // purchased that skin (the ownedSkins array has the truth).
  try {
    var __trialEndRaw = safeGet('bloom_skin_trial_end', null);
    if (__trialEndRaw) {
      var __trialEnd = parseInt(__trialEndRaw, 10) || 0;
      // Add a small grace (10s) past the deadline to avoid racing the
      // legitimate auto-end pathway when the user reloads right at
      // the moment the timer fires.
      var __expired = !__trialEnd || (Date.now() > __trialEnd + 10 * 1000);
      if (__expired) {
        var __currentSkin = safeGet('bloom_active_skin', 'classic') || 'classic';
        var __ownedRaw = safeGet('bloom_owned_skins', '[]');
        var __owned = [];
        try { __owned = JSON.parse(__ownedRaw) || []; } catch (e) { __owned = []; }
        // Only revert if the player doesn't legitimately own this skin
        // (e.g. they bought it during the trial through a separate flow).
        if (__currentSkin !== 'classic' && __owned.indexOf(__currentSkin) === -1) {
          var __original = safeGet('bloom_skin_trial_original', 'classic') || 'classic';
          // Defensive: if "original" happens to be the same trial skin
          // or also unowned, fall back to 'classic'.
          if (__original !== 'classic' && __owned.indexOf(__original) === -1) {
            __original = 'classic';
          }
          try { localStorage.setItem('bloom_active_skin', __original); } catch (e) {}
          // Re-sync the in-memory active skin so the next render uses it.
          try { activeSkinId = __original; if (typeof syncBodySkinClass === 'function') syncBodySkinClass(); } catch (e) {}
        }
        safeRemove('bloom_skin_trial_end');
        safeRemove('bloom_skin_trial_original');
      }
    }
  } catch (e) {}

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
        token: deviceToken,
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
      // Use sendBeacon when available so the request survives the tab
      // closing (regular fetch() is killed when the page unloads, and
      // the admin live view would keep showing the dead player until
      // the 60s server-side TTL expired).
      if (navigator.sendBeacon) {
        var payload = new Blob([JSON.stringify({ deviceId: deviceId, token: deviceToken })],
                               { type: 'application/json' });
        navigator.sendBeacon(API_BASE + '/api/heartbeat/end', payload);
      } else {
        fetch(API_BASE + '/api/heartbeat/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken }),
          keepalive: true
        }).catch(function() {});
      }
    } catch(e) {}
  };

  // TC.3 — beforeunload + pagehide fire endHeartbeat so a closed tab
  // disappears from admin's live view within seconds instead of sitting
  // there for the full 60s server TTL. beforeunload doesn't fire on
  // iOS Safari mobile (browser quirk); pagehide is the cross-platform
  // catch-all. Only fires when actually in a game (grid initialized,
  // not game-over, not bot) — closing the tab from home doesn't need
  // teardown since no heartbeat was ever sent.
  function __teardownHeartbeatOnUnload() {
    try {
      if (window.__bloomBotActive) return;
      if (window.__bloomGameOver) return;
      if (!Array.isArray(grid) || grid.length === 0) return;
      window.endHeartbeat();
    } catch (e) {}
  }
  window.addEventListener('beforeunload', __teardownHeartbeatOnUnload);
  window.addEventListener('pagehide', __teardownHeartbeatOnUnload);

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

  // ============================================================
  // SOCIAL NOTIFICATIONS REFRESH LOOP — instant in-app delivery
  // ============================================================
  // Unified poller that scans BOTH /api/duels/mine AND
  // /api/player/gifts/inbox so every social event (duel invite,
  // result, decline, expire, gift) surfaces inside ~10 seconds
  // while the app is foregrounded. Previously duels polled every
  // 60s and gifts polled exactly once on home open — meaning a
  // gift sent mid-game was invisible to the recipient until they
  // navigated back to home.
  //
  // Triggered on:
  //   (1) boot (after 1.5s warmup so deviceId is ready)
  //   (2) setInterval every 10s while the tab is visible
  //   (3) visibilitychange → visible
  //   (4) window.focus (some browsers fire one event but not the other)
  //
  // True device-level push (closed-app notifications) requires
  // PWA web push + VAPID keys + iOS Add-to-Home-Screen install —
  // tracked separately. This loop covers the in-app case at the
  // sub-perception threshold.
  var isSpectator = new URLSearchParams(window.location.search).has('watch');
  if (!isSpectator) {
    function refreshSocial() {
      if (document.visibilityState === 'hidden') return;
      try {
        if (typeof window.__bloomCheckIncomingDuels === 'function') {
          window.__bloomCheckIncomingDuels();
        }
      } catch (e) { console.warn('[social] duel check failed', e); }
      try {
        if (typeof window.__bloomPollGiftInbox === 'function') {
          window.__bloomPollGiftInbox();
        }
      } catch (e) { console.warn('[social] gift check failed', e); }
    }
    setTimeout(refreshSocial, 1500);
    setInterval(refreshSocial, 10000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') refreshSocial();
    });
    window.addEventListener('focus', refreshSocial);
  }

  // Restore last active mode on refresh so players don't lose context.
  // Default to 'daily' for first-time visitors.
  var LAST_MODE_KEY = 'bloom_last_mode';
  var savedMode = localStorage.getItem(LAST_MODE_KEY) || 'daily';
  // Challenge can't be resumed, contest needs fresh fetch — safe to restore daily/practice.
  if (savedMode !== 'daily' && savedMode !== 'practice') savedMode = 'daily';

  // TA.1 — Game-Over Persistence on boot. If the player's last action
  // was a game-over in practice/dynamic/contest within the TTL window,
  // override savedMode + rehydrate the per-mode context (board, contest
  // code) so init() can paint the over screen instead of dropping the
  // player into a fresh game. Engine state is NOT restored — just the
  // visual game-over with the final score.
  var __lastGameForBoot = null;
  try {
    if (typeof window.__bloomLoadLastGame === 'function') {
      __lastGameForBoot = window.__bloomLoadLastGame();
    }
  } catch (e) { __lastGameForBoot = null; }
  if (__lastGameForBoot && (__lastGameForBoot.mode === 'practice' ||
                            __lastGameForBoot.mode === 'dynamic' ||
                            __lastGameForBoot.mode === 'contest')) {
    savedMode = __lastGameForBoot.mode;
    // Dynamic mode needs window._activeDynamicBoard set BEFORE init() so
    // the restore branch can match boardId. We seed a minimal placeholder
    // (id + name) — the full definition is only needed when the player
    // starts a fresh game, and we fetch it lazily on that path.
    if (__lastGameForBoot.mode === 'dynamic' && __lastGameForBoot.boardId) {
      window._activeDynamicBoard = {
        id: __lastGameForBoot.boardId,
        name: __lastGameForBoot.boardName || 'לוח דינמי',
        definition: {},
        _placeholder: true  // marker so click-to-restart can re-fetch
      };
      // Fire-and-forget upgrade: pull the full board so the over screen's
      // "New Game" button has a real definition by the time it's clicked.
      try {
        if (typeof fetch === 'function') {
          fetch('/api/boards/available').then(function(r) { return r.json(); })
            .then(function(d) {
              if (!d || !d.boards) return;
              for (var i = 0; i < d.boards.length; i++) {
                if (d.boards[i].id === __lastGameForBoot.boardId) {
                  window._activeDynamicBoard = d.boards[i];
                  break;
                }
              }
            }).catch(function() {});
        }
      } catch (e) {}
    }
  }

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

  // (B7 tier-bar toggle removed May 2026. Bar permanently visible.)

  // ════════════════════════════════════════════════════════════
  // Game-UI Compaction (May 2026) — Approach B + Rollback path.
  // Spec: docs/superpowers/specs/2026-05-28-game-ui-compaction-design.md
  //
  // Body class `legacy-game-ui` reverts everything to pre-compaction.
  // Trigger paths:
  //   1. localStorage `bloom_game_ui_legacy` = '1' (persistent)
  //   2. URL `?ui=legacy` (one-time test, doesn't write LS)
  // Toggled via the ⋯ menu → "🎨 גירסה ישנה" link.
  // ════════════════════════════════════════════════════════════
  (function applyGameUiVariant() {
    var legacy = false;
    try {
      if (localStorage.getItem('bloom_game_ui_legacy') === '1') legacy = true;
      var qp = new URLSearchParams(window.location.search);
      if (qp.get('ui') === 'legacy') legacy = true;
    } catch (e) {}
    if (legacy) document.body.classList.add('legacy-game-ui');
    // Ensure the new-ui-hint exists in legacy mode (mounted once).
    if (legacy && !document.querySelector('.new-ui-hint')) {
      var hint = document.createElement('div');
      hint.className = 'new-ui-hint';
      hint.textContent = '✨ נסה את העיצוב החדש →';
      hint.onclick = function() {
        try { localStorage.removeItem('bloom_game_ui_legacy'); } catch (e) {}
        location.reload();
      };
      document.body.appendChild(hint);
    }
  })();

  // ────────────────────────────────────────────────────────────
  // Mode-chip wiring: clicking it opens the existing mode picker.
  // ────────────────────────────────────────────────────────────
  var __modeChipEl = document.getElementById('mode-chip');
  if (__modeChipEl) {
    __modeChipEl.addEventListener('click', function() {
      if (typeof window.showModePicker === 'function') {
        try { window.showModePicker(); } catch (e) {}
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // ⋯ menu popover: 4 items (home / achievements / info / reset)
  // + a rollback toggle "🎨 גירסה ישנה" / "✨ עיצוב חדש".
  // ────────────────────────────────────────────────────────────
  var __topMoreBtn = document.getElementById('topmore');
  var __topMenuOpen = null;
  function closeTopMenu() {
    if (__topMenuOpen) {
      try { __topMenuOpen.remove(); } catch (e) {}
      __topMenuOpen = null;
      if (__topMoreBtn) __topMoreBtn.setAttribute('aria-expanded', 'false');
    }
    document.removeEventListener('click', __onTopMenuOutside, true);
    document.removeEventListener('keydown', __onTopMenuKey, true);
  }
  function __onTopMenuOutside(e) {
    if (!__topMenuOpen) return;
    if (__topMenuOpen.contains(e.target)) return;
    if (__topMoreBtn && __topMoreBtn.contains(e.target)) return;
    closeTopMenu();
  }
  function __onTopMenuKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeTopMenu(); }
  }
  function buildTopMenu(anchorRect) {
    var pop = document.createElement('div');
    pop.className = 'top-menu-popover';
    pop.setAttribute('role', 'menu');
    var items = [
      { id: 'home',     icon: '🏠', label: 'חזרה לבית',  click: function() { closeTopMenu(); var b = document.getElementById('home-btn'); if (b) b.click(); else if (typeof showHome === 'function') showHome(); } },
      { id: 'ach',      icon: '🏅', label: 'הישגים',     click: function() { closeTopMenu(); var b = document.getElementById('achievements'); if (b) b.click(); } },
      { id: 'info',     icon: 'ℹ️', label: 'מידע על ניקוד', click: function() { closeTopMenu(); var b = document.getElementById('info'); if (b) b.click(); } },
      { id: 'reset',    icon: '🔄', label: 'התחל מחדש',  click: function() { closeTopMenu(); var b = document.getElementById('reset'); if (b) b.click(); } }
    ];
    items.forEach(function(it) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'top-menu-item';
      btn.setAttribute('role', 'menuitem');
      var ic = document.createElement('span'); ic.className = 'top-menu-item-icon'; ic.textContent = it.icon;
      var tx = document.createElement('span'); tx.className = 'top-menu-item-text'; tx.textContent = it.label;
      btn.appendChild(ic);
      btn.appendChild(tx);
      btn.onclick = it.click;
      pop.appendChild(btn);
    });
    // Separator + rollback toggle.
    var sep = document.createElement('div'); sep.className = 'top-menu-sep'; pop.appendChild(sep);
    var rollback = document.createElement('button');
    rollback.type = 'button';
    rollback.className = 'top-menu-item';
    rollback.setAttribute('role', 'menuitem');
    var rIcon = document.createElement('span'); rIcon.className = 'top-menu-item-icon';
    var rText = document.createElement('span'); rText.className = 'top-menu-item-text';
    var isLegacy = document.body.classList.contains('legacy-game-ui');
    rIcon.textContent = isLegacy ? '✨' : '🎨';
    rText.textContent = isLegacy ? 'עיצוב חדש' : 'גירסה ישנה';
    rollback.appendChild(rIcon);
    rollback.appendChild(rText);
    rollback.onclick = function() {
      try {
        if (isLegacy) localStorage.removeItem('bloom_game_ui_legacy');
        else localStorage.setItem('bloom_game_ui_legacy', '1');
      } catch (e) {}
      closeTopMenu();
      location.reload();
    };
    pop.appendChild(rollback);
    // Position: anchored under the ⋯ button, right-aligned within viewport.
    document.body.appendChild(pop);
    var pr = pop.getBoundingClientRect();
    var ar = anchorRect;
    var top = ar.bottom + 6;
    var left = Math.min(window.innerWidth - pr.width - 8, ar.left);
    if (left < 8) left = 8;
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(left) + 'px';
    return pop;
  }
  if (__topMoreBtn) {
    __topMoreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (__topMenuOpen) { closeTopMenu(); return; }
      var rect = __topMoreBtn.getBoundingClientRect();
      __topMenuOpen = buildTopMenu(rect);
      __topMoreBtn.setAttribute('aria-expanded', 'true');
      setTimeout(function() {
        document.addEventListener('click', __onTopMenuOutside, true);
        document.addEventListener('keydown', __onTopMenuKey, true);
      }, 0);
    });
  }

  // Show home only for genuine first-timers or if the player was idle.
  // Returning mid-game players go straight to their game.
  //
  // BUG-FIX BT.1 (May 28 2026): the previous condition skipped home for
  // ANY returning practice player (`hasHistory` true + `savedMode === 'practice'`)
  // — but if they had no in-progress game to resume, they landed on an
  // empty in-game UI with NO bottom nav (the nav is gated by data-active-tab).
  // The player saw game chrome with score=0, empty grid, no way to navigate
  // home except via the buried ⋯ menu. After deep-audit reproduction this
  // is the #1 boot UX bug. New rule: show home for ANYONE without an
  // active game to resume (TA.1 last-game snapshot OR paused practice
  // mid-game state). Players WITH active state still resume directly.
  var hasHistory = loadGamesPlayed() > 0;
  var hasPracticeState = !!loadPracticeGameState();
  var hasInProgressGame = !!__lastGameForBoot ||
                          (savedMode === 'practice' && hasPracticeState);
  if (!hasInProgressGame) {
    // §1.1 — first-time players see the 3-step FTUE before the home
    // screen. Returning players (anyone with the bloom_ftue_done flag,
    // or anyone with games_played > 0) skip straight to home.
    if (typeof ftueShouldRun === 'function' && ftueShouldRun() && !hasHistory) {
      // Defer FTUE init to the next macrotask so the rest of the IIFE
      // can finish initializing the let/const/var bindings declared in
      // 15-ftue.js (FTUE_KEY, FTUE_STEPS, ftueState, etc.). 13-boot.js
      // is concatenated BEFORE 15-ftue.js, so at this point those
      // declarations exist as `undefined` (hoisted var) or in TDZ
      // (let/const). Without this defer, startFTUE → renderStep reads
      // FTUE_STEPS[0] on `undefined` and crashes the boot.
      setTimeout(function() { startFTUE(function() { showHome(); }); }, 0);
    } else {
      // CRITICAL FIX (May 2026): also defer the direct showHome call.
      // Files 17-45 (each its own IIFE) expose their maybeShow* helpers
      // via window.* at the END of their own eval. boot.js (file 13)
      // runs BEFORE files 14-99 evaluate, so a synchronous showHome()
      // call here triggers showHomeV2 → typeof maybeShowSpinTile checks
      // → fall back to window lookup → window.maybeShowSpinTile is NOT
      // YET SET (file 32 hasn't run) → typeof returns 'undefined' → if
      // check fails → no setTimeout scheduled → tile NEVER mounts.
      // Result: home renders with only the static elements (boards,
      // season pass, weekly, jackpot) and NONE of the dynamic tiles
      // (bank, spin, pet, etc.) — exactly the "features disappeared"
      // symptom the user reported.
      // Fix: setTimeout(0) defers showHome to the next macrotask, by
      // which point the entire IIFE has finished evaluating and every
      // window.maybeShow* assignment has landed.
      setTimeout(function() { showHome(); }, 0);
    }
  }

  // Persist mode on every init so we can restore on refresh.
  // (the save is inside init() itself — see 'bloom_last_mode' setItem)

  // T2.3 — drain any queued score submissions that failed to send last
  // session (offline / mobile data flake). Runs after a short delay so
  // the home/game mounts first. Self-toasts on success.
  setTimeout(function() {
    try {
      if (typeof window.__bloomDrainScoreQueue === 'function') window.__bloomDrainScoreQueue();
    } catch (e) {}
  }, 2500);

  // Visit ping — fire-and-forget. Lets the admin dashboard distinguish
  // "visited but didn't play" from "didn't visit at all" (bounce rate).
  try {
    fetch(API_BASE + '/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
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
      // Restart the CURRENT mode/board without navigating away — for the bot's
      // "current screen" mode so it never jumps to a different board. For
      // dynamic it re-applies window._activeDynamicBoard; daily/practice replay.
      restartCurrent: function() {
        try { init(mode || 'practice', { fresh: true }); return true; }
        catch (e) { try { init('practice'); } catch (_) {} return false; }
      },
      // The live in-game event (💣 bomb / ⭐ star / 🎁 gift / 🔥 fever / ❄️ freeze)
      // currently on the board — { type, row, col, emoji } or null. Triggers
      // when a tile is dropped into its COLUMN (see 14-events.js checkEventTrigger).
      getActiveEvent: function() { return window.__bloomActiveEvent || null; },
      // Bot extras (May 2026) — let the bot drive mode switching + read
      // dynamic-board context without depending on internal IIFE state.
      setMode: function(nextMode) {
        try { init(nextMode || 'practice', { fresh: true }); return true; }
        catch (e) { return false; }
      },
      getMode: function() { return mode; },
      getActiveBoard: function() {
        // window._activeSpecialBoard carries multipliers + cells + theme_id
        // + shape_id (when applicable). Bot uses this to score-bias columns.
        return window._activeSpecialBoard || null;
      },
      getAvailableBoards: function() {
        return Array.isArray(window._availableBoards) ? window._availableBoards.slice() : [];
      },
      startDynamicBoard: function(boardId) {
        // Delegate to the canonical startDynamicBoard() in 05c-dynamic-boards.js
        // which handles lives gate + event system + audio + picker close. The
        // bot just needs to resolve the id → full board object.
        var list = Array.isArray(window._availableBoards) ? window._availableBoards : [];
        var board = list.find(function(b) { return String(b.id) === String(boardId); });
        if (!board) return false;
        try { startDynamicBoard(board); return true; }
        catch (e) { return false; }
      },
    };
  }

  // Always-on dev hooks for Dynamic Boards testing — exposed in plain prod
  // so admins/developers can experiment from devtools without ?bot=1.
  // Not a security risk: setColumnMultipliers is client-side only and the
  // server score-submit path runs its own anti-cheat (drops-vs-score + token).
  window.__bloomDebug = window.__bloomDebug || {};
  window.__bloomDebug.setColumnMultipliers = function(arr) {
    var ok = setColumnMultipliers(arr);
    if (ok && typeof render === 'function') render();
    return ok;
  };
  window.__bloomDebug.getColumnMultipliers = function() { return getColumnMultipliers(); };
  window.__bloomDebug.restart = function(mode) { init(mode || 'practice'); };

  // GO.1 — public deep-link entry. The inbox panel + push action URLs
  // need a clean way to jump into a specific mode without going through
  // home. Whitelisted modes only — a stray ?ref= injection can't slip
  // a malicious string into init().
  window.__bloomStartMode = function(modeName, opts) {
    var allowed = { daily: 1, practice: 1, contest: 1, dynamic: 1, challenge: 1 };
    if (!allowed[modeName]) return false;
    try { init(modeName, opts || { fresh: true }); return true; }
    catch (e) { return false; }
  };

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

  // ============================================================
  // 🚨 Global JS error capture — surface to admin 🚨 תקלות tab
  // ============================================================
  // Any uncaught exception or unhandled promise rejection from any
  // module ends up here. We dedup per-session by (msg, source) so a
  // tight loop doesn't spam the server.
  var _jsErrSeen = {};
  function _reportJsError(kind, msg, source, line, col, stack) {
    try {
      if (!window.__bloomReportIssue) return;
      var sig = String(msg || '').slice(0, 80) + '@' + String(source || '').slice(-40) + ':' + (line || '');
      if (_jsErrSeen[sig]) return;
      _jsErrSeen[sig] = Date.now();
      // Cap to 25 unique errors/session so a runaway page doesn't flood
      if (Object.keys(_jsErrSeen).length > 25) return;
      window.__bloomReportIssue({
        kind: kind,
        severity: 'medium',
        title: String(msg || 'JS error').slice(0, 200),
        detail: 'src=' + (source || '?') + ':' + (line || 0) + ':' + (col || 0) +
                (stack ? '\n' + String(stack).slice(0, 600) : ''),
        context: { url: location.href, ua: (navigator.userAgent || '').slice(0, 200) }
      });
    } catch (e) {}
  }
  window.addEventListener('error', function(ev) {
    try {
      var msg = ev && ev.message;
      // Ignore ResizeObserver chrome noise + script-tag load failures we can't act on
      if (!msg || /ResizeObserver|Script error/.test(msg)) return;
      _reportJsError('js_error', msg, ev.filename, ev.lineno, ev.colno, ev.error && ev.error.stack);
    } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function(ev) {
    try {
      var r = ev && ev.reason;
      var msg = r && (r.message || String(r)) || 'unhandled rejection';
      var stack = r && r.stack;
      _reportJsError('js_rejection', msg, '', 0, 0, stack);
    } catch (e) {}
  });
