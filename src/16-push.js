  // ============================================================
  // WEB PUSH NOTIFICATIONS — closed-app delivery for social events
  // ============================================================
  // Subscribes the player to PWA push notifications so duel invites,
  // gifts, and results land on their device even when BLOOM isn't
  // open. The whole flow is silent until the player takes a social
  // action (sends a duel, accepts a gift, etc.), at which point we
  // present a soft prompt rather than the hard browser permission
  // dialog out of the blue.
  //
  // Browser support:
  //   • Chrome / Edge / Firefox (any OS, any modern version)
  //   • Safari macOS 16+
  //   • Safari iOS 16.4+ ONLY if the site is installed as a PWA
  //     (Share → "Add to Home Screen"). Otherwise no push.
  // ============================================================

  const PUSH_PROMPT_SHOWN_KEY = 'bloom_push_prompt_shown';
  const PUSH_SUBSCRIBED_KEY   = 'bloom_push_subscribed';

  function pushSupportedHere() {
    return ('serviceWorker' in navigator) &&
           ('PushManager' in window) &&
           (typeof Notification !== 'undefined');
  }
  function pushPermissionState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  // Convert the server's base64url-encoded VAPID public key into the
  // Uint8Array shape pushManager.subscribe() expects.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // Idempotent subscribe — safe to call any number of times.
  // Returns true if a subscription is active afterwards, false otherwise.
  async function subscribeToPush() {
    if (!pushSupportedHere()) return false;
    if (pushPermissionState() !== 'granted') return false;
    try {
      const sw = await navigator.serviceWorker.ready;
      let sub = await sw.pushManager.getSubscription();
      if (!sub) {
        const vapidResp = await fetch(API_BASE + '/api/push/vapid-public');
        const vapidData = await vapidResp.json();
        if (!vapidData || !vapidData.key) return false;
        sub = await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.key)
        });
      }
      const sj = sub.toJSON();
      const sendResp = await fetch(API_BASE + '/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          token: deviceToken,
          endpoint: sj.endpoint,
          keys: sj.keys
        })
      });
      const sendJson = await sendResp.json().catch(function() { return null; });
      const ok = !!(sendJson && sendJson.ok);
      try { localStorage.setItem(PUSH_SUBSCRIBED_KEY, ok ? '1' : '0'); } catch (e) {}
      return ok;
    } catch (e) {
      console.warn('[push] subscribe failed', e && e.message);
      return false;
    }
  }

  // Soft pre-prompt UX — overlay modal that explains what the player
  // will get, with two buttons. Tapping "כן" triggers the hard browser
  // permission dialog. Tapping "אחר כך" defers (with a long cooldown).
  // This dramatically increases permission-grant rates vs firing the
  // raw browser dialog out of nowhere.
  function showPushPrePrompt(reasonTextHe) {
    if (document.getElementById('push-pre-prompt')) return Promise.resolve(false);
    return new Promise(function(resolve) {
      const overlay = document.createElement('div');
      overlay.id = 'push-pre-prompt';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10005;' +
        'display:flex;align-items:center;justify-content:center;direction:rtl;padding:18px;' +
        'animation:fadeIn 0.25s ease-out';
      overlay.innerHTML =
        '<div style="background:linear-gradient(180deg,#FFF,#FFF8E7);border-radius:20px;' +
          'padding:24px 22px;max-width:340px;width:100%;text-align:center;' +
          'box-shadow:0 20px 60px rgba(0,0,0,0.35);border:2px solid #FAC775">' +
          '<div style="font-size:48px;line-height:1;margin-bottom:8px">🔔</div>' +
          '<div style="font-size:20px;font-weight:900;color:#1C1A18">הפעל התראות מיידיות</div>' +
          '<div style="font-size:13px;color:#6F6E68;margin:10px 0 18px;line-height:1.5">' +
            (reasonTextHe || 'כשמישהו יאתגר אותך או ישלח לך מתנה — תקבל הודעה מיד, גם כשהמשחק סגור.') +
          '</div>' +
          '<button id="push-prompt-yes" style="width:100%;padding:14px;border:none;border-radius:12px;' +
            'background:linear-gradient(135deg,#FAC775,#BA7517);color:#FFF;font-size:16px;font-weight:800;' +
            'cursor:pointer;font-family:inherit;margin-bottom:8px">' +
            '✅ הפעל התראות' +
          '</button>' +
          '<button id="push-prompt-no" style="width:100%;padding:10px;border:none;' +
            'background:transparent;color:#6F6E68;font-size:13px;font-weight:500;' +
            'cursor:pointer;font-family:inherit">' +
            'אחר כך' +
          '</button>' +
        '</div>';
      document.body.appendChild(overlay);
      const close = function(answer) {
        overlay.style.transition = 'opacity 0.2s';
        overlay.style.opacity = '0';
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve(answer);
        }, 200);
      };
      document.getElementById('push-prompt-yes').onclick = function() { close(true); };
      document.getElementById('push-prompt-no').onclick = function() { close(false); };
      overlay.onclick = function(e) { if (e.target === overlay) close(false); };
    });
  }

  // Public API the rest of the app calls when a social action makes
  // a great moment to ask. Marks "shown" so we don't re-prompt for
  // a configurable cooldown (3 days). Idempotent — repeated calls
  // are no-ops once the user has answered.
  async function maybeAskForPushPermission(reasonTextHe) {
    if (!pushSupportedHere()) return false;
    const state = pushPermissionState();
    if (state === 'granted') {
      // Already granted — just (re)subscribe quietly.
      await subscribeToPush();
      return true;
    }
    if (state === 'denied') return false; // can't re-ask, user said no in browser settings
    // 'default' — we can ask, but only if we haven't already in the cooldown.
    try {
      const lastShown = parseInt(localStorage.getItem(PUSH_PROMPT_SHOWN_KEY) || '0', 10) || 0;
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastShown < threeDays) return false;
    } catch (e) {}

    const wantsIt = await showPushPrePrompt(reasonTextHe);
    try { localStorage.setItem(PUSH_PROMPT_SHOWN_KEY, String(Date.now())); } catch (e) {}
    if (!wantsIt) return false;

    // The hard browser permission dialog. The pre-prompt above means
    // most users tap "allow" — and the ones who don't never see this
    // dialog at all.
    try {
      const result = await Notification.requestPermission();
      if (result !== 'granted') return false;
      await subscribeToPush();
      return true;
    } catch (e) {
      console.warn('[push] permission request failed', e);
      return false;
    }
  }
  try { window.__bloomMaybeAskPush = maybeAskForPushPermission; } catch (e) {}

  // Listen for messages from the service worker:
  //   - 'bloom-push-click' — user tapped a notification; deep-link.
  //   - 'bloom-push-resubscribe' — endpoint rotated; re-POST subscribe.
  if (pushSupportedHere() && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function(event) {
      const d = event.data || {};
      if (d.type === 'bloom-push-click') {
        // Deep-link routing. For now we just navigate to the URL and
        // rely on the page-level handler (showDuelModal, showGiftFriend
        // etc.) to pick up the ?action=... param if present.
        try {
          const u = new URL(d.url, window.location.origin);
          if (u.pathname === window.location.pathname) {
            // Same page — fire the action param locally without reload.
            const action = u.searchParams.get('action');
            if (action === 'duels' && typeof showDuelModal === 'function') showDuelModal();
            else if (action === 'gift' && typeof showGiftFriendModal === 'function') showGiftFriendModal();
            else window.location.href = u.toString();
          } else {
            window.location.href = u.toString();
          }
        } catch (e) {}
      } else if (d.type === 'bloom-push-resubscribe' && d.subscription) {
        // Server-side re-subscribe with the rotated endpoint
        fetch(API_BASE + '/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: deviceId,
            token: deviceToken,
            endpoint: d.subscription.endpoint,
            keys: d.subscription.keys
          })
        }).catch(function() {});
      }
    });
  }

  // On every page load, if permission is ALREADY granted, refresh the
  // subscription server-side. This catches the case where the server
  // wiped the subscription (user marked themselves as opted out via
  // some other path) but the browser still has the subscription —
  // we'd then be silent when we shouldn't be.
  if (pushPermissionState() === 'granted') {
    setTimeout(function() { subscribeToPush(); }, 2500);
  }
