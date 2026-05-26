// ============================================================
// Stage 37 — Guild Wars (May 2026)
// Weekly head-to-head competition between two guilds. Auto-matched
// by the server every 6h for guilds without an active war. Every
// game played by a member contributes to their guild's pool.
// Clash Royale pattern — boosted guild retention 3-5x at launch.
//
// Contribution is wired SERVER-SIDE inside /api/guilds/contribute
// (it cascades to war if active), so this client module only deals
// with rendering: home tile + war modal + claim flow + celebration.
// ============================================================
(function() {
  var _warCache = { data: null, fetchedAt: 0 };
  var _warInFlight = false;
  var _claimedThisSession = false;

  function fetchWarState(force) {
    if (!force && _warCache.data && (Date.now() - _warCache.fetchedAt) < 60000) {
      return Promise.resolve(_warCache.data);
    }
    if (_warInFlight) return Promise.resolve(_warCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _warInFlight = true;
    return fetch('/api/guilds/war?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _warInFlight = false;
        if (d && d.ok) { _warCache.data = d; _warCache.fetchedAt = Date.now(); }
        return d;
      });
  }

  function maybeShowWarTile() {
    // T1.1 — Guild Wars need an L20 player. inGuild gate below would
    // skip non-guild players anyway, but the explicit level gate keeps
    // a brand-new player from accidentally seeing the tile if they're
    // somehow already in a guild.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 20) return; } catch (e) {}
    fetchWarState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.inGuild) return;
      if (!d.activeWar && !d.unclaimed) return; // nothing to show
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('guild-war-home-tile')) { updateWarTile(d); return; }
      mountWarTile(home, d);
    });
  }

  function mountWarTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'guild-war-home-tile';
    tile.className = 'guild-war-home-tile' + (data.unclaimed ? ' has-claim' : '');
    tile.innerHTML = renderTileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showWarModal(); };
  }

  function updateWarTile(data) {
    var tile = document.getElementById('guild-war-home-tile');
    if (!tile) return;
    tile.className = 'guild-war-home-tile' + (data.unclaimed ? ' has-claim' : '');
    tile.innerHTML = renderTileInner(data);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'הסתיים';
    var d = Math.floor(ms / 86400000);
    var h = Math.floor((ms % 86400000) / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return d + 'י ' + h + 'ש';
    if (h > 0) return h + 'ש ' + m + 'ד';
    return m + 'ד';
  }

  function renderTileInner(data) {
    if (data.unclaimed) {
      var u = data.unclaimed;
      var label = u.isWinner ? '🏆 נצחון!' : '🥈 הסתיים';
      return (
        '<span class="gw-tile-icon">🛡⚔️</span>' +
        '<span class="gw-tile-body">' +
          '<span class="gw-tile-title">מלחמת קלאנים<span class="gw-tile-badge">🎁 ' + u.reward + '💎</span></span>' +
          '<span class="gw-tile-sub">' + label + ' · אסוף את הפרס שלך עכשיו</span>' +
        '</span>' +
        '<span class="gw-tile-arrow">›</span>'
      );
    }
    var w = data.activeWar;
    var mineAhead = w.myGuild.score > w.otherGuild.score;
    var diff = Math.abs(w.myGuild.score - w.otherGuild.score);
    var status;
    if (w.myGuild.score === 0 && w.otherGuild.score === 0) {
      status = '⚔️ המלחמה החלה! תרום ראשון';
    } else if (mineAhead) {
      status = '👑 מובילים ב-' + diff.toLocaleString() + ' נקודות';
    } else {
      status = '🔥 מאחור ב-' + diff.toLocaleString() + ' — קדימה!';
    }
    return (
      '<span class="gw-tile-icon">🛡⚔️</span>' +
      '<span class="gw-tile-body">' +
        '<span class="gw-tile-title">מלחמת קלאנים<span class="gw-tile-badge gw-tile-badge-countdown">⏰ ' + formatCountdown(w.msLeft) + '</span></span>' +
        '<span class="gw-tile-sub">' + status + '</span>' +
      '</span>' +
      '<span class="gw-tile-arrow">›</span>'
    );
  }

  function showWarModal() {
    var ex = document.getElementById('guild-war-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'guild-war-modal';
    modal.className = 'gw-modal-overlay';
    modal.innerHTML =
      '<div class="gw-modal-card">' +
        '<button class="gw-modal-close" aria-label="סגור">×</button>' +
        '<div class="gw-modal-title">🛡⚔️ מלחמת קלאנים</div>' +
        '<div class="gw-modal-body" id="gw-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.gw-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchWarState(true).then(function(d) { renderWarBody(d); });
  }

  function renderWarBody(data) {
    var host = document.getElementById('gw-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">מערכת מלחמות הקלאנים כבויה</div>';
      return;
    }
    if (!data.inGuild) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">אתה לא חבר בקלאן.<br>הצטרף לקלאן כדי להשתתף במלחמות שבועיות</div>';
      return;
    }
    var html = '';
    // Unclaimed reward block (top priority)
    if (data.unclaimed) {
      var u = data.unclaimed;
      var bgGrad = u.isWinner
        ? 'linear-gradient(135deg,#FFD93D,#F5AD2E,#C9911A)'
        : 'linear-gradient(135deg,#B0B0B0,#909090,#707070)';
      var title = u.isWinner ? '🏆 ניצחתם!' : '🥈 מלחמה הסתיימה';
      var sub = u.isWinner ? 'הקלאן שלך ניצח את המלחמה — פרס מנצח מחכה!' : 'פרס נחמה על ההשתתפות';
      html +=
        '<div class="gw-claim-card" style="background:' + bgGrad + '">' +
          '<div class="gw-claim-icon">' + (u.isWinner ? '🏆' : '🥈') + '</div>' +
          '<div class="gw-claim-title">' + title + '</div>' +
          '<div class="gw-claim-sub">' + sub + '</div>' +
          '<div class="gw-claim-amount">+' + u.reward + ' 💎</div>' +
          '<button class="gw-claim-btn" id="gw-claim-btn" data-war-id="' + u.warId + '">🎁 קבל את הפרס</button>' +
        '</div>';
    }
    // Active war block
    if (data.activeWar) {
      var w = data.activeWar;
      var total = w.myGuild.score + w.otherGuild.score;
      var myPct = total > 0 ? Math.round(w.myGuild.score / total * 100) : 50;
      var otherPct = 100 - myPct;
      html +=
        '<div class="gw-battle-card">' +
          '<div class="gw-countdown">⏰ <strong>' + formatCountdown(w.msLeft) + '</strong> נשארו</div>' +
          '<div class="gw-vs-row">' +
            '<div class="gw-team gw-team-mine">' +
              '<div class="gw-team-emoji">' + (w.myGuild.emoji || '🛡') + '</div>' +
              '<div class="gw-team-name">' + (w.myGuild.name || 'הקלאן שלי') + '</div>' +
              '<div class="gw-team-score">' + w.myGuild.score.toLocaleString() + '</div>' +
              '<div class="gw-team-games">' + w.myGuild.games + ' משחקים</div>' +
            '</div>' +
            '<div class="gw-vs-divider">VS</div>' +
            '<div class="gw-team gw-team-other">' +
              '<div class="gw-team-emoji">' + (w.otherGuild.emoji || '⚔️') + '</div>' +
              '<div class="gw-team-name">' + (w.otherGuild.name || 'יריב') + '</div>' +
              '<div class="gw-team-score">' + w.otherGuild.score.toLocaleString() + '</div>' +
              '<div class="gw-team-games">' + w.otherGuild.games + ' משחקים</div>' +
            '</div>' +
          '</div>' +
          '<div class="gw-bar-wrap">' +
            '<div class="gw-bar-mine" style="width:' + myPct + '%">' + myPct + '%</div>' +
            '<div class="gw-bar-other" style="width:' + otherPct + '%">' + otherPct + '%</div>' +
          '</div>' +
          '<div class="gw-my-contrib">' +
            '🎯 התרומה שלך: <strong>' + w.myContribution.score.toLocaleString() + '</strong> נקודות ב-' + w.myContribution.games + ' משחקים' +
          '</div>' +
        '</div>';
      // Top contributors
      if (w.topContributors && w.topContributors.length) {
        html += '<div class="gw-contrib-title">🏅 התורמים המובילים</div>';
        html += '<div class="gw-contrib-list">';
        var medals = ['🥇', '🥈', '🥉'];
        for (var i = 0; i < Math.min(w.topContributors.length, 10); i++) {
          var c = w.topContributors[i];
          var medal = i < 3 ? medals[i] : ('#' + (i + 1));
          html += '<div class="gw-contrib-row">' +
            '<span class="gw-contrib-medal">' + medal + '</span>' +
            '<span class="gw-contrib-name">' + c.name + '</span>' +
            '<span class="gw-contrib-score">' + c.score.toLocaleString() + '</span>' +
            '<span class="gw-contrib-games">(' + c.games + ' מ׳)</span>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '<div class="gw-tips">' +
        '💡 <strong>איך מנצחים?</strong> כל משחק שאתה משחק מוסיף את הציון לקלאן שלך. כל החברים יחד יוצרים את הציון של המלחמה.' +
      '</div>';
    } else if (!data.unclaimed) {
      html += '<div class="gw-no-war">' +
        '<div class="gw-no-war-icon">⏳</div>' +
        '<div class="gw-no-war-title">אין מלחמה פעילה כרגע</div>' +
        '<div class="gw-no-war-sub">המערכת מזווגת קלאנים אוטומטית. תמשיך לשחק — בקרוב תהיה לכם מלחמה חדשה!</div>' +
      '</div>';
    }
    host.innerHTML = html;
    var claimBtn = document.getElementById('gw-claim-btn');
    if (claimBtn) claimBtn.onclick = function() { doWarClaim(parseInt(claimBtn.dataset.warId, 10), claimBtn); };
  }

  function doWarClaim(warId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ אוסף...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/guilds/war/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, warId: warId })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (!d || !d.ok) {
          if (btn) { btn.disabled = false; btn.textContent = '🎁 קבל את הפרס'; }
          showToast(d && d.reason ? d.reason : 'שגיאה', 'error');
          return;
        }
        // Show celebration
        showWarClaimCelebration(d);
        // Update local balance
        if (typeof d.newBalance === 'number') {
          try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.reward || 0); } catch (e) {}
        }
        _warCache.data = null;
        _claimedThisSession = true;
        // Refresh modal + tile
        setTimeout(function() {
          fetchWarState(true).then(function(fresh) { renderWarBody(fresh); updateWarTile(fresh); });
        }, 2500);
      });
  }

  function showWarClaimCelebration(result) {
    var ov = document.createElement('div');
    ov.className = 'gw-celebration';
    var icon = result.isWinner ? '🏆' : '🥈';
    var title = result.isWinner ? 'ניצחון!' : 'קיבלת פרס';
    var bg = result.isWinner ? 'linear-gradient(135deg,#FFD93D,#F5AD2E)' : 'linear-gradient(135deg,#B0B0B0,#909090)';
    ov.innerHTML =
      '<div class="gw-celeb-card" style="background:' + bg + '">' +
        '<div class="gw-celeb-icon">' + icon + '</div>' +
        '<div class="gw-celeb-title">' + title + '</div>' +
        '<div class="gw-celeb-amount">+' + result.reward + ' 💎</div>' +
      '</div>';
    document.body.appendChild(ov);
    try {
      if (result.isWinner) {
        if (typeof soundMilestone === 'function') soundMilestone(7);
        if (typeof buzz === 'function') buzz([100, 80, 140, 80, 180, 80, 220]);
      } else {
        if (typeof soundMilestone === 'function') soundMilestone(4);
        if (typeof buzz === 'function') buzz([60, 50, 100]);
      }
    } catch (e) {}
    setTimeout(function() { try { ov.remove(); } catch (e) {} }, 3500);
  }

  window.maybeShowWarTile = maybeShowWarTile;
  window.showGuildWarModal = showWarModal;
  window.fetchGuildWarState = fetchWarState;
})();
