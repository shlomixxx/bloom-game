  // ============================================================
  // Stage B0 — Bottom Nav skeleton (May 2026)
  // ============================================================
  // 5-tab persistent navigation at the bottom of the home surface.
  // Industry-standard pattern (Clash Royale / Royal Match / Brawl
  // Stars): the home gets ONE clear CTA, and everything else gets
  // organized into focused tabs the player navigates to.
  //
  // For B0 the home tab still has its existing layout (we'll trim
  // it in B1). The other 4 tabs get placeholder "Coming soon" cards
  // until B2-B5 migrate their content.
  //
  // Architecture: bottom nav is mounted as a sibling of #home-screen
  // (NOT inside it) so it survives tab switches. Each non-home tab
  // mounts its own #tab-<id>-screen which replaces the home screen
  // in display:flex. The body gets `data-active-tab="<id>"` so CSS
  // can react if needed.
  // ============================================================
  (function() {

    var TABS = [
      { id: 'home',     icon: '🏠', label: 'משחק',  ariaLabel: 'מסך משחק ראשי' },
      { id: 'rewards',  icon: '🎁', label: 'פרסים', ariaLabel: 'פרסים יומיים' },
      { id: 'social',   icon: '👥', label: 'קהילה', ariaLabel: 'קהילה וחברים' },
      { id: 'progress', icon: '🏆', label: 'דרגות', ariaLabel: 'התקדמות אישית' },
      { id: 'shop',     icon: '🛍', label: 'חנות',  ariaLabel: 'חנות' }
    ];

    // Maps drawer category keys → bottom nav tab IDs.
    // Power Hero used a single drawer; the bottom nav redistributes
    // those categories across 4 destination tabs.
    var CATEGORY_TO_TAB = {
      'play':     'home',     // Boards, Battle Pass — stay near the CTA on the home tab
      'rewards':  'rewards',  // Spin / Daily Deal / Bundles / Checklist / Gacha / Starter
      'compete':  'progress', // Trophy Road / League / Rival / Ach LB
      'social':   'social',   // Guild / Guild Wars
      'collect':  'progress', // Pet / Album / Lifetime
      'extras':   'rewards',  // Login-cal / Bank / Chest / Squad / Ghost (mostly daily-return)
      'status':   'home'      // Lives / Weekly / Jackpot / Featured — stay near home so balance/status visible
    };

    // Per-tab additional selectors that Power Hero didn't categorize
    // (e.g. specific tiles that should land in a tab regardless).
    var EXTRA_TAB_SELECTORS = {
      home:     [],
      rewards:  [],
      social:   [],
      progress: [],
      shop:     []
    };

    // Cached mapping built by __bloomMigrateTilesToTabs — keyed by
    // tile selector → target tab id. Used by renderTabScreen.
    var _tileTargetTab = {};
    var _categoriesSource = null;
    var _selectorsSource = null;

    var ACTIVE_KEY = 'bloom_active_tab';
    var _navEl = null;
    var _activeTab = 'home';

    function loadActiveTab() {
      try {
        var saved = localStorage.getItem(ACTIVE_KEY);
        if (saved && TABS.some(function(t) { return t.id === saved; })) return saved;
      } catch (e) {}
      return 'home';
    }

    function saveActiveTab(id) {
      try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {}
    }

    // Build the nav DOM via createElement (no innerHTML for safety).
    function buildNav() {
      var nav = document.createElement('nav');
      nav.id = 'bloom-bottom-nav';
      nav.className = 'bloom-bottom-nav';
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', 'ניווט ראשי');
      TABS.forEach(function(tab) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bn-tab' + (tab.id === _activeTab ? ' bn-tab-active' : '');
        btn.setAttribute('data-tab', tab.id);
        btn.setAttribute('aria-label', tab.ariaLabel);
        btn.setAttribute('aria-current', tab.id === _activeTab ? 'page' : 'false');
        var iconEl = document.createElement('span');
        iconEl.className = 'bn-tab-icon';
        iconEl.textContent = tab.icon;
        var labelEl = document.createElement('span');
        labelEl.className = 'bn-tab-label';
        labelEl.textContent = tab.label;
        var badgeEl = document.createElement('span');
        badgeEl.className = 'bn-tab-badge';
        badgeEl.id = 'bn-badge-' + tab.id;
        badgeEl.style.display = 'none';
        btn.appendChild(iconEl);
        btn.appendChild(labelEl);
        btn.appendChild(badgeEl);
        btn.addEventListener('click', function() { goToTab(tab.id); });
        nav.appendChild(btn);
      });
      return nav;
    }

    function mountBottomNav() {
      if (_navEl) return; // already mounted
      _activeTab = loadActiveTab();
      _navEl = buildNav();
      document.body.appendChild(_navEl);
      document.body.setAttribute('data-active-tab', _activeTab);
      // If the persisted tab isn't 'home', restore that screen after
      // showHomeV2 finishes mounting its own DOM. We defer one tick so
      // the home elements exist (otherwise the tab function won't have
      // a stable base to hide).
      if (_activeTab !== 'home') {
        setTimeout(function() { renderTabScreen(_activeTab); }, 50);
      }
    }

    function unmountBottomNav() {
      if (!_navEl) return;
      try { _navEl.remove(); } catch (e) {}
      _navEl = null;
      // Also tear down any non-home tab screens so a fresh home
      // mount starts clean.
      ['rewards', 'social', 'progress', 'shop'].forEach(function(id) {
        var el = document.getElementById('tab-' + id + '-screen');
        if (el) el.remove();
      });
      document.body.removeAttribute('data-active-tab');
    }

    // Switch active tab. For 'home', restore the home screen + remove
    // any other tab screen. For non-home tabs, hide the home screen +
    // mount the tab's content.
    function goToTab(id) {
      if (!TABS.some(function(t) { return t.id === id; })) return;
      if (_activeTab === id) return;
      _activeTab = id;
      saveActiveTab(id);
      document.body.setAttribute('data-active-tab', id);
      // Update nav button states
      if (_navEl) {
        _navEl.querySelectorAll('.bn-tab').forEach(function(btn) {
          var isActive = btn.getAttribute('data-tab') === id;
          btn.classList.toggle('bn-tab-active', isActive);
          btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
      }
      // Hide whatever is currently shown + show target
      hideAllTabScreens();
      renderTabScreen(id);
      // Sound feedback on tab switch (subtle).
      try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
    }

    function hideAllTabScreens() {
      var home = document.getElementById('home-screen');
      if (home) home.style.display = 'none';
      ['rewards', 'social', 'progress', 'shop'].forEach(function(id) {
        var el = document.getElementById('tab-' + id + '-screen');
        if (el) el.style.display = 'none';
      });
    }

    function renderTabScreen(id) {
      if (id === 'home') {
        var home = document.getElementById('home-screen');
        if (home) home.style.display = '';
        return;
      }
      var screenId = 'tab-' + id + '-screen';
      var existing = document.getElementById(screenId);
      var screen;
      if (existing) {
        existing.style.display = '';
        screen = existing;
      } else {
        // First-time mount → build empty shell + header. Tile migration
        // happens below for both first mount and subsequent visits
        // (deferred tiles may have appeared after a previous visit).
        screen = buildEmptyTabShell(id);
        screen.id = screenId;
        var app = document.querySelector('.app');
        if (app) app.appendChild(screen);
        else document.body.appendChild(screen);
      }
      // Pull any tiles that belong to this tab into the body. Tiles
      // mounted into the home screen by their respective modules get
      // physically moved into the tab on first activation.
      migrateTilesIntoTab(id, screen);
      // If the body still has nothing (no tiles available yet) keep
      // a friendly placeholder so the tab isn't an empty void.
      ensurePlaceholderIfEmpty(id, screen);
    }

    // Build the per-tab empty shell (header + body container). Tiles
    // get appended to the `.bn-tab-screen-body` later by migration.
    function buildEmptyTabShell(id) {
      var tab = TABS.find(function(t) { return t.id === id; });
      var screen = document.createElement('div');
      screen.className = 'bn-tab-screen';
      screen.setAttribute('data-tab-id', id);

      var header = document.createElement('div');
      header.className = 'bn-tab-screen-header';
      var titleEl = document.createElement('div');
      titleEl.className = 'bn-tab-screen-title';
      titleEl.textContent = (tab ? tab.icon + ' ' + tab.label : id);
      var subEl = document.createElement('div');
      subEl.className = 'bn-tab-screen-sub';
      subEl.textContent = tabSubtitle(id);
      header.appendChild(titleEl);
      header.appendChild(subEl);

      var body = document.createElement('div');
      body.className = 'bn-tab-screen-body';
      body.id = 'tab-' + id + '-body';

      screen.appendChild(header);
      screen.appendChild(body);
      return screen;
    }

    function tabSubtitle(id) {
      switch (id) {
        case 'rewards':  return 'הפרסים והאתגרים היומיים שלך';
        case 'social':   return 'דו-קרבות, יריבים, חברים, קלאן';
        case 'progress': return 'המסע שלך — גביעים, ליגה, אוסף';
        case 'shop':     return 'סקינים, גצ׳ה, בנק, בוסטרים';
      }
      return '';
    }

    function ensurePlaceholderIfEmpty(id, screen) {
      var body = screen.querySelector('.bn-tab-screen-body');
      if (!body) return;
      var hasTiles = body.children.length > 0;
      var existingPlaceholder = body.querySelector('.bn-tab-placeholder-card');
      if (hasTiles && !existingPlaceholder) return;
      if (hasTiles && existingPlaceholder) { existingPlaceholder.remove(); return; }
      if (existingPlaceholder) return; // already has placeholder
      // Build a friendly empty-state card.
      var card = document.createElement('div');
      card.className = 'bn-tab-placeholder-card';
      var icon = document.createElement('div');
      icon.className = 'bn-tab-placeholder-icon';
      var tab = TABS.find(function(t) { return t.id === id; });
      icon.textContent = tab ? tab.icon : '✨';
      var title = document.createElement('div');
      title.className = 'bn-tab-placeholder-title';
      title.textContent = emptyTitle(id);
      var sub = document.createElement('div');
      sub.className = 'bn-tab-placeholder-sub';
      sub.textContent = emptySub(id);
      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(sub);
      body.appendChild(card);
    }

    function emptyTitle(id) {
      switch (id) {
        case 'rewards':  return 'אין פרסים זמינים כרגע';
        case 'social':   return 'אין פעילות חברתית כרגע';
        case 'progress': return 'התקדמותך תופיע כאן';
        case 'shop':     return 'החנות תופיע בקרוב';
      }
      return '';
    }
    function emptySub(id) {
      switch (id) {
        case 'rewards':  return 'שחק כמה משחקים — פרסים יומיים, גלגל, וDaily Deals יופיעו כאן';
        case 'social':   return 'הזמן חבר או הצטרף לקלאן כדי לראות פעילות';
        case 'progress': return 'הגיע ל-tier 6 או מעלה במשחק כדי לראות גביעים';
        case 'shop':     return 'בקרוב — סקינים, חבילות מיוחדות, גצ׳ה';
      }
      return '';
    }

    // Move tiles from #home-screen into the matching tab body.
    function migrateTilesIntoTab(tabId, screen) {
      if (!_selectorsSource || !_categoriesSource) return;
      var body = screen.querySelector('.bn-tab-screen-body');
      if (!body) return;
      for (var i = 0; i < _selectorsSource.length; i++) {
        var sel = _selectorsSource[i];
        var targetTab = _tileTargetTab[sel];
        if (targetTab !== tabId) continue;
        var els = document.querySelectorAll(sel);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          // Already in this tab? Skip.
          if (body.contains(el)) continue;
          // Make sure it's visible (some tiles default to display:none
          // until their helper decides to show them; we surface them
          // because they're now first-class tab content).
          if (el.style.display === 'none') el.style.display = '';
          body.appendChild(el);
        }
      }
    }

    // Called by Power Hero applyHeroVariant: passes its category mapping
    // so we know which tile goes where. We resolve every tile selector
    // to a target tab id once + cache the result.
    function migrateTilesToTabs(selectors, categories) {
      _selectorsSource = selectors;
      _categoriesSource = categories;
      _tileTargetTab = {};
      for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var catKey = resolveCategoryForSelector(sel, categories);
        var tabId = CATEGORY_TO_TAB[catKey] || 'rewards';
        _tileTargetTab[sel] = tabId;
      }
      // If a tab screen is currently mounted (i.e. we're on a non-home
      // tab right now), re-migrate so newly mounted tiles land in it.
      var current = _activeTab;
      if (current && current !== 'home') {
        var screen = document.getElementById('tab-' + current + '-screen');
        if (screen) migrateTilesIntoTab(current, screen);
      }
    }

    function resolveCategoryForSelector(sel, categories) {
      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        if (cat.match && cat.match(sel)) return cat.key;
      }
      return null;
    }

    // (B1 May 2026: legacy buildPlaceholderTab + placeholderTitle/Sub
    //  removed — replaced by buildEmptyTabShell + ensurePlaceholderIfEmpty
    //  which builds an empty body container that gets filled by tile
    //  migration, falling back to an empty-state card only when no
    //  tiles for that tab exist yet.)

    // Public: set the badge count/dot on a tab.
    // count: number (shows N up to 99 then "99+"), 'dot' (just a red dot),
    //        or null/0 to hide.
    function setBadge(tabId, value) {
      var el = document.getElementById('bn-badge-' + tabId);
      if (!el) return;
      if (value === null || value === undefined || value === 0 || value === false) {
        el.style.display = 'none';
        el.textContent = '';
        el.classList.remove('bn-tab-badge-dot');
        return;
      }
      if (value === 'dot' || value === true) {
        el.classList.add('bn-tab-badge-dot');
        el.textContent = '';
        el.style.display = 'inline-block';
        return;
      }
      var n = parseInt(value, 10) || 0;
      if (n <= 0) {
        el.style.display = 'none';
        el.textContent = '';
        return;
      }
      el.classList.remove('bn-tab-badge-dot');
      el.textContent = n > 99 ? '99+' : String(n);
      el.style.display = 'inline-block';
    }

    // ────────────────────────────────────────────────────────────
    // Exports
    // ────────────────────────────────────────────────────────────
    window.__bloomMountBottomNav   = mountBottomNav;
    window.__bloomUnmountBottomNav = unmountBottomNav;
    window.__bloomGoToTab          = goToTab;
    window.__bloomSetTabBadge      = setBadge;
    window.__bloomGetActiveTab     = function() { return _activeTab; };
    window.__bloomMigrateTilesToTabs = migrateTilesToTabs;
  })();
