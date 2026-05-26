// ============================================================
// Stage 33 — Rivalry System (May 2026)
// Auto-paired 24h personal competition with another player.
// Visible home tile when you have an active rival + countdown +
// delta to overtake them. Beating them = +150💎 + celebration.
// ============================================================
(function() {
  var _rivalCache = { data: null, fetchedAt: 0 };
  var _rivalInFlight = false;
  var _rivalTicker = null;

  function fetchRivalState(force) {
    if (!force && _rivalCache.data && (Date.now() - _rivalCache.fetchedAt) < 60000) {
      return Promise.resolve(_rivalCache.data);
    }
    if (_rivalInFlight) return Promise.resolve(_rivalCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _rivalInFlight = true;
    return fetch('/api/rival/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _rivalInFlight = false;
        if (d && d.ok) {
          _rivalCache.data = d;
          _rivalCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function resolveRivalriesOnServer() {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/rival/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; });
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return 'הסתיים';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + 'ש ' + m + 'ד';
    var s = Math.floor((ms % 60000) / 1000);
    return m + 'ד ' + s + 'ש';
  }

  function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return '';
    var base = 0x1F1E6;
    return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0) - 65) +
           String.fromCodePoint(base + cc.toUpperCase().charCodeAt(1) - 65);
  }

  function maybeShowRivalTile() {
    // T1.1 — Rivals unlock at L20 (final wave — needs enough lifetime XP
    // for the auto-pairing to find a meaningful opponent in the matchmaker).
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 20) return; } catch (e) {}
    // First, try to resolve any expired rivalries (server-side check).
    resolveRivalriesOnServer().then(function(rd) {
      // Show celebration if I just won.
      if (rd && rd.ok && Array.isArray(rd.resolved)) {
        rd.resolved.forEach(function(r) {
          if (r.outcome === 'won' && r.rewardGranted > 0) {
            showRivalWinCelebration(r.rewardGranted);
            // 2026-05-26: server now returns r.newBalance (truth). The
            // old code locally added rewardGranted which drifted when
            // multiple resolutions fired together. Prefer server value
            // when present; fall back to local addition otherwise.
            try {
              if (typeof r.newBalance === 'number') {
                if (typeof playerBalance !== 'undefined') playerBalance = r.newBalance;
              } else if (typeof playerBalance !== 'undefined') {
                playerBalance = (playerBalance || 0) + r.rewardGranted;
              }
              if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
              if (typeof window.__bloomBumpBal === 'function') {
                window.__bloomBumpBal(typeof r.newBalance === 'number' ? r.newBalance : playerBalance, r.rewardGranted);
              }
            } catch (e) {}
          }
        });
      }
      // Now fetch fresh state.
      _rivalCache.data = null;
      fetchRivalState(true).then(function(d) {
        if (!d || !d.ok || !d.enabled || !d.rivalry) return;
        var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
        if (!home) return;
        if (document.getElementById('rival-home-tile')) { updateRivalTile(d); return; }
        mountRivalTile(home, d);
      });
    });
  }

  function tileInner(data) {
    var r = data.rivalry;
    var ahead = r.delta > 0;
    var deltaAbs = Math.abs(r.delta);
    var flag = r.rivalCountry ? flagEmoji(r.rivalCountry) + ' ' : '';
    var statusText, statusClass;
    if (ahead) {
      statusText = '👑 אתה ' + deltaAbs.toLocaleString() + ' XP לפניו';
      statusClass = 'rival-ahead';
    } else if (r.delta === 0) {
      statusText = '⚖️ אתם תיקו! משחק אחד מכריע';
      statusClass = 'rival-tied';
    } else {
      statusText = '🔥 עוד ' + deltaAbs.toLocaleString() + ' XP לעקוף';
      statusClass = 'rival-behind';
    }
    var newBadge = r.isNew ? '<span class="rival-tile-new">חדש!</span>' : '';
    return (
      '<span class="rival-tile-icon">🥊</span>' +
      '<span class="rival-tile-body ' + statusClass + '">' +
        '<span class="rival-tile-title">יריב: ' + flag + escapeHtml(r.rivalName) + newBadge + '</span>' +
        '<span class="rival-tile-status">' + statusText + '</span>' +
        '<span class="rival-tile-countdown" data-expires="' + r.expiresAt + '">⏰ ' + fmtCountdown(r.msUntilExpiry) + '</span>' +
      '</span>' +
      '<span class="rival-tile-arrow">›</span>'
    );
  }

  function mountRivalTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'rival-home-tile';
    tile.className = 'rival-home-tile' + (data.rivalry && data.rivalry.delta < 0 ? ' rival-tile-behind' : '');
    tile.innerHTML = tileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showRivalModal(); };
    startRivalTicker();
  }

  function updateRivalTile(data) {
    var tile = document.getElementById('rival-home-tile');
    if (!tile) return;
    tile.className = 'rival-home-tile' + (data.rivalry && data.rivalry.delta < 0 ? ' rival-tile-behind' : '');
    tile.innerHTML = tileInner(data);
  }

  function startRivalTicker() {
    if (_rivalTicker) return;
    _rivalTicker = setInterval(function() {
      var tile = document.getElementById('rival-home-tile');
      if (!tile) { clearInterval(_rivalTicker); _rivalTicker = null; return; }
      var d = _rivalCache.data;
      if (!d || !d.rivalry) return;
      d.rivalry.msUntilExpiry = Math.max(0, d.rivalry.msUntilExpiry - 60000);
      if (d.rivalry.msUntilExpiry === 0) {
        // Expired — resolve on server + refresh.
        clearInterval(_rivalTicker);
        _rivalTicker = null;
        setTimeout(function() { maybeShowRivalTile(); }, 1500);
      } else {
        var cd = tile.querySelector('.rival-tile-countdown');
        if (cd) cd.textContent = '⏰ ' + fmtCountdown(d.rivalry.msUntilExpiry);
      }
    }, 60 * 1000);
  }

  function showRivalModal() {
    var ex = document.getElementById('rival-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'rival-modal';
    modal.className = 'rival-modal-overlay';
    modal.innerHTML =
      '<div class="rival-modal-card">' +
        '<button class="rival-modal-close" aria-label="סגור">×</button>' +
        '<div class="rival-modal-icon">🥊</div>' +
        '<div class="rival-modal-title">היריב שלך</div>' +
        '<div class="rival-modal-body" id="rival-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.rival-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchRivalState(true).then(function(d) { renderRivalBody(d); });
  }

  function renderRivalBody(data) {
    var host = document.getElementById('rival-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled || !data.rivalry) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">' +
        '<div style="font-size:64px;margin-bottom:12px;opacity:0.5">🥊</div>' +
        '<div style="font-weight:700;margin-bottom:8px">אין כרגע יריב פעיל</div>' +
        '<div style="font-size:12px;opacity:0.7">המערכת תזווג אותך אוטומטית עם שחקן באותה רמה תוך 4 שעות. כדאי לשחק כדי לעלות בדירוג!</div>' +
      '</div>';
      return;
    }
    var r = data.rivalry;
    var ahead = r.delta > 0;
    var flag = r.rivalCountry ? flagEmoji(r.rivalCountry) + ' ' : '';
    // VS card
    var vsHtml =
      '<div class="rival-vs-card">' +
        '<div class="rival-vs-side rival-vs-me' + (ahead ? ' rival-vs-winning' : '') + '">' +
          '<div class="rival-vs-label">אתה</div>' +
          '<div class="rival-vs-xp">' + r.myXp.toLocaleString() + '</div>' +
          (r.xpGainSinceDecl > 0
            ? '<div class="rival-vs-gain">+' + r.xpGainSinceDecl.toLocaleString() + ' מאז ההתחלה</div>'
            : '<div class="rival-vs-gain rival-vs-gain-zero">בלי תנועה — שחק עכשיו!</div>') +
        '</div>' +
        '<div class="rival-vs-divider">VS</div>' +
        '<div class="rival-vs-side rival-vs-rival' + (!ahead ? ' rival-vs-winning' : '') + '">' +
          '<div class="rival-vs-label">' + flag + escapeHtml(r.rivalName) + '</div>' +
          '<div class="rival-vs-xp">' + r.rivalXp.toLocaleString() + '</div>' +
          '<div class="rival-vs-gain">+' + (r.rivalXpGainSinceDecl || 0).toLocaleString() + ' מאז ההתחלה</div>' +
        '</div>' +
      '</div>';
    // Big status banner
    var statusHtml;
    if (ahead) {
      statusHtml = '<div class="rival-status-banner rival-status-ahead">' +
        '👑 אתה ' + r.delta.toLocaleString() + ' XP לפני! שמור על הליד' +
      '</div>';
    } else if (r.delta === 0) {
      statusHtml = '<div class="rival-status-banner rival-status-tied">' +
        '⚖️ תיקו! משחק אחד טוב מספיק להכריע' +
      '</div>';
    } else {
      statusHtml = '<div class="rival-status-banner rival-status-behind">' +
        '🔥 ' + Math.abs(r.delta).toLocaleString() + ' XP מאחור — אפשר לעקוף!' +
      '</div>';
    }
    // Countdown
    var cdHtml = '<div class="rival-countdown-row">' +
      '⏰ נשאר: <strong>' + fmtCountdown(r.msUntilExpiry) + '</strong>' +
    '</div>';
    // Reward + tips
    var rewardHtml = '<div class="rival-reward-card">' +
      '<div class="rival-reward-icon">🎁</div>' +
      '<div class="rival-reward-body">' +
        '<div class="rival-reward-title">פרס למנצח: ' + (data.winReward || 150) + '💎</div>' +
        '<div class="rival-reward-sub">' + (ahead
          ? 'אם תישאר מקדים עד שהזמן ייגמר — תקבל אוטומטית'
          : 'תעקוף אותו ב-XP בתוך 24 השעות הקרובות') +
        '</div>' +
      '</div>' +
    '</div>';
    var tipsHtml = '<div class="rival-tips">' +
      '<div class="rival-tips-title">💡 איך מצברים XP חיים מהר?</div>' +
      '<ul class="rival-tips-list">' +
        '<li>🎮 כל משחק = +10 XP</li>' +
        '<li>🏅 כל הישג חדש = +75 XP</li>' +
        '<li>🌟 לוח של היום (×3 XP) = ~300 XP/משחק</li>' +
        '<li>📔 השלמת תא באלבום = +25 XP</li>' +
      '</ul>' +
    '</div>';
    host.innerHTML = vsHtml + statusHtml + cdHtml + rewardHtml + tipsHtml;
  }

  function showRivalWinCelebration(reward) {
    var ov = document.createElement('div');
    ov.className = 'rival-win-celebration';
    ov.innerHTML =
      '<div class="rival-win-card">' +
        '<div class="rival-win-icon">🏆</div>' +
        '<div class="rival-win-title">ניצחת את היריב!</div>' +
        '<div class="rival-win-sub">+' + reward.toLocaleString() + '💎</div>' +
        '<button class="rival-win-btn">מעולה!</button>' +
      '</div>';
    document.body.appendChild(ov);
    try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([100, 80, 120, 80, 160]); } catch (e) {}
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.rival-win-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 8000);
  }

  window.maybeShowRivalTile = maybeShowRivalTile;
  window.showRivalModal = showRivalModal;
  window.fetchRivalState = fetchRivalState;
})();
