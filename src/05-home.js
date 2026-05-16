  function showHome() {
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen';
    h.innerHTML =
      '<button class="home-mute" id="home-mute" aria-label="השתק">' +
        '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
      '</button>' +
      '<div class="home-icons" id="home-icons-tap">' +
        '<div class="home-icon" style="background:#CECBF6;color:#26215C">' + SVG.crown + '</div>' +
        '<div class="home-icon" style="background:#9FE1CB;color:#04342C">' + SVG.star + '</div>' +
        '<div class="home-icon" style="background:#F5C4B3;color:#4A1B0C">' + SVG.flame + '</div>' +
        '<div class="home-icon" style="background:#F4C0D1;color:#4B1528">' + SVG.flower + '</div>' +
        '<div class="home-icon" style="background:#C0DD97;color:#173404">' + SVG.leaf + '</div>' +
      '</div>' +
      '<div class="home-brand">BLOOM</div>' +
      '<div class="home-sub">מזג חפצים, גלה דרגות חדשות, והגע עד לכתר</div>' +
      '<div class="home-player-id" id="home-player-id"></div>' +
      '<div id="home-streak-host"></div>' +
      '<div class="home-stats-bubble" id="home-stats-bubble" style="display:none"></div>' +
      // Primary CTA
      (hasSeenTour()
        ? '<button class="home-start" id="home-start">שחק עכשיו</button>'
        : '<button class="home-start" id="home-start">בוא נתחיל</button>') +
      '<div class="home-social" id="home-social"></div>' +
      // Weekly challenge + jackpot
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +
      // Contest + Challenge grid (2 columns)
      '<div class="home-actions-grid">' +
        (activeContestCode
          ? '<button class="home-action-btn home-action-contest active" id="home-contest"><span class="home-action-badge active">פעיל</span>תחרות חברים</button>'
          : '<button class="home-action-btn home-action-contest" id="home-contest"><span class="home-action-badge">חדש</span>תחרות חברים</button>') +
        '<button class="home-action-btn home-action-challenge" id="home-challenge">' +
          '<span class="home-action-badge prize">פרס</span>' +
          '<span id="home-challenge-label">אתגרי BLOOM</span>' +
        '</button>' +
      '</div>' +
      // Skins + Duel grid
      '<div class="home-actions-grid" style="margin-top:8px">' +
        '<button class="home-action-btn home-action-secondary" id="home-skin-shop">🎨 סקינים</button>' +
        '<button class="home-action-btn home-action-secondary" id="home-duel-btn">⚔️ דו-קרב 1v1</button>' +
      '</div>' +
      // Single invite button
      '<button class="home-invite-wa" id="home-invite-wa">' +
        '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
        '<span>📱 הזמן חבר דרך WhatsApp</span>' +
      '</button>' +
      // Tour link (bottom)
      (!hasSeenTour()
        ? '<button class="home-skip" id="home-skip">אני יודע לשחק, דלג</button>'
        : '<button class="home-skip" id="home-tour-btn" style="margin-top:8px;color:#BA7517">📖 איך משחקים?</button>');
    app.appendChild(h);
    syncHomeMuteUI();
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      openMuteMenu('home');
    };
    const enter = function() {
      ensureAudio();
      hideHome();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      if (onOverScreen) init('practice');
      playMusic('game');
      // If we're returning to a paused contest game, make sure the overtake
      // watcher is running again (it was stopped when navigating away).
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };
    // Tap tier icons → reveal hidden stats bubble
    var iconsTap = document.getElementById('home-icons-tap');
    var statsBubble = document.getElementById('home-stats-bubble');
    if (iconsTap && statsBubble) {
      iconsTap.style.cursor = 'pointer';
      iconsTap.onclick = function() {
        var isOpen = statsBubble.style.display !== 'none';
        statsBubble.style.display = isOpen ? 'none' : '';
        if (!isOpen) statsBubble.style.animation = 'bubblePop 0.25s ease-out';
      };
      // Tap outside bubble → close it
      document.addEventListener('pointerdown', function(e) {
        if (statsBubble.style.display === 'none') return;
        if (statsBubble.contains(e.target) || iconsTap.contains(e.target)) return;
        statsBubble.style.display = 'none';
      });
    }

    document.getElementById('home-start').onclick = function() {
      ensureAudio();
      if (!hasSeenTour()) { showTour({ onDone: enter }); }
      else { enter(); }
    };
    const skipBtn = document.getElementById('home-skip');
    if (skipBtn) skipBtn.onclick = enter;
    const contestBtn = document.getElementById('home-contest');
    if (contestBtn) contestBtn.onclick = function() {
      ensureAudio();
      if (mode === 'practice') savePracticeGameState();
      showContestMenu();
    };
    refreshHomeChallengeCta();
    refreshHomeSocialProof();
    refreshHomeJackpot();
    refreshHomeStreak();
    refreshHomeWeekly();
    // WhatsApp invite button
    var waInvite = document.getElementById('home-invite-wa');
    if (waInvite) waInvite.onclick = function(e) {
      e.stopPropagation();
      var link = window.location.origin + window.location.pathname;
      var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
      var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
      var playerNm = (getPlayerName() || '').trim();
      var text = '🌸 ';
      if (playerNm) text += playerNm + ' מזמין/ה אותך ל-BLOOM!\n\n';
      else text += 'הזמנה ל-BLOOM!\n\n';
      text += 'משחק מיזוג ממכר בעברית 🎮\n';
      if (totalGames > 0) text += 'כבר שיחקתי ' + totalGames + ' משחקים';
      if (totalMs > 60000) {
        var h = Math.floor(totalMs / 3600000);
        var m = Math.floor((totalMs % 3600000) / 60000);
        text += h > 0 ? ' (' + h + ' שעות ו-' + m + ' דקות 🤯)' : ' (' + m + ' דקות!)';
      }
      text += '\n\nנסה וגלה אם תצליח לנצח אותי:\n' + link;
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      trackEvent('share', { method: 'whatsapp', type: 'invite' });
    };
    // Wire the "איך משחקים?" link
    const tourLink = document.getElementById('home-tour-btn');
    if (tourLink) tourLink.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    var skinShopBtn = document.getElementById('home-skin-shop');
    if (skinShopBtn) skinShopBtn.onclick = function() { showSkinShop(); };
    var duelBtn = document.getElementById('home-duel-btn');
    if (duelBtn) duelBtn.onclick = function() { showDuelModal(); };

    // Show player code on home + profile link
    var pidEl = document.getElementById('home-player-id');
    if (pidEl && playerCode) {
      var lvlText = playerLevel > 1 ? ' · ' + getLevelIcon() + ' Lv.' + playerLevel : '';
      pidEl.innerHTML = '<span class="pid-code">' + playerCode + '</span> · <span class="pid-balance">' + playerBalance + ' 💎</span>' + lvlText +
        '<a href="/player/' + playerCode + '" target="_blank" class="pid-profile-link">👤 הפרופיל שלי</a>';
      pidEl.querySelector('.pid-code').onclick = function(e) {
        e.stopPropagation();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(playerCode);
          var sp = pidEl.querySelector('.pid-code');
          sp.textContent = '✓ הועתק!';
          setTimeout(function() { sp.textContent = playerCode; }, 1500);
        }
      };
    }
    // First-ever-visit: gently auto-open the tour after the home settles in.
    // We defer it so the home animations land first, and only fire if the
    // player hasn't seen the tour AND hasn't already started learning the
    // game via the in-game coach toasts.
    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        // Re-check in case they navigated away in the meantime
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
    playMusic('lobby');
    // Daily login reward — show after home settles
    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);
  }
  function hideHome() {
    const h = document.getElementById('home-screen');
    if (h) h.remove();
  }
  function syncHomeMuteUI() { updateMuteUI(); }

  /* ============ FRIENDS CONTEST SCREENS ============ */

