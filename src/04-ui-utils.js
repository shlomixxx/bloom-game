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

  function showNewBestBanner() {
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#FAC775,#BA7517);border-radius:20px;padding:18px 30px;pointer-events:none;text-align:center;box-shadow:0 0 30px rgba(250,199,117,0.5);min-width:180px';
    banner.innerHTML = '<div style="font-size:22px;font-weight:800;color:#1C1A18">🎉 שיא חדש!</div><div style="font-size:28px;font-weight:900;color:#412402;margin-top:4px">' + score.toLocaleString() + '</div>';
    document.body.appendChild(banner);
    buzz([80, 40, 80, 40, 80]);
    var bestShake = parseInt(getEventConfig('shake_new_best', '4'), 10) || 0;
    if (bestShake > 0) shakeGrid(bestShake);
    setTimeout(function() { banner.style.transition = 'opacity 0.3s'; banner.style.opacity = '0'; }, 1500);
    setTimeout(function() { banner.remove(); }, 1800);
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

  /* ============ HOME SCREEN ============ */
