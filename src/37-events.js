// ============================================================
// Phase 7 / T7.2 — Weekly Events (Golden Hour MVP, May 2026)
//
// Admin starts a time-windowed event (Golden Hour = ×2 XP). Server
// applies the multiplier server-side on every season XP grant. Client
// shows a pulsing gold banner at the top of the home with a live
// countdown so the player FEELS the urgency.
//
// Lives in its own IIFE — pure window.* consumer (no main-IIFE coupling).
// Future event types (Chain Madness ×3 chain bonus, Speed Rush 60-sec
// mode) would extend the same /api/events/active list, each rendering
// its own banner. v1 ships just Golden Hour because XP multiplier
// doesn't touch the merge engine; the other two do.
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, events: [] };
  var CACHE_MS = 30 * 1000;
  var _bannerTicker = null;

  function fetchActiveEvents(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve(_cache.events);
    }
    return fetch('/api/events/active')
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _cache.fetchedAt = Date.now();
          _cache.events = d.events || [];
          return _cache.events;
        }
        return [];
      });
  }

  function maybeShowEventBanner() {
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchActiveEvents(false).then(function(events) {
      // Tear down previous banner if events list emptied.
      var existing = document.getElementById('event-banner-strip');
      if (!events.length) {
        if (existing) existing.remove();
        stopBannerTicker();
        return;
      }
      // Render (or re-render).
      var html = events.map(renderBannerForEvent).join('');
      if (existing) {
        existing.innerHTML = html;
      } else {
        var strip = document.createElement('div');
        strip.id = 'event-banner-strip';
        strip.innerHTML = html;
        // Insert AFTER the balance bar so the player sees gems first,
        // then the event call-to-action. Falls through to top if no bar.
        var bar = document.getElementById('home-v2-balance-bar');
        if (bar && bar.nextSibling) bar.parentNode.insertBefore(strip, bar.nextSibling);
        else home.insertBefore(strip, home.firstChild);
      }
      startBannerTicker();
    });
  }

  function renderBannerForEvent(ev) {
    return (
      '<div class="event-banner event-banner-' + escapeAttr(ev.id) + '" data-ends-at="' + escapeAttr(ev.endsAt) + '">' +
        '<span class="event-banner-emoji">' + (ev.emoji || '✨') + '</span>' +
        '<span class="event-banner-body">' +
          '<span class="event-banner-title">' + escapeHtml(ev.name) + '</span>' +
          '<span class="event-banner-sub">' + escapeHtml(ev.description || '') + '</span>' +
        '</span>' +
        '<span class="event-banner-countdown">' + formatMsLeft(ev.msLeft) + '</span>' +
      '</div>'
    );
  }

  function startBannerTicker() {
    stopBannerTicker();
    // Re-paint the countdown every 1s while home is visible. Self-stops
    // when the banner is removed (home swapped out).
    _bannerTicker = setInterval(function() {
      var strip = document.getElementById('event-banner-strip');
      if (!strip) { stopBannerTicker(); return; }
      strip.querySelectorAll('.event-banner').forEach(function(banner) {
        var endsAt = banner.getAttribute('data-ends-at');
        if (!endsAt) return;
        var msLeft = new Date(endsAt).getTime() - Date.now();
        var cd = banner.querySelector('.event-banner-countdown');
        if (cd) cd.textContent = formatMsLeft(msLeft);
        if (msLeft <= 0) {
          // Refresh from server — event likely ended, server flips state.
          fetchActiveEvents(true).then(maybeShowEventBanner);
        }
      });
    }, 1000);
  }
  function stopBannerTicker() {
    if (_bannerTicker) { clearInterval(_bannerTicker); _bannerTicker = null; }
  }

  function formatMsLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'הסתיים';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_:\-\.]/g, '');
  }

  try {
    window.__bloomEvents = {
      maybeShow: maybeShowEventBanner,
      refresh: function() { return fetchActiveEvents(true).then(maybeShowEventBanner); }
    };
  } catch (e) {}
})();
