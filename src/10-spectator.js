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
      return;
    }
    if (!spectatorSession || spectatorSession !== s) return;
    if (res.status === 404) {
      s.missCount++;
      if (s.missCount >= 2) {
        showSpectatorToast('המשחק הסתיים');
        stopSpectator(true);
      }
      return;
    }
    if (!res.ok) return;
    let data;
    try { data = await res.json(); } catch (e) { return; }
    if (!spectatorSession || spectatorSession !== s) return;
    s.missCount = 0;
    if (data && data.live) {
      s.lastSnap = data.live;
      if (data.live.name) s.name = data.live.name;
      renderSpectatorView();
    } else if (forceRender) {
      renderSpectatorView();
    }
  }

  function renderSpectatorView() {
    const s = spectatorSession;
    if (!s) return;
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    const snap = s.lastSnap;
    const tier = snap ? (snap.tier | 0) : 0;
    const tierObj = getActiveTiers()[tier];
    const tierBadge = tierObj
      ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '">' + tierObj.svg + '</div>'
      : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
    let cellsHtml = '';
    if (snap && Array.isArray(snap.grid) && snap.grid.length === 24) {
      for (let i = 0; i < 24; i++) {
        const t = snap.grid[i] | 0;
        if (t > 0 && getActiveTiers()[t]) {
          const ti = getActiveTiers()[t];
          cellsHtml += '<div class="cell filled" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>';
        } else {
          cellsHtml += '<div class="cell"></div>';
        }
      }
    } else {
      for (let i = 0; i < 24; i++) cellsHtml += '<div class="cell"></div>';
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
            '<div class="spectator-header-meta">דרגה: ' + escapeHtml(tierName) + '</div>' +
          '</div>' +
          '<div class="spectator-header-score">' + liveScoreText + '</div>' +
        '</div>' +
        '<div class="spectator-grid"><div class="grid" id="spectator-grid-el">' + cellsHtml + '</div></div>' +
        '<div class="spectator-controls">' +
          '<button class="btn secondary" id="spec-switch">החלפת שחקן</button>' +
          '<button class="btn" id="spec-exit">' + exitLabel + '</button>' +
        '</div>' +
      '</div>';
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
    if (s.pollTimer) { clearInterval(s.pollTimer); s.pollTimer = null; }
    if (s.heartbeatTimer) { clearInterval(s.heartbeatTimer); s.heartbeatTimer = null; }
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

