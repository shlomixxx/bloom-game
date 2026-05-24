// ============================================================
// Stage 16 — Achievement-driven Cross-Leaderboard (May 2026)
// New competitive axis: rank by # achievements unlocked, not score.
// Rewards completionists / breadth-players over single-board grinders.
// ============================================================
(function() {
  var _achLbCache = { data: null, fetchedAt: 0 };
  var _achMeCache = { data: null, fetchedAt: 0 };
  var _syncDone = false;

  // Boot sync — read every achievement from localStorage and POST them
  // to the server in one bulk call. Idempotent on the server side.
  // Runs ONCE per boot to backfill existing players' state.
  function syncAchievementsToServer() {
    if (_syncDone) return Promise.resolve(null);
    _syncDone = true;
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return Promise.resolve(null);
    // Read localStorage state same way 05c-dynamic-boards.js does.
    var keys = [];
    try {
      var raw = localStorage.getItem('bloom_dyn_achievements');
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          var pb = obj.perBoard || {};
          Object.keys(pb).forEach(function(boardId) {
            var entry = pb[boardId] || {};
            Object.keys(entry).forEach(function(achId) {
              if (entry[achId]) keys.push('board:' + boardId + ':' + achId);
            });
          });
          var cr = obj.cross || {};
          Object.keys(cr).forEach(function(achId) {
            if (cr[achId]) keys.push('cross:' + achId);
          });
        }
      }
    } catch (e) {}
    if (!keys.length) return Promise.resolve(null);
    return fetch('/api/achievements/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, keys: keys })
    }).then(function(r) { return r.json(); }).catch(function() { return null; });
  }

  function fetchMyAchCount(force) {
    if (!force && _achMeCache.data && (Date.now() - _achMeCache.fetchedAt) < 60000) {
      return Promise.resolve(_achMeCache.data);
    }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/achievements/me?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _achMeCache.data = d;
          _achMeCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function fetchAchLeaderboard(force) {
    if (!force && _achLbCache.data && (Date.now() - _achLbCache.fetchedAt) < 60000) {
      return Promise.resolve(_achLbCache.data);
    }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var url = '/api/achievements/leaderboard?limit=50';
    if (deviceId) url += '&deviceId=' + encodeURIComponent(deviceId);
    return fetch(url).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _achLbCache.data = d;
          _achLbCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return '';
    var base = 0x1F1E6;
    return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0) - 65) +
           String.fromCodePoint(base + cc.toUpperCase().charCodeAt(1) - 65);
  }

  function maybeShowAchLbTile() {
    // T1.1 — Achievements LB unlocks at L8. Existing "3+ achievements"
    // gate combined with this means new players see neither.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 8) return; } catch (e) {}
    // First, fire the boot sync (silent).
    syncAchievementsToServer().then(function() {
      // Then check my count to decide whether to show the tile.
      fetchMyAchCount(true).then(function(d) {
        if (!d || !d.ok || d.count < 3) return; // hide until player has 3+ achievements
        var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
        if (!home) return;
        if (document.getElementById('ach-lb-home-tile')) return;
        mountAchLbTile(home, d);
      });
    });
  }

  function mountAchLbTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'ach-lb-home-tile';
    tile.className = 'ach-lb-home-tile';
    var rankPill = data.rank
      ? '<span class="ach-lb-tile-rank">#' + data.rank + '</span>'
      : '';
    tile.innerHTML =
      '<span class="ach-lb-tile-icon">🏅</span>' +
      '<span class="ach-lb-tile-body">' +
        '<span class="ach-lb-tile-title">לוח מובילים — הישגים' + rankPill + '</span>' +
        '<span class="ach-lb-tile-sub">פתחת ' + data.count + ' הישגים · ראה איפה אתה בעולם</span>' +
      '</span>' +
      '<span class="ach-lb-tile-arrow">›</span>';
    // Insert near the bottom of home — this is interesting info but not
    // critical/urgent.
    homeEl.appendChild(tile);
    tile.onclick = function() { showAchLeaderboardModal(); };
  }

  function showAchLeaderboardModal() {
    var ex = document.getElementById('ach-lb-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'ach-lb-modal';
    modal.className = 'ach-lb-modal-overlay';
    modal.innerHTML =
      '<div class="ach-lb-modal-card">' +
        '<button class="ach-lb-modal-close" aria-label="סגור">×</button>' +
        '<div class="ach-lb-modal-icon">🏅</div>' +
        '<div class="ach-lb-modal-title">לוח מובילים — הישגים</div>' +
        '<div class="ach-lb-modal-sub">דירוג עולמי לפי מספר ההישגים שפתחת</div>' +
        '<div class="ach-lb-modal-body" id="ach-lb-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.ach-lb-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchAchLeaderboard(true).then(function(d) { renderAchLbBody(d); });
  }

  function renderAchLbBody(data) {
    var host = document.getElementById('ach-lb-modal-body');
    if (!host) return;
    if (!data || !data.ok) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">שגיאה בטעינה</div>';
      return;
    }
    if (!data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">הלוח כבוי כרגע</div>';
      return;
    }
    var list = data.list || [];
    var me = data.me;
    if (!list.length) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">עוד אין שחקנים עם הישגים</div>';
      return;
    }
    // My rank pill at top
    var myRowHtml = '';
    if (me && me.rank) {
      var meInTop = list.some(function(r) { return r.is_me; });
      if (!meInTop) {
        myRowHtml =
          '<div class="ach-lb-modal-me">' +
            '<div class="ach-lb-modal-me-pill">' +
              '<span class="ach-lb-row-rank">#' + me.rank + '</span>' +
              '<span class="ach-lb-row-name">אתה · ' + (me.country ? flagEmoji(me.country) + ' ' : '') + escapeHtml(me.name || 'אנונימי') + '</span>' +
              '<span class="ach-lb-row-count">🏅 ' + me.ach_count + '</span>' +
            '</div>' +
          '</div>';
      }
    }
    var rowsHtml = list.map(function(r, idx) {
      var rankCls = '';
      var rankIcon = '#' + r.rank;
      if (r.rank === 1) { rankCls = 'ach-lb-row-gold'; rankIcon = '🥇'; }
      else if (r.rank === 2) { rankCls = 'ach-lb-row-silver'; rankIcon = '🥈'; }
      else if (r.rank === 3) { rankCls = 'ach-lb-row-bronze'; rankIcon = '🥉'; }
      var meCls = r.is_me ? ' ach-lb-row-me' : '';
      var flag = r.country ? flagEmoji(r.country) + ' ' : '';
      return '<div class="ach-lb-row ' + rankCls + meCls + '">' +
        '<span class="ach-lb-row-rank">' + rankIcon + '</span>' +
        '<span class="ach-lb-row-name">' + flag + escapeHtml(r.name || 'אנונימי') + (r.is_me ? ' (אתה)' : '') + '</span>' +
        '<span class="ach-lb-row-count">🏅 ' + r.ach_count + '</span>' +
      '</div>';
    }).join('');
    host.innerHTML = myRowHtml + '<div class="ach-lb-modal-list">' + rowsHtml + '</div>';
  }

  // Public hooks
  window.maybeShowAchLbTile = maybeShowAchLbTile;
  window.showAchLeaderboardModal = showAchLeaderboardModal;
  window.syncAchievementsToServer = syncAchievementsToServer;
  window.fetchAchLeaderboard = fetchAchLeaderboard;
  window.fetchMyAchCount = fetchMyAchCount;
})();
