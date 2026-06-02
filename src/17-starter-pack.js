// ============================================================
// Stage 20 — Starter Pack (May 2026)
// First-purchase funnel: triggers after the player crosses a score
// threshold for the first time. 7-day countdown. One-time per device.
// The highest-conversion offer in F2P puzzle games (50-90% buy-through).
// ============================================================
(function() {
  var _starterPackCache = { data: null, fetchedAt: 0 };
  var _starterPackCheckInFlight = false;

  function fetchStarterPackStatus(reportedScore) {
    if (_starterPackCheckInFlight) return Promise.resolve(_starterPackCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _starterPackCheckInFlight = true;
    var url = '/api/player/starter-pack/status?deviceId=' + encodeURIComponent(deviceId);
    if (typeof reportedScore === 'number' && reportedScore > 0) {
      url += '&score=' + reportedScore;
    }
    return fetch(url)
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        _starterPackCheckInFlight = false;
        if (d && d.ok) {
          _starterPackCache.data = d;
          _starterPackCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function bestKnownScore() {
    // Use the player's local best (from localStorage) as the trigger
    // signal. Stored by the game-over flow.
    try {
      var raw = localStorage.getItem(BEST_KEY);
      var n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    } catch (e) {}
    return 0;
  }

  // Public: called on home mount + after game-over to check if the
  // banner should show. Throttled — no more than one check per minute.
  var _lastCheckAt = 0;
  function maybeOfferStarterPack(scoreOverride) {
    if (Date.now() - _lastCheckAt < 60 * 1000) return;
    _lastCheckAt = Date.now();
    var score = (typeof scoreOverride === 'number' && scoreOverride > 0) ? scoreOverride : bestKnownScore();
    fetchStarterPackStatus(score).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.available) return;
      // The banner sits at the top of the home screen. We only render
      // it if the home is currently mounted.
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (home && !document.getElementById('starter-pack-home-banner')) {
        mountStarterPackHomeBanner(home, d);
      }
    });
  }

  function fmtSpCountdown(expiresAt) {
    var ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'פג תוקף';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) {
      var d = Math.floor(h / 24);
      var hLeft = h % 24;
      return d + 'י ' + hLeft + 'ש';
    }
    return h + 'ש ' + m + 'ד';
  }

  function mountStarterPackHomeBanner(homeEl, data) {
    var banner = document.createElement('div');
    banner.id = 'starter-pack-home-banner';
    banner.className = 'starter-pack-home-banner';
    banner.innerHTML =
      '<div class="sp-banner-icon">🎁</div>' +
      '<div class="sp-banner-body">' +
        '<div class="sp-banner-title">' + (data.name || '🎁 חבילת פתיחה') + ' — חד-פעמית!</div>' +
        '<div class="sp-banner-sub">' +
          '<span class="sp-banner-perks">' + data.rewardGems.toLocaleString() + '💎 + סקין + ' + data.rewardBpTiers + ' דרגות BP</span>' +
          ' · ' +
          '<span class="sp-banner-countdown" data-expires="' + data.expiresAt + '">⏰ ' + fmtSpCountdown(data.expiresAt) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="sp-banner-cta">פתח →</button>';
    // Insert at the top of the home content (after the brand/header).
    var firstChild = homeEl.firstChild;
    homeEl.insertBefore(banner, firstChild);
    banner.querySelector('.sp-banner-cta').onclick = function() { showStarterPackModal(data); };
    // No dismiss/✕ — this is a feature surface, not a deletable notification.
    // It auto-hides on purchase or after the 7-day window expires.
    banner.addEventListener('click', function(e) {
      if (e.target === banner || e.target.classList.contains('sp-banner-body') || e.target.classList.contains('sp-banner-icon')) {
        showStarterPackModal(data);
      }
    });
    // Countdown ticker — re-renders the time every 60s.
    var countdownEl = banner.querySelector('.sp-banner-countdown');
    var ticker = setInterval(function() {
      if (!document.body.contains(banner)) { clearInterval(ticker); return; }
      countdownEl.textContent = '⏰ ' + fmtSpCountdown(data.expiresAt);
    }, 60 * 1000);
  }

  function dismissStarterPack() {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return;
    fetch('/api/player/starter-pack/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).catch(function() {});
  }

  function showStarterPackModal(data) {
    // Close existing if any.
    var ex = document.getElementById('starter-pack-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'starter-pack-modal';
    modal.className = 'starter-pack-modal-overlay';
    // Resolve skin display name (best-effort).
    var skinName = data.rewardSkinId;
    try {
      if (typeof SKIN_PACKS !== 'undefined' && SKIN_PACKS[data.rewardSkinId]) {
        skinName = SKIN_PACKS[data.rewardSkinId].name || data.rewardSkinId;
      }
    } catch (e) {}
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var hasFunds = bal >= data.priceGems;
    modal.innerHTML =
      '<div class="starter-pack-modal-card">' +
        '<button class="sp-modal-close" aria-label="סגור">×</button>' +
        '<div class="sp-modal-ribbon">חד-פעמית · ' + fmtSpCountdown(data.expiresAt) + '</div>' +
        '<div class="sp-modal-icon">🎁</div>' +
        '<div class="sp-modal-title">' + (data.name || 'חבילת פתיחה') + '</div>' +
        '<div class="sp-modal-sub">חבילה מיוחדת לשחקנים חדשים — חד-פעמית, לעולם לא תוצע שוב.</div>' +

        '<div class="sp-modal-contents">' +
          '<div class="sp-modal-item">' +
            '<div class="sp-modal-item-icon">💎</div>' +
            '<div class="sp-modal-item-body">' +
              '<div class="sp-modal-item-title">' + data.rewardGems.toLocaleString() + ' יהלומים</div>' +
              '<div class="sp-modal-item-sub">מטבע המשחק — שדרוגי שיפורים, סקינים, Battle Pass Premium</div>' +
            '</div>' +
          '</div>' +
          '<div class="sp-modal-item">' +
            '<div class="sp-modal-item-icon">🎨</div>' +
            '<div class="sp-modal-item-body">' +
              '<div class="sp-modal-item-title">סקין: ' + escapeHtml(skinName) + '</div>' +
              '<div class="sp-modal-item-sub">סקין בלעדי לשחקנים שלקחו את החבילה</div>' +
            '</div>' +
          '</div>' +
          '<div class="sp-modal-item">' +
            '<div class="sp-modal-item-icon">🎖</div>' +
            '<div class="sp-modal-item-body">' +
              '<div class="sp-modal-item-title">' + data.rewardBpTiers + ' דרגות Battle Pass</div>' +
              '<div class="sp-modal-item-sub">קפיצה מיידית בעונה הנוכחית</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="sp-modal-value">' +
          '<div class="sp-modal-value-label">ערך החבילה:</div>' +
          '<div class="sp-modal-value-num">~' + ((data.rewardGems + data.rewardBpTiers * 200) + 300).toLocaleString() + '💎</div>' +
          '<div class="sp-modal-value-saved">חסכת ' + Math.round(((data.rewardGems + data.rewardBpTiers * 200 + 300) - data.priceGems) / (data.rewardGems + data.rewardBpTiers * 200 + 300) * 100) + '%</div>' +
        '</div>' +

        '<button class="sp-modal-buy-btn ' + (hasFunds ? '' : 'disabled') + '" id="sp-modal-buy">' +
          (hasFunds
            ? '✨ קנה עכשיו · ' + data.priceGems.toLocaleString() + '💎'
            : '💎 חסר ' + (data.priceGems - bal).toLocaleString() + '💎') +
        '</button>' +
        '<div class="sp-modal-foot">תקף ל-' + fmtSpCountdown(data.expiresAt) + ' · לעולם לא תוצע שוב</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.sp-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var buyBtn = document.getElementById('sp-modal-buy');
    if (buyBtn && hasFunds) {
      buyBtn.onclick = function() { buyStarterPack(buyBtn, close); };
    }
  }

  function buyStarterPack(btnEl, onSuccess) {
    // 2026-05-26: capture original so error path restores the full
    // "✨ קנה עכשיו · 500💎" label, not the generic "✨ קנה עכשיו" that
    // was hardcoded (it lost the price suffix the button originally had).
    var originalHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ מעבד...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/player/starter-pack/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          // Update balance UI.
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
            // 2026-05-26: bump home widget. d.delta = rewardGems - price (net change).
            var __spDelta = (typeof d.rewardGems === 'number' && typeof d.price === 'number') ? (d.rewardGems - d.price) : 0;
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, __spDelta); } catch (e) {}
          }
          // Grant skin client-side cache so it shows in shop instantly.
          try {
            if (typeof ownedSkins !== 'undefined' && d.rewardSkinId && ownedSkins.indexOf(d.rewardSkinId) === -1) {
              ownedSkins.push(d.rewardSkinId);
            }
          } catch (e) {}
          try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([80, 60, 100, 60, 120]); } catch (e) {}
          // UX audit 2026-06-02 — confetti climax on the highest-conversion
          // purchase in the game (was sound+buzz only).
          try { if (typeof window.__bloomConfetti === 'function') window.__bloomConfetti(60); } catch (e) {}
          // Clear cache so subsequent checks see "purchased".
          _starterPackCache.data = null;
          // Remove banner if visible.
          var banner = document.getElementById('starter-pack-home-banner');
          if (banner) banner.remove();
          // Update home BP tile (in case XP boost crossed a tier).
          if (typeof fetchSeasonStatus === 'function') {
            try { fetchSeasonStatus(true).then(function() {
              if (typeof updateHomeSeasonPassTile === 'function') updateHomeSeasonPassTile();
            }); } catch (e) {}
          }
          // Show celebration.
          if (onSuccess) onSuccess();
          showStarterPackWelcomeOverlay(d);
        } else {
          if (btnEl) { btnEl.disabled = false; }
          var reason = (d && d.reason) || '';
          if (reason === 'insufficient_funds') {
            showToast('💎 חסר ביתרה. צריך ' + (d.price || 0) + '💎, יש לך ' + (d.balance || 0) + '💎', 'warning');
          } else if (reason === 'already_purchased') {
            showToast('כבר קנית את חבילת הפתיחה', 'info');
            var b = document.getElementById('starter-pack-home-banner');
            if (b) b.remove();
          } else if (reason === 'expired') {
            showToast('⏰ פג תוקף ההצעה', 'warning');
            var b2 = document.getElementById('starter-pack-home-banner');
            if (b2) b2.remove();
          } else {
            showToast('שגיאה: ' + (reason || 'unknown'), 'error');
          }
          // 2026-05-26: restore the FULL original label (was hardcoded
          // generic "✨ קנה עכשיו" which lost the price suffix).
          if (btnEl) btnEl.innerHTML = originalHtml;
        }
      });
  }

  function showStarterPackWelcomeOverlay(d) {
    var ov = document.createElement('div');
    ov.className = 'starter-pack-welcome';
    ov.innerHTML =
      '<div class="sp-welcome-card">' +
        '<div class="sp-welcome-icon">🎁</div>' +
        '<div class="sp-welcome-title">תודה על הרכישה!</div>' +
        '<div class="sp-welcome-sub">קיבלת:</div>' +
        '<div class="sp-welcome-items">' +
          '<div class="sp-welcome-item">💎 ' + d.rewardGems.toLocaleString() + '</div>' +
          '<div class="sp-welcome-item">🎨 סקין חדש</div>' +
          '<div class="sp-welcome-item">🎖 ' + d.rewardBpTiers + ' דרגות BP</div>' +
        '</div>' +
        '<button class="sp-welcome-btn">תודה!</button>' +
      '</div>';
    document.body.appendChild(ov);
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.sp-welcome-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 10000);
  }

  // Expose for external triggers (game-over flow + home mount).
  window.maybeOfferStarterPack = maybeOfferStarterPack;
  window.showStarterPackModal = showStarterPackModal;
  window.fetchStarterPackStatus = fetchStarterPackStatus;
})();
