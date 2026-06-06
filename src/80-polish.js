// ============================================================
// Stage 39 — UX Polish + Addiction Maximizer (May 2026)
//
// After 38 stages the home has 14+ tiles, each with its own
// animations. 156 infinite keyframe loops on one page = visual
// chaos. This module:
//
//   1. PRIORITY CALMER — only the HIGHEST-priority "hot" tile
//      keeps its pulse. Rest are visually suppressed. The eye
//      goes straight to what matters NOW. This is THE single
//      biggest addiction lever — focus drives action.
//
//   2. FIRST-VISIT MICRO-TUTORIAL — when a tile appears for the
//      first time, a tiny pointer balloon explains it in one
//      sentence. Stored per-tile in localStorage so it never
//      re-appears.
//
//   3. UNIFIED LOADING STATE — replaces every "⏳ טוען..." with
//      a consistent spinner.
//
//   4. STREAK-DANGER ESCALATION — when streak is about to break,
//      EVERYTHING ELSE goes calm and only the streak warning pulses.
// ============================================================
(function() {

  // Tile selector → addiction priority (higher = more important).
  // Tiles not in this map default to priority 0 (no pulse).
  var TILE_PRIORITIES = [
    // EMERGENCY — streak about to die / pet crying / trophy loss imminent
    { sel: '.fomo-streak-danger',                            priority: 100, label: 'streak-danger' },
    { sel: '#pet-home-widget.pet-crying',                    priority: 95,  label: 'pet-crying' },
    // CLAIMS — free gems waiting (highest dopamine)
    { sel: '#trophy-home-tile.has-claim',                    priority: 90,  label: 'trophy-milestone' },
    { sel: '#guild-war-home-tile.has-claim',                 priority: 88,  label: 'guild-war-reward' },
    { sel: '#league-home-tile .league-tile-reward',          priority: 86,  label: 'league-reward', up: '#league-home-tile' },
    { sel: '#home-v2-season-pass #home-v2-sp-claim:not([style*="display:none"])', priority: 84, label: 'bp-claim', up: '#home-v2-season-pass' },
    { sel: '#ach-lb-home-tile.has-claim',                    priority: 82,  label: 'ach-claim' },
    { sel: '#album-home-tile.has-claim',                     priority: 80,  label: 'album-claim' },
    { sel: '#lifetime-home-tile.can-prestige',               priority: 78,  label: 'prestige-ready' },
    // DAILY HOOKS — return-driver
    { sel: '#spin-home-tile.has-spin',                       priority: 70,  label: 'spin-available' },
    { sel: '.daily-deal-home-banner',                        priority: 65,  label: 'daily-deal' },
    // Social tab anchor: the friends banner is the highest-K-factor card on the
    // social tab ("invite a friend = +200💎" / "N online"). Above the 55 spotlight
    // threshold so the social tab gets a clear anchor instead of a flat wall.
    { sel: '#friends-banner',                                priority: 58,  label: 'friends-invite' },
    { sel: '.starter-pack-home-banner',                      priority: 60,  label: 'starter-pack' },
    { sel: '.bundle-home-banner',                            priority: 55,  label: 'limited-bundle' },
    // PROGRESS — feedback loops
    { sel: '#pet-home-widget.pet-sad',                       priority: 50,  label: 'pet-sad' },
    { sel: '#checklist-home-tile',                           priority: 40,  label: 'daily-checklist' },
    { sel: '#guild-war-home-tile',                           priority: 38,  label: 'guild-war-active' },
    { sel: '#rival-home-tile',                               priority: 35,  label: 'rival-active' },
    // PASSIVE — present but not urgent
    { sel: '#trophy-home-tile',                              priority: 25,  label: 'trophy-passive' },
    { sel: '#spin-home-tile',                                priority: 22,  label: 'spin-passive' },
    { sel: '#league-home-tile',                              priority: 20,  label: 'league-passive' },
    { sel: '#home-v2-season-pass',                           priority: 18,  label: 'bp-passive' },
    { sel: '#home-v2-boards',                                priority: 15,  label: 'boards' },
    { sel: '#guild-home-tile',                               priority: 12,  label: 'guild' },
    { sel: '#lifetime-home-tile',                            priority: 10,  label: 'prestige-passive' },
    { sel: '#album-home-tile',                               priority: 8,   label: 'album-passive' },
    { sel: '#ach-lb-home-tile',                              priority: 6,   label: 'ach-passive' },
    { sel: '#pet-home-widget',                               priority: 4,   label: 'pet-passive' }
  ];

  // ────────────────────────────────────────────────────────────
  // PRIORITY CALMER
  // ────────────────────────────────────────────────────────────
  // Strategy: find the HIGHEST-priority tile present on home that
  // has the "hot" state (claim / unlocked / danger). Suppress
  // animations on ALL OTHER tiles by adding `.polish-calmed` to
  // them. The winner keeps its pulse. The eye is drawn to ONE.
  function applyPriorityCalmer() {
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    // Find all matching tiles with priorities.
    var matches = [];
    TILE_PRIORITIES.forEach(function(rule) {
      var els = home.querySelectorAll(rule.sel);
      Array.prototype.forEach.call(els, function(el) {
        // For nested selectors (.league-tile-reward inside the tile),
        // the actual visual tile to calm is the parent — captured via `up`.
        var visualEl = rule.up ? document.querySelector(rule.up) : el;
        if (!visualEl) return;
        matches.push({ el: visualEl, priority: rule.priority, label: rule.label });
      });
    });
    if (!matches.length) return;
    // Sort by priority DESC
    matches.sort(function(a, b) { return b.priority - a.priority; });
    var winner = matches[0];
    // Apply / remove the calmed class to all matched tiles.
    var seen = new Set();
    matches.forEach(function(m) {
      if (seen.has(m.el)) return;
      seen.add(m.el);
      if (m.el === winner.el) {
        m.el.classList.remove('polish-calmed');
        m.el.classList.add('polish-spotlight');
      } else {
        m.el.classList.add('polish-calmed');
        m.el.classList.remove('polish-spotlight');
      }
    });
    // Debug hint (for me, can be removed)
    if (window.__bloomDebug) {
      console.log('[polish] spotlight:', winner.label, 'priority:', winner.priority,
        '· calmed:', matches.length - 1);
    }
  }

  // ────────────────────────────────────────────────────────────
  // UR.9 — PER-TAB HIERARCHY (2026-06-07)
  // ────────────────────────────────────────────────────────────
  // After the bottom-nav routes tiles into tab panels, each tab is a stack of
  // calm cards (body.tab-cards-calm). To kill "everything competes", spotlight
  // the SINGLE highest-priority *hot* card per tab (full colour + a warm lift)
  // and leave the rest calm. Only fires when a card is genuinely hot (a claim /
  // free spin / live deal) — never arbitrarily highlights a passive card. Pure
  // class toggle; all visuals are CSS-gated under body.tab-cards-calm.
  function priorityForCard(card) {
    var max = -1;
    TILE_PRIORITIES.forEach(function(rule) {
      try {
        var hit;
        if (rule.up) {
          var desc = rule.sel.split(' ').slice(1).join(' ');
          hit = card.matches(rule.up) && (desc ? !!card.querySelector(desc) : true);
        } else {
          hit = card.matches(rule.sel);
        }
        if (hit && rule.priority > max) max = rule.priority;
      } catch (e) {}
    });
    return max;
  }
  function applyTabHierarchy() {
    // Only meaningful in the unified calm look; in classic mode leave cards alone.
    if (!document.body.classList.contains('tab-cards-calm')) {
      var stale = document.querySelectorAll('.bn-migrated.tab-spotlight');
      Array.prototype.forEach.call(stale, function(c) { c.classList.remove('tab-spotlight'); });
      return;
    }
    var bodies = document.querySelectorAll('.bn-tab-screen-body');
    Array.prototype.forEach.call(bodies, function(body) {
      var cards = body.querySelectorAll('.bn-migrated');
      var best = null, bestP = -1;
      Array.prototype.forEach.call(cards, function(card) {
        card.classList.remove('tab-spotlight');
        var p = priorityForCard(card);
        if (p > bestP) { bestP = p; best = card; }
      });
      // 55 = the "daily hooks / claims" band (spin-available, daily-deal, and all
      // the *.has-claim reward states). Below that everything is passive → no
      // spotlight, so a calm tab stays uniformly calm rather than faking urgency.
      if (best && bestP >= 55) best.classList.add('tab-spotlight');
    });
  }

  // Recompute every 3s — tiles mount asynchronously over ~3.2s.
  // Once the home is stable, polling stops.
  var _calmerTickHandle = null;
  function startPolishLifecycle() {
    stopPolishLifecycle();
    var ticks = 0;
    var run = function() {
      if (!document.getElementById('home-screen')) { stopPolishLifecycle(); return; }
      applyPriorityCalmer();
      applyTabHierarchy();
      maybeShowMicroTutorials();
      ticks++;
      if (ticks > 4) { stopPolishLifecycle(); }
    };
    setTimeout(run, 800);
    setTimeout(run, 2200);
    setTimeout(run, 3500);
    setTimeout(run, 5000);
  }
  function stopPolishLifecycle() {
    if (_calmerTickHandle) { clearTimeout(_calmerTickHandle); _calmerTickHandle = null; }
  }

  // ────────────────────────────────────────────────────────────
  // FIRST-VISIT MICRO-TUTORIAL
  // ────────────────────────────────────────────────────────────
  // For each tile that's appearing for the first time, show a
  // small balloon next to it with a 1-sentence explanation.
  // Stored per-tile in localStorage so it only ever shows once.
  var SEEN_KEY = 'bloom_tile_seen_v1';
  var TUTORIAL_TEXT = {
    'spin-home-tile':       '🎡 גלגל יומי חינם — סובב פעם ביום וזכה בפרס משתנה',
    'trophy-home-tile':     '🏆 הגביעים עולים על משחק טוב ויורדים על רע — תשמור עליהם!',
    'guild-war-home-tile':  '⚔️ הקלאן שלך במלחמה — כל משחק שלך תורם לציון',
    'league-home-tile':     '⚔️ ליגה שבועית — XP מצטבר מקדם אותך בדרגות',
    'rival-home-tile':      '🥊 יש לך יריב אישי ל-24 שעות — תנצח אותו ב-XP',
    'pet-home-widget':      '🌱 הפט שלך גדל איתך — בקר אותו כל יום',
    'checklist-home-tile':  '📋 משימות יומיות — סמן הכל כדי לקבל פרסים',
    'lifetime-home-tile':   '⭐ פרוגרס לכל החיים — הרמה לא מתאפסת לעולם'
  };

  function maybeShowMicroTutorials() {
    var seen = loadSeen();
    Object.keys(TUTORIAL_TEXT).forEach(function(id) {
      if (seen[id]) return;
      var el = document.getElementById(id);
      if (!el || el.style.display === 'none') return;
      // D4 — the bottom-nav observer relocates tiles into hidden tab bodies.
      // el.style.display only checks the tile's own inline display, not an
      // ancestor tab's. offsetParent === null catches an ancestor that's
      // display:none, so the balloon never points at empty top-left space.
      if (el.offsetParent === null) return;
      var r0 = el.getBoundingClientRect();
      if (r0.width === 0 && r0.height === 0) return;
      // Only show ONE tutorial at a time to avoid overload.
      if (document.querySelector('.polish-micro-tooltip')) return;
      showMicroTooltip(el, TUTORIAL_TEXT[id]);
      seen[id] = Date.now();
      saveSeen(seen);
    });
  }

  function showMicroTooltip(target, text) {
    var tip = document.createElement('div');
    tip.className = 'polish-micro-tooltip';
    tip.innerHTML =
      '<div class="polish-tooltip-arrow"></div>' +
      '<div class="polish-tooltip-body">' +
        '<div class="polish-tooltip-text">' + text + '</div>' +
        '<button class="polish-tooltip-ok">הבנתי ✓</button>' +
      '</div>';
    document.body.appendChild(tip);
    // Position above the target
    var rect = target.getBoundingClientRect();
    var tipRect;
    requestAnimationFrame(function() {
      tipRect = tip.getBoundingClientRect();
      var top = rect.top - tipRect.height - 12;
      var left = rect.left + rect.width / 2 - tipRect.width / 2;
      // Clamp horizontally
      var maxLeft = window.innerWidth - tipRect.width - 8;
      if (left < 8) left = 8;
      if (left > maxLeft) left = maxLeft;
      // If too close to top, flip below
      if (top < 10) {
        top = rect.bottom + 12;
        tip.classList.add('polish-tooltip-below');
      }
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
      tip.style.opacity = '1';
    });
    var dismiss = function() {
      try { tip.classList.add('polish-tooltip-fade'); } catch (e) {}
      setTimeout(function() { try { tip.remove(); } catch (e) {} }, 250);
    };
    tip.querySelector('.polish-tooltip-ok').onclick = function(e) {
      e.stopPropagation();
      dismiss();
    };
    // Auto-dismiss after 8s
    setTimeout(dismiss, 8000);
  }

  function loadSeen() {
    try {
      var raw = localStorage.getItem(SEEN_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveSeen(seen) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }

  // ────────────────────────────────────────────────────────────
  // UNIFIED LOADING SPINNER
  // ────────────────────────────────────────────────────────────
  // Replaces any element with text "⏳ טוען..." with a proper
  // spinning SVG. Runs on any modal that opens. Visual consistency.
  function applySpinnerToLoadingText(root) {
    if (!root) return;
    var els = root.querySelectorAll ? root.querySelectorAll('div, span') : [];
    Array.prototype.forEach.call(els, function(el) {
      var txt = (el.textContent || '').trim();
      if (txt === '⏳ טוען...' || txt === '⏳ טוען…') {
        el.innerHTML = '<div class="polish-spinner"></div>';
      }
    });
  }
  // Watch the body for newly-mounted modals and auto-upgrade their spinners.
  var _spinnerObserver = null;
  function startSpinnerObserver() {
    if (_spinnerObserver) return;
    _spinnerObserver = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        Array.prototype.forEach.call(m.addedNodes, function(node) {
          if (node.nodeType === 1) applySpinnerToLoadingText(node);
        });
      });
    });
    _spinnerObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ────────────────────────────────────────────────────────────
  // PUBLIC API + AUTO-INIT
  // ────────────────────────────────────────────────────────────
  // Hook into the existing variant decorator's lifecycle: when
  // applyHomeVariant() runs, polish runs immediately after.
  // We monkey-patch by wrapping the existing function.
  var _originalApplyVariant = window.applyHomeVariant;
  window.applyHomeVariant = function() {
    try { if (typeof _originalApplyVariant === 'function') _originalApplyVariant(); } catch (e) {}
    startPolishLifecycle();
  };
  // If variant decorator hasn't loaded yet, fallback to direct call.
  if (typeof _originalApplyVariant !== 'function') {
    // Hook into showHomeV2 directly via a small mutation observer.
    document.addEventListener('DOMContentLoaded', function() {
      var observer = new MutationObserver(function() {
        if (document.getElementById('home-screen')) startPolishLifecycle();
      });
      observer.observe(document.body, { childList: true });
    });
  }
  // Start spinner observer immediately.
  if (document.body) startSpinnerObserver();
  else document.addEventListener('DOMContentLoaded', startSpinnerObserver);

  window.__bloomPolish = {
    apply: applyPriorityCalmer,
    showTutorials: maybeShowMicroTutorials,
    resetTutorials: function() { try { localStorage.removeItem(SEEN_KEY); } catch (e) {} },
    spinnerize: applySpinnerToLoadingText
  };
})();
