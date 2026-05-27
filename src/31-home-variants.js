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
  // Power Hero (May 2026): expanded to include featured / weekly / jackpot so
  // the home reads as ONE clear path (PLAY → drawer) instead of a tile-wall.
  var SECONDARY_TILE_SELECTORS = [
    '#spin-home-tile',
    '#guild-war-home-tile',
    '#trophy-home-tile',
    '#chest-home-tile',
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
    '#login-cal-tile',
    '#gem-bank-tile',
    '#ghost-mode-tile',
    '#squad-tile',
    '#home-v2-featured',
    '#home-weekly-host',
    '#home-jackpot',
    '.daily-deal-home-banner',
    '.gacha-home-banner',
    '.starter-pack-home-banner',
    '.bundle-home-banner'
  ];

  // Power Hero (May 2026): drawer category mapping. Each secondary tile is
  // bucketed by selector pattern → category key. Category headers render
  // BETWEEN groups so the drawer reads as a navigable menu, not a flat dump.
  // Order = display order in the drawer (most-played categories first).
  var DRAWER_CATEGORIES = [
    {
      key: 'play',
      title: '🎮 משחק',
      sub: 'לוחות מיוחדים, Battle Pass, סקינים',
      match: function(sel) {
        return sel === '#home-v2-boards' || sel === '#home-v2-season-pass';
      }
    },
    {
      key: 'rewards',
      title: '🎁 פרסים יומיים',
      sub: 'דברים חינם שמחכים לך עכשיו',
      match: function(sel) {
        return sel === '#spin-home-tile'
          || sel === '#checklist-home-tile'
          || sel === '.daily-deal-home-banner'
          || sel === '.gacha-home-banner'
          || sel === '.starter-pack-home-banner'
          || sel === '.bundle-home-banner';
      }
    },
    {
      key: 'compete',
      title: '🏆 תחרות',
      sub: 'טרופי, ליגה, יריבים',
      match: function(sel) {
        return sel === '#trophy-home-tile'
          || sel === '#league-home-tile'
          || sel === '#rival-home-tile'
          || sel === '#ach-lb-home-tile';
      }
    },
    {
      key: 'social',
      title: '👥 קהילה',
      sub: 'הקלאן שלך + מלחמות',
      match: function(sel) {
        return sel === '#guild-home-tile' || sel === '#guild-war-home-tile';
      }
    },
    {
      key: 'collect',
      title: '🌱 אוסף',
      sub: 'פט, אלבום, פרסטיג׳',
      match: function(sel) {
        return sel === '#pet-home-widget'
          || sel === '#album-home-tile'
          || sel === '#lifetime-home-tile';
      }
    },
    {
      key: 'extras',
      title: '✨ מיני-משחקים',
      sub: 'לוח כניסה / בנק / טרופי-צ׳סט / רוחות',
      match: function(sel) {
        return sel === '#login-cal-tile'
          || sel === '#gem-bank-tile'
          || sel === '#chest-home-tile'
          || sel === '#squad-tile'
          || sel === '#ghost-mode-tile';
      }
    },
    {
      key: 'status',
      title: '📊 סטטוס',
      sub: 'חיים, שבועי, ג׳קפוט',
      match: function(sel) {
        return sel === '#lives-home-widget'
          || sel === '#home-v2-featured'
          || sel === '#home-weekly-host'
          || sel === '#home-jackpot';
      }
    }
  ];

  function tileCategoryKey(el) {
    if (!el) return 'status';
    var id = el.id ? '#' + el.id : '';
    var cls = '';
    if (el.classList && el.classList.length) {
      for (var i = 0; i < el.classList.length; i++) cls += '.' + el.classList[i];
    }
    // Try ID first, then classes. Match against our category selectors.
    for (var c = 0; c < DRAWER_CATEGORIES.length; c++) {
      var cat = DRAWER_CATEGORIES[c];
      if (id && cat.match(id)) return cat.key;
      if (cls) {
        for (var ci = 0; ci < SECONDARY_TILE_SELECTORS.length; ci++) {
          var sel = SECONDARY_TILE_SELECTORS[ci];
          if (sel.charAt(0) === '.' && cls.indexOf(sel) !== -1 && cat.match(sel)) return cat.key;
        }
      }
    }
    return 'status'; // sensible fallback bucket
  }

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
    if (!home || document.getElementById('home-variant-carousel')) return; // re-entry guard

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
    // Trophy Road — high priority when there's unclaimed milestone.
    var trophyTile = document.getElementById('trophy-home-tile');
    if (trophyTile && trophyTile.classList.contains('has-claim')) {
      out.push({ action: 'trophy', icon: '🏆', title: 'מסלול גביעים', sub: '🎁 פרס דרך ממתין!', cls: 'hot' });
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
      trophy: '#trophy-home-tile',
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
  // VARIANT 2 — POWER HERO (May 2026 redesign of idea #2)
  // ════════════════════════════════════════════════════════════
  // Three-layer home: balance bar (top, tiny) → giant CTA + hot
  // signal teaser → categorized drawer of everything else.
  //
  // Why this is more addictive than v2:
  //  - The eye is FORCED to the massive PLAY button. Industry data
  //    (Clash Royale, Royal Match, Brawl Stars) shows a single
  //    dominant CTA boosts session-start rate 30-45%.
  //  - Hot signals rotate every 5s above the CTA so a returning
  //    player ALWAYS sees something fresh — variable-reward novelty.
  //  - Drawer keeps every existing feature 1 tap away — zero
  //    regression for veterans, much less cognitive load for new.
  //  - Categorized = navigable. Flat list = wall.
  function applyHeroVariant() {
    var home = document.getElementById('home-screen');
    if (!home) return;
    // Re-entry guard.
    if (document.getElementById('home-variant-hero-extras')) return;

    document.body.classList.add('power-hero');

    // Stage B1 (May 2026): when the Bottom Nav is mounted, the old
    // Power Hero drawer is redundant — tabs replace it. Skip drawer
    // creation. Tile routing is owned by the bottom-nav module via
    // its own MutationObserver on #home-screen. We just mount the
    // rotating hero card (the home-tab's centerpiece signal).
    var bottomNavActive = !!document.body.getAttribute('data-active-tab');
    if (bottomNavActive) {
      var signalsForNav = collectHotSignals();
      if (signalsForNav.length) renderRotatingHeroCard(signalsForNav);
      // Safety: ask the bottom-nav module to rescan in case any tiles
      // slipped through before the observer attached. The observer is
      // the primary mechanism — this is just a belt-and-suspenders.
      if (typeof window.__bloomMigrateTilesToTabs === 'function') {
        try { window.__bloomMigrateTilesToTabs(); } catch (e) {}
      }
      return;
    }

    // 1. Collect ROTATING signals (not just the top one) — variable
    //    novelty is what keeps the home interesting across sessions.
    var signals = collectHotSignals();
    if (signals.length) renderRotatingHeroCard(signals);

    // 2. Collapse all secondary tiles into a CATEGORIZED drawer.
    var tiles = collectSecondaryTiles();
    if (!tiles.length) return;

    var collapser = document.createElement('div');
    collapser.id = 'home-variant-hero-extras';
    collapser.className = 'hvar-extras-wrap';

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'hvar-extras-toggle';
    toggleBtn.id = 'hvar-extras-toggle';
    toggleBtn.setAttribute('aria-expanded', 'false');
    var toggleIcon = document.createElement('span');
    toggleIcon.className = 'hvar-extras-icon';
    toggleIcon.textContent = '📂';
    var toggleLabel = document.createElement('span');
    toggleLabel.className = 'hvar-extras-label';
    var toggleLabelMain = document.createElement('span');
    toggleLabelMain.className = 'hvar-extras-label-main';
    toggleLabelMain.textContent = 'כל הפיצ׳רים';
    var toggleLabelSub = document.createElement('span');
    toggleLabelSub.className = 'hvar-extras-label-sub';
    toggleLabelSub.textContent = tiles.length + ' חדרים — לחץ לחקור';
    toggleLabel.appendChild(toggleLabelMain);
    toggleLabel.appendChild(toggleLabelSub);
    var toggleChevron = document.createElement('span');
    toggleChevron.className = 'hvar-extras-chevron';
    toggleChevron.textContent = '▼';
    toggleBtn.appendChild(toggleIcon);
    toggleBtn.appendChild(toggleLabel);
    toggleBtn.appendChild(toggleChevron);

    var body = document.createElement('div');
    body.className = 'hvar-extras-body';
    body.id = 'hvar-extras-body';
    body.style.display = 'none';

    collapser.appendChild(toggleBtn);
    collapser.appendChild(body);

    // Mount before the bottom links area.
    var bottom = home.querySelector('.home-v2-bottom');
    if (bottom && bottom.parentNode) bottom.parentNode.insertBefore(collapser, bottom);
    else home.appendChild(collapser);

    // Categorize tiles and render category groups in the drawer body.
    renderCategorizedDrawer(body, tiles);

    // Toggle interaction.
    toggleBtn.addEventListener('click', function() {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      toggleBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      toggleChevron.textContent = open ? '▼' : '▲';
      if (!open) {
        try { body.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // CATEGORIZED DRAWER (Power Hero)
  // ────────────────────────────────────────────────────────────
  function renderCategorizedDrawer(bodyEl, tiles) {
    var buckets = {};
    DRAWER_CATEGORIES.forEach(function(c) { buckets[c.key] = []; });
    tiles.forEach(function(t) {
      var k = tileCategoryKey(t);
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(t);
    });
    DRAWER_CATEGORIES.forEach(function(cat) {
      var items = buckets[cat.key];
      if (!items || !items.length) return;
      var section = document.createElement('div');
      section.className = 'hvar-drawer-section';
      var header = document.createElement('div');
      header.className = 'hvar-drawer-section-header';
      var titleSpan = document.createElement('span');
      titleSpan.className = 'hvar-drawer-section-title';
      titleSpan.textContent = cat.title + ' ';
      var countSpan = document.createElement('span');
      countSpan.className = 'hvar-drawer-section-count';
      countSpan.textContent = String(items.length);
      titleSpan.appendChild(countSpan);
      var subSpan = document.createElement('span');
      subSpan.className = 'hvar-drawer-section-sub';
      subSpan.textContent = cat.sub;
      header.appendChild(titleSpan);
      header.appendChild(subSpan);
      var sectionBody = document.createElement('div');
      sectionBody.className = 'hvar-drawer-section-body';
      section.appendChild(header);
      section.appendChild(sectionBody);
      bodyEl.appendChild(section);
      items.forEach(function(t) { sectionBody.appendChild(t); });
    });
  }

  // ────────────────────────────────────────────────────────────
  // ROTATING HERO CARD — variable-reward novelty on home
  // ────────────────────────────────────────────────────────────
  function collectHotSignals() {
    var out = [];
    function push(s) { if (s) out.push(s); }
    var spinTile = document.getElementById('spin-home-tile');
    if (spinTile && spinTile.classList.contains('has-spin')) {
      push({ icon: '🎡', title: 'גלגל יומי חינם!', sub: 'סובב פעם ביום וזכה בפרס משתנה', cta: '🎁 סובב עכשיו', sel: '#spin-home-tile', cls: 'hero-reward' });
    }
    var gwTile = document.getElementById('guild-war-home-tile');
    if (gwTile && gwTile.classList.contains('has-claim')) {
      push({ icon: '🛡⚔️', title: 'פרס מלחמת קלאנים!', sub: 'הקלאן השלים מלחמה — אסוף את הפרס', cta: '🎁 קבל את הפרס', sel: '#guild-war-home-tile', cls: 'hero-reward' });
    }
    var trophyTile = document.getElementById('trophy-home-tile');
    if (trophyTile && trophyTile.classList.contains('has-claim')) {
      push({ icon: '🏆', title: 'פרס מסלול גביעים ממתין!', sub: 'הגעת ל-Trophy milestone — קבל את הפרס', cta: '🎁 קבל פרס', sel: '#trophy-home-tile', cls: 'hero-reward' });
    }
    var league = document.getElementById('league-home-tile');
    if (league && league.querySelector('.league-tile-reward')) {
      push({ icon: '⚔️', title: 'פרס ליגה ממתין!', sub: 'אסוף את פרס שבוע שעבר', cta: '🎁 לאסוף', sel: '#league-home-tile', cls: 'hero-reward' });
    }
    var sp = document.getElementById('home-v2-season-pass');
    if (sp) {
      var claim = sp.querySelector('#home-v2-sp-claim');
      if (claim && claim.style.display !== 'none') {
        push({ icon: '🎖', title: 'Battle Pass — פרסים לאיסוף!', sub: (claim.textContent || '').trim(), cta: '🎁 פתח Battle Pass', sel: '#home-v2-season-pass', cls: 'hero-reward' });
      }
    }
    var pet = document.getElementById('pet-home-widget');
    if (pet && (pet.classList.contains('pet-sad') || pet.classList.contains('pet-crying'))) {
      push({ icon: '😢', title: 'הפרח שלך מתגעגע אליך', sub: 'תפנק אותו עכשיו או שהוא יבכה', cta: '💗 פתח את הפט', sel: '#pet-home-widget', cls: 'hero-urgent' });
    }
    var dailyDeal = document.querySelector('.daily-deal-home-banner');
    if (dailyDeal) {
      push({ icon: '🔥', title: 'דיל יומי בחנות', sub: 'הצעה מיוחדת — רק היום', cta: '⚡ בדוק עכשיו', sel: '.daily-deal-home-banner', cls: 'hero-hot' });
    }
    var bundle = document.querySelector('.bundle-home-banner');
    if (bundle) {
      push({ icon: '🎁', title: 'חבילת חג זמינה', sub: 'לזמן מוגבל בלבד', cta: '🛒 לחנות', sel: '.bundle-home-banner', cls: 'hero-hot' });
    }
    var boards = document.getElementById('home-v2-boards');
    if (boards && boards.style.display !== 'none') {
      push({ icon: '🎯', title: 'לוחות דינמיים זמינים', sub: 'נסה לוחות מיוחדים', cta: '▶ שחק לוח דינמי', sel: '#home-v2-boards', cls: 'hero-neutral' });
    }
    var rival = document.getElementById('rival-home-tile');
    if (rival) push({ icon: '🥊', title: 'יש לך יריב!', sub: 'נצח בעוד 24 שעות', cta: '⚔️ בדוק יריב', sel: '#rival-home-tile', cls: 'hero-neutral' });
    return out;
  }

  function renderRotatingHeroCard(signals) {
    var hero = document.getElementById('home-v2-hero');
    if (!hero) return;
    // renderHeroBannerV2() in showHomeV2 may have hidden this container
    // via inline style="display:none" when there were no special hot
    // states (paused contest / streak FOMO / etc). Power Hero wants to
    // USE this slot for the rotating signal card, so force it visible.
    hero.style.display = '';
    var card = document.createElement('div');
    card.className = 'hvar-hero-big ' + (signals[0].cls || '');
    card.setAttribute('data-rot-idx', '0');
    paintHeroCardContent(card, signals[0]);
    hero.innerHTML = '';
    hero.appendChild(card);

    if (signals.length < 2) return; // nothing to rotate

    // Prev/next arrow buttons — sit at the card's RTL edges. The RTL
    // convention is "next = left arrow" (text flows right-to-left), so
    // the visual on-screen "next" button shows ‹. Logical inset-inline-*
    // CSS would also work; we use absolute positioning + sign-flip in JS.
    var dir = (getComputedStyle(document.documentElement).direction === 'rtl') ? 'rtl' : 'ltr';
    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'hvar-hero-nav hvar-hero-nav-prev';
    prevBtn.setAttribute('aria-label', 'הקודם');
    prevBtn.textContent = dir === 'rtl' ? '›' : '‹';
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'hvar-hero-nav hvar-hero-nav-next';
    nextBtn.setAttribute('aria-label', 'הבא');
    nextBtn.textContent = dir === 'rtl' ? '‹' : '›';
    card.appendChild(prevBtn);
    card.appendChild(nextBtn);

    // Dots row — tap any dot to jump.
    var dots = document.createElement('div');
    dots.className = 'hvar-hero-dots';
    var dotCount = Math.min(signals.length, 5);
    for (var i = 0; i < dotCount; i++) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'hvar-hero-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'עבור לכרטיס ' + (i + 1));
      dot.setAttribute('data-idx', String(i));
      dots.appendChild(dot);
    }
    card.appendChild(dots);

    // Single source of truth for changing the active signal.
    var rotIdx = 0;
    var lastInteractAt = 0;
    var animating = false;
    function goTo(targetIdx, opts) {
      if (animating) return;
      targetIdx = ((targetIdx % signals.length) + signals.length) % signals.length;
      if (targetIdx === rotIdx) return;
      animating = true;
      rotIdx = targetIdx;
      var next = signals[rotIdx];
      card.classList.remove('hero-reward', 'hero-urgent', 'hero-hot', 'hero-neutral');
      if (next.cls) card.classList.add(next.cls);
      card.style.transition = 'opacity 0.22s ease';
      card.style.opacity = '0';
      setTimeout(function() {
        paintHeroCardContent(card, next);
        card.style.opacity = '1';
        var dotEls = card.querySelectorAll('.hvar-hero-dot');
        for (var d = 0; d < dotEls.length; d++) {
          dotEls[d].classList.toggle('active', d === (rotIdx % dotEls.length));
        }
        animating = false;
      }, 240);
      if (opts && opts.user) lastInteractAt = Date.now();
    }

    // Auto-rotate every 7s — slower than before (5s was too aggressive).
    // Pauses for 12s after any user interaction so they can read.
    var AUTO_MS = 7000;
    var PAUSE_AFTER_INTERACT_MS = 12000;
    var timer = setInterval(function() {
      if (!document.body.contains(card)) { clearInterval(timer); return; }
      if (Date.now() - lastInteractAt < PAUSE_AFTER_INTERACT_MS) return;
      goTo(rotIdx + 1, { user: false });
    }, AUTO_MS);

    // Prev/Next arrow handlers (RTL-aware: visual prev = data-prev,
    // visual next = data-next; user expectation matches direction of
    // the chevron, not the index sign).
    prevBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      goTo(rotIdx - 1, { user: true });
    });
    nextBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      goTo(rotIdx + 1, { user: true });
    });

    // Dot click → jump to that index.
    dots.addEventListener('click', function(e) {
      var t = e.target.closest('.hvar-hero-dot');
      if (!t) return;
      e.stopPropagation();
      var idx = parseInt(t.getAttribute('data-idx'), 10);
      if (!isFinite(idx)) return;
      goTo(idx, { user: true });
    });

    // Swipe gesture — horizontal swipe ≥40px triggers navigation. In RTL,
    // swiping LEFT means going to the "next" content (matches the visual
    // ‹ arrow position). In LTR, swiping RIGHT means next.
    var touchStartX = 0;
    var touchStartY = 0;
    var swipeArmed = false;
    card.addEventListener('touchstart', function(e) {
      if (!e.touches || !e.touches[0]) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swipeArmed = true;
      lastInteractAt = Date.now();
    }, { passive: true });
    card.addEventListener('touchend', function(e) {
      if (!swipeArmed || !e.changedTouches || !e.changedTouches[0]) return;
      swipeArmed = false;
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      // Only count if horizontal-dominant and beyond threshold.
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      // RTL inversion: in RTL, dx>0 (swipe right) means "previous" content.
      var sign = (dir === 'rtl') ? -1 : 1;
      var delta = (dx > 0) ? -1 * sign : 1 * sign;
      goTo(rotIdx + delta, { user: true });
    }, { passive: true });

    // Keyboard navigation when card is focused.
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') { goTo(rotIdx + (dir === 'rtl' ? -1 : 1), { user: true }); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(rotIdx + (dir === 'rtl' ? 1 : -1), { user: true }); e.preventDefault(); }
    });
  }

  function paintHeroCardContent(card, signal) {
    // Preserve nav chrome (prev/next arrows + dots) across paints.
    // Without this, auto-rotate's wipe would destroy the arrows on
    // every cycle because paintHeroCardContent used to only re-attach
    // dots. Bug observed: 7s after page load, the prev/next chevrons
    // would vanish silently after the first rotation.
    var prev = card.querySelector('.hvar-hero-nav-prev');
    var next = card.querySelector('.hvar-hero-nav-next');
    var dots = card.querySelector('.hvar-hero-dots');
    // Clear card; rebuild content via createElement; re-attach chrome.
    while (card.firstChild) card.removeChild(card.firstChild);
    var iconEl = document.createElement('div');
    iconEl.className = 'hvar-hero-icon';
    iconEl.textContent = signal.icon;
    var titleEl = document.createElement('div');
    titleEl.className = 'hvar-hero-title';
    titleEl.textContent = signal.title;
    var subEl = document.createElement('div');
    subEl.className = 'hvar-hero-sub';
    subEl.textContent = signal.sub;
    var ctaEl = document.createElement('button');
    ctaEl.className = 'hvar-hero-cta';
    ctaEl.textContent = signal.cta;
    ctaEl.addEventListener('click', function(e) {
      e.stopPropagation();
      var el = document.querySelector(signal.sel);
      if (el && typeof el.click === 'function') el.click();
    });
    card.appendChild(iconEl);
    card.appendChild(titleEl);
    card.appendChild(subEl);
    card.appendChild(ctaEl);
    if (prev) card.appendChild(prev);
    if (next) card.appendChild(next);
    if (dots) card.appendChild(dots);
  }

  // (Power Hero May 2026: legacy pickHottestSignal + renderHeroBigCard
  //  removed — replaced by collectHotSignals + renderRotatingHeroCard
  //  which return ALL signals and rotate through them every 5s for
  //  variable-reward novelty on the home screen.)

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
