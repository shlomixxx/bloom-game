// ============================================================
// Stage 29 — Tile Collection Album (May 2026)
// Genshin-style visual collection: 8 tiers × N dynamic boards.
// Reach a tier on a board → cell fills in your album.
// Complete a full board (all 8 tiers) → claim gem bonus.
// Complete a full tier (across all boards) → claim gem bonus.
// ============================================================
(function() {
  var _albumCache = { data: null, fetchedAt: 0 };
  var _albumInFlight = false;

  function fetchAlbumState(force) {
    if (!force && _albumCache.data && (Date.now() - _albumCache.fetchedAt) < 60000) {
      return Promise.resolve(_albumCache.data);
    }
    if (_albumInFlight) return Promise.resolve(_albumCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _albumInFlight = true;
    return fetch('/api/album/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _albumInFlight = false;
        if (d && d.ok) {
          _albumCache.data = d;
          _albumCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  // Called from game-over flow. Records the highest tier the player
  // reached this game on the given board. Server idempotent.
  function recordAlbumProgress(boardId, maxTier) {
    if (!boardId || !maxTier || maxTier < 1) return Promise.resolve(null);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/album/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, boardId: boardId, maxTier: maxTier })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _albumCache.data = null; // invalidate cache
          // If new tiers were unlocked, fire a small toast
          if (d.newTiers && d.newTiers.length) {
            // Show toast slightly after game-over UI lands.
            setTimeout(function() { showAlbumToast(d.newTiers.length); }, 2200);
          }
        }
        return d;
      });
  }

  function showAlbumToast(newCount) {
    var t = document.createElement('div');
    t.className = 'album-toast';
    t.innerHTML =
      '<span class="album-toast-icon">📔</span>' +
      '<span>+' + newCount + ' תאים חדשים באלבום!</span>';
    document.body.appendChild(t);
    setTimeout(function() { try { t.remove(); } catch (e) {} }, 3500);
  }

  function maybeShowAlbumTile() {
    // T1.1 — Album unlocks at L15 (completionist surface — needs a player
    // who's already past basic dynamic-board familiarity).
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 15) return; } catch (e) {}
    fetchAlbumState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      if (d.totalCells === 0) return; // no boards yet
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('album-home-tile')) {
        updateAlbumTile(d);
        return;
      }
      mountAlbumTile(home, d);
    });
  }

  function tileInner(data) {
    var claimBadge = data.unclaimedCount > 0
      ? '<span class="album-tile-claim">🎁 ' + data.unclaimedCount + '</span>'
      : '';
    return (
      '<span class="album-tile-icon">📔</span>' +
      '<span class="album-tile-body">' +
        '<span class="album-tile-title">אלבום אריחים' + claimBadge + '</span>' +
        '<span class="album-tile-bar"><span class="album-tile-bar-fill" style="width:' + data.pct + '%"></span></span>' +
        '<span class="album-tile-sub">' + data.collectedCells + ' / ' + data.totalCells + ' תאים · ' + data.pct + '%</span>' +
      '</span>' +
      '<span class="album-tile-arrow">›</span>'
    );
  }

  function mountAlbumTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'album-home-tile';
    tile.className = 'album-home-tile' + (data.unclaimedCount > 0 ? ' has-claim' : '');
    tile.innerHTML = tileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showAlbumModal(); };
  }

  function updateAlbumTile(data) {
    var tile = document.getElementById('album-home-tile');
    if (!tile) return;
    tile.className = 'album-home-tile' + (data.unclaimedCount > 0 ? ' has-claim' : '');
    tile.innerHTML = tileInner(data);
  }

  function tierEmoji(t) {
    // Try to read the live tier emoji from the game's TIERS array.
    try {
      if (typeof getActiveTiers === 'function') {
        var tiers = getActiveTiers();
        if (tiers && tiers[t] && tiers[t].name) {
          // We don't have the SVG here; use the player-facing emoji from the
          // built-in tier identity. Fall back to numeric.
          var emojis = ['', '🪨', '🍃', '🌸', '🔥', '⚡', '⭐', '💎', '👑'];
          return emojis[t] || ('T' + t);
        }
      }
    } catch (e) {}
    var emojis = ['', '🪨', '🍃', '🌸', '🔥', '⚡', '⭐', '💎', '👑'];
    return emojis[t] || ('T' + t);
  }

  function showAlbumModal() {
    var ex = document.getElementById('album-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'album-modal';
    modal.className = 'album-modal-overlay';
    modal.innerHTML =
      '<div class="album-modal-card">' +
        '<button class="album-modal-close" aria-label="סגור">×</button>' +
        '<div class="album-modal-icon">📔</div>' +
        '<div class="album-modal-title">אלבום אריחים</div>' +
        '<div class="album-modal-sub">השלם דרגות על לוחות שונים ופתח פרסים</div>' +
        '<div class="album-modal-body" id="album-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.album-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchAlbumState(true).then(function(d) { renderAlbumBody(d); });
  }

  function renderAlbumBody(data) {
    var host = document.getElementById('album-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">האלבום כבוי</div>';
      return;
    }
    if (!data.boards || !data.boards.length) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">אין לוחות דינמיים פעילים עדיין</div>';
      return;
    }
    // Header: overall progress + summary.
    var headerHtml =
      '<div class="album-header">' +
        '<div class="album-header-stat">' +
          '<div class="album-header-num">' + data.collectedCells + ' / ' + data.totalCells + '</div>' +
          '<div class="album-header-lbl">תאים נאספו</div>' +
        '</div>' +
        '<div class="album-header-stat">' +
          '<div class="album-header-num">' + data.pct + '%</div>' +
          '<div class="album-header-lbl">השלמה</div>' +
        '</div>' +
        (data.unclaimedCount > 0
          ? '<div class="album-header-stat album-header-claim">' +
              '<div class="album-header-num">🎁 ' + data.unclaimedCount + '</div>' +
              '<div class="album-header-lbl">לקבל</div>' +
            '</div>'
          : '') +
      '</div>';

    // Tier-completion claims at the top.
    var tierClaimsHtml = '';
    if (data.tiers && data.tiers.length) {
      var rows = data.tiers.map(function(t) {
        var bar = (t.totalBoards > 0)
          ? Math.round((t.collectedOn / t.totalBoards) * 100) : 0;
        var btn = '';
        if (t.claimed) btn = '<span class="album-tier-row-status album-tier-row-claimed">✓ נאסף</span>';
        else if (t.canClaim) btn = '<button class="album-tier-row-claim" data-claim-type="tier_complete" data-target-id="' + t.tier + '">🎁 קבל ' + data.rewardPerTier + '💎</button>';
        else btn = '<span class="album-tier-row-status">' + t.collectedOn + ' / ' + t.totalBoards + '</span>';
        return '<div class="album-tier-row' + (t.canClaim ? ' can-claim' : '') + '">' +
          '<span class="album-tier-row-emoji">' + tierEmoji(t.tier) + '</span>' +
          '<span class="album-tier-row-label">דרגה ' + t.tier + ' על כל הלוחות</span>' +
          '<span class="album-tier-row-bar"><span style="width:' + bar + '%"></span></span>' +
          btn +
        '</div>';
      }).join('');
      tierClaimsHtml = '<div class="album-section-title">🎖 פרסים — דרגה על כל הלוחות</div>' +
        '<div class="album-tier-claims">' + rows + '</div>';
    }
    // Per-board grid.
    var boardsHtml = data.boards.map(function(b) {
      var tilesHtml = b.tiers.map(function(t) {
        return '<div class="album-tile-cell ' + (t.collected ? 'collected' : 'locked') + '">' +
          '<span>' + tierEmoji(t.tier) + '</span>' +
        '</div>';
      }).join('');
      var claimBtn = '';
      if (b.claimed) claimBtn = '<span class="album-board-status album-board-claimed">✓ נאסף</span>';
      else if (b.canClaim) claimBtn = '<button class="album-board-claim" data-claim-type="board_complete" data-target-id="' + b.id + '">🎁 קבל ' + data.rewardPerBoard + '💎</button>';
      else claimBtn = '<span class="album-board-status">' + b.collectedCount + ' / 8</span>';
      return '<div class="album-board-row' + (b.canClaim ? ' can-claim' : '') + (b.isComplete ? ' complete' : '') + '">' +
        '<div class="album-board-header">' +
          '<span class="album-board-name">' + escapeHtml(b.name || ('לוח #' + b.id)) + '</span>' +
          claimBtn +
        '</div>' +
        '<div class="album-board-tiles">' + tilesHtml + '</div>' +
      '</div>';
    }).join('');
    host.innerHTML = headerHtml +
      tierClaimsHtml +
      '<div class="album-section-title">📋 לוחות (כל אחד 8 דרגות)</div>' +
      '<div class="album-boards-list">' + boardsHtml + '</div>';

    // Wire claim buttons.
    host.querySelectorAll('[data-claim-type]').forEach(function(btn) {
      btn.onclick = function() {
        var type = btn.getAttribute('data-claim-type');
        var tid = parseInt(btn.getAttribute('data-target-id'), 10);
        doAlbumClaim(type, tid, btn);
      };
    });
  }

  function doAlbumClaim(claimType, targetId, btn) {
    var originalHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/album/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, claimType: claimType, targetId: targetId })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
            // 2026-05-26: also bump the home v2 balance widget so the
            // player sees their gems jump immediately. Without this the
            // home tile shows the OLD balance after claim → looks like
            // "won prize but didn't get gems".
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.reward || 0); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 40, 80, 40, 120]); } catch (e) {}
          _albumCache.data = null;
          // Re-render modal + update home tile.
          fetchAlbumState(true).then(function(fresh) {
            if (fresh) {
              renderAlbumBody(fresh);
              updateAlbumTile(fresh);
            }
          });
        } else {
          // 2026-05-26: restore original button content instead of leaving
          // it stuck on '⏳'. Translate technical reasons to Hebrew.
          if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
          var reason = d && d.reason;
          var msg = reason === 'already_claimed' ? 'הפרס כבר נאסף' :
                    reason === 'not_complete' ? 'עוד לא השלמת — המשך לאסוף' :
                    'שגיאה — נסה שוב';
          if (typeof showToast === 'function') showToast(msg, 'warning');
        }
      });
  }

  window.maybeShowAlbumTile = maybeShowAlbumTile;
  window.showAlbumModal = showAlbumModal;
  window.recordAlbumProgress = recordAlbumProgress;
  window.fetchAlbumState = fetchAlbumState;
})();
