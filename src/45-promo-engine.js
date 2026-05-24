// ============================================================
// M1 — Self-Promo Engine (May 2026)
//
// Replaces external ad impressions with our own product promos.
// The "watch ad → get 30💎" slot still rewards the player, but the
// content shown is now an INTERNAL ad for our own monetization
// surfaces (Starter Pack, Daily Deal, Skin Shop, Gacha, BP, Gem Bank).
//
// Why: AdSense won't approve Railway subdomains. Until we own a
// domain, the highest-ROI move is to recycle ad inventory as
// self-promo — every shown ad becomes free funnel into our own
// in-game economy.
//
// Flow:
//  1. simulatePromoWatch() fetches /api/promo/next
//  2. If a promo is returned, paints a full-screen promo card with
//     title/body/CTA + 3s countdown. Fires impression on mount.
//  3. CTA tap = fire click event + navigate to target surface
//     (starter-pack / daily-deals / skin-shop / gacha / battle-pass / gem-bank).
//  4. Countdown finishes = callback fires (gem reward still credited
//     by the calling site via /api/player/ad-watch).
//
// Falls back to the legacy simulateAdWatch overlay when:
//   - promo_enabled=false in game_config
//   - /api/promo/next returns null (no eligible promo)
//   - fetch errors
//
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }

  function getPlayerLevel() {
    try {
      var raw = localStorage.getItem('bloom_lifetime_level');
      var n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch (e) { return 1; }
  }

  function apiPostPromo(path, body) {
    var did = getDeviceId();
    var tok = getToken();
    if (!did || !tok) return Promise.resolve({ ok: false, reason: 'no_auth' });
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ deviceId: did, token: tok }, body || {}))
    }).then(function(r) { return r.json(); }).catch(function() { return { ok: false }; });
  }

  function fetchNextPromo() {
    var did = encodeURIComponent(getDeviceId());
    var level = getPlayerLevel();
    return fetch('/api/promo/next?deviceId=' + did + '&level=' + level)
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false }; });
  }

  // Map promo cta_target → the in-game action that opens that surface.
  // Falls back to no-op if the target surface isn't mounted (admin can
  // create a target before the relevant module ships, that's fine).
  function navigateToTarget(target) {
    try {
      switch (target) {
        case 'starter_pack':
          if (typeof window.showStarterPackModal === 'function') { window.showStarterPackModal(); return; }
          if (typeof window.__bloomStarterPack === 'object' && window.__bloomStarterPack.showModal) { window.__bloomStarterPack.showModal(); return; }
          break;
        case 'daily_deal':
          if (typeof window.showDailyDealModal === 'function') { window.showDailyDealModal(); return; }
          if (typeof window.__bloomDailyDeals === 'object' && window.__bloomDailyDeals.showModal) { window.__bloomDailyDeals.showModal(); return; }
          break;
        case 'skin_shop':
          if (typeof window.showSkinShop === 'function') { window.showSkinShop(); return; }
          break;
        case 'gacha':
          if (typeof window.showGachaModal === 'function') { window.showGachaModal(); return; }
          if (typeof window.__bloomGacha === 'object' && window.__bloomGacha.showModal) { window.__bloomGacha.showModal(); return; }
          break;
        case 'battle_pass':
          if (typeof window.showSeasonPassModal === 'function') { window.showSeasonPassModal(); return; }
          break;
        case 'gem_bank':
          if (typeof window.__bloomGemBank === 'object' && window.__bloomGemBank.showModal) { window.__bloomGemBank.showModal(); return; }
          break;
        case 'bundles':
          if (typeof window.__bloomBundles === 'object' && window.__bloomBundles.showModal) { window.__bloomBundles.showModal(); return; }
          break;
        case 'home':
        default:
          if (typeof window.showHome === 'function') { window.showHome(); return; }
      }
    } catch (e) {}
  }

  function buildPromoCard(promo, opts) {
    opts = opts || {};
    var bg = promo.bg_gradient || 'linear-gradient(135deg,#1a1a2e,#16213e)';
    var emoji = promo.image_emoji || '🎁';
    var title = String(promo.title || '').slice(0, 120);
    var body = String(promo.body || '').slice(0, 400);
    var ctaText = String(promo.cta_text || 'קנה עכשיו').slice(0, 60);
    var rewardLine = (opts.rewardGems | 0) > 0
      ? '<div class="promo-reward-hint">+ ' + (opts.rewardGems | 0) + '💎 על הצפייה</div>'
      : '';

    var overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    overlay.setAttribute('dir', 'rtl');
    overlay.innerHTML =
      '<div class="promo-card" style="background:' + bg + '">' +
        '<div class="promo-skip">דלג בעוד <span class="promo-skip-sec">3</span>s</div>' +
        '<div class="promo-emoji">' + emoji + '</div>' +
        '<div class="promo-title">' + escapeHtml(title) + '</div>' +
        '<div class="promo-body">' + escapeHtml(body) + '</div>' +
        '<button class="promo-cta" type="button">' + escapeHtml(ctaText) + ' ←</button>' +
        rewardLine +
      '</div>';
    return overlay;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showPromoCard(promo, opts) {
    return new Promise(function(resolve) {
      var overlay = buildPromoCard(promo, opts || {});
      document.body.appendChild(overlay);
      // Fire impression — server tracks frequency for fatigue rules.
      apiPostPromo('/api/promo/impression', { promoId: promo.id });

      var sec = 3;
      var secEl = overlay.querySelector('.promo-skip-sec');
      var skipDiv = overlay.querySelector('.promo-skip');
      var ctaBtn = overlay.querySelector('.promo-cta');
      var closed = false;

      var iv = setInterval(function() {
        sec--;
        if (secEl) secEl.textContent = String(Math.max(0, sec));
        if (sec <= 0) {
          clearInterval(iv);
          if (skipDiv) {
            skipDiv.innerHTML = '✕ דלג';
            skipDiv.classList.add('promo-skip-ready');
            skipDiv.style.cursor = 'pointer';
            skipDiv.onclick = function() { close(false); };
          }
        }
      }, 1000);

      function close(clicked) {
        if (closed) return;
        closed = true;
        clearInterval(iv);
        overlay.classList.add('promo-overlay-out');
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve({ clicked: !!clicked, promoId: promo.id });
        }, 200);
      }

      if (ctaBtn) ctaBtn.onclick = function() {
        apiPostPromo('/api/promo/click', { promoId: promo.id });
        navigateToTarget(promo.cta_target);
        close(true);
      };
    });
  }

  // Public entry point. Same callback shape as simulateAdWatch:
  // (callback) → callback() fired when the slot has been "watched".
  // If the player clicks the CTA, we navigate them to the promo target
  // AND skip the reward callback (they engaged with the funnel instead).
  function simulatePromoWatch(callback) {
    var rewardGems = 30;
    try {
      if (window.gameConfig && window.gameConfig.ad_watch_reward) {
        var n = parseInt(window.gameConfig.ad_watch_reward, 10);
        if (Number.isFinite(n) && n > 0) rewardGems = n;
      }
    } catch (e) {}

    fetchNextPromo().then(function(d) {
      if (!d || !d.ok || !d.promo) {
        if (typeof window.simulateAdWatch === 'function') {
          window.simulateAdWatch(callback);
          return;
        }
        if (callback) callback();
        return;
      }
      showPromoCard(d.promo, { rewardGems: rewardGems }).then(function(result) {
        if (result.clicked) {
          return;
        }
        if (callback) callback();
      });
    });
  }

  window.simulatePromoWatch = simulatePromoWatch;
  window.__bloomPromo = {
    fetchNextPromo: fetchNextPromo,
    showPromoCard: showPromoCard,
    simulatePromoWatch: simulatePromoWatch
  };
})();
