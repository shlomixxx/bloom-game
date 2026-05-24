// ============================================================
// A7 — 7-Day Login Calendar (Genshin pattern, May 2026)
//
// Separate from the existing daily-login flow (streak-tiered rewards
// up to 200💎). This is a 7-day cycle: day 1 → 2 → ... → 7 → 1, with
// escalating rewards 50/100/200/500/1000/2000/**5000**💎. Missing a day
// resets to day 1. The huge day-7 jackpot creates loss-aversion FOMO.
//
// Surface: home tile (level 5+) showing "📅 יום N · 200💎 מחכים".
// Tap → modal with 7 cards in a row; tap the "today" card to claim.
// Auto-fire of claim NOT done — player must tap (Clash Royale pattern,
// makes the reward feel earned).
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, data: null };
  var CACHE_MS = 30 * 1000;

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
    return fetch('/api/login-cal/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) { _cache.fetchedAt = Date.now(); _cache.data = d; }
        return d;
      });
  }

  function maybeShowTile() {
    // Level gate L5+ — same as other engagement features.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 5) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var tile = document.getElementById('login-cal-tile');
      if (!tile) {
        tile = document.createElement('button');
        tile.id = 'login-cal-tile';
        tile.className = 'login-cal-tile';
        tile.onclick = function() { showCalendarModal(); };
        home.appendChild(tile);
      }
      tile.innerHTML = renderTileInner(d);
      tile.classList.toggle('has-claim', !d.claimedToday);
    });
  }

  function renderTileInner(d) {
    var today = d.cards.find(function(c) { return c.status === 'today'; });
    var reward = today ? today.reward : 0;
    var headline;
    if (d.claimedToday) {
      headline = '✓ קיבלת היום · יום ' + d.currentDay + ' / 7';
    } else if (d.willResetOnNextClaim) {
      headline = '⚠️ פספסת יום! המסלול יתחיל מ-1';
    } else {
      headline = '🎁 יום ' + d.currentDay + ' · ' + reward.toLocaleString() + '💎 מחכים!';
    }
    var miniGrid = d.cards.map(function(c) {
      var cls = 'login-cal-mini-cell login-cal-mini-' + c.status;
      var content = c.status === 'claimed' ? '✓' : (c.day === 7 ? '👑' : c.day);
      return '<span class="' + cls + '">' + content + '</span>';
    }).join('');
    return (
      '<div class="login-cal-tile-main">' +
        '<div class="login-cal-tile-title">📅 לוח כניסה</div>' +
        '<div class="login-cal-tile-sub">' + headline + '</div>' +
        '<div class="login-cal-tile-grid">' + miniGrid + '</div>' +
      '</div>' +
      '<div class="login-cal-tile-arrow">›</div>'
    );
  }

  function showCalendarModal() {
    var existing = document.getElementById('login-cal-modal');
    if (existing) { existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'login-cal-modal';
    modal.className = 'login-cal-overlay';
    modal.innerHTML =
      '<div class="login-cal-card">' +
        '<button class="login-cal-close" aria-label="סגור">×</button>' +
        '<div class="login-cal-title">📅 לוח כניסה יומי</div>' +
        '<div class="login-cal-sub">כל יום ברצף = בונוס גדל. פספסת יום? חוזרים ליום 1.</div>' +
        '<div class="login-cal-body" id="login-cal-body">' +
          '<div class="login-cal-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.login-cal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchState(true).then(renderModalBody);
  }

  function renderModalBody(d) {
    var host = document.getElementById('login-cal-body');
    if (!host) return;
    if (!d || !d.ok) {
      host.innerHTML = '<div class="login-cal-empty">שגיאה בטעינה</div>';
      return;
    }
    var cardsHtml = d.cards.map(renderDayCard).join('');
    var resetWarning = d.willResetOnNextClaim
      ? '<div class="login-cal-reset-warn">⚠️ פספסת יום מאז ' + (d.lastClaimDate || '') + ' — המסלול יתחיל מחדש כשתבע ענק היום</div>'
      : '';
    var statusLine;
    if (d.claimedToday) {
      var next7 = d.cards.find(function(c) { return c.day === 7; });
      statusLine = '<div class="login-cal-status login-cal-status-claimed">✓ קיבלת היום (יום ' + d.currentDay + '). חוזר/י מחר עבור יום ' + ((d.currentDay % 7) + 1) + '!</div>';
    } else {
      var today = d.cards.find(function(c) { return c.status === 'today'; });
      statusLine = '<div class="login-cal-status login-cal-status-active">🎁 היום: יום ' + d.currentDay + ' · ' + (today ? today.reward.toLocaleString() : '?') + '💎</div>';
    }
    host.innerHTML =
      resetWarning +
      statusLine +
      '<div class="login-cal-grid">' + cardsHtml + '</div>' +
      (!d.claimedToday
        ? '<button class="login-cal-claim-btn" id="login-cal-claim-btn">🎁 קבל ' + (d.cards.find(function(c){return c.status==='today';}).reward.toLocaleString()) + '💎 עכשיו</button>'
        : '<button class="login-cal-claim-btn" disabled>✓ נקטף היום — חזור/י מחר</button>') +
      '<div class="login-cal-tip">💡 יום 7 הוא הג׳קפוט: <strong>5,000💎</strong>. אבל אם תפספס יום — המסלול יתחיל מאחור.</div>';
    var btn = document.getElementById('login-cal-claim-btn');
    if (btn && !d.claimedToday) {
      btn.onclick = function() { doClaim(btn); };
    }
  }

  function renderDayCard(c) {
    var cls = 'login-cal-day login-cal-day-' + c.status;
    if (c.day === 7) cls += ' login-cal-day-jackpot';
    var icon;
    if (c.status === 'claimed') icon = '✓';
    else if (c.day === 7) icon = '👑';
    else if (c.status === 'today') icon = '🎁';
    else icon = c.day;
    return (
      '<div class="' + cls + '">' +
        '<div class="login-cal-day-num">יום ' + c.day + '</div>' +
        '<div class="login-cal-day-icon">' + icon + '</div>' +
        '<div class="login-cal-day-reward">' + c.reward.toLocaleString() + '💎</div>' +
      '</div>'
    );
  }

  function doClaim(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ מתעדכן...'; }
    fetch('/api/login-cal/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken() })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (btn) { btn.disabled = false; btn.textContent = '🎁 נסה שוב'; }
        if (typeof showToast === 'function') showToast('שגיאה: ' + ((d && d.reason) || 'unknown'), 'error');
        return;
      }
      // Update local balance + widget bump.
      if (typeof d.newBalance === 'number') {
        try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
        try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        try { if (window.__bloomBumpBal) window.__bloomBumpBal(d.newBalance, d.reward); } catch (e) {}
      }
      // Celebration. Day 7 = legendary; days 5-6 = epic; lower = normal.
      var tier = d.day >= 7 ? 'jackpot' : (d.day >= 5 ? 'big' : 'normal');
      showClaimCelebration(d.day, d.reward, tier, d.wasReset);
      // Refresh state + tile.
      _cache.fetchedAt = 0;
      fetchState(true).then(function(fresh) {
        renderModalBody(fresh);
        maybeShowTile();
      });
    });
  }

  function showClaimCelebration(day, reward, tier, wasReset) {
    var ov = document.createElement('div');
    ov.className = 'login-cal-celeb-overlay';
    var emoji = tier === 'jackpot' ? '👑' : (tier === 'big' ? '🎁' : '✨');
    var confettiCount = tier === 'jackpot' ? 50 : (tier === 'big' ? 24 : 10);
    var conf = '';
    for (var i = 0; i < confettiCount; i++) {
      var x = Math.random() * 100;
      var delay = Math.random() * 0.4;
      var color = tier === 'jackpot' ? '#FFD93D' : (tier === 'big' ? '#FF8DA1' : '#7A5FE0');
      conf += '<span class="login-cal-conf" style="left:' + x + '%;background:' + color + ';animation-delay:' + delay + 's"></span>';
    }
    ov.innerHTML =
      conf +
      '<div class="login-cal-celeb-card login-cal-celeb-' + tier + '">' +
        '<div class="login-cal-celeb-emoji">' + emoji + '</div>' +
        '<div class="login-cal-celeb-title">יום ' + day + (tier === 'jackpot' ? ' — ג׳קפוט!' : '') + '</div>' +
        '<div class="login-cal-celeb-amount">+' + reward.toLocaleString() + '💎</div>' +
        (wasReset ? '<div class="login-cal-celeb-note">🔄 המסלול התחיל מחדש</div>' : '') +
      '</div>';
    document.body.appendChild(ov);
    try { if (typeof soundMilestone === 'function') soundMilestone(tier === 'jackpot' ? 7 : (tier === 'big' ? 5 : 3)); } catch (e) {}
    try { if (typeof buzz === 'function') buzz(tier === 'jackpot' ? [80,60,100,60,120,80,140] : (tier === 'big' ? [60,40,80] : [40,30,60])); } catch (e) {}
    ov.onclick = function() { try { ov.remove(); } catch (e) {} };
    setTimeout(function() { try { ov.remove(); } catch (e) {} }, tier === 'jackpot' ? 5500 : 3500);
  }

  try {
    window.__bloomLoginCal = {
      maybeShow: maybeShowTile,
      open: showCalendarModal,
      refresh: function() { return fetchState(true); }
    };
  } catch (e) {}
})();
