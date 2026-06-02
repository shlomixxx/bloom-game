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
    window.fetchFriends(false).then(function(d) {
      if (!d || !d.ok) return;
      var friends = Array.isArray(d.friends) ? d.friends : [];
      var count = friends.length;
      var online = 0, today = 0;
      for (var i = 0; i < friends.length; i++) {
        if (friends[i] && friends[i].onlineNow) online++;
        if (friends[i] && friends[i].playedToday) today++;
      }

      var icon, title, sub, cls;
      if (count === 0) {
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
        el.onclick = function() {
          // Open the friends HUB (online status + one-tap ⚔️ duel / 🎯 challenge
          // per friend), not the bare search — so "N friends online" leads
          // straight to acting on them. Falls back to search if unavailable.
          if (typeof window.showFriendsModal === 'function') {
            window.showFriendsModal();
          } else if (window.__bloomFriendSearch && typeof window.__bloomFriendSearch.showModal === 'function') {
            window.__bloomFriendSearch.showModal('search');
          }
        };
        // Append to the home tile area (below the hero) — slim, so it never
        // competes with the primary PLAY CTA.
        home.appendChild(el);
      }
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
