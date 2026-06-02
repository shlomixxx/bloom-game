  // ============================================================
  // Stage B0+B1 (May 2026) — Bottom Nav with MutationObserver
  // ============================================================
  // 5-tab persistent navigation. Owns the tile→tab mapping and uses
  // a MutationObserver on #home-screen to catch tiles as they mount
  // (most mount via deferred setTimeout 400-3000ms; without the
  // observer, late tiles would be stranded in home-screen and become
  // invisible whenever the user switches to a non-home tab).
  //
  // Architecture:
  //   - mountBottomNav: builds nav + pre-creates the 4 non-home tab
  //     screens (hidden) + attaches MutationObserver to home-screen
  //   - Observer: every added node tested against TILE_TO_TAB; if it
  //     matches a tile with target != 'home', moved immediately into
  //     the target tab's body container.
  //   - On mount, also runs a one-time scan to migrate any tiles that
  //     already exist (e.g. tiles mounted before observer attached).
  //   - goToTab: just toggles screen visibility (no migration needed
  //     — tiles already routed by observer).
  // ============================================================
  (function() {

    var TABS = [
      { id: 'home',     icon: '🏠', label: 'משחק',  ariaLabel: 'מסך משחק ראשי' },
      { id: 'rewards',  icon: '🎁', label: 'פרסים', ariaLabel: 'פרסים יומיים' },
      { id: 'social',   icon: '👥', label: 'קהילה', ariaLabel: 'קהילה וחברים' },
      { id: 'progress', icon: '🏆', label: 'דרגות', ariaLabel: 'התקדמות אישית' },
      { id: 'shop',     icon: '🛍', label: 'חנות',  ariaLabel: 'חנות' }
    ];

    // Owned tile→tab mapping. Single source of truth — independent of
    // Power Hero's category map (which was the old approach).
    // Maximizing addiction:
    //  - Home: progression hooks close to PLAY (BP, boards, lives,
    //    weekly, jackpot, featured)
    //  - Rewards: daily-free dopamine (spin, checklist, login-cal,
    //    chest, daily deal)
    //  - Social: other-people surfaces (guild, war, squad, rival,
    //    ghost mode, friends)
    //  - Progress: my-journey indicators (trophy road, league,
    //    lifetime/prestige, pet, album, achievements LB)
    //  - Shop: economy + paid surfaces (gem bank, gacha, starter
    //    pack, bundles, skins eventually)
    var TILE_TO_TAB = {
      // ── Home tab ──
      '#home-v2-boards':           'home',
      '#home-v2-season-pass':      'home',
      '#lives-home-widget':        'home',
      '#home-v2-featured':         'home',
      '#home-weekly-host':         'home',
      '#home-jackpot':             'home',
      // The discovery surfaces are a cross-cutting "browse all features" zone;
      // they belong on the home tab. Mapped to 'home' so the observer claims
      // them (preventing the descendant-scan from touching them) but leaves
      // them in place — they self-mount ABOVE the footer (see 47-discovery.js).
      '#discovery-tile':           'home',
      '#discovery-next-unlock':    'home',
      // ── Rewards tab ──
      '#spin-home-tile':           'rewards',
      '#checklist-home-tile':      'rewards',
      '#login-cal-tile':           'rewards',
      '#chest-home-tile':          'rewards',
      '.daily-deal-home-banner':   'rewards',
      // ── Social tab ──
      '#friends-banner':           'social',
      '#guild-home-tile':          'social',
      '#guild-war-home-tile':      'social',
      '#squad-tile':               'social',
      '#rival-home-tile':          'social',
      '#ghost-mode-tile':          'social',
      // ── Progress tab ──
      '#trophy-home-tile':         'progress',
      '#league-home-tile':         'progress',
      '#lifetime-home-tile':       'progress',
      '#pet-home-widget':          'progress',
      '#album-home-tile':          'progress',
      '#ach-lb-home-tile':         'progress',
      // ── Shop tab ──
      '#gem-bank-tile':            'shop',
      '.gacha-home-banner':        'shop',
      '.starter-pack-home-banner': 'shop',
      '.bundle-home-banner':       'shop'
    };

    var ACTIVE_KEY = 'bloom_active_tab';
    var _navEl = null;
    var _activeTab = 'home';
    var _observer = null;
    var _tabScreens = {}; // id → DOM node

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

    // ────────────────────────────────────────────────────────────
    // BUILD: nav bar
    // ────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────
    // BUILD: pre-created tab screens (hidden until clicked)
    // ────────────────────────────────────────────────────────────
    function buildTabShell(id) {
      var tab = TABS.find(function(t) { return t.id === id; });
      var screen = document.createElement('div');
      screen.className = 'bn-tab-screen';
      screen.id = 'tab-' + id + '-screen';
      screen.setAttribute('data-tab-id', id);
      // Pre-created tabs start hidden; only the active tab is shown.
      screen.style.display = (id === _activeTab && id !== 'home') ? '' : 'none';

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
        case 'shop':     return 'חנות + כלכלת הג׳מים שלך';
      }
      return '';
    }

    function buildPlaceholderCard(id) {
      var tab = TABS.find(function(t) { return t.id === id; });
      var card = document.createElement('div');
      card.className = 'bn-tab-placeholder-card';
      var iconEl = document.createElement('div');
      iconEl.className = 'bn-tab-placeholder-icon';
      iconEl.textContent = tab ? tab.icon : '✨';
      var titleEl = document.createElement('div');
      titleEl.className = 'bn-tab-placeholder-title';
      titleEl.textContent = emptyTitle(id);
      var subEl = document.createElement('div');
      subEl.className = 'bn-tab-placeholder-sub';
      subEl.textContent = emptySub(id);
      card.appendChild(iconEl);
      card.appendChild(titleEl);
      card.appendChild(subEl);
      return card;
    }
    function emptyTitle(id) {
      switch (id) {
        case 'rewards':  return 'הפרסים שלך יופיעו כאן';
        case 'social':   return 'הקהילה שלך תופיע כאן';
        case 'progress': return 'התקדמותך תופיע כאן';
        case 'shop':     return 'החנות מתעדכנת';
      }
      return '';
    }
    function emptySub(id) {
      switch (id) {
        case 'rewards':  return 'גלגל יומי, משימות, דילים — יופיעו ברגע שיהיו זמינים';
        case 'social':   return 'הזמן חבר, הצטרף לקלאן, או שחק דו-קרב כדי לראות פעילות';
        case 'progress': return 'שחק כמה משחקים כדי לפתוח גביעים, ליגה ואלבום';
        case 'shop':     return 'סקינים, גצ׳ה, חבילות וכלכלת ג׳מים — בקרוב';
      }
      return '';
    }

    // ────────────────────────────────────────────────────────────
    // MIGRATION: move a tile to its target tab body
    // ────────────────────────────────────────────────────────────
    function moveTileToTab(el, tabId) {
      if (!el || tabId === 'home') return;
      // Idempotent guard.
      if (el.classList && el.classList.contains('bn-migrated')) return;
      var screen = _tabScreens[tabId] || document.getElementById('tab-' + tabId + '-screen');
      if (!screen) return;
      var body = screen.querySelector('.bn-tab-screen-body');
      if (!body) return;
      el.classList.add('bn-migrated');
      if (el.style.display === 'none') el.style.display = '';
      body.appendChild(el);
      // Remove placeholder when real content arrives.
      var placeholder = body.querySelector('.bn-tab-placeholder-card');
      if (placeholder) placeholder.remove();
      // Subtle slide-in.
      el.classList.add('bn-tile-arrived');
      setTimeout(function() { if (el.classList) el.classList.remove('bn-tile-arrived'); }, 700);
      // **DISCOVERY**: badge the tab so the user KNOWS new content is
      // there. Without this, tiles silently route into tabs and the
      // user wonders where their bank/spin/pet went.
      updateTabBadge(tabId);
    }

    // Count real tiles (excluding placeholder) in a tab body, compare
    // to the last seen count from localStorage. If new tiles arrived
    // since last visit → set a badge with the delta.
    function updateTabBadge(tabId) {
      if (tabId === _activeTab) {
        // User is looking at this tab right now — they see the tiles.
        // Don't badge, but DO update the seen count so future visits
        // start fresh.
        snapshotSeenCount(tabId);
        return;
      }
      var body = document.getElementById('tab-' + tabId + '-body');
      if (!body) return;
      var realTiles = countRealTiles(body);
      var lastSeen = readSeenCount(tabId);
      var delta = realTiles - lastSeen;
      if (delta > 0) {
        setBadge(tabId, delta);
      } else {
        setBadge(tabId, 0);
      }
    }
    function countRealTiles(body) {
      var n = 0;
      for (var i = 0; i < body.children.length; i++) {
        var c = body.children[i];
        if (c.classList && c.classList.contains('bn-tab-placeholder-card')) continue;
        n++;
      }
      return n;
    }
    function readSeenCount(tabId) {
      try { return parseInt(localStorage.getItem('bloom_tab_seen_' + tabId) || '0', 10) || 0; }
      catch (e) { return 0; }
    }
    function snapshotSeenCount(tabId) {
      var body = document.getElementById('tab-' + tabId + '-body');
      if (!body) return;
      var realTiles = countRealTiles(body);
      try { localStorage.setItem('bloom_tab_seen_' + tabId, String(realTiles)); } catch (e) {}
    }
    function refreshAllBadges() {
      ['rewards', 'social', 'progress', 'shop'].forEach(function(id) {
        updateTabBadge(id);
      });
    }

    // ────────────────────────────────────────────────────────────
    // OBSERVER: watch home-screen for tile mounts
    // ────────────────────────────────────────────────────────────
    function checkAndMigrate(node) {
      if (!node || node.nodeType !== 1) return;
      // Direct match on the added node itself.
      var sels = Object.keys(TILE_TO_TAB);
      for (var i = 0; i < sels.length; i++) {
        var sel = sels[i];
        try {
          if (node.matches && node.matches(sel)) {
            moveTileToTab(node, TILE_TO_TAB[sel]);
            return; // matched + moved, no need to check descendants
          }
        } catch (e) {}
      }
      // Descendant match (node is a wrapper, real tile is inside).
      for (var j = 0; j < sels.length; j++) {
        var sel2 = sels[j];
        try {
          var inner = node.querySelector && node.querySelector(sel2);
          if (inner) moveTileToTab(inner, TILE_TO_TAB[sel2]);
        } catch (e) {}
      }
    }

    function attachObserver() {
      var home = document.getElementById('home-screen');
      if (!home) return;
      if (_observer) {
        try { _observer.disconnect(); } catch (e) {}
      }
      _observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          for (var i = 0; i < m.addedNodes.length; i++) {
            checkAndMigrate(m.addedNodes[i]);
          }
        });
      });
      _observer.observe(home, { childList: true, subtree: true });
      // One-time scan for tiles that already exist (mounted before
      // observer attached). Covers the race where boot fires showHomeV2
      // synchronously and some tiles mount before our setTimeout-deferred
      // mountBottomNav runs.
      scanAndMigrateExisting();
    }

    function scanAndMigrateExisting() {
      var home = document.getElementById('home-screen');
      if (!home) return;
      Object.keys(TILE_TO_TAB).forEach(function(sel) {
        if (TILE_TO_TAB[sel] === 'home') return;
        var els = home.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
          moveTileToTab(els[i], TILE_TO_TAB[sel]);
        }
      });
    }

    // ────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ────────────────────────────────────────────────────────────
    function mountBottomNav() {
      if (_navEl) return; // already mounted
      _activeTab = loadActiveTab();

      // 1. Build + mount the nav bar at the bottom.
      _navEl = buildNav();
      document.body.appendChild(_navEl);
      document.body.setAttribute('data-active-tab', _activeTab);

      // 2. Pre-create the 4 non-home tab screens (hidden until clicked).
      //    They live inside .app as siblings of #home-screen so the same
      //    "hide chrome when home-active" CSS applies.
      var app = document.querySelector('.app');
      var host = app || document.body;
      ['rewards', 'social', 'progress', 'shop'].forEach(function(id) {
        // Don't double-mount if a previous showHomeV2 cycle left them.
        var existing = document.getElementById('tab-' + id + '-screen');
        if (existing) { existing.remove(); }
        var screen = buildTabShell(id);
        host.appendChild(screen);
        _tabScreens[id] = screen;
      });

      // 3. Attach MutationObserver to home-screen so late-mounting
      //    tiles get caught + routed.
      attachObserver();

      // 4. Render placeholder cards for tabs that currently have NO
      //    tiles (so the user sees a friendly empty state on first
      //    visit instead of a blank screen). Placeholders auto-remove
      //    when a real tile arrives via moveTileToTab.
      ['rewards', 'social', 'progress', 'shop'].forEach(function(id) {
        ensurePlaceholderIfEmpty(id);
      });

      // 5. If persisted active tab isn't home, show that screen.
      if (_activeTab !== 'home') {
        // Hide home, show the saved active tab's screen.
        setTimeout(function() {
          var home = document.getElementById('home-screen');
          if (home) home.style.display = 'none';
          var screen = _tabScreens[_activeTab];
          if (screen) screen.style.display = '';
        }, 50);
      }

      // 6. Refresh badges periodically as late-mounting tiles arrive.
      //    Most maybeShow* fire 400-3000ms. Final refresh at 3500ms.
      [600, 1500, 2500, 3500, 5000].forEach(function(ms) {
        setTimeout(refreshAllBadges, ms);
      });

      // 7. One-time onboarding hint pointing to the tabs. Shows ONCE
      //    per device for returning players who used the old layout
      //    and might think features disappeared.
      maybeShowFirstTimeTabsTip();
    }

    function maybeShowFirstTimeTabsTip() {
      try {
        if (localStorage.getItem('bloom_tabs_tip_seen') === '1') return;
        // Only show for players with prior history (the ones who used
        // the old layout). Fresh accounts see the new layout natively.
        var games = parseInt(localStorage.getItem('bloom_games_played') || '0', 10) | 0;
        if (games < 1) return;
        setTimeout(function() {
          // After a moment, check if any tabs got tiles. Only worth
          // showing the tip if there's something to discover.
          var nonEmpty = 0;
          ['rewards','social','progress','shop'].forEach(function(id) {
            var body = document.getElementById('tab-' + id + '-body');
            if (body && countRealTiles(body) > 0) nonEmpty++;
          });
          if (nonEmpty === 0) return;
          showTabsTipBanner();
          try { localStorage.setItem('bloom_tabs_tip_seen', '1'); } catch (e) {}
        }, 3800);
      } catch (e) {}
    }

    function showTabsTipBanner() {
      if (document.getElementById('bn-tabs-tip')) return;
      var b = document.createElement('div');
      b.id = 'bn-tabs-tip';
      b.className = 'bn-tabs-tip';
      b.setAttribute('role', 'status');
      var icon = document.createElement('span');
      icon.className = 'bn-tabs-tip-icon';
      icon.textContent = '👇';
      var text = document.createElement('span');
      text.className = 'bn-tabs-tip-text';
      text.textContent = 'הפיצ׳רים שלך מסודרים בטאבים — לחץ כל אייקון למטה לגלות';
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'bn-tabs-tip-close';
      close.setAttribute('aria-label', 'סגור');
      close.textContent = '✕';
      close.onclick = function() { try { b.remove(); } catch (_) {} };
      b.appendChild(icon);
      b.appendChild(text);
      b.appendChild(close);
      document.body.appendChild(b);
      setTimeout(function() { try { b.remove(); } catch (_) {} }, 8000);
    }

    function unmountBottomNav() {
      if (_navEl) {
        try { _navEl.remove(); } catch (e) {}
        _navEl = null;
      }
      if (_observer) {
        try { _observer.disconnect(); } catch (e) {}
        _observer = null;
      }
      // Tear down tab screens — they'll be rebuilt on next mount.
      Object.keys(_tabScreens).forEach(function(id) {
        var el = _tabScreens[id];
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      _tabScreens = {};
      document.body.removeAttribute('data-active-tab');
    }

    function ensurePlaceholderIfEmpty(id) {
      var screen = _tabScreens[id] || document.getElementById('tab-' + id + '-screen');
      if (!screen) return;
      var body = screen.querySelector('.bn-tab-screen-body');
      if (!body) return;
      if (body.children.length > 0) return; // tiles already there
      if (body.querySelector('.bn-tab-placeholder-card')) return; // already placeheld
      body.appendChild(buildPlaceholderCard(id));
    }

    // ────────────────────────────────────────────────────────────
    // TAB SWITCHING
    // ────────────────────────────────────────────────────────────
    function goToTab(id) {
      if (!TABS.some(function(t) { return t.id === id; })) return;
      if (_activeTab === id) return;
      _activeTab = id;
      saveActiveTab(id);
      document.body.setAttribute('data-active-tab', id);
      // Update nav button states.
      if (_navEl) {
        _navEl.querySelectorAll('.bn-tab').forEach(function(btn) {
          var isActive = btn.getAttribute('data-tab') === id;
          btn.classList.toggle('bn-tab-active', isActive);
          btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
      }
      // Toggle visibility: hide all + show target.
      var home = document.getElementById('home-screen');
      if (home) home.style.display = (id === 'home') ? '' : 'none';
      Object.keys(_tabScreens).forEach(function(tid) {
        var s = _tabScreens[tid];
        if (s) s.style.display = (tid === id) ? '' : 'none';
      });
      // Re-ensure placeholder (in case tiles got migrated out somehow).
      if (id !== 'home') ensurePlaceholderIfEmpty(id);
      // User saw this tab → snapshot seen count + clear badge.
      if (id !== 'home') {
        snapshotSeenCount(id);
        setBadge(id, 0);
      }
      // Sound feedback.
      try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
    }

    // ────────────────────────────────────────────────────────────
    // BADGE
    // ────────────────────────────────────────────────────────────
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
    // LEGACY HOOK — Power Hero used to push its mapping here. Now a
    // no-op (we own the mapping). Kept exposed so older code paths
    // that call it don't break.
    // ────────────────────────────────────────────────────────────
    function migrateTilesToTabs() {
      // Triggered by Power Hero. We don't need the args anymore —
      // observer handles all routing. Just do a fresh scan as a
      // safety net in case any tiles slipped through.
      scanAndMigrateExisting();
    }

    // ────────────────────────────────────────────────────────────
    // Exports
    // ────────────────────────────────────────────────────────────
    window.__bloomMountBottomNav     = mountBottomNav;
    window.__bloomUnmountBottomNav   = unmountBottomNav;
    window.__bloomGoToTab            = goToTab;
    window.__bloomSetTabBadge        = setBadge;
    window.__bloomGetActiveTab       = function() { return _activeTab; };
    window.__bloomMigrateTilesToTabs = migrateTilesToTabs;
    // Debug helpers.
    window.__bloomBNDebug = function() {
      return {
        activeTab: _activeTab,
        observerAttached: !!_observer,
        tabScreens: Object.keys(_tabScreens),
        knownSelectors: Object.keys(TILE_TO_TAB).length
      };
    };
  })();
