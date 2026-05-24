// ============================================================
// Stage 21 — Daily Deals (May 2026)
// One rotating deal per day (Asia/Jerusalem). Banner on home + big
// modal with countdown + atomic purchase. Daily-return hook + anchoring
// psychology ("חסכת 60%!"). Industry-standard pattern.
// ============================================================
(function() {
  var _dealCache = { data: null, fetchedAt: 0 };
  var _dealCheckInFlight = false;
  var DEAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function fetchTodayDeal(force) {
    var now = Date.now();
    if (!force && _dealCache.data && (now - _dealCache.fetchedAt) < DEAL_CACHE_TTL) {
      return Promise.resolve(_dealCache.data);
    }
    if (_dealCheckInFlight) return Promise.resolve(_dealCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    _dealCheckInFlight = true;
    var url = '/api/daily-deals/today';
    if (deviceId) url += '?deviceId=' + encodeURIComponent(deviceId);
    return fetch(url)
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        _dealCheckInFlight = false;
        if (d && d.ok) {
          _dealCache.data = d;
          _dealCache.fetchedAt = now;
        }
        return d;
      });
  }

  function fmtDealCountdown(ms) {
    if (ms <= 0) return 'הסתיים';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return h + 'ש ' + m + 'ד';
    if (m > 0) return m + 'ד ' + s + 'ש';
    return s + 'ש';
  }

  // Public: called on home mount to inject the deal banner.
  var _lastBannerCheckAt = 0;
  function maybeShowDailyDealBanner() {
    if (Date.now() - _lastBannerCheckAt < 30 * 1000) return;
    _lastBannerCheckAt = Date.now();
    fetchTodayDeal(false).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.deal || d.purchased) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('daily-deal-home-banner')) return;
      mountDailyDealBanner(home, d);
    });
  }

  function mountDailyDealBanner(homeEl, data) {
    var deal = data.deal;
    var banner = document.createElement('div');
    banner.id = 'daily-deal-home-banner';
    banner.className = 'daily-deal-home-banner';
    var discountBadge = deal.discountPct
      ? '<span class="dd-banner-discount">-' + deal.discountPct + '%</span>'
      : '';
    var msLeft = new Date(data.expiresAt).getTime() - Date.now();
    banner.innerHTML =
      '<div class="dd-banner-icon">' + (deal.emoji || '🔥') + '</div>' +
      '<div class="dd-banner-body">' +
        '<div class="dd-banner-title">' + escapeHtml(deal.name) + ' ' + discountBadge + '</div>' +
        '<div class="dd-banner-sub">' +
          '<span class="dd-banner-price">' + deal.priceGems + '💎</span>' +
          (deal.originalValue ? ' · <s class="dd-banner-orig">' + deal.originalValue + '💎</s>' : '') +
          ' · <span class="dd-banner-countdown" data-expires="' + data.expiresAt + '">⏰ ' + fmtDealCountdown(msLeft) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="dd-banner-cta">פתח →</button>' +
      '<button class="dd-banner-close" aria-label="סגור">×</button>';
    // Insert AFTER the starter-pack banner if present, else at top.
    var spBanner = document.getElementById('starter-pack-home-banner');
    if (spBanner && spBanner.nextSibling) {
      homeEl.insertBefore(banner, spBanner.nextSibling);
    } else {
      homeEl.insertBefore(banner, homeEl.firstChild);
    }
    banner.querySelector('.dd-banner-cta').onclick = function() { showDailyDealModal(data); };
    banner.addEventListener('click', function(e) {
      if (e.target.classList.contains('dd-banner-close')) {
        banner.remove();
      } else if (e.target === banner || e.target.classList.contains('dd-banner-body') || e.target.classList.contains('dd-banner-icon')) {
        showDailyDealModal(data);
      }
    });
    // Live countdown ticker.
    var countdownEl = banner.querySelector('.dd-banner-countdown');
    var ticker = setInterval(function() {
      if (!document.body.contains(banner)) { clearInterval(ticker); return; }
      var newMs = new Date(data.expiresAt).getTime() - Date.now();
      if (newMs <= 0) {
        banner.remove();
        clearInterval(ticker);
        return;
      }
      countdownEl.textContent = '⏰ ' + fmtDealCountdown(newMs);
    }, 1000);
  }

  function formatDealContents(contents) {
    var rows = [];
    if (contents.gems) {
      rows.push({ icon: '💎', title: contents.gems.toLocaleString() + ' יהלומים', sub: 'מטבע המשחק' });
    }
    if (contents.skin_id) {
      var skinName = contents.skin_id;
      try {
        if (typeof SKIN_PACKS !== 'undefined' && SKIN_PACKS[contents.skin_id]) {
          skinName = SKIN_PACKS[contents.skin_id].name || contents.skin_id;
        }
      } catch (e) {}
      rows.push({ icon: '🎨', title: 'סקין: ' + skinName, sub: 'סקין חדש לאוסף' });
    }
    if (contents.bp_tiers) {
      rows.push({ icon: '🎖', title: contents.bp_tiers + ' דרגות Battle Pass', sub: 'קפיצה במסלול העונה' });
    }
    if (contents.chest_count) {
      rows.push({ icon: '🎁', title: contents.chest_count + ' תיבות הפתעה', sub: 'mystery chests עם הפתעה אקראית' });
    }
    if (contents.streak_freezes) {
      rows.push({ icon: '🛡', title: contents.streak_freezes + ' הקפאות רצף', sub: 'הגנה מפספוס יום' });
    }
    return rows;
  }

  function showDailyDealModal(data) {
    var ex = document.getElementById('daily-deal-modal');
    if (ex) ex.remove();
    var deal = data.deal;
    var msLeft = new Date(data.expiresAt).getTime() - Date.now();
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var hasFunds = bal >= deal.priceGems;
    var rows = formatDealContents(deal.contents || {});
    var rowsHtml = rows.map(function(r) {
      return '<div class="dd-modal-item">' +
        '<div class="dd-modal-item-icon">' + r.icon + '</div>' +
        '<div class="dd-modal-item-body">' +
          '<div class="dd-modal-item-title">' + escapeHtml(r.title) + '</div>' +
          '<div class="dd-modal-item-sub">' + escapeHtml(r.sub) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    var modal = document.createElement('div');
    modal.id = 'daily-deal-modal';
    modal.className = 'daily-deal-modal-overlay';
    modal.innerHTML =
      '<div class="daily-deal-modal-card">' +
        '<button class="dd-modal-close" aria-label="סגור">×</button>' +
        (deal.discountPct
          ? '<div class="dd-modal-ribbon">-' + deal.discountPct + '%</div>'
          : '<div class="dd-modal-ribbon">דיל היום</div>') +
        '<div class="dd-modal-icon">' + (deal.emoji || '🔥') + '</div>' +
        '<div class="dd-modal-title">' + escapeHtml(deal.name) + '</div>' +
        (deal.description ? '<div class="dd-modal-sub">' + escapeHtml(deal.description) + '</div>' : '') +
        '<div class="dd-modal-countdown" id="dd-modal-countdown">⏰ נשאר: ' + fmtDealCountdown(msLeft) + '</div>' +
        '<div class="dd-modal-contents">' + rowsHtml + '</div>' +
        '<div class="dd-modal-price-row">' +
          '<div class="dd-modal-price-now">' + deal.priceGems.toLocaleString() + '💎</div>' +
          (deal.originalValue
            ? '<s class="dd-modal-price-orig">' + deal.originalValue.toLocaleString() + '💎</s>'
            : '') +
        '</div>' +
        '<button class="dd-modal-buy-btn ' + (hasFunds ? '' : 'disabled') + '" id="dd-modal-buy">' +
          (hasFunds
            ? '🛒 קנה עכשיו · ' + deal.priceGems.toLocaleString() + '💎'
            : '💎 חסר ' + (deal.priceGems - bal).toLocaleString() + '💎') +
        '</button>' +
        '<div class="dd-modal-foot">הצעה יומית — מתחדשת בכל יום בחצות (שעון ישראל)</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.dd-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var buyBtn = document.getElementById('dd-modal-buy');
    if (buyBtn && hasFunds) {
      buyBtn.onclick = function() { buyDailyDeal(deal.id, buyBtn, close); };
    }
    // Live countdown
    var cd = document.getElementById('dd-modal-countdown');
    var modalTicker = setInterval(function() {
      if (!document.body.contains(modal)) { clearInterval(modalTicker); return; }
      var newMs = new Date(data.expiresAt).getTime() - Date.now();
      if (newMs <= 0) {
        cd.textContent = '⏰ פג תוקף';
        if (buyBtn) buyBtn.disabled = true;
        clearInterval(modalTicker);
        return;
      }
      cd.textContent = '⏰ נשאר: ' + fmtDealCountdown(newMs);
    }, 1000);
  }

  function buyDailyDeal(dealId, btnEl, onSuccess) {
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ מעבד...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/daily-deals/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, dealId: dealId })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          var granted = d.granted || {};
          if (granted.skinId) {
            try {
              if (typeof ownedSkins !== 'undefined' && ownedSkins.indexOf(granted.skinId) === -1) {
                ownedSkins.push(granted.skinId);
              }
            } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 60, 100, 60]); } catch (e) {}
          // Clear cache + remove banner (already purchased).
          _dealCache.data = null;
          var banner = document.getElementById('daily-deal-home-banner');
          if (banner) banner.remove();
          if (typeof fetchSeasonStatus === 'function' && granted.bpTiers) {
            try { fetchSeasonStatus(true).then(function() {
              if (typeof updateHomeSeasonPassTile === 'function') updateHomeSeasonPassTile();
            }); } catch (e) {}
          }
          if (onSuccess) onSuccess();
          showDailyDealWelcome(granted, d.price);
        } else {
          if (btnEl) { btnEl.disabled = false; }
          var reason = (d && d.reason) || '';
          if (reason === 'insufficient_funds') {
            showToast('💎 חסר ביתרה. צריך ' + (d.price || 0) + '💎, יש לך ' + (d.balance || 0) + '💎', 'warning');
          } else if (reason === 'already_purchased') {
            showToast('כבר קנית את ההצעה היומית הזו', 'info');
            var bb = document.getElementById('daily-deal-home-banner');
            if (bb) bb.remove();
          } else if (reason === 'wrong_deal') {
            showToast('⏰ ההצעה פגה / השתנתה. רענן את הדף', 'warning');
          } else {
            showToast('שגיאה: ' + (reason || 'unknown'), 'error');
          }
          if (btnEl) btnEl.innerHTML = '🛒 קנה עכשיו';
        }
      });
  }

  function showDailyDealWelcome(granted, price) {
    var items = [];
    if (granted.gems) items.push('💎 ' + granted.gems.toLocaleString());
    if (granted.skinId) items.push('🎨 סקין חדש');
    if (granted.bpTiers) items.push('🎖 ' + granted.bpTiers + ' דרגות BP');
    if (granted.chests) items.push('🎁 ' + granted.chests + ' תיבות');
    if (granted.freezes) items.push('🛡 ' + granted.freezes + ' הקפאות');
    var ov = document.createElement('div');
    ov.className = 'daily-deal-welcome';
    ov.innerHTML =
      '<div class="dd-welcome-card">' +
        '<div class="dd-welcome-icon">🎉</div>' +
        '<div class="dd-welcome-title">תודה!</div>' +
        '<div class="dd-welcome-sub">קיבלת:</div>' +
        '<div class="dd-welcome-items">' +
          items.map(function(it) { return '<div class="dd-welcome-item">' + it + '</div>'; }).join('') +
        '</div>' +
        '<button class="dd-welcome-btn">סגור</button>' +
      '</div>';
    document.body.appendChild(ov);
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.dd-welcome-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 8000);
  }

  window.maybeShowDailyDealBanner = maybeShowDailyDealBanner;
  window.showDailyDealModal = showDailyDealModal;
  window.fetchTodayDeal = fetchTodayDeal;
})();
