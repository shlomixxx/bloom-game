// ============================================================
// Stage 25 — Limited-time Bundles (May 2026)
// Themed event packs (Hanukkah, Valentine, Black Friday, etc.).
// Multi-day windows + per-bundle theme color + decoration emoji.
// Strong FOMO via countdown + scarcity ("only 1 per device").
// ============================================================
(function() {
  var _bundlesCache = { data: null, fetchedAt: 0 };
  var _bundlesInFlight = false;

  function fetchActiveBundles(force) {
    if (!force && _bundlesCache.data && (Date.now() - _bundlesCache.fetchedAt) < 5 * 60 * 1000) {
      return Promise.resolve(_bundlesCache.data);
    }
    if (_bundlesInFlight) return Promise.resolve(_bundlesCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    _bundlesInFlight = true;
    var url = '/api/bundles/active';
    if (deviceId) url += '?deviceId=' + encodeURIComponent(deviceId);
    return fetch(url).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _bundlesInFlight = false;
        if (d && d.ok) {
          _bundlesCache.data = d;
          _bundlesCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function fmtBundleCountdown(ms) {
    if (ms <= 0) return 'הסתיים';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    var d = Math.floor(h / 24);
    if (d > 0) return d + 'י ' + (h % 24) + 'ש';
    if (h > 0) return h + 'ש ' + (m % 60) + 'ד';
    return m + 'ד';
  }

  // Public: mount banners for active bundles. Limits to top 2 by sort_order
  // to avoid drowning the home screen.
  function maybeShowBundleBanners() {
    fetchActiveBundles(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var bundles = (d.bundles || []).filter(function(b) { return b.canBuy; });
      if (!bundles.length) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      // Show up to 2 banners.
      bundles.slice(0, 2).forEach(function(bundle) {
        if (document.getElementById('bundle-banner-' + bundle.id)) return;
        mountBundleBanner(home, bundle);
      });
    });
  }

  function mountBundleBanner(homeEl, bundle) {
    var banner = document.createElement('div');
    banner.id = 'bundle-banner-' + bundle.id;
    banner.className = 'bundle-home-banner';
    banner.style.setProperty('--theme-color', bundle.themeColor || '#A855F7');
    var msLeft = new Date(bundle.endsAt).getTime() - Date.now();
    var discountBadge = bundle.discountPct
      ? '<span class="bundle-banner-discount">-' + bundle.discountPct + '%</span>'
      : '';
    banner.innerHTML =
      '<div class="bundle-banner-icon">' + (bundle.emoji || '🎁') + '</div>' +
      '<div class="bundle-banner-body">' +
        '<div class="bundle-banner-title">' + escapeHtml(bundle.name) + ' ' + discountBadge + '</div>' +
        '<div class="bundle-banner-sub">' +
          '<span class="bundle-banner-price">' + bundle.priceGems + '💎</span>' +
          (bundle.originalValue ? ' · <s>' + bundle.originalValue + '💎</s>' : '') +
          ' · <span class="bundle-banner-countdown" data-ends="' + bundle.endsAt + '">⏰ ' + fmtBundleCountdown(msLeft) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="bundle-banner-cta">פתח →</button>' +
      '<button class="bundle-banner-close" aria-label="סגור">×</button>';
    // Append at the END of home so bundles don't push critical UI down.
    homeEl.appendChild(banner);
    banner.querySelector('.bundle-banner-cta').onclick = function() { showBundleModal(bundle); };
    banner.addEventListener('click', function(e) {
      if (e.target.classList.contains('bundle-banner-close')) {
        banner.remove();
      } else if (e.target === banner || e.target.classList.contains('bundle-banner-body') || e.target.classList.contains('bundle-banner-icon')) {
        showBundleModal(bundle);
      }
    });
    var countdownEl = banner.querySelector('.bundle-banner-countdown');
    var ticker = setInterval(function() {
      if (!document.body.contains(banner)) { clearInterval(ticker); return; }
      var ms = new Date(bundle.endsAt).getTime() - Date.now();
      if (ms <= 0) { banner.remove(); clearInterval(ticker); return; }
      countdownEl.textContent = '⏰ ' + fmtBundleCountdown(ms);
    }, 60 * 1000);
  }

  function formatBundleContents(contents) {
    var rows = [];
    if (contents.gems) rows.push({ icon: '💎', title: contents.gems.toLocaleString() + ' יהלומים' });
    if (contents.skin_id) {
      var skinName = contents.skin_id;
      try {
        if (typeof SKIN_PACKS !== 'undefined' && SKIN_PACKS[contents.skin_id]) {
          skinName = SKIN_PACKS[contents.skin_id].name || contents.skin_id;
        }
      } catch (e) {}
      rows.push({ icon: '🎨', title: 'סקין: ' + skinName });
    }
    if (contents.bp_tiers) rows.push({ icon: '🎖', title: contents.bp_tiers + ' דרגות Battle Pass' });
    if (contents.chest_count) rows.push({ icon: '🎁', title: contents.chest_count + ' תיבות הפתעה' });
    if (contents.streak_freezes) rows.push({ icon: '🛡', title: contents.streak_freezes + ' הקפאות רצף' });
    return rows;
  }

  function showBundleModal(bundle) {
    var ex = document.getElementById('bundle-modal');
    if (ex) ex.remove();
    var msLeft = new Date(bundle.endsAt).getTime() - Date.now();
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var hasFunds = bal >= bundle.priceGems;
    var rows = formatBundleContents(bundle.contents || {});
    var rowsHtml = rows.map(function(r) {
      return '<div class="bundle-modal-item">' +
        '<div class="bundle-modal-item-icon">' + r.icon + '</div>' +
        '<div class="bundle-modal-item-title">' + escapeHtml(r.title) + '</div>' +
      '</div>';
    }).join('');
    // Floating decoration emojis (8 of them, scattered).
    var decoHtml = '';
    if (bundle.decorationEmoji) {
      for (var i = 0; i < 8; i++) {
        var top = Math.floor(Math.random() * 88);
        var left = Math.floor(Math.random() * 88);
        var delay = (i * 250).toFixed(0);
        var size = 14 + Math.floor(Math.random() * 10);
        decoHtml += '<span class="bundle-modal-deco" style="top:' + top + '%;left:' + left + '%;animation-delay:' + delay + 'ms;font-size:' + size + 'px">' + bundle.decorationEmoji + '</span>';
      }
    }
    var modal = document.createElement('div');
    modal.id = 'bundle-modal';
    modal.className = 'bundle-modal-overlay';
    modal.style.setProperty('--theme-color', bundle.themeColor || '#A855F7');
    modal.innerHTML =
      '<div class="bundle-modal-card">' +
        decoHtml +
        '<button class="bundle-modal-close" aria-label="סגור">×</button>' +
        (bundle.discountPct ? '<div class="bundle-modal-ribbon">-' + bundle.discountPct + '%</div>' : '') +
        '<div class="bundle-modal-icon">' + (bundle.emoji || '🎁') + '</div>' +
        '<div class="bundle-modal-title">' + escapeHtml(bundle.name) + '</div>' +
        (bundle.description ? '<div class="bundle-modal-desc">' + escapeHtml(bundle.description) + '</div>' : '') +
        '<div class="bundle-modal-countdown" id="bundle-modal-countdown">⏰ ' + fmtBundleCountdown(msLeft) + '</div>' +
        '<div class="bundle-modal-scarcity">⚠️ הצעה חד-פעמית · לעולם לא תוצע שוב</div>' +
        '<div class="bundle-modal-contents">' + rowsHtml + '</div>' +
        '<div class="bundle-modal-price-row">' +
          '<div class="bundle-modal-price-now">' + bundle.priceGems.toLocaleString() + '💎</div>' +
          (bundle.originalValue ? '<s class="bundle-modal-price-orig">' + bundle.originalValue.toLocaleString() + '💎</s>' : '') +
        '</div>' +
        '<button class="bundle-modal-buy-btn ' + (hasFunds ? '' : 'disabled') + '" id="bundle-modal-buy">' +
          (hasFunds
            ? '🛒 קנה עכשיו · ' + bundle.priceGems.toLocaleString() + '💎'
            : '💎 חסר ' + (bundle.priceGems - bal).toLocaleString() + '💎') +
        '</button>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.bundle-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var buyBtn = document.getElementById('bundle-modal-buy');
    if (buyBtn && hasFunds) buyBtn.onclick = function() { buyBundle(bundle.id, buyBtn, close); };
    // Live countdown
    var cd = document.getElementById('bundle-modal-countdown');
    var t = setInterval(function() {
      if (!document.body.contains(modal)) { clearInterval(t); return; }
      var ms = new Date(bundle.endsAt).getTime() - Date.now();
      if (ms <= 0) {
        cd.textContent = '⏰ פג תוקף';
        if (buyBtn) buyBtn.disabled = true;
        clearInterval(t);
        return;
      }
      cd.textContent = '⏰ ' + fmtBundleCountdown(ms);
    }, 1000);
  }

  function buyBundle(bundleId, btnEl, onSuccess) {
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ מעבד...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/bundles/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, bundleId: bundleId })
    })
      .then(function(r) { return r.json(); }).catch(function() { return null; })
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
          try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([80, 60, 100, 60, 120]); } catch (e) {}
          _bundlesCache.data = null;
          var banner = document.getElementById('bundle-banner-' + bundleId);
          if (banner) banner.remove();
          if (onSuccess) onSuccess();
          showBundleWelcome(granted);
        } else {
          if (btnEl) { btnEl.disabled = false; }
          var reason = (d && d.reason) || '';
          if (reason === 'insufficient_funds') {
            showToast('💎 חסר ביתרה. צריך ' + (d.price || 0) + '💎, יש לך ' + (d.balance || 0) + '💎', 'warning');
          } else if (reason === 'limit_reached') {
            showToast('כבר רכשת את החבילה הזו!', 'info');
            var b2 = document.getElementById('bundle-banner-' + bundleId);
            if (b2) b2.remove();
          } else if (reason === 'expired') {
            showToast('⏰ פג תוקף החבילה', 'warning');
            var b3 = document.getElementById('bundle-banner-' + bundleId);
            if (b3) b3.remove();
          } else {
            showToast('שגיאה: ' + (reason || 'unknown'), 'error');
          }
          if (btnEl) btnEl.innerHTML = '🛒 קנה עכשיו';
        }
      });
  }

  function showBundleWelcome(granted) {
    var items = [];
    if (granted.gems) items.push('💎 ' + granted.gems.toLocaleString());
    if (granted.skinId) items.push('🎨 סקין חדש');
    if (granted.bpTiers) items.push('🎖 ' + granted.bpTiers + ' דרגות BP');
    if (granted.chests) items.push('🎁 ' + granted.chests + ' תיבות');
    if (granted.freezes) items.push('🛡 ' + granted.freezes + ' הקפאות');
    var ov = document.createElement('div');
    ov.className = 'bundle-welcome';
    ov.innerHTML =
      '<div class="bundle-welcome-card">' +
        '<div class="bundle-welcome-icon">🎉</div>' +
        '<div class="bundle-welcome-title">מצויין!</div>' +
        '<div class="bundle-welcome-sub">קיבלת את כל החבילה:</div>' +
        '<div class="bundle-welcome-items">' +
          items.map(function(it) { return '<div class="bundle-welcome-item">' + it + '</div>'; }).join('') +
        '</div>' +
        '<button class="bundle-welcome-btn">תודה!</button>' +
      '</div>';
    document.body.appendChild(ov);
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.bundle-welcome-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 10000);
  }

  window.maybeShowBundleBanners = maybeShowBundleBanners;
  window.showBundleModal = showBundleModal;
  window.fetchActiveBundles = fetchActiveBundles;
})();
