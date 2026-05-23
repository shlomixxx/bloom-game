// ============================================================
// Stage 35 — Home Variants (May 2026)
// 4 home layouts; admin picks ONE globally:
//   'standard'  → current v2 (no-op)
//   'carousel'  → top horizontal carousel of hot signals
//   'hero'      → massive single hero card + collapse other tiles
//   'jit'       → Just-In-Time: tiles unlock progressively by games played
// All variants are DECORATORS layered on top of the existing v2 mount,
// so each tile's own logic stays untouched — variants only re-arrange,
// hide, or wrap what's already there.
// ============================================================
(function() {

  var VALID = ['standard', 'carousel', 'hero', 'jit'];

  function getHomeVariant() {
    try {
      var v = (typeof gameConfig === 'object' && gameConfig && gameConfig.home_variant) || 'standard';
      v = String(v).trim().toLowerCase();
      if (VALID.indexOf(v) === -1) return 'standard';
      return v;
    } catch (e) { return 'standard'; }
  }

  // Selector list of every "secondary tile" that variants can hide / move.
  // We never touch the primary CTA, the hero, or the pid line — those are
  // load-bearing for the addiction loop and must stay visible in every variant.
  var SECONDARY_TILE_SELECTORS = [
    '#spin-home-tile',
    '#guild-war-home-tile',
    '#home-v2-boards',
    '#home-v2-season-pass',
    '#league-home-tile',
    '#rival-home-tile',
    '#guild-home-tile',
    '#lifetime-home-tile',
    '#album-home-tile',
    '#ach-lb-home-tile',
    '#pet-home-widget',
    '#lives-home-widget',
    '#checklist-home-tile',
    '.daily-deal-home-banner',
    '.gacha-home-banner',
    '.starter-pack-home-banner',
    '.bundle-home-banner'
  ];

  function collectSecondaryTiles() {
    var out = [];
    var home = document.getElementById('home-screen');
    if (!home) return out;
    for (var i = 0; i < SECONDARY_TILE_SELECTORS.length; i++) {
      var els = home.querySelectorAll(SECONDARY_TILE_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) out.push(els[j]);
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────
  // ENTRY POINT — called from showHomeV2() at the very end.
  // We wait 3.4s for every maybeShow*Tile() to settle before
  // rearranging, since they mount via deferred setTimeout(s).
  // ────────────────────────────────────────────────────────────
  function applyHomeVariant() {
    var variant = getHomeVariant();
    if (variant === 'standard') return;

    // Set a flag on body so CSS can toggle base presentation.
    document.body.setAttribute('data-home-variant', variant);

    // Wait for all the deferred tile mounts (max delay in v2 = 3000ms).
    setTimeout(function() {
      if (!document.getElementById('home-screen')) return;
      try {
        if (variant === 'carousel') applyCarouselVariant();
        else if (variant === 'hero') applyHeroVariant();
        else if (variant === 'jit') applyJustInTimeVariant();
      } catch (e) { console.error('[home-variant]', variant, e); }
    }, 3400);
  }

  // ════════════════════════════════════════════════════════════
  // VARIANT 1 — CAROUSEL  (idea #4, score 7.5)
  // ════════════════════════════════════════════════════════════
  // Adds a horizontal-scrolling row of 3-5 "hot now" cards at the
  // TOP of home (right under the hero), each linking to its
  // origin tile. The original tiles stay below — just less prominent.
  function applyCarouselVariant() {
    var home = document.getElementById('home-screen');
    if (!home || document.getElementById('home-variant-carousel')) return;

    var cards = buildCarouselCards();
    if (!cards.length) return;

    var wrap = document.createElement('div');
    wrap.id = 'home-variant-carousel';
    wrap.className = 'hvar-carousel';
    wrap.innerHTML =
      '<div class="hvar-carousel-title">🔥 חם עכשיו</div>' +
      '<div class="hvar-carousel-scroll" id="hvar-carousel-scroll">' +
        cards.map(renderCarouselCard).join('') +
      '</div>';

    // Mount BEFORE the hero so it's the very first thing the eye sees.
    var hero = document.getElementById('home-v2-hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(wrap, hero);
    else home.insertBefore(wrap, home.firstChild.nextSibling);

    // Wire click handlers
    Array.prototype.forEach.call(wrap.querySelectorAll('.hvar-carousel-card'), function(card) {
      card.addEventListener('click', function() {
        var action = card.getAttribute('data-action');
        runCarouselAction(action);
      });
    });
  }

  function buildCarouselCards() {
    var out = [];
    // Each helper reads the relevant tile from DOM and returns a card object
    // only if there's something hot worth showing. Order = priority.
    // Spin wheel — top priority when available (daily-return hook).
    var spinTile = document.getElementById('spin-home-tile');
    if (spinTile && spinTile.classList.contains('has-spin')) {
      out.push({ action: 'spin', icon: '🎡', title: 'גלגל יומי חינם', sub: '🎁 ספין חינם זמין עכשיו!', cls: 'hot' });
    }
    // Guild War — second priority when there's an unclaimed reward.
    var gwTile = document.getElementById('guild-war-home-tile');
    if (gwTile && gwTile.classList.contains('has-claim')) {
      out.push({ action: 'guildwar', icon: '🛡⚔️', title: 'מלחמת קלאנים', sub: '🎁 פרס מלחמה ממתין לאיסוף', cls: 'hot' });
    } else if (gwTile) {
      out.push({ action: 'guildwar', icon: '🛡⚔️', title: 'מלחמת קלאנים', sub: 'מלחמה פעילה — תרום עכשיו', cls: '' });
    }
    var sp = document.getElementById('home-v2-season-pass');
    if (sp && sp.style.display !== 'none') {
      var claim = sp.querySelector('#home-v2-sp-claim');
      var hasClaim = claim && claim.style.display !== 'none';
      out.push({
        action: 'season',
        icon: '🎖',
        title: 'Battle Pass',
        sub: hasClaim ? '🎁 ' + (claim.textContent || '').replace('🎁', '').trim() + ' לאסוף!' : 'התקדם בסיזון',
        cls: hasClaim ? 'hot' : ''
      });
    }
    var league = document.getElementById('league-home-tile');
    if (league) {
      var reward = league.querySelector('.league-tile-reward');
      if (reward) out.push({ action: 'league', icon: '⚔️', title: 'ליגה שבועית', sub: '🎁 פרס שבוע שעבר ממתין!', cls: 'hot' });
    }
    var rival = document.getElementById('rival-home-tile');
    if (rival) out.push({ action: 'rival', icon: '🥊', title: 'דו-קרב יריב', sub: rival.textContent.slice(0, 40), cls: '' });
    var pet = document.getElementById('pet-home-widget');
    if (pet && (pet.classList.contains('pet-sad') || pet.classList.contains('pet-crying'))) {
      out.push({ action: 'pet', icon: '😢', title: 'הפרח שלך עצוב', sub: 'תפתח את הפט עכשיו', cls: 'hot' });
    }
    var checklist = document.getElementById('checklist-home-tile');
    if (checklist) {
      out.push({ action: 'checklist', icon: '📋', title: 'משימות יומיות', sub: 'יש לך משימות פתוחות', cls: '' });
    }
    var dailyDeal = document.querySelector('.daily-deal-home-banner');
    if (dailyDeal) out.push({ action: 'deal', icon: '🔥', title: 'דיל יומי', sub: 'הצעת היום בחנות', cls: 'hot' });
    var boards = document.getElementById('home-v2-boards');
    if (boards && boards.style.display !== 'none') {
      out.push({ action: 'boards', icon: '🎯', title: 'לוחות דינמיים', sub: 'לוחות מיוחדים זמינים', cls: '' });
    }
    var bundle = document.querySelector('.bundle-home-banner');
    if (bundle) out.push({ action: 'bundle', icon: '🎁', title: 'חבילת חג', sub: 'הצעה לזמן מוגבל', cls: 'hot' });
    var guild = document.getElementById('guild-home-tile');
    if (guild) out.push({ action: 'guild', icon: '🛡', title: 'הקלאן שלך', sub: 'בדוק את היעד היומי', cls: '' });
    // Cap at 6 cards so the scroll doesn't feel infinite
    return out.slice(0, 6);
  }

  function renderCarouselCard(c) {
    return '<button class="hvar-carousel-card ' + (c.cls || '') + '" data-action="' + c.action + '">' +
      '<div class="hvar-carousel-icon">' + c.icon + '</div>' +
      '<div class="hvar-carousel-card-title">' + c.title + '</div>' +
      '<div class="hvar-carousel-card-sub">' + c.sub + '</div>' +
    '</button>';
  }

  function runCarouselAction(action) {
    // Each action triggers a click on the underlying tile to reuse its logic.
    var map = {
      spin: '#spin-home-tile',
      guildwar: '#guild-war-home-tile',
      season: '#home-v2-season-pass',
      league: '#league-home-tile',
      rival: '#rival-home-tile',
      pet: '#pet-home-widget',
      checklist: '#checklist-home-tile',
      deal: '.daily-deal-home-banner',
      boards: '#home-v2-boards',
      bundle: '.bundle-home-banner',
      guild: '#guild-home-tile'
    };
    var sel = map[action];
    if (!sel) return;
    var el = document.querySelector(sel);
    if (el && typeof el.click === 'function') el.click();
  }

  // ════════════════════════════════════════════════════════════
  // VARIANT 2 — HERO  (idea #2, score 8.25)
  // ════════════════════════════════════════════════════════════
  // Replaces the v2 hero with a MASSIVE single-action hero card
  // (60% of viewport) showing the highest-emotion signal RIGHT NOW.
  // All other secondary tiles collapse behind a "📂 עוד פיצ׳רים" button.
  function applyHeroVariant() {
    var home = document.getElementById('home-screen');
    if (!home) return;

    // Pick the most urgent signal — same priority order as carousel.
    var signal = pickHottestSignal();
    if (signal) renderHeroBigCard(signal);

    // Collapse all secondary tiles into a single expander.
    var tiles = collectSecondaryTiles();
    if (!tiles.length) return;

    var collapser = document.createElement('div');
    collapser.id = 'home-variant-hero-extras';
    collapser.className = 'hvar-extras-wrap';
    collapser.innerHTML =
      '<button class="hvar-extras-toggle" id="hvar-extras-toggle">' +
        '<span class="hvar-extras-icon">📂</span>' +
        '<span class="hvar-extras-label">עוד <strong>' + tiles.length + '</strong> פיצ׳רים</span>' +
        '<span class="hvar-extras-chevron">▼</span>' +
      '</button>' +
      '<div class="hvar-extras-body" id="hvar-extras-body" style="display:none"></div>';

    // Mount before the bottom links area.
    var bottom = home.querySelector('.home-v2-bottom');
    if (bottom && bottom.parentNode) bottom.parentNode.insertBefore(collapser, bottom);
    else home.appendChild(collapser);

    // Move each secondary tile into the collapser body.
    var body = collapser.querySelector('#hvar-extras-body');
    tiles.forEach(function(t) { body.appendChild(t); });

    // Wire toggle
    collapser.querySelector('#hvar-extras-toggle').addEventListener('click', function() {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      collapser.querySelector('.hvar-extras-chevron').textContent = open ? '▼' : '▲';
    });
  }

  function pickHottestSignal() {
    // Returns a signal object or null. Priority encoded by order.
    // Spin wheel — top priority when available (daily-return hook).
    var spinTile = document.getElementById('spin-home-tile');
    if (spinTile && spinTile.classList.contains('has-spin')) {
      return { icon: '🎡', title: 'גלגל יומי חינם!', sub: 'סובב פעם ביום וזכה בפרס משתנה', cta: '🎁 סובב עכשיו', sel: '#spin-home-tile', cls: 'hero-reward' };
    }
    // Guild War unclaimed reward — high emotion.
    var gwTile = document.getElementById('guild-war-home-tile');
    if (gwTile && gwTile.classList.contains('has-claim')) {
      return { icon: '🛡⚔️', title: 'פרס מלחמת קלאנים!', sub: 'הקלאן השלים מלחמה — אסוף את הפרס', cta: '🎁 קבל את הפרס', sel: '#guild-war-home-tile', cls: 'hero-reward' };
    }
    var league = document.getElementById('league-home-tile');
    if (league && league.querySelector('.league-tile-reward')) {
      return { icon: '⚔️', title: 'פרס ליגה ממתין!', sub: 'אסוף את פרס שבוע שעבר', cta: '🎁 לאסוף', sel: '#league-home-tile', cls: 'hero-reward' };
    }
    var sp = document.getElementById('home-v2-season-pass');
    if (sp) {
      var claim = sp.querySelector('#home-v2-sp-claim');
      if (claim && claim.style.display !== 'none') {
        return { icon: '🎖', title: 'Battle Pass — פרסים לאיסוף!', sub: (claim.textContent || '').trim(), cta: '🎁 פתח Battle Pass', sel: '#home-v2-season-pass', cls: 'hero-reward' };
      }
    }
    var pet = document.getElementById('pet-home-widget');
    if (pet && (pet.classList.contains('pet-sad') || pet.classList.contains('pet-crying'))) {
      return { icon: '😢', title: 'הפרח שלך מתגעגע אליך', sub: 'תפנק אותו עכשיו או שהוא יבכה', cta: '💗 פתח את הפט', sel: '#pet-home-widget', cls: 'hero-urgent' };
    }
    var dailyDeal = document.querySelector('.daily-deal-home-banner');
    if (dailyDeal) {
      return { icon: '🔥', title: 'דיל יומי בחנות', sub: 'הצעה מיוחדת — רק היום', cta: '⚡ בדוק עכשיו', sel: '.daily-deal-home-banner', cls: 'hero-hot' };
    }
    var bundle = document.querySelector('.bundle-home-banner');
    if (bundle) {
      return { icon: '🎁', title: 'חבילת חג זמינה', sub: 'לזמן מוגבל בלבד', cta: '🛒 לחנות', sel: '.bundle-home-banner', cls: 'hero-hot' };
    }
    var boards = document.getElementById('home-v2-boards');
    if (boards && boards.style.display !== 'none') {
      return { icon: '🎯', title: 'לוחות דינמיים זמינים', sub: 'נסה לוחות מיוחדים', cta: '▶ שחק לוח דינמי', sel: '#home-v2-boards', cls: 'hero-neutral' };
    }
    var rival = document.getElementById('rival-home-tile');
    if (rival) return { icon: '🥊', title: 'יש לך יריב!', sub: 'נצח בעוד 24 שעות', cta: '⚔️ בדוק יריב', sel: '#rival-home-tile', cls: 'hero-neutral' };
    return null;
  }

  function renderHeroBigCard(signal) {
    var hero = document.getElementById('home-v2-hero');
    if (!hero) return;
    var card = document.createElement('div');
    card.className = 'hvar-hero-big ' + (signal.cls || '');
    card.innerHTML =
      '<div class="hvar-hero-icon">' + signal.icon + '</div>' +
      '<div class="hvar-hero-title">' + signal.title + '</div>' +
      '<div class="hvar-hero-sub">' + signal.sub + '</div>' +
      '<button class="hvar-hero-cta">' + signal.cta + '</button>';
    card.querySelector('.hvar-hero-cta').addEventListener('click', function(e) {
      e.stopPropagation();
      var el = document.querySelector(signal.sel);
      if (el && typeof el.click === 'function') el.click();
    });
    // Replace hero content but keep the container (so refresh helpers still find it).
    hero.innerHTML = '';
    hero.appendChild(card);
  }

  // ════════════════════════════════════════════════════════════
  // VARIANT 3 — JUST-IN-TIME  (idea #6, score 8.75 — TOP PICK)
  // ════════════════════════════════════════════════════════════
  // Progressively unlocks tiles based on games played. New players see
  // ONLY essentials; veterans see everything. Each new unlock fires a
  // 🎉 celebration the first time it appears.
  //
  // Default unlock waves (admin-configurable via home_jit_unlock_games):
  //   wave 1 (0-2 games):  base CTA + streak + pet + WhatsApp invite
  //   wave 2 (3-6 games):  + contests, duel, lives, checklist
  //   wave 3 (7-12 games): + season pass, daily-deals, gacha, boards
  //   wave 4 (13-25):      + leagues, rivalry, achievements, album
  //   wave 5 (26+):        + everything else (guild, prestige, bundles)
  var JIT_TILE_WAVES = {
    // wave 2 — early teasers
    '#lives-home-widget':              2,
    '#pet-home-widget':                1,
    '#checklist-home-tile':            2,
    // wave 3 — core progression
    '#home-v2-boards':                 3,
    '#home-v2-season-pass':            3,
    '.daily-deal-home-banner':         3,
    '.gacha-home-banner':              3,
    // wave 4 — competition
    '#league-home-tile':               4,
    '#rival-home-tile':                4,
    '#ach-lb-home-tile':               4,
    '#album-home-tile':                4,
    // wave 5 — meta / endgame
    '#guild-home-tile':                5,
    '#lifetime-home-tile':             5,
    '.bundle-home-banner':             5,
    '.starter-pack-home-banner':       5
  };

  var JIT_SEEN_KEY = 'bloom_jit_seen_v1';

  function jitGetUnlockThresholds() {
    try {
      var raw = (gameConfig && gameConfig.home_jit_unlock_games) || '3,7,13,26';
      var parts = String(raw).split(',').map(function(s) { return parseInt(s.trim(), 10) | 0; });
      if (parts.length !== 4 || parts.some(function(n) { return isNaN(n) || n < 0; })) parts = [3, 7, 13, 26];
      return parts;
    } catch (e) { return [3, 7, 13, 26]; }
  }

  function jitGetWaveFor(games, thresholds) {
    if (games >= thresholds[3]) return 5;
    if (games >= thresholds[2]) return 4;
    if (games >= thresholds[1]) return 3;
    if (games >= thresholds[0]) return 2;
    return 1;
  }

  function jitLoadSeen() {
    try {
      var raw = localStorage.getItem(JIT_SEEN_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }
  function jitMarkSeen(seen) {
    try { localStorage.setItem(JIT_SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }

  function applyJustInTimeVariant() {
    var games = (typeof loadGamesPlayed === 'function') ? loadGamesPlayed() : 0;
    var thresholds = jitGetUnlockThresholds();
    var currentWave = jitGetWaveFor(games, thresholds);
    var seen = jitLoadSeen();
    var newlyUnlocked = [];

    Object.keys(JIT_TILE_WAVES).forEach(function(selector) {
      var requiredWave = JIT_TILE_WAVES[selector];
      var els = document.querySelectorAll(selector);
      if (!els.length) return;
      Array.prototype.forEach.call(els, function(el) {
        if (currentWave < requiredWave) {
          // Not yet unlocked — hide it entirely.
          el.style.display = 'none';
          el.setAttribute('data-jit-hidden', '1');
        } else {
          // Unlocked. Was this the first time?
          el.removeAttribute('data-jit-hidden');
          var key = selector + ':w' + requiredWave;
          if (!seen[key]) {
            newlyUnlocked.push({ selector: selector, el: el, wave: requiredWave });
            seen[key] = Date.now();
          }
        }
      });
    });

    // Show banner for next wave teasing what's coming.
    if (currentWave < 5) {
      var nextThreshold = thresholds[currentWave - 1];
      var gamesLeft = nextThreshold - games;
      if (gamesLeft > 0) renderJitTeaserBanner(currentWave + 1, gamesLeft);
    }

    if (newlyUnlocked.length) {
      jitMarkSeen(seen);
      // Stagger celebrations so they don't all fire at once.
      newlyUnlocked.forEach(function(item, idx) {
        setTimeout(function() { jitCelebrateUnlock(item.el); }, 600 + idx * 1400);
      });
    }
  }

  function jitCelebrateUnlock(el) {
    if (!el || !document.body.contains(el)) return;
    el.classList.add('hvar-jit-unlocked');
    // Add a floating "🎉 חדש!" badge over the element.
    var badge = document.createElement('div');
    badge.className = 'hvar-jit-newbadge';
    badge.textContent = '🎉 חדש!';
    el.style.position = el.style.position || 'relative';
    el.appendChild(badge);
    try {
      if (typeof soundMilestone === 'function') soundMilestone(4);
      if (typeof buzz === 'function') buzz([40, 30, 60]);
    } catch (e) {}
    // Scroll into view so the player sees it.
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    setTimeout(function() {
      try { badge.remove(); } catch (_) {}
      el.classList.remove('hvar-jit-unlocked');
    }, 4500);
  }

  function renderJitTeaserBanner(nextWave, gamesLeft) {
    var home = document.getElementById('home-screen');
    if (!home) return;
    if (document.getElementById('hvar-jit-teaser')) return;
    var labels = {
      2: '💗 פט / משימות / חיים',
      3: '🎖 Battle Pass / לוחות דינמיים / חנות',
      4: '⚔️ ליגה / יריבות / הישגים',
      5: '🛡 קלאן / Prestige / חבילות חג'
    };
    var label = labels[nextWave] || 'פיצ׳רים חדשים';
    var banner = document.createElement('div');
    banner.id = 'hvar-jit-teaser';
    banner.className = 'hvar-jit-teaser';
    banner.innerHTML =
      '<div class="hvar-jit-teaser-icon">🔓</div>' +
      '<div class="hvar-jit-teaser-body">' +
        '<div class="hvar-jit-teaser-title">עוד <strong>' + gamesLeft + '</strong> ' +
          (gamesLeft === 1 ? 'משחק' : 'משחקים') + ' לפתיחת פיצ׳רים חדשים</div>' +
        '<div class="hvar-jit-teaser-sub">' + label + '</div>' +
      '</div>';
    // Mount near the bottom of home, before the bottom links.
    var bottom = home.querySelector('.home-v2-bottom');
    if (bottom && bottom.parentNode) bottom.parentNode.insertBefore(banner, bottom);
    else home.appendChild(banner);
  }

  // ────────────────────────────────────────────────────────────
  // Exports
  // ────────────────────────────────────────────────────────────
  window.applyHomeVariant = applyHomeVariant;
  window.getHomeVariant = getHomeVariant;
})();
