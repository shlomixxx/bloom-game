// ============================================================
// A8 — Squad Tournaments (4-guild weekly bracket, May 2026)
//
// Auto-matched Sunday 06:00 IL. 4 guilds. Week-long score gathering.
// Wed eve = semifinals. Sat eve = finals. Winner guild → 1000💎/member.
//
// Differs from Stage 37 Guild Wars (1v1 between guilds) by being a
// 4-way bracket with 3 elimination stages — more drama, weekly rhythm.
//
// Tile (only shown when player's guild IS in an active tournament OR
// has unclaimed reward). Modal shows the bracket visualization + per-
// guild scores + my contribution + claim button when reward ready.
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, data: null };
  var CACHE_MS = 60 * 1000;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }

  function fetchState(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve(_cache.data);
    }
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/squad/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) { _cache.fetchedAt = Date.now(); _cache.data = d; }
        return d;
      });
  }

  function maybeShowTile() {
    // Level gate L15+ — Squad requires the player is deep enough to be
    // in a guild AND have a guild that participates. Same gate as guilds.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 15) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.inGuild || !d.tournament) {
        // No tournament → remove tile if present.
        var ex = document.getElementById('squad-tile');
        if (ex) ex.remove();
        return;
      }
      var tile = document.getElementById('squad-tile');
      if (!tile) {
        tile = document.createElement('button');
        tile.id = 'squad-tile';
        tile.className = 'squad-tile';
        tile.onclick = function() { showSquadModal(); };
        home.appendChild(tile);
      }
      tile.innerHTML = renderTileInner(d);
      // Pulse if claim ready.
      tile.classList.toggle('has-claim', d.canClaim);
    });
  }

  function renderTileInner(d) {
    var myGuild = d.guilds.find(function(g) { return g.isMine; });
    var status = d.tournament.status;
    var headline;
    if (d.canClaim) {
      headline = '🎁 ' + (myGuild && myGuild.final_winner ? 'ניצחת!' : 'תוצאות מוכנות') + ' · אסוף ' + d.myReward.toLocaleString() + '💎';
    } else if (status === 'active') {
      var rank = computeMyRank(d);
      headline = '⚔️ פעיל · הקלאן במקום ' + rank + ' מתוך 4';
    } else if (status === 'semifinals') {
      headline = myGuild && myGuild.semifinalWinner ? '🥈 עברתם לגמר!' : '😔 הקלאן הודח בחצי הגמר';
    } else if (status === 'finals') {
      headline = '🥇 הגמר השבת בערב!';
    } else if (status === 'finished') {
      headline = d.alreadyClaimed ? '✓ נאסף' : 'הסתיים';
    }
    return (
      '<div class="squad-tile-main">' +
        '<div class="squad-tile-title">🏟 טורניר שבועי</div>' +
        '<div class="squad-tile-sub">' + headline + '</div>' +
      '</div>' +
      '<div class="squad-tile-arrow">›</div>'
    );
  }

  function computeMyRank(d) {
    var sorted = d.guilds.slice().sort(function(a, b) { return b.score - a.score; });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].isMine) return i + 1;
    }
    return 4;
  }

  function showSquadModal() {
    var existing = document.getElementById('squad-modal');
    if (existing) { existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'squad-modal';
    modal.className = 'squad-overlay';
    modal.innerHTML =
      '<div class="squad-card">' +
        '<button class="squad-close" aria-label="סגור">×</button>' +
        '<div class="squad-title">🏟 טורניר השבוע</div>' +
        '<div class="squad-sub">4 קלאנים · 3 שלבים · סוף שבת = מנצח</div>' +
        '<div class="squad-body" id="squad-body">' +
          '<div class="squad-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.squad-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchState(true).then(renderModalBody);
  }

  function renderModalBody(d) {
    var host = document.getElementById('squad-body');
    if (!host) return;
    if (!d || !d.ok || !d.enabled) {
      host.innerHTML = '<div class="squad-empty">הטורנירים כבויים כרגע</div>';
      return;
    }
    if (!d.inGuild) {
      host.innerHTML =
        '<div class="squad-empty">' +
          '<div class="squad-empty-icon">🛡</div>' +
          '<div class="squad-empty-title">צריך להיות בקלאן כדי להשתתף</div>' +
          '<div class="squad-empty-sub">פתח את מסך הקלאנים והצטרף לאחד.</div>' +
        '</div>';
      return;
    }
    if (!d.tournament) {
      host.innerHTML =
        '<div class="squad-empty">' +
          '<div class="squad-empty-icon">⏰</div>' +
          '<div class="squad-empty-title">אין טורניר פעיל</div>' +
          '<div class="squad-empty-sub">טורניר חדש נוצר אוטומטית כל יום ראשון בבוקר.</div>' +
        '</div>';
      return;
    }
    // Status banner
    var statusBanner = renderStatusBanner(d);
    // Bracket visualization
    var bracket = renderBracket(d);
    // My contribution
    var myContribCard =
      '<div class="squad-contrib-card">' +
        '<div class="squad-contrib-label">🎯 התרומה שלך</div>' +
        '<div class="squad-contrib-stats">' +
          '<span><strong>' + (d.myContribution || 0).toLocaleString() + '</strong> נקודות</span>' +
          '<span><strong>' + (d.myGames || 0) + '</strong> משחקים</span>' +
        '</div>' +
        (d.tournament.status === 'active'
          ? '<div class="squad-contrib-hint">המשך לשחק — כל ניקוד שלך מתווסף לסך הקלאן.</div>'
          : '') +
      '</div>';
    // Claim button (if applicable)
    var claimSection = '';
    if (d.canClaim) {
      var myG = d.guilds.find(function(g) { return g.isMine; });
      var tier = myG && myG.finalWinner ? '🏆 הקלאן זכה!' : (myG && myG.semifinalWinner ? '🥈 הגעתם לגמר' : '🎁 פרס השתתפות');
      claimSection =
        '<div class="squad-claim-card">' +
          '<div class="squad-claim-title">' + tier + '</div>' +
          '<div class="squad-claim-amount">+' + d.myReward.toLocaleString() + '💎</div>' +
          '<button class="squad-claim-btn" id="squad-claim-btn">🎁 אסוף פרס</button>' +
        '</div>';
    } else if (d.alreadyClaimed) {
      claimSection = '<div class="squad-claim-done">✓ הפרס נאסף — חזור מחר לטורניר הבא!</div>';
    }
    host.innerHTML = statusBanner + bracket + myContribCard + claimSection +
      '<div class="squad-tip">💡 שחק עוד משחקים → הקלאן מקבל יותר נקודות → סיכוי גבוה יותר לעבור את חצי הגמר ביום רביעי בערב.</div>';
    // Wire claim button
    var btn = document.getElementById('squad-claim-btn');
    if (btn) btn.onclick = function() { doClaim(d.tournament.id, btn); };
  }

  function renderStatusBanner(d) {
    var s = d.tournament.status;
    var label, color;
    if (s === 'active') { label = '⚔️ פעיל · מצברים נקודות עד יום רביעי בערב'; color = 'active'; }
    else if (s === 'semifinals') { label = '🥈 חצי הגמר · 2 קלאנים שעברו'; color = 'semis'; }
    else if (s === 'finals') { label = '🏆 גמר השבת בערב!'; color = 'finals'; }
    else if (s === 'finished') { label = '✓ הסתיים'; color = 'done'; }
    else { label = s; color = 'active'; }
    return '<div class="squad-status-banner squad-status-' + color + '">' + label + '</div>';
  }

  function renderBracket(d) {
    // 4 guilds in bracket positions 0,1,2,3. Pair A = 0+1; Pair B = 2+3.
    var pairA = d.guilds.filter(function(g) { return g.bracketPos === 0 || g.bracketPos === 1; });
    var pairB = d.guilds.filter(function(g) { return g.bracketPos === 2 || g.bracketPos === 3; });
    // Sort by score descending within pair for visual clarity.
    pairA.sort(function(a, b) { return b.score - a.score; });
    pairB.sort(function(a, b) { return b.score - a.score; });
    return (
      '<div class="squad-bracket">' +
        '<div class="squad-pair">' +
          '<div class="squad-pair-label">קבוצה A</div>' +
          pairA.map(renderGuildCard).join('') +
        '</div>' +
        '<div class="squad-pair-vs">VS</div>' +
        '<div class="squad-pair">' +
          '<div class="squad-pair-label">קבוצה B</div>' +
          pairB.map(renderGuildCard).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderGuildCard(g) {
    var cls = 'squad-guild-card';
    if (g.isMine) cls += ' squad-guild-mine';
    if (g.finalWinner) cls += ' squad-guild-winner';
    else if (g.eliminated) cls += ' squad-guild-eliminated';
    else if (g.semifinalWinner) cls += ' squad-guild-advanced';
    var medal = '';
    if (g.finalWinner) medal = '🏆';
    else if (g.semifinalWinner) medal = '🥈';
    else if (g.eliminated) medal = '😔';
    return (
      '<div class="' + cls + '">' +
        '<div class="squad-guild-head">' +
          '<span class="squad-guild-emoji">' + (g.emoji || '🛡') + '</span>' +
          '<span class="squad-guild-name">' + escapeHtml(g.name || 'קלאן') + '</span>' +
          (medal ? '<span class="squad-guild-medal">' + medal + '</span>' : '') +
          (g.isMine ? '<span class="squad-guild-mine-tag">אתה</span>' : '') +
        '</div>' +
        '<div class="squad-guild-score">' + g.score.toLocaleString() + '</div>' +
        '<div class="squad-guild-games">' + g.games + ' משחקים</div>' +
      '</div>'
    );
  }

  function doClaim(tournamentId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ מתעדכן...'; }
    fetch('/api/squad/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken(), tournamentId: tournamentId })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (btn) { btn.disabled = false; btn.textContent = '🎁 אסוף פרס'; }
        var reason = (d && d.reason) || 'error';
        var msgs = {
          not_finished: 'הטורניר עדיין לא נגמר',
          not_in_guild: 'אינך בקלאן',
          guild_not_in_tournament: 'הקלאן שלך לא היה בטורניר',
          no_contribution: 'לא תרמת אף משחק — אין פרס',
          already_claimed: 'כבר אספת את הפרס'
        };
        if (typeof showToast === 'function') showToast(msgs[reason] || ('שגיאה: ' + reason), 'error');
        return;
      }
      // Update balance + widget bump.
      if (typeof d.newBalance === 'number') {
        try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
        try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        try { if (window.__bloomBumpBal) window.__bloomBumpBal(d.newBalance, d.reward); } catch (e) {}
      }
      // Celebration
      showClaimCelebration(d.reward);
      _cache.fetchedAt = 0;
      fetchState(true).then(function(fresh) { renderModalBody(fresh); maybeShowTile(); });
    });
  }

  function showClaimCelebration(reward) {
    var ov = document.createElement('div');
    ov.className = 'squad-celeb-overlay';
    var conf = '';
    var n = reward >= 1000 ? 40 : (reward >= 300 ? 24 : 12);
    for (var i = 0; i < n; i++) {
      var x = Math.random() * 100;
      var delay = Math.random() * 0.4;
      conf += '<span class="cl-conf" style="left:' + x + '%;background:' + (reward >= 1000 ? '#FFD93D' : '#4FBD8B') + ';animation-delay:' + delay + 's"></span>';
    }
    ov.innerHTML =
      conf +
      '<div class="squad-celeb-card">' +
        '<div class="squad-celeb-emoji">' + (reward >= 1000 ? '🏆' : (reward >= 300 ? '🥈' : '🎁')) + '</div>' +
        '<div class="squad-celeb-title">פרס נאסף!</div>' +
        '<div class="squad-celeb-amount">+' + reward.toLocaleString() + '💎</div>' +
      '</div>';
    document.body.appendChild(ov);
    try { if (typeof soundMilestone === 'function') soundMilestone(reward >= 1000 ? 7 : 5); } catch (e) {}
    try { if (typeof buzz === 'function') buzz(reward >= 1000 ? [80,60,100,60,120,80,140] : [60,40,80,40,100]); } catch (e) {}
    ov.onclick = function() { try { ov.remove(); } catch (e) {} };
    setTimeout(function() { try { ov.remove(); } catch (e) {} }, reward >= 1000 ? 5000 : 3500);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  try {
    window.__bloomSquad = {
      maybeShow: maybeShowTile,
      open: showSquadModal,
      refresh: function() { _cache.fetchedAt = 0; return fetchState(true); }
    };
  } catch (e) {}
})();
