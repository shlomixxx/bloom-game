// ============================================================
// FD.2 — Cross-device Account Sync (May 29 2026)
//
// Solves the single biggest mobile-web retention bug: same person
// loads BLOOM on Safari and Chrome, sees two different identities
// (each browser has its own deviceId in localStorage). Trophies,
// streak, achievements, friends — all duplicated across browsers,
// none aligned.
//
// Flow:
//   Device A (player's existing identity):
//     1. Tap "🔗 סנכרן בין מכשירים"
//     2. Tap "צור קוד" → server returns 6-char code + 10-min countdown
//     3. Player shares the code with themselves (WhatsApp / paper / etc.)
//
//   Device B (the browser missing the identity):
//     1. Tap "🔗 סנכרן בין מכשירים"
//     2. Tap "הכנס קוד" → enters the 6-char code
//     3. Server validates, returns deviceId + token of device A.
//        Client overwrites bloom_device_id + bloom_device_token, then
//        reloads the page. Device B is now the same logical player as A.
//
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';

  var DEVICE_ID_KEY = 'bloom_device_id';
  var DEVICE_TOKEN_KEY = 'bloom_device_token';

  function getDeviceId() {
    try { return localStorage.getItem(DEVICE_ID_KEY) || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem(DEVICE_TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function showSyncModal(initialTab) {
    var existing = document.getElementById('device-sync-modal');
    if (existing) { existing.remove(); return; }

    var ov = document.createElement('div');
    ov.id = 'device-sync-modal';
    ov.className = 'device-sync-overlay modal-overlay';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

    var card = document.createElement('div');
    card.className = 'device-sync-card';

    // Header
    var head = document.createElement('div');
    head.className = 'device-sync-head';
    var close = document.createElement('button');
    close.className = 'device-sync-close modal-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'סגור');
    close.textContent = '✕';
    close.onclick = function() { ov.remove(); };
    head.appendChild(close);
    var title = document.createElement('div');
    title.className = 'device-sync-title';
    title.textContent = '🔗 סנכרן בין מכשירים';
    head.appendChild(title);
    var sub = document.createElement('div');
    sub.className = 'device-sync-sub';
    sub.textContent = 'אותו שחקן בכל הדפדפנים — רצף · גביעים · חברים נשמרים';
    head.appendChild(sub);
    card.appendChild(head);

    // Tabs
    var tabs = document.createElement('div');
    tabs.className = 'device-sync-tabs';
    var tabCreate = document.createElement('button');
    tabCreate.type = 'button';
    tabCreate.className = 'device-sync-tab';
    tabCreate.textContent = '📤 צור קוד';
    var tabRedeem = document.createElement('button');
    tabRedeem.type = 'button';
    tabRedeem.className = 'device-sync-tab';
    tabRedeem.textContent = '📥 הכנס קוד';
    tabs.appendChild(tabCreate);
    tabs.appendChild(tabRedeem);
    card.appendChild(tabs);

    var body = document.createElement('div');
    body.className = 'device-sync-body';
    card.appendChild(body);

    function activate(which) {
      tabCreate.classList.toggle('active', which === 'create');
      tabRedeem.classList.toggle('active', which === 'redeem');
      while (body.firstChild) body.removeChild(body.firstChild);
      if (which === 'create') renderCreateTab(body);
      else renderRedeemTab(body);
    }
    tabCreate.onclick = function() { activate('create'); };
    tabRedeem.onclick = function() { activate('redeem'); };

    ov.appendChild(card);
    document.body.appendChild(ov);
    activate(initialTab === 'redeem' ? 'redeem' : 'create');
  }

  // ===== Create-code tab =====
  var _createTicker = null;
  function renderCreateTab(host) {
    if (_createTicker) { clearInterval(_createTicker); _createTicker = null; }

    var intro = document.createElement('div');
    intro.className = 'device-sync-intro';
    intro.textContent = '👇 הקש "צור קוד", יופיע קוד של 6 תווים. הכנס אותו במכשיר השני (סמרטפון אחר / דפדפן אחר) ושם תבחר "הכנס קוד". המכשיר השני יקבל את אותו שחקן.';
    host.appendChild(intro);

    var actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'device-sync-action';
    actionBtn.textContent = '📤 צור קוד סנכרון';
    host.appendChild(actionBtn);

    var resultBox = document.createElement('div');
    resultBox.className = 'device-sync-result';
    host.appendChild(resultBox);

    var errBox = document.createElement('div');
    errBox.className = 'device-sync-err';
    host.appendChild(errBox);

    actionBtn.onclick = function() {
      errBox.textContent = '';
      var did = getDeviceId();
      var tok = getToken();
      if (!did || !tok) {
        errBox.textContent = 'עוד אין לך זהות שמורה — שחק משחק ראשון קודם';
        return;
      }
      actionBtn.disabled = true;
      actionBtn.textContent = '⏳ יוצר קוד…';
      fetch('/api/account/transfer-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: did, token: tok })
      })
        .then(function(r) { return r.json(); })
        .catch(function() { return { ok: false, reason: 'network' }; })
        .then(function(d) {
          actionBtn.disabled = false;
          actionBtn.textContent = '🔄 צור קוד חדש';
          if (!d || !d.ok) {
            var msgs = {
              disabled: 'הסנכרון מושבת זמנית', no_profile: 'עוד אין לך פרופיל — שחק קודם',
              rate_limited: 'יותר מדי בקשות — נסה שוב בעוד שעה', network: 'שגיאת רשת',
              code_collision: 'נסה שוב', bad_device: 'זהות המכשיר לא תקינה'
            };
            errBox.textContent = msgs[d && d.reason] || 'שגיאה';
            return;
          }
          showCode(resultBox, d.code, d.expiresInSec);
        });
    };
  }

  function showCode(host, code, secondsLeft) {
    while (host.firstChild) host.removeChild(host.firstChild);

    var codeWrap = document.createElement('div');
    codeWrap.className = 'device-sync-code';
    // Show code with a space in the middle for readability.
    for (var i = 0; i < code.length; i++) {
      var ch = document.createElement('span');
      ch.className = 'device-sync-code-ch';
      ch.textContent = code[i];
      codeWrap.appendChild(ch);
    }
    host.appendChild(codeWrap);

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'device-sync-copy';
    copyBtn.textContent = '📋 העתק את הקוד';
    copyBtn.onclick = function() {
      var origText = copyBtn.textContent;
      var done = function() {
        copyBtn.textContent = '✓ הועתק! עכשיו הכנס אותו במכשיר השני';
        setTimeout(function() { copyBtn.textContent = origText; }, 2200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, done);
      } else { done(); }
    };
    host.appendChild(copyBtn);

    var counter = document.createElement('div');
    counter.className = 'device-sync-counter';
    host.appendChild(counter);

    var endsAt = Date.now() + (secondsLeft | 0) * 1000;
    function tick() {
      var msLeft = Math.max(0, endsAt - Date.now());
      var sec = Math.floor(msLeft / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      counter.textContent = '⏰ תקף עוד ' + m + ':' + (s < 10 ? '0' : '') + s;
      if (msLeft <= 0) {
        if (_createTicker) { clearInterval(_createTicker); _createTicker = null; }
        counter.textContent = '⏰ הקוד פג תוקף — צור חדש';
        counter.classList.add('expired');
      }
    }
    tick();
    if (_createTicker) clearInterval(_createTicker);
    _createTicker = setInterval(tick, 1000);

    var hint = document.createElement('div');
    hint.className = 'device-sync-hint';
    hint.textContent = '💡 שתף את הקוד עם עצמך בוואטסאפ או כתוב במשהו — קל לאבד אותו בין דפדפנים';
    host.appendChild(hint);
  }

  // ===== Redeem tab =====
  function renderRedeemTab(host) {
    if (_createTicker) { clearInterval(_createTicker); _createTicker = null; }

    var intro = document.createElement('div');
    intro.className = 'device-sync-intro';
    intro.textContent = '⚠️ זהירות: הזהות הנוכחית במכשיר הזה (אם יש לך כזו) תוחלף לזהות מהקוד. אם כבר שיחקת כאן הרבה — דאג שהקוד הוא אכן שלך מהמכשיר השני.';
    host.appendChild(intro);

    var inputWrap = document.createElement('div');
    inputWrap.className = 'device-sync-input-wrap';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'device-sync-input';
    input.maxLength = 6;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'XXXXXX';
    input.addEventListener('input', function() {
      var v = (input.value || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
      if (v !== input.value) input.value = v;
    });
    inputWrap.appendChild(input);
    host.appendChild(inputWrap);

    var redeemBtn = document.createElement('button');
    redeemBtn.type = 'button';
    redeemBtn.className = 'device-sync-action';
    redeemBtn.textContent = '🔄 שחזר את החשבון';
    host.appendChild(redeemBtn);

    var errBox = document.createElement('div');
    errBox.className = 'device-sync-err';
    host.appendChild(errBox);

    redeemBtn.onclick = async function() {
      errBox.textContent = '';
      var code = (input.value || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      if (code.length !== 6) {
        errBox.textContent = 'הקוד חייב להיות 6 תווים (אותיות + ספרות)';
        return;
      }
      // Final confirmation — this is destructive on the current browser.
      var syncOk = (typeof window.__bloomConfirm === 'function')
        ? await window.__bloomConfirm('להחליף את הזהות במכשיר הזה?\nכל ההתקדמות הקיימת בדפדפן הזה תוחלף בזהות שמהקוד.', { icon: '🔗', danger: true, confirmText: 'החלף זהות' })
        : window.confirm('להחליף את הזהות במכשיר הזה? כל ההתקדמות הקיימת בדפדפן הזה תוחלף בזהות שמהקוד.');
      if (!syncOk) {
        return;
      }
      redeemBtn.disabled = true;
      redeemBtn.textContent = '⏳ משחזר…';
      fetch('/api/account/transfer-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, currentDeviceId: getDeviceId() })
      })
        .then(function(r) { return r.json(); })
        .catch(function() { return { ok: false, reason: 'network' }; })
        .then(function(d) {
          redeemBtn.disabled = false;
          redeemBtn.textContent = '🔄 שחזר את החשבון';
          if (!d || !d.ok) {
            var msgs = {
              not_found: 'קוד לא נמצא — בדוק שהקלדת נכון',
              expired: 'הקוד פג תוקף — צור חדש במכשיר השני',
              already_used: 'הקוד כבר נוצל פעם אחת',
              bad_code_format: 'הקוד לא בפורמט הנכון',
              disabled: 'הסנכרון מושבת זמנית',
              rate_limited: 'יותר מדי ניסיונות — נסה שוב בעוד שעה',
              network: 'שגיאת רשת'
            };
            errBox.textContent = msgs[d && d.reason] || 'שגיאה';
            return;
          }
          // Success — overwrite localStorage and reload.
          try {
            localStorage.setItem(DEVICE_ID_KEY, d.newDeviceId);
            localStorage.setItem(DEVICE_TOKEN_KEY, d.newToken);
            // Clear any cached identity-bound state we know about. The
            // full reload below will re-populate them from server.
            localStorage.removeItem('bloom_player_code');
            localStorage.removeItem('bloom_skins_grace_done');
          } catch (e) {}
          showSuccess();
        });
    };
    setTimeout(function() { try { input.focus(); } catch (_) {} }, 100);
  }

  function showSuccess() {
    var ov = document.getElementById('device-sync-modal');
    if (!ov) return;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    var card = document.createElement('div');
    card.className = 'device-sync-card device-sync-success';
    var icon = document.createElement('div');
    icon.className = 'device-sync-success-icon';
    icon.textContent = '✅';
    card.appendChild(icon);
    var title = document.createElement('div');
    title.className = 'device-sync-success-title';
    title.textContent = 'הסנכרון הצליח!';
    card.appendChild(title);
    var sub = document.createElement('div');
    sub.className = 'device-sync-success-sub';
    sub.textContent = 'הדפדפן הזה הוא עכשיו אותו שחקן. טוען מחדש…';
    card.appendChild(sub);
    ov.appendChild(card);
    setTimeout(function() {
      try { window.location.reload(); } catch (e) {}
    }, 1400);
  }

  // ===== Public API =====
  window.__bloomDeviceSync = {
    showModal: showSyncModal
  };
})();
