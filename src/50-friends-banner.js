// ============================================================
// Task #19 — "Your friends are here" social-proof banner.
//
// Social proof at the login moment drives discovery exactly when
// retention is most fragile (day 2-5). A slim banner near the top of
// the home tile area (below the hero, so it never covers the primary
// PLAY CTA):
//   - friends online now → "🟢 N מהחברים שלך פעילים עכשיו"
//   - friends played today → "👥 N מהחברים שלך שיחקו היום"
//   - has friends, idle → "👥 יש לך N חברים · הזמן עוד"
//   - 0 friends → "👥 חבר ראשון = +200💎 לשניכם · הוסף חבר"
// Tap → friend-search modal (49-friend-search.js). Only friend counts
// are rendered (no names) → zero XSS surface.
// ============================================================
(function() {
  'use strict';

  function maybeShowFriendsBanner() {
    // Level gate L5+ — same as the other social/engagement surfaces.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 5) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    if (typeof window.fetchFriends !== 'function') return;
    // Fetch friends + pending requests together. PENDING INCOMING REQUESTS take
    // top priority — they are the single most-missed social signal: push
    // adoption is near-zero and the in-app pop-up is one-shot, so without a
    // persistent home surface a request just vanishes. This banner re-checks
    // on every home mount and stays until the request is actually answered.
    var did = '';
    try { did = localStorage.getItem('bloom_device_id') || ''; } catch (e) {}
    var reqP = (did && did.length >= 8)
      ? fetch('/api/friends/requests?deviceId=' + encodeURIComponent(did), { cache: 'no-store' })
          .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      : Promise.resolve(null);
    Promise.all([window.fetchFriends(false), reqP]).then(function(arr) {
      var d = arr[0], reqData = arr[1];
      if (!d || !d.ok) return;
      var friends = Array.isArray(d.friends) ? d.friends : [];
      var count = friends.length;
      var online = 0, today = 0;
      for (var i = 0; i < friends.length; i++) {
        if (friends[i] && friends[i].onlineNow) online++;
        if (friends[i] && friends[i].playedToday) today++;
      }
      var pendingReq = (reqData && reqData.ok) ? (reqData.unreadIncoming | 0) : 0;

      var icon, title, sub, cls, forceTab = null;
      if (pendingReq > 0) {
        cls = 'friends-banner-requests'; icon = '📨'; forceTab = 'requests';
        title = pendingReq === 1 ? 'בקשת חברות חדשה ממתינה לך!' : pendingReq + ' בקשות חברות ממתינות לך!';
        sub = 'אשר → +200💎 לשניכם · 👆 לחץ לאישור';
      } else if (count === 0) {
        cls = 'friends-banner-empty'; icon = '👥';
        title = 'חבר ראשון = +200💎 לשניכם';
        sub = 'הוסף חבר ושחקו יחד · 👆 לחץ להזמין';
      } else if (online > 0) {
        cls = 'friends-banner-live'; icon = '🟢';
        title = online + ' מהחברים שלך פעילים עכשיו';
        sub = 'הצטרף אליהם · 👆 חברים';
      } else if (today > 0) {
        cls = 'friends-banner-today'; icon = '👥';
        title = today + ' מהחברים שלך שיחקו היום';
        sub = (d.iPlayedToday ? 'אתם בקצב!' : 'אל תישאר מאחור — שחק היום') + ' · 👆 חברים';
      } else {
        cls = 'friends-banner-have'; icon = '👥';
        title = 'יש לך ' + count + ' חברים';
        sub = 'הזמן עוד · +200💎 לכל הזמנה · 👆 חברים';
      }

      var el = document.getElementById('friends-banner');
      if (!el) {
        el = document.createElement('button');
        el.id = 'friends-banner';
        // Mount ABOVE the home footer links so it never renders as an orphan
        // tile below the privacy/how-to row. When the bottom-nav is active its
        // MutationObserver then relocates this banner into the קהילה (social)
        // tab — where "your friends are active" social-proof belongs — and the
        // tab earns an unread badge so the player is pulled to discover it. In
        // legacy (no bottom-nav) mode it simply stays here, above the footer.
        var ftb = home.querySelector('.home-v2-bottom');
        if (ftb && ftb.parentNode === home) home.insertBefore(el, ftb);
        else home.appendChild(el);
      }
      // Re-bind every render so the route reflects the CURRENT friend count.
      // Opens the unified friends hub straight on the right tab: a player with
      // no friends lands on 🔍 חיפוש (add someone now); everyone else lands on
      // 👥 חברים (see who's online + one-tap ⚔️ duel / 🎯 challenge). One window,
      // no drilling into a second modal.
      el.onclick = function() {
        var tab = forceTab || ((count === 0) ? 'search' : 'friends');
        if (typeof window.showFriendsModal === 'function') {
          window.showFriendsModal(tab);
        } else if (window.__bloomFriendSearch && typeof window.__bloomFriendSearch.showModal === 'function') {
          window.__bloomFriendSearch.showModal(tab === 'friends' ? 'search' : tab);
        }
      };
      // Task #22 — entrance via the shared micro-interaction token (ui-pop-in).
      el.className = 'friends-banner ui-pop-in ' + cls;
      el.innerHTML =
        '<span class="friends-banner-icon">' + icon + '</span>' +
        '<span class="friends-banner-body">' +
          '<span class="friends-banner-title">' + title + '</span>' +
          '<span class="friends-banner-sub">' + sub + '</span>' +
        '</span>' +
        '<span class="friends-banner-arrow">›</span>';
    });
  }

  try {
    window.__bloomFriendsBanner = { maybeShow: maybeShowFriendsBanner };
  } catch (e) {}
})();
