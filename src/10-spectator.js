  function openSpectatorPicker(entryFrom) {
    if (!activeContestCode) return;
    pendingSpectatorEntry = entryFrom || 'game-over';
    // Anchor the modal inside whatever is currently visible: contest-screen
    // overlays grid-wrap (higher z-index), so attaching there keeps the modal
    // visible when the picker is opened mid-game from the contest leaderboard.
    const host = document.getElementById('contest-screen') || document.getElementById('grid-wrap');
    if (!host) return;
    let modal = document.getElementById('spectator-picker-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'spectator-picker-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="spm-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="info-title">צפייה במשחקים חיים</div>' +
        '<div class="info-sub">בחר שחקן שמשחק עכשיו ותעבור לצפייה חיה</div>' +
        '<div id="spm-body"><div class="spectator-picker-empty">טוען…</div></div>' +
      '</div>';
    host.appendChild(modal);
    document.getElementById('spm-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    refreshSpectatorPicker();
    // UX audit 2026-06-02 — the picker used to fetch once and then go stale
    // (a player who just started a game never appeared). Re-poll every 4s
    // while the modal is open; self-clears when it closes.
    if (window._spmRefreshTimer) { clearInterval(window._spmRefreshTimer); window._spmRefreshTimer = null; }
    window._spmRefreshTimer = setInterval(function() {
      if (!document.getElementById('spectator-picker-modal')) {
        clearInterval(window._spmRefreshTimer); window._spmRefreshTimer = null; return;
      }
      refreshSpectatorPicker();
    }, 4000);
  }

  async function refreshSpectatorPicker() {
    const body = document.getElementById('spm-body');
    if (!body) return;
    const data = await fetchContest(activeContestCode);
    if (!body.isConnected) return; // modal closed mid-fetch
    if (!data || !Array.isArray(data.players)) {
      body.innerHTML = '<div class="spectator-picker-empty">שגיאת חיבור. נסה שוב.</div>';
      return;
    }
    const live = data.players.filter(function(p) {
      return p.liveScore !== null && p.deviceId && p.deviceId !== deviceId;
    });
    live.sort(function(a, b) { return (b.liveScore | 0) - (a.liveScore | 0); });
    if (!live.length) {
      body.innerHTML = '<div class="spectator-picker-empty">אין כרגע שחקנים פעילים בתחרות.<br>נסה שוב בעוד כמה רגעים.</div>';
      return;
    }
    const rows = live.map(function(p) {
      const tierObj = (getActiveTiers()[p.liveTier | 0] || getActiveTiers()[p.tier | 0]);
      const tierBadge = tierObj
        ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '">' + tierObj.svg + '</div>'
        : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
      return '<button class="spectator-picker-row" data-target="' + escapeHtml(p.deviceId) + '" data-name="' + escapeHtml(p.name || '') + '">' +
        tierBadge +
        '<div style="flex:1;min-width:0">' +
          '<div class="spectator-picker-name">' + renderAvatarHtml(p.deviceId || p.name, 'sm') + escapeHtml(p.name || 'אנונימי') + '</div>' +
          '<div class="spectator-picker-meta">' + (p.score | 0).toLocaleString() + ' נצברו · ' + (p.tier | 0 ? 'עד ' + (getActiveTiers()[p.tier | 0] && getActiveTiers()[p.tier | 0].name || '') : 'משחק ראשון') + '</div>' +
        '</div>' +
        '<div class="spectator-picker-score">+' + (p.liveScore | 0).toLocaleString() + '</div>' +
      '</button>';
    }).join('');
    body.innerHTML = '<div class="spectator-picker-list">' + rows + '</div>';
    body.querySelectorAll('.spectator-picker-row').forEach(function(btn) {
      btn.onclick = function() {
        const target = btn.getAttribute('data-target');
        const name   = btn.getAttribute('data-name');
        const modal = document.getElementById('spectator-picker-modal');
        if (modal) modal.remove();
        startSpectator(target, name, pendingSpectatorEntry);
      };
    });
  }

  function startSpectator(targetDeviceId, fallbackName, entryFrom) {
    if (!activeContestCode || !targetDeviceId) return;
    if (spectatorSession) stopSpectator(null);
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    const from = entryFrom || 'game-over';
    // If the spectate starts mid-game, snapshot the current run so we can
    // resume it cleanly on exit. The grid-wrap is about to be replaced.
    if (from !== 'game-over' && !contestSubmitted && mode === 'contest') {
      saveContestGameState();
    }
    // Tear down our own contest-screen overlay (if it's open behind the picker)
    // so the spectator view has the stage to itself.
    if (from === 'contest-screen') {
      const el = document.getElementById('contest-screen');
      if (el) { stopContestRefresh(); el.remove(); }
    }
    // Stop heartbeating my OWN game while I'm watching someone else — my
    // contest_live_state row will fade within 10s on the server side.
    stopLivePush();
    // Tear down the in-game contest HUD too — it shows MY rank + targets
    // which is irrelevant (and visually distracting) while I'm spectating
    // someone else. stopSpectator() will re-mount it on exit if we're
    // resuming a mid-game session.
    if (typeof stopContestHud === 'function') stopContestHud();
    spectatorSession = {
      code: activeContestCode,
      targetDeviceId: targetDeviceId,
      name: fallbackName || 'שחקן',
      lastScore: 0,
      missCount: 0,
      lastSnap: null,
      pollTimer: null,
      heartbeatTimer: null,
      entryFrom: from
    };
    removeAudienceBadge();
    renderSpectatorView();
    // Initial heartbeat + first snapshot tick.
    spectatorHeartbeat();
    spectatorTick(true);
    spectatorSession.pollTimer = setInterval(spectatorTick, 1000);
    spectatorSession.heartbeatTimer = setInterval(spectatorHeartbeat, 5000);
    // UX audit 2026-06-02 — the spectator view replaces grid-wrap (it is not a
    // modal), so the global ESC/back handler never matched it and ESC did
    // nothing. Wire a dedicated ESC-to-exit, torn down in stopSpectator.
    spectatorSession._escHandler = function(e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && spectatorSession && !document.getElementById('spectator-picker-modal')) {
        stopSpectator('exit');
      }
    };
    document.addEventListener('keydown', spectatorSession._escHandler);
  }

  async function spectatorHeartbeat() {
    const s = spectatorSession;
    if (!s) return;
    const myName = getContestDisplayName(s.code) || 'אנונימי';
    // If the spectator entered mid-game (paused their run), the score they
    // expose to the watched player is their *current in-progress* score —
    // that's more truthful than the last completed game's score.
    let myScore = getLastFinalScore(s.code);
    const midGamePause = s.entryFrom !== 'game-over'
      && mode === 'contest'
      && !contestSubmitted
      && Array.isArray(grid)
      && grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (midGamePause) myScore = score | 0;
    try {
      await fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) + '/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          watcherDeviceId: deviceId,
          watcherName: myName,
          watcherLastScore: myScore,
          targetDeviceId: s.targetDeviceId
        })
      });
    } catch (e) { /* silent */ }
  }

  async function spectatorTick(forceRender) {
    const s = spectatorSession;
    if (!s) return;
    let res;
    try {
      res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) +
        '/live-state/' + encodeURIComponent(s.targetDeviceId));
    } catch (e) {
      // Bug #9 fix — a network blip used to freeze the spectator view
      // silently. Count it toward the reconnecting indicator, but NEVER
      // auto-close on a network error (the game may still be live; the
      // watcher just lost connectivity).
      handleSpectatorMiss(s, true);
      return;
    }
    if (!spectatorSession || spectatorSession !== s) return;
    if (res.status === 404) {
      // 404 = server has no FRESH live-state (>10s stale). That can mean
      // the game ENDED, or the target's heartbeat briefly gapped (tab
      // backgrounded). The old code closed after 2 ticks (≈2s) — way too
      // aggressive. Now: show "reconnecting" after a few misses, and only
      // declare the game over after a sustained run of server 404s.
      handleSpectatorMiss(s, false);
      return;
    }
    if (!res.ok) return;
    let data;
    try { data = await res.json(); } catch (e) { return; }
    if (!spectatorSession || spectatorSession !== s) return;
    // Recovered — clear any reconnecting banner.
    if (s.missCount > 0) clearSpectatorReconnecting(s);
    s.missCount = 0;
    if (data && data.live) {
      s.lastSnap = data.live;
      if (data.live.name) s.name = data.live.name;
      renderSpectatorView();
    } else if (forceRender) {
      renderSpectatorView();
    }
  }

  // Centralized miss handling. networkErr=true means the fetch threw
  // (connectivity) → only show the reconnecting banner, never close. A 404
  // (server confirms no fresh state) can eventually mean "game ended", so
  // after a sustained run we close gracefully.
  function handleSpectatorMiss(s, networkErr) {
    s.missCount = (s.missCount || 0) + 1;
    if (s.missCount >= 3) showSpectatorReconnecting(s);
    if (!networkErr && s.missCount >= 8) {
      clearSpectatorReconnecting(s);
      showSpectatorToast('המשחק הסתיים');
      stopSpectator(true);
    }
  }

  function showSpectatorReconnecting(s) {
    if (s && s._reconnectShown) return;
    if (s) s._reconnectShown = true;
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    if (document.getElementById('spectator-reconnect')) return;
    const b = document.createElement('div');
    b.id = 'spectator-reconnect';
    b.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.78);color:#FAC775;padding:6px 14px;border-radius:14px;font-size:13px;font-weight:700;z-index:50;direction:rtl;pointer-events:none';
    b.textContent = '🔄 מתחבר מחדש…';
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(b);
  }

  function clearSpectatorReconnecting(s) {
    if (s) s._reconnectShown = false;
    const b = document.getElementById('spectator-reconnect');
    if (b) b.remove();
  }

  // UX audit 2026-06-02 — the watcher already exposes their own score to the
  // server; surface it here as the competitive "me vs them" hook (the single
  // biggest voyeuristic lever). Returns the watcher's reference score (their
  // current in-progress score if mid-game-paused, else last completed game).
  function spectatorMyRef() {
    const s = spectatorSession;
    if (!s) return 0;
    let myRef = getLastFinalScore(s.code) | 0;
    const midGamePause = s.entryFrom !== 'game-over' && mode === 'contest' && !contestSubmitted
      && Array.isArray(grid) && grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (midGamePause) myRef = score | 0;
    return myRef | 0;
  }
  function spectatorVsHtml() {
    const s = spectatorSession; if (!s) return '';
    const myRef = spectatorMyRef();
    if (myRef <= 0) return '';   // no comparison when the watcher has no score
    const theirs = s.lastSnap ? (s.lastSnap.score | 0) : 0;
    const delta = theirs - myRef;
    const cls = delta > 0 ? 'spec-vs-behind' : delta < 0 ? 'spec-vs-ahead' : 'spec-vs-tie';
    const mid = delta > 0 ? '🔥 הוא לפניך ב-' + delta.toLocaleString()
      : delta < 0 ? '💪 אתה לפניו ב-' + (-delta).toLocaleString() : '⚔️ שווים!';
    return '<div class="spectator-vs ' + cls + '" id="spectator-vs">' +
      '<span class="spec-vs-me">אתה ' + myRef.toLocaleString() + '</span>' +
      '<span class="spec-vs-delta">' + mid + '</span>' +
      '<span class="spec-vs-them">הם ' + theirs.toLocaleString() + '</span>' +
    '</div>';
  }
  function updateSpectatorVs() {
    const el = document.getElementById('spectator-vs');
    if (!el) return;
    const s = spectatorSession; if (!s) return;
    const myRef = spectatorMyRef();
    const theirs = s.lastSnap ? (s.lastSnap.score | 0) : 0;
    const delta = theirs - myRef;
    el.className = 'spectator-vs ' + (delta > 0 ? 'spec-vs-behind' : delta < 0 ? 'spec-vs-ahead' : 'spec-vs-tie');
    el.innerHTML =
      '<span class="spec-vs-me">אתה ' + myRef.toLocaleString() + '</span>' +
      '<span class="spec-vs-delta">' + (delta > 0 ? '🔥 הוא לפניך ב-' + delta.toLocaleString()
        : delta < 0 ? '💪 אתה לפניו ב-' + (-delta).toLocaleString() : '⚔️ שווים!') + '</span>' +
      '<span class="spec-vs-them">הם ' + theirs.toLocaleString() + '</span>';
  }
  // Tier-ladder micro-narrative (Task #33) — extracted so it can repaint each tick.
  function spectatorTierLadderInner(tier) {
    const maxT = (typeof MAX_TIER !== 'undefined') ? MAX_TIER : 8;
    let dots = '';
    for (let t = 1; t <= maxT; t++) {
      const on = t <= tier;
      const isNext = (t === tier + 1);
      const to = getActiveTiers()[t];
      const emoji = (to && to.emoji) ? to.emoji : '·';
      dots += '<span class="spec-tier-dot' + (on ? ' on' : '') + (isNext ? ' next' : '') + '">' + emoji + '</span>';
    }
    const toGo = Math.max(0, maxT - tier);
    const label = tier >= maxT ? '👑 הגיע/ה לכתר!'
      : tier <= 0 ? 'מתחיל/ה לטפס…'
      : ('דרגה ' + tier + ' · עוד ' + toGo + ' לכתר 👑');
    return '<div class="spec-tier-dots">' + dots + '</div>' +
           '<div class="spec-tier-label">' + label + '</div>';
  }
  function updateSpectatorTierLadder(tier) {
    const el = document.getElementById('spectator-tier-ladder');
    if (el) el.innerHTML = spectatorTierLadderInner(tier);
  }
  // Smooth count-up so the score climbs instead of snapping (UX audit).
  function animateSpectatorScore(el, target) {
    target = target | 0;
    const from = parseInt(el.dataset.val || '0', 10) || 0;
    el.dataset.val = String(target);
    if (from === target) { el.textContent = target.toLocaleString(); return; }
    const start = (window.performance && performance.now) ? performance.now() : 0;
    const dur = 380;
    function step(now) {
      const t = Math.min(1, ((now || 0) - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(from + (target - from) * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString();
    }
    requestAnimationFrame(step);
  }
  // In-place tick update — diffs the grid cells (appear/merge/clear anims),
  // counts up the score, repaints tier badge/name/ladder + the vs strip. No
  // full innerHTML rebuild, so tiles no longer teleport between ticks.
  function updateSpectatorLive() {
    const s = spectatorSession;
    if (!s) return;
    const snap = s.lastSnap;
    const tier = snap ? (snap.tier | 0) : 0;
    const scoreEl = document.getElementById('spectator-score');
    if (scoreEl) animateSpectatorScore(scoreEl, snap ? (snap.score | 0) : 0);
    const tierObj = getActiveTiers()[tier];
    const nm = document.getElementById('spectator-tier-name');
    if (nm) nm.textContent = (tierObj && tierObj.name) ? tierObj.name : '—';
    const badge = document.getElementById('spectator-tier-badge');
    if (badge) {
      if (tierObj) { badge.className = 'contest-board-tier'; badge.style.background = tierObj.bg; badge.style.color = tierObj.fg; badge.innerHTML = tierObj.svg; }
      else { badge.className = 'contest-board-tier contest-board-tier-empty'; badge.style.background = ''; badge.style.color = ''; badge.textContent = '·'; }
    }
    const gridEl = document.getElementById('spectator-grid-el');
    if (gridEl && gridEl.children.length === 24 && snap && Array.isArray(snap.grid) && snap.grid.length === 24) {
      const cells = gridEl.children;
      for (let i = 0; i < 24; i++) {
        const cell = cells[i];
        const newT = snap.grid[i] | 0;
        const oldT = parseInt(cell.dataset.tier || '0', 10) || 0;
        if (newT === oldT) continue;
        cell.dataset.tier = String(newT);
        cell.classList.remove('spec-cell-appear', 'spec-cell-merge', 'spec-cell-clear');
        void cell.offsetWidth;
        if (newT > 0 && getActiveTiers()[newT]) {
          const ti = getActiveTiers()[newT];
          cell.className = 'cell filled';
          cell.style.background = ti.bg; cell.style.color = ti.fg;
          cell.innerHTML = ti.svg;
          cell.classList.add(oldT > 0 && newT > oldT ? 'spec-cell-merge' : 'spec-cell-appear');
        } else {
          cell.className = 'cell';
          cell.style.background = ''; cell.style.color = '';
          cell.innerHTML = '';
          cell.classList.add('spec-cell-clear');
        }
      }
    }
    updateSpectatorVs();
    updateSpectatorTierLadder(tier);
  }

  function renderSpectatorView() {
    const s = spectatorSession;
    if (!s) return;
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    // If the shell is already mounted for this session, update live data IN
    // PLACE instead of rebuilding the whole view every second (which made
    // tiles teleport + the score snap). Falls back to a full rebuild on error.
    if (wrap.querySelector('.spectator-view')) {
      try { updateSpectatorLive(); return; } catch (e) {}
    }
    const snap = s.lastSnap;
    const tier = snap ? (snap.tier | 0) : 0;
    const tierObj = getActiveTiers()[tier];
    const tierBadge = tierObj
      ? '<div class="contest-board-tier" id="spectator-tier-badge" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '">' + tierObj.svg + '</div>'
      : '<div class="contest-board-tier contest-board-tier-empty" id="spectator-tier-badge">·</div>';
    let cellsHtml = '';
    if (snap && Array.isArray(snap.grid) && snap.grid.length === 24) {
      for (let i = 0; i < 24; i++) {
        const t = snap.grid[i] | 0;
        if (t > 0 && getActiveTiers()[t]) {
          const ti = getActiveTiers()[t];
          cellsHtml += '<div class="cell filled" data-tier="' + t + '" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>';
        } else {
          cellsHtml += '<div class="cell" data-tier="0"></div>';
        }
      }
    } else {
      for (let i = 0; i < 24; i++) cellsHtml += '<div class="cell" data-tier="0"></div>';
    }
    const liveScoreText = snap ? (snap.score | 0).toLocaleString() : '—';
    const tierName = (tierObj && tierObj.name) ? tierObj.name : '—';
    // Choose exit label based on where the spectate started — the player
    // should see "back to my game" if they came from mid-game.
    const willResumeGame = s.entryFrom !== 'game-over' && !contestSubmitted && mode === 'contest';
    const exitLabel = willResumeGame ? 'חזור למשחק שלי'
      : s.entryFrom === 'contest-screen' ? 'חזור ללוח התחרות'
      : 'צא מהצפייה';
    wrap.innerHTML =
      '<div class="spectator-view">' +
        '<div class="spectator-header">' +
          '<div>' +
            '<div class="spectator-header-name">' + tierBadge +
              '<span>צופה ב ' + escapeHtml(s.name || 'שחקן') + '</span>' +
              '<span class="live-tag">LIVE</span>' +
            '</div>' +
            '<div class="spectator-header-meta">דרגה: <span id="spectator-tier-name">' + escapeHtml(tierName) + '</span></div>' +
          '</div>' +
          '<div class="spectator-header-score" id="spectator-score">' + liveScoreText + '</div>' +
        '</div>' +
        spectatorVsHtml() +
        '<div class="spectator-grid"><div class="grid" id="spectator-grid-el">' + cellsHtml + '</div></div>' +
        '<div class="spectator-tier-ladder" id="spectator-tier-ladder">' + spectatorTierLadderInner(tier) + '</div>' +
        '<div class="spectator-controls">' +
          '<button class="btn secondary" id="spec-switch">החלפת שחקן</button>' +
          '<button class="btn" id="spec-exit">' + exitLabel + '</button>' +
        '</div>' +
      '</div>';
    const se = document.getElementById('spectator-score');
    if (se) se.dataset.val = String(snap ? (snap.score | 0) : 0);
    const sw = document.getElementById('spec-switch');
    const ex = document.getElementById('spec-exit');
    if (sw) sw.onclick = function() {
      const fromBeforeExit = s.entryFrom;
      stopSpectator(null);
      openSpectatorPicker(fromBeforeExit);
    };
    if (ex) ex.onclick = function() {
      stopSpectator('exit');
    };
  }

  // exit: null → internal cleanup only (e.g., before switching player).
  //       'exit' → user-initiated exit; route based on entryFrom + game state.
  function stopSpectator(exit) {
    const s = spectatorSession;
    if (!s) return;
    clearSpectatorReconnecting(s);
    if (s.pollTimer) { clearInterval(s.pollTimer); s.pollTimer = null; }
    if (s.heartbeatTimer) { clearInterval(s.heartbeatTimer); s.heartbeatTimer = null; }
    if (s._escHandler) { try { document.removeEventListener('keydown', s._escHandler); } catch (e) {} s._escHandler = null; }
    // Best-effort unwatch — the server TTL will clean us up regardless.
    try {
      fetch(API_BASE + '/api/contests/' + encodeURIComponent(s.code) + '/unwatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watcherDeviceId: deviceId, targetDeviceId: s.targetDeviceId })
      });
    } catch (e) {}
    const from = s.entryFrom;
    spectatorSession = null;
    if (exit !== 'exit') return;
    if (from !== 'game-over' && !contestSubmitted && mode === 'contest' && activeContestCode) {
      // Mid-game spectate ended → resume the saved game.
      init('contest');
      return;
    }
    if (from === 'contest-screen' && activeContestCode) {
      showContestLeaderboard(activeContestCode);
      return;
    }
    // Default — back to the game-over view.
    render({ over: true });
  }

  function showSpectatorToast(text) {
    const t = document.createElement('div');
    t.className = 'spectator-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const ms = new Date() - new Date(iso);
    if (isNaN(ms) || ms < 0) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'עכשיו';
    const min = Math.floor(sec / 60);
    if (min < 60) return 'לפני ' + min + ' דק׳';
    const hours = Math.floor(min / 60);
    if (hours < 24) return 'לפני ' + hours + ' שע׳';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'אתמול';
    if (days < 7) return 'לפני ' + days + ' ימים';
    return new Date(iso).toLocaleDateString('he-IL');
  }

