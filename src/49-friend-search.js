// ============================================================
// FD.2 — Friend Search + Request workflow (May 29 2026)
//
// Adds Clash-Royale-style social discovery on top of the existing
// "invite by code" friends modal. Two surfaces in one modal:
//
//   🔍 חיפוש — type a name or BLOOM-XXXX prefix, see matching
//     players with role-appropriate action: "הוסף" (no relationship),
//     "ממתין" (you sent a request), "אשר" (they sent you a request),
//     "✓ חבר" (already friends).
//
//   📨 בקשות — incoming pending (with accept/decline) + outgoing
//     pending (with cancel) + recently-resolved history.
//
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';

  var SEARCH_DEBOUNCE_MS = 280;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }

  function showModal(initialTab) {
    // Unified friends experience: one window with 3 tabs (👥 חברים / 🔍 חיפוש /
    // 📨 בקשות) lives in the friends hub (showFriendsModal). Delegate to it so
    // there's never a second stacked modal. This standalone modal remains only
    // as a fallback if the hub module isn't loaded.
    if (typeof window.showFriendsModal === 'function') {
      window.showFriendsModal(initialTab === 'requests' ? 'requests' : 'search');
      return;
    }
    var existing = document.getElementById('friend-search-modal');
    if (existing) { existing.remove(); return; }

    var ov = document.createElement('div');
    ov.id = 'friend-search-modal';
    ov.className = 'friend-search-overlay modal-overlay';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

    var card = document.createElement('div');
    card.className = 'friend-search-card';

    var head = document.createElement('div');
    head.className = 'friend-search-head';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'friend-search-close modal-close';
    close.setAttribute('aria-label', 'סגור');
    close.textContent = '✕';
    close.onclick = function() { ov.remove(); };
    head.appendChild(close);
    var title = document.createElement('div');
    title.className = 'friend-search-title';
    title.textContent = '👥 חברים — חיפוש ובקשות';
    head.appendChild(title);
    var sub = document.createElement('div');
    sub.className = 'friend-search-sub';
    sub.textContent = 'חפש שחקן או אשר בקשת חברות — שניכם תקבלו 200💎';
    head.appendChild(sub);
    card.appendChild(head);

    // Tabs
    var tabs = document.createElement('div');
    tabs.className = 'friend-search-tabs';
    var tabSearch = document.createElement('button');
    tabSearch.type = 'button';
    tabSearch.className = 'friend-search-tab';
    tabSearch.textContent = '🔍 חיפוש';
    var tabReq = document.createElement('button');
    tabReq.type = 'button';
    tabReq.className = 'friend-search-tab';
    var tabReqLabel = document.createElement('span');
    tabReqLabel.textContent = '📨 בקשות';
    tabReq.appendChild(tabReqLabel);
    var tabReqBadge = document.createElement('span');
    tabReqBadge.className = 'friend-search-tab-badge';
    tabReqBadge.style.display = 'none';
    tabReq.appendChild(tabReqBadge);
    tabs.appendChild(tabSearch);
    tabs.appendChild(tabReq);
    card.appendChild(tabs);

    var body = document.createElement('div');
    body.className = 'friend-search-body';
    card.appendChild(body);

    function activate(which) {
      tabSearch.classList.toggle('active', which === 'search');
      tabReq.classList.toggle('active', which === 'requests');
      while (body.firstChild) body.removeChild(body.firstChild);
      if (which === 'search') renderSearchTab(body);
      else renderRequestsTab(body, tabReqBadge);
    }
    tabSearch.onclick = function() { activate('search'); };
    tabReq.onclick = function() { activate('requests'); };

    ov.appendChild(card);
    document.body.appendChild(ov);

    // Initial — fetch the badge count right away so the player can
    // see "📨 בקשות (3)" before they even tap the tab.
    refreshRequestsBadge(tabReqBadge);

    activate(initialTab === 'requests' ? 'requests' : 'search');
  }

  function refreshRequestsBadge(badgeEl) {
    var did = getDeviceId();
    if (!did) return;
    fetch('/api/friends/requests?deviceId=' + encodeURIComponent(did))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (!d || !d.ok) return;
        var n = d.unreadIncoming | 0;
        if (n > 0) {
          badgeEl.textContent = String(n);
          badgeEl.style.display = '';
        } else {
          badgeEl.style.display = 'none';
        }
      });
  }

  // ===== Search tab =====
  function renderSearchTab(host) {
    var searchRow = document.createElement('div');
    searchRow.className = 'friend-search-input-row';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'friend-search-input';
    input.placeholder = '🔍 שם או קוד BLOOM-XXXX';
    input.spellcheck = false;
    input.autocomplete = 'off';
    searchRow.appendChild(input);
    host.appendChild(searchRow);

    var hint = document.createElement('div');
    hint.className = 'friend-search-hint';
    hint.textContent = 'הקש לפחות 2 תווים. תוצאות יופיעו כאן.';
    host.appendChild(hint);

    var resultsHost = document.createElement('div');
    resultsHost.className = 'friend-search-results';
    host.appendChild(resultsHost);

    var debTimer = null;
    var lastQuery = null;
    var inFlight = false;

    function runSearch() {
      var q = (input.value || '').trim();
      if (q === lastQuery) return;
      lastQuery = q;
      if (q.length < 2) {
        while (resultsHost.firstChild) resultsHost.removeChild(resultsHost.firstChild);
        hint.textContent = 'הקש לפחות 2 תווים. תוצאות יופיעו כאן.';
        hint.style.display = '';
        return;
      }
      hint.style.display = 'none';
      if (inFlight) return; // simple guard — debounce handles spacing
      inFlight = true;
      var did = getDeviceId();
      if (!did) { inFlight = false; return; }
      fetch('/api/users/search?deviceId=' + encodeURIComponent(did) + '&q=' + encodeURIComponent(q))
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
        .then(function(d) {
          inFlight = false;
          renderResults(resultsHost, d, q);
          // If user typed more while waiting, fire one more search.
          if (input.value.trim() !== q) runSearch();
        });
    }

    input.addEventListener('input', function() {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    });

    setTimeout(function() { try { input.focus(); } catch (_) {} }, 100);
  }

  function renderResults(host, data, q) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!data || !data.ok) {
      var err = document.createElement('div');
      err.className = 'friend-search-empty';
      err.textContent = '⚠️ שגיאת רשת — נסה שוב';
      host.appendChild(err);
      return;
    }
    var results = data.results || [];
    if (!results.length) {
      var empty = document.createElement('div');
      empty.className = 'friend-search-empty';
      empty.textContent = '🌱 לא נמצאו תוצאות עבור "' + q + '"';
      host.appendChild(empty);
      return;
    }
    var head = document.createElement('div');
    head.className = 'friend-search-results-head';
    head.textContent = results.length + ' תוצאות';
    host.appendChild(head);
    for (var i = 0; i < results.length; i++) {
      host.appendChild(buildResultRow(results[i]));
    }
  }

  function buildResultRow(r) {
    var row = document.createElement('div');
    row.className = 'friend-search-row';

    var avatar = document.createElement('div');
    avatar.className = 'friend-search-avatar';
    avatar.textContent = '👤';
    row.appendChild(avatar);

    var body = document.createElement('div');
    body.className = 'friend-search-row-body';
    var name = document.createElement('div');
    name.className = 'friend-search-row-name';
    name.textContent = r.name;
    body.appendChild(name);
    var sub = document.createElement('div');
    sub.className = 'friend-search-row-sub';
    sub.textContent = (r.code || '') + ' · רמה ' + r.level;
    body.appendChild(sub);
    row.appendChild(body);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'friend-search-row-action';
    if (r.alreadyFriends) {
      btn.textContent = '✓ חבר';
      btn.classList.add('friend-search-row-action-friend');
      btn.disabled = true;
    } else if (r.requestReceived) {
      btn.textContent = '🤝 אשר';
      btn.classList.add('friend-search-row-action-accept');
      btn.onclick = function() {
        // Resolve the request id via the incoming list (lightweight call)
        // and accept it. Cheap because requests list is small.
        respondToIncomingFromDevice(r.deviceId, 'accept', btn);
      };
    } else if (r.requestSent) {
      btn.textContent = '⏳ ממתין';
      btn.classList.add('friend-search-row-action-pending');
      btn.disabled = true;
    } else {
      btn.textContent = '➕ הוסף';
      btn.classList.add('friend-search-row-action-add');
      btn.onclick = function() { sendRequestToDevice(r.deviceId, btn); };
    }
    row.appendChild(btn);

    return row;
  }

  function sendRequestToDevice(targetDevice, btn) {
    var did = getDeviceId();
    var tok = getToken();
    if (!did || !tok) {
      if (typeof showToast === 'function') showToast('עוד אין לך זהות שמורה', 'warning');
      return;
    }
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = '⏳';
    fetch('/api/friends/request-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: did, token: tok, targetDeviceId: targetDevice })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false, reason: 'network' }; })
      .then(function(d) {
        if (d && d.ok) {
          if (d.alreadyFriends || d.status === 'accepted') {
            btn.textContent = '✓ חבר';
            btn.className = 'friend-search-row-action friend-search-row-action-friend';
            if (typeof window.__bloomBumpBal === 'function' && d.signupBonus) {
              try { window.__bloomBumpBal(null, d.signupBonus); } catch (_) {}
            }
            if (typeof showToast === 'function') showToast('✓ חברים! קיבלת ' + (d.signupBonus || 200) + '💎', 'success');
          } else if (d.alreadyPending) {
            btn.textContent = '⏳ ממתין';
            btn.className = 'friend-search-row-action friend-search-row-action-pending';
          } else {
            btn.textContent = '⏳ ממתין';
            btn.className = 'friend-search-row-action friend-search-row-action-pending';
            if (typeof showToast === 'function') showToast('📨 נשלחה בקשת חברות', 'success');
          }
        } else {
          btn.disabled = false;
          btn.textContent = orig;
          var reasons = {
            disabled: 'הפיצ׳ר מושבת', target_not_found: 'שחקן לא נמצא',
            cant_self_request: 'אי אפשר לבקש מעצמך', max_friends_reached: 'הגעת ל-50 חברים',
            max_pending_reached: 'יותר מדי בקשות שנשלחו', rate_limited: 'יותר מדי בקשות — נסה שוב מאוחר יותר',
            network: 'שגיאת רשת'
          };
          if (typeof showToast === 'function') {
            showToast(reasons[d && d.reason] || 'שגיאה', 'error');
          }
        }
      });
  }

  function respondToIncomingFromDevice(senderDevice, action, btn) {
    var did = getDeviceId();
    if (!did) return;
    // Find the request id via list endpoint.
    fetch('/api/friends/requests?deviceId=' + encodeURIComponent(did))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok) return null;
        var match = (d.incoming || []).find(function(it) {
          return it.status === 'pending' && it.otherDevice === senderDevice;
        });
        return match ? match.id : null;
      })
      .then(function(rid) {
        if (!rid) {
          if (typeof showToast === 'function') showToast('הבקשה כבר טופלה', 'info');
          return;
        }
        respondToRequest(rid, action, btn);
      });
  }

  // ===== Requests tab =====
  function renderRequestsTab(host, badgeEl) {
    var loading = document.createElement('div');
    loading.className = 'friend-search-empty';
    loading.textContent = '⏳ טוען…';
    host.appendChild(loading);

    var did = getDeviceId();
    if (!did) { loading.textContent = 'אין זהות שמורה'; return; }

    fetch('/api/friends/requests?deviceId=' + encodeURIComponent(did))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        while (host.firstChild) host.removeChild(host.firstChild);
        if (!d || !d.ok) {
          var err = document.createElement('div');
          err.className = 'friend-search-empty';
          err.textContent = '⚠️ שגיאת רשת — נסה שוב';
          host.appendChild(err);
          return;
        }
        // Update badge
        if (badgeEl) {
          var n = d.unreadIncoming | 0;
          if (n > 0) { badgeEl.textContent = String(n); badgeEl.style.display = ''; }
          else { badgeEl.style.display = 'none'; }
        }
        renderRequestsList(host, d.incoming || [], 'incoming', badgeEl);
        renderRequestsList(host, d.outgoing || [], 'outgoing', badgeEl);
        if ((d.incoming || []).length + (d.outgoing || []).length === 0) {
          var empty = document.createElement('div');
          empty.className = 'friend-search-empty';
          empty.textContent = '🌱 אין בקשות חברות עדיין';
          host.appendChild(empty);
        }
      });
  }

  function renderRequestsList(host, items, kind, badgeEl) {
    if (!items.length) return;
    var pendingItems = items.filter(function(it) { return it.status === 'pending'; });
    var historyItems = items.filter(function(it) { return it.status !== 'pending'; });

    if (pendingItems.length) {
      var head = document.createElement('div');
      head.className = 'friend-search-section-head';
      head.textContent = (kind === 'incoming' ? '📨 ממתינות לאישור' : '📤 בקשות ששלחת') + ' · ' + pendingItems.length;
      host.appendChild(head);
      for (var i = 0; i < pendingItems.length; i++) {
        host.appendChild(buildRequestRow(pendingItems[i], kind, badgeEl));
      }
    }
    if (historyItems.length) {
      var head2 = document.createElement('div');
      head2.className = 'friend-search-section-head friend-search-section-head-muted';
      head2.textContent = (kind === 'incoming' ? '📥 הסטוריה (נכנסות)' : '📤 הסטוריה (יוצאות)');
      host.appendChild(head2);
      for (var j = 0; j < historyItems.length; j++) {
        host.appendChild(buildRequestRow(historyItems[j], kind, badgeEl));
      }
    }
  }

  function buildRequestRow(item, kind, badgeEl) {
    var row = document.createElement('div');
    row.className = 'friend-search-req-row friend-search-req-row-' + item.status;

    var avatar = document.createElement('div');
    avatar.className = 'friend-search-avatar';
    avatar.textContent = '👤';
    row.appendChild(avatar);

    var body = document.createElement('div');
    body.className = 'friend-search-req-body';
    var name = document.createElement('div');
    name.className = 'friend-search-req-name';
    name.textContent = item.name;
    body.appendChild(name);
    var sub = document.createElement('div');
    sub.className = 'friend-search-req-sub';
    sub.textContent = (item.code || '') + ' · רמה ' + item.level;
    body.appendChild(sub);
    if (item.message) {
      var msg = document.createElement('div');
      msg.className = 'friend-search-req-msg';
      msg.textContent = '“' + item.message + '”';
      body.appendChild(msg);
    }
    row.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'friend-search-req-actions';
    if (item.status === 'pending') {
      if (kind === 'incoming') {
        var acc = document.createElement('button');
        acc.type = 'button';
        acc.className = 'friend-search-row-action friend-search-row-action-accept';
        acc.textContent = '🤝 אשר';
        acc.onclick = function() { respondToRequest(item.id, 'accept', acc, row, badgeEl); };
        actions.appendChild(acc);
        var dec = document.createElement('button');
        dec.type = 'button';
        dec.className = 'friend-search-row-action friend-search-row-action-decline';
        dec.textContent = '✕';
        dec.title = 'דחה';
        dec.onclick = function() { respondToRequest(item.id, 'decline', dec, row, badgeEl); };
        actions.appendChild(dec);
      } else {
        var can = document.createElement('button');
        can.type = 'button';
        can.className = 'friend-search-row-action friend-search-row-action-cancel';
        can.textContent = '✕ בטל';
        can.onclick = function() { respondToRequest(item.id, 'cancel', can, row, badgeEl); };
        actions.appendChild(can);
      }
    } else {
      // history row — just a status pill
      var pill = document.createElement('span');
      pill.className = 'friend-search-req-status friend-search-req-status-' + item.status;
      var labels = {
        accepted: '✓ אושר', declined: '✕ נדחה', canceled: '⏪ בוטל'
      };
      pill.textContent = labels[item.status] || item.status;
      actions.appendChild(pill);
    }
    row.appendChild(actions);
    return row;
  }

  function respondToRequest(requestId, action, btn, rowEl, badgeEl) {
    var did = getDeviceId();
    var tok = getToken();
    if (!did || !tok) {
      if (typeof showToast === 'function') showToast('אין זהות שמורה', 'warning');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳';
    }
    fetch('/api/friends/request-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: did, token: tok, requestId: requestId, action: action })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false, reason: 'network' }; })
      .then(function(d) {
        if (d && d.ok) {
          if (action === 'accept' && d.signupBonus && typeof window.__bloomBumpBal === 'function') {
            try { window.__bloomBumpBal(null, d.signupBonus); } catch (_) {}
          }
          var toastMsg = action === 'accept'
              ? ('✓ חברים! קיבלת ' + (d.signupBonus || 200) + '💎')
            : action === 'decline' ? 'הבקשה נדחתה'
            : 'הבקשה בוטלה';
          if (typeof showToast === 'function') showToast(toastMsg, 'success');
          // Soft-remove the row from the list.
          if (rowEl && rowEl.parentNode) {
            rowEl.style.opacity = '0.4';
            rowEl.style.pointerEvents = 'none';
          }
          // Refresh badge.
          if (badgeEl) refreshRequestsBadge(badgeEl);
        } else {
          if (btn) {
            btn.disabled = false;
            btn.textContent = action === 'accept' ? '🤝 אשר' : action === 'decline' ? '✕' : '✕ בטל';
          }
          var reasons = {
            not_found: 'הבקשה לא נמצאה', already_resolved: 'הבקשה כבר טופלה',
            not_recipient: 'לא ניתן לאשר בקשה שלא שייכת לך', not_sender: 'לא ניתן לבטל בקשה של מישהו אחר',
            rate_limited: 'יותר מדי בקשות', network: 'שגיאת רשת'
          };
          if (typeof showToast === 'function') {
            showToast(reasons[d && d.reason] || 'שגיאה', 'error');
          }
        }
      });
  }

  // ===== Open URL handler =====
  // Auto-open the requests tab if ?action=friend-requests is in the URL
  // (used by the push notification deep-link). Run once at boot.
  function autoOpenFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var action = params.get('action');
      if (action !== 'friend-requests') return;
      if (sessionStorage.getItem('bloom_friend_requests_auto_opened')) return;
      sessionStorage.setItem('bloom_friend_requests_auto_opened', '1');
      setTimeout(function() { showModal('requests'); }, 1500);
    } catch (e) {}
  }
  setTimeout(autoOpenFromUrl, 800);

  // ===== Public API =====
  // renderSearchInto / renderRequestsInto let the friends hub embed these
  // panes inline (one window, tabbed) instead of opening a second modal.
  window.__bloomFriendSearch = {
    showModal: showModal,
    renderSearchInto: renderSearchTab,
    renderRequestsInto: renderRequestsTab,
    refreshRequestsBadge: refreshRequestsBadge
  };
})();
