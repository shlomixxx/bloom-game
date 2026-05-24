// ============================================================
// A2 — Friend Challenges (K-factor viral lever, May 2026)
//
// Player A taps "🎯 אתגר" next to a friend → modal asks for target
// score + optional message → server creates a challenge + sends push.
// Player B sees it in inbox; plays any game; when their score crosses
// the target, server auto-resolves to 'passed' and pushes both sides.
//
// Both sides get gems on pass (`friend_challenge_win_reward` config,
// default 50💎 each). Encourages spamming challenges — A sees their
// friend get a gem credit and feels they "helped".
//
// Server endpoints:
//   POST /api/friend-challenges/send     — A challenges B
//   GET  /api/friend-challenges/mine     — list pending + recent results
//   POST /api/friend-challenges/:id/decline
//   (auto-resolve happens server-side on every score submission)
//
// This module is a standalone IIFE — pure window.* consumer.
// Surfaces:
//   - Send modal (opened from friends modal next to a friend row)
//   - My-challenges modal (active + recent results, opened from inbox)
//   - Inbox shows individual challenge events (server adds them)
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, data: null };
  var CACHE_MS = 30 * 1000;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Open the "send a challenge" modal pre-filled with a friend's BLOOM code.
  // Called from the friends modal row buttons OR with no arg (free-form input).
  function openSendModal(prefillFriendCode, prefillFriendName) {
    var existing = document.getElementById('friend-challenge-send-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'friend-challenge-send-modal';
    modal.className = 'fc-modal-overlay';
    modal.innerHTML =
      '<div class="fc-modal-card">' +
        '<button class="fc-modal-close" aria-label="סגור">×</button>' +
        '<div class="fc-modal-title">🎯 אתגר חבר</div>' +
        '<div class="fc-modal-sub">' +
          (prefillFriendName
            ? 'מאתגר את <strong>' + escapeHtml(prefillFriendName) + '</strong>'
            : 'תזין קוד החבר ויעד ניקוד') +
        '</div>' +
        '<label class="fc-modal-label">קוד חבר (BLOOM-)' +
          '<div class="fc-modal-code-row">' +
            '<span class="fc-modal-code-prefix">BLOOM-</span>' +
            '<input id="fc-friend-code" type="text" maxlength="4" placeholder="XXXX" value="' + escapeHtml(prefillFriendCode || '') + '" autocomplete="off" />' +
          '</div>' +
        '</label>' +
        '<label class="fc-modal-label">יעד ניקוד שהחבר צריך לעבור' +
          '<input id="fc-target-score" type="number" min="100" max="9999999" step="100" placeholder="50000" />' +
        '</label>' +
        '<label class="fc-modal-label">הודעה (אופציונלי)' +
          '<input id="fc-message" type="text" maxlength="100" placeholder="נסה לעבור אותי..." />' +
        '</label>' +
        '<div class="fc-modal-tip">📤 החבר יקבל push notification. 24 שעות לעבור. שניכם תקבלו 50💎 כשהוא יעבור.</div>' +
        '<div class="fc-modal-error" id="fc-modal-error"></div>' +
        '<button class="fc-modal-send-btn" id="fc-send-btn">🚀 שלח אתגר</button>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.fc-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    // Auto-uppercase + filter the code input.
    var codeInput = document.getElementById('fc-friend-code');
    if (codeInput) {
      codeInput.addEventListener('input', function() {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
      });
      // If we have a prefill, focus the score input instead.
      if (prefillFriendCode) {
        setTimeout(function() { document.getElementById('fc-target-score').focus(); }, 50);
      } else {
        setTimeout(function() { codeInput.focus(); }, 50);
      }
    }
    document.getElementById('fc-send-btn').onclick = function() {
      sendChallenge(close);
    };
  }

  function sendChallenge(closeFn) {
    var btn = document.getElementById('fc-send-btn');
    var errEl = document.getElementById('fc-modal-error');
    var code = (document.getElementById('fc-friend-code').value || '').trim().toUpperCase();
    var targetScore = parseInt(document.getElementById('fc-target-score').value, 10) || 0;
    var message = (document.getElementById('fc-message').value || '').trim();
    if (code.length !== 4) {
      errEl.textContent = 'קוד החבר חייב להיות 4 תווים (BLOOM-XXXX)';
      return;
    }
    if (targetScore < 100 || targetScore > 9999999) {
      errEl.textContent = 'יעד ניקוד חייב להיות בין 100 ל-9,999,999';
      return;
    }
    btn.disabled = true; btn.textContent = '⏳ שולח...';
    errEl.textContent = '';
    fetch('/api/friend-challenges/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        token: getToken(),
        challengedCode: code,
        targetScore: targetScore,
        message: message
      })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (d && d.ok) {
        try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([40, 30, 60]); } catch (e) {}
        if (typeof showToast === 'function') showToast('🎯 האתגר נשלח! החבר/ה יקבל/ת push', 'success');
        if (closeFn) closeFn();
      } else {
        btn.disabled = false; btn.textContent = '🚀 שלח אתגר';
        var reason = (d && d.reason) || 'error';
        var msgs = {
          friend_not_found: 'החבר/ה לא נמצא — בדוק את הקוד',
          not_friends: 'אתם לא חברים. הזמן/י תחילה.',
          too_many_pending: 'יש לך כבר 10 אתגרים פעילים — חכה שיסתיימו',
          cant_self_challenge: 'אי אפשר לאתגר את עצמך',
          bad_code: 'קוד החבר לא תקין',
          bad_target: 'יעד ניקוד לא תקין',
          disabled: 'אתגרי חברים כבויים',
          rate_limited: 'שולחים יותר מדי מהר — חכה דקה'
        };
        errEl.textContent = msgs[reason] || ('שגיאה: ' + reason);
      }
    });
  }

  // List my active + recent challenges.
  function fetchChallenges(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve(_cache.data);
    }
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/friend-challenges/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) { _cache.fetchedAt = Date.now(); _cache.data = d; }
        return d;
      });
  }

  // List modal — opens from inbox-click or from a future home tile.
  function openListModal() {
    var existing = document.getElementById('friend-challenge-list-modal');
    if (existing) { existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'friend-challenge-list-modal';
    modal.className = 'fc-modal-overlay';
    modal.innerHTML =
      '<div class="fc-modal-card fc-list-card">' +
        '<button class="fc-modal-close" aria-label="סגור">×</button>' +
        '<div class="fc-modal-title">🎯 האתגרים שלי</div>' +
        '<div class="fc-modal-sub">פעילים ותוצאות מ-7 ימים אחרונים</div>' +
        '<div class="fc-list-body" id="fc-list-body">' +
          '<div class="fc-list-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.fc-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchChallenges(true).then(function(d) {
      renderListBody(d);
    });
  }

  function renderListBody(d) {
    var host = document.getElementById('fc-list-body');
    if (!host) return;
    if (!d || !d.ok) {
      host.innerHTML = '<div class="fc-list-empty">שגיאה בקריאת הרשימה</div>';
      return;
    }
    var items = d.challenges || [];
    if (!items.length) {
      host.innerHTML =
        '<div class="fc-list-empty">' +
          '<div class="fc-list-empty-icon">🎯</div>' +
          '<div class="fc-list-empty-title">אין אתגרים כרגע</div>' +
          '<div class="fc-list-empty-sub">פתח את רשימת החברים ולחץ ⚔️ ליד חבר כדי לשלוח אתגר</div>' +
        '</div>';
      return;
    }
    host.innerHTML = items.map(renderChallengeRow).join('');
    host.querySelectorAll('[data-fc-action]').forEach(function(btn) {
      btn.onclick = function() {
        var action = btn.getAttribute('data-fc-action');
        var id = parseInt(btn.getAttribute('data-fc-id'), 10);
        if (!id) return;
        if (action === 'decline') declineChallenge(id, btn);
      };
    });
  }

  function renderChallengeRow(c) {
    var iAmChallenger = c.role === 'challenger';
    var otherName = iAmChallenger ? c.challengedName : c.challengerName;
    var status = c.status;
    var statusBadge, theme;
    if (status === 'pending') {
      theme = iAmChallenger ? 'fc-row-sent' : 'fc-row-incoming';
      statusBadge = iAmChallenger ? '⏳ שלחת' : '🎯 ממתין';
    } else if (status === 'passed') {
      theme = 'fc-row-passed';
      statusBadge = iAmChallenger ? '🏆 עברו' : '🏆 ניצחת';
    } else if (status === 'failed_expired') {
      theme = 'fc-row-expired';
      statusBadge = '⌛ פג תוקף';
    } else if (status === 'declined') {
      theme = 'fc-row-declined';
      statusBadge = '🚫 נדחה';
    } else {
      theme = '';
      statusBadge = status;
    }
    var countdown = '';
    if (status === 'pending' && c.msUntilExpiry > 0) {
      countdown = '<span class="fc-row-countdown">' + formatMsLeft(c.msUntilExpiry) + '</span>';
    }
    var actions = '';
    if (status === 'pending' && !iAmChallenger) {
      actions =
        '<button class="fc-row-btn fc-row-btn-primary" data-fc-action="play" data-fc-id="' + c.id + '">🎮 שחק עכשיו</button>' +
        '<button class="fc-row-btn fc-row-btn-secondary" data-fc-action="decline" data-fc-id="' + c.id + '">דחה</button>';
    }
    var resultLine = '';
    if (c.resultScore && status === 'passed') {
      resultLine = '<div class="fc-row-result">📊 תוצאה: <strong>' + c.resultScore.toLocaleString() + '</strong></div>';
    }
    return (
      '<div class="fc-row ' + theme + '">' +
        '<div class="fc-row-head">' +
          '<div class="fc-row-other">' + escapeHtml(otherName || 'חבר') + '</div>' +
          '<span class="fc-row-status">' + statusBadge + '</span>' +
          countdown +
        '</div>' +
        '<div class="fc-row-target">🎯 יעד: <strong>' + c.targetScore.toLocaleString() + '</strong> נקודות</div>' +
        (c.message ? '<div class="fc-row-message">"' + escapeHtml(c.message) + '"</div>' : '') +
        resultLine +
        (actions ? '<div class="fc-row-actions">' + actions + '</div>' : '') +
      '</div>'
    );
  }

  function declineChallenge(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    fetch('/api/friend-challenges/' + id + '/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken() })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (d && d.ok) {
        if (typeof showToast === 'function') showToast('האתגר נדחה', 'info');
        fetchChallenges(true).then(renderListBody);
      } else {
        if (btn) { btn.disabled = false; btn.textContent = 'דחה'; }
      }
    });
  }

  function formatMsLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'פג';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return h + 'ש ' + m + 'ד';
    return m + ' דקות';
  }

  // Active-challenge banner: read pending incoming challenges from cache
  // and show a "🎯 לעבור: 67K מאת @דניאל" pill during the daily/practice
  // game. Mounted in mode-bar area on init().
  function getActiveIncomingTargets() {
    var d = _cache.data;
    if (!d || !d.challenges) return [];
    var deviceId = getDeviceId();
    return d.challenges.filter(function(c) {
      return c.status === 'pending' && c.role === 'challenged' && c.msUntilExpiry > 0;
    }).sort(function(a, b) { return a.targetScore - b.targetScore; });
  }

  try {
    window.__bloomFriendChallenges = {
      openSendModal: openSendModal,
      openListModal: openListModal,
      refresh: function() { return fetchChallenges(true); },
      activeIncomingTargets: getActiveIncomingTargets
    };
  } catch (e) {}
})();
