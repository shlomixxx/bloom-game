// ============================================================
// Stage 36 — Daily Spin Wheel (May 2026)
// One spin per day per device. Variable-reward Skinner box wrapped
// in a satisfying physical-wheel animation. The single most
// addictive daily-return mechanic in F2P — Coin Master built a
// $1B/year business on this exact pattern.
//
// Architecture: home tile → click → big modal with SVG wheel →
// click SPIN → server rolls + grants atomically → wheel CSS-
// rotates 4-6 full turns and decelerates to the picked segment →
// confetti + sound + buzz scaled by reward tier → reward card pop.
// ============================================================
(function() {
  var _spinCache = { data: null, fetchedAt: 0 };
  var _spinning = false;

  function fetchSpinState(force) {
    if (!force && _spinCache.data && (Date.now() - _spinCache.fetchedAt) < 60000) {
      return Promise.resolve(_spinCache.data);
    }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/spin/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) { _spinCache.data = d; _spinCache.fetchedAt = Date.now(); }
        return d;
      });
  }

  function maybeShowSpinTile() {
    // T1.1 — Daily Spin unlocks at L12 (matches Season Pass — both are
    // engagement engines the player should meet after the basics click).
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 12) return; } catch (e) {}
    fetchSpinState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('spin-home-tile')) { updateSpinTile(d); return; }
      mountSpinTile(home, d);
    });
  }

  function mountSpinTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'spin-home-tile';
    tile.className = 'spin-home-tile' + (data.canSpin ? ' has-spin' : '');
    tile.innerHTML = renderTileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showSpinModal(); };
  }

  function updateSpinTile(data) {
    var tile = document.getElementById('spin-home-tile');
    if (!tile) return;
    tile.className = 'spin-home-tile' + (data.canSpin ? ' has-spin' : '');
    tile.innerHTML = renderTileInner(data);
  }

  function renderTileInner(data) {
    var subtitle = '';
    if (data.canSpin) {
      var streakHint = data.currentStreak > 0
        ? ' · רצף ' + data.currentStreak + ' ימים +' + Math.min(data.currentStreak * data.streakBonusPct, data.streakBonusMaxPct) + '%'
        : '';
      subtitle = '🎁 ספין חינם זמין' + streakHint;
    } else {
      var last = data.lastReward;
      var hint = last ? ('זכית ב-' + last.label) : '';
      subtitle = '✓ שיחקת היום · ' + hint + ' · חזור מחר';
    }
    return (
      '<span class="spin-tile-wheel">🎡</span>' +
      '<span class="spin-tile-body">' +
        '<span class="spin-tile-title">גלגל יומי' + (data.canSpin ? '<span class="spin-tile-badge">🎁 חינם</span>' : '') + '</span>' +
        '<span class="spin-tile-sub">' + subtitle + '</span>' +
      '</span>' +
      '<span class="spin-tile-arrow">›</span>'
    );
  }

  function showSpinModal() {
    var ex = document.getElementById('spin-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'spin-modal';
    modal.className = 'spin-modal-overlay';
    modal.innerHTML =
      '<div class="spin-modal-card">' +
        '<button class="spin-modal-close" aria-label="סגור">×</button>' +
        '<div class="spin-modal-title">🎡 גלגל היום</div>' +
        '<div class="spin-modal-sub">סובב פעם ביום וזכה בפרס משתנה</div>' +
        '<div class="spin-modal-body" id="spin-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.spin-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchSpinState(true).then(function(d) { renderSpinBody(d); });
  }

  function renderSpinBody(data) {
    var host = document.getElementById('spin-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">המערכת כבויה</div>';
      return;
    }
    var segs = data.segments || [];
    if (!segs.length) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">אין segments מוגדרים</div>';
      return;
    }
    var streakHtml = '';
    if (data.currentStreak > 0) {
      var bonusPct = Math.min(data.currentStreak * data.streakBonusPct, data.streakBonusMaxPct);
      streakHtml =
        '<div class="spin-streak-card">' +
          '<div class="spin-streak-icon">🔥</div>' +
          '<div class="spin-streak-body">' +
            '<div class="spin-streak-title">רצף ' + data.currentStreak + ' ימים</div>' +
            '<div class="spin-streak-sub">בונוס +' + bonusPct + '% על פרסי 💎</div>' +
          '</div>' +
        '</div>';
    }
    var nextBonusPct = Math.min((data.currentStreak + 1) * data.streakBonusPct, data.streakBonusMaxPct);
    var nextHint = data.canSpin
      ? ''
      : '<div class="spin-next-hint">⏰ סובב שוב מחר — תקבל בונוס +' + nextBonusPct + '% על 💎 (רצף ' + (data.currentStreak + 1) + ' ימים)</div>';
    var wheelSvg = renderWheelSvg(segs);
    var btnHtml = data.canSpin
      ? '<button class="spin-btn" id="spin-do-btn">🎡 סובב!</button>'
      : '<button class="spin-btn spin-btn-disabled" disabled>✓ שיחקת היום</button>';
    var statsHtml =
      '<div class="spin-stats">' +
        '<div class="spin-stat"><span class="spin-stat-num">' + (data.totalSpins || 0) + '</span><span class="spin-stat-lbl">סך הכל</span></div>' +
        '<div class="spin-stat"><span class="spin-stat-num">' + (data.longestStreak || 0) + '</span><span class="spin-stat-lbl">רצף שיא</span></div>' +
        '<div class="spin-stat"><span class="spin-stat-num">' + (data.totalGemsWon || 0).toLocaleString() + '</span><span class="spin-stat-lbl">💎 הרווחת</span></div>' +
      '</div>';
    host.innerHTML =
      streakHtml +
      '<div class="spin-wheel-wrap" id="spin-wheel-wrap">' + wheelSvg + '</div>' +
      btnHtml +
      nextHint +
      statsHtml;

    var spinBtn = document.getElementById('spin-do-btn');
    if (spinBtn) spinBtn.onclick = doSpin;
  }

  function renderWheelSvg(segs) {
    // 12 segments around a 320px circle. Each segment = 30 degrees.
    var SIZE = 320;
    var R = SIZE / 2;
    var CX = R, CY = R;
    var n = segs.length;
    var per = 360 / n;
    var paths = '';
    var labels = '';
    for (var i = 0; i < n; i++) {
      var startAng = (i * per - 90) * Math.PI / 180; // top = 0
      var endAng = ((i + 1) * per - 90) * Math.PI / 180;
      var x1 = CX + R * Math.cos(startAng);
      var y1 = CY + R * Math.sin(startAng);
      var x2 = CX + R * Math.cos(endAng);
      var y2 = CY + R * Math.sin(endAng);
      var largeArc = per > 180 ? 1 : 0;
      var d = 'M' + CX + ',' + CY + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' A' + R + ',' + R + ' 0 ' + largeArc + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z';
      paths += '<path d="' + d + '" fill="' + (segs[i].color || '#FFD3D3') + '" stroke="rgba(255,255,255,0.6)" stroke-width="2"/>';
      // Label in the middle of each segment, slightly outward.
      var midAng = ((i + 0.5) * per - 90) * Math.PI / 180;
      var tx = CX + R * 0.65 * Math.cos(midAng);
      var ty = CY + R * 0.65 * Math.sin(midAng);
      var rot = (i + 0.5) * per;
      labels += '<g transform="translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ') rotate(' + rot.toFixed(2) + ')">' +
        '<text text-anchor="middle" font-size="20" dominant-baseline="middle" fill="#FFF" font-weight="700" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" paint-order="stroke">' + (segs[i].emoji || '✨') + '</text>' +
        '<text text-anchor="middle" font-size="11" dominant-baseline="middle" y="16" fill="#FFF" font-weight="800" stroke="rgba(0,0,0,0.5)" stroke-width="0.5" paint-order="stroke">' + (segs[i].label || '').slice(0, 8) + '</text>' +
      '</g>';
    }
    return '<div class="spin-wheel-frame">' +
      '<svg viewBox="0 0 ' + SIZE + ' ' + SIZE + '" class="spin-wheel-svg" id="spin-wheel-svg">' +
        '<g class="spin-wheel-rotate" id="spin-wheel-rotate" style="transform-origin: ' + CX + 'px ' + CY + 'px">' +
          paths +
          labels +
        '</g>' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="4"/>' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="28" fill="#FFF" stroke="rgba(0,0,0,0.25)" stroke-width="3"/>' +
        '<text x="' + CX + '" y="' + (CY + 5) + '" text-anchor="middle" font-size="20" font-weight="900">🎁</text>' +
      '</svg>' +
      '<div class="spin-wheel-pointer">▼</div>' +
    '</div>';
  }

  function doSpin() {
    if (_spinning) return;
    _spinning = true;
    var btn = document.getElementById('spin-do-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ מסובב...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/spin/today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (!d || !d.ok) {
          _spinning = false;
          if (btn) { btn.disabled = false; btn.innerHTML = '🎡 סובב!'; }
          if (d && d.reason === 'already_spun_today') showToast('כבר סובבת היום! חזור מחר.', 'info');
          else showToast(d && d.reason ? d.reason : 'שגיאה', 'error');
          return;
        }
        animateAndReveal(d);
      });
  }

  function animateAndReveal(result) {
    var reward = result.reward;
    var data = _spinCache.data || {};
    var segs = data.segments || [];
    var idx = segs.findIndex(function(s) { return s.index === reward.segment; });
    if (idx < 0) idx = 0;
    var n = segs.length;
    var per = 360 / n;
    // We want segment idx to land at the top (pointer position).
    // Top = -90deg in our coord system, but the SVG already places i=0 at top.
    // So target angle = -(idx + 0.5) * per to put the middle of segment idx under the pointer.
    // Plus N full rotations for the "spinning" effect.
    var FULL_TURNS = 5;
    var targetAngle = -((idx + 0.5) * per) - (FULL_TURNS * 360);
    var rotateEl = document.getElementById('spin-wheel-rotate');
    if (!rotateEl) return;
    rotateEl.style.transition = 'transform 4.2s cubic-bezier(0.17, 0.67, 0.21, 0.99)';
    rotateEl.style.transform = 'rotate(' + targetAngle + 'deg)';
    // Soft tick sounds as it spins (decreasing in frequency).
    var tickTimes = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900];
    tickTimes.forEach(function(t) {
      setTimeout(function() { try { if (typeof playTone === 'function') playTone(700, 'square', 0.04, 0.04); } catch (e) {} }, t);
    });
    setTimeout(function() { revealReward(reward, result); }, 4400);
  }

  function revealReward(reward, result) {
    _spinning = false;
    var modal = document.getElementById('spin-modal');
    if (!modal) return;
    // Build a reward overlay.
    var ov = document.createElement('div');
    ov.className = 'spin-reward-overlay';
    var bonusBadge = reward.streakBonusPct > 0
      ? '<div class="spin-reward-bonus">🔥 +' + reward.streakBonusPct + '% רצף!</div>'
      : '';
    var typeLabel = ({
      gems: '💎 מטבעות',
      bp_xp: '🎖 XP פס קרב',
      freeze: '🛡 הקפאת רצף',
      chest: '🎁 צ׳סט מסתורי',
      jackpot: '🏆 ג׳קפוט!'
    })[reward.type] || '🎁 פרס';
    var tierCls = (reward.type === 'jackpot' ? 'jackpot' : (reward.amount >= 500 ? 'huge' : (reward.amount >= 100 ? 'big' : 'small')));
    ov.innerHTML =
      '<div class="spin-reward-card spin-reward-card-' + tierCls + '" style="background:linear-gradient(160deg,' + (reward.color || '#F5C24B') + ',rgba(255,255,255,0.95))">' +
        '<div class="spin-reward-emoji">' + (reward.emoji || '🎁') + '</div>' +
        '<div class="spin-reward-type">' + typeLabel + '</div>' +
        '<div class="spin-reward-amount">+' + (reward.amount || 0).toLocaleString() + '</div>' +
        bonusBadge +
        '<button class="spin-reward-ok">מעולה!</button>' +
      '</div>';
    modal.appendChild(ov);
    // Sound + buzz scaled to tier.
    try {
      if (reward.type === 'jackpot') {
        if (typeof soundMilestone === 'function') soundMilestone(7);
        if (typeof buzz === 'function') buzz([120, 80, 160, 80, 200, 80, 240]);
        spawnConfetti(ov, 32);
      } else if (tierCls === 'huge') {
        if (typeof soundMilestone === 'function') soundMilestone(5);
        if (typeof buzz === 'function') buzz([80, 60, 120, 60, 160]);
        spawnConfetti(ov, 20);
      } else if (tierCls === 'big') {
        if (typeof soundMilestone === 'function') soundMilestone(4);
        if (typeof buzz === 'function') buzz([60, 40, 100]);
        spawnConfetti(ov, 12);
      } else {
        if (typeof soundMilestone === 'function') soundMilestone(2);
        if (typeof buzz === 'function') buzz([40, 30, 60]);
      }
    } catch (e) {}
    // Update local balance + streak-freeze count + cache invalidate.
    if (typeof result.newBalance === 'number') {
      try { if (typeof playerBalance !== 'undefined') playerBalance = result.newBalance; } catch (e) {}
      try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
    }
    if (reward.type === 'freeze') {
      try {
        if (typeof addStreakFreeze === 'function') addStreakFreeze(reward.amount);
        else {
          var cur = parseInt(localStorage.getItem('bloom_dyn_freezes') || '0', 10) | 0;
          localStorage.setItem('bloom_dyn_freezes', String(cur + reward.amount));
        }
      } catch (e) {}
    }
    _spinCache.data = null; // force re-fetch
    var okBtn = ov.querySelector('.spin-reward-ok');
    okBtn.onclick = function() {
      try { ov.remove(); } catch (e) {}
      // Re-render modal body in claimed state + update tile.
      fetchSpinState(true).then(function(d) { renderSpinBody(d); updateSpinTile(d); });
    };
  }

  function spawnConfetti(host, count) {
    var colors = ['#F5C24B', '#FF6B9D', '#7AB8E0', '#9FE1CB', '#FFD93D', '#C9437E'];
    for (var i = 0; i < count; i++) {
      var c = document.createElement('span');
      c.className = 'spin-confetti';
      c.style.background = colors[i % colors.length];
      c.style.left = (40 + Math.random() * 20) + '%';
      c.style.animationDelay = (Math.random() * 0.4) + 's';
      var dx = (Math.random() - 0.5) * 400;
      var dy = -200 - Math.random() * 200;
      c.style.setProperty('--confetti-dx', dx + 'px');
      c.style.setProperty('--confetti-dy', dy + 'px');
      host.appendChild(c);
      (function(el) { setTimeout(function() { try { el.remove(); } catch (e) {} }, 1800); })(c);
    }
  }

  window.maybeShowSpinTile = maybeShowSpinTile;
  window.showSpinModal = showSpinModal;
  window.fetchSpinState = fetchSpinState;
})();
