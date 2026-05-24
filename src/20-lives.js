// ============================================================
// Stage 19 — Lives / Energy (May 2026)
// DEFAULT OFF on the server side. Client polls /lives/state and
// only mounts UI when enabled === true. Hearts widget on home,
// out-of-lives modal with 3 refill paths (wait/ad/gems), game-start
// gate for dynamic boards only.
// ============================================================
(function() {
  var _livesCache = { data: null, fetchedAt: 0 };
  var _livesInFlight = false;
  var _livesTicker = null;

  function fetchLivesState(force) {
    if (!force && _livesCache.data && (Date.now() - _livesCache.fetchedAt) < 30000) {
      return Promise.resolve(_livesCache.data);
    }
    if (_livesInFlight) return Promise.resolve(_livesCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    _livesInFlight = true;
    var url = '/api/player/lives/state';
    if (deviceId) url += '?deviceId=' + encodeURIComponent(deviceId);
    return fetch(url).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _livesInFlight = false;
        if (d && d.ok) {
          _livesCache.data = d;
          _livesCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function fmtMs(ms) {
    if (ms <= 0) return '0ש 0ד';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    if (m < 1) return sec + ' שניות';
    var h = Math.floor(m / 60);
    var min = m % 60;
    if (h > 0) return h + 'ש ' + min + 'ד';
    return min + 'ד ' + sec + 'ש';
  }

  function renderHearts(current, max) {
    var html = '';
    for (var i = 0; i < max; i++) {
      html += i < current ? '❤️' : '🤍';
    }
    return html;
  }

  // Public: mount hearts widget on home if enabled. Throttled internally.
  function maybeShowLivesWidget() {
    fetchLivesState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('lives-home-widget')) {
        updateLivesWidget(d);
        return;
      }
      mountLivesWidget(home, d);
    });
  }

  function mountLivesWidget(homeEl, data) {
    var w = document.createElement('div');
    w.id = 'lives-home-widget';
    w.className = 'lives-home-widget' + (data.currentLives === 0 ? ' lives-empty' : '');
    w.innerHTML =
      '<div class="lives-widget-hearts" id="lives-widget-hearts">' + renderHearts(data.currentLives, data.maxLives) + '</div>' +
      '<div class="lives-widget-info">' +
        '<div class="lives-widget-count" id="lives-widget-count">' + data.currentLives + ' / ' + data.maxLives + ' חיים</div>' +
        '<div class="lives-widget-regen" id="lives-widget-regen">' +
          (data.currentLives < data.maxLives
            ? '⏰ ' + fmtMs(data.msUntilNextRegen) + ' לחיים הבאים'
            : '✓ מלא')
          + '</div>' +
      '</div>' +
      '<button class="lives-widget-refill" id="lives-widget-refill">' +
        (data.currentLives < data.maxLives ? '+ חידוש' : '✓') +
      '</button>';
    // Insert right at the top of home for high visibility.
    homeEl.insertBefore(w, homeEl.firstChild);
    var refill = document.getElementById('lives-widget-refill');
    if (refill) refill.onclick = function() {
      if (data.currentLives < data.maxLives) showLivesRefillModal(data);
    };
    w.onclick = function(e) {
      if (e.target === refill) return;
      // Tapping the hearts area also opens the modal so it's discoverable.
      if (data.currentLives < data.maxLives) showLivesRefillModal(_livesCache.data || data);
    };
    startLivesTicker();
  }

  function updateLivesWidget(data) {
    var hearts = document.getElementById('lives-widget-hearts');
    var count = document.getElementById('lives-widget-count');
    var regen = document.getElementById('lives-widget-regen');
    var w = document.getElementById('lives-home-widget');
    var refill = document.getElementById('lives-widget-refill');
    if (hearts) hearts.innerHTML = renderHearts(data.currentLives, data.maxLives);
    if (count) count.textContent = data.currentLives + ' / ' + data.maxLives + ' חיים';
    if (regen) regen.textContent = data.currentLives < data.maxLives
      ? '⏰ ' + fmtMs(data.msUntilNextRegen) + ' לחיים הבאים'
      : '✓ מלא';
    if (w) w.classList.toggle('lives-empty', data.currentLives === 0);
    if (refill) refill.textContent = data.currentLives < data.maxLives ? '+ חידוש' : '✓';
  }

  function startLivesTicker() {
    if (_livesTicker) return;
    _livesTicker = setInterval(function() {
      var w = document.getElementById('lives-home-widget');
      if (!w) { clearInterval(_livesTicker); _livesTicker = null; return; }
      var d = _livesCache.data;
      if (!d || !d.enabled) return;
      // Local countdown: decrement msUntilNextRegen client-side.
      if (d.currentLives < d.maxLives) {
        d.msUntilNextRegen = Math.max(0, d.msUntilNextRegen - 1000);
        if (d.msUntilNextRegen === 0) {
          // Time elapsed — re-fetch authoritative state.
          fetchLivesState(true).then(function(fresh) { if (fresh) updateLivesWidget(fresh); });
        } else {
          updateLivesWidget(d);
        }
      }
    }, 1000);
  }

  // Public: gate a dynamic-board game start. Resolves to true if the
  // player can play (lives consumed or system disabled), false otherwise.
  function ensureLifeForDynamicGame() {
    return fetchLivesState(true).then(function(d) {
      if (!d || !d.ok || !d.enabled) return true;
      if (d.currentLives <= 0) {
        showLivesRefillModal(d);
        return false;
      }
      // Try to consume.
      var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
      var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
      return fetch('/api/player/lives/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: token, count: 1 })
      })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; })
        .then(function(resp) {
          if (resp && resp.ok) {
            if (_livesCache.data) {
              _livesCache.data.currentLives = resp.currentLives;
              _livesCache.data.maxLives = resp.maxLives;
              _livesCache.data.msUntilNextRegen = resp.msUntilNextRegen;
              updateLivesWidget(_livesCache.data);
            }
            return true;
          }
          if (resp && resp.reason === 'insufficient_lives') {
            showLivesRefillModal(_livesCache.data || d);
            return false;
          }
          // On error fall through (don't block the player).
          return true;
        });
    });
  }

  function showLivesRefillModal(data) {
    var ex = document.getElementById('lives-refill-modal');
    if (ex) ex.remove();
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var price = data.refillPriceGems || 50;
    var adCount = data.adRefillCount || 1;
    var canAffordGems = bal >= price;
    var fullState = data.currentLives >= data.maxLives;
    var modal = document.createElement('div');
    modal.id = 'lives-refill-modal';
    modal.className = 'lives-refill-overlay';
    modal.innerHTML =
      '<div class="lives-refill-card">' +
        '<button class="lives-refill-close" aria-label="סגור">×</button>' +
        '<div class="lives-refill-hearts">' + renderHearts(data.currentLives, data.maxLives) + '</div>' +
        '<div class="lives-refill-title">' +
          (data.currentLives === 0 ? 'אזל הכוח!' :
           fullState ? 'יש לך חיים מלאים!' :
           data.currentLives + ' / ' + data.maxLives + ' חיים') +
        '</div>' +
        '<div class="lives-refill-sub">' +
          (fullState
            ? 'אתה מוכן לכל לוח דינמי שתרצה'
            : (data.currentLives === 0
              ? '⏰ חיים הבאים בעוד ' + fmtMs(data.msUntilNextRegen)
              : 'יש לך מספיק חיים לעוד ' + data.currentLives + ' משחקים'))
        + '</div>' +
        '<div class="lives-refill-options">' +
          (fullState
            ? '<div class="lives-refill-opt-disabled">חיים מלאים — אין צורך לחדש</div>'
            : (
              '<button class="lives-refill-opt lives-refill-opt-ad" id="lives-refill-ad">' +
                '<div class="lives-refill-opt-icon">📺</div>' +
                '<div class="lives-refill-opt-label">צפה בפרסומת</div>' +
                '<div class="lives-refill-opt-sub">+' + adCount + ' חיים · חינם</div>' +
              '</button>' +
              '<button class="lives-refill-opt lives-refill-opt-gems ' + (canAffordGems ? '' : 'disabled') + '" id="lives-refill-gems">' +
                '<div class="lives-refill-opt-icon">💎</div>' +
                '<div class="lives-refill-opt-label">חידוש מלא</div>' +
                '<div class="lives-refill-opt-sub">' + price + '💎' + (canAffordGems ? '' : ' (חסר)') + '</div>' +
              '</button>' +
              '<button class="lives-refill-opt lives-refill-opt-wait" id="lives-refill-wait">' +
                '<div class="lives-refill-opt-icon">⏰</div>' +
                '<div class="lives-refill-opt-label">המתן</div>' +
                '<div class="lives-refill-opt-sub">' + fmtMs(data.msUntilNextRegen) + '</div>' +
              '</button>'
            )) +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.lives-refill-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var waitBtn = document.getElementById('lives-refill-wait');
    if (waitBtn) waitBtn.onclick = close;
    var gemsBtn = document.getElementById('lives-refill-gems');
    if (gemsBtn && canAffordGems) gemsBtn.onclick = function() { doLivesRefillGems(gemsBtn); };
    var adBtn = document.getElementById('lives-refill-ad');
    if (adBtn) adBtn.onclick = function() { doLivesRefillAd(adBtn); };
  }

  function doLivesRefillGems(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/player/lives/refill-gems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          if (_livesCache.data) {
            _livesCache.data.currentLives = d.currentLives;
            _livesCache.data.msUntilNextRegen = d.msUntilNextRegen || 0;
            updateLivesWidget(_livesCache.data);
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 30, 60]); } catch (e) {}
          var modal = document.getElementById('lives-refill-modal');
          if (modal) modal.remove();
        } else if (d && d.reason === 'insufficient_funds') {
          showToast('💎 חסר ' + ((d.price || 0) - (d.balance || 0)) + '💎', 'warning');
          if (btn) btn.disabled = false;
        } else {
          showToast('שגיאה: ' + ((d && d.reason) || 'unknown'), 'error');
          if (btn) btn.disabled = false;
        }
      });
  }

  function doLivesRefillAd(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ צופה...'; }
    // Use existing ad simulation pattern. The real AdSense integration
    // would replace this. For now: simulate a 3-second "watch".
    var simulate = (typeof window.simulatePromoWatch === 'function')
      ? window.simulatePromoWatch
      : ((typeof simulateAdWatch === 'function')
          ? simulateAdWatch
          : function(cb) { setTimeout(cb, 3000); });
    simulate(function() {
      var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
      var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
      var gameId = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : ('lives-ad-' + Date.now());
      fetch('/api/player/lives/refill-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: token, gameId: gameId })
      })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; })
        .then(function(d) {
          if (d && d.ok) {
            if (_livesCache.data) {
              _livesCache.data.currentLives = d.currentLives;
              _livesCache.data.msUntilNextRegen = d.msUntilNextRegen || 0;
              updateLivesWidget(_livesCache.data);
            }
            try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
            try { if (typeof buzz === 'function') buzz([30, 30, 40]); } catch (e) {}
            var modal = document.getElementById('lives-refill-modal');
            if (modal) modal.remove();
          } else if (d && d.reason === 'already_claimed') {
            showToast('כבר השתמשת בפרסומת הזאת. נסה שוב מאוחר יותר', 'info');
            if (btn) btn.disabled = false;
          } else {
            showToast('שגיאה: ' + ((d && d.reason) || 'unknown'), 'error');
            if (btn) btn.disabled = false;
          }
        });
    });
  }

  window.maybeShowLivesWidget = maybeShowLivesWidget;
  window.ensureLifeForDynamicGame = ensureLifeForDynamicGame;
  window.fetchLivesState = fetchLivesState;
  window.showLivesRefillModal = showLivesRefillModal;
})();
