  // ============================================================
  // Dynamic Boards — apply helpers (phase 3)
  // Centralises "given a board object, set up engine state for it"
  // so daily/practice/duel/dynamic all use the same logic. Supports:
  //   - type 'multipliers' → setColumnMultipliers(def.multipliers)
  //   - type 'special_cells' → setSpecialCells(def.cells)
  //   - definition.theme_id (any type) → applies a body class for
  //     visual theming (phase 4: holiday backgrounds + floating decor)
  // ============================================================
  // Phase 4 theme registry. Adding a new theme requires:
  //   1. Add an entry here
  //   2. Add server-side validation in validateBoardDefinition
  //   3. Add CSS rules under body.theme-{id}-active in boards.css
  var BOARD_THEMES = {
    hanukkah:       { name: 'חנוכה',         emoji: '🕎', cls: 'theme-hanukkah-active' },
    valentine:      { name: 'ולנטיין',       emoji: '💕', cls: 'theme-valentine-active' },
    yom_haatzmaut:  { name: 'יום העצמאות',   emoji: '🇮🇱', cls: 'theme-yom-haatzmaut-active' },
    passover:       { name: 'פסח',           emoji: '🍷', cls: 'theme-passover-active' }
  };
  function clearBoardThemeClasses() {
    var body = document.body;
    if (!body) return;
    Object.keys(BOARD_THEMES).forEach(function(k) {
      body.classList.remove(BOARD_THEMES[k].cls);
    });
  }
  function applyBoardTheme(themeId) {
    clearBoardThemeClasses();
    if (!themeId) return;
    var theme = BOARD_THEMES[themeId];
    if (!theme || !document.body) return;
    document.body.classList.add(theme.cls);
  }

  function applyBoardToSession(board) {
    if (!board || !board.definition || !board.type) {
      clearBoardThemeClasses();
      return false;
    }
    var def = board.definition;
    var ok = false;
    if (board.type === 'multipliers' && Array.isArray(def.multipliers)) {
      setColumnMultipliers(def.multipliers);
      ok = true;
    }
    if (board.type === 'special_cells' && Array.isArray(def.cells)) {
      setSpecialCells(def.cells);
      ok = true;
    }
    // 'themed' boards can carry cells + multipliers + theme_id in one
    // definition. We accept the type label and apply whatever's defined.
    if (board.type === 'themed') {
      if (Array.isArray(def.cells))       setSpecialCells(def.cells);
      if (Array.isArray(def.multipliers)) setColumnMultipliers(def.multipliers);
      ok = true;
    }
    if (!ok) {
      clearBoardThemeClasses();
      return false;
    }
    // Apply the visual theme last so it overlays everything.
    applyBoardTheme(def.theme_id);
    window._activeSpecialBoard = board;
    return true;
  }

  function applyDuelBoardSnapshot(duelRow) {
    // Duels currently snapshot only board_multipliers (phase 3 server
    // POST /api/duels). Special-cells duel snapshot lands in a future
    // phase — until then, treat missing fields as a vanilla duel.
    if (!duelRow) return false;
    var mults = duelRow.board_multipliers;
    if (typeof mults === 'string') {
      try { mults = JSON.parse(mults); } catch (e) { mults = null; }
    }
    if (Array.isArray(mults)) {
      setColumnMultipliers(mults);
      window._activeSpecialBoard = {
        name: duelRow.board_name || 'דו-קרב מיוחד',
        type: 'multipliers',
        definition: { multipliers: mults }
      };
      return true;
    }
    return false;
  }

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
    // Dynamic Boards (phase 3): clear ANY leftover board state at the top
    // of every init (column multipliers + special cells + theme class).
    // Each mode then re-applies its own board (if any) via the per-mode
    // resolution below. Guarantees that going from one mode to another
    // never leaks state.
    if (typeof setColumnMultipliers === 'function') setColumnMultipliers(null);
    if (typeof setSpecialCells === 'function') setSpecialCells(null);
    if (typeof clearBoardThemeClasses === 'function') clearBoardThemeClasses();
    window._activeSpecialBoard = null;
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
    _frozenThawProgress = {};   // reset frozen-cell thaw counters (phase 3D+)
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
    // Touch the "last play date" tracker so the comeback bonus on home
    // can compute days-since-last-play accurately. Side-effect free
    // (write-only); never throws.
    try { if (window.__bloomRecordLastPlay) window.__bloomRecordLastPlay(); } catch (e) {}
    leaderboard = [];
    dailyRank = null;
    dailyTotal = null;
    prevBest = best;
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
    } else if (mode === 'dynamic') {
      // Dynamic Boards mode — practice-like but bound to a selected board.
      // The board was applied by the picker BEFORE calling init('dynamic');
      // we restore it from window._activeDynamicBoard since the top-of-init
      // wiped the state.
      if (window._activeDynamicBoard) {
        applyBoardToSession(window._activeDynamicBoard);
      }
    }

    // Per-mode board apply (phase 3). Daily / practice / duel may have an
    // active board from the admin. Each branch resolves its source then
    // hands off to applyBoardToSession which knows how to apply BOTH
    // multipliers boards AND special_cells boards (and future types).
    // Fairness: practice + active board → submitPracticeOrDuelScore is
    // skipped by the leaderboard guard further down (see practiceFair...).
    try {
      if (mode === 'daily' && !dailySubmitted && typeof fetchBoardForMode === 'function') {
        const dailyBoard = await fetchBoardForMode('daily');
        if (dailyBoard) applyBoardToSession(dailyBoard);
      } else if (mode === 'practice' && !sessionDifficulty && !window._duelMode &&
                 typeof fetchBoardForMode === 'function') {
        const practiceBoard = await fetchBoardForMode('practice');
        if (practiceBoard) applyBoardToSession(practiceBoard);
      } else if (mode === 'practice' && window._duelMode && opts.duel) {
        // Duel snapshot: server stored the board on the duel row at
        // creation time. Use that directly — never re-fetch (would risk
        // mid-duel divergence between players).
        applyDuelBoardSnapshot(opts.duel);
      }
    } catch (boardErr) {
      // Board apply is best-effort. Failure = vanilla game (zero risk).
    }

    if (!restoredContestState) nextPiece = pickPiece();
    updateModeBar();
    render();
    // Toast at game start when a special board is active — the "wow"
    // moment that turns a routine daily into "today is different!".
    if (window._activeSpecialBoard && typeof showSpecialBoardToast === 'function') {
      try { showSpecialBoardToast(window._activeSpecialBoard); } catch (e) {}
    }
    // Watch for opponents passing my score while I'm mid-game in a contest.
    // The contest live HUD shares the same lifecycle — both mount on
    // contest-init and tear down on any other mode.
    if (mode === 'contest' && activeContestCode) {
      startOvertakeWatch(activeContestCode);
      if (typeof startContestHud === 'function') startContestHud(activeContestCode);
    } else {
      stopOvertakeWatch();
      if (typeof stopContestHud === 'function') stopContestHud();
    }
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
    } else if (mode === 'dynamic' && window._activeDynamicBoard) {
      // Dynamic-board mode — surface the personal best AND the global
      // leader as target chips. The personal-best chip is the in-game
      // half of the "beat your score" loop; when score exceeds the
      // target it auto-swaps to a 👑 crown badge (handled in
      // bumpScore() so it updates per drop). The leader chip provides
      // the social goal: "you're chasing דניאל".
      bar.classList.add('practice');
      var dbName = window._activeDynamicBoard.name || 'לוח דינמי';
      title.textContent = '🎯 ' + dbName;
      var bbRec = (typeof getBoardBest === 'function') ? getBoardBest(window._activeDynamicBoard.id) : null;
      var selfChip;
      if (bbRec && bbRec.score > 0) {
        selfChip = '<span class="dyn-target-chip" id="dyn-target-chip" data-target="' + bbRec.score + '">🏆 לעבור: <strong>' + bbRec.score.toLocaleString() + '</strong></span>';
      } else {
        selfChip = '<span class="dyn-target-chip dyn-target-chip-pioneer">🌱 הצב את השיא הראשון שלך</span>';
      }
      // Leader chip — only when the leader is someone OTHER than the
      // current player (i.e. there's something to chase). If the
      // player IS the leader, surface that instead.
      var leaderChip = '';
      var brd = window._activeDynamicBoard;
      if (brd.leader_name && brd.leader_score) {
        var bestSoFar = bbRec ? bbRec.score : 0;
        if (bestSoFar >= brd.leader_score) {
          leaderChip = ' <span class="dyn-leader-chip dyn-leader-chip-king">👑 אתה מוביל</span>';
        } else {
          leaderChip = ' <span class="dyn-leader-chip" id="dyn-leader-chip" data-leader="' + (brd.leader_score | 0) + '">👑 ' + escapeHtml(brd.leader_name) + ': ' + brd.leader_score.toLocaleString() + '</span>';
        }
      }
      sub.innerHTML = selfChip + leaderChip;
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
        if (data && typeof data.total === 'number') dailyTotal = data.total;
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
        if (data && typeof data.total === 'number') dailyTotal = data.total;
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
      // 1.2-mod — playerName always has at least the deterministic default
      // ("שחקן XXXX"), so we don't fall back to "אנונימי" anymore. Skipping
      // simply leaves whatever was there (default or previously-saved name).
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

  // Helper: is the tile at (r,c) "frozen" — i.e. sitting on a frozen
  // special cell? Frozen tiles are anchored: they don't fall with
  // gravity, and they refuse to participate in merge groups. The cell
  // itself stays frozen even after the tile clears (it's a board
  // property, not a per-tile state).
  function isFrozenAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'frozen');
  }
  function isElectricAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'electric');
  }
  // Locked: blocks drops + gravity until gameTotalMerges reaches its
  // unlock_after threshold, at which point the cell becomes regular
  // (unlocked flag set on the entry). The check returns true ONLY for
  // still-locked cells — open cells behave as plain empty squares.
  function isLockedAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'locked' && !sc.unlocked);
  }
  function isTeleportAt(r, c) {
    if (typeof getSpecialCellAt !== 'function') return false;
    var sc = getSpecialCellAt(r, c);
    return !!(sc && sc.type === 'teleport');
  }

  // Teleport spiral animation (phase 3G).
  // A purple spiral at the OLD position (tile vanishes) + matching
  // spiral at the NEW position (tile materializes). Fires before/after
  // the actual grid mutation in the drop handler.
  function triggerTeleportAnimation(fromR, fromC, toR, toC) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cols = getBoardCols();
    var fromCell = gridEl.children[fromR * cols + fromC];
    var toCell = gridEl.children[toR * cols + toC];
    function spawnSpiral(rect, kind) {
      var spiral = document.createElement('div');
      spiral.className = 'teleport-spiral teleport-spiral-' + kind;
      spiral.style.left = (rect.left + rect.width / 2) + 'px';
      spiral.style.top  = (rect.top + rect.height / 2) + 'px';
      spiral.textContent = '🌀';
      document.body.appendChild(spiral);
      setTimeout(function() { spiral.remove(); }, 600);
    }
    if (fromCell) spawnSpiral(fromCell.getBoundingClientRect(), 'out');
    if (toCell) {
      var toRect = toCell.getBoundingClientRect();
      setTimeout(function() { spawnSpiral(toRect, 'in'); }, 220);
    }
    if (typeof soundDrop === 'function') {
      try { soundDrop(); } catch (e) {}
    }
  }

  // Locked-cell unlock check (phase 3F).
  // After each merge, scan locked cells: if gameTotalMerges has reached
  // the cell's unlock_after threshold, flip its unlocked flag. The cell
  // visually transforms from a 🔒 wall to a regular empty square — the
  // unlock burst is fired here too.
  function checkLockedUnlocks() {
    if (typeof getSpecialCells !== 'function') return;
    var cells = getSpecialCells();
    if (!cells || !cells.length) return;
    for (var i = 0; i < cells.length; i++) {
      var sc = cells[i];
      if (sc.type !== 'locked' || sc.unlocked) continue;
      if (gameTotalMerges < (sc.unlock_after | 0)) continue;
      sc.unlocked = true;
      try { triggerUnlockBurst(sc.row, sc.col); } catch (e) {}
    }
  }

  function triggerUnlockBurst(r, c) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cell = gridEl.children[r * getBoardCols() + c];
    if (!cell) return;
    var rect = cell.getBoundingClientRect();
    var burst = document.createElement('div');
    burst.className = 'unlock-burst';
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top  = (rect.top + rect.height / 2) + 'px';
    burst.innerHTML =
      '<span class="ub-icon">🔓</span>' +
      '<span class="ub-flash"></span>' +
      '<span class="ub-label">נפתח!</span>';
    document.body.appendChild(burst);
    setTimeout(function() { burst.remove(); }, 900);
    if (typeof soundMilestone === 'function') {
      try { soundMilestone(3); } catch (e) {}
    }
    if (typeof buzz === 'function') buzz([30, 50, 30]);
    // Re-render so the cell loses its locked class immediately.
    if (typeof render === 'function') render();
  }

  // Electric flash + bolt burst (phase 3E).
  // Fired after every merge whose group included at least one tile on an
  // electric special cell. All cells in the group flash yellow; from each
  // electric cell, 8 ⚡ emojis shoot outward in cardinal + diagonal
  // directions for a "lightning strike" feel. The bigger the group, the
  // more dramatic the visual.
  function triggerElectricFlash(groupCells) {
    if (!groupCells || !groupCells.length) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var cols = getBoardCols();
    var electricSeeds = [];
    // Flash every cell in the merge group with a yellow electric pulse.
    for (var i = 0; i < groupCells.length; i++) {
      var p = groupCells[i];
      var idx = p[0] * cols + p[1];
      var cellEl = gridEl.children[idx];
      if (cellEl) {
        cellEl.classList.add('electric-flash');
        // self-cleanup: the animation is 500ms; remove right after so a
        // subsequent merge can flash the same cell again.
        (function(el) {
          setTimeout(function() { el.classList.remove('electric-flash'); }, 520);
        })(cellEl);
      }
      if (isElectricAt(p[0], p[1])) electricSeeds.push(p);
    }
    // Burst ⚡ emojis from each electric cell — 8 directions per cell.
    var DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    for (var i = 0; i < electricSeeds.length; i++) {
      var p = electricSeeds[i];
      var idx = p[0] * cols + p[1];
      var cellEl = gridEl.children[idx];
      if (!cellEl) continue;
      var rect = cellEl.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var bolt = document.createElement('div');
        bolt.className = 'electric-bolt electric-bolt-' + DIRECTIONS[d];
        bolt.textContent = '⚡';
        bolt.style.left = cx + 'px';
        bolt.style.top = cy + 'px';
        document.body.appendChild(bolt);
        (function(b) {
          setTimeout(function() { b.remove(); }, 720);
        })(bolt);
      }
    }
    // Audio: at least a chain-style zap if the helper exists.
    try {
      if (electricSeeds.length && typeof soundChain === 'function') {
        soundChain(Math.min(4, groupCells.length));
      }
      if (typeof buzz === 'function') buzz([20, 30, 20]);
    } catch (e) {}
  }

  // Frozen-cell adjacent-thaw mechanic (phase 3D+).
  // When a merge happens at (mergeRow, mergeCol), any frozen-with-tile
  // cell that's orthogonally adjacent gets a crack. After 3 cracks the
  // tile shatters: it's removed, score gets a shatter bonus, and the
  // frozen cell goes back to empty (ready to freeze the next tile).
  // This turns frozen from "stuck until bomb" → strategic puzzle:
  // merge near the ice to thaw it.
  function checkFrozenThawAdjacent(mergeRow, mergeCol) {
    var deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var rows = getBoardRows(), cols = getBoardCols();
    for (var i = 0; i < deltas.length; i++) {
      var nr = mergeRow + deltas[i][0];
      var nc = mergeCol + deltas[i][1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (!isFrozenAt(nr, nc) || grid[nr][nc] === 0) continue;
      var key = nr + ',' + nc;
      _frozenThawProgress[key] = (_frozenThawProgress[key] || 0) + 1;
      if (_frozenThawProgress[key] >= FROZEN_THAW_THRESHOLD) {
        thawFrozenTile(nr, nc);
        delete _frozenThawProgress[key];
      }
    }
  }

  // Read-only accessor for render() to paint crack frames.
  function getFrozenThawCount(r, c) {
    return _frozenThawProgress[r + ',' + c] || 0;
  }

  function thawFrozenTile(r, c) {
    if (grid[r][c] === 0) return;
    score += FROZEN_SHATTER_BONUS;
    grid[r][c] = 0;
    try {
      var gridElT = document.getElementById('grid');
      if (gridElT) {
        var tIdx = r * getBoardCols() + c;
        var tCell = gridElT.children[tIdx];
        if (tCell) {
          // Burst overlay anchored to the cell. CSS handles the
          // shatter animation (icicle pieces flying out).
          var rect = tCell.getBoundingClientRect();
          var burst = document.createElement('div');
          burst.className = 'frozen-shatter-burst';
          burst.style.left = (rect.left + rect.width / 2) + 'px';
          burst.style.top = (rect.top + rect.height / 2) + 'px';
          burst.innerHTML =
            '<span class="fs-ice fs-ice-1">❄️</span>' +
            '<span class="fs-ice fs-ice-2">❄️</span>' +
            '<span class="fs-ice fs-ice-3">❄️</span>' +
            '<span class="fs-ice fs-ice-4">❄️</span>' +
            '<span class="fs-burst-amount">+' + FROZEN_SHATTER_BONUS + '</span>';
          document.body.appendChild(burst);
          setTimeout(function() { burst.remove(); }, 900);
        }
      }
      if (typeof soundMerge === 'function') soundMerge(2);
      if (typeof buzz === 'function') buzz([30, 50]);
    } catch (e) {}

    // Phase 3D++: relocate the frozen cell to a random empty spot if
    // admin enabled the "shatter relocate" mode for this board. Runs
    // AFTER the shatter burst (550ms) so the player sees: shatter at
    // old position → toast → new ice forming at new position.
    var board = window._activeSpecialBoard;
    var relocateMode = (board && board.definition && board.definition.relocate_mode) || 'static';
    if (relocateMode === 'shatter') {
      setTimeout(function() { relocateFrozenCellRandomly(r, c); }, 550);
    }
  }

  // Pick a random empty non-special cell on the board and move the frozen
  // cell at (fromR, fromC) there. If no candidate exists (rare — full
  // board or all special), the frozen cell silently disappears.
  function relocateFrozenCellRandomly(fromR, fromC) {
    if (typeof moveSpecialCellInPlace !== 'function') return;
    var rows = getBoardRows(), cols = getBoardCols();
    var candidates = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (r === fromR && c === fromC) continue;
        if (getSpecialCellAt(r, c)) continue;     // skip other special cells
        if (grid[r][c] !== 0) continue;            // skip filled cells
        candidates.push([r, c]);
      }
    }
    if (!candidates.length) {
      // Nowhere to go — frozen cell disappears. Drop it from the map.
      if (typeof setSpecialCells === 'function' && typeof getSpecialCells === 'function') {
        var cur = getSpecialCells() || [];
        var filtered = cur.filter(function(x) { return !(x.row === fromR && x.col === fromC); });
        setSpecialCells(filtered);
        if (typeof render === 'function') render();
      }
      return;
    }
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    var moved = moveSpecialCellInPlace(fromR, fromC, pick[0], pick[1]);
    if (!moved) return;
    showFrozenRelocateToast(pick[0], pick[1]);
    if (typeof render === 'function') render();
  }

  // Per-type visual identity for the relocate animations. Keep parallel
  // to the in-game .cell.special-* CSS so the flying emoji matches the
  // ring it's about to land in.
  var SPECIAL_FLY_STYLE = {
    gold:   { emoji: '✨', color: '#FAC775' },
    bonus:  { emoji: '🪙', color: '#4FBD8B' },
    frozen: { emoji: '❄️', color: '#6FB7E0' }
  };

  // Reshuffle every empty special cell to a new random empty non-special
  // position. Cells with tiles on them stay put (a frozen-with-tile is
  // still a puzzle to solve, gold/bonus cells with merging tiles in
  // mid-chain shouldn't be yanked mid-action).
  // Each move animates: a flying emoji arcs from old → new position
  // while a sparkle bursts at arrival. Moves are STAGGERED 110ms apart
  // so the player can see each one — feels like the board is alive.
  function reshuffleAllSpecialCells() {
    if (typeof getSpecialCells !== 'function' || typeof moveSpecialCellInPlace !== 'function') return;
    var cells = getSpecialCells();
    if (!cells || !cells.length) return;
    var rows = getBoardRows(), cols = getBoardCols();

    // Only cells without a tile on them are eligible for reshuffle.
    // Locked cells are also pinned — their position is the contract
    // between board state and player expectation ("close until N merges").
    var shuffleable = [];
    for (var i = 0; i < cells.length; i++) {
      var sc = cells[i];
      if (sc.type === 'locked' && !sc.unlocked) continue;   // locked stays
      if (grid[sc.row][sc.col] === 0) {
        // Preserve per-type fields when shuffling. The mover only
        // mutates row/col on the same entry object.
        shuffleable.push({ row: sc.row, col: sc.col, type: sc.type });
      }
    }
    if (!shuffleable.length) return;

    // Enumerate empty non-special positions as candidate targets.
    // Locked cells aren't empty in the gameplay sense — exclude them.
    var targets = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (getSpecialCellAt(r, c)) continue;
        if (isLockedAt(r, c)) continue;
        if (grid[r][c] !== 0) continue;
        targets.push([r, c]);
      }
    }
    if (!targets.length) return;

    // Fisher–Yates shuffle the target pool.
    for (var i = targets.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = targets[i]; targets[i] = targets[j]; targets[j] = t;
    }

    // Pair each shuffleable cell with a unique target.
    var moves = [];
    for (var i = 0; i < Math.min(shuffleable.length, targets.length); i++) {
      var src = shuffleable[i];
      var dst = targets[i];
      // Skip no-ops (target same as source — rare but possible after RNG).
      if (src.row === dst[0] && src.col === dst[1]) continue;
      moves.push({ from: [src.row, src.col], to: [dst[0], dst[1]], type: src.type });
    }
    if (!moves.length) return;

    // Capture pre-move bounding rects BEFORE mutating — DOM coords don't
    // change during render (grid size is stable) but capturing now keeps
    // the animation independent of any concurrent re-render races.
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var coords = moves.map(function(m) {
      var fIdx = m.from[0] * cols + m.from[1];
      var tIdx = m.to[0] * cols + m.to[1];
      var fEl = gridEl.children[fIdx];
      var tEl = gridEl.children[tIdx];
      return {
        from: fEl ? fEl.getBoundingClientRect() : null,
        to:   tEl ? tEl.getBoundingClientRect() : null
      };
    });

    // Mutate special cells + re-render so the new rings appear at the
    // destinations. The flying emojis play ON TOP, drawing the eye
    // from old → new so the player can follow each move.
    for (var i = 0; i < moves.length; i++) {
      moveSpecialCellInPlace(moves[i].from[0], moves[i].from[1], moves[i].to[0], moves[i].to[1]);
    }
    if (typeof render === 'function') render();

    // Stagger the fly animations so each one is individually visible.
    for (var i = 0; i < moves.length; i++) {
      (function(m, c, delay) {
        setTimeout(function() {
          if (c.from && c.to) animateSpecialCellFly(c.from, c.to, m.type);
        }, delay);
      })(moves[i], coords[i], i * 110);
    }

    // One soft chime for the whole reshuffle — not per-move (would be loud).
    try { if (typeof soundDrop === 'function') soundDrop(); } catch (e) {}
  }

  // The flight animation: a big emoji shoots from `fromRect` to `toRect`
  // along a curved path (CSS arc via translate), spinning 720° and
  // briefly scaling up. Lands with a sparkle burst at the destination.
  function animateSpecialCellFly(fromRect, toRect, type) {
    var style = SPECIAL_FLY_STYLE[type] || SPECIAL_FLY_STYLE.gold;
    // Mid-point lifted UP for a satisfying arc (visual gravity reversed).
    var midX = (fromRect.left + toRect.left) / 2 + fromRect.width / 2;
    var midY = Math.min(fromRect.top, toRect.top) - 40;  // 40px above the higher of the two
    // Flying emoji
    var flyer = document.createElement('div');
    flyer.className = 'special-fly special-fly-' + type;
    flyer.textContent = style.emoji;
    flyer.style.left = (fromRect.left + fromRect.width / 2) + 'px';
    flyer.style.top  = (fromRect.top + fromRect.height / 2) + 'px';
    // CSS variables drive the keyframe's `to` translate. The browser
    // interpolates linearly between keyframe stops; we add one mid-stop
    // for the arc.
    flyer.style.setProperty('--fly-mid-x', (midX - fromRect.left - fromRect.width / 2) + 'px');
    flyer.style.setProperty('--fly-mid-y', (midY - fromRect.top - fromRect.height / 2) + 'px');
    flyer.style.setProperty('--fly-end-x', (toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2) + 'px');
    flyer.style.setProperty('--fly-end-y', (toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2) + 'px');
    document.body.appendChild(flyer);
    setTimeout(function() { flyer.remove(); }, 700);

    // Sparkle burst at arrival (fires ~500ms in so the emoji is landing).
    setTimeout(function() {
      var arrive = document.createElement('div');
      arrive.className = 'special-arrive special-arrive-' + type;
      arrive.style.left = (toRect.left + toRect.width / 2) + 'px';
      arrive.style.top  = (toRect.top + toRect.height / 2) + 'px';
      arrive.innerHTML =
        '<span class="sa-spark sa-spark-1"></span>' +
        '<span class="sa-spark sa-spark-2"></span>' +
        '<span class="sa-spark sa-spark-3"></span>' +
        '<span class="sa-spark sa-spark-4"></span>';
      document.body.appendChild(arrive);
      setTimeout(function() { arrive.remove(); }, 600);
    }, 520);
  }

  // Top-of-screen toast announcing the relocation + a "❄️ poof" overlay
  // anchored to the new cell so the player can locate it instantly.
  function showFrozenRelocateToast(newR, newC) {
    try {
      // Top banner
      var toast = document.createElement('div');
      toast.className = 'frozen-relocate-toast';
      toast.textContent = '❄️ הקרח קפץ למיקום חדש!';
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 1800);
      // Pulse at new position (after render places the new ice ring there)
      setTimeout(function() {
        var gridEl = document.getElementById('grid');
        if (!gridEl) return;
        var idx = newR * getBoardCols() + newC;
        var cellEl = gridEl.children[idx];
        if (!cellEl) return;
        var rect = cellEl.getBoundingClientRect();
        var pulse = document.createElement('div');
        pulse.className = 'frozen-relocate-pulse';
        pulse.style.left = (rect.left + rect.width / 2) + 'px';
        pulse.style.top = (rect.top + rect.height / 2) + 'px';
        document.body.appendChild(pulse);
        setTimeout(function() { pulse.remove(); }, 1100);
      }, 80);
      if (typeof soundDrop === 'function') soundDrop();
    } catch (e) {}
  }

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
      // Shape voids (phase 5) — inactive cells are walls; BFS can't
      // cross them OR be seeded by them.
      if (isShapeInactiveAt(r, c)) continue;
      if (grid[r][c] !== tier) continue;
      // Dynamic Boards — Frozen (phase 3D): tiles sitting on a frozen
      // special cell are inert. They count as "blocked" — the BFS treats
      // them as if they were the wrong tier. This prevents both being a
      // group seed AND being absorbed into a neighbor's group.
      if (isFrozenAt(r, c)) continue;
      visited.add(k);
      group.push([r, c]);
      stack.push([r-1,c], [r+1,c], [r,c-1], [r,c+1]);
      // Dynamic Boards — Electric (phase 3E): when the BFS visits a
      // tile on an electric cell, it ALSO queues 8 extra positions —
      // the 4 diagonals + the 4 orthogonals at radius 2. This means an
      // electric cell can absorb same-tier tiles that aren't directly
      // adjacent, producing cross-board mega-merges. visited keeps the
      // BFS bounded (each cell processed once even if multiple electric
      // cells reach it).
      if (isElectricAt(r, c)) {
        stack.push(
          [r-2, c], [r+2, c], [r, c-2], [r, c+2],          // radius-2 orthogonals
          [r-1, c-1], [r-1, c+1], [r+1, c-1], [r+1, c+1]   // diagonals
        );
      }
    }
    return group;
  }

  function applyGravity() {
    var moves = 0;
    for (let c = 0; c < getBoardCols(); c++) {
      // Walk bottom-up. Anchors block gravity:
      //   - frozen tiles (cell + tile combo) — phase 3D
      //   - locked cells (empty but closed) — phase 3F
      // Both snap the write cursor to row-1 so subsequent falling
      // tiles stack ABOVE the anchor without overwriting.
      let w = getBoardRows() - 1;
      for (let r = getBoardRows() - 1; r >= 0; r--) {
        // Shape voids (phase 5) — walls that block gravity downward.
        // Snap the write cursor above them just like locked / frozen.
        if (isShapeInactiveAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        // Locked cells are empty walls — block before checking grid.
        if (isLockedAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        if (grid[r][c] === 0) continue;
        if (isFrozenAt(r, c)) {
          if (r - 1 < w) w = r - 1;
          continue;
        }
        if (r !== w) { grid[w][c] = grid[r][c]; grid[r][c] = 0; moves++; }
        w--;
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

  // Score milestone celebrations during gameplay. Tiers MUST match the
  // server's ALLOWED_MILESTONES allowlist in /api/player/earn — anything
  // outside it gets paid the flat base reward instead of the tier amount.
  // Reward values are also mirrored in schema.sql as score_milestone_reward_*
  // so the banner number is what actually lands in the wallet.
  var SCORE_MILESTONES = [
    { at: 10000,   label: '🔥 10K!',   reward: 2 },
    { at: 25000,   label: '⚡ 25K!',   reward: 3 },
    { at: 50000,   label: '⭐ 50K!',   reward: 5 },
    { at: 100000,  label: '💎 100K!',  reward: 10 },
    { at: 250000,  label: '👑 250K!',  reward: 25 },
    { at: 500000,  label: '🌟 500K!',  reward: 50 },
    { at: 1000000, label: '🏆 1M!',    reward: 100 }
  ];
  var scoreMilestonesHit = {};
  // Frozen-cell thaw progress (phase 3D+): "r,c" → adjacent-merge count.
  // When a frozen tile accumulates 3 adjacent merges, it shatters and
  // awards a shatter bonus. Map is reset in init() per fresh game.
  var _frozenThawProgress = {};
  var FROZEN_THAW_THRESHOLD = 3;
  var FROZEN_SHATTER_BONUS = 200;

  function checkScoreMilestones() {
    for (var i = 0; i < SCORE_MILESTONES.length; i++) {
      var m = SCORE_MILESTONES[i];
      if (score >= m.at && !scoreMilestonesHit[m.at]) {
        scoreMilestonesHit[m.at] = true;
        showScoreMilestoneBanner(m.label, m.reward);
        if (m.reward > 0 && !window.__bloomBotActive && !skinTrialMode) {
          // Was 'event_gift' which is clamped to [event_gift_credits_min,
          // event_gift_credits_max] and rate-limited (30s + 20/hr). That
          // both lied about the displayed amount and silently dropped
          // milestones that hit within 30s of each other during chains.
          // Use the dedicated 'score_milestone' action — per-milestone
          // dedup, no rate-limit, tiered amount via score_milestone_reward_<at>.
          earnCredits('score_milestone', { milestone: m.at });
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
    // Dynamic-board target chip: when score crosses the previous best,
    // swap the chip to a "👑 עברת את השיא" celebration so the player
    // gets immediate feedback during gameplay, not just at game-over.
    var dynTargetEl = document.getElementById('dyn-target-chip');
    if (dynTargetEl) {
      var tgt = parseInt(dynTargetEl.getAttribute('data-target') || '0', 10) || 0;
      if (tgt > 0 && score > tgt && !dynTargetEl.classList.contains('dyn-target-chip-passed')) {
        dynTargetEl.classList.add('dyn-target-chip-passed');
        dynTargetEl.innerHTML = '👑 עברת את עצמך! +' + (score - tgt).toLocaleString();
        // Audio reward — milestone tone + buzz so it feels earned.
        try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([40, 40, 80]); } catch (e) {}
      } else if (tgt > 0 && score > tgt && dynTargetEl.classList.contains('dyn-target-chip-passed')) {
        // Keep updating the overage number live as score grows.
        dynTargetEl.innerHTML = '👑 עברת את עצמך! +' + (score - tgt).toLocaleString();
      }
    }
    // Dynamic-board global leader chip — same live-overtake feedback,
    // even bigger reward (overtaking another player is the strongest
    // dopamine spike a casual game can give).
    var dynLeaderEl = document.getElementById('dyn-leader-chip');
    if (dynLeaderEl) {
      var leaderTgt = parseInt(dynLeaderEl.getAttribute('data-leader') || '0', 10) || 0;
      if (leaderTgt > 0 && score > leaderTgt) {
        dynLeaderEl.classList.add('dyn-leader-chip-king');
        dynLeaderEl.innerHTML = '👑 חצית את המוביל! +' + (score - leaderTgt).toLocaleString();
        // Fire celebration ONCE.
        if (!dynLeaderEl.dataset.celebrated) {
          dynLeaderEl.dataset.celebrated = '1';
          try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 60, 60, 60, 100]); } catch (e) {}
        }
      }
    }
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
            // Pass survivor column (kc) so an active column-multiplier is
            // applied at the chokepoint. When no multiplier is active,
            // pointsFor returns the vanilla score with zero overhead.
            const points = Math.round(pointsFor(nt, group.length, multiplier, kc) * eventMult);
            score += points;
            // Dynamic Boards — Special Cell: Bonus (phase 3C, May 2026).
            // If the merge survivor lands on a bonus cell, add the cell's
            // configured amount to the score on top of the regular reward.
            // The bonus is per-merge — chains hitting the same bonus cell
            // multiple times collect each time. Fires BEFORE the milestone
            // banner so the +N badge stacks naturally with any tier-up FX.
            var __bonusCell = (typeof getSpecialCellAt === 'function') ? getSpecialCellAt(kr, kc) : null;
            if (__bonusCell && __bonusCell.type === 'bonus' && __bonusCell.amount > 0) {
              score += __bonusCell.amount;
              try {
                var gridElB = document.getElementById('grid');
                if (gridElB) {
                  var bIdx = kr * getBoardCols() + kc;
                  var bCell = gridElB.children[bIdx];
                  if (bCell) {
                    var bRect = bCell.getBoundingClientRect();
                    // Animated coin + bold "+N נקודות" badge. The coin is
                    // a span we can CSS-spin independently; the parent badge
                    // does the entry pop. Distinct from the 💎 credits emoji
                    // (which is also tier-7 — triple-overloaded) so the
                    // player never confuses bonus points with currency.
                    var bBadge = document.createElement('div');
                    bBadge.className = 'bonus-burst';
                    bBadge.style.left = (bRect.left + bRect.width / 2) + 'px';
                    bBadge.style.top  = (bRect.top + bRect.height / 2 - 6) + 'px';
                    bBadge.innerHTML =
                      '<span class="bonus-coin">🪙</span>' +
                      '<span class="bonus-amount">+' + __bonusCell.amount.toLocaleString() + '</span>' +
                      '<span class="bonus-label">נקודות</span>';
                    document.body.appendChild(bBadge);
                    setTimeout(function() { bBadge.remove(); }, 1400);
                  }
                }
              } catch (e) {}
            }
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
              // Dynamic Boards phase 1 — celebrate ≥2× column landings.
              // Small companion badge near the merge cell. Only fires when a
              // column multiplier is active AND the survivor column is ≥2×.
              (function maybeShowMultBonus() {
                if (typeof getColumnMultipliers !== 'function') return;
                var mults = getColumnMultipliers();
                if (!mults) return;
                var m = mults[kc];
                if (!m || m < 2) return;
                var gridElTmp = document.getElementById('grid');
                if (!gridElTmp) return;
                var cellIdx = kr * getBoardCols() + kc;
                var cellEl = gridElTmp.children[cellIdx];
                if (!cellEl) return;
                var rect = cellEl.getBoundingClientRect();
                var badge = document.createElement('div');
                badge.className = 'float-score';
                badge.textContent = '×' + (Number.isInteger(m) ? m : m.toFixed(1)) + ' עמודה!';
                badge.style.cssText = 'position:fixed;left:' + (rect.left + rect.width / 2) + 'px;top:' + (rect.top - 18) + 'px;background:linear-gradient(135deg,#FFB95C,#FF6B9D);color:#fff;font-weight:900;font-size:14px;padding:4px 10px;border-radius:12px;box-shadow:0 4px 14px rgba(255,107,157,0.45);pointer-events:none;z-index:9998';
                document.body.appendChild(badge);
                setTimeout(function() { badge.remove(); }, 1100);
              })();
              bumpScore();
              soundMerge(nt);
              checkScoreMilestones();
              // Frozen-thaw: every merge "cracks" any frozen-with-tile
              // cell that's orthogonally adjacent to the merge survivor.
              // 3 cracks → shatter + +200 bonus. Lets players actively
              // unstick frozen tiles via skill instead of waiting for a
              // random bomb event.
              try { checkFrozenThawAdjacent(kr, kc); } catch (e) {}
              // Locked-cell unlock: walks all locked cells, opens any
              // whose unlock_after threshold has been reached. Fires
              // the 🔓 burst + soundMilestone for each newly-opened.
              try { checkLockedUnlocks(); } catch (e) {}
              // Electric flash: if any cell in the merge group was on an
              // electric special cell, fire the lightning visual. The
              // BFS extension above already pulled in radius-2 cells, so
              // the group itself contains the extended cells.
              try {
                var hasElectric = false;
                for (var __ei = 0; __ei < group.length; __ei++) {
                  if (isElectricAt(group[__ei][0], group[__ei][1])) { hasElectric = true; break; }
                }
                if (hasElectric) triggerElectricFlash(group);
              } catch (e) {}
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
    // Game-over when every column's topmost playable cell is filled.
    // Shape voids in row 0 don't count — those columns are still
    // playable as long as some lower row is empty + reachable. To
    // keep this simple: for each column, find the first non-void
    // row from the top; if it's filled (or locked), that column
    // is full. If every column is full, game over.
    var cols = getBoardCols();
    var rows = getBoardRows();
    for (var c = 0; c < cols; c++) {
      var columnFull = true;
      for (var r = 0; r < rows; r++) {
        if (isShapeInactiveAt(r, c)) continue;  // skip voids
        if (isLockedAt(r, c)) continue;          // skip walls
        if (grid[r][c] === 0) { columnFull = false; break; }
      }
      if (!columnFull) return false;  // there's still a slot in this column
    }
    return true;
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
      // Shape voids (phase 5) — not part of the playable area.
      if (isShapeInactiveAt(r, col)) continue;
      // Locked cells block drops (treat as occupied) until unlocked.
      if (isLockedAt(r, col)) continue;
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
        // Phase 3 (May 2026): a practice-board with multipliers also breaks
        // comparability — skip leaderboard submit when one is active.
        var practiceFairForLeaderboard = (mode === 'practice') &&
                                          !sessionDifficulty &&
                                          !window._duelMode &&
                                          !window._activeSpecialBoard;
        if (((mode === 'daily') || practiceFairForLeaderboard) && !dailySubmitted) {
          if (mode === 'daily') {
            dailySubmitted = true;
            localStorage.setItem(DAILY_PLAYED_PREFIX + dailyDate, JSON.stringify({ score: score, tier: highestTier, ts: Date.now() }));
          }
          render({ over: true, isNewBest: isNewBest });
          if (!window.__bloomBotActive && !skinTrialMode) {
            // 1.2-mod — auto-submit with default name; player can choose a
            // real name via the ✏️ CTA on game-over (or the home pid) when
            // they're actually ready to commit, not before their first play.
            submitAndShowLeaderboard();
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
          if (typeof stopContestHud === 'function') stopContestHud();
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
    // Dynamic Boards — Special Cell: Gold (phase 3A, May 2026).
    // If the tile lands on a gold cell, upgrade it one tier (capped at
    // MAX_TIER = crown). Fires before the appearing animation so the
    // upgraded tile is what the player sees emerge. The gold ring stays
    // (it's a permanent board property, not a one-shot consumable).
    if (typeof getSpecialCellAt === 'function') {
      var goldHit = getSpecialCellAt(row, col);
      if (goldHit && goldHit.type === 'gold' && grid[row][col] < MAX_TIER) {
        grid[row][col] = grid[row][col] + 1;
        if (grid[row][col] > highestTier) highestTier = grid[row][col];
        // Visual + audio feedback: a tier-up celebration without the
        // big milestone banner (which is reserved for first-time-tier).
        try {
          soundMerge(grid[row][col]);
          buzz([20, 40]);
          if (typeof showFloatingScore === 'function') {
            // No score awarded here (the upgrade is its own reward —
            // the higher tier will score more in subsequent merges) —
            // a "✨ זהב!" badge marks the moment.
            var gridEl = document.getElementById('grid');
            if (gridEl) {
              var idx = row * getBoardCols() + col;
              var cellEl = gridEl.children[idx];
              if (cellEl) {
                var rect = cellEl.getBoundingClientRect();
                var badge = document.createElement('div');
                badge.className = 'float-score';
                badge.textContent = '✨ זהב!';
                badge.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2) + 'px;top:' + (rect.top - 18) + 'px;background:linear-gradient(135deg,#FFD37A,#FAC775);color:#412402;font-weight:900;font-size:14px;padding:4px 10px;border-radius:12px;box-shadow:0 4px 14px rgba(250,199,117,0.55);pointer-events:none;z-index:9998';
                document.body.appendChild(badge);
                setTimeout(function() { badge.remove(); }, 1100);
              }
            }
          }
        } catch (goldFxErr) {}
      }
    }
    // Dynamic Boards — Teleport (phase 3G): if the tile landed on a
    // teleport cell, relocate it to a random empty non-special non-locked
    // cell. The tile vanishes with a purple spiral at the old position
    // and materializes at the new one. The teleport cell itself stays
    // put (the next tile that lands here teleports too). All subsequent
    // chain processing uses the NEW (row, col).
    if (isTeleportAt(row, col)) {
      var rowsT = getBoardRows(), colsT = getBoardCols();
      var candidatesT = [];
      for (var rr = 0; rr < rowsT; rr++) {
        for (var cc = 0; cc < colsT; cc++) {
          if (rr === row && cc === col) continue;
          if (grid[rr][cc] !== 0) continue;
          if (isLockedAt(rr, cc)) continue;
          if (getSpecialCellAt(rr, cc)) continue;  // skip other specials
          candidatesT.push([rr, cc]);
        }
      }
      if (candidatesT.length) {
        var pickT = candidatesT[Math.floor(Math.random() * candidatesT.length)];
        var tileT = grid[row][col];
        grid[row][col] = 0;
        try { triggerTeleportAnimation(row, col, pickT[0], pickT[1]); } catch (e) {}
        // Show the tile vanish first, then re-place at new position.
        render();
        await gsleep(280);
        grid[pickT[0]][pickT[1]] = tileT;
        row = pickT[0];
        col = pickT[1];
        render({ appearing: [row, col] });
        await gsleep(200);
      }
    }
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
    // Snapshot total-merges BEFORE the chain so we can detect what this
    // drop actually produced. Used to trigger the special-cells reshuffle
    // when the admin's selected mode matches.
    var _preMerges = gameTotalMerges;
    await processChains(row, col);
    var _thisDropMerges = gameTotalMerges - _preMerges;
    rollNextPiece();
    render();
    // Phase 3D+++ — Special-cells board-wide reshuffle.
    // 'on_merge': any merge this drop triggers the shuffle.
    // 'on_chain': only chains (≥2 merges) trigger.
    // 'shatter' and 'static' are handled elsewhere (thawFrozenTile / never).
    try {
      var __board = window._activeSpecialBoard;
      var __mode = __board && __board.definition && __board.definition.relocate_mode;
      var __shouldShuffle =
        (__mode === 'on_merge' && _thisDropMerges > 0) ||
        (__mode === 'on_chain' && _thisDropMerges >= 2);
      if (__shouldShuffle && typeof reshuffleAllSpecialCells === 'function') {
        // Tiny delay so the chain's settle-render paints before the
        // shuffle starts moving rings around.
        setTimeout(function() { reshuffleAllSpecialCells(); }, 120);
      }
    } catch (e) {}
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
        // 1.2-mod — auto-submit with default name (see src/07-identity.js).
        submitAndShowLeaderboard();
      } else if (mode === 'practice') {
        render({ over: true, isNewBest: isNewBest });
        // Practice scores go to the daily leaderboard, but ONLY when the
        // player is on the default difficulty — non-default would inflate
        // (or deflate) the score relative to other players. Duel games
        // also reuse the practice engine; never submit those to daily.
        var fair = !sessionDifficulty && !window._duelMode;
        if (fair && !window.__bloomBotActive && !skinTrialMode) {
          submitAndShowLeaderboard();
        } else if (!fair && !window.__bloomBotActive && !skinTrialMode) {
          // Non-default practice or duel — feeds only the difficulty board.
          submitPracticeOrDuelScore();
        }
      } else if (mode === 'dynamic' && window._activeDynamicBoard && !window.__bloomBotActive && !skinTrialMode) {
        // Per-board personal best — the addictive "beat your own score" loop.
        // Capture the previous record BEFORE the write so the over screen
        // can show the delta (or the "you missed it by N" near-miss banner).
        var __boardId = window._activeDynamicBoard.id;
        var __prevBoardBest = (typeof getBoardBest === 'function') ? getBoardBest(__boardId) : null;
        var __isBoardBest = false;
        try {
          if (typeof setBoardBest === 'function') {
            __isBoardBest = setBoardBest(__boardId, score, highestTier);
          }
        } catch (e) {}
        // Cross-board streak — increments at most once per Asia/Jerusalem day.
        // Milestone hits (3/7/14/30/60/100) grant credits via earnCredits.
        var __streakResult = null;
        try {
          if (typeof recordDynamicStreakDay === 'function') {
            __streakResult = recordDynamicStreakDay();
            if (__streakResult && __streakResult.milestoneHit && __streakResult.reward) {
              // Award via earnCredits with a synthetic action key so the
              // existing dedup table (one earn per action+date) doesn't
              // conflict with regular gift rewards.
              try {
                if (typeof earnCredits === 'function') {
                  earnCredits('event_gift', {
                    amount: __streakResult.reward,
                    streak_milestone: __streakResult.milestoneHit
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        // Fire the global per-board leaderboard submit + render the
        // game-over screen optimistically. The fetch returns rank+total
        // which we paint into the screen once it resolves (so the
        // primary "🏆 שיא חדש" feedback is instant — leaderboard
        // numbers slot in 200-400ms later, no jank).
        var __submitPayload = {
          deviceId: deviceToken && getDeviceId ? getDeviceId() : '',
          token: typeof deviceToken !== 'undefined' ? deviceToken : null,
          name: getPlayerName ? getPlayerName() : 'אנונימי',
          score: score,
          tier: highestTier,
          drops: window.__bloomDropCount || 0,
          country: (typeof getCountry === 'function') ? getCountry() : null
        };
        render({
          over: true,
          isNewBest: isNewBest,
          boardBest: __prevBoardBest,
          isBoardBest: __isBoardBest,
          activeBoard: window._activeDynamicBoard,
          boardLeader: { pending: true },
          streakResult: __streakResult
        });
        (function() {
          try {
            fetch('/api/boards/' + __boardId + '/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(__submitPayload)
            })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; })
              .then(function(d) {
                if (!d || !d.ok) return;
                // Patch the rendered over screen with the rank pill in place
                // — no full re-render, just inject the missing data.
                var host = document.getElementById('over-board-rank-host');
                if (!host) return;
                var total = d.total | 0;
                var rank = d.rank | 0;
                if (!total || !rank) return;
                var percentile = total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
                var emoji = rank === 1 ? '👑' : rank <= 3 ? '🏆' : rank <= 10 ? '⭐' : '🎯';
                var label;
                if (rank === 1) label = emoji + ' מקום ראשון בלוח <strong>' + escapeHtml(window._activeDynamicBoard.name || 'לוח') + '</strong>!';
                else if (total >= 5) label = emoji + ' #' + rank + ' מתוך ' + total + ' · עברת ' + percentile + '% מהשחקנים';
                else label = emoji + ' #' + rank + ' מתוך ' + total;
                host.innerHTML = label;
                host.classList.add('over-board-rank-loaded');
                if (rank === 1) host.classList.add('over-board-rank-king');
              });
          } catch (e) {}
        })();
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
        if (typeof stopContestHud === 'function') stopContestHud();
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

