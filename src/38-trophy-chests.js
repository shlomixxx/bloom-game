// ============================================================
// A3 — Trophy Chests (Clash Royale "must-return" pattern, May 2026)
//
// After a good game (score ≥ threshold), the server MAY grant a chest
// (common/rare/legendary by weight). Chests sit "earned" in 4 slots.
// The player taps "התחל לפתוח" → real-time countdown starts. They must
// return N hours later to "פתח" + collect gems.
//
// Why: this is THE must-return loop in Clash Royale / Coin Master.
// Industry data shows 2-3× DAU lift from this single mechanic. Builds
// on Stage 38 Trophy Road (already shipped).
//
// Server endpoints:
//   GET  /api/chests/state       — list 4 slots + status of each
//   POST /api/chests/start-unlock — begin the countdown
//   POST /api/chests/open         — collect ripe chest
//
// Earn integration: hooked into /api/trophies/grant-from-game which
// returns a `chestEarned` object when a chest dropped. Trophy milestone
// claims also force-grant a legendary chest.
//
// This module is a standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, data: null };
  var CACHE_MS = 30 * 1000;
  var _bannerTicker = null;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }

  function fetchChestState(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve(_cache.data);
    }
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/chests/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _cache.fetchedAt = Date.now();
          _cache.data = d;
        }
        return d;
      });
  }

  // Mount or refresh the home tile. Hidden when no chests exist (so
  // the tile doesn't add visual noise for a new player). Level-gated
  // at L10 (alongside Trophy Road).
  function maybeShowChestTile() {
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 10) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchChestState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.chests || !d.chests.length) {
        // No chests → remove tile if present.
        var existing = document.getElementById('chest-home-tile');
        if (existing) existing.remove();
        stopBannerTicker();
        return;
      }
      var tile = document.getElementById('chest-home-tile');
      if (!tile) {
        tile = document.createElement('button');
        tile.id = 'chest-home-tile';
        tile.className = 'chest-home-tile';
        tile.onclick = function() { showChestsModal(); };
        home.appendChild(tile);
      }
      tile.innerHTML = renderChestTileInner(d);
      // Pulse if any chest is ready.
      tile.classList.toggle('has-ready', d.chests.some(function(c) { return c.status === 'ready'; }));
      startBannerTicker();
    });
  }

  function renderChestTileInner(d) {
    var ready = d.chests.filter(function(c) { return c.status === 'ready'; });
    var unlocking = d.chests.filter(function(c) { return c.status === 'unlocking'; });
    var earned = d.chests.filter(function(c) { return c.status === 'earned'; });
    var statusText;
    if (ready.length) statusText = '🎁 ' + ready.length + ' מוכן לפתיחה!';
    else if (unlocking.length) statusText = '⏰ ' + unlocking.length + ' בפתיחה · ' + formatMsLeft(unlocking[0].msLeft);
    else statusText = '📦 ' + earned.length + ' תיבות מחכות';
    var iconsRow = d.chests.map(function(c) {
      var emoji = chestEmoji(c.type);
      var cls = 'chest-tile-icon chest-tile-icon-' + c.status;
      return '<span class="' + cls + '">' + emoji + '</span>';
    }).join('');
    return (
      '<span class="chest-tile-main">' +
        '<span class="chest-tile-title">📦 תיבות גביעים</span>' +
        '<span class="chest-tile-sub">' + statusText + '</span>' +
      '</span>' +
      '<span class="chest-tile-icons">' + iconsRow + '</span>' +
      '<span class="chest-tile-arrow">›</span>'
    );
  }

  function chestEmoji(type) {
    if (type === 'legendary') return '🏆';
    if (type === 'rare') return '💎';
    return '🎁';
  }
  function chestLabel(type) {
    if (type === 'legendary') return 'אגדי';
    if (type === 'rare') return 'נדיר';
    return 'רגיל';
  }
  function chestColor(type) {
    if (type === 'legendary') return '#FFD93D';
    if (type === 'rare') return '#7A5FE0';
    return '#A8A29E';
  }

  function showChestsModal() {
    var existing = document.getElementById('chests-modal');
    if (existing) { existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'chests-modal';
    modal.className = 'chests-modal-overlay';
    modal.innerHTML =
      '<div class="chests-modal-card">' +
        '<button class="chests-modal-close" aria-label="סגור">×</button>' +
        '<div class="chests-modal-title">📦 תיבות גביעים</div>' +
        '<div class="chests-modal-sub">משחקים טובים = תיבות. תיבה אחת פותחת בכל פעם.</div>' +
        '<div class="chests-modal-body" id="chests-modal-body">' +
          '<div class="chests-modal-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.chests-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchChestState(true).then(renderChestsModalBody);
  }

  function renderChestsModalBody(d) {
    var host = document.getElementById('chests-modal-body');
    if (!host) return;
    if (!d || !d.ok || !d.enabled) {
      host.innerHTML = '<div class="chests-modal-empty">מערכת התיבות כבויה</div>';
      return;
    }
    var maxSlots = d.maxSlots || 4;
    // Build slot rows: filled with chests, then empty placeholders.
    var cards = [];
    d.chests.forEach(function(c) {
      cards.push(renderChestCard(c, d.tiers));
    });
    while (cards.length < maxSlots) {
      cards.push(renderEmptySlot());
    }
    host.innerHTML =
      '<div class="chests-modal-tip">' +
        'כל ' + maxSlots + ' המקומות מלאים? תיבות חדשות לא יגיעו עד שתפתח. אגדי = ' + (d.tiers.legendary.gemsMin) + '-' + (d.tiers.legendary.gemsMax) + '💎.' +
      '</div>' +
      '<div class="chests-modal-grid">' + cards.join('') + '</div>';
    wireChestCards(host);
  }

  function renderChestCard(c, tiers) {
    var emoji = chestEmoji(c.type);
    var color = chestColor(c.type);
    var label = chestLabel(c.type);
    var tier = tiers[c.type] || { minutes: 0, gemsMin: 0, gemsMax: 0 };
    if (c.status === 'earned') {
      return (
        '<div class="chest-card chest-card-' + c.type + '" data-chest-id="' + c.id + '" style="border-color:' + color + '">' +
          '<div class="chest-card-emoji">' + emoji + '</div>' +
          '<div class="chest-card-label" style="color:' + color + '">' + label + '</div>' +
          '<div class="chest-card-reward">' + tier.gemsMin + '-' + tier.gemsMax + '💎</div>' +
          '<div class="chest-card-time">⏰ ' + formatHours(tier.minutes) + ' פתיחה</div>' +
          '<button class="chest-card-btn chest-card-btn-start" data-chest-action="start" data-chest-id="' + c.id + '">▶ התחל לפתוח</button>' +
        '</div>'
      );
    }
    if (c.status === 'unlocking') {
      return (
        '<div class="chest-card chest-card-' + c.type + ' chest-card-unlocking" data-chest-id="' + c.id + '" style="border-color:' + color + '">' +
          '<div class="chest-card-emoji chest-card-emoji-shake">' + emoji + '</div>' +
          '<div class="chest-card-label" style="color:' + color + '">' + label + '</div>' +
          '<div class="chest-card-countdown" data-chest-msleft="' + c.msLeft + '" data-chest-opensat="' + c.opensAt + '">' + formatMsLeft(c.msLeft) + '</div>' +
          '<div class="chest-card-progress"><div class="chest-card-progress-fill" style="width:' + computeProgressPct(c, tier) + '%;background:' + color + '"></div></div>' +
        '</div>'
      );
    }
    if (c.status === 'ready') {
      return (
        '<div class="chest-card chest-card-' + c.type + ' chest-card-ready" data-chest-id="' + c.id + '" style="border-color:' + color + ';box-shadow:0 0 24px ' + color + '88">' +
          '<div class="chest-card-emoji chest-card-emoji-bounce">' + emoji + '</div>' +
          '<div class="chest-card-label" style="color:' + color + '">' + label + '</div>' +
          '<div class="chest-card-reward chest-card-reward-ready">' + c.rewardGems + '💎</div>' +
          '<button class="chest-card-btn chest-card-btn-open" data-chest-action="open" data-chest-id="' + c.id + '">🎁 פתח עכשיו!</button>' +
        '</div>'
      );
    }
    return '';
  }
  function renderEmptySlot() {
    return (
      '<div class="chest-card chest-card-empty">' +
        '<div class="chest-card-emoji chest-card-emoji-empty">📭</div>' +
        '<div class="chest-card-empty-label">משחק טוב = תיבה</div>' +
      '</div>'
    );
  }

  function computeProgressPct(c, tier) {
    if (!c.opensAt || !c.unlockStartedAt) return 0;
    var startMs = new Date(c.unlockStartedAt).getTime();
    var endMs = new Date(c.opensAt).getTime();
    var nowMs = Date.now();
    var span = endMs - startMs;
    if (span <= 0) return 100;
    var elapsed = nowMs - startMs;
    return Math.max(0, Math.min(100, Math.round(elapsed / span * 100)));
  }

  function wireChestCards(host) {
    host.querySelectorAll('[data-chest-action]').forEach(function(btn) {
      btn.onclick = function() {
        var action = btn.getAttribute('data-chest-action');
        var chestId = parseInt(btn.getAttribute('data-chest-id'), 10);
        if (!chestId) return;
        if (action === 'start') startUnlock(chestId, btn);
        else if (action === 'open') openChest(chestId, btn);
      };
    });
  }

  function startUnlock(chestId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    fetch('/api/chests/start-unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken(), chestId: chestId })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (d && d.ok) {
        try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([30, 20, 40]); } catch (e) {}
        fetchChestState(true).then(renderChestsModalBody).then(maybeShowChestTile);
      } else {
        if (btn) { btn.disabled = false; btn.textContent = '▶ התחל לפתוח'; }
        var reason = (d && d.reason) || 'error';
        if (reason === 'another_unlocking') {
          if (typeof showToast === 'function') showToast('יש תיבה אחרת בפתיחה — חכה שתסיים', 'warning');
          else alert('יש תיבה אחרת בפתיחה — חכה שתסיים');
        } else {
          if (typeof showToast === 'function') showToast('שגיאה: ' + reason, 'error');
        }
      }
    });
  }

  function openChest(chestId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    fetch('/api/chests/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken(), chestId: chestId })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (d && d.ok) {
        // Big celebration!
        showChestOpenCelebration(d.chestType, d.rewardGems);
        if (typeof d.newBalance === 'number') {
          try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          try { if (window.__bloomBumpBal) window.__bloomBumpBal(d.newBalance, d.rewardGems); } catch (e) {}
        }
        setTimeout(function() {
          fetchChestState(true).then(renderChestsModalBody).then(maybeShowChestTile);
        }, 1500);
      } else {
        if (btn) { btn.disabled = false; btn.textContent = '🎁 פתח עכשיו!'; }
        if (typeof showToast === 'function') showToast('שגיאה: ' + ((d && d.reason) || 'error'), 'error');
      }
    });
  }

  // Full-screen celebration when a chest opens. Rarity-themed: legendary
  // gets confetti + bigger animation, common is more subtle.
  function showChestOpenCelebration(type, gems) {
    var color = chestColor(type);
    var emoji = chestEmoji(type);
    var label = chestLabel(type);
    var ov = document.createElement('div');
    ov.className = 'chest-celebration-overlay';
    ov.style.background = 'radial-gradient(circle, ' + color + '88 0%, rgba(0,0,0,0.85) 100%)';
    var confettiCount = type === 'legendary' ? 40 : (type === 'rare' ? 24 : 12);
    var confetti = '';
    for (var i = 0; i < confettiCount; i++) {
      var x = Math.random() * 100;
      var delay = Math.random() * 0.4;
      confetti += '<span class="chest-conf" style="left:' + x + '%;background:' + color + ';animation-delay:' + delay + 's"></span>';
    }
    ov.innerHTML =
      confetti +
      '<div class="chest-celeb-card" style="border-color:' + color + '">' +
        '<div class="chest-celeb-emoji" style="color:' + color + '">' + emoji + '</div>' +
        '<div class="chest-celeb-label" style="color:' + color + '">' + label + '</div>' +
        '<div class="chest-celeb-gems">+' + gems.toLocaleString() + '💎</div>' +
        '<div class="chest-celeb-hint">לחץ להמשך</div>' +
      '</div>';
    document.body.appendChild(ov);
    try { if (typeof soundMilestone === 'function') soundMilestone(type === 'legendary' ? 7 : (type === 'rare' ? 5 : 3)); } catch (e) {}
    try { if (typeof buzz === 'function') buzz(type === 'legendary' ? [80,60,100,60,120,80,140] : (type === 'rare' ? [60,40,80,60,100] : [40,30,60])); } catch (e) {}
    ov.onclick = function() { try { ov.remove(); } catch (e) {} };
    setTimeout(function() { try { ov.remove(); } catch (e) {} }, type === 'legendary' ? 6000 : 4000);
  }

  // Repaint countdowns every second while the modal or tile is mounted.
  function startBannerTicker() {
    stopBannerTicker();
    _bannerTicker = setInterval(function() {
      var anyAlive = false;
      // Update tile sub-line
      var tile = document.getElementById('chest-home-tile');
      if (tile && _cache.data) {
        var unlocking = (_cache.data.chests || []).filter(function(c) { return c.status === 'unlocking'; });
        if (unlocking.length) {
          unlocking[0].msLeft = Math.max(0, new Date(unlocking[0].opensAt).getTime() - Date.now());
          if (unlocking[0].msLeft <= 0) {
            // Refresh state — chest now ready.
            fetchChestState(true).then(maybeShowChestTile);
          } else {
            tile.innerHTML = renderChestTileInner(_cache.data);
            anyAlive = true;
          }
        }
      }
      // Update modal cards
      document.querySelectorAll('.chest-card-countdown').forEach(function(el) {
        var opensAt = el.getAttribute('data-chest-opensat');
        if (!opensAt) return;
        var msLeft = new Date(opensAt).getTime() - Date.now();
        if (msLeft <= 0) {
          // Refresh modal.
          fetchChestState(true).then(renderChestsModalBody);
        } else {
          el.textContent = formatMsLeft(msLeft);
          anyAlive = true;
        }
      });
      if (!anyAlive) stopBannerTicker();
    }, 1000);
  }
  function stopBannerTicker() {
    if (_bannerTicker) { clearInterval(_bannerTicker); _bannerTicker = null; }
  }

  function formatMsLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'מוכן!';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + 'ש ' + pad(m) + 'ד';
    if (m > 0) return m + 'ד ' + pad(s) + 'ש';
    return s + 'ש';
  }
  function formatHours(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h && m) return h + 'ש ' + m + 'ד';
    if (h) return h + ' שעות';
    return m + ' דקות';
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // Game-over hook — fire-and-forget toast when chestEarned is returned
  // from /api/trophies/grant-from-game. Stage 38 client already does
  // the grant; we hook into the response by exposing a window helper
  // that the trophy module calls.
  function onChestEarnedFromGame(chestInfo) {
    if (!chestInfo) return;
    try { if (typeof showToast === 'function') showToast('📦 קיבלת תיבת ' + chestLabel(chestInfo.type) + '!', 'success'); } catch (e) {}
    try { if (typeof soundMilestone === 'function') soundMilestone(chestInfo.type === 'legendary' ? 6 : 4); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([50, 30, 80]); } catch (e) {}
    // Refresh tile + modal if open.
    fetchChestState(true).then(maybeShowChestTile);
    if (document.getElementById('chests-modal')) {
      fetchChestState(true).then(renderChestsModalBody);
    }
  }

  try {
    window.__bloomChests = {
      maybeShow: maybeShowChestTile,
      open: showChestsModal,
      onEarned: onChestEarnedFromGame
    };
  } catch (e) {}
})();
