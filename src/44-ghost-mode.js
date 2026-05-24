// ============================================================
// A9 — Ghost Mode (Mario Kart pattern, May 2026)
//
// Player races against the recorded run of another player on the same
// daily seed. The ghost's drops_sequence (array of column indices) was
// captured during their run; we replay it alongside the current player's
// drops to show a translucent column indicator + a live score-vs-score
// HUD pill.
//
// Why "ghost" not "live duel" — the ghost is a STATIC record (drops +
// final score). It doesn't react to the player's grid; it just shows
// where they dropped each tile and what their final score was, with
// the score interpolated linearly across drop progression.
//
// Storage: ghost state lives in `window.__bloomGhost` so the engine
// hook (in 11-game.js drop()) can call `__bloomGhostTick(dropsCount)`
// on every drop to advance the visual indicator.
//
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';
  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function todayIL() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  // Find a ghost to race. Returns null if no ghost available (rare —
  // only on a brand-new day with no other player's score yet).
  function fetchGhost(date) {
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    var d = date || todayIL();
    return fetch('/api/ghost/random?deviceId=' + encodeURIComponent(deviceId) + '&date=' + encodeURIComponent(d))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(j) {
        if (!j || !j.ok || !j.ghost) return null;
        return { ghost: j.ghost, isFriend: !!j.isFriend };
      });
  }

  // Arm the ghost — store its drops + projected score so the engine
  // tick can advance it. Mounts the HUD pill at top of viewport.
  function armGhost(ghostData) {
    if (!ghostData || !ghostData.ghost) return;
    var g = ghostData.ghost;
    window.__bloomGhost = {
      name: g.name,
      country: g.country,
      score: g.score | 0,
      tier: g.tier | 0,
      drops: g.drops | 0,
      sequence: Array.isArray(g.dropsSequence) ? g.dropsSequence : [],
      isFriend: !!ghostData.isFriend,
      currentProgress: 0,
      beaten: false,
      beatToasted: false
    };
    mountGhostHUD();
  }

  function disarmGhost() {
    window.__bloomGhost = null;
    unmountGhostHUD();
    unmountGhostColumn();
  }

  function mountGhostHUD() {
    unmountGhostHUD();
    var g = window.__bloomGhost;
    if (!g) return;
    var bar = document.createElement('div');
    bar.id = 'ghost-hud';
    bar.className = 'ghost-hud' + (g.isFriend ? ' ghost-hud-friend' : '');
    bar.innerHTML =
      '<span class="ghost-hud-emoji">👻</span>' +
      '<span class="ghost-hud-name">' + escapeHtml(g.name || 'יריב') + '</span>' +
      '<span class="ghost-hud-score" id="ghost-hud-score">0</span>' +
      '<span class="ghost-hud-vs">vs</span>' +
      '<span class="ghost-hud-mine" id="ghost-hud-mine">0</span>';
    document.body.appendChild(bar);
  }
  function unmountGhostHUD() {
    var el = document.getElementById('ghost-hud');
    if (el) el.remove();
  }

  function unmountGhostColumn() {
    var el = document.getElementById('ghost-col-indicator');
    if (el) el.remove();
  }

  // Called from 11-game.js drop() — advances the ghost based on the
  // player's current drop count. We interpolate the ghost's score
  // linearly across its drops_sequence length so the HUD ticks up
  // naturally. The ghost's "next-drop column" is highlighted as a
  // translucent overlay so the player can see where they're heading.
  function ghostTick(playerDropsCount) {
    var g = window.__bloomGhost;
    if (!g) return;
    var len = g.sequence.length;
    var progress = Math.min(playerDropsCount, len);
    g.currentProgress = progress;
    // Interpolated ghost-score
    var ghostScore = len > 0 ? Math.floor(g.score * (progress / len)) : 0;
    var myScore = (typeof score !== 'undefined') ? (score | 0) : 0;
    // Update HUD
    var sEl = document.getElementById('ghost-hud-score');
    var mEl = document.getElementById('ghost-hud-mine');
    if (sEl) sEl.textContent = ghostScore.toLocaleString();
    if (mEl) mEl.textContent = myScore.toLocaleString();
    // Toggle "ahead/behind" class on HUD
    var bar = document.getElementById('ghost-hud');
    if (bar) {
      bar.classList.toggle('ghost-hud-ahead', myScore > ghostScore);
      bar.classList.toggle('ghost-hud-behind', myScore < ghostScore);
    }
    // First-overtake toast (only fires once per game)
    if (!g.beatToasted && myScore > g.score && g.score > 0) {
      g.beatToasted = true;
      g.beaten = true;
      showOvertakeToast(g.name, myScore - g.score);
    }
    // Show next-column indicator if there's a future drop in the sequence.
    if (progress < len) {
      showGhostColumnIndicator(g.sequence[progress]);
    } else {
      unmountGhostColumn();
    }
  }

  function showGhostColumnIndicator(col) {
    if (col < 0 || col > 3) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var existing = document.getElementById('ghost-col-indicator');
    var newCol = String(col);
    if (existing && existing.getAttribute('data-col') === newCol) return; // same col
    if (existing) existing.remove();
    var ind = document.createElement('div');
    ind.id = 'ghost-col-indicator';
    ind.className = 'ghost-col-indicator';
    ind.setAttribute('data-col', newCol);
    var rect = gridEl.getBoundingClientRect();
    var colW = rect.width / 4;
    // Position absolutely over the grid, RTL-aware: in RTL, col 0 is
    // visually on the right edge of the grid (rect.right - colW).
    // The grid uses LTR internally though; CSS grid maps col index to
    // visual position left-to-right. So col 0 = leftmost cell.
    ind.style.position = 'fixed';
    ind.style.left = (rect.left + colW * col) + 'px';
    ind.style.top = rect.top + 'px';
    ind.style.width = colW + 'px';
    ind.style.height = rect.height + 'px';
    ind.style.pointerEvents = 'none';
    document.body.appendChild(ind);
  }

  function showOvertakeToast(name, delta) {
    var toast = document.createElement('div');
    toast.className = 'ghost-overtake-toast';
    toast.innerHTML = '🏆 עברת את ' + escapeHtml(name || 'הרוח') + '! +' + delta.toLocaleString();
    document.body.appendChild(toast);
    try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([60, 40, 100]); } catch (e) {}
    setTimeout(function() { try { toast.remove(); } catch (e) {} }, 3000);
  }

  // Home tile entry-point — opens a "find ghost" modal.
  function maybeShowHomeTile() {
    // Level gate L8+ — same as Friend Challenges. Requires player has
    // played a few games + understands the daily flow.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 8) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    if (document.getElementById('ghost-mode-tile')) return;
    var tile = document.createElement('button');
    tile.id = 'ghost-mode-tile';
    tile.className = 'ghost-mode-tile';
    tile.innerHTML =
      '<div class="ghost-tile-main">' +
        '<div class="ghost-tile-title">👻 שחק נגד רוח</div>' +
        '<div class="ghost-tile-sub">תתחרה ברוח של חבר שכבר שיחק את ה-daily היום</div>' +
      '</div>' +
      '<div class="ghost-tile-arrow">›</div>';
    tile.onclick = function() { startGhostFlow(); };
    home.appendChild(tile);
  }

  function startGhostFlow() {
    var overlay = document.createElement('div');
    overlay.id = 'ghost-loading-overlay';
    overlay.className = 'ghost-loading-overlay';
    overlay.innerHTML = '<div class="ghost-loading-card">' +
      '<div class="ghost-loading-emoji">👻</div>' +
      '<div class="ghost-loading-text">מחפש רוח...</div>' +
    '</div>';
    document.body.appendChild(overlay);
    fetchGhost().then(function(data) {
      overlay.remove();
      if (!data) {
        if (typeof showToast === 'function') showToast('אין רוח זמינה לdaily היום — נסה מחר', 'info');
        return;
      }
      showGhostConfirmModal(data);
    });
  }

  function showGhostConfirmModal(data) {
    var g = data.ghost;
    var modal = document.createElement('div');
    modal.id = 'ghost-confirm-modal';
    modal.className = 'ghost-confirm-overlay';
    modal.innerHTML =
      '<div class="ghost-confirm-card">' +
        '<button class="ghost-confirm-close" aria-label="סגור">×</button>' +
        '<div class="ghost-confirm-title">👻 מצאתי רוח!</div>' +
        '<div class="ghost-confirm-subject">' +
          (data.isFriend ? '🤝 חבר שלך' : '🌍 שחקן אקראי') +
        '</div>' +
        '<div class="ghost-confirm-name">' + escapeHtml(g.name || 'אנונימי') + '</div>' +
        '<div class="ghost-confirm-stats">' +
          '<div class="ghost-confirm-stat"><div class="ghost-confirm-stat-val">' + g.score.toLocaleString() + '</div><div class="ghost-confirm-stat-lbl">ציון</div></div>' +
          '<div class="ghost-confirm-stat"><div class="ghost-confirm-stat-val">' + g.drops + '</div><div class="ghost-confirm-stat-lbl">דרופים</div></div>' +
          '<div class="ghost-confirm-stat"><div class="ghost-confirm-stat-val">' + tierEmoji(g.tier) + '</div><div class="ghost-confirm-stat-lbl">דרגה מירבית</div></div>' +
        '</div>' +
        '<div class="ghost-confirm-instruction">בעוד רגע יתחיל daily אמיתי. תראה למעלה את הניקוד של ' + escapeHtml(g.name) + ' ביחס שלך, ועמודה מסומנת איפה הם הפיל את האריח הבא.</div>' +
        '<button class="ghost-confirm-go-btn" id="ghost-confirm-go">🏁 התחל מירוץ</button>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.ghost-confirm-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    document.getElementById('ghost-confirm-go').onclick = function() {
      armGhost(data);
      modal.remove();
      // Hide home, start daily.
      try { if (typeof hideHome === 'function') hideHome(); } catch (e) {}
      try { if (typeof init === 'function') init('daily', { fresh: true }); } catch (e) {}
    };
  }

  function tierEmoji(t) {
    var labels = ['—', '🪨', '🍃', '🌸', '🔥', '⚡', '⭐', '💎', '👑'];
    return labels[t | 0] || '—';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Expose the tick to the engine (called from 11-game.js drop()).
  try {
    window.__bloomGhostTick = ghostTick;
    window.__bloomGhost = null; // set by armGhost()
    window.__bloomGhostMode = {
      maybeShow: maybeShowHomeTile,
      arm: armGhost,
      disarm: disarmGhost,
      start: startGhostFlow
    };
  } catch (e) {}

  // Disarm on every mode switch (so ghost doesn't leak between games).
  // Hooks into the existing init() flow via a global watcher: if `mode`
  // changes from daily to anything else, drop the ghost.
  var lastMode = null;
  setInterval(function() {
    try {
      var curMode = (typeof mode !== 'undefined') ? mode : null;
      if (lastMode === 'daily' && curMode !== 'daily' && window.__bloomGhost) {
        disarmGhost();
      }
      lastMode = curMode;
    } catch (e) {}
  }, 1000);
})();
