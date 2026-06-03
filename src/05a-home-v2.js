  // ============================================================
  // Home v2 — second-generation home screen (HOME_AUDIT.md)
  // ============================================================
  // Built side-by-side with the legacy home in src/05-home.js. Both
  // versions live in the build and the player picks via URL param
  // (?home=v2 / ?home=v1) or the small toggle link at the bottom of
  // each layout. The choice persists in localStorage.bloom_home_v2.
  //
  // Once the user signs off, the delegation in src/05-home.js can
  // flip to default-v2 and the legacy home becomes the opt-out path.
  //
  // Coverage vs HOME_AUDIT.md tasks:
  //   A1 ✅  Personal hero banner (streak / best-score / urgency)
  //   A2 ✅  Live-pulse bar with tiered fallback — never disappears
  //   A3 ✅  WhatsApp invite demoted to a small bottom link
  //   A4 ✅  Player-ID across 3 readable lines
  //   B1 ✅  Notification badges on action buttons (duels + challenges)
  //   B2 ✅  Featured-action picker by activity state
  //   B3 ⏭   Stats-bubble affordance (deferred — bubble already exists)
  //   C1 ⏭   Animated brand mark (deferred — would need new assets)
  //   C2 ⏭   "What's new" banner (deferred)
  //   C3 ✅  safe-area-inset-bottom on the bottom padding
  // ============================================================

  // v2 is now the canonical home. v1 stays available as opt-out via
  // ?home=v1 or the toggle inside v2 — useful for screenshot diffs +
  // a quick rollback if something visual regresses on a player's setup.
  const HOME_V1_FORCE_KEY = 'bloom_home_v1_force';
  const HOME_V2_KEY = 'bloom_home_v2'; // legacy — read-only for migration
  // One-shot migration: clear the v3 opt-in flag for anyone who had it
  // set when we rolled v3 back. Runs once per page load — cheap.
  try { localStorage.removeItem('bloom_home_v3'); } catch (e) {}

  function homeV2Enabled() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('home');
      if (v === 'v1') { localStorage.setItem(HOME_V1_FORCE_KEY, '1'); return false; }
      if (v === 'v2') { localStorage.removeItem(HOME_V1_FORCE_KEY); return true; }
      // No URL param: v2 is default unless v1 was explicitly forced.
      return localStorage.getItem(HOME_V1_FORCE_KEY) !== '1';
    } catch (e) { return true; }
  }

  function enableHomeV2() {
    try { localStorage.removeItem(HOME_V1_FORCE_KEY); } catch (e) {}
  }
  function disableHomeV2() {
    try { localStorage.setItem(HOME_V1_FORCE_KEY, '1'); } catch (e) {}
  }

  function showHomeV2() {
    stopEventSystem();
    if (typeof purgeEventOverlays === 'function') purgeEventOverlays();
    // H1 fix (silent-failure-hunter audit): kill leaked celebration
    // banners from the previous in-game session so they don't float
    // over the home screen during their TTL. LF.1 crown card has
    // pointer-events:auto + a share button — tappable from home.
    if (typeof clearTransientBanners === 'function') clearTransientBanners();
    try {
      ['multi-merge', 'massive-merge-flash', 'chain-legendary', 'chain-legendary-text', 'clutch-save', 'lifetime-first', 'lifetime-first-card', 'lifetime-chain-pill']
        .forEach(function(tag) {
          var els = document.querySelectorAll('[data-bloom-banner="' + tag + '"]');
          els.forEach(function(el) { try { el.remove(); } catch (e) {} });
        });
      document.querySelectorAll('.lifetime-first-card, .clutch-save-banner').forEach(function(el) {
        try { el.remove(); } catch (e) {}
      });
    } catch (e) {}
    // TB.1 — strip is fixed-position on body, so it would float over the
    // home screen until the next game starts. Tear down explicitly here.
    try {
      var __bsHome = document.getElementById('booster-strip');
      if (__bsHome) __bsHome.remove();
    } catch (e) {}
    // Going home = leaving any dynamic-board session. Next game starts vanilla.
    if (typeof clearDynamicBoardSession === 'function') clearDynamicBoardSession();
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    // Mark the app so CSS can hide the game UI behind the home overlay.
    app.setAttribute('data-home', 'active');
    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen home-v2';

    h.innerHTML =
      // ── Top bar: mute + always-visible social proof (§A2) ──
      '<div class="home-v2-topbar">' +
        '<button class="home-v2-mute" id="home-mute" aria-label="השתק">' +
          '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
        '</button>' +
        // Bug #19 — hidden until the first /api/stats/live resolves, so the
        // player never sees a "טוען…" flash (matches v1 behavior). The pulse
        // refresher reveals it via wrap.style.display='' once data lands.
        '<div class="home-v2-live-pulse" id="home-v2-live-pulse" style="display:none">' +
          '<span class="home-v2-live-dot"></span>' +
          '<span class="home-v2-live-text" id="home-v2-live-text">טוען…</span>' +
        '</div>' +
      '</div>' +

      // ── Balance Widget (T1.3) ─────────────────────────────────────
      // Always-on at-a-glance status: gems / lives / streak / level.
      // Match Masters / Royal Match keep these visible permanently —
      // makes the player feel "I have something" → encourages spending.
      // Lives slot hidden when admin disabled the lives system.
      '<div class="home-v2-balance-bar" id="home-v2-balance-bar">' +
        // UX audit 2026-06-02: these were dead <div>s. Now <button>s that
        // open the gem bank / lives refill — the most-viewed widget is now
        // a 1-tap entry into its system instead of a dead-end.
        '<button class="home-v2-bal-slot home-v2-bal-gems" id="home-v2-bal-gems-slot" title="יתרת יהלומים — לחץ לבנק" type="button">' +
          '<span class="home-v2-bal-icon">💎</span>' +
          '<span class="home-v2-bal-val" id="home-v2-bal-gems">--</span>' +
        '</button>' +
        '<button class="home-v2-bal-slot home-v2-bal-lives" id="home-v2-bal-lives-slot" style="display:none" title="חיים — לחץ למילוי" type="button">' +
          '<span class="home-v2-bal-icon">❤️</span>' +
          '<span class="home-v2-bal-val" id="home-v2-bal-lives">--</span>' +
        '</button>' +
        '<button class="home-v2-bal-slot home-v2-bal-streak" id="home-v2-bal-streak-slot" title="רצף ימים — לחץ ללוח שנה" type="button">' +
          '<span class="home-v2-bal-icon">🔥</span>' +
          '<span class="home-v2-bal-val" id="home-v2-bal-streak">--</span>' +
        '</button>' +
        '<button class="home-v2-bal-slot home-v2-bal-level" id="home-v2-bal-level-slot" title="דרגה — לחץ למפת הפיצ׳רים" type="button">' +
          '<span class="home-v2-bal-icon">⭐</span>' +
          '<span class="home-v2-bal-val" id="home-v2-bal-level">1</span>' +
        '</button>' +
      '</div>' +

      // ── Compact brand area ──
      '<div class="home-v2-brand-wrap">' +
        '<div class="home-icons home-v2-icons" id="home-icons-tap">' +
          '<div class="home-icon" style="background:#CECBF6;color:#26215C">' + SVG.crown + '</div>' +
          '<div class="home-icon" style="background:#9FE1CB;color:#04342C">' + SVG.star + '</div>' +
          '<div class="home-icon" style="background:#F5C4B3;color:#4A1B0C">' + SVG.flame + '</div>' +
          '<div class="home-icon" style="background:#F4C0D1;color:#4B1528">' + SVG.flower + '</div>' +
          '<div class="home-icon" style="background:#C0DD97;color:#173404">' + SVG.leaf + '</div>' +
        '</div>' +
        '<div class="home-v2-brand">BLOOM</div>' +
      '</div>' +

      // ── Personal hero banner (§A1) — adaptive ──
      '<div class="home-v2-hero" id="home-v2-hero"></div>' +

      // ── Player identity across 3 lines (§A4) ──
      '<div class="home-v2-pid" id="home-v2-pid"></div>' +

      // ── Primary CTA — bigger, with optional daily badge ──
      '<button class="home-v2-cta" id="home-v2-start">' +
        '<span class="home-v2-cta-label" id="home-v2-cta-label">🎮 שחק עכשיו</span>' +
        '<span class="home-v2-cta-sub" id="home-v2-cta-sub"></span>' +
      '</button>' +

      // ── Your week stats — single line, scannable ──
      '<div class="home-v2-mystats" id="home-v2-mystats"></div>' +

      // ── Featured action (§B2) — dynamic ──
      '<div class="home-v2-featured" id="home-v2-featured"></div>' +

      // ── Secondary actions grid 2x2 with badges (§B1) ──
      // T1.1 — each button carries data-min-level so applyLevelGates
      // hides it until the player crosses the threshold. Contest=L5,
      // Skins=L8, Duel=L10, Challenges=L5 (single grid stays clean).
      '<div class="home-v2-actions" data-actions-row>' +
        '<button class="home-v2-action" id="home-v2-contest" data-action="contest" data-min-level="5">' +
          '<span class="home-v2-badge" id="home-v2-contest-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">👥</span>' +
          '<span class="home-v2-action-label">תחרות</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-challenge" data-action="challenge" data-min-level="5">' +
          '<span class="home-v2-badge home-v2-badge-prize" id="home-v2-challenge-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">🏆</span>' +
          '<span class="home-v2-action-label">אתגרים</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-duel" data-action="duel" data-min-level="10">' +
          '<span class="home-v2-badge" id="home-v2-duel-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">⚔️</span>' +
          '<span class="home-v2-action-label">דו-קרב</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-skins" data-action="skins" data-min-level="8">' +
          '<span class="home-v2-action-icon">🎨</span>' +
          '<span class="home-v2-action-label">סקינים</span>' +
        '</button>' +
      '</div>' +

      // ── Dynamic Boards entry — only visible when boards are available.
      // Hidden by default; updateDynamicBoardsButton() flips display
      // after the /api/boards/available fetch resolves.
      '<button class="home-v2-boards" id="home-v2-boards" style="display:none">' +
        '<span class="home-v2-boards-icon">🎯</span>' +
        '<span class="home-v2-boards-text">' +
          '<span class="home-v2-boards-title">לוחות דינמיים</span>' +
          '<span class="home-v2-boards-count">לוחות זמינים</span>' +
        '</span>' +
        '<span class="home-v2-boards-arrow">›</span>' +
      '</button>' +

      // ── T6.4 — Skeleton grid: 4 placeholder cards visible immediately
      // while the deferred maybeShow* tile mounts (400-3200ms) settle.
      // Each placeholder card has a CSS shimmer. The whole grid fades
      // out at 3500ms (after all maybeShow* have had their chance).
      '<div class="home-skeleton-grid" id="home-skeleton-grid">' +
        '<div class="home-skel-card"><span class="home-skel-shimmer"></span></div>' +
        '<div class="home-skel-card"><span class="home-skel-shimmer"></span></div>' +
        '<div class="home-skel-card"><span class="home-skel-shimmer"></span></div>' +
        '<div class="home-skel-card"><span class="home-skel-shimmer"></span></div>' +
      '</div>' +

      // ── Battle Pass entry — primary visibility for the Season Pass.
      // Until this commit the BP was only accessible via the dynamic-boards
      // picker — players who never opened it never saw the BP existed.
      // Hidden by default; updateHomeSeasonPassTile() flips display.
      // T1.1 — also level-gated (Season Pass = L12+).
      '<button class="home-v2-season-pass" id="home-v2-season-pass" style="display:none" data-min-level="12">' +
        '<span class="home-v2-sp-icon">🎖</span>' +
        '<span class="home-v2-sp-text">' +
          '<span class="home-v2-sp-title" id="home-v2-sp-title">Battle Pass</span>' +
          '<span class="home-v2-sp-progress">' +
            '<span class="home-v2-sp-bar"><span class="home-v2-sp-bar-fill" id="home-v2-sp-bar-fill" style="width:0%"></span></span>' +
            '<span class="home-v2-sp-meta" id="home-v2-sp-meta">טוען…</span>' +
          '</span>' +
        '</span>' +
        '<span class="home-v2-sp-claim" id="home-v2-sp-claim" style="display:none">0 🎁</span>' +
        '<span class="home-v2-boards-arrow">›</span>' +
      '</button>' +

      // ── Weekly + Jackpot (reuse v1 hosts so the existing refresh* helpers work as-is) ──
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +

      // ── Bottom links area ──
      // v3 "try it" link removed (rolled back per user feedback).
      '<div class="home-v2-bottom">' +
        (hasSeenTour()
          ? '<button class="home-v2-link" id="home-v2-tour">📖 איך משחקים?</button>'
          : '<button class="home-v2-link home-v2-link-skip" id="home-v2-skip">דלג על הסיור</button>') +
        '<button class="home-v2-link" id="home-v2-invite">📱 הזמן חבר</button>' +
        '<button class="home-v2-link home-v2-switch" id="home-v2-switch">↩ הגירסה הישנה</button>' +
        '<a class="home-v2-link" href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a>' +
      '</div>';

    app.appendChild(h);
    syncHomeMuteUI();

    // ── Wire up handlers ──
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      ensureAudio();
      openMuteMenu('home');
    };

    const enter = function() {
      ensureAudio();
      hideHomeV2();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      // TA.1 — fresh:true ensures a click on home's play button always
      // starts a NEW game rather than restoring the prior over screen
      // from the LAST_GAME_KEY snapshot.
      if (onOverScreen) init('practice', { fresh: true });
      playMusic('game');
      startEventSystem();
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };

    document.getElementById('home-v2-start').onclick = function() {
      ensureAudio();
      if (!hasSeenTour()) { showTour({ onDone: enter }); }
      else { enter(); }
    };

    document.getElementById('home-v2-contest').onclick = function() {
      ensureAudio();
      if (mode === 'practice') savePracticeGameState();
      showContestMenu();
    };
    document.getElementById('home-v2-challenge').onclick = function() {
      ensureAudio();
      if (typeof showChallengesList === 'function') showChallengesList('home-v2');
    };
    document.getElementById('home-v2-duel').onclick = function() {
      ensureAudio();
      if (typeof showDuelModal === 'function') showDuelModal();
    };
    document.getElementById('home-v2-skins').onclick = function() {
      if (typeof showSkinShop === 'function') showSkinShop();
    };
    document.getElementById('home-v2-boards').onclick = function() {
      ensureAudio();
      if (typeof showDynamicBoardsPicker === 'function') showDynamicBoardsPicker();
    };
    // Sync visibility immediately in case the boards-list was already loaded.
    if (typeof updateDynamicBoardsButton === 'function') updateDynamicBoardsButton();

    // Battle Pass tile — opens the Season Pass modal directly (skips the picker).
    var spBtn = document.getElementById('home-v2-season-pass');
    if (spBtn) {
      spBtn.onclick = function() {
        ensureAudio();
        if (typeof showSeasonPassModal === 'function') showSeasonPassModal();
      };
    }
    if (typeof updateHomeSeasonPassTile === 'function') updateHomeSeasonPassTile();

    // FD.1 — Feature Discovery Map. Tile + next-unlock banner mount
    // at the TOP of the home content area (smallest setTimeout) so a
    // returning veteran sees the level-progress front-and-center, and
    // a new player understands what's coming. Both surfaces self-
    // remove at L20 (banner) / become "all unlocked" badge (tile).
    if (window.__bloomDiscovery) {
      setTimeout(function() {
        try { if (window.__bloomDiscovery.maybeMountTile) window.__bloomDiscovery.maybeMountTile(); } catch (e) {}
        try { if (window.__bloomDiscovery.maybeMountNextUnlock) window.__bloomDiscovery.maybeMountNextUnlock(); } catch (e) {}
      }, 200);
    }

    // Stage 20 — Starter Pack offer check. Throttled to 1/min internally.
    if (typeof maybeOfferStarterPack === 'function') {
      // Defer slightly so the home shell mounts first.
      setTimeout(function() { try { maybeOfferStarterPack(); } catch (e) {} }, 800);
    }

    // Stage 21 — Daily Deals banner. Slight delay so starter-pack lands first
    // (Starter Pack takes priority since it's one-time + first-purchase).
    if (typeof maybeShowDailyDealBanner === 'function') {
      setTimeout(function() { try { maybeShowDailyDealBanner(); } catch (e) {} }, 1200);
    }

    // Stage 18 — Skin Gacha banner. Last in priority chain — gacha is
    // always-available so it doesn't out-rank time-limited surfaces.
    if (typeof maybeShowGachaBanner === 'function') {
      setTimeout(function() { try { maybeShowGachaBanner(); } catch (e) {} }, 1600);
    }

    // Stage 19 — Lives widget (only mounts when admin enabled the system).
    if (typeof maybeShowLivesWidget === 'function') {
      setTimeout(function() { try { maybeShowLivesWidget(); } catch (e) {} }, 400);
    }

    // AD.5 — win-return celebration. When the player lands on home right after
    // a win (new personal best OR a high score), extend the victory dopamine
    // with confetti + sound + a brief banner. Once per game (sessionStorage
    // guard keyed on the snapshot gameId). Admin-gated by
    // home_win_celebration_enabled (default on).
    try { maybeWinReturnCelebration(); } catch (e) {}

    // Stage 26 — Daily Checklist tile. Mounts near top so it's the
    // first thing the player sees after the lives widget.
    if (typeof maybeShowChecklistTile === 'function') {
      setTimeout(function() { try { maybeShowChecklistTile(); } catch (e) {} }, 600);
    }

    // Stage 28 — Pet widget. Mounts between lives + checklist so the
    // pet is visible but doesn't out-rank the to-do list.
    if (typeof maybeShowPetWidget === 'function') {
      setTimeout(function() { try { maybeShowPetWidget(); } catch (e) {} }, 700);
    }

    // Stage 25 — Limited-time Bundles. Appended at the END of home
    // (lower priority than time-critical surfaces like starter/daily-deal).
    if (typeof maybeShowBundleBanners === 'function') {
      setTimeout(function() { try { maybeShowBundleBanners(); } catch (e) {} }, 1800);
    }

    // Stage 16 — Achievement-driven Cross-Leaderboard tile.
    // Syncs localStorage achievements to server + mounts tile if 3+ unlocked.
    if (typeof maybeShowAchLbTile === 'function') {
      setTimeout(function() { try { maybeShowAchLbTile(); } catch (e) {} }, 2000);
    }

    // Stage 29 — Tile Collection Album tile.
    if (typeof maybeShowAlbumTile === 'function') {
      setTimeout(function() { try { maybeShowAlbumTile(); } catch (e) {} }, 2200);
    }

    // Stage 30 — Lifetime Progression tile (Prestige).
    if (typeof maybeShowLifetimeTile === 'function') {
      setTimeout(function() { try { maybeShowLifetimeTile(); } catch (e) {} }, 2400);
    }

    // Stage 27 — Guild tile (clan with daily goal).
    if (typeof maybeShowGuildTile === 'function') {
      setTimeout(function() { try { maybeShowGuildTile(); } catch (e) {} }, 2600);
    }

    // Stage 33 — Rival tile (auto-paired 24h personal competition).
    if (typeof maybeShowRivalTile === 'function') {
      setTimeout(function() { try { maybeShowRivalTile(); } catch (e) {} }, 2800);
    }

    // Stage 34 — Weekly League tile.
    if (typeof maybeShowLeagueTile === 'function') {
      setTimeout(function() { try { maybeShowLeagueTile(); } catch (e) {} }, 3000);
    }

    // Stage 36 — Daily Spin Wheel tile.
    if (typeof maybeShowSpinTile === 'function') {
      setTimeout(function() { try { maybeShowSpinTile(); } catch (e) {} }, 500);
    }

    // Stage 37 — Guild Wars tile (only mounts if in guild + active war OR unclaimed reward).
    if (typeof maybeShowWarTile === 'function') {
      setTimeout(function() { try { maybeShowWarTile(); } catch (e) {} }, 3200);
    }

    // Stage 38 — Trophy Road tile (always visible — universal progression).
    if (typeof maybeShowTrophyTile === 'function') {
      setTimeout(function() { try { maybeShowTrophyTile(); } catch (e) {} }, 450);
    }

    // A3 — Trophy Chests tile (mounts only when chests exist; level-gated L10).
    if (window.__bloomChests && typeof window.__bloomChests.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomChests.maybeShow(); } catch (e) {} }, 500);
    }

    // A7 — 7-Day Login Calendar tile (L5+, always shown for engagement).
    if (window.__bloomLoginCal && typeof window.__bloomLoginCal.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomLoginCal.maybeShow(); } catch (e) {} }, 550);
    }

    // A10 — Compound Interest Gem Bank tile (L8+, always shown).
    if (window.__bloomBank && typeof window.__bloomBank.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomBank.maybeShow(); } catch (e) {} }, 600);
    }

    // A8 — Squad Tournaments tile (L15+, only when guild is in active tournament).
    if (window.__bloomSquad && typeof window.__bloomSquad.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomSquad.maybeShow(); } catch (e) {} }, 650);
    }

    // A9 — Ghost Mode tile (L8+, always shown for L8+ players).
    if (window.__bloomGhostMode && typeof window.__bloomGhostMode.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomGhostMode.maybeShow(); } catch (e) {} }, 700);
    }

    // Task #19 — "your friends are here" social-proof banner (L5+).
    if (window.__bloomFriendsBanner && typeof window.__bloomFriendsBanner.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomFriendsBanner.maybeShow(); } catch (e) {} }, 750);
    }

    // Tier-icons tap → reveal stats bubble (same behaviour as v1)
    var iconsTap = document.getElementById('home-icons-tap');
    if (iconsTap) {
      iconsTap.style.cursor = 'pointer';
      iconsTap.onclick = function() {
        // For v2 the bubble lives in the hero area — show a transient toast instead.
        try { if (window.__bloomToast) window.__bloomToast(buildPlayerHistoryToast(), 'info'); } catch (e) {}
      };
    }

    // Bottom links
    var tourBtn = document.getElementById('home-v2-tour');
    if (tourBtn) tourBtn.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    var skipBtn = document.getElementById('home-v2-skip');
    if (skipBtn) skipBtn.onclick = enter;
    var inviteBtn = document.getElementById('home-v2-invite');
    if (inviteBtn) inviteBtn.onclick = function(e) {
      e.stopPropagation();
      whatsappInviteV2();
    };
    var switchBtn = document.getElementById('home-v2-switch');
    if (switchBtn) switchBtn.onclick = function() {
      disableHomeV2();
      hideHomeV2();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('home');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
      showHome(); // v1 fallback
    };
    // v3 "try it" handler removed (button no longer rendered).

    // ── Populate dynamic sections ──
    renderHeroBannerV2();
    renderPlayerIdV2();
    renderMyStatsV2();
    renderBalanceBarV2();        // T1.3 — gems/lives/streak/level top widget
    refreshHomeV2LivePulse();
    refreshHomeV2Badges();
    refreshFeaturedActionV2();
    refreshHomeChallengeCta();    // reuses v1 helper — paints the challenge button label
    refreshHomeJackpot();
    refreshHomeWeekly();
    startHomeV2LivePulse();

    // T2.2 — Streak slot opens the streak calendar modal.
    var streakSlot = document.getElementById('home-v2-bal-streak-slot');
    if (streakSlot) streakSlot.onclick = function() {
      ensureAudio();
      if (typeof window.__bloomShowStreakCal === 'function') window.__bloomShowStreakCal();
    };
    // UX audit 2026-06-02 — the other 3 balance slots were dead. Each is now
    // a 1-tap entry into its system (the most-viewed widget = a funnel, not
    // a dead-end). Defensive: only wire when the target module is loaded.
    var gemsSlot = document.getElementById('home-v2-bal-gems-slot');
    if (gemsSlot) gemsSlot.onclick = function() {
      ensureAudio();
      if (window.__bloomBank && typeof window.__bloomBank.open === 'function') window.__bloomBank.open();
      else if (typeof showShop === 'function') showShop();
    };
    var livesSlot2 = document.getElementById('home-v2-bal-lives-slot');
    if (livesSlot2) livesSlot2.onclick = function() {
      ensureAudio();
      if (typeof window.showLivesRefillModal === 'function') window.showLivesRefillModal();
    };
    var levelSlot = document.getElementById('home-v2-bal-level-slot');
    if (levelSlot) levelSlot.onclick = function() {
      ensureAudio();
      if (window.__bloomDiscovery && typeof window.__bloomDiscovery.showModal === 'function') window.__bloomDiscovery.showModal();
    };
    // UX audit 2026-06-02 — fill the empty CTA subtitle (the strongest,
    // previously-unused hook on the most-tapped element).
    updateHomeCtaSubV2();

    // T1.1 — apply level gates initially (hides high-level tiles for
    // new players). Re-run on a few delays to catch tiles that mount
    // via setTimeout (matches Stage 35 home-variants' deferred apply
    // pattern). Last apply at 3.4s — after every maybeShow* has settled.
    if (typeof applyLevelGates === 'function') {
      try { applyLevelGates(h); } catch (e) {}
      [600, 1500, 2500, 3400].forEach(function(t) {
        setTimeout(function() {
          if (document.getElementById('home-screen') && typeof applyLevelGates === 'function') {
            try { applyLevelGates(); } catch (e) {}
          }
        }, t);
      });
    }
    // Boot-time unlock check — shows toast(s) if the player crossed
    // any thresholds since last visit (e.g. closed app at L4, comes
    // back after a server-side stat bump putting them at L8).
    if (typeof checkLevelUnlock === 'function') {
      setTimeout(function() {
        try { checkLevelUnlock(); } catch (e) {}
      }, 1800);
    }

    // T6.4 — fade out + remove the skeleton grid after all deferred
    // maybeShow* mounts have had a chance to settle (max delay is 3.2s).
    // Skeleton serves as the "loading" state for the addiction-stack
    // tiles that arrive asynchronously.
    setTimeout(function() {
      var sk = document.getElementById('home-skeleton-grid');
      if (sk) {
        sk.style.transition = 'opacity 0.4s ease-out';
        sk.style.opacity = '0';
        setTimeout(function() { try { sk.remove(); } catch (e) {} }, 450);
      }
    }, 3500);

    // T7.2 — Weekly events banner (Golden Hour MVP). Mounts a pulsing
    // gold banner under the balance bar with a live countdown when any
    // event is active. Re-fetch every 60s while home open.
    if (window.__bloomEvents && typeof window.__bloomEvents.maybeShow === 'function') {
      setTimeout(function() { try { window.__bloomEvents.maybeShow(); } catch (e) {} }, 400);
      setInterval(function() {
        if (!document.getElementById('home-screen')) return;
        if (window.__bloomEvents) try { window.__bloomEvents.refresh(); } catch (e) {}
      }, 60 * 1000);
    }

    // A4 — BLOOM Wrapped auto-fire on Sunday afternoon (per-week dedup).
    // The module gates itself on day-of-week + time-of-day; this is a
    // best-effort trigger that no-ops on every non-Sunday open.
    if (window.__bloomWrapped && typeof window.__bloomWrapped.maybeAutoShow === 'function') {
      setTimeout(function() { try { window.__bloomWrapped.maybeAutoShow(); } catch (e) {} }, 2200);
    }

    // T4.4 — Notification Inbox icon. Mounts the 🔔 button into the
    // topbar and kicks off the badge fetch. Re-refresh badge every
    // 90s while home is open so a duel that settled in the background
    // surfaces without requiring a navigation.
    if (window.__bloomInbox && typeof window.__bloomInbox.mount === 'function') {
      try { window.__bloomInbox.mount(); } catch (e) {}
      setInterval(function() {
        if (!document.getElementById('home-screen')) return;
        if (window.__bloomInbox && typeof window.__bloomInbox.refresh === 'function') {
          try { window.__bloomInbox.refresh(); } catch (e) {}
        }
      }, 90 * 1000);
    }

    playMusic('lobby');

    // Daily login reward — same delay as v1
    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    // Addiction triggers — checked after the daily login modal has had
    // a chance to render. Order matters: comeback wins over streak-danger
    // because comeback fires for absent players (more urgent re-engage).
    setTimeout(function() {
      if (!document.getElementById('home-screen')) return;
      if (typeof maybeShowComebackBonus === 'function') {
        if (maybeShowComebackBonus()) return; // showed comeback, skip streak-danger
      }
      if (typeof maybeShowStreakDangerBanner === 'function') maybeShowStreakDangerBanner();
    }, 1200);

    // Gift inbox poll — single fetch on home open. Recipient sees a
    // banner for any unseen player-to-player gifts. The server marks
    // them seen on read so we never re-toast the same gift.
    setTimeout(function() {
      if (typeof pollGiftInbox === 'function') pollGiftInbox();
    }, 1500);

    // Deep-link from referral-join push notification — when the player
    // taps "🎁 חבר חדש הצטרף בזכותך!" the URL becomes /?referrals=open
    // and we want to land them straight in the referrals modal.
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('referrals') === 'open') {
        setTimeout(function() {
          if (typeof showReferralsModal === 'function') showReferralsModal();
        }, 800);
      }
    } catch (e) {}

    // Auto-tour for first-time visitors (mirrors v1 behaviour)
    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }

    // Stage 35 — Home variant decorator. After all the deferred tile
    // mounts have settled (3.2s max delay), reorganize the layout per
    // the admin-selected variant. 'standard' is no-op so v2 stays as-is.
    if (typeof applyHomeVariant === 'function') {
      try { applyHomeVariant(); } catch (e) { console.error('[home-variant]', e); }
    }

    // Stage B0 — Bottom Nav mount. Adds the persistent 5-tab navigation
    // bar to the bottom of the viewport. Lifecycle is tied to home —
    // mount on showHomeV2, unmount on hideHomeV2 (so the game screen
    // doesn't have a stray nav at the bottom). Deferred to next macrotask
    // because 46-bottom-nav.js is concatenated AFTER 05a-home-v2.js,
    // so on the FIRST boot showHomeV2 fires before the bottom-nav
    // module has assigned its window.* exports — same trap as the
    // FTUE TDZ bug. setTimeout(0) waits for IIFE eval to complete.
    setTimeout(function() {
      if (typeof window.__bloomMountBottomNav === 'function') {
        try { window.__bloomMountBottomNav(); } catch (e) { console.error('[bottom-nav]', e); }
      }
    }, 0);
  }

  function hideHomeV2() {
    stopHomeV2LivePulse();
    // Stop the dynamic-boards FOMO tick so we don't keep updating a
    // detached DOM node every minute.
    if (typeof window.stopDynamicBoardsTick === 'function') window.stopDynamicBoardsTick();
    // B0 — tear down the bottom nav too.
    if (typeof window.__bloomUnmountBottomNav === 'function') {
      try { window.__bloomUnmountBottomNav(); } catch (e) {}
    }
    const h = document.getElementById('home-screen');
    if (h) h.remove();
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('data-home');
  }

  // ============================================================
  // ADDICTION TRIGGERS — streak danger / comeback / gift inbox
  // ============================================================

  // §Streak danger — fires once per evening when a player with a real
  // streak (≥3 days) opens the app late and HASN'T played today yet.
  // The point isn't to punish, it's to give the player a clear "you
  // worked for this, don't lose it" reminder when the loss window is
  // closing. Persists a "dismissed for today" flag so a player who
  // saw the banner already isn't re-nagged on every navigation.
  function maybeShowStreakDangerBanner() {
    try {
      if (typeof loadStreak !== 'function') return;
      const s = loadStreak();
      if (!s || (s.count | 0) < 3) return;
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (!today) return;
      const playedToday = !!localStorage.getItem(DAILY_PLAYED_PREFIX + today);
      if (playedToday) return;
      // Israel local time check
      const israelNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
      const hour = israelNow.getHours();
      if (hour < 19) return; // only after 19:00 IL
      // Dismissed-today guard so we don't re-fire on every home re-render
      const dismissKey = 'bloom_streak_danger_dismissed:' + today;
      if (localStorage.getItem(dismissKey)) return;
      const hoursLeft = 24 - hour;
      const minutesLeft = 60 - israelNow.getMinutes();
      const timeText = hoursLeft > 1
        ? hoursLeft + ' שעות'
        : (minutesLeft + ' דקות');
      const banner = document.createElement('div');
      banner.id = 'streak-danger-banner';
      banner.style.cssText =
        'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
        'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
        'z-index:9999;background:linear-gradient(135deg,#FF6B6B,#FAC775);' +
        'border-radius:14px;padding:12px 18px;direction:rtl;' +
        'font-family:inherit;font-size:13px;color:#1C1A18;font-weight:700;' +
        'box-shadow:0 8px 24px rgba(255,107,107,0.35);cursor:pointer;' +
        'max-width:340px;width:calc(100vw - 32px);';
      banner.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="font-size:28px">🔥</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:900;font-size:14px">רצף ' + (s.count | 0) + ' ימים בסכנה!</div>' +
            '<div style="font-size:11px;opacity:0.85;margin-top:2px" id="streak-danger-countdown">נשארו ' + timeText + '</div>' +
          '</div>' +
          '<button id="streak-danger-play" style="background:#1C1A18;color:#FAC775;border:none;padding:8px 12px;border-radius:10px;font-weight:800;font-family:inherit;font-size:13px;cursor:pointer">🎮 שחק</button>' +
          '<div id="streak-danger-x" style="font-size:14px;opacity:0.7;cursor:pointer;padding:4px 6px">✕</div>' +
        '</div>';
      document.body.appendChild(banner);
      requestAnimationFrame(function() {
        banner.style.opacity = '1';
        banner.style.transform = 'translateX(-50%) translateY(0)';
      });
      // T2.4 — Live countdown ticker. Re-paints the "נשארו N" text every
      // 60s so a player who lingers on home sees the urgency climb. Auto-
      // teardown when the banner is removed (no zombie interval).
      let countdownTimer = null;
      const repaintCountdown = function() {
        const cdEl = document.getElementById('streak-danger-countdown');
        if (!cdEl) { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
        const hLeft = 23 - now.getHours();
        const mLeft = 60 - now.getMinutes();
        const text = hLeft >= 2
          ? hLeft + ' שעות'
          : (hLeft === 1 ? ('שעה ו-' + mLeft + ' דקות') : (mLeft + ' דקות'));
        cdEl.textContent = 'נשארו ' + text + ' עד חצות';
      };
      countdownTimer = setInterval(repaintCountdown, 60 * 1000);
      repaintCountdown(); // initial paint for accuracy
      const dismiss = function() {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(function() { try { banner.remove(); } catch (e) {} }, 250);
        try { localStorage.setItem(dismissKey, '1'); } catch (e) {}
      };
      const playNow = function() {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        try { banner.remove(); } catch (e) {}
        try { localStorage.setItem(dismissKey, '1'); } catch (e) {}
        hideHomeV2();
        if (typeof init === 'function') init('daily');
      };
      banner.onclick = function(e) {
        if (!e.target) { playNow(); return; }
        const id = e.target.id || '';
        if (id === 'streak-danger-x') { dismiss(); return; }
        playNow();
      };
      // No auto-hide — banner stays until the player explicitly dismisses
      // or taps "play". Loss-aversion works better when the warning persists.
    } catch (e) { /* never throw from a notification path */ }
  }

  // §Comeback bonus — fires when the player returns after a ≥2-day
  // absence. Server enforces the actual reward amount via the new
  // 'comeback' earn action; the client only requests it. Tracks
  // last_play_date locally so we know how long they were away.
  const LAST_PLAY_KEY = 'bloom_last_play_date';
  function recordLastPlayDate() {
    try {
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (today) localStorage.setItem(LAST_PLAY_KEY, today);
    } catch (e) {}
  }
  try { window.__bloomRecordLastPlay = recordLastPlayDate; } catch (e) {}

  function maybeShowComebackBonus() {
    try {
      const lastPlay = localStorage.getItem(LAST_PLAY_KEY);
      if (!lastPlay) {
        // First time we have this signal — seed it and skip (we don't
        // know how long they were away). Will trigger correctly next time.
        recordLastPlayDate();
        return false;
      }
      const today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      if (!today || today === lastPlay) return false;
      // Compute day delta. todayInIsrael returns 'YYYY-MM-DD', parseable as UTC.
      const daysSince = Math.floor((new Date(today) - new Date(lastPlay)) / (24 * 60 * 60 * 1000));
      if (daysSince < 2) return false;
      if (daysSince > 365) return false; // sanity — probably a clock skew
      // Per-day dedup so a player who opens the app 5 times today only
      // sees the comeback modal once.
      const claimedKey = 'bloom_comeback_claimed:' + today;
      if (localStorage.getItem(claimedKey)) return false;
      // Fire the server reward + show the modal
      try { localStorage.setItem(claimedKey, '1'); } catch (e) {}
      const expectedReward = daysSince >= 30 ? 200 : daysSince >= 7 ? 100 : 50;
      // Show modal immediately with an optimistic amount; server confirms it
      showComebackModal(daysSince, expectedReward);
      if (typeof earnCredits === 'function') {
        earnCredits('comeback', { daysSince: daysSince });
      }
      // Update the last-play date so we don't double-fire tomorrow
      recordLastPlayDate();
      return true;
    } catch (e) { return false; }
  }

  function showComebackModal(daysSince, reward) {
    if (document.getElementById('comeback-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'comeback-modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;' +
      'display:flex;align-items:center;justify-content:center;direction:rtl;' +
      'animation:fadeIn 0.25s ease-out;';
    const headline = daysSince >= 30 ? 'מזמן לא ראינו אותך!' : daysSince >= 7 ? 'ברוך השב!' : 'נחמד שחזרת';
    const sub = daysSince >= 30 ? 'חודש שלם בלעדיך' : daysSince + ' ימים בלעדיך';
    overlay.innerHTML =
      '<div style="background:linear-gradient(180deg,#FFF,#FFF8E7);border-radius:20px;padding:28px 24px;' +
        'max-width:320px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);' +
        'border:2px solid #FAC775;animation:comebackPop 0.5s cubic-bezier(.2,1.4,.4,1)">' +
        '<div style="font-size:48px;margin-bottom:8px">🎁</div>' +
        '<div style="font-size:22px;font-weight:900;color:#1C1A18">' + headline + '</div>' +
        '<div style="font-size:13px;color:#6F6E68;margin-top:6px">' + sub + '</div>' +
        '<div style="margin:20px 0;padding:16px;background:linear-gradient(135deg,#FAC775,#BA7517);' +
          'border-radius:14px;color:#FFF">' +
          '<div style="font-size:11px;font-weight:600;opacity:0.85">בונוס חזרה</div>' +
          '<div style="font-size:34px;font-weight:900;line-height:1.1;margin-top:2px">+' + reward + ' 💎</div>' +
        '</div>' +
        '<button id="comeback-claim" style="width:100%;padding:14px;border:none;border-radius:12px;' +
          'background:#1C1A18;color:#FAC775;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit">' +
          'בוא נשחק! 🎮' +
        '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    const close = function() {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.25s ease-in';
      setTimeout(function() { overlay.remove(); }, 250);
    };
    document.getElementById('comeback-claim').onclick = function() {
      close();
      hideHomeV2();
      if (typeof init === 'function') init('practice', { fresh: true });
    };
    overlay.onclick = function(e) { if (e.target === overlay) close(); };
  }

  // §Player gift inbox — fetches unseen player-to-player gifts and
  // surfaces them as toast banners. Server marks them seen on read.
  // We also dedup client-side via localStorage to defend against the
  // rare race where the server's UPDATE failed silently.
  const GIFT_SEEN_KEY = 'bloom_gift_seen_ids';
  function loadSeenGifts() {
    try { return new Set(JSON.parse(localStorage.getItem(GIFT_SEEN_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function markGiftSeen(id) {
    try {
      const seen = loadSeenGifts();
      seen.add(id);
      const arr = Array.from(seen);
      // Cap at 500 ids
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      localStorage.setItem(GIFT_SEEN_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  }
  // Exposed globally so the unified social refresh loop in 13-boot.js
  // can call it on the same cadence as duel notifications (every 10s
  // while visible + on visibility/focus). Without this, gifts only
  // polled once-on-home-mount and were invisible to a recipient who
  // was mid-game when the gift landed.
  try { window.__bloomPollGiftInbox = pollGiftInbox; } catch (e) {}

  function pollGiftInbox() {
    if (typeof deviceId === 'undefined' || !deviceId) return;
    fetch(API_BASE + '/api/player/gifts/inbox?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.gifts) || !data.gifts.length) return;
        const seen = loadSeenGifts();
        let delay = 0;
        data.gifts.forEach(function(g) {
          if (seen.has(g.id)) return; // we already surfaced this one
          // Stagger banners so a player who got 3 gifts at once sees
          // them sequentially, not stacked on top of each other.
          setTimeout(function() { showGiftBanner(g); }, delay);
          markGiftSeen(g.id);
          delay += 800;
        });
        // The server credited the balance already — pull a fresh value
        // so the home pid balance refreshes immediately.
        if (data.gifts.length && typeof fetchPlayerCode === 'function') fetchPlayerCode();
      })
      .catch(function() { /* silent — best-effort polling */ });
  }
  function showGiftBanner(gift) {
    const senderName = (gift.sender_name || gift.sender_code || 'שחקן').toString().slice(0, 40);
    const amount = gift.amount | 0;
    const msg = (gift.message || '').toString().slice(0, 120);
    const banner = document.createElement('div');
    banner.style.cssText =
      'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
      'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
      'z-index:9999;background:linear-gradient(135deg,#1C1A18,#2A2724);' +
      'border:2px solid #FAC775;border-radius:14px;padding:12px 16px;direction:rtl;' +
      'font-family:inherit;font-size:13px;color:#FAC775;' +
      'box-shadow:0 8px 24px rgba(186,117,23,0.4);cursor:pointer;' +
      'max-width:340px;width:calc(100vw - 32px);';
    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="font-size:30px">🎁</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:900;color:#FFF;font-size:14px">' +
            (typeof escapeHtml === 'function' ? escapeHtml(senderName) : senderName) +
            ' שלח/ה לך מתנה!</div>' +
          '<div style="font-size:16px;font-weight:800;margin-top:4px">+' + amount + ' 💎</div>' +
          (msg ? '<div style="font-size:11px;color:#A8A6A0;margin-top:4px;font-style:italic">"' +
            (typeof escapeHtml === 'function' ? escapeHtml(msg) : msg) + '"</div>' : '') +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(function() {
      banner.style.opacity = '1';
      banner.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Tactile + tonal alert so the player FEELS the gift arriving,
    // not just sees it. Both are no-ops on browsers that don't
    // support them — buzz() guards internally + soundDrop guards
    // via ensureAudio.
    try { if (typeof buzz === 'function') buzz([8, 20, 8, 20, 16]); } catch (e) {}
    try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
    const dismiss = function() {
      banner.style.opacity = '0';
      banner.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(function() { banner.remove(); }, 250);
    };
    banner.onclick = dismiss;
    setTimeout(dismiss, 5500);
  }

  // ── §A1: personal hero banner ──
  // Picks the single most-relevant message for the player's current
  // state. Returning streak holders get FOMO; players with a real
  // best score get a "beat it" CTA; cold dead-hours fall back to
  // urgency about the daily challenge.
  function renderHeroBannerV2() {
    const el = document.getElementById('home-v2-hero');
    if (!el) return;
    const streak = (typeof loadStreak === 'function') ? loadStreak() : { count: 0 };
    const todayKey = (typeof DAILY_PLAYED_PREFIX !== 'undefined') ? (DAILY_PLAYED_PREFIX + dailyDate) : null;
    const todayPlayed = todayKey && !!localStorage.getItem(todayKey);
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    const totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const hours = new Date().getHours();

    let html = '';

    // Highest-priority hero: a paused contest game. The state was saved
    // on beforeunload / visibilitychange / per-drop autosave; without
    // surfacing it on home the player has to navigate manually back into
    // the contest to resume — friction that loses runs the player would
    // otherwise have finished.
    const pausedContest = findPausedContestGame();
    if (pausedContest) {
      const ageMin = Math.max(1, Math.round((Date.now() - pausedContest.ts) / 60000));
      const ageText = ageMin < 60 ? ageMin + ' דק׳' : Math.round(ageMin / 60) + ' שע׳';
      // After 12h the run almost certainly isn't worth resuming — soft-warn
      // instead of celebrating, but still offer the path back.
      const stale = ageMin > 12 * 60;
      const cls = stale ? 'hero-card hero-card-done' : 'hero-card hero-card-best';
      const icon = stale ? '⏱' : '⏸';
      const title = stale
        ? 'יש משחק ישן מושהה'
        : 'המשך משחק בתחרות';
      const sub = (pausedContest.contestName ? pausedContest.contestName + ' · ' : '') +
        'ניקוד: ' + (pausedContest.score | 0).toLocaleString() + ' · נשמר לפני ' + ageText;
      el.innerHTML = '<div class="' + cls + '" id="hero-resume-contest" role="button" tabindex="0" style="cursor:pointer">' +
        '<span class="hero-icon">' + icon + '</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">' + escapeHtml(title) + '</div>' +
          '<div class="hero-sub">' + escapeHtml(sub) + '</div>' +
        '</div>' +
      '</div>';
      el.style.display = '';
      const resumeEl = document.getElementById('hero-resume-contest');
      if (resumeEl) {
        const go = function() {
          if (typeof setActiveContest === 'function') setActiveContest(pausedContest.code);
          if (typeof hideHome === 'function') hideHome();
          if (typeof init === 'function') init('contest');
        };
        resumeEl.onclick = go;
        resumeEl.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      }
      return;
    }

    if (totalGames === 0) {
      // Brand-new player: leave the hero empty (the FTUE/tour will handle them)
      el.style.display = 'none';
      return;
    }

    // TD.1 — Tomorrow Preview helper. Builds the "מחר: +N💎" pill that
    // sits inside the streak hero card. Returns empty string when the
    // delta isn't meaningful (e.g. day-30+ where the reward already
    // caps). Loss-aversion + escalation visible in one glance.
    var tomorrowPreviewHtml = function() {
      try {
        if (typeof getDailyRewardAmount !== 'function') return '';
        var todayDay = todayPlayed ? streak.count : Math.max(1, streak.count);
        var tomorrowDay = todayPlayed ? streak.count + 1 : Math.max(1, streak.count + 1);
        var todayReward = getDailyRewardAmount(todayDay);
        var tomorrowReward = getDailyRewardAmount(tomorrowDay);
        // Only surface the preview if tomorrow pays MORE — that's the
        // hook. Once the streak caps at day-30 (200💎 forever) there's
        // no upgrade to dangle.
        if (tomorrowReward <= todayReward) {
          return '<div class="hero-tomorrow">מחר: <strong>+' + tomorrowReward + '💎</strong></div>';
        }
        return '<div class="hero-tomorrow hero-tomorrow-up">' +
                 'מחר: <strong>+' + tomorrowReward + '💎</strong> ' +
                 '<span class="hero-tomorrow-bump">(במקום +' + todayReward + ')</span>' +
               '</div>';
      } catch (e) { return ''; }
    };

    if (streak.count >= 7) {
      html = '<div class="hero-card hero-card-streak hero-card-hot">' +
        '<span class="hero-icon">🔥🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף!</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'כל הכבוד — חזרת היום' : 'אל תאבד את הרצף — יש לך עד חצות') + '</div>' +
          tomorrowPreviewHtml() +
        '</div>' +
      '</div>';
    } else if (streak.count >= 3) {
      html = '<div class="hero-card hero-card-streak">' +
        '<span class="hero-icon">🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'נשמר ליום נוסף ✓' : 'שחק היום ותגיע ליום ' + (streak.count + 1)) + '</div>' +
          tomorrowPreviewHtml() +
        '</div>' +
      '</div>';
    } else if (bestEver >= 5000 && !todayPlayed) {
      html = '<div class="hero-card hero-card-best">' +
        '<span class="hero-icon">🏆</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">השיא שלך: ' + bestEver.toLocaleString() + '</div>' +
          '<div class="hero-sub">תנצח את עצמך היום?</div>' +
        '</div>' +
      '</div>';
    } else if (hours >= 21 && !todayPlayed) {
      const hoursLeft = 24 - hours;
      html = '<div class="hero-card hero-card-urgent">' +
        '<span class="hero-icon">⏰</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">עוד ' + hoursLeft + ' שעות לאתגר היומי</div>' +
          '<div class="hero-sub">אל תפספס</div>' +
        '</div>' +
      '</div>';
    } else if (todayPlayed) {
      html = '<div class="hero-card hero-card-done">' +
        '<span class="hero-icon">✅</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">סיימת את האתגר היומי</div>' +
          '<div class="hero-sub">המשך לפרקטיס או הזמן חבר לדו-קרב</div>' +
        '</div>' +
      '</div>';
    } else {
      // Regular player, mid-day, no special state — keep it soft
      el.style.display = 'none';
      return;
    }

    el.innerHTML = html;
    el.style.display = '';
  }

  // ── §A4: compact 3-line player-ID ──
  function renderPlayerIdV2() {
    const el = document.getElementById('home-v2-pid');
    if (!el) return;
    const nm = (getPlayerName() || '').trim();
    const isReal = (typeof hasRealPlayerName === 'function') ? hasRealPlayerName() : !!nm;
    const lvl = (typeof playerLevel !== 'undefined' && playerLevel > 1)
      ? '<span class="pid2-meta-item">' + getLevelIcon() + ' Lv.' + playerLevel + '</span>'
      : '';
    const code = (typeof playerCode !== 'undefined' && playerCode) ? playerCode : '';
    const bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;

    const nameLine = isReal
      ? '<span class="pid2-name">' + escapeHtmlV2(nm) + '</span> <button class="pid2-edit" type="button" aria-label="ערוך שם">✏️</button>'
      : '<span class="pid2-name pid2-name-default">' + escapeHtmlV2(nm) + '</span> <button class="pid2-edit pid2-edit-prompt" type="button" aria-label="קבע שם אמיתי" title="קבע שם אמיתי">✏️</button>';

    el.innerHTML =
      '<div class="pid2-line pid2-line-name">' + nameLine + '</div>' +
      (code ?
        '<div class="pid2-line pid2-line-meta" dir="ltr">' +
          '<button class="pid2-code" type="button" aria-label="העתק קוד">' + code + '</button>' +
          '<span class="pid2-meta-sep">·</span>' +
          '<span class="pid2-meta-item pid2-balance">💎 ' + bal.toLocaleString() + '</span>' +
          (lvl ? '<span class="pid2-meta-sep">·</span>' + lvl : '') +
        '</div>' : '') +
      (code ?
        '<div class="pid2-line pid2-line-profile">' +
          '<a class="pid2-profile-link" href="/player/' + encodeURIComponent(code) + '" target="_blank" rel="noopener">👤 הפרופיל שלי</a>' +
          '<button class="pid2-referrals" type="button" id="pid2-referrals-btn" aria-label="הפניות שלי">' +
            '<span class="pid2-referrals-icon">👥</span>' +
            '<span class="pid2-referrals-count" id="pid2-referrals-count">0</span>' +
            '<span class="pid2-referrals-label">הזמנת</span>' +
          '</button>' +
          // FD.2 — sync button. Always-on for players with a code so
          // they can recover their identity on any new browser/device.
          '<button class="pid2-sync" type="button" id="pid2-sync-btn" aria-label="סנכרן בין מכשירים" title="🔗 סנכרן בין מכשירים">' +
            '<span class="pid2-sync-icon">🔗</span>' +
            '<span class="pid2-sync-label">סנכרן</span>' +
          '</button>' +
        '</div>' : '');

    const editBtn = el.querySelector('.pid2-edit');
    if (editBtn) editBtn.onclick = function() {
      promptForName(function() { renderPlayerIdV2(); }, { edit: true });
    };
    const codeBtn = el.querySelector('.pid2-code');
    if (codeBtn) codeBtn.onclick = function(e) {
      e.stopPropagation();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code);
        const orig = codeBtn.textContent;
        codeBtn.textContent = '✓ הועתק';
        setTimeout(function() { codeBtn.textContent = orig; }, 1400);
      }
    };
    const refBtn = el.querySelector('#pid2-referrals-btn');
    if (refBtn) refBtn.onclick = function() {
      if (typeof window.__bloomShowReferralsModal === 'function') {
        window.__bloomShowReferralsModal();
      }
    };
    const syncBtn = el.querySelector('#pid2-sync-btn');
    if (syncBtn) syncBtn.onclick = function() {
      if (window.__bloomDeviceSync && typeof window.__bloomDeviceSync.showModal === 'function') {
        window.__bloomDeviceSync.showModal();
      }
    };
    fetchReferralCount();
  }

  // Fetches the player's current referral count and paints it onto the
  // home pill. When the count grew since last view, fires a toast +
  // gold pulse — the "צופר" the user asked for when an invitee joins.
  function fetchReferralCount() {
    var did = (typeof deviceId !== 'undefined' && deviceId) ? deviceId : null;
    if (!did) return;
    fetch('/api/referrals/mine?deviceId=' + encodeURIComponent(did))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.ok) return;
        var pill = document.getElementById('pid2-referrals-count');
        if (!pill) return;
        var prev = parseInt(localStorage.getItem('bloom_ref_count_seen') || '0', 10) || 0;
        var now = d.total | 0;
        pill.textContent = String(now);
        if (now > prev) {
          pill.parentElement.classList.add('pid2-referrals-fresh');
          try { localStorage.setItem('bloom_ref_count_seen', String(now)); } catch (e) {}
          if (typeof __bloomToast === 'function') {
            var delta = now - prev;
            __bloomToast('🎁 ' + delta + ' ' + (delta === 1 ? 'חבר חדש הצטרף' : 'חברים חדשים הצטרפו') + ' בזכותך!', 'success');
          }
        } else if (now > 0) {
          pill.parentElement.classList.add('pid2-referrals-has');
        }
      })
      .catch(function() {});
  }

  function showReferralsModal() {
    var existing = document.getElementById('referrals-modal');
    if (existing) existing.remove();
    var did = (typeof deviceId !== 'undefined' && deviceId) ? deviceId : null;
    if (!did) return;
    // Build everything with createElement + textContent so no data ever
    // crosses an innerHTML boundary — XSS-safe even if a future server
    // change lets unsanitized names slip into the API response.
    var ov = document.createElement('div');
    ov.id = 'referrals-modal';
    ov.className = 'referrals-modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'referrals-modal-title');

    var card = document.createElement('div');
    card.className = 'referrals-modal-card';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'referrals-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'סגור');
    closeBtn.setAttribute('data-close-modal', '1');
    closeBtn.textContent = '✕';

    var titleEl = document.createElement('div');
    titleEl.className = 'referrals-modal-title';
    titleEl.id = 'referrals-modal-title';
    titleEl.textContent = '👥 חברים שהזמנת';

    var subEl = document.createElement('div');
    subEl.className = 'referrals-modal-sub';
    subEl.textContent = 'כל אחד שמצטרף דרך הקישור שלך = שניכם מקבלים 💎 + צופר אצלך';

    var statsEl = document.createElement('div');
    statsEl.className = 'referrals-modal-stats';
    statsEl.id = 'referrals-modal-stats';
    statsEl.textContent = 'טוען…';

    var listEl = document.createElement('div');
    listEl.className = 'referrals-modal-list';
    listEl.id = 'referrals-modal-list';

    var shareBtn = document.createElement('button');
    shareBtn.className = 'referrals-modal-share';
    shareBtn.type = 'button';
    shareBtn.textContent = '📤 שלח לעוד חברים';

    card.appendChild(closeBtn);
    card.appendChild(titleEl);
    card.appendChild(subEl);
    card.appendChild(statsEl);
    card.appendChild(listEl);
    card.appendChild(shareBtn);
    ov.appendChild(card);
    document.body.appendChild(ov);

    var close = function() { ov.remove(); };
    closeBtn.onclick = close;
    ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
    shareBtn.onclick = function() {
      close();
      if (typeof shareInviteViaNative === 'function') shareInviteViaNative();
      else if (typeof shareInviteViaWhatsApp === 'function') shareInviteViaWhatsApp();
    };

    fetch('/api/referrals/mine?deviceId=' + encodeURIComponent(did))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.ok) return;
        // Stats — 2 big numbers via createElement + textContent.
        while (statsEl.firstChild) statsEl.removeChild(statsEl.firstChild);
        function makeStat(num, lbl) {
          var box = document.createElement('div');
          box.className = 'referrals-modal-stat-big';
          var n = document.createElement('span');
          n.className = 'referrals-modal-stat-num';
          n.textContent = num;
          var l = document.createElement('span');
          l.className = 'referrals-modal-stat-lbl';
          l.textContent = lbl;
          box.appendChild(n);
          box.appendChild(l);
          return box;
        }
        statsEl.appendChild(makeStat(String(d.total | 0), 'חברים'));
        statsEl.appendChild(makeStat('💎 ' + (d.totalEarned | 0).toLocaleString(), 'הרווחת'));

        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        if (!d.recent || !d.recent.length) {
          var empty = document.createElement('div');
          empty.className = 'referrals-modal-empty';
          empty.textContent = 'עדיין לא הזמנת חברים. שתף את הקוד שלך ותתחיל לצבור!';
          listEl.appendChild(empty);
        } else {
          d.recent.forEach(function(row) {
            var rowEl = document.createElement('div');
            rowEl.className = 'referrals-modal-row';
            var nameEl = document.createElement('span');
            nameEl.className = 'referrals-modal-row-name';
            nameEl.textContent = row.name || 'אנונימי';
            var codeEl = document.createElement('span');
            codeEl.className = 'referrals-modal-row-code';
            codeEl.textContent = row.code || '';
            var whenEl = document.createElement('span');
            whenEl.className = 'referrals-modal-row-when';
            var when = new Date(row.createdAt);
            try {
              var mins = Math.round((Date.now() - when.getTime()) / 60000);
              if (mins < 60) whenEl.textContent = mins + ' דק׳';
              else if (mins < 1440) whenEl.textContent = Math.round(mins / 60) + ' שע׳';
              else whenEl.textContent = Math.round(mins / 1440) + ' ימים';
            } catch (e) { whenEl.textContent = ''; }
            var creditEl = document.createElement('span');
            creditEl.className = 'referrals-modal-row-credit';
            creditEl.textContent = '+' + (row.creditsAwarded | 0) + '💎';
            rowEl.appendChild(nameEl);
            rowEl.appendChild(codeEl);
            rowEl.appendChild(whenEl);
            rowEl.appendChild(creditEl);
            listEl.appendChild(rowEl);
          });
        }
      })
      .catch(function() {});
  }
  window.__bloomShowReferralsModal = showReferralsModal;

  // ── Your week stats — small scannable line ──
  // T1.3 — Balance bar render. Reads live state from in-IIFE vars when
  // available (playerBalance from earnCredits, lives from _livesCache),
  // falls back to localStorage where the var hasn't been initialized.
  // Re-fired on (a) home mount, (b) earnCredits success via __bloomBumpBal,
  // (c) lives widget refresh, and (d) game-over (so level/streak update
  // even if we don't reach a new threshold).
  // AD.5 — win-return celebration. Reads the last-game snapshot (written at
  // game-over, 30-min TTL) and, if the player just won (new personal best, or
  // a score above the configurable threshold), fires confetti + sound + a
  // short "🎉 ניצחת!" banner. Fires at most once per game via a sessionStorage
  // guard keyed on the snapshot's gameId, so navigating home↔game doesn't
  // re-trigger. Skipped for bot/skin-trial (those never write a snapshot).
  function maybeWinReturnCelebration() {
    // Admin master toggle (default on).
    try {
      if (typeof gameConfig === 'object' && gameConfig && gameConfig.home_win_celebration_enabled === 'false') return;
    } catch (e) {}
    var snap = null;
    try { if (window.__bloomLoadLastGame) snap = window.__bloomLoadLastGame(); } catch (e) {}
    if (!snap) return;
    // Only celebrate a recent game (the snapshot loader already enforces a
    // 30-min TTL, but keep the dopamine tight to ~15s after the game ended).
    if (Date.now() - (snap.ts || 0) > 15000) return;
    var threshold = 5000;
    try {
      var t = parseInt(gameConfig && gameConfig.home_win_celebration_min_score, 10);
      if (Number.isFinite(t) && t >= 0) threshold = t;
    } catch (e) {}
    var isWin = !!snap.isNewBest || (snap.score | 0) >= threshold;
    if (!isWin) return;
    // Once per game.
    var guardKey = 'bloom_win_celebrated_' + (snap.gameId || snap.ts || '');
    try { if (sessionStorage.getItem(guardKey)) return; sessionStorage.setItem(guardKey, '1'); } catch (e) {}
    // Fire confetti + sound (both live in other IIFEs → use globals/guards).
    try { if (typeof window.__bloomConfetti === 'function') window.__bloomConfetti(snap.isNewBest ? 48 : 28); } catch (e) {}
    try { if (typeof soundMilestone === 'function') soundMilestone(snap.isNewBest ? 7 : 5); } catch (e) {}
    try { if (typeof buzz === 'function') buzz(snap.isNewBest ? [40, 30, 60, 30, 90] : [30, 40, 60]); } catch (e) {}
    // Brief banner.
    try {
      var b = document.createElement('div');
      b.className = 'home-win-banner';
      var title = snap.isNewBest ? '🎉 שיא חדש!' : '🎉 ניצחת!';
      b.innerHTML = '<div class="home-win-banner-title">' + title + '</div>' +
        '<div class="home-win-banner-sub">' + (snap.score | 0).toLocaleString() + ' נקודות</div>';
      document.body.appendChild(b);
      setTimeout(function() { try { b.remove(); } catch (e) {} }, 2600);
    } catch (e) {}
  }

  function renderBalanceBarV2() {
    const bar = document.getElementById('home-v2-balance-bar');
    if (!bar) return;
    // Gems — playerBalance is the canonical in-memory var, set by
    // fetchPlayerCode + earnCredits + every /api/player/* response.
    const gemsEl = document.getElementById('home-v2-bal-gems');
    if (gemsEl) {
      let balance = 0;
      try { if (typeof playerBalance === 'number') balance = playerBalance | 0; } catch (e) {}
      gemsEl.textContent = balance.toLocaleString();
    }
    // Lives — only show slot if lives system is enabled & cache has data.
    // The lives module owns _livesCache; we read defensively.
    const livesSlot = document.getElementById('home-v2-bal-lives-slot');
    if (livesSlot) {
      let livesData = null;
      try { if (window._livesCache && window._livesCache.data) livesData = window._livesCache.data; } catch (e) {}
      if (livesData && livesData.enabled !== false && typeof livesData.currentLives === 'number') {
        const livesEl = document.getElementById('home-v2-bal-lives');
        if (livesEl) livesEl.textContent = livesData.currentLives + '/' + (livesData.maxLives | 0);
        livesSlot.style.display = '';
      } else {
        livesSlot.style.display = 'none';
      }
    }
    // Streak — loadStreak() returns the dynamic-streak object across
    // all play modes (daily/practice/contest/duel/dynamic).
    const streakEl = document.getElementById('home-v2-bal-streak');
    if (streakEl) {
      let count = 0;
      try {
        const s = (typeof loadStreak === 'function') ? loadStreak() : null;
        if (s && typeof s.count === 'number') count = s.count | 0;
      } catch (e) {}
      streakEl.textContent = String(count);
    }
    // Level (T1.1 progression)
    const levelEl = document.getElementById('home-v2-bal-level');
    if (levelEl) {
      let lvl = 1;
      try { if (typeof getPlayerLevel === 'function') lvl = getPlayerLevel(); } catch (e) {}
      levelEl.textContent = String(lvl);
    }
  }
  // UX audit 2026-06-02 — the primary "🎮 שחק עכשיו" button had an empty
  // subtitle slot (#home-v2-cta-sub), the single most-tapped element in the
  // game. Populate it with the strongest personalized hook that matches what
  // the button actually does (plays practice/last-mode → improves best /
  // extends today's streak). Loss-aversion streak prompt wins; else beat-best;
  // else stay empty for a brand-new player (the label alone reads clean).
  function updateHomeCtaSubV2() {
    var el = document.getElementById('home-v2-cta-sub');
    if (!el) return;
    var msg = '';
    try {
      var bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      var count = 0;
      try { var s = (typeof loadStreak === 'function') ? loadStreak() : null; if (s && typeof s.count === 'number') count = s.count | 0; } catch (e) {}
      var today = (typeof todayInIsrael === 'function') ? todayInIsrael() : null;
      var todayPlayed = false;
      try { todayPlayed = !!(today && typeof DAILY_PLAYED_PREFIX !== 'undefined' && localStorage.getItem(DAILY_PLAYED_PREFIX + today)); } catch (e) {}
      if (count >= 1 && !todayPlayed) {
        msg = '🔥 רצף ' + count + ' ימים — שחק היום לשמור עליו!';
      } else if (bestEver > 0) {
        msg = '🏆 השיא שלך: ' + bestEver.toLocaleString() + ' — תשבור אותו!';
      }
    } catch (e) {}
    el.textContent = msg;
  }

  // Bump animation on gem-change. Called from earnCredits via
  // window.__bloomBumpBal so the widget reacts instantly to rewards.
  function bumpBalanceGems(newBalance, delta) {
    const slot = document.getElementById('home-v2-bal-gems-slot');
    const el = document.getElementById('home-v2-bal-gems');
    if (!slot || !el) return;
    if (typeof newBalance === 'number') el.textContent = newBalance.toLocaleString();
    slot.classList.remove('home-v2-bal-bump');
    // Force reflow to restart the animation.
    void slot.offsetWidth;
    slot.classList.add('home-v2-bal-bump');
    // Floating "+N" if delta is positive.
    if (typeof delta === 'number' && delta > 0) {
      const float = document.createElement('span');
      float.className = 'home-v2-bal-float';
      float.textContent = '+' + delta.toLocaleString();
      slot.appendChild(float);
      setTimeout(function() { try { float.remove(); } catch (e) {} }, 1400);
    }
  }
  try {
    window.__bloomBumpBal = bumpBalanceGems;
    window.__bloomRenderBal = renderBalanceBarV2;
  } catch (e) {}

  function renderMyStatsV2() {
    const el = document.getElementById('home-v2-mystats');
    if (!el) return;
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    const totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    if (total === 0) { el.style.display = 'none'; return; }
    const totalH = Math.floor(totalMs / 3600000);
    const totalM = Math.floor((totalMs % 3600000) / 60000);
    const timeText = totalH > 0 ? totalH + 'ש ' + totalM + 'ד' : totalM + ' דקות';
    el.innerHTML =
      '<span class="mystats2-item">🎮 ' + total.toLocaleString() + ' משחקים</span>' +
      (bestEver > 0 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">🏆 שיא ' + bestEver.toLocaleString() + '</span>' : '') +
      (totalMs > 60000 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">⏱ ' + timeText + '</span>' : '');
    el.style.display = '';
  }

  // ── §A2: live-pulse with tiered fallback (never hides) ──
  let homeV2PulseTimer = null;
  function startHomeV2LivePulse() {
    stopHomeV2LivePulse();
    refreshHomeV2LivePulse();
    homeV2PulseTimer = setInterval(refreshHomeV2LivePulse, 15000);
  }
  function stopHomeV2LivePulse() {
    if (homeV2PulseTimer) { clearInterval(homeV2PulseTimer); homeV2PulseTimer = null; }
  }
  function refreshHomeV2LivePulse() {
    fetch(API_BASE + '/api/stats/live').then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
      if (!data) return;
      const el = document.getElementById('home-v2-live-text');
      const wrap = document.getElementById('home-v2-live-pulse');
      if (!el || !wrap) return;
      const playing = data.playingNow | 0;
      const games   = data.gamesToday | 0;
      const hour    = data.activeThisHour | 0;
      const week    = data.gamesThisWeek | 0;

      let html = '';
      if (playing >= 3) {
        html = '<strong>' + playing.toLocaleString() + '</strong> שחקנים פעילים עכשיו';
        wrap.classList.add('home-v2-live-hot');
      } else if (games > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + games.toLocaleString() + '</strong> משחקים היום';
      } else if (hour > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + hour.toLocaleString() + '</strong> שחקנים בשעה האחרונה';
      } else if (week > 0) {
        wrap.classList.remove('home-v2-live-hot');
        html = '<strong>' + week.toLocaleString() + '</strong> משחקים השבוע';
      } else {
        // Genuinely brand-new universe — be honest, not ghost-towny
        wrap.classList.remove('home-v2-live-hot');
        html = '🌸 הצטרף לראשונים';
      }
      el.innerHTML = html;
      wrap.style.display = '';
    }).catch(function() { /* silent */ });
  }

  // ── §B1: notification badges on the action grid ──
  //
  // Acknowledgement persistence: previously the "seen" set lived in
  // sessionStorage, so closing the tab made every duel "unseen" again
  // and the red badge re-appeared forever. Moved to localStorage with
  // a stable schema. The set is bounded (cleanupAcknowledgedDuels)
  // so it can't grow unbounded.
  const DUEL_ACK_KEY = 'bloom_ack_duel_ids';
  function loadAcknowledgedDuels() {
    try {
      const raw = localStorage.getItem(DUEL_ACK_KEY);
      if (!raw) {
        // One-shot migration from the legacy sessionStorage key.
        const legacy = sessionStorage.getItem('bloom_seen_duel_notifications');
        if (legacy) {
          try { localStorage.setItem(DUEL_ACK_KEY, legacy); } catch (e) {}
          try { sessionStorage.removeItem('bloom_seen_duel_notifications'); } catch (e) {}
          return JSON.parse(legacy) || [];
        }
        return [];
      }
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveAcknowledgedDuels(arr) {
    try {
      // Cap at the most recent 500 ids — anything beyond that is rotational
      // noise (settled duels we'll never see again).
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      localStorage.setItem(DUEL_ACK_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  }
  function isDuelAcknowledged(id) {
    return loadAcknowledgedDuels().indexOf(id) >= 0;
  }
  function markDuelAcknowledged(id) {
    if (id == null) return;
    const arr = loadAcknowledgedDuels();
    if (arr.indexOf(id) < 0) {
      arr.push(id);
      saveAcknowledgedDuels(arr);
    }
  }
  function markAllDuelsAcknowledged(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const arr = loadAcknowledgedDuels();
    let changed = false;
    ids.forEach(function(id) {
      if (id != null && arr.indexOf(id) < 0) { arr.push(id); changed = true; }
    });
    if (changed) {
      saveAcknowledgedDuels(arr);
      // Re-paint the home badge immediately so the change is visible
      // the moment the modal closes (the home stays in the DOM behind
      // the modal, so the badge element is updatable from here).
      if (document.getElementById('home-v2-duel-badge')) {
        try { refreshHomeV2Badges(); } catch (e) {}
      }
    }
  }
  // Expose for src/02-shop.js to call from inside the duel modal — both
  // when the modal opens (mass-ack) and when the user declines a duel
  // (single-ack). Also used by acceptDuel via the same path.
  try {
    window.__bloomMarkDuelAcknowledged = markDuelAcknowledged;
    window.__bloomMarkAllDuelsAcknowledged = markAllDuelsAcknowledged;
  } catch (e) {}

  function refreshHomeV2Badges() {
    if (typeof deviceId === 'undefined' || !deviceId) return;
    // Duels: count ids the player has NOT yet acknowledged. Once they
    // open the duel modal (which calls markAllDuelsAcknowledged), the
    // badge clears. New duels that arrive later are unacknowledged so
    // the badge re-appears with just the new count.
    fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.duels)) return;
        var unseen = 0;
        data.duels.forEach(function(d) {
          // Only "meaningful" statuses count toward the badge:
          //   - pending where I'm the opponent (action needed)
          //   - settled/tie (result to read)
          // 'accepted' duels in progress aren't surfaced as a notification
          // (the player knows — they're in the middle of playing).
          const isPendingForMe = d.opponent_code === playerCode && d.status === 'pending';
          const isResolved = d.status === 'settled' || d.status === 'tie';
          if (!isPendingForMe && !isResolved) return;
          if (!isDuelAcknowledged(d.id)) unseen++;
        });
        paintBadgeV2('home-v2-duel-badge', unseen);
      })
      .catch(function() {});

    // Active prize challenges — show the prize value as the badge
    fetch(API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.challenges)) return;
        const active = data.challenges.filter(function(c) {
          return c.status === 'active' && !(c.myEntry && c.myEntry.status === 'completed');
        });
        paintBadgeV2('home-v2-challenge-badge', active.length);
      })
      .catch(function() {});
  }
  function paintBadgeV2(elId, n) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!n || n < 1) { el.style.display = 'none'; return; }
    el.textContent = n > 9 ? '9+' : String(n);
    el.style.display = '';
  }

  // ── §B2: featured-action picker ──
  // Decides the single most-urgent secondary action and surfaces it
  // as a prominent gradient card above the regular 2x2 grid.
  function refreshFeaturedActionV2() {
    const el = document.getElementById('home-v2-featured');
    if (!el || typeof deviceId === 'undefined' || !deviceId) return;
    // Priority order (first hit wins):
    //   1. Pending duel where I'm the opponent
    //   2. Active contest with my row dropping behind
    //   3. Active prize challenge I haven't entered
    //   4. Nothing → hide
    el.style.display = 'none';
    el.innerHTML = '';

    fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !Array.isArray(data.duels)) throw new Error('skip');
        const pending = data.duels.find(function(d) {
          return d.opponent_code === playerCode && d.status === 'pending';
        });
        if (pending) {
          const oppName = pending.challenger_name || pending.challenger_code || 'יריב';
          paintFeaturedV2('duel', '⚔️', 'דו-קרב ממתין!', oppName + ' אתגר אותך', '#FF6B6B', function() {
            if (typeof showDuelModal === 'function') showDuelModal();
          });
          return Promise.reject('done');
        }
        return null;
      })
      .then(function() {
        // Fallback: try active challenges
        return fetch(API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId)).then(function(r) { return r.ok ? r.json() : null; });
      })
      .then(function(data) {
        if (!data || !Array.isArray(data.challenges)) return;
        const fresh = data.challenges.find(function(c) {
          return c.status === 'active' && (!c.myEntry || c.myEntry.status !== 'completed');
        });
        if (fresh) {
          const prize = fresh.prize_text ? ('פרס: ' + fresh.prize_text) : 'פעיל עכשיו';
          paintFeaturedV2('challenge', '🏆', escapeHtmlV2(fresh.name || 'אתגר פעיל'), prize, '#FAC775', function() {
            if (typeof showChallengeDetail === 'function') showChallengeDetail(fresh.slug);
            else if (typeof showChallengesList === 'function') showChallengesList('home-v2-featured');
          });
        }
      })
      .catch(function() { /* `done` skips the rest, that's intentional */ });
  }
  function paintFeaturedV2(kind, icon, title, sub, color, onClick) {
    const el = document.getElementById('home-v2-featured');
    if (!el) return;
    el.innerHTML =
      '<button class="home-v2-feat home-v2-feat-' + kind + '" style="--feat-color:' + color + '">' +
        '<span class="home-v2-feat-icon">' + icon + '</span>' +
        '<div class="home-v2-feat-body">' +
          '<div class="home-v2-feat-title">' + title + '</div>' +
          '<div class="home-v2-feat-sub">' + sub + '</div>' +
        '</div>' +
        '<span class="home-v2-feat-arrow">←</span>' +
      '</button>';
    el.style.display = '';
    const btn = el.querySelector('.home-v2-feat');
    if (btn) btn.onclick = function() {
      ensureAudio();
      if (typeof onClick === 'function') onClick();
    };
  }

  // ── WhatsApp invite (same as v1 but triggered from the small bottom link) ──
  function whatsappInviteV2() {
    // FD.2 — funnel through buildShareUrl so the player's BLOOM-XXXX code
    // is appended as ?ref=. Without this every invite sent from home
    // was a K-factor leak — recipients joined but the referral counter
    // never fired, no signup bonus, no push-back-to-referrer. The
    // universal helper handles missing playerCode gracefully (returns
    // just the bare origin if it's not loaded yet).
    var link = (typeof window.__bloomBuildShareUrl === 'function')
      ? window.__bloomBuildShareUrl('/')
      : (window.location.origin + window.location.pathname);
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    var playerNm = (getPlayerName() || '').trim();
    var text = '🌸 ';
    if (playerNm) text += playerNm + ' מזמין/ה אותך ל-BLOOM!\n\n';
    else text += 'הזמנה ל-BLOOM!\n\n';
    text += 'משחק מיזוג ממכר בעברית 🎮\n';
    if (totalGames > 0) text += 'כבר שיחקתי ' + totalGames + ' משחקים';
    if (totalMs > 60000) {
      var h2 = Math.floor(totalMs / 3600000);
      var m2 = Math.floor((totalMs % 3600000) / 60000);
      text += h2 > 0 ? ' (' + h2 + ' שעות ו-' + m2 + ' דקות 🤯)' : ' (' + m2 + ' דקות!)';
    }
    text += '\n\nנסה וגלה אם תצליח לנצח אותי:\n' + link;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    try { trackEvent('share', { method: 'whatsapp', type: 'invite_v2' }); } catch (e) {}
  }

  // ── Helpers ──
  function buildPlayerHistoryToast() {
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    if (total === 0) return 'עוד לא שיחקת — התחל עכשיו';
    return 'שיחקת ' + total + ' משחקים · שיא: ' + bestEver.toLocaleString();
  }
  function escapeHtmlV2(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
