  // ============================================================
  // Home v3 — premium-tier home screen (HOME_AUDIT.md targets 9.5+)
  // ============================================================
  // Builds on v2's information architecture and layers in every
  // improvement called out in the self-score: animated brand mark,
  // flower mascot with face, pre-game tier-up teaser, week-over-week
  // stats comparison, accessibility (skip-link + aria-live + lazy
  // badges), animated background mesh, and a "what's new" banner.
  //
  // Same opt-in pattern as v2: ?home=v3 / localStorage.bloom_home_v3.
  // Once approved the delegation flips to default-v3.
  // ============================================================

  const HOME_V3_KEY = 'bloom_home_v3';
  const WEEK_STATS_KEY = 'bloom_week_stats_v3';
  const WHATS_NEW_KEY  = 'bloom_whats_new_seen';
  const WHATS_NEW_VERSION = 'v20260520n';
  const WHATS_NEW_BODY = '✨ סקין Aurora עם אנימציות + מיני-מסקוט בבית + מסך משחק חדש';

  function homeV3Enabled() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('home');
      if (v === 'v3') { localStorage.setItem(HOME_V3_KEY, '1'); return true; }
      if (v === 'v2' || v === 'v1') { localStorage.removeItem(HOME_V3_KEY); return false; }
      return localStorage.getItem(HOME_V3_KEY) === '1';
    } catch (e) { return false; }
  }
  function enableHomeV3() { try { localStorage.setItem(HOME_V3_KEY, '1'); } catch (e) {} }
  function disableHomeV3() { try { localStorage.removeItem(HOME_V3_KEY); } catch (e) {} }

  // Calculate the player's tier-up goal for this session. Uses their
  // historical best score as the heuristic and picks the next tier
  // they should aim for. Returns null for players with no signal.
  function calculatePregameGoal() {
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    // Best-score → suggested-target-tier brackets.
    // The reward is the existing TIER_UP_BONUS for that tier (real points
    // the engine already awards when the player first reaches it). The
    // teaser tells them about a reward they can ACTUALLY collect, just
    // surfaces it more visibly than the in-game milestone banner.
    let targetTier = null;
    if (best < 1500)        targetTier = 4;  // Flame ← entry players
    else if (best < 5000)   targetTier = 5;  // Bolt
    else if (best < 15000)  targetTier = 6;  // Star
    else if (best < 40000)  targetTier = 7;  // Diamond
    else                    targetTier = 8;  // Crown — for veterans
    if (!targetTier) return null;
    const rewardMap = { 4: 200, 5: 500, 6: 1500, 7: 5000, 8: 15000 };
    const tiers = getActiveTiers ? getActiveTiers() : [];
    const ti = tiers[targetTier] || {};
    return {
      tier: targetTier,
      reward: rewardMap[targetTier] || 500,
      name: ti.name || ('דרגה ' + targetTier),
      emoji: ti.emoji || '⭐'
    };
  }

  // Persist this session's goal so the engine can verify hit on game-over.
  function persistPregameGoal(goal) {
    if (!goal) return;
    try {
      localStorage.setItem('bloom_pregame_goal', JSON.stringify({
        tier: goal.tier, reward: goal.reward, ts: Date.now()
      }));
    } catch (e) {}
  }

  // Track week-over-week stats client-side. Each day records games-count;
  // we compare today's running total against 7 days ago.
  function recordWeekStats() {
    try {
      const today = todayInIsrael();
      const raw = localStorage.getItem(WEEK_STATS_KEY);
      let history = {};
      if (raw) {
        try { history = JSON.parse(raw) || {}; } catch (e) {}
      }
      const currentTotal = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
      history[today] = currentTotal;
      // Keep only the last 14 days
      const keys = Object.keys(history).sort();
      while (keys.length > 14) {
        delete history[keys.shift()];
      }
      localStorage.setItem(WEEK_STATS_KEY, JSON.stringify(history));
    } catch (e) {}
  }
  function getWeekDelta() {
    try {
      const raw = localStorage.getItem(WEEK_STATS_KEY);
      if (!raw) return null;
      const history = JSON.parse(raw) || {};
      const keys = Object.keys(history).sort();
      if (keys.length < 2) return null;
      const today = keys[keys.length - 1];
      const todayTotal = history[today] || 0;
      const sevenDaysAgoKey = keys.find(function(k) {
        const d = new Date(k);
        const t = new Date(today);
        return (t - d) / 86400000 >= 7;
      });
      if (!sevenDaysAgoKey) {
        // Not enough history — use the oldest available
        const earliestKey = keys[0];
        const earliestTotal = history[earliestKey] || 0;
        return {
          thisWeek: todayTotal - earliestTotal,
          delta: null,
          daysOfData: keys.length
        };
      }
      const sevenAgoTotal = history[sevenDaysAgoKey] || 0;
      const earlierKey = keys[Math.max(0, keys.indexOf(sevenDaysAgoKey) - 7)];
      const earlierTotal = history[earlierKey] || 0;
      const thisWeek  = todayTotal    - sevenAgoTotal;
      const prevWeek  = sevenAgoTotal - earlierTotal;
      return { thisWeek: thisWeek, prevWeek: prevWeek, delta: thisWeek - prevWeek };
    } catch (e) { return null; }
  }

  function showHomeV3() {
    stopEventSystem();
    const app = document.querySelector('.app');
    if (!app || document.getElementById('home-screen')) return;
    recordWeekStats();

    const h = document.createElement('div');
    h.id = 'home-screen';
    h.className = 'home-screen home-v3';

    const goal = calculatePregameGoal();
    if (goal) persistPregameGoal(goal);

    h.innerHTML =
      // Accessibility: skip link (first focusable element)
      '<a class="home-v3-skip-link" href="#home-v3-start">דלג ל-CTA הראשי</a>' +

      // Floating background mesh — purely decorative, aria-hidden
      '<div class="home-v3-mesh" aria-hidden="true">' +
        '<span class="mesh-tile mesh-t1"></span>' +
        '<span class="mesh-tile mesh-t2"></span>' +
        '<span class="mesh-tile mesh-t3"></span>' +
        '<span class="mesh-tile mesh-t4"></span>' +
        '<span class="mesh-tile mesh-t5"></span>' +
        '<span class="mesh-tile mesh-t6"></span>' +
        '<span class="mesh-tile mesh-t7"></span>' +
      '</div>' +

      // Topbar: mute + always-visible social proof (aria-live)
      '<div class="home-v3-topbar">' +
        '<button class="home-v2-mute" id="home-mute" aria-label="השתק">' +
          '<svg id="home-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>' +
        '</button>' +
        '<div class="home-v2-live-pulse" id="home-v2-live-pulse" role="status" aria-live="polite" aria-atomic="true">' +
          '<span class="home-v2-live-dot"></span>' +
          '<span class="home-v2-live-text" id="home-v2-live-text">טוען…</span>' +
        '</div>' +
      '</div>' +

      // "What's new" banner — conditional
      buildWhatsNewBanner() +

      // Brand area: flower mascot + animated brand-mark loop
      '<div class="home-v3-brand-area">' +
        '<div class="home-v3-mascot" id="home-v3-mascot" aria-hidden="true">' + buildFlowerMascotSvg() + '</div>' +
        '<div class="home-v3-mark" id="home-v3-mark" aria-hidden="true">' +
          '<div class="mark-tile mark-t1">' + (getActiveTiers()[1] && getActiveTiers()[1].svg ? getActiveTiers()[1].svg : '🌱') + '</div>' +
          '<div class="mark-tile mark-t2">' + (getActiveTiers()[2] && getActiveTiers()[2].svg ? getActiveTiers()[2].svg : '🍃') + '</div>' +
          '<div class="mark-tile mark-t3">' + (getActiveTiers()[3] && getActiveTiers()[3].svg ? getActiveTiers()[3].svg : '🌸') + '</div>' +
          '<div class="mark-plus mark-plus-1">+</div>' +
          '<div class="mark-plus mark-plus-2">+</div>' +
          '<div class="mark-arrow">→</div>' +
          '<div class="mark-tile mark-result">' + (getActiveTiers()[4] && getActiveTiers()[4].svg ? getActiveTiers()[4].svg : '🔥') + '</div>' +
        '</div>' +
        '<div class="home-v3-brand">BLOOM</div>' +
      '</div>' +

      // Personal hero banner — adaptive
      '<div class="home-v2-hero" id="home-v2-hero"></div>' +

      // Player identity (3 lines)
      '<div class="home-v2-pid" id="home-v2-pid"></div>' +

      // Pre-game teaser — surfaces existing tier-up bonuses as a goal
      (goal ? buildPregameTeaserHtml(goal) : '') +

      // Primary CTA
      '<button class="home-v2-cta home-v3-cta" id="home-v3-start" aria-label="התחל לשחק">' +
        '<span class="home-v2-cta-label" id="home-v2-cta-label">🎮 שחק עכשיו</span>' +
        '<span class="home-v2-cta-sub" id="home-v2-cta-sub"></span>' +
      '</button>' +

      // Mystats with week-over-week comparison
      '<div class="home-v2-mystats home-v3-mystats" id="home-v2-mystats"></div>' +

      // Featured action
      '<div class="home-v2-featured" id="home-v2-featured"></div>' +

      // Secondary 2x2 grid
      '<div class="home-v2-actions">' +
        '<button class="home-v2-action" id="home-v2-contest" data-action="contest" aria-label="תחרות חברים">' +
          '<span class="home-v2-badge" id="home-v2-contest-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">👥</span>' +
          '<span class="home-v2-action-label">תחרות</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-challenge" data-action="challenge" aria-label="אתגרי BLOOM">' +
          '<span class="home-v2-badge home-v2-badge-prize" id="home-v2-challenge-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">🏆</span>' +
          '<span class="home-v2-action-label">אתגרים</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-duel" data-action="duel" aria-label="דו-קרב 1v1">' +
          '<span class="home-v2-badge" id="home-v2-duel-badge" style="display:none"></span>' +
          '<span class="home-v2-action-icon" aria-hidden="true">⚔️</span>' +
          '<span class="home-v2-action-label">דו-קרב</span>' +
        '</button>' +
        '<button class="home-v2-action" id="home-v2-skins" data-action="skins" aria-label="חנות סקינים">' +
          '<span class="home-v2-action-icon" aria-hidden="true">🎨</span>' +
          '<span class="home-v2-action-label">סקינים</span>' +
        '</button>' +
      '</div>' +

      // Weekly + Jackpot (reuse hosts so v1/v2 helpers paint them)
      '<div id="home-weekly-host"></div>' +
      '<div class="home-jackpot" id="home-jackpot"></div>' +

      // Bottom links area
      '<div class="home-v2-bottom">' +
        (hasSeenTour()
          ? '<button class="home-v2-link" id="home-v2-tour">📖 איך משחקים?</button>'
          : '<button class="home-v2-link home-v2-link-skip" id="home-v2-skip">דלג על הסיור</button>') +
        '<button class="home-v2-link" id="home-v2-invite">📱 הזמן חבר</button>' +
        '<button class="home-v2-link home-v2-switch" id="home-v3-back">↩ הגירסה הקודמת</button>' +
        '<a class="home-v2-link" href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a>' +
      '</div>';

    app.appendChild(h);
    syncHomeMuteUI();

    // Wire handlers (mostly reuse v2's enter() pattern)
    document.getElementById('home-mute').onclick = function(e) {
      e.stopPropagation();
      ensureAudio();
      openMuteMenu('home');
    };

    const enter = function() {
      ensureAudio();
      hideHomeV3();
      const wrap = document.getElementById('grid-wrap');
      const onOverScreen = wrap && wrap.querySelector('.overlay');
      if (onOverScreen) init('practice');
      playMusic('game');
      startEventSystem();
      if (mode === 'contest' && activeContestCode && !overtakeTimer) {
        startOvertakeWatch(activeContestCode);
      }
    };

    document.getElementById('home-v3-start').onclick = function() {
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
      if (typeof showChallengesList === 'function') showChallengesList('home-v3');
    };
    document.getElementById('home-v2-duel').onclick = function() {
      ensureAudio();
      if (typeof showDuelModal === 'function') showDuelModal();
    };
    document.getElementById('home-v2-skins').onclick = function() {
      if (typeof showSkinShop === 'function') showSkinShop();
    };

    // Mascot easter-egg: tap to wink + soundDrop
    const mascot = document.getElementById('home-v3-mascot');
    if (mascot) {
      mascot.style.cursor = 'pointer';
      mascot.style.pointerEvents = 'auto';
      mascot.onclick = function() {
        mascot.classList.add('mascot-wink');
        try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
        setTimeout(function() { mascot.classList.remove('mascot-wink'); }, 600);
      };
    }

    // What's-new dismiss
    const wnDismiss = document.getElementById('home-v3-wn-dismiss');
    if (wnDismiss) wnDismiss.onclick = function() {
      try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW_VERSION); } catch (e) {}
      const banner = document.getElementById('home-v3-whats-new');
      if (banner) banner.style.display = 'none';
    };

    // Bottom links
    const tourBtn = document.getElementById('home-v2-tour');
    if (tourBtn) tourBtn.onclick = function() { ensureAudio(); showTour({ onDone: enter }); };
    const skipBtn = document.getElementById('home-v2-skip');
    if (skipBtn) skipBtn.onclick = enter;
    const inviteBtn = document.getElementById('home-v2-invite');
    if (inviteBtn) inviteBtn.onclick = function(e) {
      e.stopPropagation();
      if (typeof whatsappInviteV2 === 'function') whatsappInviteV2();
    };
    const backBtn = document.getElementById('home-v3-back');
    if (backBtn) backBtn.onclick = function() {
      disableHomeV3();
      hideHomeV3();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('home');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
      showHome(); // falls through to v2 (current default)
    };

    // Reuse v2 painters where possible
    if (typeof renderHeroBannerV2 === 'function')        renderHeroBannerV2();
    if (typeof renderPlayerIdV2 === 'function')          renderPlayerIdV2();
    renderMyStatsV3();
    if (typeof refreshHomeV2LivePulse === 'function')    refreshHomeV2LivePulse();
    if (typeof refreshFeaturedActionV2 === 'function')   refreshFeaturedActionV2();
    if (typeof refreshHomeChallengeCta === 'function')   refreshHomeChallengeCta();
    if (typeof refreshHomeJackpot === 'function')        refreshHomeJackpot();
    if (typeof refreshHomeWeekly === 'function')         refreshHomeWeekly();
    if (typeof startHomeV2LivePulse === 'function')      startHomeV2LivePulse();

    // F5: lazy-load badges — defer fetch by 300ms so they don't block
    // the first paint. requestIdleCallback when available.
    function deferBadges() {
      if (typeof refreshHomeV2Badges === 'function') refreshHomeV2Badges();
    }
    if (window.requestIdleCallback) {
      requestIdleCallback(deferBadges, { timeout: 800 });
    } else {
      setTimeout(deferBadges, 300);
    }

    playMusic('lobby');

    setTimeout(function() {
      if (document.getElementById('home-screen')) showDailyLoginReward();
    }, 600);

    if (!hasSeenTour() && getOnboardStep() === 0) {
      setTimeout(function() {
        if (document.getElementById('home-screen') && !hasSeenTour()) showTour();
      }, 900);
    }
  }

  function hideHomeV3() {
    if (typeof stopHomeV2LivePulse === 'function') stopHomeV2LivePulse();
    const h = document.getElementById('home-screen');
    if (h) h.remove();
  }

  function buildWhatsNewBanner() {
    try {
      const seen = localStorage.getItem(WHATS_NEW_KEY);
      if (seen === WHATS_NEW_VERSION) return '';
    } catch (e) {}
    return '<div class="home-v3-whats-new" id="home-v3-whats-new">' +
      '<span class="home-v3-wn-sparkle">✨</span>' +
      '<span class="home-v3-wn-text">' + WHATS_NEW_BODY + '</span>' +
      '<button class="home-v3-wn-dismiss" id="home-v3-wn-dismiss" aria-label="סגור">✕</button>' +
    '</div>';
  }

  function buildPregameTeaserHtml(goal) {
    return '<div class="home-v3-teaser" id="home-v3-teaser" role="note">' +
      '<span class="teaser-icon">🎯</span>' +
      '<span class="teaser-text">' +
        'הגע ל-<strong>' + escapeV3(goal.name) + ' ' + escapeV3(goal.emoji) + '</strong> במשחק הבא — ' +
        'בונוס של <strong>+' + goal.reward.toLocaleString() + ' נקודות</strong>' +
      '</span>' +
    '</div>';
  }

  function renderMyStatsV3() {
    const el = document.getElementById('home-v2-mystats');
    if (!el) return;
    const total = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    const bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    if (total === 0) { el.style.display = 'none'; return; }

    const wkDelta = getWeekDelta();
    const totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    const totalH = Math.floor(totalMs / 3600000);
    const totalM = Math.floor((totalMs % 3600000) / 60000);
    const timeText = totalH > 0 ? totalH + 'ש ' + totalM + 'ד' : totalM + ' דקות';

    let weekBit = '';
    if (wkDelta && wkDelta.thisWeek > 0) {
      let arrow = '';
      if (wkDelta.delta != null) {
        if (wkDelta.delta > 0)      arrow = ' <span class="mystats3-up">↑' + wkDelta.delta + '</span>';
        else if (wkDelta.delta < 0) arrow = ' <span class="mystats3-down">↓' + Math.abs(wkDelta.delta) + '</span>';
        else                        arrow = ' <span class="mystats3-flat">=</span>';
      }
      weekBit = '<span class="mystats2-item">📅 השבוע <strong>' + wkDelta.thisWeek + '</strong>' + arrow + '</span>';
    }

    el.innerHTML =
      '<span class="mystats2-item">🎮 <strong>' + total.toLocaleString() + '</strong></span>' +
      (weekBit ? '<span class="mystats2-sep">·</span>' + weekBit : '') +
      (bestEver > 0 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">🏆 <strong>' + bestEver.toLocaleString() + '</strong></span>' : '') +
      (totalMs > 60000 ? '<span class="mystats2-sep">·</span><span class="mystats2-item">⏱ ' + timeText + '</span>' : '');
    el.style.display = '';
  }

  // ===== Flower mascot SVG (Claude Design — hand-rolled) =====
  // Five-petal flower with eyes, a smile, and a leafy stem. All shapes
  // are inline so the mascot inherits currentColor and dark-mode shifts
  // without an extra request. Animated via .home-v3-mascot CSS classes.
  function buildFlowerMascotSvg() {
    return '<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg" class="mascot-svg">' +
      // Stem
      '<path d="M50 60 Q50 80 50 100" stroke="#4D8C4D" stroke-width="3.5" stroke-linecap="round" fill="none"/>' +
      // Leaf
      '<ellipse cx="42" cy="80" rx="9" ry="5" fill="#6BCB77" transform="rotate(-25 42 80)"/>' +
      // Petals — 5 around the center
      '<circle class="mascot-petal mascot-petal-1" cx="50" cy="20" r="14" fill="#F4C0D1"/>' +
      '<circle class="mascot-petal mascot-petal-2" cx="78" cy="38" r="14" fill="#F4C0D1"/>' +
      '<circle class="mascot-petal mascot-petal-3" cx="68" cy="62" r="14" fill="#F4C0D1"/>' +
      '<circle class="mascot-petal mascot-petal-4" cx="32" cy="62" r="14" fill="#F4C0D1"/>' +
      '<circle class="mascot-petal mascot-petal-5" cx="22" cy="38" r="14" fill="#F4C0D1"/>' +
      // Center disc (face)
      '<circle cx="50" cy="42" r="16" fill="#FAC775"/>' +
      // Eyes (each in its own <g> so we can blink them independently)
      '<g class="mascot-eye mascot-eye-left">' +
        '<circle cx="44" cy="40" r="2.4" fill="#1C1A18"/>' +
        '<circle cx="44.7" cy="39.3" r="0.7" fill="#FFF"/>' +
      '</g>' +
      '<g class="mascot-eye mascot-eye-right">' +
        '<circle cx="56" cy="40" r="2.4" fill="#1C1A18"/>' +
        '<circle cx="56.7" cy="39.3" r="0.7" fill="#FFF"/>' +
      '</g>' +
      // Cheeks
      '<circle cx="40" cy="47" r="2" fill="#F08AA8" opacity="0.6"/>' +
      '<circle cx="60" cy="47" r="2" fill="#F08AA8" opacity="0.6"/>' +
      // Smile
      '<path d="M45 48 Q50 53 55 48" stroke="#1C1A18" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
    '</svg>';
  }

  function escapeV3(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
