  // ============ localStorage safe wrappers (T0.3) ============
  // Safari Private Mode + iOS quota errors + some Android in-app browsers
  // throw on direct localStorage access. Every site that touches a key
  // should go through safeGet/safeSet so a thrown call never aborts the
  // surrounding flow. Exposed on window so non-IIFE callers (admin panel,
  // bot.js) can reuse the same defense without re-implementing.
  function safeGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? (fallback === undefined ? null : fallback) : v;
    } catch (e) { return fallback === undefined ? null : fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }
  function safeGetJSON(key, fallback) {
    const raw = safeGet(key, null);
    if (raw === null) return fallback === undefined ? null : fallback;
    try { return JSON.parse(raw); }
    catch (e) { return fallback === undefined ? null : fallback; }
  }
  function safeSetJSON(key, value) {
    try { return safeSet(key, JSON.stringify(value)); }
    catch (e) { return false; }
  }
  try {
    window.__bloomStorage = { safeGet, safeSet, safeRemove, safeGetJSON, safeSetJSON };
  } catch (e) {}

  // ============ NAV STACK + SHELL (UX audit §2.1 + §3.1) ============
  // Lightweight navigation primitive: each non-game screen pushes itself
  // onto NavStack on entry; the shell's back button pops one level.
  // We deliberately don't lean on browser history — BLOOM screens are a
  // logical hierarchy (Spectator → Contest Leaderboard → Contest Menu →
  // Home), not a history of visits, and "back" should follow that tree.
  //
  // A "screen descriptor" is { id, title, enter, exit } where enter/exit
  // are optional callbacks. Enter runs on push (and on re-push after a
  // pop that returns here); exit runs when the screen is popped/replaced.
  const NavStack = (function() {
    const stack = []; // descriptors
    function current() { return stack.length ? stack[stack.length - 1] : null; }
    function depth() { return stack.length; }
    function push(descriptor) {
      if (!descriptor || !descriptor.id) return;
      // De-dupe consecutive identical entries so refreshing the same screen
      // doesn't grow the stack indefinitely.
      const top = current();
      if (top && top.id === descriptor.id) return;
      stack.push(descriptor);
      if (typeof descriptor.enter === 'function') {
        try { descriptor.enter(); } catch (e) { console.warn('NavStack.enter', e); }
      }
    }
    function replace(descriptor) {
      const popped = stack.pop();
      if (popped && typeof popped.exit === 'function') {
        try { popped.exit(); } catch (e) { /* swallow */ }
      }
      push(descriptor);
    }
    function back() {
      if (!stack.length) return false;
      const popped = stack.pop();
      if (popped && typeof popped.exit === 'function') {
        try { popped.exit(); } catch (e) { /* swallow */ }
      }
      const now = current();
      if (now && typeof now.enter === 'function') {
        try { now.enter(); } catch (e) { /* swallow */ }
      } else if (!now) {
        // Stack empty — route home.
        if (typeof window.showHome === 'function') window.showHome();
      }
      return true;
    }
    function reset() {
      while (stack.length) {
        const popped = stack.pop();
        if (popped && typeof popped.exit === 'function') {
          try { popped.exit(); } catch (e) { /* swallow */ }
        }
      }
    }
    return { push, replace, back, current, depth, reset };
  })();
  // Expose for handlers that live outside the IIFE scope (event delegation,
  // window.__bloomNav references, etc).
  try { window.__bloomNav = NavStack; } catch (e) {}

  // mountShell — renders a sticky top bar into a container. Used by every
  // non-game screen so the contest, challenge, profile, and spectator
  // surfaces all share one header (UX audit §2.1 — "feels like one app").
  //
  // opts = {
  //   target:    HTMLElement or selector to receive the shell (required)
  //   title:     screen title (string)
  //   subtitle:  optional small text under the title
  //   onBack:    function called when [←] is tapped. Defaults to NavStack.back.
  //              Pass null to hide the back button (e.g. on Home).
  //   actions:   array of { id, label, ariaLabel, icon, onClick } to render
  //              on the right side. Limit ~2 for layout sanity.
  // }
  function mountShell(opts) {
    opts = opts || {};
    const target = (typeof opts.target === 'string')
      ? document.querySelector(opts.target)
      : opts.target;
    if (!target) return null;

    // Remove any existing shell in this container — re-mounting is fine.
    const existing = target.querySelector(':scope > .shell');
    if (existing) existing.remove();

    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.setAttribute('role', 'banner');

    let html = '';
    // Back button (right side in RTL = visually leading)
    if (opts.onBack !== null) {
      html += '<button class="shell-back" id="shell-back" aria-label="חזור">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>';
    } else {
      html += '<div class="shell-back-spacer" aria-hidden="true"></div>';
    }

    // Title + optional subtitle
    html += '<div class="shell-title-wrap">' +
      '<div class="shell-title">' + escapeShellText(opts.title || 'BLOOM') + '</div>' +
      (opts.subtitle ? '<div class="shell-subtitle">' + escapeShellText(opts.subtitle) + '</div>' : '') +
    '</div>';

    // Right-side actions
    html += '<div class="shell-actions">';
    if (Array.isArray(opts.actions)) {
      opts.actions.slice(0, 3).forEach(function(a) {
        if (!a) return;
        html += '<button class="shell-action" data-shell-action-id="' + escapeShellText(a.id || '') + '"' +
          (a.ariaLabel ? ' aria-label="' + escapeShellText(a.ariaLabel) + '"' : '') + '>' +
          (a.icon || escapeShellText(a.label || '')) +
        '</button>';
      });
    }
    html += '</div>';

    shell.innerHTML = html;
    // Insert at the top of the target so it sticks above content.
    target.insertBefore(shell, target.firstChild);

    // Wire handlers
    const backBtn = shell.querySelector('#shell-back');
    if (backBtn) {
      backBtn.onclick = function() {
        if (typeof opts.onBack === 'function') { opts.onBack(); return; }
        NavStack.back();
      };
    }
    if (Array.isArray(opts.actions)) {
      opts.actions.forEach(function(a) {
        if (!a || typeof a.onClick !== 'function') return;
        const el = shell.querySelector('[data-shell-action-id="' + (a.id || '') + '"]');
        if (el) el.onclick = a.onClick;
      });
    }
    return shell;
  }
  function escapeShellText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Expose for screens implemented outside the IIFE direct-access pattern.
  try {
    window.__bloomMountShell = mountShell;
  } catch (e) {}

  // ============ THEME (light/dark/auto) ============
  // Cycle through three states from the mute popover. The actual <html
  // data-theme="…"> swap happens here AND in the early head script (so
  // first paint matches the saved preference — no flash of wrong theme).
  function getThemePref() {
    return localStorage.getItem('bloom_theme') || 'auto';
  }
  function applyTheme(pref) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = pref === 'dark' || (pref === 'auto' && prefersDark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1A1816' : '#F5F5F0');
  }
  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const cur = getThemePref();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    try { localStorage.setItem('bloom_theme', next); } catch (e) {}
    applyTheme(next);
  }
  function syncThemeRow() {
    const lbl = document.getElementById('theme-label');
    const st  = document.getElementById('theme-state');
    if (!lbl || !st) return;
    const cur = getThemePref();
    const txt = cur === 'auto' ? 'אוטומטי' : cur === 'dark' ? 'כהה' : 'בהיר';
    const icon = cur === 'auto' ? '🖥️' : cur === 'dark' ? '🌙' : '☀️';
    lbl.textContent = txt;
    st.textContent = icon;
  }
  // Re-apply theme when OS preference changes (only matters in 'auto' mode).
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function() {
      if (getThemePref() === 'auto') applyTheme('auto');
    });
  }

  function openMuteMenu(anchor) {
    const existing = document.getElementById('mute-menu');
    if (existing) { closeMuteMenu(); return; }
    ensureAudio();
    // Append to home-screen when opened from home (so it's above the home overlay).
    // Otherwise append to .app for the regular in-game context.
    const parent = (anchor === 'home' && document.getElementById('home-screen'))
      || document.querySelector('.app');
    if (!parent) return;
    const menu = document.createElement('div');
    menu.id = 'mute-menu';
    menu.className = 'mute-menu mute-menu-volumes ' + (anchor === 'home' ? 'from-home' : 'from-top');
    menu.innerHTML =
      volSliderHtml('music', musicVolume) +
      volSliderHtml('sfx', sfxVolume) +
      '<div class="mute-item mute-item-theme" data-kind="theme">' +
        '<div class="mute-item-icon">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
        '</div>' +
        '<div class="mute-item-label">מצב <span id="theme-label">—</span></div>' +
        '<div class="mute-item-state" id="theme-state">—</div>' +
      '</div>' +
      '<div class="mute-item mute-item-all" data-kind="all">' +
        '<div class="mute-item-label">השתק הכל</div>' +
      '</div>' +
      '<div class="mute-item mute-item-reset" data-kind="reset" style="background:linear-gradient(135deg,#9FE1CB,#4FBD8B);color:#04342C;cursor:pointer">' +
        '<div class="mute-item-label" style="font-weight:800">🔊 איפוס סאונד</div>' +
        '<div class="mute-item-state" style="font-size:11px;opacity:0.8">לחיצה חוזרת אם הסאונד נעלם</div>' +
      '</div>';
    parent.appendChild(menu);
    syncMuteMenuItems();

    // Slider inputs — live update both per-channel state and the playing audio.
    menu.querySelectorAll('input.vol-slider').forEach(function(slider) {
      const kind = slider.getAttribute('data-slider');
      slider.addEventListener('input', function() {
        const v = (parseInt(this.value, 10) | 0) / 100;
        if (kind === 'music') setMusicVolume(v);
        else if (kind === 'sfx') setSfxVolume(v, { silent: true });
      });
      // Confirm chirp at the END of an SFX drag (not during) — once
      slider.addEventListener('change', function() {
        if (kind === 'sfx' && !isSfxMuted()) {
          tone({ freq: 523, duration: 0.07, type: 'sine', vol: 0.12 });
        }
      });
    });

    // Mute-all / unmute-all row
    const allBtn = menu.querySelector('[data-kind="all"]');
    if (allBtn) allBtn.onclick = function(e) {
      e.stopPropagation();
      if (isMusicMuted() && isSfxMuted()) unmuteAll(); else muteAll();
    };

    // Audio reset button — re-creates the audio context, restores volumes
    // to defaults if they collapsed to zero, plays a test chirp. Recovery
    // path for the "I lost all sound" complaint.
    const resetBtn = menu.querySelector('[data-kind="reset"]');
    if (resetBtn) resetBtn.onclick = function(e) {
      e.stopPropagation();
      if (typeof window.__bloomResetAudio === 'function') window.__bloomResetAudio();
    };

    // Theme cycle: auto → light → dark → auto
    const themeBtn = menu.querySelector('[data-kind="theme"]');
    if (themeBtn) themeBtn.onclick = function(e) {
      e.stopPropagation();
      cycleTheme();
      syncThemeRow();
    };
    syncThemeRow();

    setTimeout(function() {
      const onOutside = function(e) {
        if (!menu.contains(e.target) && !e.target.closest('#mute, #home-mute')) {
          closeMuteMenu();
          document.removeEventListener('pointerdown', onOutside, true);
        }
      };
      document.addEventListener('pointerdown', onOutside, true);
      menu.__outsideHandler = onOutside;
    }, 0);
  }
  function closeMuteMenu() {
    const menu = document.getElementById('mute-menu');
    if (!menu) return;
    if (menu.__outsideHandler) document.removeEventListener('pointerdown', menu.__outsideHandler, true);
    menu.remove();
  }
  function syncMuteMenuItems() {
    const menu = document.getElementById('mute-menu');
    if (!menu) return;
    const updates = [
      { kind: 'music', vol: musicVolume, muted: isMusicMuted() },
      { kind: 'sfx',   vol: sfxVolume,   muted: isSfxMuted() }
    ];
    updates.forEach(function(u) {
      const row = menu.querySelector('[data-kind="' + u.kind + '"]');
      if (!row) return;
      row.classList.toggle('off', u.muted);
      const pct = menu.querySelector('[data-pct="' + u.kind + '"]');
      if (pct) pct.textContent = Math.round(u.vol * 100) + '%';
      const slider = menu.querySelector('input[data-slider="' + u.kind + '"]');
      // Only set value if it doesn't match — avoids fighting an active drag.
      if (slider) {
        const want = String(Math.round(u.vol * 100));
        if (slider.value !== want) slider.value = want;
      }
    });
    const allItem = menu.querySelector('[data-kind="all"]');
    if (allItem) {
      allItem.querySelector('.mute-item-label').textContent =
        (isMusicMuted() && isSfxMuted()) ? 'הפעל הכל' : 'השתק הכל';
    }
  }

  /* ============ STREAK + ACHIEVEMENTS ============ */
  let currentGameMaxChain = 0;
  let streakBumpedThisSession = false;

  // Per-game stats for the game-over summary
  let gameMergesPerTier = {}; // tier → count of merges that CREATED this tier
  let gamePointsPerTier = {}; // tier → total points earned from this tier
  let gameBestMergeTier = 0;  // highest tier created from a single merge
  let gameTotalMerges = 0;    // total merge events
  let gameStartTime = 0;      // Date.now() when game started
  let bestBeatenThisGame = false; // live best tracking
  let usedContinue = false;       // second chance (once per game)
  const TOTAL_PLAY_TIME_KEY = 'bloom_total_play_ms';

  // ──────────────────────────────────────────────────────────────────────
  // Transient banner helper — all celebratory overlays (Crown Merge, score
  // milestones, new-best, etc.) go through this. Guarantees:
  //  - Always tagged `data-bloom-banner` so init() can sweep stuck ones on
  //    a new game (the original bug: setTimeout never firing on tab-blur or
  //    page-restore left modals stuck on the board).
  //  - Click-to-dismiss (pointer-events:auto on the banner itself), with a
  //    safety-net force-remove at hold + fade + 1500ms.
  //  - Idempotent — calling dispose twice is a no-op.
  function showTransientBanner(opts) {
    opts = opts || {};
    var holdMs = opts.holdMs != null ? opts.holdMs : 1500;
    var fadeMs = opts.fadeMs != null ? opts.fadeMs : 300;
    var banner = document.createElement('div');
    banner.setAttribute('data-bloom-banner', opts.tag || '1');
    banner.style.cssText = (opts.style || '') + ';cursor:pointer';
    banner.innerHTML = opts.html || '';
    var removed = false;
    function dispose() {
      if (removed) return;
      removed = true;
      try { banner.remove(); } catch (e) {}
    }
    function startFade() {
      if (removed) return;
      banner.style.transition = 'opacity ' + (fadeMs / 1000) + 's, transform ' + (fadeMs / 1000) + 's';
      banner.style.opacity = '0';
      if (opts.exitTransform) banner.style.transform = opts.exitTransform;
    }
    banner.addEventListener('click', dispose);
    document.body.appendChild(banner);
    if (opts.afterAppend) try { opts.afterAppend(banner); } catch (e) {}
    setTimeout(startFade, holdMs);
    setTimeout(dispose, holdMs + fadeMs);
    // Safety net: tab-throttling or page-hide can pause setTimeout. A delayed
    // force-cleanup catches any straggler when the user comes back.
    setTimeout(dispose, holdMs + fadeMs + 1500);
    return banner;
  }

  // Sweep any leftover banners — called by init() when a new game starts so
  // a celebration from the previous round can't carry over to a fresh board.
  function clearTransientBanners() {
    var els = document.querySelectorAll('[data-bloom-banner]');
    for (var i = 0; i < els.length; i++) els[i].remove();
  }

  // ============ §3.4 GENERIC TOAST HELPER ============
  // The audit asked for a single `showToast(text, type)` so every async
  // action (join contest, submit name, ad watch, etc) can confirm itself
  // in a consistent way. Implemented as a thin wrapper over the existing
  // transient-banner machinery so we don't duplicate the cleanup logic.
  //
  //   showToast('הצטרפת לתחרות הקיץ ✓');                     // info
  //   showToast('שגיאת חיבור — נסה שוב', 'error');           // error
  //   showToast('הציון נשמר!', 'success');                   // success
  function showToast(text, type) {
    if (!text) return null;
    type = type || 'info';
    var palette = {
      info:    { bg: '#FFF',     fg: '#1C1A18', border: 'rgba(0,0,0,0.10)' },
      success: { bg: '#2E8B6F',  fg: '#FFF',    border: 'transparent' },
      error:   { bg: '#FF8C42',  fg: '#FFF',    border: 'transparent' },
      warning: { bg: '#FAC775',  fg: '#412402', border: 'transparent' }
    };
    var p = palette[type] || palette.info;
    // De-dupe by tag so rapid successive toasts of the same type stack
    // gracefully (the previous banner gets cleaned up by its own timer).
    var safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return showTransientBanner({
      tag: 'toast-' + type,
      style: 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);' +
             'background:' + p.bg + ';color:' + p.fg + ';' +
             'border:1px solid ' + p.border + ';' +
             'padding:10px 18px;border-radius:10px;z-index:10005;' +
             'box-shadow:0 6px 24px rgba(0,0,0,0.18);direction:rtl;' +
             'font-size:14px;font-weight:600;letter-spacing:0.01em;' +
             'max-width:80vw;text-align:center;',
      html: safe,
      holdMs: 2400,
      fadeMs: 350,
      exitTransform: 'translateX(-50%) translateY(10px)'
    });
  }
  // Expose globally so screens defined outside the IIFE direct-access
  // pattern (or future src/15-ftue.js etc) can still call it.
  try { window.__bloomToast = showToast; } catch (e) {}

  function showNewBestBanner() {
    showTransientBanner({
      tag: 'new-best',
      holdMs: 1500, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#FAC775,#BA7517);border-radius:20px;padding:18px 30px;pointer-events:auto;text-align:center;box-shadow:0 0 30px rgba(250,199,117,0.5);min-width:180px',
      html: '<div style="font-size:22px;font-weight:800;color:#1C1A18">🎉 שיא חדש!</div><div style="font-size:28px;font-weight:900;color:#412402;margin-top:4px">' + score.toLocaleString() + '</div>',
    });
    buzz([80, 40, 80, 40, 80]);
    showConfetti(25);
    var bestShake = parseInt(getEventConfig('shake_new_best', '4'), 10) || 0;
    if (bestShake > 0) shakeGrid(bestShake);
  }

  // Per-game tracking: which milestone tiers have already paid their bonus.
  // Reset in init() at the start of each game. The bonuses fire ONCE per
  // game when the player's highestTier crosses 5/6/7/8 for the first time.
  let tierUpHit = {};
  const TIER_UP_BONUS = { 5: 500, 6: 1500, 7: 5000, 8: 15000 };

  function loadStreak() {
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      if (!raw) return { count: 0, lastPlayed: null };
      const v = JSON.parse(raw);
      return { count: v.count | 0, lastPlayed: v.lastPlayed || null };
    } catch (e) { return { count: 0, lastPlayed: null }; }
  }
  function saveStreak(s) { try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch (e) {} }
  function daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00Z');
    const db = new Date(b + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }
  function bumpStreak() {
    const today = todayInIsrael();
    const s = loadStreak();
    if (s.lastPlayed === today) return s;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) === 1) s.count = (s.count | 0) + 1;
    else s.count = 1;
    s.lastPlayed = today;
    saveStreak(s);
    bumpLifetimeMax(BEST_STREAK_KEY, s.count);
    renderStreakBadge();
    checkAchievements({ streakNow: s.count });
    // Earn streak credits at milestones
    if (!window.__bloomBotActive) {
      if (s.count === 3) earnCredits('streak_3');
      else if (s.count === 7) earnCredits('streak_7');
      else if (s.count === 30) earnCredits('streak_30');
    }
    return s;
  }
  function renderStreakBadge() {
    const el = document.getElementById('streak');
    if (!el) return;
    const s = loadStreak();
    const today = todayInIsrael();
    let n = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) n = 0;
    el.textContent = '🔥 ' + n;
    if (n > 0) el.classList.remove('zero');
    else el.classList.add('zero');
  }

  const ACH_GROUPS = [
    { id: 'tier', name: 'דרגות' },
    { id: 'chain', name: 'שרשראות' },
    { id: 'score', name: 'ניקוד' },
    { id: 'streak', name: 'רצף ימים' },
    { id: 'general', name: 'כללי' }
  ];
  const ACHIEVEMENTS = [
    { id: 'tier_fire',   group: 'tier',    name: 'אש',             desc: 'הגעת לדרגת אש',     check: function(s){ return s.highestTier >= 4; } },
    { id: 'tier_star',   group: 'tier',    name: 'כוכב',            desc: 'הגעת לדרגת כוכב',   check: function(s){ return s.highestTier >= 6; } },
    { id: 'tier_crown',  group: 'tier',    name: 'כתר',             desc: 'הגעת לדרגת כתר',    check: function(s){ return s.highestTier >= 8; } },
    { id: 'chain_2',     group: 'chain',   name: 'שרשרת ×1.5',      desc: 'שרשרת של 2 מיזוגים',  check: function(s){ return s.maxChain >= 2; } },
    { id: 'chain_3',     group: 'chain',   name: 'שרשרת ×2',        desc: 'שרשרת של 3 מיזוגים',  check: function(s){ return s.maxChain >= 3; } },
    { id: 'chain_5',     group: 'chain',   name: 'שרשרת ×3',        desc: 'שרשרת של 5 מיזוגים',  check: function(s){ return s.maxChain >= 5; } },
    { id: 'score_10k',   group: 'score',   name: '10,000',          desc: 'הגעת ל-10K במשחק אחד', check: function(s){ return s.score >= 10000; } },
    { id: 'score_50k',   group: 'score',   name: '50,000',          desc: 'הגעת ל-50K במשחק אחד', check: function(s){ return s.score >= 50000; } },
    { id: 'score_100k',  group: 'score',   name: '100,000',         desc: 'הגעת ל-100K במשחק אחד',check: function(s){ return s.score >= 100000; } },
    { id: 'streak_3',    group: 'streak',  name: '3 ימים',          desc: 'שיחקת 3 ימים רצוף',    check: function(s){ return s.streakNow >= 3; } },
    { id: 'streak_7',    group: 'streak',  name: 'שבוע',            desc: '7 ימים רצוף',          check: function(s){ return s.streakNow >= 7; } },
    { id: 'streak_30',   group: 'streak',  name: 'חודש',            desc: '30 ימים רצוף',         check: function(s){ return s.streakNow >= 30; } },
    { id: 'first_play',  group: 'general', name: 'המשחק הראשון',    desc: 'התחלת לשחק',          check: function(s){ return (s.gamesPlayed | 0) >= 1; } },
    { id: 'games_10',    group: 'general', name: '10 משחקים',       desc: 'סיימת 10 משחקים',      check: function(s){ return (s.gamesPlayed | 0) >= 10; } },
    { id: 'games_50',    group: 'general', name: '50 משחקים',       desc: 'סיימת 50 משחקים',      check: function(s){ return (s.gamesPlayed | 0) >= 50; } }
  ];
  const ACH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 1-3 3"/></svg>';

  function loadUnlocked() {
    try {
      const raw = localStorage.getItem(ACH_KEY);
      if (!raw) return {};
      const arr = JSON.parse(raw);
      const m = {};
      for (let i = 0; i < arr.length; i++) m[arr[i]] = true;
      return m;
    } catch (e) { return {}; }
  }
  function saveUnlocked(map) {
    try {
      const ids = Object.keys(map).filter(function(k){ return map[k]; });
      localStorage.setItem(ACH_KEY, JSON.stringify(ids));
    } catch (e) {}
  }
  function unlockedSnapshot() { return loadUnlocked(); }
  function loadGamesPlayed() {
    try { return parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) | 0; } catch (e) { return 0; }
  }

  // ============ PROGRESSIVE UNLOCK SYSTEM (T1.1 + T1.4) ============
  // A new player who lands on a home full of 19 tiles bounces. Industry data:
  // Match Masters shows only "PLAY" on day 1. We hide every non-essential
  // surface until the player has accumulated enough games (= reached the
  // unlock level). Level is derived directly from games_played (cheap,
  // localStorage-backed) so we don't need a server round-trip on boot.
  //
  // Formula: level = min(MAX_LEVEL, games_played + 1). Anyone with ≥19
  // games played is at level 20 (all features unlocked). New player is L1.
  //
  // LEVEL_UNLOCKS maps level → feature labels (Hebrew, for the toast).
  // The data-min-level attribute on HTML elements and the level gate
  // inside each maybeShow* together drive the actual hiding.
  const PLAYER_LEVEL_MAX = 20;
  const PLAYER_SEEN_LEVEL_KEY = 'bloom_seen_level';
  const LEVEL_UNLOCKS = {
    5:  '👥 תחרות חברים · 📋 משימות יומיות',
    8:  '🎨 סקינים · 🔥 דיל יומי · 🌱 חיית מחמד',
    10: '⚔️ דו-קרב · 🏆 דרך הגביעים',
    12: '🎖 Battle Pass · 🎡 גלגל יומי',
    15: '🛡 קלאן · 📔 אלבום אריחים',
    18: '🎰 גאצ\'ה · 🎁 חבילות',
    20: '⚔️ ליגות · 🥊 יריבים · 🛡⚔️ מלחמות קלאן'
  };
  function getPlayerLevel() {
    const games = loadGamesPlayed();
    const level = games + 1;
    return level > PLAYER_LEVEL_MAX ? PLAYER_LEVEL_MAX : level;
  }
  function loadSeenLevel() {
    try { return parseInt(localStorage.getItem(PLAYER_SEEN_LEVEL_KEY) || '0', 10) | 0; }
    catch (e) { return 0; }
  }
  function saveSeenLevel(n) {
    try { localStorage.setItem(PLAYER_SEEN_LEVEL_KEY, String(n | 0)); } catch (e) {}
  }
  // Walks every visible element with data-min-level and sets display:none
  // when the player isn't there yet. Safe to call multiple times — display
  // is restored by setting an empty string (CSS default). Re-run after any
  // deferred maybeShow* tile mounts (the home-v2 setTimeouts up to 3.2s).
  function applyLevelGates(rootEl) {
    const root = rootEl || document;
    const level = getPlayerLevel();
    const nodes = root.querySelectorAll('[data-min-level]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const req = parseInt(el.getAttribute('data-min-level') || '1', 10) | 0;
      if (level < req) {
        // Stash the original display value once so we can restore later.
        if (!el.hasAttribute('data-pre-gate-display')) {
          el.setAttribute('data-pre-gate-display', el.style.display || '');
        }
        el.style.display = 'none';
      } else if (el.hasAttribute('data-pre-gate-display')) {
        el.style.display = el.getAttribute('data-pre-gate-display');
        el.removeAttribute('data-pre-gate-display');
      }
    }
  }
  // Called after every game-over (and once on boot). If the player crossed
  // one or more unlock thresholds since their last seen level, show ONE
  // combined toast naming everything newly available. Persists seen level
  // so we never re-toast the same crossing.
  function checkLevelUnlock() {
    const cur = getPlayerLevel();
    const seen = loadSeenLevel();
    if (cur <= seen) {
      // First-ever call (seen=0) — still want to seed seen so the next
      // game-over only toasts genuine new crossings.
      if (seen === 0) saveSeenLevel(cur);
      return null;
    }
    const newlyUnlocked = [];
    Object.keys(LEVEL_UNLOCKS).forEach(function(k) {
      const lvl = parseInt(k, 10) | 0;
      if (lvl > seen && lvl <= cur) newlyUnlocked.push({ level: lvl, label: LEVEL_UNLOCKS[k] });
    });
    saveSeenLevel(cur);
    if (newlyUnlocked.length && typeof showToast === 'function') {
      // Combined toast — "🔓 דרגה N נפתחה: X · Y · Z". For multi-cross
      // (player jumped from L4 to L9 in one session) we list all groups.
      const msg = newlyUnlocked.map(function(u) {
        return '🔓 דרגה ' + u.level + ': ' + u.label;
      }).join(' · ');
      showToast(msg, 'success');
    }
    return newlyUnlocked.length ? newlyUnlocked : null;
  }
  try {
    window.__bloomLevel = {
      getPlayerLevel: getPlayerLevel,
      applyLevelGates: applyLevelGates,
      checkLevelUnlock: checkLevelUnlock,
      LEVEL_UNLOCKS: LEVEL_UNLOCKS
    };
  } catch (e) {}

  // ============ T2.2 — Streak Calendar modal ============
  // Visual representation of the player's current streak + upcoming
  // milestone bonuses. We don't store a full per-day play history
  // (would require schema work), so we reconstruct backwards from
  // today based on streak.count — this is honest: if you have a
  // 7-day streak, the last 7 days WERE played. Today's status is
  // derived from streak.lastPlayed === todayInIsrael().
  //
  // Layout: 14 cells in a 7×2 grid. Row 1 = past 7 days. Row 2 = next
  // 7 days. Today sits at the leftmost of row 2 (matches RTL flow:
  // "past on the right, future on the left"). Milestones (3/7/14/30)
  // are marked with their gem reward to drive prospective-FOMO.
  var STREAK_MILESTONES = [
    { day: 3,  reward: 50,   icon: '🎁' },
    { day: 7,  reward: 100,  icon: '🎁' },
    { day: 14, reward: 250,  icon: '💎' },
    { day: 30, reward: 500,  icon: '💎' },
    { day: 60, reward: 1000, icon: '👑' },
    { day: 100,reward: 2000, icon: '👑' }
  ];
  function dateAddDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function shortDayLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = d.getUTCDate();
    var months = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    return day + '.' + months[d.getUTCMonth()];
  }
  function showStreakCalendar() {
    var existing = document.getElementById('streak-cal-modal');
    if (existing) { existing.remove(); return; }
    var s = (typeof loadStreak === 'function') ? loadStreak() : { count: 0, lastPlayed: null };
    var today = (typeof todayInIsrael === 'function') ? todayInIsrael() : new Date().toISOString().slice(0, 10);
    var playedToday = s.lastPlayed === today;
    var streakLen = s.count | 0;
    // Reconstruct: today's date is the LAST played day if playedToday,
    // else (today - 1) is the last played day (if streakLen > 0).
    var lastPlayedDate = playedToday ? today : (streakLen > 0 ? dateAddDays(today, -1) : null);
    // Build 14 cells: 7 in the past (right side / row 1) + today + 6 future.
    var cellsHtml = '';
    // Row 1: 7 cells from oldest → most recent (excluding today)
    for (var off = -7; off <= -1; off++) {
      var cellDate = dateAddDays(today, off);
      var inStreak = lastPlayedDate && streakLen > 0
        ? (new Date(cellDate + 'T00:00:00Z') >= new Date(dateAddDays(lastPlayedDate, -(streakLen - 1)) + 'T00:00:00Z')
           && new Date(cellDate + 'T00:00:00Z') <= new Date(lastPlayedDate + 'T00:00:00Z'))
        : false;
      cellsHtml += '<div class="streak-cal-cell ' + (inStreak ? 'sc-played' : 'sc-empty') + '">' +
        '<span class="sc-icon">' + (inStreak ? '✓' : '·') + '</span>' +
        '<span class="sc-date">' + shortDayLabel(cellDate) + '</span>' +
        '</div>';
    }
    // Today cell
    cellsHtml += '<div class="streak-cal-cell sc-today ' + (playedToday ? 'sc-played' : 'sc-pending') + '">' +
      '<span class="sc-icon">' + (playedToday ? '✓' : '🔥') + '</span>' +
      '<span class="sc-date">היום</span>' +
      '</div>';
    // Row 2: next 6 days, with milestone markers
    for (var off2 = 1; off2 <= 6; off2++) {
      var futureDate = dateAddDays(today, off2);
      // What streak count would I have on this future day if I keep playing?
      var futureStreak = streakLen + off2;
      if (!playedToday) futureStreak = off2; // would have to restart today
      // Is this day a milestone?
      var ms = null;
      for (var m = 0; m < STREAK_MILESTONES.length; m++) {
        if (STREAK_MILESTONES[m].day === futureStreak) { ms = STREAK_MILESTONES[m]; break; }
      }
      cellsHtml += '<div class="streak-cal-cell sc-future' + (ms ? ' sc-milestone' : '') + '">' +
        '<span class="sc-icon">' + (ms ? ms.icon : '·') + '</span>' +
        '<span class="sc-date">' + shortDayLabel(futureDate) + '</span>' +
        (ms ? '<span class="sc-reward">+' + ms.reward + '💎</span>' : '') +
        '</div>';
    }
    // Next-milestone summary line (the loss-aversion driver)
    var nextMs = null;
    for (var k = 0; k < STREAK_MILESTONES.length; k++) {
      if (STREAK_MILESTONES[k].day > streakLen) { nextMs = STREAK_MILESTONES[k]; break; }
    }
    var nextHtml = nextMs
      ? '<div class="streak-cal-next">🎯 עוד <strong>' + (nextMs.day - streakLen) + ' ימים</strong> ל-' + nextMs.icon + ' <strong>+' + nextMs.reward + '💎</strong></div>'
      : '<div class="streak-cal-next">👑 הגעת לרצף הגבוה ביותר!</div>';
    var modal = document.createElement('div');
    modal.id = 'streak-cal-modal';
    modal.className = 'streak-cal-overlay';
    modal.innerHTML =
      '<div class="streak-cal-card">' +
        '<button class="streak-cal-close" aria-label="סגור">×</button>' +
        '<div class="streak-cal-title">🔥 ' + streakLen + ' ימים רצוף</div>' +
        '<div class="streak-cal-sub">' + (playedToday ? '✅ שמרת היום' : '⚠ עדיין לא שיחקת היום') + '</div>' +
        nextHtml +
        '<div class="streak-cal-grid">' + cellsHtml + '</div>' +
        '<div class="streak-cal-foot">המשך לשחק כל יום ותקבל בונוסים גדלים. יום אחד פסיכ → הרצף מתאפס.</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.streak-cal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
  }
  try { window.__bloomShowStreakCal = showStreakCalendar; } catch (e) {}

  function incrementGamesPlayed() {
    const n = loadGamesPlayed() + 1;
    try { localStorage.setItem(GAMES_COUNT_KEY, String(n)); } catch (e) {}
    return n;
  }
  // Generic int helpers for the lifetime "personal best" trackers.
  function loadLifetimeInt(key) {
    try { return parseInt(localStorage.getItem(key) || '0', 10) | 0; } catch (e) { return 0; }
  }
  function bumpLifetimeMax(key, candidate) {
    const c = candidate | 0;
    if (c <= 0) return;
    const cur = loadLifetimeInt(key);
    if (c > cur) { try { localStorage.setItem(key, String(c)); } catch (e) {} }
  }
  function addLifetimeTotal(key, delta) {
    const d = delta | 0;
    if (d <= 0) return;
    const cur = loadLifetimeInt(key);
    try { localStorage.setItem(key, String(cur + d)); } catch (e) {}
  }

  function currentAchievementState(extra) {
    const s = loadStreak();
    const today = todayInIsrael();
    let streakNow = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakNow = 0;
    return Object.assign({
      score: score | 0,
      highestTier: highestTier | 0,
      maxChain: currentGameMaxChain | 0,
      streakNow: streakNow,
      gamesPlayed: loadGamesPlayed()
    }, extra || {});
  }

  function checkAchievements(extra) {
    const state = currentAchievementState(extra);
    const unlocked = loadUnlocked();
    const newly = [];
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      if (unlocked[a.id]) continue;
      try {
        if (a.check(state)) { unlocked[a.id] = true; newly.push(a); }
      } catch (e) {}
    }
    if (newly.length) {
      saveUnlocked(unlocked);
      for (let i = 0; i < newly.length; i++) {
        (function(a, idx) {
          setTimeout(function() { showAchievementToast(a); }, idx * 700);
        })(newly[i], i);
      }
    }
  }

  function showAchievementToast(a) {
    const t = document.createElement('div');
    t.className = 'ach-unlock-toast';
    t.innerHTML = ACH_ICON_SVG + '<span>הישג חדש: ' + a.name + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3200);
    tone({ freq: 659, duration: 0.12, type: 'triangle', vol: 0.12 });
    tone({ freq: 784, duration: 0.16, type: 'triangle', vol: 0.12, delay: 0.08 });
  }

  function openAchievementsModal() {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('ach-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'ach-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="ach-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="info-title">הישגים</div>' +
        '<div id="ach-modal-body"></div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('ach-modal-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    renderAchievementsBody();
  }

  function renderAchievementsBody() {
    const body = document.getElementById('ach-modal-body');
    if (!body) return;
    const unlocked = loadUnlocked();
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter(function(a){ return unlocked[a.id]; }).length;

    // Lifetime stats panel
    const bestTier = loadLifetimeInt(BEST_TIER_KEY);
    const bestTierName = (bestTier > 0 && getActiveTiers()[bestTier]) ? getActiveTiers()[bestTier].name : '—';
    const stats = [
      { label: 'משחקים',         value: loadGamesPlayed().toLocaleString() },
      { label: 'שיא במשחק',      value: (best | 0).toLocaleString() },
      { label: 'דרגה מקסימלית',  value: bestTierName },
      { label: 'שרשרת ארוכה',    value: loadLifetimeInt(BEST_CHAIN_KEY) || '—' },
      { label: 'רצף שיא',         value: loadLifetimeInt(BEST_STREAK_KEY) || '—' },
      { label: 'ניקוד מצטבר',    value: loadLifetimeInt(TOTAL_SCORE_KEY).toLocaleString() }
    ];
    let statsHtml = '<div class="stats-grid">';
    for (let i = 0; i < stats.length; i++) {
      statsHtml += '<div class="stat-card">' +
        '<div class="stat-card-label">' + stats[i].label + '</div>' +
        '<div class="stat-card-value">' + stats[i].value + '</div>' +
      '</div>';
    }
    statsHtml += '</div>';

    let html = '<div class="ach-summary">המספרים שלך · פתחת <b>' + got + '</b> מתוך ' + total + ' הישגים</div>';
    html += statsHtml;
    for (let g = 0; g < ACH_GROUPS.length; g++) {
      const grp = ACH_GROUPS[g];
      const items = ACHIEVEMENTS.filter(function(a){ return a.group === grp.id; });
      if (!items.length) continue;
      html += '<div class="ach-group-title">' + grp.name + '</div>';
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const isUnlocked = !!unlocked[a.id];
        html += '<div class="ach-row ' + (isUnlocked ? 'unlocked' : 'locked') + '">' +
          '<div class="ach-icon">' + ACH_ICON_SVG + '</div>' +
          '<div class="ach-text"><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + '</div></div>' +
        '</div>';
      }
    }
    body.innerHTML = html;
  }

  // ============================================================
  // TC.1 — Global ESC + browser-back modal handlers (May 2026)
  // ============================================================
  // The audit flagged that BLOOM has 58+ different overlay classes,
  // each with its own close button. There was no unified way for
  // a player to dismiss the topmost modal — pressing ESC did
  // nothing, and tapping the browser back button on mobile (the
  // most common "go back" gesture for ~95% of players) navigated
  // away from the app entirely.
  //
  // The fix: a single keydown listener that catches ESC, finds
  // the topmost modal by DOM order (last one mounted = topmost),
  // and clicks its close button OR removes it. A popstate listener
  // does the same for the back gesture. Both are wired once at
  // boot — modals don't need to opt in; they work automatically
  // as long as they use one of the recognized overlay classes.
  //
  // Allowlist principle: any class ending in `-modal-overlay` or
  // any class in the curated additions list is dismissible. The
  // exclusions block keeps in-game animations / FTUE / celebration
  // overlays untouched (those have their own dismiss timing and
  // shouldn't disappear on ESC).
  // ============================================================
  function __bloomGetCloseableModals() {
    // Generic match: any class ending in -modal-overlay.
    var generic = document.querySelectorAll('[class*="modal-overlay"]');
    // Curated additions for overlays that don't use the "modal" suffix
    // but still act as modals (player can dismiss them).
    var extras = document.querySelectorAll(
      '.board-lb-overlay, .dyn-boards-overlay, .dyn-comeback-overlay, ' +
      '.dyn-friends-modal-overlay, .gem-bank-overlay, .ghost-confirm-overlay, ' +
      '.gacha-history-overlay, .squad-modal-overlay, .squad-tournament-modal-overlay, ' +
      '.rivalry-modal-overlay, .leagues-modal-overlay, ' +
      // Full-screen views (not modals, but ESC/back-gesture should exit them
      // back to home — they intentionally have a small absolute-positioned
      // back arrow that's easy to miss). Adding here so the global handler
      // catches them and routes through the existing back button.
      '#contest-screen, #challenge-screen, #spectator-screen, #my-contests-list'
    );
    // Exclusions — overlays that LOOK like modals but are actually
    // in-game animations, celebrations, or the FTUE. ESC should NOT
    // dismiss them.
    var EXCLUDE = {
      'event-cell-overlay': 1, 'fx-overlay': 1, 'chest-celebration-overlay': 1,
      'cl-celeb-overlay': 1, 'gacha-reveal-overlay': 1, 'gacha-rolling-overlay': 1,
      'dyn-chest-overlay': 1, 'ftue-overlay': 1, 'over-restored-banner': 1,
      'spin-reveal-overlay': 1, 'trophy-arena-overlay': 1, 'gw-claim-overlay': 1,
      'sp-claim-overlay': 1, 'sq-claim-overlay': 1, 'login-cal-claim-overlay': 1,
      'wrapped-share-overlay': 1
    };
    var out = [];
    var seen = new Set();
    var consider = function(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      // Check if any of the element's classes are excluded.
      var cls = (el.className || '').split(/\s+/);
      for (var i = 0; i < cls.length; i++) {
        if (EXCLUDE[cls[i]]) return;
      }
      // Sanity: ignore detached / hidden nodes.
      if (!el.isConnected) return;
      var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return;
      out.push(el);
    };
    generic.forEach(consider);
    extras.forEach(consider);
    return out;
  }
  function __bloomDismissTopmostModal() {
    var modals = __bloomGetCloseableModals();
    if (!modals.length) return false;
    // Topmost = last in document order. (DOM is built in mount order;
    // newer modals come later. Z-index variance is mostly harmonized
    // via :root --z-modal so we don't need to sort by computed z.)
    var top = modals[modals.length - 1];
    // Try the modal's own close button first — preserves any
    // cleanup logic the modal already wires (refunds, telemetry,
    // analytics, etc.). Falls back to a direct remove() if none.
    var closeBtn =
      top.querySelector('.modal-close, .info-close, [id$="modal-close"], [data-close-modal]') ||
      top.querySelector('button[aria-label="סגור"], button[aria-label="Close"]') ||
      // Full-screen views like #contest-screen use a back button
      // with a different class. Click it to route through the
      // existing back-handler (preserves saveContestGameState etc).
      top.querySelector('.contest-back-btn, [data-back]');
    if (closeBtn) {
      try { closeBtn.click(); return true; }
      catch (e) {}
    }
    try { top.remove(); return true; } catch (e) { return false; }
  }
  // Wire the global listeners ONCE per page load. The flag guards
  // against any code that might re-include this file's logic.
  if (!window.__bloomModalCloseWired) {
    window.__bloomModalCloseWired = true;
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if (__bloomDismissTopmostModal()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });
    window.addEventListener('popstate', function() {
      // Best-effort: if a modal is open, eat the back gesture by
      // closing it. If no modal, popstate's default behavior runs.
      __bloomDismissTopmostModal();
    });
    // Public helper: any modal that wants to participate in the back
    // gesture without already being wired calls this on open. We
    // push a synthetic history entry so the back button has
    // something to consume before leaving the app. Safe no-op when
    // history.pushState is blocked.
    window.__bloomOpenModalWithHistory = function(modalEl) {
      try { history.pushState({ bloomModal: true }, ''); } catch (e) {}
    };
  }

  /* ============ HOME SCREEN ============ */
