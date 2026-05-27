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
      if (existing) {
        existing.style.display = '';
        return;
      }
      // First-time mount → build placeholder. B2-B5 will replace these
      // with real content for each respective tab.
      var screen = buildPlaceholderTab(id);
      screen.id = screenId;
      var app = document.querySelector('.app');
      if (app) app.appendChild(screen);
      else document.body.appendChild(screen);
    }

    function buildPlaceholderTab(id) {
      var tab = TABS.find(function(t) { return t.id === id; });
      var screen = document.createElement('div');
      screen.className = 'bn-tab-screen';
      screen.setAttribute('data-tab-id', id);

      var header = document.createElement('div');
      header.className = 'bn-tab-screen-header';
      var titleEl = document.createElement('div');
      titleEl.className = 'bn-tab-screen-title';
      titleEl.textContent = (tab ? tab.icon + ' ' + tab.label : id);
      header.appendChild(titleEl);

      var card = document.createElement('div');
      card.className = 'bn-tab-placeholder-card';
      var cardIcon = document.createElement('div');
      cardIcon.className = 'bn-tab-placeholder-icon';
      cardIcon.textContent = tab ? tab.icon : '✨';
      var cardTitle = document.createElement('div');
      cardTitle.className = 'bn-tab-placeholder-title';
      cardTitle.textContent = placeholderTitle(id);
      var cardSub = document.createElement('div');
      cardSub.className = 'bn-tab-placeholder-sub';
      cardSub.textContent = placeholderSub(id);
      card.appendChild(cardIcon);
      card.appendChild(cardTitle);
      card.appendChild(cardSub);

      screen.appendChild(header);
      screen.appendChild(card);
      return screen;
    }

    function placeholderTitle(id) {
      switch (id) {
        case 'rewards':  return 'פרסים יומיים — בקרוב';
        case 'social':   return 'קהילה — בקרוב';
        case 'progress': return 'דרגות — בקרוב';
        case 'shop':     return 'חנות — בקרוב';
      }
      return 'בקרוב';
    }
    function placeholderSub(id) {
      switch (id) {
        case 'rewards':  return 'לוח כניסה / גלגל יומי / משימות / דילים / Battle Pass';
        case 'social':   return 'דו-קרב חי / יריבים / חברים / קלאן / מלחמות / טורנירים';
        case 'progress': return 'גביעים / ליגה / פרסטיג׳ / הישגים / אלבום / Wrapped';
        case 'shop':     return 'סקינים / גצ׳ה / בנק / בוסטרים';
      }
      return '';
    }

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
  })();
