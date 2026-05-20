  async function init(nextMode, opts) {
    opts = opts || {};
    const fresh = !!opts.fresh;
    // A FRESH game gets a new gameId — the ad-watch flow uses this id for
    // server-side per-game dedup (one ad reward per finished game). Non-fresh
    // re-inits (e.g., daily-already-played replay screen, contest mode
    // restore) keep the existing id so refreshing doesn't issue a new one.
    if (fresh && typeof regenerateGameId === 'function') regenerateGameId();
    // Sweep any celebration banners left over from the previous round —
    // setTimeout can be paused by tab-blur or skipped on page-hide, leaving
    // a stuck modal over the board. clearTransientBanners is idempotent.
    if (typeof clearTransientBanners === 'function') clearTransientBanners();
    if (nextMode) mode = nextMode;
    dailyDate = todayInIsrael();
    // Resolve per-game difficulty BEFORE the first board paint. Daily stays
    // admin-only so its leaderboard is comparable. Practice reads from
    // localStorage. Contest/duel pull from their fetched row (set later).
    sessionDifficulty = null;
    if (mode === 'practice') sessionDifficulty = readPracticeDifficulty();
    grid = Array.from({length: getBoardRows()}, function() { return Array(getBoardCols()).fill(0); });
    score = 0; highestTier = 1; busy = false; dropsCount = 0;
    window.__bloomGameOver = false; // new game = active again
    currentGameMaxChain = 0;
    tierUpHit = {};   // reset milestone-bonus tracker for this fresh game
    scoreMilestonesHit = {}; // reset score milestones
    bestBeatenThisGame = false; // reset live best tracking
    usedContinue = false; // reset second chance
    // Clear duel mode unless this init was called from startDuelGame
    if (!opts.keepDuel) { window._duelMode = false; window._duelOpponentName = ''; }
    gameMergesPerTier = {};
    gamePointsPerTier = {};
    gameBestMergeTier = 0;
    gameTotalMerges = 0;
    gameStartTime = Date.now();
    trackEvent('game_start', { mode: mode });
    leaderboard = [];
    dailyRank = null;
    // Cleared at top of init: by the time we know we're entering contest mode,
    // we'll re-set this to the contest code the new game belongs to. For non-
    // contest modes it stays null — saveContestGameState() then no-ops.
    activeGameContestCode = null;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    if (mode === 'daily') {
      const seed = hashSeed('bloom-' + dailyDate);
      rng = mulberry32(seed);
      const priorRaw = localStorage.getItem(DAILY_PLAYED_PREFIX + dailyDate);
      if (priorRaw) {
        dailySubmitted = true;
        try {
          const prior = JSON.parse(priorRaw);
          score = prior.score || 0;
          highestTier = prior.tier || 1;
        } catch (e) {}
        nextPiece = pickPiece();
        updateModeBar();
        render({ over: true, alreadyPlayed: true });
        loadLeaderboard();
        return;
      }
      dailySubmitted = false;
    } else {
      rng = Math.random;
      dailySubmitted = false;
    }
    let restoredContestState = false;
    // Reset all live-broadcast state for a fresh game in this contest. The
    // server side fades within LIVE_FRESH_SECONDS regardless, but resetting
    // here means there's no flicker of stale data when toggling modes.
    if (spectatorSession) stopSpectator(false);
    stopLivePush();
    if (mode === 'contest') {
      contestSubmitted = false;
      if (activeContestCode) {
        // AWAIT the fetch — without this, switching contests uses the previous
        // contest's board_seed for the new game (visual state-leak that the
        // user reported: "המערכת זוכרת את המשחק שלו רק מאחת מהתחרויות").
        // We only block if activeContestData is missing or stale; if the cache
        // already matches activeContestCode the fetch is best-effort.
        if (!activeContestData || activeContestData.code !== activeContestCode) {
          const data = await fetchContest(activeContestCode).catch(function() { return null; });
          if (data && data.contest) {
            activeContestData = data.contest;
          } else if (!activeContestData) {
            // Fetch failed and no cached data — can't determine board seed.
            // Fall back to practice so the player isn't stuck on a broken board.
            console.warn('[init] contest fetch failed, falling back to practice');
            mode = 'practice';
            rng = Math.random;
            updateModeBar();
            render();
            maybeOnboardStep1();
            return;
          }
        } else {
          fetchContest(activeContestCode).then(function(data) {
            if (data && data.contest) activeContestData = data.contest;
          }).catch(function() {});
        }
        fetchMyContests().then(function() { updateModeBar(); }).catch(function() {});
      }
      rng = activeContestData && activeContestData.board_seed != null
        ? mulberry32(activeContestData.board_seed)
        : Math.random;
      // Apply the host-chosen difficulty to this contest game. Stored on
      // the contest row at creation time so changing the preset table
      // later never re-balances live contests.
      if (activeContestData && activeContestData.difficulty_weights) {
        sessionDifficulty = {
          label: activeContestData.difficulty_label || 'custom',
          weights: activeContestData.difficulty_weights,
          speed_pct: activeContestData.difficulty_speed_pct || null
        };
      }
      if (fresh) {
        clearContestGameState();
      } else if (activeContestCode) {
        const saved = loadContestGameState(activeContestCode);
        if (saved) {
          grid = saved.grid;
          score = saved.score | 0;
          highestTier = saved.highestTier || 1;
          currentGameMaxChain = saved.maxChain || 0;
          if (saved.nextPiece) {
            nextPiece = saved.nextPiece;
            restoredContestState = true;
          }
        }
      }
      // Tag the in-memory game with its owning contest BEFORE any save can fire.
      // From this point, saveContestGameState() routes by activeGameContestCode
      // — so switching activeContestCode (My Contests row click) won't pollute
      // the new contest's saved slot with this contest's grid.
      activeGameContestCode = activeContestCode;
    } else if (mode === 'challenge') {
      // Challenges run on a fixed seed shared across all entrants for fairness.
      // No save/restore — closing the tab = forfeit, by design.
      if (activeChallenge && activeChallenge.boardSeed != null) {
        rng = mulberry32(activeChallenge.boardSeed);
      } else {
        rng = Math.random;
      }
    } else if (mode === 'practice') {
      // Restore practice state when switching back from another tab.
      if (fresh) {
        clearPracticeGameState();
      } else {
        const saved = loadPracticeGameState();
        if (saved) {
          grid = saved.grid;
          score = saved.score | 0;
          highestTier = saved.highestTier || 1;
          currentGameMaxChain = saved.maxChain || 0;
          dropsCount = saved.drops || 0;
          gameMergesPerTier = saved.mergesPerTier || {};
          gamePointsPerTier = saved.pointsPerTier || {};
          gameTotalMerges = saved.totalMerges || 0;
          if (saved.startTime) gameStartTime = saved.startTime;
          usedContinue = saved.usedContinue || false;
          if (saved.nextPiece) {
            nextPiece = saved.nextPiece;
            restoredContestState = true; // reuse flag to skip pickPiece
          }
        }
      }
    }
    if (!restoredContestState) nextPiece = pickPiece();
    updateModeBar();
    render();
    // Watch for opponents passing my score while I'm mid-game in a contest.
    if (mode === 'contest' && activeContestCode) startOvertakeWatch(activeContestCode);
    else stopOvertakeWatch();
    // First-drop ping so spectators / leaderboards see the entry immediately.
    if (mode === 'challenge' && activeChallenge) pushChallengeScore();
    // Onboarding: nudge the first-time player on the very first board paint.
    maybeOnboardStep1();
    // Persist current mode so page refresh restores context.
    try { localStorage.setItem('bloom_last_mode', mode); } catch (e) {}
    // Start event drops system
    startEventSystem();
  }

  function updateModeBar() {
    const bar = document.getElementById('mode-bar');
    const title = document.getElementById('mode-title');
    const sub = document.getElementById('mode-sub');
    const tabsEl = document.getElementById('mode-tabs');
    const infoEl = document.getElementById('mode-info');
    const chevEl = document.getElementById('mode-info-chevron');
    if (!bar) return;

    // Title + subtitle reflect the current mode
    if (mode === 'daily') {
      bar.classList.remove('practice');
      title.textContent = 'אתגר יומי · ' + formatDateHe(dailyDate);
      sub.textContent = "אותו דאנג'ן לכולם היום";
    } else if (mode === 'contest') {
      bar.classList.remove('practice');
      title.textContent = 'תחרות חברים';
      var contestDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var contestDiffStr = contestDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + contestDiffPreset.emoji + ' ' + contestDiffPreset.name
        : '';
      sub.textContent = (activeContestData ? activeContestData.name : 'תחרות פעילה') + contestDiffStr;
    } else if (mode === 'challenge' && activeChallenge) {
      bar.classList.remove('practice');
      title.textContent = '🎁 אתגר פרס';
      sub.textContent = activeChallenge.name || activeChallenge.prizeText || 'אתגר פעיל';
    } else if (skinTrialMode && skinTrialId) {
      bar.classList.add('practice');
      var trialPack = SKIN_PACKS[skinTrialId];
      title.textContent = '🎨 ניסיון · ' + (trialPack ? trialPack.name : '');
      sub.textContent = 'ניקוד לא נשמר · שחק ותחליט';
    } else if (window._duelMode && activeDuelId) {
      bar.classList.remove('practice');
      title.textContent = '⚔️ דו-קרב 1v1';
      var duelDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var duelDiffStr = duelDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + duelDiffPreset.emoji + ' ' + duelDiffPreset.name
        : '';
      sub.textContent = 'vs ' + (window._duelOpponentName || 'יריב') + duelDiffStr;
    } else {
      bar.classList.add('practice');
      title.textContent = 'משחק חופשי';
      var pdiff = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label]
        ? DIFFICULTY_PRESETS[sessionDifficulty.label]
        : DIFFICULTY_PRESETS.default;
      // Compact single-line subtitle. Previously this was "<chip> · תתחרה על
      // לוח המובילים 🏆" which wrapped to a second line on narrow phones,
      // stealing pixels from grid-wrap → fitGrid shrank every cell. Now: chip
      // + small trophy icon for "counts toward leaderboard" (or muted "off"
      // when difficulty != default). Tooltip on hover gives the full meaning.
      var lbBadge = sessionDifficulty
        ? '<span title="לא נספר ללוח המובילים" style="color:#A8A6A0;font-size:11px;margin-right:6px">⊘</span>'
        : '<span title="נספר ללוח המובילים" style="margin-right:6px;font-size:12px">🏆</span>';
      sub.innerHTML = '<button class="practice-diff-chip" id="practice-diff-chip" type="button" aria-label="החלף רמת קושי">' +
        pdiff.emoji + ' ' + pdiff.name + ' <span style="opacity:0.6">⌄</span></button>' + lbBadge;
    }
    // Wire the practice difficulty chip (added in practice branch above).
    var pdBtn = document.getElementById('practice-diff-chip');
    if (pdBtn) {
      pdBtn.onclick = function(e) {
        e.stopPropagation();
        showPracticeDifficultyPicker();
      };
    }

    // In contest mode, the mode-info area becomes a tap target that opens
    // the contest leaderboard — this is the fastest "show me the players"
    // path while in-game. Chevron hints that it's interactive.
    if (infoEl) {
      if (mode === 'contest' && activeContestCode) {
        infoEl.classList.add('clickable');
        if (chevEl) chevEl.style.display = '';
        infoEl.onclick = function() {
          saveContestGameState();
          showContestLeaderboard(activeContestCode);
        };
      } else {
        infoEl.classList.remove('clickable');
        if (chevEl) chevEl.style.display = 'none';
        infoEl.onclick = null;
      }
    }

    // Build/update the segmented tab control. The "חברים" tab appears only
    // when the player has an active contest code. Tapping it: with 2+
    // contests, opens the My Contests list so the player can choose; with 1,
    // jumps straight into that contest like before.
    if (!tabsEl) return;
    const tabs = [{ id: 'daily', label: 'יומי' }];
    if (activeContestCode) tabs.push({ id: 'contest', label: 'חברים' });
    tabs.push({ id: 'challenge', label: 'אתגרים' });
    tabs.push({ id: 'practice', label: 'חופשי' });
    tabsEl.innerHTML = tabs.map(function(t) {
      return '<button class="mode-tab' + (t.id === mode ? ' active' : '') +
        '" data-mode="' + t.id + '">' + t.label + '</button>';
    }).join('');
    tabsEl.querySelectorAll('.mode-tab').forEach(function(btn) {
      btn.onclick = function() {
        const target = btn.getAttribute('data-mode');
        if (target === mode && target !== 'contest' && target !== 'challenge') return;
        buzz([12]); // subtle haptic on tab switch
        if (mode === 'contest') saveContestGameState();
        if (mode === 'practice') savePracticeGameState();
        // No saveChallengeGameState — challenges intentionally don't survive navigation.
        if (target === 'contest' && myContestsCountSync() >= 2) {
          showMyContestsList();
          return;
        }
        if (target === 'challenge') {
          // The "אתגרים" tab opens the public challenges hub. It's not an
          // in-game mode you can flip into — you have to pick a specific
          // challenge from the list and confirm before starting.
          // Track entry point so the back arrow returns to the game, not home.
          showChallengesList('in-game');
          return;
        }
        init(target);
      };
    });
  }

  // Picker modal for practice difficulty. Player chooses, we save to
  // localStorage and restart the practice game so the new weights take
  // effect cleanly on a fresh board. Daily/contest/duel use other paths.
  function showPracticeDifficultyPicker() {
    var existing = document.getElementById('pdp-modal');
    if (existing) existing.remove();
    var current = (sessionDifficulty && sessionDifficulty.label) || 'default';
    var modal = document.createElement('div');
    modal.id = 'pdp-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var optionsHtml = '';
    var order = ['default', 'easy', 'medium', 'hard', 'insane'];
    var hints = {
      default: 'משקלי האדמין (ברירת מחדל). הניקוד נספר ללוח המובילים היומי.',
      easy:    'אריחים נמוכים שולטים — נעים לחימום. הניקוד לא נספר ללוח.',
      medium:  'בעיקר tier 2-4 — יותר אתגר. הניקוד לא נספר ללוח.',
      hard:    'בעיקר tier 3-5 — לוח מתמלא מהר, ניקוד גבוה למיזוגים. הניקוד לא נספר ללוח.',
      insane:  'אבן ועלה לא נופלים בכלל. רק לרוצחים סדרתיים. הניקוד לא נספר ללוח.'
    };
    for (var k = 0; k < order.length; k++) {
      var key = order[k];
      var p = DIFFICULTY_PRESETS[key];
      var isCur = key === current;
      optionsHtml += '<button class="pdp-opt" data-diff="' + key + '" style="display:block;width:100%;text-align:right;direction:rtl;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid ' + (isCur ? '#BA7517' : 'rgba(0,0,0,0.08)') + ';background:' + (isCur ? '#FFF6E6' : '#FFFFFF') + ';cursor:pointer;font-family:inherit">' +
        '<div style="font-size:14px;font-weight:700;color:#1C1A18">' + p.emoji + ' ' + p.name + (isCur ? '  <span style="color:#BA7517;font-size:11px">✓ נבחר</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:#6F6E68;margin-top:2px">' + hints[key] + '</div>' +
      '</button>';
    }
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:6px">💪 רמת קושי · אימון חופשי</div>' +
      '<div style="font-size:11px;color:#6F6E68;margin-bottom:12px">בחירת רמה תפתח משחק חדש. רק "רגיל" נספר בלוח המובילים היומי.</div>' +
      optionsHtml +
      '<button class="btn secondary" id="pdp-cancel" style="width:100%;margin-top:6px">בטל</button>' +
    '</div>';
    document.body.appendChild(modal);
    document.getElementById('pdp-cancel').onclick = function() { modal.remove(); };
    modal.querySelectorAll('.pdp-opt').forEach(function(btn) {
      btn.onclick = function() {
        var label = btn.getAttribute('data-diff') || 'default';
        writePracticeDifficulty(label === 'default' ? null : label);
        modal.remove();
        // Fresh game with the new weights — never carry old grid into new difficulty.
        init('practice', { fresh: true });
      };
    });
  }

  function startCountdown() {
    function tick() {
      const el = document.getElementById('countdown-val');
      if (!el) { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
      const remaining = msUntilNextIsraelMidnight();
      el.textContent = formatCountdown(remaining);
      if (remaining <= 0) {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        init('daily');
      }
    }
    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function renderLeaderboard() {
    const isContest = mode === 'contest';
    const headerText = isContest
      ? ((activeContestData && activeContestData.name) ? activeContestData.name : 'תחרות חברים')
      : 'טבלת מובילים · ' + formatDateHe(dailyDate);
    const emptyText = isContest ? 'אין עדיין שחקנים בתחרות' : 'אתה הראשון היום!';
    if (leaderboardLoading) {
      return '<div class="leaderboard"><div class="lb-head"><span>' + escapeHtml(headerText) + '</span></div><div class="lb-loading">טוען…</div></div>';
    }
    if (!leaderboard.length) {
      return '<div class="leaderboard"><div class="lb-head"><span>' + escapeHtml(headerText) + '</span></div><div class="lb-empty">' + emptyText + '</div></div>';
    }
    const topScore = leaderboard[0] ? leaderboard[0].score : 1;
    const rows = leaderboard.slice(0, 15).map(function(row, i) {
      const isYou = row.you;
      const rank = i + 1;
      const seed = isYou ? deviceId : (row.name || 'anon');
      var rankClass = rank === 1 ? ' lb-top1' : rank === 2 ? ' lb-top2' : rank === 3 ? ' lb-top3' : '';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
      // Gap to player above
      var gapText = '';
      if (rank > 1 && isYou && i > 0) {
        var above = leaderboard[i - 1];
        var gap = (above.score || 0) - (row.score || 0);
        if (gap > 0) gapText = '<div class="lb-gap you-gap">↑ עוד ' + gap.toLocaleString() + ' למקום ' + (rank - 1) + '</div>';
      }
      return '<div class="lb-row' + rankClass + (isYou ? ' you' : '') + '">' +
        '<div class="lb-rank">' + medal + '</div>' +
        renderAvatarHtml(seed, 'sm') +
        '<div style="flex:1;overflow:hidden">' +
          '<div class="lb-name">' + escapeHtml(row.name || 'אנונימי') + (isYou ? ' <span style="font-size:10px;opacity:0.7">(אתה)</span>' : '') + '</div>' +
          gapText +
        '</div>' +
        '<div class="lb-score">' + (row.score || 0).toLocaleString() + '</div>' +
      '</div>';
    }).join('');
    var yourRank = -1;
    var yourGapText = '';
    for (var j = 0; j < leaderboard.length; j++) {
      if (leaderboard[j].you) {
        yourRank = j + 1;
        if (j > 0) {
          var gap = (leaderboard[j-1].score || 0) - (leaderboard[j].score || 0);
          if (gap > 0) yourGapText = ' (עוד ' + gap.toLocaleString() + ' נקודות)';
        }
        break;
      }
    }
    var motivationText = '';
    if (yourRank === 1) motivationText = '👑 אתה מוביל!';
    else if (yourRank > 0 && yourRank <= 3) motivationText = '🔥 אתה בטופ 3!' + yourGapText;
    else if (yourRank > 0 && yourRank <= 5) motivationText = '💪 מקום ' + yourRank + yourGapText;
    else if (yourRank > 0) motivationText = '🎯 מקום ' + yourRank + yourGapText;

    return '<div class="leaderboard">' +
      '<div class="lb-head"><span>' + escapeHtml(headerText) + '</span><span>' + leaderboard.length + ' שחקנים</span></div>' +
      '<div class="lb-list">' + rows + '</div>' +
      (motivationText ? '<div style="text-align:center;font-size:12px;font-weight:600;margin-top:8px;color:#BA7517">' + motivationText + '</div>' : '') +
    '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  async function submitAndShowLeaderboard() {
    // Skip score submission during skin trial
    if (skinTrialMode) {
      await loadLeaderboard();
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dailyDate,
          deviceId: deviceId,
          name: (playerName || 'אנונימי').slice(0, 24),
          score: score,
          tier: highestTier,
          drops: dropsCount | 0,
          token: deviceToken,
          country: getCountry() || null
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.rank === 'number') dailyRank = data.rank;
        // Earn credits for daily completion
        if (!window.__bloomBotActive && mode === 'daily') earnCredits('daily_complete');
        trackEvent('game_over', { mode: mode, score: score, tier: highestTier });
      }
    } catch (e) {
      console.warn('Submit failed:', e);
    }
    // Practice + duel scores also feed the difficulty leaderboard. Daily
    // mode is excluded by design (fairness — the daily seed is uniform and
    // its difficulty is admin-controlled, never per-player).
    submitPracticeOrDuelScore();
    await loadLeaderboard();
  }

  // Writes one row to difficulty_scores per game so the "לפי קושי" tab can
  // aggregate best-per-difficulty across practice + duel without polluting
  // the daily leaderboard. No-op for daily mode and during skin trials.
  function submitPracticeOrDuelScore() {
    if (skinTrialMode) return;
    if (mode !== 'practice') return; // engine uses practice mode for duels too
    if (window.__bloomBotActive) return;
    var label = (sessionDifficulty && sessionDifficulty.label) || 'default';
    var source = window._duelMode ? 'duel' : 'practice';
    try {
      fetch(API_BASE + '/api/score/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dailyDate,
          deviceId: deviceId,
          name: (playerName || 'אנונימי').slice(0, 24),
          score: score,
          tier: highestTier,
          drops: dropsCount | 0,
          token: deviceToken,
          country: getCountry() || null,
          difficulty: label,
          source: source
        })
      }).catch(function() {});
    } catch (e) {}
  }

  async function loadLeaderboard() {
    leaderboardLoading = true;
    const wrap = document.getElementById('grid-wrap');
    if (wrap && wrap.querySelector('.leaderboard')) {
      wrap.querySelector('.leaderboard').outerHTML = renderLeaderboard();
    }
    try {
      const url = API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        leaderboard = (data && data.list) || [];
        if (data && typeof data.rank === 'number') dailyRank = data.rank;
      }
    } catch (e) {
      console.warn('Load leaderboard failed:', e);
    }
    leaderboardLoading = false;
    if (wrap) render({ over: true, alreadyPlayed: dailySubmitted });
  }

  async function loadContestLeaderboard() {
    if (!activeContestCode) return;
    leaderboardLoading = true;
    const wrap = document.getElementById('grid-wrap');
    if (wrap && wrap.querySelector('.leaderboard')) {
      wrap.querySelector('.leaderboard').outerHTML = renderLeaderboard();
    }
    const data = await fetchContest(activeContestCode);
    if (data && data.players) {
      updateMyWatchersFromContestData(data);
      leaderboard = data.players.map(function(p) {
        const total = (p.score | 0) + (p.liveScore == null ? 0 : (p.liveScore | 0));
        return { name: p.name, score: total, tier: p.tier, you: !!p.you, liveScore: p.liveScore };
      });
      if (data.contest) activeContestData = data.contest;
    }
    leaderboardLoading = false;
    if (wrap) render({ over: true });
  }

  /* ============ LEADERBOARD MODAL (scope × time × difficulty) ============ */
  // Two-axis filter: scope (world / country / difficulty) + period (day/week/month).
  // Difficulty scope adds a third pill row to pick the preset. Admin can hide
  // any scope via gameConfig.leaderboard_tabs_enabled. Last selection persisted
  // to localStorage so a returning player lands where they left off.
  const LB_SCOPE_KEY = 'bloom_lb_scope';
  const LB_PERIOD_KEY = 'bloom_lb_period';
  const LB_DIFF_KEY = 'bloom_lb_difficulty';
  let lbModalScope = localStorage.getItem(LB_SCOPE_KEY) || 'world';
  let lbModalPeriod = localStorage.getItem(LB_PERIOD_KEY) || 'day';
  let lbModalDifficulty = localStorage.getItem(LB_DIFF_KEY) || 'default';
  let lbModalList = [];
  let lbModalLoading = false;
  let lbModalRange = null;
  let lbModalRank = null;
  let lbModalNeedsCountry = false;

  function getEnabledLbTabs() {
    var raw = (typeof gameConfig === 'object' && gameConfig && gameConfig.leaderboard_tabs_enabled) || 'world,country,difficulty';
    var arr = String(raw).split(',').map(function(s) { return s.trim(); })
      .filter(function(s) { return s === 'world' || s === 'country' || s === 'difficulty'; });
    return arr.length ? arr : ['world'];
  }

  function lbScopeLabel(s) {
    if (s === 'country') {
      var cc = getCountry();
      return cc ? (flagEmoji(cc) + ' מדינתי') : '🇮🇱 מדינתי';
    }
    if (s === 'difficulty') return '🎚️ קושי';
    return '🌍 עולמי';
  }
  function lbPeriodLabel(p) { return p === 'month' ? 'חודשי' : p === 'week' ? 'שבועי' : 'יומי'; }

  function openLeaderboardModal() {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('lb-modal')) return;
    const enabled = getEnabledLbTabs();
    if (enabled.indexOf(lbModalScope) < 0) lbModalScope = enabled[0];
    const modal = document.createElement('div');
    modal.id = 'lb-modal';
    modal.className = 'info-modal';

    const scopeBtns = enabled.map(function(s) {
      return '<button class="lb-tab lb-scope-tab" data-scope="' + s + '">' + lbScopeLabel(s) + '</button>';
    }).reverse().join(''); // reversed because the row is direction:ltr inside RTL

    modal.innerHTML =
      '<div class="info-card lb-modal-card" style="direction:rtl;max-width:380px">' +
        '<button class="info-close" id="lb-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div style="text-align:center;margin-bottom:4px"><span style="font-size:22px">🏆</span></div>' +
        '<div class="info-title" style="margin-bottom:6px">טבלת מובילים</div>' +
        (enabled.length > 1 ?
          '<div class="lb-tabs" style="direction:ltr;margin-bottom:4px">' + scopeBtns + '</div>' : '') +
        '<div class="lb-tabs lb-period-tabs" style="direction:ltr;margin-bottom:4px">' +
          '<button class="lb-tab lb-period-tab" data-period="month">חודשי</button>' +
          '<button class="lb-tab lb-period-tab" data-period="week">שבועי</button>' +
          '<button class="lb-tab lb-period-tab" data-period="day">יומי</button>' +
        '</div>' +
        '<div id="lb-diff-row" class="lb-tabs lb-diff-tabs" style="direction:ltr;margin-bottom:4px;display:none">' +
          '<button class="lb-tab lb-diff-tab" data-diff="insane">💀 גהינום</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="hard">🔥 קשה</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="medium">🎯 בינוני</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="easy">😊 קל</button>' +
          '<button class="lb-tab lb-diff-tab" data-diff="default">📦 ברירת מחדל</button>' +
        '</div>' +
        '<div id="lb-modal-range" style="font-size:11px;color:#A8A6A0;text-align:center;margin-bottom:6px"></div>' +
        '<div id="lb-modal-body" style="max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch"></div>' +
        '<div id="lb-modal-footer" style="text-align:center;margin-top:8px"></div>' +
        '<div style="text-align:center;margin-top:8px">' +
          '<button class="btn secondary" id="lb-flag-edit" type="button" style="font-size:11px;padding:6px 12px">' +
            (getCountry() ? (flagEmoji(getCountry()) + ' החלף דגל') : '🌍 בחר דגל') +
          '</button>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('lb-modal-close').onclick = closeLeaderboardModal;
    modal.onclick = function(e) { if (e.target === modal) closeLeaderboardModal(); };
    modal.querySelectorAll('.lb-scope-tab').forEach(function(t) {
      t.onclick = function() { switchLbScope(t.getAttribute('data-scope')); };
    });
    modal.querySelectorAll('.lb-period-tab').forEach(function(t) {
      t.onclick = function() { switchLbPeriod(t.getAttribute('data-period')); };
    });
    modal.querySelectorAll('.lb-diff-tab').forEach(function(t) {
      t.onclick = function() { switchLbDifficulty(t.getAttribute('data-diff')); };
    });
    document.getElementById('lb-flag-edit').onclick = function() {
      closeLeaderboardModal();
      promptForCountry(function() { openLeaderboardModal(); });
    };
    refreshLbActiveStates();
    loadLbModal();
  }

  function closeLeaderboardModal() {
    const m = document.getElementById('lb-modal');
    if (m) m.remove();
  }

  function refreshLbActiveStates() {
    document.querySelectorAll('#lb-modal .lb-scope-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-scope') === lbModalScope);
    });
    document.querySelectorAll('#lb-modal .lb-period-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-period') === lbModalPeriod);
    });
    document.querySelectorAll('#lb-modal .lb-diff-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-diff') === lbModalDifficulty);
    });
    const diffRow = document.getElementById('lb-diff-row');
    if (diffRow) diffRow.style.display = lbModalScope === 'difficulty' ? '' : 'none';
  }

  function switchLbScope(scope) {
    lbModalScope = scope;
    try { localStorage.setItem(LB_SCOPE_KEY, scope); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }
  function switchLbPeriod(period) {
    lbModalPeriod = period;
    try { localStorage.setItem(LB_PERIOD_KEY, period); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }
  function switchLbDifficulty(d) {
    lbModalDifficulty = d;
    try { localStorage.setItem(LB_DIFF_KEY, d); } catch (e) {}
    refreshLbActiveStates();
    loadLbModal();
  }

  async function loadLbModal() {
    lbModalLoading = true;
    lbModalNeedsCountry = false;
    renderLbModalBody();
    try {
      var qs = 'scope=' + encodeURIComponent(lbModalScope) +
        '&period=' + encodeURIComponent(lbModalPeriod) +
        '&endDate=' + encodeURIComponent(dailyDate) +
        '&deviceId=' + encodeURIComponent(deviceId);
      if (lbModalScope === 'difficulty') qs += '&difficulty=' + encodeURIComponent(lbModalDifficulty);
      if (lbModalScope === 'country' && getCountry()) qs += '&country=' + encodeURIComponent(getCountry());
      const url = API_BASE + '/api/leaderboard/v2?' + qs;
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        lbModalList = (data && data.list) || [];
        lbModalRange = data ? { from: data.from, to: data.to, total: data.total } : null;
        lbModalRank = data && typeof data.rank === 'number' ? data.rank : null;
        lbModalNeedsCountry = !!(data && data.needsCountry);
      } else {
        lbModalList = []; lbModalRange = null; lbModalRank = null;
      }
    } catch (e) {
      console.warn('Load lb-modal failed:', e);
      lbModalList = []; lbModalRange = null; lbModalRank = null;
    }
    lbModalLoading = false;
    renderLbModalBody();
  }

  function renderLbModalBody() {
    const body = document.getElementById('lb-modal-body');
    const rangeEl = document.getElementById('lb-modal-range');
    const footerEl = document.getElementById('lb-modal-footer');
    if (!body) return;
    if (lbModalLoading) {
      body.innerHTML = '<div class="lb-loading">טוען…</div>';
      if (rangeEl) rangeEl.textContent = '';
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    // Range text
    if (rangeEl && lbModalRange) {
      var rangeStr = (lbModalPeriod === 'day')
        ? formatDateHe(lbModalRange.to) + ' · ' + (lbModalRange.total || 0) + ' שחקנים'
        : formatDateHe(lbModalRange.from) + ' – ' + formatDateHe(lbModalRange.to) + ' · ' + (lbModalRange.total || 0) + ' שחקנים';
      if (lbModalScope === 'difficulty') {
        var DIFF_NAMES = { default: '📦 ברירת מחדל', easy: '😊 קל', medium: '🎯 בינוני', hard: '🔥 קשה', insane: '💀 גהינום' };
        rangeStr = (DIFF_NAMES[lbModalDifficulty] || lbModalDifficulty) + ' · ' + rangeStr;
      } else if (lbModalScope === 'country' && getCountry()) {
        rangeStr = flagEmoji(getCountry()) + ' ' + countryName(getCountry()) + ' · ' + rangeStr;
      }
      rangeEl.textContent = rangeStr;
    }
    if (lbModalNeedsCountry) {
      body.innerHTML =
        '<div class="lb-empty" style="padding:24px 16px;text-align:center">' +
          '<div style="font-size:32px;margin-bottom:8px">🌍</div>' +
          '<div style="margin-bottom:10px">בחר את המדינה שלך כדי לראות את הטבלה המדינית</div>' +
          '<button class="btn" type="button" id="lb-empty-flag">בחר דגל</button>' +
        '</div>';
      var btn = document.getElementById('lb-empty-flag');
      if (btn) btn.onclick = function() {
        closeLeaderboardModal();
        promptForCountry(function() { openLeaderboardModal(); });
      };
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    if (!lbModalList.length) {
      body.innerHTML = '<div class="lb-empty">אין עדיין ניקודים בטווח הזה</div>';
      if (footerEl) footerEl.innerHTML = '';
      return;
    }
    const topScore = lbModalList[0] ? lbModalList[0].score : 1;
    const showFlag = lbModalScope === 'world';
    const rows = lbModalList.slice(0, 50).map(function(row, i) {
      const isYou = row.you;
      const rank = i + 1;
      const seed = isYou ? deviceId : (row.name || 'anon');
      var rankClass = rank === 1 ? ' lb-top1' : rank === 2 ? ' lb-top2' : rank === 3 ? ' lb-top3' : '';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
      var gapText = '';
      if (rank > 1 && isYou && i > 0) {
        var above = lbModalList[i - 1];
        var gap = (above.score || 0) - (row.score || 0);
        if (gap > 0) gapText = '<div class="lb-gap you-gap">↑ עוד ' + gap.toLocaleString() + ' למקום ' + (rank - 1) + '</div>';
      }
      var flagHtml = '';
      if (showFlag) {
        var rowCc = row.country || '';
        flagHtml = '<span class="lb-flag" title="' + (rowCc ? countryName(rowCc) : 'לא צוין') + '">' +
          (rowCc ? flagEmoji(rowCc) : '🏳️') + '</span>';
      }
      // Challenge affordance — only on rows with a known BLOOM code and not "you".
      var canChallenge = !isYou && row.player_code && /^BLOOM-[A-HJ-NP-Z2-9]{4}$/.test(row.player_code);
      var rowExtra = canChallenge ? ' lb-row-challengeable" data-pcode="' + row.player_code + '" data-pname="' + escapeHtml(row.name || 'אנונימי') + '"' : '"';
      var challengeBtn = canChallenge ? '<button class="lb-row-challenge" type="button" data-challenge title="אתגר ל-1v1">⚔️</button>' : '';
      return '<div class="lb-row' + rankClass + (isYou ? ' you' : '') + rowExtra + '>' +
        '<div class="lb-rank">' + medal + '</div>' +
        renderAvatarHtml(seed, 'sm') +
        '<div style="flex:1;overflow:hidden">' +
          '<div class="lb-name">' + escapeHtml(row.name || 'אנונימי') + flagHtml + (isYou ? ' <span style="font-size:10px;opacity:0.7">(אתה)</span>' : '') + '</div>' +
          gapText +
        '</div>' +
        '<div class="lb-score">' + (row.score || 0).toLocaleString() + '</div>' +
        challengeBtn +
      '</div>';
    }).join('');
    body.innerHTML = '<div class="lb-list">' + rows + '</div>';

    // Delegated click handler — challenge a leaderboard row by tapping it or
    // the ⚔️ button. Opens the duel modal with the suffix pre-filled.
    var listEl = body.querySelector('.lb-list');
    if (listEl) {
      listEl.addEventListener('click', function(e) {
        var rowEl = e.target.closest('.lb-row-challengeable');
        if (!rowEl) return;
        var code = rowEl.getAttribute('data-pcode') || '';
        if (!code) return;
        var suffix = code.replace(/^BLOOM-/, '');
        closeLeaderboardModal();
        if (typeof showDuelModal === 'function') {
          setTimeout(function() { showDuelModal({ prefillSuffix: suffix }); }, 120);
        }
      });
    }

    // Motivation footer
    if (footerEl) {
      var yourRank = lbModalRank || -1;
      if (yourRank <= 0) {
        for (var j = 0; j < lbModalList.length; j++) { if (lbModalList[j].you) { yourRank = j + 1; break; } }
      }
      var mot = '';
      var gapToAbove = '';
      if (yourRank > 1) {
        for (var k = 0; k < lbModalList.length; k++) {
          if (lbModalList[k].you && k > 0) {
            var gap = (lbModalList[k-1].score || 0) - (lbModalList[k].score || 0);
            if (gap > 0) gapToAbove = ' (עוד ' + gap.toLocaleString() + ' נקודות)';
            break;
          }
        }
      }
      if (yourRank === 1) mot = '<span style="font-size:13px;font-weight:700;color:#BA7517">👑 אתה מוביל!</span>';
      else if (yourRank > 0 && yourRank <= 3) mot = '<span style="font-size:13px;font-weight:700;color:#BA7517">🔥 אתה בטופ 3!' + gapToAbove + '</span>';
      else if (yourRank > 0 && yourRank <= 5) mot = '<span style="font-size:12px;font-weight:600;color:#BA7517">💪 מקום #' + yourRank + gapToAbove + '</span>';
      else if (yourRank > 0 && yourRank <= 10) mot = '<span style="font-size:12px;font-weight:600;color:#6F6E68">⬆️ מקום #' + yourRank + gapToAbove + '</span>';
      else if (yourRank > 0) mot = '<span style="font-size:12px;color:#6F6E68">🎯 מקום #' + yourRank + gapToAbove + '</span>';
      footerEl.innerHTML = mot;
    }
  }

  // Flag picker — shown once after the name picker on first home view, then
  // never again unless the user reopens it from the leaderboard modal. Null
  // (skipped) is a valid final state: country tab simply excludes those rows.
  function promptForCountry(cb) {
    var wrap = document.getElementById('grid-wrap');
    if (!wrap || document.getElementById('country-modal')) { cb && cb(); return; }
    var modal = document.createElement('div');
    modal.id = 'country-modal';
    modal.className = 'info-modal';
    var grid = COUNTRY_LIST.map(function(row) {
      return '<button class="country-cell" data-cc="' + row[0] + '" type="button">' +
        '<div style="font-size:28px;line-height:1">' + flagEmoji(row[0]) + '</div>' +
        '<div style="font-size:11px;margin-top:2px;color:#1C1A18">' + row[1] + '</div>' +
      '</button>';
    }).join('');
    modal.innerHTML =
      '<div class="info-card" style="direction:rtl;max-width:420px">' +
        '<button class="info-close" id="country-modal-close" aria-label="סגור">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div style="text-align:center;margin-bottom:6px"><span style="font-size:28px">🌍</span></div>' +
        '<div class="info-title" style="margin-bottom:2px">מאיפה אתה משחק?</div>' +
        '<div class="info-sub" style="margin-bottom:10px">הדגל יופיע ליד הניקוד שלך בטבלה. נשמר במכשיר — אפשר לשנות בהמשך.</div>' +
        '<input class="name-input" id="country-search" type="search" autocapitalize="words" placeholder="🔎 חפש מדינה..." style="margin-bottom:10px" />' +
        '<div id="country-grid" class="country-grid" style="max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:4px 0">' + grid + '</div>' +
        '<div style="margin-top:10px;text-align:center"><button class="btn secondary" id="country-skip" type="button">העדפתי לא לומר</button></div>' +
      '</div>';
    wrap.appendChild(modal);
    var grid_el = document.getElementById('country-grid');
    var search = document.getElementById('country-search');
    function pick(cc) {
      setCountry(cc);
      playerCountry = cc || '';
      trackEvent('country_selected', { country: cc || 'skip' });
      modal.remove();
      cb && cb();
    }
    grid_el.addEventListener('click', function(e) {
      var t = e.target.closest('.country-cell');
      if (!t) return;
      pick(t.getAttribute('data-cc'));
    });
    document.getElementById('country-skip').onclick = function() { pick(''); };
    document.getElementById('country-modal-close').onclick = function() { pick(''); };
    modal.addEventListener('click', function(e) { if (e.target === modal) pick(''); });
    search.addEventListener('input', function() {
      var q = (search.value || '').trim().toLowerCase();
      var cells = grid_el.querySelectorAll('.country-cell');
      cells.forEach(function(c) {
        if (!q) { c.style.display = ''; return; }
        var cc = (c.getAttribute('data-cc') || '').toLowerCase();
        var name = (c.textContent || '').toLowerCase();
        c.style.display = (cc.indexOf(q) >= 0 || name.indexOf(q) >= 0) ? '' : 'none';
      });
    });
    setTimeout(function() { search && search.focus(); }, 50);
  }

  function promptForName(cb, opts) {
    opts = opts || {};
    const wrap = document.getElementById('grid-wrap') || document.body;
    if (!wrap || document.getElementById('name-modal')) { cb && cb(); return; }
    const modal = document.createElement('div');
    modal.id = 'name-modal';
    modal.className = 'info-modal';
    const isEdit = !!opts.edit;
    const prefillVal = (opts.prefill || (isEdit ? (playerName || '') : '')).replace(/"/g, '&quot;');
    modal.innerHTML =
      '<div class="info-card">' +
        '<div class="info-title">' + (isEdit ? 'עריכת שם' : 'איך לקרוא לך בטבלת המובילים?') + '</div>' +
        '<div class="info-sub">' + (isEdit ? 'השם יתעדכן בכל הטבלאות מיד.' : 'השם יישמר במכשיר ויופיע ליד התוצאה שלך.') + '</div>' +
        '<input class="name-input" id="name-input" autocapitalize="words" maxlength="24" placeholder="השם שלך" value="' + prefillVal + '" />' +
        '<button class="btn" id="name-save">שמור</button>' +
        '<button class="btn secondary" id="name-skip">' + (isEdit ? 'בטל' : 'דלג') + '</button>' +
      '</div>';
    wrap.appendChild(modal);
    const input = document.getElementById('name-input');
    setTimeout(function() {
      if (input) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
      }
    }, 50);
    function maybeChainCountry(after) {
      // Only chain the flag picker on the very first name-pick (no stored
      // country yet). Returning users keep the picker behind the leaderboard
      // modal's "edit my flag" affordance — don't interrupt their flow.
      if (isEdit) { after(); return; }
      if (!getCountry()) promptForCountry(after);
      else after();
    }
    function syncServerName(name) {
      if (!name || name === 'אנונימי') return;
      try {
        fetch(API_BASE + '/api/profile/name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, name: name })
        }).catch(function() {});
      } catch (e) {}
    }
    function save() {
      const v = (input.value || '').trim().slice(0, 24);
      if (v) {
        playerName = v;
        localStorage.setItem(NAME_KEY, v);
        syncServerName(v);
      }
      modal.remove();
      maybeChainCountry(function() { cb && cb(); });
    }
    function skip() {
      if (!playerName && !isEdit) { playerName = 'אנונימי'; }
      modal.remove();
      if (isEdit) { cb && cb(); return; }
      maybeChainCountry(function() { cb && cb(); });
    }
    document.getElementById('name-save').onclick = save;
    document.getElementById('name-skip').onclick = skip;
    input.onkeydown = function(e) { if (e.key === 'Enter') save(); };
  }

  // Drop pool resolution order:
  //   1) sessionDifficulty (per-game override: contest host / duel challenger / practice picker)
  //   2) gameConfig.drop_weights (admin global)
  //   3) WEIGHTS (the original 55/28/12/5 fallback)
  // Empty/malformed/all-zero at any layer falls through to the next.
  function getDropWeights() {
    var raw = '';
    if (sessionDifficulty && sessionDifficulty.weights) {
      raw = sessionDifficulty.weights;
    } else if (typeof gameConfig === 'object' && gameConfig && gameConfig.drop_weights) {
      raw = gameConfig.drop_weights;
    }
    if (!raw) return WEIGHTS;
    var parts = String(raw).split(',').map(function(x) { return parseInt(x, 10) || 0; });
    while (parts.length < 8) parts.push(0);
    parts.length = 8;
    var total = parts.reduce(function(a,b) { return a + Math.max(0, b); }, 0);
    if (total <= 0) return WEIGHTS;
    // Prepend the always-zero tier-0 slot so indices line up with the rest
    // of the engine (grid uses 1..MAX_TIER, 0 = empty).
    return [0, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]];
  }

  function pickPiece() {
    var weights = getDropWeights();
    var total = 0;
    for (var k = 1; k < weights.length; k++) total += Math.max(0, weights[k]);
    if (total <= 0) return 1;
    var r = rng() * total;
    for (var i = 1; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return i;
    }
    return 1;
  }

  // Speed resolution mirrors getDropWeights: session override → admin global
  // → default 100%. 50 = 2× faster, 100 = default, 200 = half-speed. Clamped
  // to [25, 400] so misconfig can't make the engine instant or unplayably slow.
  function gameSpeedScale() {
    var pct = 100;
    if (sessionDifficulty && sessionDifficulty.speed_pct) {
      pct = parseInt(sessionDifficulty.speed_pct, 10) || 100;
    } else {
      pct = parseInt((gameConfig && gameConfig.game_speed_pct) || '100', 10) || 100;
    }
    if (pct < 25) pct = 25;
    if (pct > 400) pct = 400;
    return pct / 100;
  }
  function gsleep(ms) { return sleep(Math.round(ms * gameSpeedScale())); }

  function findGroup(sr, sc, tier) {
    const visited = new Set();
    const group = [];
    const stack = [[sr, sc]];
    while (stack.length) {
      const pos = stack.pop();
      const r = pos[0], c = pos[1];
      const k = r * getBoardCols() + c;
      if (visited.has(k)) continue;
      if (r < 0 || r >= getBoardRows() || c < 0 || c >= getBoardCols()) continue;
      if (grid[r][c] !== tier) continue;
      visited.add(k);
      group.push([r, c]);
      stack.push([r-1,c], [r+1,c], [r,c-1], [r,c+1]);
    }
    return group;
  }

  function applyGravity() {
    var moves = 0;
    for (let c = 0; c < getBoardCols(); c++) {
      let w = getBoardRows() - 1;
      for (let r = getBoardRows() - 1; r >= 0; r--) {
        if (grid[r][c] !== 0) {
          if (r !== w) { grid[w][c] = grid[r][c]; grid[r][c] = 0; moves++; }
          w--;
        }
      }
    }
    if (window.__bloomEngineLog) console.log('[gravity]', 'moves=' + moves, 'grid=' + serializeGrid());
  }
  // Compact one-line grid serialization for engine logs. Each row is printed
  // bottom-up as 4 digits (0 = empty, 1-8 = tier). Lets the user paste a
  // console line and instantly see the board state at that moment.
  function serializeGrid() {
    var s = '';
    for (var r = getBoardRows() - 1; r >= 0; r--) {
      var row = '';
      for (var c = 0; c < getBoardCols(); c++) row += (grid[r][c] | 0);
      s += row + (r === 0 ? '' : '|');
    }
    return s;
  }
  // Expose to window so the user can call from devtools console to dump
  // state at any moment ("why is this tile floating?").
  window.__bloomDumpGrid = function() {
    var lines = [];
    for (var r = 0; r < getBoardRows(); r++) {
      var row = '';
      for (var c = 0; c < getBoardCols(); c++) {
        var v = grid[r][c] | 0;
        row += v === 0 ? '·' : v;
      }
      lines.push('r' + r + ' ' + row);
    }
    console.log('[grid dump]\n' + lines.join('\n'));
    return grid.map(function(r) { return r.slice(); });
  };

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function showFloatingScore(row, col, points, chainCount) {
    const gridEl = document.getElementById('grid');
    if (!gridEl) return;
    const cellIdx = row * getBoardCols() + col;
    const cell = gridEl.children[cellIdx];
    if (!cell) return;
    const cellRect = cell.getBoundingClientRect();
    const fl = document.createElement('div');
    fl.className = 'float-score';
    fl.textContent = '+' + points.toLocaleString();
    if (chainCount >= 3) { fl.style.fontSize = '18px'; fl.style.background = '#EF9F27'; fl.style.color = '#412402'; fl.style.boxShadow = '0 4px 12px rgba(239,159,39,0.4)'; }
    else if (chainCount >= 2) { fl.style.fontSize = '16px'; }
    fl.style.position = 'fixed';
    fl.style.left = cellRect.left + cellRect.width / 2 + 'px';
    fl.style.top = cellRect.top + 'px';
    document.body.appendChild(fl);
    setTimeout(function() { fl.remove(); }, 1100);
  }

  function showChainBadge(chainCount, multiplier) {
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#EF9F27;color:#412402;font-weight:900;font-size:' + (18 + chainCount * 2) + 'px;padding:10px 24px;border-radius:24px;letter-spacing:0.05em;pointer-events:none;text-align:center;box-shadow:0 6px 20px rgba(239,159,39,0.4);animation:chainPop 0.75s ease-out forwards';
    badge.textContent = '🔥 שרשרת ×' + multiplier;
    document.body.appendChild(badge);
    setTimeout(function() { badge.remove(); }, 750);
  }

  // First-time-tier-up celebration. Bigger, slower, gold-on-black banner.
  // Fires at most once per (tier, game) — checked at the call site.
  function showMilestoneBanner(tier, bonusPts) {
    const t = (getActiveTiers() && getActiveTiers()[tier]) || { name: 'דרגה ' + tier, emoji: '⭐' };
    showTransientBanner({
      tag: 'tier-up',
      holdMs: 1200, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#1C1A18,#412402);color:#FAC775;border:2px solid #FAC775;border-radius:18px;padding:16px 26px;pointer-events:auto;text-align:center;direction:rtl;box-shadow:0 12px 36px rgba(0,0,0,0.35);min-width:180px',
      html: '<div style="font-size:16px;font-weight:700;color:#FFD37A;margin-bottom:4px">' + t.emoji + ' ' + escapeHtml(t.name) + '</div>' +
        '<div style="font-size:32px;font-weight:900">+' + bonusPts.toLocaleString() + '</div>' +
        '<div style="font-size:10px;color:#BA7517;margin-top:4px">בונוס פעם-ראשונה!</div>',
    });
  }

  // Crown Merge explosion — gold wave across the row
  function showCrownExplosion(row) {
    // Full-screen gold flash — uses the same data-bloom-banner sweep so a
    // stuck flash from the previous round can't linger.
    var flash = document.createElement('div');
    flash.setAttribute('data-bloom-banner', 'crown-flash');
    flash.style.cssText = 'position:fixed;inset:0;background:rgba(250,199,117,0.25);z-index:9998;pointer-events:none';
    document.body.appendChild(flash);
    var flashGone = false;
    function killFlash() { if (flashGone) return; flashGone = true; try { flash.remove(); } catch (e) {} }
    setTimeout(function() { flash.style.transition = 'opacity 0.3s'; flash.style.opacity = '0'; }, 200);
    setTimeout(killFlash, 500);
    setTimeout(killFlash, 2000); // safety net for tab-throttling
    // Banner — click-to-dismiss + auto-cleanup via showTransientBanner
    var banner = showTransientBanner({
      tag: 'crown',
      holdMs: 1500, fadeMs: 500,
      exitTransform: 'translate(-50%,-60%) scale(0.9)',
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.5);opacity:0;z-index:9999;background:linear-gradient(135deg,#1C1A18,#412402);color:#FAC775;border:3px solid #FAC775;border-radius:20px;padding:20px 32px;pointer-events:auto;text-align:center;box-shadow:0 0 40px rgba(250,199,117,0.5);min-width:200px;transition:transform 0.3s,opacity 0.2s',
      html: '<div style="font-size:22px;font-weight:800">💥 Crown Merge! 👑</div><div style="font-size:32px;font-weight:900;margin-top:4px">+50,000</div><div style="font-size:12px;color:#BA7517;margin-top:4px">שורה נמחקה!</div>',
      afterAppend: function(el) {
        requestAnimationFrame(function() { el.style.transform = 'translate(-50%,-50%) scale(1)'; el.style.opacity = '1'; });
      },
    });
    showConfetti(40);
    // Flash grid row gold + scale
    var gridEl = document.getElementById('grid');
    if (gridEl) {
      for (var cc = 0; cc < getBoardCols(); cc++) {
        var idx = row * getBoardCols() + cc;
        var cell = gridEl.children[idx];
        if (cell) {
          cell.style.transition = 'background 0.15s,transform 0.15s';
          cell.style.background = '#FAC775';
          cell.style.transform = 'scale(1.1)';
          (function(c) { setTimeout(function() { c.style.background = ''; c.style.transform = ''; c.style.transition = ''; }, 600); })(cell);
        }
      }
    }
  }

  // Score milestone celebrations during gameplay
  var SCORE_MILESTONES = [
    { at: 10000,  label: '🔥 10K!',  reward: 2 },
    { at: 25000,  label: '⚡ 25K!',  reward: 3 },
    { at: 50000,  label: '⭐ 50K!',  reward: 5 },
    { at: 100000, label: '💎 100K!', reward: 10 },
    { at: 200000, label: '👑 200K!', reward: 20 },
    { at: 500000, label: '🌟 500K!', reward: 50 }
  ];
  var scoreMilestonesHit = {};

  function checkScoreMilestones() {
    for (var i = 0; i < SCORE_MILESTONES.length; i++) {
      var m = SCORE_MILESTONES[i];
      if (score >= m.at && !scoreMilestonesHit[m.at]) {
        scoreMilestonesHit[m.at] = true;
        showScoreMilestoneBanner(m.label, m.reward);
        if (m.reward > 0 && !window.__bloomBotActive && !skinTrialMode) {
          // Pass unique threshold as meta so each milestone is deduped individually
          earnCredits('event_gift', { amount: m.reward, milestone: m.at });
        }
      }
    }
  }

  function showScoreMilestoneBanner(label, reward) {
    showTransientBanner({
      tag: 'milestone',
      holdMs: 1000, fadeMs: 300,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:linear-gradient(135deg,#0F0D0B,#1C1A18);color:#FAC775;border:1px solid rgba(250,199,117,0.3);border-radius:18px;padding:14px 24px;pointer-events:auto;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.3);min-width:160px',
      html: '<div style="font-size:24px;font-weight:900;letter-spacing:0.05em">' + label + '</div>' +
        (reward > 0 ? '<div style="font-size:16px;font-weight:700;color:#BA7517;margin-top:4px">+' + reward + ' 💎</div>' : ''),
    });
    bumpScore();
    buzz([40, 60]);
    var msShake = parseInt(getEventConfig('shake_milestone', '2'), 10) || 0;
    if (msShake > 0) shakeGrid(msShake);
  }

  // Triple/Quad merge celebration
  function showMultiMergeBadge(count) {
    if (count < 3) return;
    var badge = document.createElement('div');
    var label = count === 3 ? '✨ Triple!' : count === 4 ? '💥 Quad!' : '🌟 MEGA ×' + count;
    badge.style.cssText = 'position:fixed;top:38%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:' + (count >= 4 ? '#FAC775' : '#EF9F27') + ';color:#412402;font-weight:900;font-size:' + (20 + count * 2) + 'px;padding:12px 28px;border-radius:24px;pointer-events:none;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.3);animation:chainPop 0.9s ease-out forwards';
    badge.textContent = label;
    document.body.appendChild(badge);
    buzz([60, 40]);
    var mmShake = parseInt(getEventConfig('shake_multi_merge', count >= 4 ? '6' : '3'), 10) || 0;
    if (mmShake > 0) shakeGrid(mmShake);
    setTimeout(function() { badge.remove(); }, 900);
  }

  // Screen shake — makes big merges feel impactful
  function shakeGrid(intensity) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var i = intensity || 3;
    gridEl.style.transition = 'none';
    var shakeCount = 0;
    var shakeInterval = setInterval(function() {
      var x = (Math.random() - 0.5) * i * 2;
      var y = (Math.random() - 0.5) * i * 2;
      gridEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      shakeCount++;
      if (shakeCount > 6) {
        clearInterval(shakeInterval);
        gridEl.style.transition = 'transform 0.1s';
        gridEl.style.transform = '';
      }
    }, 40);
  }

  let _scoreAnimFrame = 0;
  function bumpScore() {
    const el = document.getElementById('score');
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    // Count-up animation: smoothly roll the displayed number to current score
    var displayedScore = parseInt((el.textContent || '0').replace(/[^\d]/g, ''), 10) || 0;
    if (displayedScore >= score) return; // already at or past target
    var from = displayedScore, to = score;
    var token = ++_scoreAnimFrame;
    var start = performance.now();
    var duration = Math.min(320, Math.max(120, (to - from) / 8));
    function tick(now) {
      if (token !== _scoreAnimFrame) return; // superseded by newer animation
      var t = Math.min(1, (now - start) / duration);
      t = t * t * (3 - 2 * t); // ease-in-out smoothstep
      el.textContent = Math.round(from + (to - from) * t).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Smart survivor picker: for each cell in the merge group, simulate placing
  // the merged-up tile there, run gravity on a clone, then score the resulting
  // position. Picks the cell whose outcome is best for the player.
  // Scoring (highest wins):
  //   sameAdj  × 1,000,000  → an immediate chain (post-gravity neighbor of same tier)
  //   upAdj    ×     1,000  → ladder setup (neighbor of the next-up tier)
  //   landRow  ×       100  → prefer landing lower on the board (more headroom)
  //   surviveR ×        10  → among ties, prefer the bottommost original survivor (visual)
  //   anchor bonus          → small penalty for landing column far from drop column
  function pickSmartSurvivor(group, anchorC, newTier) {
    var rows = getBoardRows(), cols = getBoardCols();
    var bestScore = -Infinity, bestR = -1, bestC = -1;
    var SENTINEL = -1;
    for (var i = 0; i < group.length; i++) {
      var sr = group[i][0], sc = group[i][1];
      // Clone grid
      var sim = new Array(rows);
      for (var rr = 0; rr < rows; rr++) sim[rr] = grid[rr].slice();
      // Apply merge: clear all group cells, place sentinel at candidate survivor
      for (var j = 0; j < group.length; j++) {
        sim[group[j][0]][group[j][1]] = 0;
      }
      sim[sr][sc] = SENTINEL;
      // Apply gravity in-place on the clone (same algorithm as applyGravity)
      for (var c = 0; c < cols; c++) {
        var w = rows - 1;
        for (var r = rows - 1; r >= 0; r--) {
          if (sim[r][c] !== 0) {
            if (r !== w) { sim[w][c] = sim[r][c]; sim[r][c] = 0; }
            w--;
          }
        }
      }
      // Find the sentinel post-gravity
      var landR = -1, landC = -1;
      for (var rr2 = 0; rr2 < rows && landR < 0; rr2++) {
        for (var cc = 0; cc < cols; cc++) {
          if (sim[rr2][cc] === SENTINEL) { landR = rr2; landC = cc; sim[rr2][cc] = newTier; break; }
        }
      }
      if (landR < 0) continue;
      // Score adjacency
      var sameAdj = 0, upAdj = 0;
      var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var d = 0; d < 4; d++) {
        var nr = landR + dirs[d][0], nc = landC + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var v = sim[nr][nc];
        if (v === newTier) sameAdj++;
        else if (v === newTier + 1) upAdj++;
      }
      var ac = (anchorC != null ? anchorC : sc);
      var anchorBonus = -Math.abs(landC - ac);
      var score = sameAdj * 1000000 + upAdj * 1000 + landR * 100 + sr * 10 + anchorBonus;
      if (score > bestScore) { bestScore = score; bestR = sr; bestC = sc; }
    }
    if (bestR < 0) return null;
    return [bestR, bestC];
  }

  async function processChains(anchorRow, anchorCol) {
    // anchorRow/anchorCol: where the piece was dropped (first merge prefers
    // this cell as the survivor). For chain reactions after gravity, the
    // anchor shifts to the last merge position for natural visual flow.
    let chainCount = 0;
    const prevHighestTier = highestTier;
    while (true) {
      let merged = null;
      let mergedTier = 0;
      let mergeSize = 0;
      outer: for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const t = grid[r][c];
          if (t === 0) continue;
          const group = findGroup(r, c, t);
          if (group.length >= 2) {
            // ── CROWN MERGE SPECIAL: two crowns → explosion ──
            if (t === MAX_TIER && gameConfig.crown_merge_enabled !== 'false') {
              // Clear ALL crowns in the group
              for (let i = 0; i < group.length; i++) {
                grid[group[i][0]][group[i][1]] = 0;
              }
              // Clear the row where the bottommost crown was
              let clearRow = 0;
              for (let i = 0; i < group.length; i++) {
                if (group[i][0] > clearRow) clearRow = group[i][0];
              }
              for (let cc = 0; cc < getBoardCols(); cc++) grid[clearRow][cc] = 0;
              chainCount++;
              var crownBonus = parseInt(gameConfig.crown_merge_bonus, 10) || 50000;
              score += crownBonus;
              gameTotalMerges++;
              gameMergesPerTier[MAX_TIER] = (gameMergesPerTier[MAX_TIER] || 0) + 1;
              gamePointsPerTier[MAX_TIER] = (gamePointsPerTier[MAX_TIER] || 0) + crownBonus;
              showFloatingScore(clearRow, 1, crownBonus, chainCount);
              showCrownExplosion(clearRow);
              soundMilestone(MAX_TIER);
              bumpScore();
              checkScoreMilestones();
              buzz([100, 60, 120, 60, 100]);
              var crownShake = parseInt(getEventConfig('shake_crown_merge', '8'), 10) || 0;
              if (crownShake > 0) shakeGrid(crownShake);
              merged = [clearRow, 1];
              mergedTier = MAX_TIER;
              mergeSize = group.length;
              if (chainCount > currentGameMaxChain) currentGameMaxChain = chainCount;
              bumpLifetimeMax(BEST_CHAIN_KEY, chainCount);
              break outer;
            }
            // If crown merge disabled, skip crown tiles entirely (old behavior)
            if (t === MAX_TIER) continue;
            // ── REGULAR MERGE ──
            // Choose survivor cell. Modes (admin-controlled via gameConfig.merge_mode):
            //   'anchor'  → bottommost row; tie → closest to drop column (default)
            //   'classic' → bottommost row; tie → leftmost (Suika-style)
            //   'smart'   → simulate each candidate after gravity and pick the
            //               one that yields the best follow-up for the player
            //               (adjacent same-tier = chain potential, adjacent next-
            //               tier = ladder setup), tie-break by board depth then
            //               anchor proximity.
            let kr = -1, kc = -1;
            var mergeMode = gameConfig.merge_mode || 'anchor';
            var nextTierForPick = Math.min(t + 1, MAX_TIER);
            if (mergeMode === 'smart') {
              var smartPick = pickSmartSurvivor(group, anchorCol, nextTierForPick);
              if (smartPick) { kr = smartPick[0]; kc = smartPick[1]; }
            }
            if (kr < 0) {
              var useAnchor = mergeMode !== 'classic';
              for (let i = 0; i < group.length; i++) {
                const gr = group[i][0], gc = group[i][1];
                if (gr > kr) {
                  kr = gr; kc = gc;
                } else if (gr === kr) {
                  if (useAnchor) {
                    var distNew = Math.abs(gc - (anchorCol != null ? anchorCol : 0));
                    var distOld = Math.abs(kc - (anchorCol != null ? anchorCol : 0));
                    if (distNew < distOld) { kc = gc; }
                  } else {
                    if (gc < kc) { kc = gc; } // classic: leftmost wins
                  }
                }
              }
            }
            for (let i = 0; i < group.length; i++) {
              const gr = group[i][0], gc = group[i][1];
              if (gr === kr && gc === kc) continue;
              grid[gr][gc] = 0;
            }
            const nt = Math.min(t + 1, MAX_TIER);
            grid[kr][kc] = nt;
            chainCount++;
            // DIAGNOSTIC: log the merge BEFORE any potentially-throwing side
            // effects (showMilestoneBanner / showFloatingScore / etc) so even
            // if those break, we still see the merge in the console. Catches
            // the case where chain merges silently mutate grid without the
            // [merge] log firing (user reported floating tile after a chain).
            if (window.__bloomEngineLog) console.log('[merge-early]',
              'chain=' + chainCount, 'tier=t' + nt, 'size=' + group.length,
              'at=' + kr + ',' + kc, 'grid=' + serializeGrid());
            const multiplier = 1 + (chainCount - 1) * 0.5;
            var eventMult = getFeverMultiplier() * checkTargetMerge(nt);
            const points = Math.round(pointsFor(nt, group.length, multiplier) * eventMult);
            score += points;
            if (nt > highestTier) highestTier = nt;
            // Track per-tier merge stats for game-over summary
            gameMergesPerTier[nt] = (gameMergesPerTier[nt] || 0) + 1;
            gamePointsPerTier[nt] = (gamePointsPerTier[nt] || 0) + points;
            gameTotalMerges++;
            if (nt > gameBestMergeTier) gameBestMergeTier = nt;
            // First-time-tier-up bonus: when this merge brings the player's
            // highestTier to a milestone they haven't hit YET this game,
            // award the bonus. Drives the dopamine of "I just got Crown!".
            if (TIER_UP_BONUS[nt] && !tierUpHit[nt]) {
              tierUpHit[nt] = true;
              const bonusPts = TIER_UP_BONUS[nt];
              score += bonusPts;
              showMilestoneBanner(nt, bonusPts);
              soundMilestone(nt);
              bumpScore();
              buzz([60, 40, 80]);
              var tierShake = parseInt(getEventConfig('shake_tier_up', nt >= 7 ? '5' : '3'), 10) || 0;
              if (tierShake > 0) shakeGrid(tierShake);
            }
            merged = [kr, kc];
            mergedTier = nt;
            mergeSize = group.length;
            // Update anchor to last merge position — chain reactions follow the flow
            anchorRow = kr; anchorCol = kc;
            // SIDE EFFECTS (UI + audio + stats) — wrapped in try/catch so a
            // single broken DOM/audio call CAN'T derail the merge loop. Before
            // this guard, a TypeError inside showComboCounter (string vs Number)
            // skipped the trailing [merge] log + applyGravity, leaving a floating
            // tile that the render-time invariant had to clean up after the fact.
            try {
              showFloatingScore(kr, kc, points, chainCount);
              bumpScore();
              soundMerge(nt);
              checkScoreMilestones();
              if (group.length >= 3) showMultiMergeBadge(group.length);
              if (chainCount > currentGameMaxChain) currentGameMaxChain = chainCount;
              bumpLifetimeMax(BEST_CHAIN_KEY, chainCount);
              // Onboarding: first merge → step 2; first chain (≥2) → step 3.
              if (chainCount === 1) maybeOnboardStep2();
              else if (chainCount >= 2) maybeOnboardStep3();
              if (chainCount >= 2) {
                const m = chainCount === 2 ? 1.5 : chainCount === 3 ? 2 : chainCount === 4 ? 2.5 : 3;
                showChainBadge(chainCount, m);
                soundChain(chainCount);
                showComboCounter(chainCount, m);
              }
            } catch (sideEffectErr) {
              if (window.__bloomEngineLog) console.warn('[merge] side-effect failed (ignored)', sideEffectErr);
            }
            break outer;
          }
        }
      }
      if (!merged) break;
      if (window.__bloomEngineLog) console.log('[merge]', 'chain=' + chainCount, 'tier=t' + mergedTier, 'size=' + mergeSize, 'at=' + merged[0] + ',' + merged[1]);
      // Run gravity BEFORE the merge-highlight render so the player never
      // sees a "floating tile" sitting above a hole. Previously gravity ran
      // AFTER a 150ms pause — that window let a screenshot catch a tile
      // hanging in row 3 with row 4 empty. The merge cell (kr, kc) is the
      // bottom-most of the group, so gravity never moves IT — only the
      // tiles above the destroyed cells, which now slot in seamlessly
      // during the highlight pulse.
      applyGravity();
      render({ merging: merged, mergeChain: chainCount });
      // Aurora juice: text burst on chains 2+, score bump on every merge,
      // particles fly from the merged cell to the score counter. All no-op
      // for non-Aurora skins.
      if (typeof auroraShowTextBurst === 'function') auroraShowTextBurst(chainCount);
      if (typeof auroraScoreBump === 'function') auroraScoreBump();
      if (typeof auroraFlyParticlesToScore === 'function') {
        var mergedCellEl = document.querySelector(
          '#grid .cell[data-r="' + merged[0] + '"][data-c="' + merged[1] + '"]'
        );
        if (mergedCellEl) auroraFlyParticlesToScore(mergedCellEl, Math.min(6, 2 + chainCount));
      }
      await gsleep(150);
      render();
      await gsleep(80);
    }
    if (highestTier > prevHighestTier) {
      soundMilestone(highestTier);
      buzz([30, 40, 30]);
    }
    checkAchievements();
  }

  function isGameOver() {
    return grid[0].every(function(c) { return c !== 0; });
  }

  let queuedCol = -1; // next move queued while busy

  async function drop(col) {
    if (busy) {
      // Queue the next move — drops as soon as current finishes
      queuedCol = col;
      return;
    }
    let row = -1;
    for (let r = getBoardRows() - 1; r >= 0; r--) {
      if (grid[r][col] === 0) { row = r; break; }
    }
    if (row === -1) {
      // Column is full — check if the whole board is game-over
      if (isGameOver()) {
        busy = true; // prevent further taps
        window.__bloomGameOver = true; // stop heartbeat
        if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
        stopEventSystem();
        // Save best score BEFORE rendering game-over
        var isNewBest = score > best && !skinTrialMode;
        if (isNewBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
        soundGameOver();
        buzz([60, 80, 100]);
        playMusic('fail');
        if (!window.__bloomBotActive && !skinTrialMode) {
          incrementGamesPlayed();
          bumpLifetimeMax(BEST_TIER_KEY, highestTier);
          addLifetimeTotal(TOTAL_SCORE_KEY, score);
          var gameDuration = Date.now() - (gameStartTime || Date.now());
          var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY) + gameDuration;
          try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
        }
        checkAchievements();
        // Challenge game-over
        if (mode === 'challenge' && activeChallenge) {
          var w = document.getElementById('grid-wrap');
          if (w) w.innerHTML = '<div class="overlay"><div class="over-title">האתגר הסתיים</div><div class="contest-loading" style="margin-top:14px">שולח תוצאה…</div></div>';
          (async function() {
            var result = await completeChallengeRun();
            renderChallengeResult(result);
          })();
          return;
        }
        // Daily + Practice: submit to leaderboard.
        // PRACTICE EXCLUSION: if the player chose a non-default difficulty in
        // practice, the score is incomparable to the global daily leaderboard
        // and must NOT be submitted (fairness). Personal-best in localStorage
        // is still tracked above. Duels also run inside the practice mode
        // engine — never submit those to the daily leaderboard either.
        var practiceFairForLeaderboard = (mode === 'practice') && !sessionDifficulty && !window._duelMode;
        if (((mode === 'daily') || practiceFairForLeaderboard) && !dailySubmitted) {
          if (mode === 'daily') {
            dailySubmitted = true;
            localStorage.setItem(DAILY_PLAYED_PREFIX + dailyDate, JSON.stringify({ score: score, tier: highestTier, ts: Date.now() }));
          }
          render({ over: true, isNewBest: isNewBest });
          if (!window.__bloomBotActive && !skinTrialMode) {
            if (!playerName) {
              promptForName(function() { submitAndShowLeaderboard(); });
            } else {
              submitAndShowLeaderboard();
            }
          }
        } else {
          render({ over: true, isNewBest: isNewBest });
          // Non-fair practice/duel still feed the difficulty leaderboard —
          // submitAndShowLeaderboard() (which calls this) is skipped for them.
          if (mode === 'practice') submitPracticeOrDuelScore();
        }
        // Contest: submit score
        if (mode === 'contest' && !contestSubmitted && activeContestCode) {
          contestSubmitted = true;
          clearContestGameState();
          stopOvertakeWatch();
          setLastFinalScore(activeContestCode, score | 0);
          stopLivePush();
          activeGameContestCode = null;
          (async function() {
            await submitContestScore(activeContestCode, score, highestTier);
            await loadContestLeaderboard();
            if (!window.__bloomBotActive && leaderboard.length > 0) {
              for (var i = 0; i < Math.min(3, leaderboard.length); i++) {
                if (leaderboard[i].you) {
                  earnCredits(['contest_1st', 'contest_2nd', 'contest_3rd'][i]);
                  break;
                }
              }
            }
          })();
        }
        if (mode === 'practice') clearPracticeGameState();
        if (activeDuelId) submitDuelScore(score);
      }
      return;
    }
    busy = true;
    var _busyTimer = setTimeout(function() {
      // Safety valve: if busy stuck for 5 seconds, force-recover
      if (busy) { busy = false; try { render(); } catch(e) {} }
    }, 5000);
    queuedCol = -1;
    dropsCount++;
    ensureAudio();
    playMusic('game');
    soundDrop();
    if (!isSfxMuted()) buzz([8]);
    if (!streakBumpedThisSession) {
      bumpStreak();
      streakBumpedThisSession = true;
    }
    grid[row][col] = nextPiece;
    if (nextPiece > highestTier) highestTier = nextPiece;
    if (window.__bloomEngineLog) console.log('[drop]', 'col=' + col, '→ row=' + row, 'piece=t' + nextPiece, 'grid(after)=' + serializeGrid());
    var pendingEvent = (activeEvent && activeEvent.col === col) ? activeEvent : null;
    dismissCoach();
    render({ appearing: [row, col] });
    try {
    await gsleep(80);
    // Trigger the event FIRST when the player drops in the event column —
    // otherwise long chain reactions push the explosion off by 1-2s, which
    // feels like an unrelated event ("delay" bug the user reported). The
    // event itself handles its own gravity+render before chains continue.
    if (pendingEvent && activeEvent === pendingEvent) {
      triggerEvent(pendingEvent, row);
      // Brief pause so the explosion is visible before chain merges start
      // shifting the board around it.
      await gsleep(120);
    }
    await processChains(row, col);
    rollNextPiece();
    render();
    var isNewBest = score > best && !skinTrialMode;
    if (isNewBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
    if (isGameOver()) {
      clearTimeout(_busyTimer);
      window.__bloomGameOver = true; // stop heartbeat
      if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
      stopEventSystem();
      soundGameOver();
      buzz([60, 80, 100]);
      playMusic('fail');
      // Skip stat tracking when bot is playing (keep graphs clean)
      if (!window.__bloomBotActive && !skinTrialMode) {
        incrementGamesPlayed();
        bumpLifetimeMax(BEST_TIER_KEY, highestTier);
        addLifetimeTotal(TOTAL_SCORE_KEY, score);
        // Track total play time
        var gameDuration = Date.now() - (gameStartTime || Date.now());
        var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY) + gameDuration;
        try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
      }
      checkAchievements();
      // Challenges short-circuit the regular game-over screen — they get
      // their own bespoke "you won / you didn't" view from /complete.
      if (mode === 'challenge' && activeChallenge) {
        const w = document.getElementById('grid-wrap');
        if (w) w.innerHTML = '<div class="overlay"><div class="over-title">האתגר הסתיים</div><div class="contest-loading" style="margin-top:14px">שולח תוצאה…</div></div>';
        (async function() {
          const result = await completeChallengeRun();
          renderChallengeResult(result);
        })();
        return;
      }
      if (mode === 'daily' && !dailySubmitted) {
        dailySubmitted = true;
        localStorage.setItem(DAILY_PLAYED_PREFIX + dailyDate, JSON.stringify({ score: score, tier: highestTier, ts: Date.now() }));
        render({ over: true, isNewBest: isNewBest });
        if (!playerName) {
          promptForName(function() { submitAndShowLeaderboard(); });
        } else {
          submitAndShowLeaderboard();
        }
      } else if (mode === 'practice') {
        render({ over: true, isNewBest: isNewBest });
        // Practice scores go to the daily leaderboard, but ONLY when the
        // player is on the default difficulty — non-default would inflate
        // (or deflate) the score relative to other players. Duel games
        // also reuse the practice engine; never submit those to daily.
        var fair = !sessionDifficulty && !window._duelMode;
        if (fair && !window.__bloomBotActive && !skinTrialMode) {
          if (!playerName) {
            promptForName(function() { submitAndShowLeaderboard(); });
          } else {
            submitAndShowLeaderboard();
          }
        } else if (!fair && !window.__bloomBotActive && !skinTrialMode) {
          // Non-default practice or duel — feeds only the difficulty board.
          submitPracticeOrDuelScore();
        }
      } else {
        render({ over: true, isNewBest: isNewBest });
      }
      if (mode === 'practice') clearPracticeGameState();
      // Submit duel score if this was a duel game
      if (activeDuelId) submitDuelScore(score);
      if (mode === 'contest' && !contestSubmitted && activeContestCode) {
        contestSubmitted = true;
        clearContestGameState();
        stopOvertakeWatch();
        setLastFinalScore(activeContestCode, score | 0);
        stopLivePush();
        // Detach the in-memory state from the contest — future saveContestGameState()
        // calls (e.g. from beforeunload) won't pollute the just-cleared slot.
        activeGameContestCode = null;
        (async function() {
          await submitContestScore(activeContestCode, score, highestTier);
          await loadContestLeaderboard();
          // Award credits based on contest rank
          if (!window.__bloomBotActive && leaderboard.length > 0) {
            for (var i = 0; i < Math.min(3, leaderboard.length); i++) {
              if (leaderboard[i].you) {
                var actions = ['contest_1st', 'contest_2nd', 'contest_3rd'];
                earnCredits(actions[i]);
                break;
              }
            }
          }
        })();
      }
    }
    else {
      clearTimeout(_busyTimer);
      busy = false;
      render();
      // Save state after every move (prevents loss on refresh)
      if (mode === 'practice') savePracticeGameState();
      // Auto-play queued move (fast tapping)
      if (queuedCol >= 0) {
        var nextCol = queuedCol;
        queuedCol = -1;
        setTimeout(function() { drop(nextCol); }, 10);
        return;
      }
      if (mode === 'contest') {
        saveContestGameState();
        scheduleLiveScorePush();
        if (meHasWatchers) pushLiveState();
      }
      if (mode === 'challenge' && activeChallenge) {
        activeChallenge.drops = (activeChallenge.drops | 0) + 1;
        writeChallengeDrops(activeChallenge.slug, activeChallenge.drops);
        pushChallengeScore();
      }
      // In a 1v1 duel, push a heartbeat immediately after every drop so the
      // opponent's live spectator widget updates within ~1.5s (poll cadence)
      // instead of waiting up to 5s for the next periodic heartbeat.
      if (window._duelMode && typeof sendHeartbeat === 'function') {
        try { sendHeartbeat(); } catch (e) {}
      }
    }
    } catch(e) {
      // Error during drop/merge — recover so board doesn't freeze
      clearTimeout(_busyTimer);
      busy = false;
      try { render(); } catch(e2) {}
    }
  }

  function buildShareText() {
    var emojis = [];
    for (var t = 1; t <= highestTier; t++) emojis.push(getActiveTiers()[t].emoji);
    var gameDur = Date.now() - (gameStartTime || Date.now());
    var durMin = Math.floor(gameDur / 60000);
    var durSec = Math.floor((gameDur % 60000) / 1000);
    var durText = durMin > 0 ? durMin + ':' + String(durSec).padStart(2, '0') : durSec + ' שנ\'';
    var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY);
    var totalH = Math.floor(totalMs / 3600000);
    var totalM = Math.floor((totalMs % 3600000) / 60000);
    var totalText = totalH > 0 ? totalH + ' שעות ו-' + totalM + ' דקות' : totalM + ' דקות';
    var chainText = currentGameMaxChain >= 2 ? ' · 🔗×' + currentGameMaxChain : '';

    var header;
    if (mode === 'daily') {
      header = '🌸 BLOOM · אתגר יומי ' + formatDateHe(dailyDate) + '\n' + score.toLocaleString() + ' נקודות';
      if (dailyRank) header += ' · מקום #' + dailyRank;
    } else {
      header = '🌸 BLOOM — ' + score.toLocaleString() + ' נקודות';
    }
    var statsLine = '⏱' + durText + chainText + ' · 🎯' + gameTotalMerges + ' מיזוגים';
    var addictionLine = '🕐 סה"כ ' + totalText + ' ב-BLOOM';
    return header + '\n' + emojis.join('') + '\n' + statsLine + '\n' + addictionLine + '\n\nשחק גם: ' + getShareLink();
  }

  function shareResult() {
    var text = buildShareText();
    if (navigator.share) {
      navigator.share({ text: text }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        var btn = document.getElementById('share-btn');
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = '✓ הועתק ללוח';
          setTimeout(function() { btn.textContent = orig; }, 1600);
        }
      });
    }
  }

  function shareResultWhatsApp() {
    var text = buildShareText();
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    trackEvent('share', { method: 'whatsapp', type: 'result' });
  }

  function buildAddictionShareText() {
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    var totalHours = Math.floor(totalMs / 3600000);
    var totalMins = Math.floor((totalMs % 3600000) / 60000);
    var timeStr = totalHours > 0 ? totalHours + ' שעות ו-' + totalMins + ' דקות' : totalMins + ' דקות';
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    var bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    var s = loadStreak();
    var today = todayInIsrael();
    var streakN = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakN = 0;

    var text = '🕐 שיחקתי ' + timeStr + ' ב-BLOOM!\n';
    if (totalGames > 0) text += '🎮 ' + totalGames + ' משחקים';
    if (bestScore > 0) text += ' · 🏆 שיא: ' + bestScore.toLocaleString();
    if (streakN > 0) text += ' · 🔥 ' + streakN + ' ימים ברצף';
    text += '\n\nמסוגל/ת לנצח אותי? 😏\n' + getShareLink();
    return text;
  }

  function shareAddiction(via) {
    var text = buildAddictionShareText();
    trackEvent('share', { method: via, type: 'addiction' });
    if (via === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    } else if (navigator.share) {
      navigator.share({ text: text }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }

