// ============================================================
// Phase 4 / T4.4 — Notification Inbox (May 2026)
//
// 🔔 icon at the top-right of the home topbar with an unread badge.
// Tap → slide-out panel with a chronological list of recent events:
//
//   - Duel results (win/loss/tie) from the last 14 days
//   - Gifts received from friends (last 30 days)
//   - Guild war finals (last 14 days)
//   - Challenge wins (last 14 days)
//
// Server: GET /api/inbox aggregates from 4 tables and returns up to
// 30 items sorted newest-first. Client tracks "last seen" timestamp
// in localStorage[bloom_inbox_seen_at] — items with created_at > seen_at
// drive the badge count. "Mark all seen" updates the timestamp.
//
// This lives in its OWN IIFE (no access to main IIFE state needed) —
// pure window.* consumption.
// ============================================================
(function() {
  'use strict';
  var SEEN_KEY = 'bloom_inbox_seen_at';
  var _cache = { fetchedAt: 0, items: [] };
  var CACHE_MS = 30 * 1000;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; }
    catch (e) { return ''; }
  }
  function loadSeenAt() {
    try { return localStorage.getItem(SEEN_KEY) || ''; }
    catch (e) { return ''; }
  }
  function saveSeenAt(iso) {
    try { localStorage.setItem(SEEN_KEY, iso); } catch (e) {}
  }
  function countUnread(items, seenAt) {
    if (!items || !items.length) return 0;
    var seenTs = seenAt ? new Date(seenAt).getTime() : 0;
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      var t = new Date(items[i].created_at).getTime();
      if (t > seenTs) n++;
    }
    return n;
  }

  function fetchInbox(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve({ ok: true, items: _cache.items });
    }
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve({ ok: false, items: [] });
    return fetch('/api/inbox?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _cache.fetchedAt = Date.now();
          _cache.items = d.items || [];
          return { ok: true, items: _cache.items };
        }
        return { ok: false, items: [] };
      });
  }

  // Mount the 🔔 button into the home topbar. Idempotent — re-running
  // updates the existing badge instead of creating duplicates.
  function mountInboxIcon() {
    var topbar = document.querySelector('.home-v2-topbar');
    if (!topbar) return;
    var btn = document.getElementById('home-inbox-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'home-inbox-btn';
      btn.className = 'home-v2-inbox-btn';
      btn.setAttribute('aria-label', 'התראות');
      btn.innerHTML =
        '<span class="home-inbox-icon">🔔</span>' +
        '<span class="home-inbox-badge" id="home-inbox-badge" style="display:none">0</span>';
      btn.onclick = function() {
        if (typeof window.ensureAudio === 'function') { try { window.ensureAudio(); } catch (e) {} }
        showInboxPanel();
      };
      // Insert AFTER the mute button so layout stays mute|live-pulse|inbox.
      var mute = topbar.querySelector('.home-v2-mute');
      if (mute && mute.nextSibling) topbar.insertBefore(btn, mute.nextSibling);
      else topbar.appendChild(btn);
    }
    refreshInboxBadge();
  }

  function refreshInboxBadge() {
    fetchInbox(false).then(function(res) {
      var badge = document.getElementById('home-inbox-badge');
      if (!badge) return;
      var n = countUnread(res.items, loadSeenAt());
      if (n > 0) {
        badge.textContent = n > 9 ? '9+' : String(n);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    });
  }

  function showInboxPanel() {
    var existing = document.getElementById('inbox-panel');
    if (existing) { existing.remove(); return; }
    var overlay = document.createElement('div');
    overlay.id = 'inbox-panel';
    overlay.className = 'inbox-overlay';
    overlay.innerHTML =
      '<div class="inbox-panel">' +
        '<div class="inbox-head">' +
          '<button class="inbox-close" aria-label="סגור">×</button>' +
          '<div class="inbox-title">🔔 ההתראות שלך</div>' +
          '<button class="inbox-mark-read" id="inbox-mark-read">סמן הכל כנקרא</button>' +
        '</div>' +
        '<div class="inbox-body" id="inbox-body">' +
          '<div class="inbox-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var close = function() { try { overlay.remove(); } catch (e) {} };
    overlay.querySelector('.inbox-close').onclick = close;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    overlay.querySelector('#inbox-mark-read').onclick = function() {
      saveSeenAt(new Date().toISOString());
      refreshInboxBadge();
      renderInboxBody(_cache.items || []);
    };
    fetchInbox(true).then(function(res) {
      renderInboxBody(res.items || []);
      // Don't auto-mark-as-seen on open — user explicitly clicks "mark
      // all as read" so they're aware which items are new.
      refreshInboxBadge();
    });
  }

  function renderInboxBody(items) {
    var host = document.getElementById('inbox-body');
    if (!host) return;
    if (!items.length) {
      host.innerHTML =
        '<div class="inbox-empty">' +
          '<div class="inbox-empty-icon">📭</div>' +
          '<div class="inbox-empty-title">אין התראות חדשות</div>' +
          '<div class="inbox-empty-sub">תוצאות דו-קרבים, מתנות, ואירועי קלאן יופיעו פה</div>' +
        '</div>';
      return;
    }
    var seenAt = loadSeenAt();
    var seenTs = seenAt ? new Date(seenAt).getTime() : 0;
    var html = items.map(function(item) {
      var ts = new Date(item.created_at).getTime();
      var isNew = ts > seenTs;
      var iconClass = iconForKind(item.kind);
      return (
        '<div class="inbox-item ' + (isNew ? 'inbox-item-new' : '') + ' inbox-kind-' + escapeAttr(item.kind) + '" data-action="' + escapeAttr(item.action || '') + '" data-ref="' + escapeAttr(item.ref || '') + '">' +
          '<div class="inbox-item-icon ' + iconClass + '">' + emojiForKind(item.kind) + '</div>' +
          '<div class="inbox-item-body">' +
            '<div class="inbox-item-title">' + escapeHtml(item.title) + (isNew ? ' <span class="inbox-new-dot"></span>' : '') + '</div>' +
            '<div class="inbox-item-sub">' + escapeHtml(item.body || '') + '</div>' +
            '<div class="inbox-item-time">' + relativeTime(item.created_at) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('.inbox-item[data-action]').forEach(function(el) {
      var action = el.getAttribute('data-action');
      if (!action) return;
      var ref = el.getAttribute('data-ref') || '';
      el.style.cursor = 'pointer';
      el.onclick = function() {
        try {
          if (action === 'open_duels' && typeof window.showDuelModal === 'function') window.showDuelModal();
          else if (action === 'open_guild' && typeof window.showGuildModal === 'function') window.showGuildModal();
          else if (action === 'open_challenges' && typeof window.showChallengesList === 'function') window.showChallengesList('inbox');
          else if (action === 'open_friend_challenges' && window.__bloomFriendChallenges) window.__bloomFriendChallenges.openListModal();
          // GO.1 — new actions: tournaments + daily ghost race
          else if (action === 'open_tournament' && typeof window.showTournamentModal === 'function') {
            var tid = parseInt(String(ref).split(':')[1], 10);
            if (Number.isFinite(tid)) window.showTournamentModal(tid);
          }
          else if (action === 'open_daily' && typeof window.__bloomStartMode === 'function') {
            window.__bloomStartMode('daily');
          }
        } catch (e) {}
        // Close the panel so the player can see what they tapped through to.
        var p = document.getElementById('inbox-panel');
        if (p) p.remove();
      };
    });
  }

  function iconForKind(kind) {
    if (kind === 'duel_win' || kind === 'challenge_win' || kind === 'war_win' || kind === 'tournament_win') return 'inbox-icon-win';
    if (kind === 'duel_loss' || kind === 'war_loss') return 'inbox-icon-loss';
    if (kind === 'duel_tie') return 'inbox-icon-tie';
    if (kind === 'gift') return 'inbox-icon-gift';
    if (kind === 'friend_beat') return 'inbox-icon-rival';
    return '';
  }
  function emojiForKind(kind) {
    if (kind === 'duel_win') return '🏆';
    if (kind === 'duel_loss') return '😔';
    if (kind === 'duel_tie') return '🤝';
    if (kind === 'gift') return '🎁';
    if (kind === 'war_win') return '🛡⚔️';
    if (kind === 'war_loss') return '🛡';
    if (kind === 'challenge_win') return '🏅';
    if (kind === 'tournament_win') return '🏆';
    if (kind === 'friend_beat') return '👑';
    return '🔔';
  }
  function relativeTime(iso) {
    try {
      var ms = Date.now() - new Date(iso).getTime();
      if (ms < 60 * 1000) return 'עכשיו';
      if (ms < 60 * 60 * 1000) return Math.floor(ms / 60000) + ' דקות';
      if (ms < 24 * 60 * 60 * 1000) return Math.floor(ms / 3600000) + ' שעות';
      var days = Math.floor(ms / 86400000);
      if (days === 1) return 'אתמול';
      if (days < 7) return 'לפני ' + days + ' ימים';
      return 'לפני ' + Math.floor(days / 7) + ' שבועות';
    } catch (e) { return ''; }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_\-:]/g, '');
  }

  // GO.1 — auto-open the inbox when the URL carries ?action=inbox.
  // Push notifications use this deep-link so when a player taps a
  // "X passed you!" push they land directly on the inbox row instead
  // of having to hunt for the bell icon. One-shot via sessionStorage so
  // a back-button doesn't re-pop the panel forever.
  function maybeAutoOpenFromUrl() {
    try {
      var qp = new URLSearchParams(window.location.search);
      if (qp.get('action') !== 'inbox') return;
      if (sessionStorage.getItem('bloom_inbox_url_handled')) return;
      // C1 fix (silent-failure-hunter audit): set dedup flag ONLY after
      // showInboxPanel returns without throwing. Setting it BEFORE meant
      // a single failure on the 1200ms-delayed call (e.g., dependency
      // not yet mounted) silently blocked all future push-from-URL deep
      // links until sessionStorage cleared.
      setTimeout(function() {
        try {
          showInboxPanel();
          sessionStorage.setItem('bloom_inbox_url_handled', '1');
        } catch (e) {}
      }, 1200);
    } catch (e) {}
  }
  maybeAutoOpenFromUrl();

  // Public hooks — home-v2 mounts the icon, anything can force a refresh.
  try {
    window.__bloomInbox = {
      mount: mountInboxIcon,
      refresh: refreshInboxBadge,
      open: showInboxPanel
    };
  } catch (e) {}
})();
