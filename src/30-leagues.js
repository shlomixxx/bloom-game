// ============================================================
// Stage 34 — Weekly Leagues (May 2026)
// 5-tier ladder based on weekly Lifetime XP gain. Sunday weekly reset
// (Asia/Jerusalem). Each tier = better end-of-week reward.
// Brawl Stars pattern — week-over-week competitive structure that
// none of the other systems provided.
// ============================================================
(function() {
  var _leagueCache = { data: null, fetchedAt: 0 };
  var _leagueInFlight = false;

  function fetchLeagueState(force) {
    if (!force && _leagueCache.data && (Date.now() - _leagueCache.fetchedAt) < 60000) {
      return Promise.resolve(_leagueCache.data);
    }
    if (_leagueInFlight) return Promise.resolve(_leagueCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _leagueInFlight = true;
    return fetch('/api/league/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _leagueInFlight = false;
        if (d && d.ok) {
          _leagueCache.data = d;
          _leagueCache.fetchedAt = Date.now();
          // Fire promotion celebration if leveledUp this fetch.
          if (d.leveledUp && d.league) {
            setTimeout(function() { showLeaguePromotionCelebration(d.league); }, 800);
          }
        }
        return d;
      });
  }

  function maybeShowLeagueTile() {
    fetchLeagueState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('league-home-tile')) { updateLeagueTile(d); return; }
      mountLeagueTile(home, d);
    });
  }

  function tileInner(data) {
    var l = data.league || { emoji: '🥉', label: 'Bronze', color: '#B45309' };
    var rewardBadge = data.unclaimedReward
      ? '<span class="league-tile-reward">🎁 ' + data.unclaimedReward.gems + '</span>'
      : '';
    var progressText = data.next
      ? 'עוד ' + data.next.gap.toLocaleString() + ' XP לליגת ' + leagueLabelHebrew(data.next.tier)
      : '👑 הגעת לקודקוד!';
    return (
      '<span class="league-tile-icon" style="color:' + l.color + '">' + l.emoji + '</span>' +
      '<span class="league-tile-body">' +
        '<span class="league-tile-title">ליגת ' + l.label + rewardBadge + '</span>' +
        '<span class="league-tile-bar"><span class="league-tile-bar-fill" style="width:' + (data.progressPct || 0) + '%;background:' + l.color + '"></span></span>' +
        '<span class="league-tile-sub">' + (data.weeklyGain || 0).toLocaleString() + ' XP השבוע · ' + progressText + '</span>' +
      '</span>' +
      '<span class="league-tile-arrow">›</span>'
    );
  }

  function leagueLabelHebrew(id) {
    if (id === 'silver')   return 'כסף 🥈';
    if (id === 'gold')     return 'זהב 🥇';
    if (id === 'diamond')  return 'יהלום 💎';
    if (id === 'master')   return 'מאסטר 👑';
    return 'ברונזה 🥉';
  }

  function mountLeagueTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'league-home-tile';
    tile.className = 'league-home-tile' + (data.unclaimedReward ? ' has-reward' : '');
    tile.innerHTML = tileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showLeagueModal(); };
  }

  function updateLeagueTile(data) {
    var tile = document.getElementById('league-home-tile');
    if (!tile) return;
    tile.className = 'league-home-tile' + (data.unclaimedReward ? ' has-reward' : '');
    tile.innerHTML = tileInner(data);
  }

  function showLeagueModal() {
    var ex = document.getElementById('league-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'league-modal';
    modal.className = 'league-modal-overlay';
    modal.innerHTML =
      '<div class="league-modal-card">' +
        '<button class="league-modal-close" aria-label="סגור">×</button>' +
        '<div class="league-modal-title">⚔️ ליגה שבועית</div>' +
        '<div class="league-modal-sub">מתאפס כל יום ראשון בחצות (שעון ישראל)</div>' +
        '<div class="league-modal-body" id="league-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.league-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchLeagueState(true).then(function(d) { renderLeagueBody(d); });
  }

  function renderLeagueBody(data) {
    var host = document.getElementById('league-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">המערכת כבויה</div>';
      return;
    }
    var l = data.league;
    // Current league big badge
    var bigBadgeHtml =
      '<div class="league-current-card" style="background:linear-gradient(135deg,' + l.color + ',rgba(255,255,255,0.15))">' +
        '<div class="league-current-emoji">' + l.emoji + '</div>' +
        '<div class="league-current-label">' + l.label + '</div>' +
        '<div class="league-current-week">' + (data.weeklyGain || 0).toLocaleString() + ' XP השבוע</div>' +
      '</div>';
    // Progress to next tier
    var nextHtml = '';
    if (data.next) {
      nextHtml =
        '<div class="league-next-card">' +
          '<div class="league-next-label">הליגה הבאה: ' + leagueLabelHebrew(data.next.tier) + '</div>' +
          '<div class="league-next-bar"><div class="league-next-bar-fill" style="width:' + (data.progressPct || 0) + '%"></div></div>' +
          '<div class="league-next-gap">עוד <strong>' + data.next.gap.toLocaleString() + ' XP</strong> לקידום</div>' +
        '</div>';
    } else {
      nextHtml = '<div class="league-max-banner">👑 הגעת לליגת המאסטר! פסגת הגבר.</div>';
    }
    // Unclaimed reward
    var rewardHtml = '';
    if (data.unclaimedReward) {
      var lr = data.unclaimedReward;
      rewardHtml =
        '<div class="league-reward-card">' +
          '<div class="league-reward-icon">🎁</div>' +
          '<div class="league-reward-body">' +
            '<div class="league-reward-title">פרס שבוע שעבר: ' + lr.gems + '💎</div>' +
            '<div class="league-reward-sub">הגעת לליגת ' + leagueLabelHebrew(lr.tier) + ' — קח את הפרס!</div>' +
          '</div>' +
          '<button class="league-reward-btn" id="league-claim-btn">🎁 קבל</button>' +
        '</div>';
    }
    // All tiers ladder
    var laddersHtml = '<div class="league-ladder-title">📊 כל הליגות + פרסים</div>' +
      '<div class="league-ladder">' +
      [
        { id: 'bronze',  emoji: '🥉', label: 'Bronze',  threshold: 0,     reward: 50,   color: '#B45309' },
        { id: 'silver',  emoji: '🥈', label: 'Silver',  threshold: 500,   reward: 150,  color: '#94A3B8' },
        { id: 'gold',    emoji: '🥇', label: 'Gold',    threshold: 2000,  reward: 400,  color: '#F59E0B' },
        { id: 'diamond', emoji: '💎', label: 'Diamond', threshold: 10000, reward: 1000, color: '#3B82F6' },
        { id: 'master',  emoji: '👑', label: 'Master',  threshold: 50000, reward: 3000, color: '#A855F7' }
      ].map(function(t) {
        var isCurrent = t.id === l.id;
        return '<div class="league-ladder-row' + (isCurrent ? ' league-ladder-current' : '') + '">' +
          '<div class="league-ladder-emoji" style="color:' + t.color + '">' + t.emoji + '</div>' +
          '<div class="league-ladder-info">' +
            '<div class="league-ladder-name">' + t.label + (isCurrent ? ' · אתה כאן' : '') + '</div>' +
            '<div class="league-ladder-thr">' + (t.threshold === 0 ? 'ברירת מחדל' : 'דורש ' + t.threshold.toLocaleString() + ' XP/שבוע') + '</div>' +
          '</div>' +
          '<div class="league-ladder-reward">+' + t.reward + '💎</div>' +
        '</div>';
      }).join('') +
      '</div>';
    host.innerHTML = bigBadgeHtml + nextHtml + rewardHtml + laddersHtml;
    // Wire claim button
    if (data.unclaimedReward) {
      var claimBtn = document.getElementById('league-claim-btn');
      if (claimBtn) claimBtn.onclick = function() { doLeagueClaim(claimBtn); };
    }
  }

  function doLeagueClaim(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/league/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([80, 60, 100, 60, 120]); } catch (e) {}
          _leagueCache.data = null;
          fetchLeagueState(true).then(function(fresh) {
            if (fresh) {
              renderLeagueBody(fresh);
              updateLeagueTile(fresh);
            }
          });
        } else {
          if (btn) btn.disabled = false;
          alert(d && d.reason ? d.reason : 'שגיאה');
        }
      });
  }

  function showLeaguePromotionCelebration(league) {
    var ov = document.createElement('div');
    ov.className = 'league-promo-celebration';
    ov.innerHTML =
      '<div class="league-promo-card" style="background:linear-gradient(135deg,' + league.color + ',#FFF)">' +
        '<div class="league-promo-icon">' + league.emoji + '</div>' +
        '<div class="league-promo-title">קודמת לליגה!</div>' +
        '<div class="league-promo-sub">עכשיו ב-' + league.label + '</div>' +
        '<button class="league-promo-btn">מעולה!</button>' +
      '</div>';
    document.body.appendChild(ov);
    try { if (typeof soundMilestone === 'function') soundMilestone(7); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([100, 80, 120, 80, 160]); } catch (e) {}
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.league-promo-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 8000);
  }

  window.maybeShowLeagueTile = maybeShowLeagueTile;
  window.showLeagueModal = showLeagueModal;
  window.fetchLeagueState = fetchLeagueState;
})();
