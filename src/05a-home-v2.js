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
        '<div class="home-v2-live-pulse" id="home-v2-live-pulse">' +
          '<span class="home-v2-live-dot"></span>' +
          '<span class="home-v2-live-text" id="home-v2-live-text">טוען…</span>' +
        '</div>' +
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
      '<div class="home-v2-actions">' +
        '<button class="home-v2-action" id="home-v2-contest" data-action="contest">' +
          '<span class="home-v2-badge" id="home-v2-contest-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">👥</span>' +
          '<span class="home-v2-action-label">תחרות</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-challenge" data-action="challenge">' +
          '<span class="home-v2-badge home-v2-badge-prize" id="home-v2-challenge-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">🏆</span>' +
          '<span class="home-v2-action-label">אתגרים</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-duel" data-action="duel">' +
          '<span class="home-v2-badge" id="home-v2-duel-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon">⚔️</span>' +
          '<span class="home-v2-action-label">דו-קרב</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-skins" data-action="skins">' +
          '<span class="home-v2-action-icon">🎨</span>' +
          '<span class="home-v2-action-label">סקינים</span>' +
        '</button>' +
      '</div>' +

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
      if (onOverScreen) init('practice');
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
    refreshHomeV2LivePulse();
    refreshHomeV2Badges();
    refreshFeaturedActionV2();
    refreshHomeChallengeCta();    // reuses v1 helper — paints the challenge button label
    refreshHomeJackpot();
    refreshHomeWeekly();
    startHomeV2LivePulse();

    playMusic('lobby');

    // Daily login reward — same delay as v1
    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    // Auto-tour for first-time visitors (mirrors v1 behaviour)
    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
  }

  function hideHomeV2() {
    stopHomeV2LivePulse();
    const h = document.getElementById('home-screen');
    if (h) h.remove();
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('data-home');
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

    if (totalGames === 0) {
      // Brand-new player: leave the hero empty (the FTUE/tour will handle them)
      el.style.display = 'none';
      return;
    }

    if (streak.count >= 7) {
      html = '<div class="hero-card hero-card-streak hero-card-hot">' +
        '<span class="hero-icon">🔥🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף!</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'כל הכבוד — חזרת היום' : 'אל תאבד את הרצף — יש לך עד חצות') + '</div>' +
        '</div>' +
      '</div>';
    } else if (streak.count >= 3) {
      html = '<div class="hero-card hero-card-streak">' +
        '<span class="hero-icon">🔥</span>' +
        '<div class="hero-body">' +
          '<div class="hero-title">יום ' + streak.count + ' ברצף</div>' +
          '<div class="hero-sub">' + (todayPlayed ? 'נשמר ליום נוסף ✓' : 'שחק היום ותגיע ליום ' + (streak.count + 1)) + '</div>' +
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
      : '<button class="pid2-edit pid2-edit-prompt" type="button">✏️ קבע את השם שלך</button>';

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
  }

  // ── Your week stats — small scannable line ──
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
