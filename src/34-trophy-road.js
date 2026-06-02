// ============================================================
// Stage 38 — Trophy Road (May 2026)
// Clash Royale pattern. Trophies go UP on good plays, DOWN on
// bad ones (with new-player protection + safe floor). Fear of
// losing what you've built is the #1 retention lever in mobile.
// ============================================================
(function() {
  var _trophyCache = { data: null, fetchedAt: 0 };
  var _trophyInFlight = false;

  function fetchTrophyState(force) {
    if (!force && _trophyCache.data && (Date.now() - _trophyCache.fetchedAt) < 60000) {
      return Promise.resolve(_trophyCache.data);
    }
    if (_trophyInFlight) return Promise.resolve(_trophyCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _trophyInFlight = true;
    return fetch('/api/trophies/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _trophyInFlight = false;
        if (d && d.ok) { _trophyCache.data = d; _trophyCache.fetchedAt = Date.now(); }
        return d;
      });
  }

  function maybeShowTrophyTile() {
    // T1.1 — Trophy Road unlocks at L10 (alongside Duel — both build
    // on competitive instinct). Below that the player isn't gaining
    // trophies anyway (needs score ≥500 in dynamic games).
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 10) return; } catch (e) {}
    fetchTrophyState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('trophy-home-tile')) { updateTrophyTile(d); return; }
      mountTrophyTile(home, d);
    });
  }

  function mountTrophyTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'trophy-home-tile';
    tile.className = 'trophy-home-tile' + (data.unclaimedCount > 0 ? ' has-claim' : '');
    tile.innerHTML = renderTileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showTrophyModal(); };
  }

  function updateTrophyTile(data) {
    var tile = document.getElementById('trophy-home-tile');
    if (!tile) return;
    tile.className = 'trophy-home-tile' + (data.unclaimedCount > 0 ? ' has-claim' : '');
    tile.innerHTML = renderTileInner(data);
  }

  function renderTileInner(data) {
    var arena = data.arena || { emoji: '🌱', label: 'נבט', color: '#7EC9B0' };
    var claimBadge = data.unclaimedCount > 0
      ? '<span class="trophy-tile-badge">🎁 ' + data.unclaimedCount + '</span>'
      : '';
    var nextHint = data.nextArena
      ? 'עוד ' + data.nextArena.gap.toLocaleString() + ' 🏆 לארנת ' + data.nextArena.label
      : '👑 הגעת לאגדה!';
    return (
      '<span class="trophy-tile-arena" style="color:' + arena.color + '">' + arena.emoji + '</span>' +
      '<span class="trophy-tile-body">' +
        '<span class="trophy-tile-title">🏆 ' + data.trophies.toLocaleString() + claimBadge + '</span>' +
        '<span class="trophy-tile-sub">ארנת ' + arena.label + ' · ' + nextHint + '</span>' +
        renderTrophyStrip(data) +
      '</span>' +
      '<span class="trophy-tile-arrow">›</span>'
    );
  }

  // T2.1 — Trophy Road horizontal strip embedded inside the tile.
  // 8 arena nodes laid out with a connecting bar. Current arena gets
  // the "you-are-here" pulse + scale-up; already-passed arenas show ✓
  // and the connecting bar to them is fully filled; upcoming arenas are
  // muted and the bar to them is empty. The next-arena segment has a
  // partial fill proportional to (trophies - curr.min) / (next.min - curr.min).
  // The strip is purely visual — clicking the tile still opens the modal.
  function renderTrophyStrip(data) {
    var arenas = Array.isArray(data.arenas) && data.arenas.length
      ? data.arenas
      : [data.arena].filter(Boolean);
    if (!arenas.length) return '';
    var curIdx = -1;
    for (var i = 0; i < arenas.length; i++) {
      if (data.arena && arenas[i].id === data.arena.id) { curIdx = i; break; }
    }
    if (curIdx < 0) curIdx = 0;
    var trophies = data.trophies | 0;
    // Build the segments: nodes (arena pills) interleaved with bars.
    var html = '<span class="trophy-strip">';
    for (var j = 0; j < arenas.length; j++) {
      var a = arenas[j];
      var nodeClass = 'trophy-strip-node';
      if (j < curIdx) nodeClass += ' tr-passed';
      else if (j === curIdx) nodeClass += ' tr-current';
      else nodeClass += ' tr-upcoming';
      var content = j === curIdx
        ? a.emoji
        : (j < curIdx ? '✓' : a.emoji);
      html += '<span class="' + nodeClass + '" style="color:' + a.color + '" title="ארנת ' + a.label + ' · ' + a.minTrophies + '🏆">' + content + '</span>';
      // Bar to next arena (if any)
      if (j < arenas.length - 1) {
        var next = arenas[j + 1];
        var pct = 0;
        if (j < curIdx) pct = 100;
        else if (j === curIdx) {
          var span = next.minTrophies - a.minTrophies;
          var progress = trophies - a.minTrophies;
          pct = span > 0 ? Math.max(0, Math.min(100, Math.round(progress / span * 100))) : 100;
        }
        html += '<span class="trophy-strip-bar"><span class="trophy-strip-fill" style="width:' + pct + '%;background:' + next.color + '"></span></span>';
      }
    }
    html += '</span>';
    return html;
  }

  function showTrophyModal() {
    var ex = document.getElementById('trophy-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'trophy-modal';
    modal.className = 'trophy-modal-overlay';
    modal.innerHTML =
      '<div class="trophy-modal-card">' +
        '<button class="trophy-modal-close" aria-label="סגור">×</button>' +
        '<div class="trophy-modal-title">🏆 מסלול הגביעים</div>' +
        '<div class="trophy-modal-body" id="trophy-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.trophy-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchTrophyState(true).then(function(d) { renderTrophyBody(d); });
  }

  function renderTrophyBody(data) {
    var host = document.getElementById('trophy-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">מערכת הגביעים כבויה</div>';
      return;
    }
    var arena = data.arena;
    // Big arena header
    var arenaBg = 'radial-gradient(circle at center, ' + arena.color + '55, ' + arena.color + '11)';
    var header =
      '<div class="trophy-arena-header" style="background:' + arenaBg + '">' +
        '<div class="trophy-arena-emoji" style="color:' + arena.color + '">' + arena.emoji + '</div>' +
        '<div class="trophy-arena-name">ארנת ' + arena.label + '</div>' +
        '<div class="trophy-arena-count">🏆 <strong>' + data.trophies.toLocaleString() + '</strong></div>' +
        (data.lastChange ? '<div class="trophy-arena-change ' + (data.lastChange > 0 ? 'pos' : 'neg') + '">' + (data.lastChange > 0 ? '+' : '') + data.lastChange + ' מהמשחק האחרון</div>' : '') +
      '</div>';
    // Next-arena progress
    var nextHtml = '';
    if (data.nextArena) {
      var arenaSpan = data.nextArena.minTrophies - arena.minTrophies;
      var progressInArena = data.trophies - arena.minTrophies;
      var pct = arenaSpan > 0 ? Math.min(100, Math.round(progressInArena / arenaSpan * 100)) : 0;
      nextHtml =
        '<div class="trophy-next-card">' +
          '<div class="trophy-next-label">' + arena.emoji + ' → ' + data.nextArena.emoji + ' ' + data.nextArena.label + '</div>' +
          '<div class="trophy-next-bar"><div class="trophy-next-fill" style="width:' + pct + '%;background:' + data.nextArena.color + '"></div></div>' +
          '<div class="trophy-next-gap">עוד <strong>' + data.nextArena.gap.toLocaleString() + ' 🏆</strong> לארנה הבאה</div>' +
        '</div>';
    } else {
      nextHtml = '<div class="trophy-max-banner">👑 הגעת להיכל האגדה! ארנה אחרונה.</div>';
    }
    // Stats row
    var statsHtml =
      '<div class="trophy-stats">' +
        '<div class="trophy-stat"><span class="trophy-stat-num">' + data.highest.toLocaleString() + '</span><span class="trophy-stat-lbl">🏔 שיא</span></div>' +
        '<div class="trophy-stat"><span class="trophy-stat-num">' + data.stats.games.toLocaleString() + '</span><span class="trophy-stat-lbl">משחקים</span></div>' +
        '<div class="trophy-stat"><span class="trophy-stat-num">' + data.stats.winrate + '%</span><span class="trophy-stat-lbl">% ניצחון</span></div>' +
      '</div>';
    // Milestones list
    var milestonesHtml = '<div class="trophy-milestones-title">🎁 פרסי מסלול</div>' +
      '<div class="trophy-milestones-list">' +
      data.milestones.map(function(m) {
        var status, btn;
        if (m.claimed) {
          status = 'claimed';
          btn = '<span class="trophy-ms-status trophy-ms-claimed">✓ נאסף</span>';
        } else if (m.ready) {
          status = 'ready';
          btn = '<button class="trophy-ms-claim" data-idx="' + m.index + '">🎁 קבל +' + m.gems + '💎</button>';
        } else {
          status = 'locked';
          btn = '<span class="trophy-ms-status trophy-ms-locked">🔒 ' + (m.at - data.trophies).toLocaleString() + ' 🏆</span>';
        }
        return '<div class="trophy-ms-row trophy-ms-' + status + '">' +
          '<div class="trophy-ms-icon">' + (m.claimed ? '✓' : (m.ready ? '🎁' : '🔒')) + '</div>' +
          '<div class="trophy-ms-body">' +
            '<div class="trophy-ms-at">🏆 ' + m.at.toLocaleString() + '</div>' +
            '<div class="trophy-ms-reward">+' + m.gems + '💎</div>' +
          '</div>' +
          btn +
        '</div>';
      }).join('') +
      '</div>';
    // Arena ladder visual
    var arenasHtml = '<div class="trophy-arenas-title">🗺 כל הארנות</div>' +
      '<div class="trophy-arenas-ladder">' +
      data.arenas.map(function(a) {
        var isCurrent = a.id === arena.id;
        return '<div class="trophy-arena-row' + (isCurrent ? ' trophy-arena-current' : '') + (a.minTrophies <= data.trophies ? ' trophy-arena-unlocked' : ' trophy-arena-locked') + '">' +
          '<div class="trophy-arena-row-emoji" style="color:' + a.color + '">' + a.emoji + '</div>' +
          '<div class="trophy-arena-row-info">' +
            '<div class="trophy-arena-row-name">' + a.label + (isCurrent ? ' · אתה כאן' : '') + '</div>' +
            '<div class="trophy-arena-row-thr">' + (a.minTrophies === 0 ? 'מתחילים' : '🏆 ' + a.minTrophies.toLocaleString() + ' נדרשים') + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>';
    // Tips
    var tipsHtml = '<div class="trophy-tips">' +
      '💡 <strong>איך מרוויחים גביעים?</strong><br>' +
      '• משחק ≥500 נקודות = +15 🏆<br>' +
      '• הגעה לכתר (tier 8) = +40 🏆 בונוס<br>' +
      '• שיא אישי חדש = +25 🏆 בונוס<br>' +
      '• משחק קצר ≤100 = −8 🏆 (זהירות!)<br>' +
      '<span class="trophy-tips-note">חדשים עד 50 🏆 לא יורדים — שחק בלי פחד!</span>' +
    '</div>';
    host.innerHTML = header + nextHtml + statsHtml + '<div id="trophy-nearby-host"></div>' + milestonesHtml + arenasHtml + tipsHtml;
    // Wire claim buttons
    Array.prototype.forEach.call(host.querySelectorAll('.trophy-ms-claim'), function(btn) {
      btn.onclick = function() { doMilestoneClaim(parseInt(btn.dataset.idx, 10), btn); };
    });
    // UX audit 2026-06-02 — social ladder (who's just above/below you + the
    // "beat them" target). The #1 Clash-Royale retention hook, previously absent.
    fetchTrophyNearby();
  }

  function fetchTrophyNearby() {
    var host = document.getElementById('trophy-nearby-host');
    if (!host) return;
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return;
    fetch('/api/trophies/nearby?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) { renderTrophyNearby(d); });
  }
  function trophyFlagEmoji(cc) {
    try {
      if (!cc || cc.length !== 2) return '';
      var A = 0x1F1E6, u = cc.toUpperCase();
      return String.fromCodePoint(A + u.charCodeAt(0) - 65, A + u.charCodeAt(1) - 65) + ' ';
    } catch (e) { return ''; }
  }
  function renderTrophyNearby(d) {
    var host = document.getElementById('trophy-nearby-host');
    if (!host) return;
    var hasNeighbors = d && d.ok && d.enabled && (((d.above || []).length) || ((d.below || []).length));
    if (!hasNeighbors) { host.innerHTML = ''; return; }  // too few players — hide
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function rowHtml(p, cls) {
      return '<div class="trophy-ladder-row ' + cls + '">' +
        '<span class="trophy-ladder-name">' + trophyFlagEmoji(p.country) + esc(p.name) + '</span>' +
        '<span class="trophy-ladder-tr">🏆 ' + (p.trophies | 0).toLocaleString() + '</span>' +
      '</div>';
    }
    var rows = '';
    (d.above || []).forEach(function(p) { rows += rowHtml(p, 'trophy-ladder-above'); });
    rows += '<div class="trophy-ladder-row trophy-ladder-me">' +
      '<span class="trophy-ladder-name">⭐ אתה</span>' +
      '<span class="trophy-ladder-tr">🏆 ' + (d.myTrophies | 0).toLocaleString() + '</span>' +
    '</div>';
    (d.below || []).forEach(function(p) { rows += rowHtml(p, 'trophy-ladder-below'); });
    var target = d.nextTarget
      ? '<div class="trophy-ladder-target">🎯 <strong>' + esc(d.nextTarget.name) + '</strong> לפניך ב-<strong>' + (d.nextTarget.gap | 0).toLocaleString() + ' 🏆</strong> — תעקוף אותו!</div>'
      : '<div class="trophy-ladder-target trophy-ladder-target-king">👑 אתה בראש הסולם! שמור על המקום.</div>';
    var rankLine = (d.total >= 5)
      ? '<div class="trophy-ladder-rank">המקום שלך: <strong>#' + (d.rank | 0).toLocaleString() + '</strong> מתוך ' + (d.total | 0).toLocaleString() + '</div>'
      : '';
    host.innerHTML =
      '<div class="trophy-ladder-card">' +
        '<div class="trophy-ladder-title">🥊 הסולם שלך</div>' +
        rankLine +
        '<div class="trophy-ladder-rows">' + rows + '</div>' +
        target +
      '</div>';
  }

  function doMilestoneClaim(idx, btn) {
    // 2026-05-26: capture original label so error restores the gold
    // "🎁 קבל +N💎" CTA instead of the dead "🎁 שגיאה" that hardcoded
    // a permanent-looking error label.
    var originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/trophies/claim-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, milestoneIndex: idx })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (!d || !d.ok) {
          if (btn) { btn.disabled = false; btn.textContent = originalText; }
          var reason = d && d.reason;
          var msg = reason === 'already_claimed' ? 'המילסטון כבר נאסף' :
                    reason === 'not_reached' ? 'עוד לא הגעת לסף הזה' :
                    'שגיאה — נסה שוב';
          if (typeof showToast === 'function') showToast(msg, 'warning');
          return;
        }
        if (typeof d.newBalance === 'number') {
          try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.reward || 0); } catch (e) {}
        }
        try {
          if (typeof soundMilestone === 'function') soundMilestone(5);
          if (typeof buzz === 'function') buzz([60, 50, 100, 50, 140]);
        } catch (e) {}
        _trophyCache.data = null;
        // A3 — Milestone claim = guaranteed legendary chest drop.
        if (d.chestEarned) {
          setTimeout(function() {
            try { if (window.__bloomChests) window.__bloomChests.onEarned(d.chestEarned); } catch (e) {}
          }, 2000);
        }
        fetchTrophyState(true).then(function(fresh) { renderTrophyBody(fresh); updateTrophyTile(fresh); });
      });
  }

  // ─────────────────────────────────────────────────────────────
  // GAME-OVER HOOK — server-rolled trophy grant after every game.
  // Called from src/11-game.js (game-over branch). Best-effort.
  // ─────────────────────────────────────────────────────────────
  function grantTrophiesForGame(opts) {
    // opts = { score, tier, isNewBest, source, gameId }
    if (typeof window.__bloomBotActive !== 'undefined' && window.__bloomBotActive) return Promise.resolve(null);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/trophies/grant-from-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId, token: token,
        score: opts.score | 0, tier: opts.tier | 0,
        isNewBest: !!opts.isNewBest,
        source: opts.source || 'game',
        gameId: opts.gameId || ''
      })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok && d.delta !== 0) {
          showTrophyChangeToast(d);
          _trophyCache.data = null;
        }
        if (d && d.ok && d.leveledArena && d.delta > 0) {
          setTimeout(function() { showArenaPromotionOverlay(d.arena); }, 1400);
        }
        // A3 — Trophy Chest drop. Fired after the trophy toast so the
        // sequence reads clearly: trophy ticks up, then "📦 chest!"
        if (d && d.ok && d.chestEarned) {
          setTimeout(function() {
            try { if (window.__bloomChests) window.__bloomChests.onEarned(d.chestEarned); } catch (e) {}
          }, d.leveledArena ? 2800 : 1200);
        }
        return d;
      });
  }

  function showTrophyChangeToast(result) {
    var t = document.createElement('div');
    t.className = 'trophy-toast ' + (result.delta > 0 ? 'trophy-toast-up' : 'trophy-toast-down');
    var sign = result.delta > 0 ? '+' : '';
    t.innerHTML =
      '<span class="trophy-toast-icon">🏆</span>' +
      '<span class="trophy-toast-amount">' + sign + result.delta + '</span>' +
      '<span class="trophy-toast-total">→ ' + result.after.toLocaleString() + '</span>';
    document.body.appendChild(t);
    try {
      if (result.delta > 0) {
        if (typeof playTone === 'function') playTone(880, 'sine', 0.12, 0.06);
        if (typeof buzz === 'function') buzz([30, 40, 60]);
      } else {
        if (typeof playTone === 'function') playTone(220, 'sawtooth', 0.18, 0.08);
        if (typeof buzz === 'function') buzz([80]);
      }
    } catch (e) {}
    setTimeout(function() { try { t.remove(); } catch (e) {} }, 3500);
  }

  function showArenaPromotionOverlay(arena) {
    var ov = document.createElement('div');
    ov.className = 'trophy-promo-overlay';
    ov.innerHTML =
      '<div class="trophy-promo-card" style="background:radial-gradient(circle at center,' + arena.color + 'AA,#1A0F2E)">' +
        '<div class="trophy-promo-icon" style="color:' + arena.color + '">' + arena.emoji + '</div>' +
        '<div class="trophy-promo-title">קודמת לארנה חדשה!</div>' +
        '<div class="trophy-promo-arena">ארנת ' + arena.label + '</div>' +
        '<button class="trophy-promo-ok">מעולה!</button>' +
      '</div>';
    document.body.appendChild(ov);
    try {
      if (typeof soundMilestone === 'function') soundMilestone(7);
      if (typeof buzz === 'function') buzz([100, 80, 140, 80, 200]);
    } catch (e) {}
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.trophy-promo-ok').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 7000);
  }

  window.maybeShowTrophyTile = maybeShowTrophyTile;
  window.showTrophyModal = showTrophyModal;
  window.fetchTrophyState = fetchTrophyState;
  window.grantTrophiesForGame = grantTrophiesForGame;
})();
