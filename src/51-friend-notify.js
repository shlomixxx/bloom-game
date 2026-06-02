// ============================================================
// Real-time friend social pop-ups.
//
// Polls /api/friends/requests while the app is open and pops an
// actionable slide-in banner the moment a social event happens:
//   • someone sends YOU a request  → "👋 X רוצה להוסיף אותך · ✓ אשר +200💎 / דחה"
//   • someone ACCEPTS your request → "🎉 X אישר/ה! +200💎 לשניכם · ⚔️ אתגר עכשיו"
//
// Mirrors the duel-notification poller (02-shop.js checkIncomingDuels).
// Web-push (server-side, FD.2/IS.2) covers the closed-app case; THIS covers
// the high-emotion in-app moment — the social-validation + reward loop that
// drives "add more friends / come back" behaviour. One pop-up at a time,
// deduped across sessions so the same event never re-fires.
// ============================================================
(function() {
  'use strict';

  var SEEN_KEY = 'bloom_seen_friend_reqs_v1';
  var POLL_MS = 45000;
  var _poller = null;
  var _popupActive = false;
  var _queue = [];
  var _firstRun = true;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || ''; } catch (e) { return ''; }
  }
  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveSeen(s) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function suffixOf(code) {
    var m = String(code || '').toUpperCase().match(/([A-HJ-NP-Z2-9]{4})\s*$/);
    return m ? m[1] : '';
  }
  function ding(tier) {
    try { if (typeof soundMilestone === 'function') soundMilestone(tier || 4); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([40, 30, 70]); } catch (e) {}
  }

  async function poll() {
    var did = getDeviceId();
    if (!did || did.length < 8) return;
    if (document.visibilityState === 'hidden') return;
    var data;
    try {
      var r = await fetch('/api/friends/requests?deviceId=' + encodeURIComponent(did), { cache: 'no-store' });
      if (!r.ok) return;
      data = await r.json();
    } catch (e) { return; }
    if (!data) return;

    var seen = loadSeen();
    var fresh = [];
    (data.incoming || []).forEach(function(req) {
      if (req.status !== 'pending') return;
      var k = 'in' + req.id;
      if (seen[k]) return;
      fresh.push({ kind: 'incoming', req: req, seenKey: k });
    });
    (data.outgoing || []).forEach(function(req) {
      if (req.status !== 'accepted') return;
      var k = 'acc' + req.id;
      if (seen[k]) return;
      fresh.push({ kind: 'accepted', req: req, seenKey: k });
    });

    // First poll of a fresh device (no seen state yet): if there's a backlog
    // of >2 pending incoming, don't spam individual pop-ups — collapse to one
    // "you have N requests" summary. New events arriving mid-session always
    // pop individually. Everything else (≤2, or accepts) pops normally.
    var incomingFresh = fresh.filter(function(f) { return f.kind === 'incoming'; });
    if (_firstRun && incomingFresh.length > 2) {
      incomingFresh.forEach(function(f) { seen[f.seenKey] = 1; });
      saveSeen(seen);
      fresh = fresh.filter(function(f) { return f.kind !== 'incoming'; });
      _queue.push({ kind: 'summary', count: incomingFresh.length });
    }
    _firstRun = false;

    fresh.forEach(function(f) { _queue.push(f); });
    drainQueue();
  }

  function markSeen(seenKey) {
    if (!seenKey) return;
    var s = loadSeen();
    s[seenKey] = 1;
    saveSeen(s);
  }

  function drainQueue() {
    if (_popupActive || !_queue.length) return;
    var item = _queue.shift();
    if (item.seenKey) markSeen(item.seenKey);
    showPopup(item);
  }

  function teardown(el) {
    if (!el) return;
    el.classList.add('friend-notify-out');
    setTimeout(function() {
      try { el.remove(); } catch (e) {}
      _popupActive = false;
      drainQueue();
    }, 280);
  }

  function showPopup(item) {
    // never stack — remove any leftover
    var old = document.getElementById('friend-notify-banner');
    if (old) { try { old.remove(); } catch (e) {} }
    _popupActive = true;

    var el = document.createElement('div');
    el.id = 'friend-notify-banner';
    el.className = 'friend-notify-banner friend-notify-in';

    if (item.kind === 'summary') {
      el.classList.add('fn-incoming');
      el.innerHTML =
        '<div class="fn-avatar">👥</div>' +
        '<div class="fn-body">' +
          '<div class="fn-title">יש לך ' + (item.count | 0) + ' בקשות חברות חדשות!</div>' +
          '<div class="fn-sub">אשר כל אחת → <strong>+200💎 לשניכם</strong></div>' +
        '</div>' +
        '<div class="fn-actions">' +
          '<button class="fn-btn fn-btn-primary" data-act="open">📨 צפה</button>' +
          '<button class="fn-btn fn-btn-x" data-act="dismiss" aria-label="סגור">✕</button>' +
        '</div>';
      el.querySelector('[data-act="open"]').onclick = function() {
        openRequests();
        teardown(el);
      };
      el.querySelector('[data-act="dismiss"]').onclick = function() { teardown(el); };
      ding(4);
    } else if (item.kind === 'incoming') {
      var req = item.req;
      el.classList.add('fn-incoming');
      el.innerHTML =
        '<div class="fn-avatar">👋</div>' +
        '<div class="fn-body">' +
          '<div class="fn-title"><strong>' + esc(req.name) + '</strong> רוצה להוסיף אותך!</div>' +
          '<div class="fn-sub">אשרו זה את זה → <strong>+200💎 לשניכם</strong></div>' +
        '</div>' +
        '<div class="fn-actions">' +
          '<button class="fn-btn fn-btn-primary" data-act="accept">✓ אשר</button>' +
          '<button class="fn-btn fn-btn-ghost" data-act="decline">דחה</button>' +
        '</div>';
      el.querySelector('[data-act="accept"]').onclick = function() {
        respond(req.id, 'accept', el, req);
      };
      el.querySelector('[data-act="decline"]').onclick = function() {
        respond(req.id, 'decline', el, req);
      };
      ding(5);
    } else { // accepted
      var ar = item.req;
      var sfx = suffixOf(ar.code);
      el.classList.add('fn-accepted');
      el.innerHTML =
        '<div class="fn-avatar">🎉</div>' +
        '<div class="fn-body">' +
          '<div class="fn-title"><strong>' + esc(ar.name) + '</strong> אישר/ה את בקשת החברות!</div>' +
          '<div class="fn-sub">קיבלתם <strong>+200💎</strong> כל אחד · שחקו יחד</div>' +
        '</div>' +
        '<div class="fn-actions">' +
          (sfx
            ? '<button class="fn-btn fn-btn-primary" data-act="duel">⚔️ אתגר</button>'
            : '') +
          '<button class="fn-btn fn-btn-x" data-act="dismiss" aria-label="סגור">✕</button>' +
        '</div>';
      var duelBtn = el.querySelector('[data-act="duel"]');
      if (duelBtn) duelBtn.onclick = function() {
        teardown(el);
        try {
          if (typeof window.showDuelModal === 'function') window.showDuelModal({ prefillSuffix: sfx });
        } catch (e) {}
      };
      el.querySelector('[data-act="dismiss"]').onclick = function() { teardown(el); };
      // celebration for the sender — their pending request paid off
      ding(6);
      try { if (window.__bloomConfetti) window.__bloomConfetti(24); } catch (e) {}
      refreshBalanceSoon();
    }

    document.body.appendChild(el);
    // auto-dismiss after a while if the player doesn't act (incoming stays
    // longer so they have time to decide; accepted/summary shorter).
    var ttl = (item.kind === 'incoming') ? 14000 : 9000;
    setTimeout(function() {
      if (document.body.contains(el)) teardown(el);
    }, ttl);
  }

  function respond(requestId, action, el, req) {
    var did = getDeviceId();
    var body = { deviceId: did, token: getToken(), requestId: requestId, action: action };
    // optimistic UI: disable buttons
    el.querySelectorAll('.fn-btn').forEach(function(b) { b.disabled = true; });
    fetch('/api/friends/request-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (action === 'decline') { teardown(el); return; }
        if (d && d.ok) {
          // celebrate the new friendship
          el.classList.remove('fn-incoming');
          el.classList.add('fn-accepted');
          var bonus = (d.signupBonus || 200);
          el.innerHTML =
            '<div class="fn-avatar">🤝</div>' +
            '<div class="fn-body">' +
              '<div class="fn-title">הוספתם זה את זה לחברים!</div>' +
              '<div class="fn-sub">' + (bonus > 0 ? 'קיבלתם <strong>+' + bonus + '💎</strong> כל אחד' : 'אתם חברים עכשיו') + ' · שחקו יחד</div>' +
            '</div>' +
            '<div class="fn-actions">' +
              (suffixOf(req && req.code) ? '<button class="fn-btn fn-btn-primary" data-act="duel">⚔️ אתגר</button>' : '') +
              '<button class="fn-btn fn-btn-x" data-act="dismiss" aria-label="סגור">✕</button>' +
            '</div>';
          var db = el.querySelector('[data-act="duel"]');
          if (db) db.onclick = function() {
            teardown(el);
            try { if (typeof window.showDuelModal === 'function') window.showDuelModal({ prefillSuffix: suffixOf(req.code) }); } catch (e) {}
          };
          el.querySelector('[data-act="dismiss"]').onclick = function() { teardown(el); };
          ding(6);
          try { if (window.__bloomConfetti) window.__bloomConfetti(28); } catch (e) {}
          refreshBalanceSoon();
          // refresh any open friends UI
          try { if (typeof window.fetchFriends === 'function') window.fetchFriends(true); } catch (e) {}
          setTimeout(function() { if (document.body.contains(el)) teardown(el); }, 7000);
        } else {
          // already resolved / error — just close quietly
          teardown(el);
        }
      });
  }

  function openRequests() {
    try {
      // Unified hub on the 📨 בקשות tab (one window, no second modal).
      if (typeof window.showFriendsModal === 'function') {
        window.showFriendsModal('requests');
      } else if (window.__bloomFriendSearch && typeof window.__bloomFriendSearch.showModal === 'function') {
        window.__bloomFriendSearch.showModal('requests');
      }
    } catch (e) {}
  }

  // The accepter's balance is credited server-side on the OTHER device's
  // action, so the sender's local number is stale. Nudge the wallet widget
  // to re-render shortly (it re-reads the live balance).
  function refreshBalanceSoon() {
    setTimeout(function() {
      try { if (typeof window.__bloomRefreshBalance === 'function') window.__bloomRefreshBalance(); } catch (e) {}
      try { if (typeof window.__bloomRenderBal === 'function') window.__bloomRenderBal(); } catch (e) {}
    }, 600);
  }

  function start() {
    if (_poller) return;
    setTimeout(poll, 4000);
    _poller = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') poll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  try { window.__bloomFriendNotify = { poll: poll }; } catch (e) {}
})();
