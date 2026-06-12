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

  // TA.1 — Game-Over Persistence. Mode allowlist: practice + dynamic +
  // contest. Daily already persists via DAILY_PLAYED_PREFIX. Challenge is
  // forfeit-on-close by design. Skin-trial and bot games never write.
  function lastGameModeRestorable(m) {
    return m === 'practice' || m === 'dynamic' || m === 'contest';
  }
  function saveLastGameSnapshot(extra) {
    try {
      if (skinTrialMode || window.__bloomBotActive) return;
      if (!lastGameModeRestorable(mode)) return;
      var snap = {
        mode: mode,
        score: score | 0,
        highestTier: highestTier | 0,
        isNewBest: !!(extra && extra.isNewBest),
        dailyRank: (extra && extra.dailyRank) || null,
        dailyTotal: (extra && extra.dailyTotal) || null,
        gameId: (typeof getCurrentGameId === 'function') ? getCurrentGameId() : '',
        boardId: (window._activeDynamicBoard && window._activeDynamicBoard.id) || null,
        boardName: (window._activeDynamicBoard && window._activeDynamicBoard.name) || null,
        contestCode: (mode === 'contest') ? (activeContestCode || null) : null,
        contestName: (mode === 'contest' && activeContestData) ? (activeContestData.name || null) : null,
        ts: Date.now()
      };
      safeSet(LAST_GAME_KEY, JSON.stringify(snap));
    } catch (e) {}
  }
  function loadLastGameSnapshot() {
    try {
      var raw = safeGet(LAST_GAME_KEY, null);
      if (!raw) return null;
      var snap = JSON.parse(raw);
      if (!snap || !snap.mode) return null;
      var ageMs = Date.now() - (snap.ts || 0);
      if (ageMs < 0 || ageMs > LAST_GAME_TTL_MS) return null;
      return snap;
    } catch (e) { return null; }
  }
  function clearLastGameSnapshot() { try { safeRemove(LAST_GAME_KEY); } catch (e) {} }
  try {
    window.__bloomClearLastGame = clearLastGameSnapshot;
    window.__bloomLoadLastGame = loadLastGameSnapshot;
  } catch (e) {}

  async function init(nextMode, opts) {
    opts = opts || {};
    const fresh = !!opts.fresh;
    // A FRESH game gets a new gameId — the ad-watch flow uses this id for
    // server-side per-game dedup (one ad reward per finished game). Non-fresh
    // re-inits (e.g., daily-already-played replay screen, contest mode
    // restore) keep the existing id so refreshing doesn't issue a new one.
    if (fresh && typeof regenerateGameId === 'function') regenerateGameId();
    // TA.1 — Fresh game means the player explicitly moved past any prior
    // game-over. Drop the snapshot so a mid-game refresh of the NEW run
    // doesn't trip the restore branch and yank the player back to the
    // OLD over screen.
    if (fresh) { try { safeRemove(LAST_GAME_KEY); } catch (e) {} }
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
    heldPiece = null; v2NextUp = null; // GV.4 — clear the v2 hold slot + next-up lookahead on every new game (no-op in classic)
    try { _v2GravityMoves.length = 0; } catch (e) {} // GV.4.2 — clear any stale gravity-slide moves
    // A9 — Reset ghost-mode drop recording for this fresh game.
    try { window.__bloomDropsSeq = []; } catch (e) {}
    window.__bloomGameOver = false; // new game = active again
    currentGameMaxChain = 0;
    tierUpHit = {};   // reset milestone-bonus tracker for this fresh game
    scoreMilestonesHit = {}; // reset score milestones
    _frozenThawProgress = {};   // reset frozen-cell thaw counters (phase 3D+)
    bestBeatenThisGame = false; // reset live best tracking
    // DG.1 — danger-mode state. Tracks whether the grid is "near full"
    // (≤3 playable empty cells). Used as a one-shot edge detector — fires
    // sound + buzz ONCE when entering danger, never while sustaining.
    inDangerMode = false;
    // CS.1 — clutch-save cooldown reset on every fresh game. Without this,
    // a save in the previous game's last moments would block the first
    // save in the new game until 5s elapsed.
    lastClutchSaveAt = 0;
    try { document.body.classList.remove('danger-mode'); } catch (e) {}
    try { var _dmInit = document.getElementById('danger-meter'); if (_dmInit) _dmInit.remove(); } catch (e) {}
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
    // TA.1 — Game-Over Persistence. If a non-daily game ended within the
    // TTL window AND this init isn't fresh AND the mode matches, restore
    // the over screen instead of starting a new game. This is purely
    // visual — no resubmits, no server calls. The actual score landed in
    // the leaderboard at game-over time; we only restore what the player
    // sees so a refresh doesn't drop them into an empty grid that looks
    // like a brand-new run.
    if (!fresh && lastGameModeRestorable(mode) && !window.__bloomBotActive && !skinTrialMode) {
      var __last = loadLastGameSnapshot();
      if (__last && __last.mode === mode) {
        // For dynamic mode, require the same board so a refresh that loses
        // the picker context doesn't replay an unrelated board's over screen.
        var __boardMatch = (mode !== 'dynamic') ||
          (window._activeDynamicBoard && __last.boardId &&
            window._activeDynamicBoard.id === __last.boardId);
        // For contest mode, require the same contest code.
        var __contestMatch = (mode !== 'contest') ||
          (activeContestCode && __last.contestCode === activeContestCode);
        if (__boardMatch && __contestMatch) {
          score = __last.score | 0;
          highestTier = __last.highestTier | 0;
          if (__last.dailyRank) dailyRank = __last.dailyRank;
          if (__last.dailyTotal) dailyTotal = __last.dailyTotal;
          // Mark game-over so the engine doesn't accept further drops on
          // a restored over screen.
          window.__bloomGameOver = true;
          busy = true;
          // Reuse the prior game's id so the ad-watch dedup carries
          // through a refresh — a player can't re-claim the ad by
          // reloading the page on the over screen.
          try {
            if (__last.gameId && typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('bloom_active_game_id', __last.gameId);
            }
          } catch (e) {}
          nextPiece = pickPiece();
          updateModeBar();
          render({ over: true, isNewBest: !!__last.isNewBest, restored: true });
          return;
        }
      }
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
    // T3.1 — Booster strip mount (practice + dynamic only). Reset per-game
    // usage flags so each new game starts fresh. The strip itself does its
    // own mode check via boostersAreEnabled() so a stale call in daily/
    // contest is a no-op.
    try { if (typeof clearBoostersThisGame === 'function') clearBoostersThisGame(); } catch (e) {}
    try { if (typeof maybeMountBoosterStrip === 'function') maybeMountBoosterStrip(); } catch (e) {}
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
    // Compaction (May 2026): also paint the new .mode-chip in the top-row.
    // The chip is the public face of mode info in the new layout; .mode-bar
    // is hidden via CSS. Keep both in sync so a legacy-mode toggle works.
    function paintModeChip(text) {
      var lbl = document.getElementById('mode-chip-label');
      if (lbl) lbl.textContent = text;
    }

    // Title + subtitle reflect the current mode
    if (mode === 'daily') {
      bar.classList.remove('practice');
      title.textContent = 'אתגר יומי · ' + formatDateHe(dailyDate);
      sub.textContent = "אותו דאנג'ן לכולם היום";
      paintModeChip('📅 יומי · ' + formatDateHe(dailyDate));
    } else if (mode === 'contest') {
      bar.classList.remove('practice');
      title.textContent = 'תחרות חברים';
      var contestDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var contestDiffStr = contestDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + contestDiffPreset.emoji + ' ' + contestDiffPreset.name
        : '';
      sub.textContent = (activeContestData ? activeContestData.name : 'תחרות פעילה') + contestDiffStr;
      paintModeChip('👥 ' + (activeContestData ? activeContestData.name : 'תחרות') + contestDiffStr);
    } else if (mode === 'challenge' && activeChallenge) {
      bar.classList.remove('practice');
      title.textContent = '🎁 אתגר פרס';
      sub.textContent = activeChallenge.name || activeChallenge.prizeText || 'אתגר פעיל';
      paintModeChip('🏆 ' + (activeChallenge.name || 'אתגר פרס'));
    } else if (skinTrialMode && skinTrialId) {
      bar.classList.add('practice');
      var trialPack = SKIN_PACKS[skinTrialId];
      title.textContent = '🎨 ניסיון · ' + (trialPack ? trialPack.name : '');
      sub.textContent = 'ניקוד לא נשמר · שחק ותחליט';
      paintModeChip('🎨 ניסיון · ' + (trialPack ? trialPack.name : 'סקין'));
    } else if (window._duelMode && activeDuelId) {
      bar.classList.remove('practice');
      title.textContent = '⚔️ דו-קרב 1v1';
      var duelDiffPreset = sessionDifficulty && DIFFICULTY_PRESETS[sessionDifficulty.label];
      var duelDiffStr = duelDiffPreset && sessionDifficulty.label !== 'default'
        ? ' · ' + duelDiffPreset.emoji + ' ' + duelDiffPreset.name
        : '';
      sub.textContent = 'vs ' + (window._duelOpponentName || 'יריב') + duelDiffStr;
      paintModeChip('⚔️ vs ' + (window._duelOpponentName || 'יריב') + duelDiffStr);
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
      paintModeChip('🎯 ' + dbName);
      var pbEnabled = (typeof dynFeatureEnabled === 'function') ? dynFeatureEnabled('personal_best') : true;
      var lbEnabled = (typeof dynFeatureEnabled === 'function') ? dynFeatureEnabled('global_lb') : true;
      var bbRec = (pbEnabled && typeof getBoardBest === 'function') ? getBoardBest(window._activeDynamicBoard.id) : null;
      var selfChip = '';
      if (pbEnabled) {
        if (bbRec && bbRec.score > 0) {
          selfChip = '<span class="dyn-target-chip" id="dyn-target-chip" data-target="' + bbRec.score + '">🏆 לעבור: <strong>' + bbRec.score.toLocaleString() + '</strong></span>';
        } else {
          selfChip = '<span class="dyn-target-chip dyn-target-chip-pioneer">🌱 הצב את השיא הראשון שלך</span>';
        }
      }
      // Leader chip — only when the leader is someone OTHER than the
      // current player (i.e. there's something to chase). If the
      // player IS the leader, surface that instead.
      var leaderChip = '';
      var brd = window._activeDynamicBoard;
      if (lbEnabled && brd.leader_name && brd.leader_score) {
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
      paintModeChip('🎮 חופשי · ' + pdiff.emoji + ' ' + pdiff.name);
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

    // Bug-fix May 28 2026: BN.1 hid the entire `.mode-bar` to reclaim
    // vertical space, but `.mode-sub` was hosting CRITICAL in-game chips
    // for dynamic-board mode: the personal-best target ("🏆 לעבור: 47K")
    // and the global leader ("👑 דניאל: 89K"). These are THE motivation
    // anchors that drive "one more drop on this board" — losing them
    // kills the dynamic-board addiction loop entirely.
    //
    // Solution: a compact `.mode-extras` strip that lives between .top
    // and .tier-bar, only visible when populated. Sources its content
    // by cloning the relevant chips from .mode-sub (single source of
    // truth — JS only has to know how to populate sub, the mirror is
    // automatic). Hides when sub is empty.
    //
    // H3 fix (silent-failure-hunter audit): wrap in try/catch so a
    // malformed innerHTML or DOM exception inside the strip sync can't
    // abort the whole updateModeBar — that would freeze the title/sub
    // updates until the next fresh init.
    try { syncModeExtrasStrip(); } catch (e) {}

    // B7 (May 2026 — REVISED): mode-info is ALWAYS clickable now. The
    // old mode-tabs row (יומי / אתגרים / חברים / חופשי) was removed —
    // it duplicated the bottom-nav's home-tab mode-picking flow. To
    // preserve mid-game mode switching, tap on mode-info now opens
    // a mode picker. In contest mode it ALSO offers "open leaderboard"
    // as the first option since that's the most common contest action.
    if (infoEl) {
      infoEl.classList.add('clickable');
      if (chevEl) chevEl.style.display = '';
      infoEl.onclick = function() {
        showModePicker();
      };
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

  // ME.1 — Mode-Extras strip. Bug-fix for BN.1 collateral damage:
  // `.mode-sub` chips (dynamic-board target + leader, contest name,
  // duel opponent, etc) were invisible after .mode-bar got hidden.
  // This strip is the new compact host that lives between .top and
  // .tier-bar, populated from sub.innerHTML. Hidden when empty.
  //
  // The strip is INDEPENDENT of legacy-game-ui mode — when legacy is
  // on, .mode-bar comes back and the strip is hidden (CSS rule). So
  // the player never sees the chips twice.
  // Task #2 — is the player currently on TODAY's Daily Special board?
  // Mirrors the game-over banner's detection (window._activeDynamicBoard +
  // ds.xpMult). Returns the XP multiplier (e.g. 3) or null. Drives the
  // in-game "🌟 ×3 XP" chip so the multiplier dopamine is visible DURING
  // play, not just at game-over.
  function currentDailySpecialMult() {
    try {
      var ds = window._dailySpecial;
      if (!ds || !ds.enabled || !ds.id) return null;
      if (mode !== 'dynamic') return null;
      var br = window._activeDynamicBoard;
      if (!br || br.id !== ds.id) return null;
      var m = ds.xpMult;
      return (typeof m === 'number' && m > 1) ? m : null;
    } catch (e) { return null; }
  }
  // Task #23 — should the Mystery Chest fire at EVERY game-over (daily/
  // practice/contest), not just dynamic boards? Respects the master chest
  // toggle; default ON (the per-day cap + pity floor are enforced server-side).
  function chestAllModesEnabled() {
    if (typeof gameConfig !== 'object' || !gameConfig) return true;
    if (gameConfig.dyn_chest_enabled === 'false') return false;
    return gameConfig.chest_all_modes_enabled !== 'false';
  }
  function dailySpecialChipHtml() {
    var m = currentDailySpecialMult();
    if (!m) return '';
    var label = (m % 1 === 0) ? ('×' + m) : ('×' + m.toFixed(1));
    return '<span class="ds-xp-chip" title="הלוח של היום — XP מוכפל">🌟 ' + label + ' XP</span>';
  }

  function syncModeExtrasStrip() {
    var subEl = document.getElementById('mode-sub');
    if (!subEl) return;
    // Find or create the host. Sits between .top and .tier-bar inside .app.
    var host = document.getElementById('mode-extras');
    if (!host) {
      var app = document.querySelector('.app');
      if (!app) return;
      host = document.createElement('div');
      host.id = 'mode-extras';
      host.className = 'mode-extras';
      // Insert AFTER .top (top-row+stats) so it sits just above .tier-bar.
      var topEl = app.querySelector('.top');
      if (topEl && topEl.nextSibling) {
        app.insertBefore(host, topEl.nextSibling);
      } else {
        app.appendChild(host);
      }
    }
    // Skip the legacy-game-ui case — the real .mode-bar is visible
    // and the strip would duplicate it. CSS also gates this; the JS
    // guard is defense-in-depth.
    if (document.body.classList.contains('legacy-game-ui')) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    // Mirror the sub content into the host. innerHTML copy lets the
    // existing chip styles (`.dyn-target-chip`, `.dyn-leader-chip`,
    // `.practice-diff-chip`) come along automatically.
    var subContent = subEl.innerHTML.trim();
    // Task #2 — the Daily Special XP chip. When present it forces the strip
    // visible (the multiplier is the point), and sits FIRST so the eye lands
    // on the "🌟 ×3 XP" reward before anything else.
    var dsChip = dailySpecialChipHtml();
    // Skip the daily "אותו דאנג'ן" copy — it's just informational text,
    // not an interactive chip. Hide the strip in that case to save space.
    var isPlainText = !subContent.includes('<');
    if (!dsChip && (!subContent || (isPlainText && subContent.length < 60))) {
      // For dynamic/duel/contest where chip elements exist, render.
      // For daily/challenge with plain prose text, suppress.
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    // Only carry the mirrored content when it's real chips (has markup) or
    // substantial — never the short plain-prose daily copy.
    var mirrored = (subContent && (!isPlainText || subContent.length >= 60)) ? subContent : '';
    host.innerHTML = dsChip + mirrored;
    host.style.display = '';
    // UR.1 (2026-06-06) — the difficulty is ALREADY shown (and editable) via the
    // top-row .mode-chip, which opens the mode/difficulty picker on tap. So the
    // mirrored .practice-diff-chip here was a pure DUPLICATE label ("ברירת מחדל"
    // shown twice, one above the other). Drop it; keep only the value-add chips
    // (personal-best target, board leader, daily-special XP).
    var clonedChip = host.querySelector('.practice-diff-chip');
    if (clonedChip) clonedChip.remove();
    // Strip duplicate ids on the cloned chips to avoid collisions with originals.
    var clonedTarget = host.querySelector('.dyn-target-chip');
    if (clonedTarget) clonedTarget.removeAttribute('id');
    var clonedLeader = host.querySelector('.dyn-leader-chip');
    if (clonedLeader) clonedLeader.removeAttribute('id');
    // The strip only earns a row above the board when it carries REAL info — a
    // personal-best target, a board leader, or the daily-special multiplier
    // (all contain digits or Hebrew). Icon-only leftovers (the lone "🏆
    // counts-to-leaderboard" indicator, or the duplicate difficulty we just
    // dropped) aren't worth the space, so hide the strip when no real text
    // remains. It reappears on the next render once a chip actually has data.
    if (!/[0-9֐-׿]/.test(host.textContent || '')) {
      host.style.display = 'none';
      host.innerHTML = '';
    }
  }

  // Mode picker (May 2026, B7 revised) — opens when player taps the
  // mode-info area in the mode-bar. Replaces the always-on mode-tabs
  // row that used to clutter the in-game UI. Same functionality, just
  // hidden behind one tap.
  function showModePicker() {
    var existing = document.getElementById('mp-modal');
    if (existing) { existing.remove(); return; }
    var current = mode;

    // Mode options. Order: most-common first.
    var options = [];
    // Contest is conditional — only if player has any contests.
    var contestActive = !!activeContestCode;
    var contestCount = (typeof myContestsCountSync === 'function') ? myContestsCountSync() : (contestActive ? 1 : 0);
    options.push({
      id: 'daily',
      title: '📅 אתגר יומי',
      sub: 'אותו דאנג׳ן לכל השחקנים. נספר ללוח המובילים.',
      isCurrent: current === 'daily'
    });
    options.push({
      id: 'practice',
      title: '🎮 משחק חופשי',
      sub: 'לתרגל. אפשר לבחור רמת קושי. לא נספר ללוח.',
      isCurrent: current === 'practice'
    });
    if (contestCount > 0) {
      options.push({
        id: 'contest',
        title: '👥 תחרות חברים' + (contestCount >= 2 ? ' (' + contestCount + ')' : ''),
        sub: contestCount >= 2 ? 'בחר תחרות מהרשימה.' : 'נקודות מצטברות עם החברים.',
        isCurrent: current === 'contest'
      });
    }
    options.push({
      id: 'challenge',
      title: '🏆 אתגרי פרס',
      sub: 'אתגרים פתוחים לכל השחקנים — פרסים אמיתיים.',
      isCurrent: current === 'challenge'
    });

    // If in contest, offer "open leaderboard" as a quick action.
    var contestLBOpt = (current === 'contest' && activeContestCode);

    var modal = document.createElement('div');
    modal.id = 'mp-modal';
    modal.className = 'info-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'mp-title');
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

    // Build with createElement for XSS safety.
    var card = document.createElement('div');
    card.className = 'info-card';
    card.style.maxWidth = '360px';
    card.style.direction = 'rtl';

    var titleEl = document.createElement('div');
    titleEl.id = 'mp-title';
    titleEl.style.fontSize = '16px';
    titleEl.style.fontWeight = '700';
    titleEl.style.marginBottom = '6px';
    titleEl.textContent = '🎯 החלף מצב משחק';
    card.appendChild(titleEl);

    var subEl = document.createElement('div');
    subEl.style.fontSize = '11px';
    subEl.style.color = '#6F6E68';
    subEl.style.marginBottom = '12px';
    subEl.textContent = 'בחירת מצב תפתח משחק חדש.';
    card.appendChild(subEl);

    // Bug-fix May 28 2026: practice-difficulty chip used to live inside
    // .mode-sub, but BN.1 hid the entire .mode-bar. The difficulty
    // selection became invisible. Surface it here — a "🎚 רמת קושי"
    // entry that's only visible when the player is currently in
    // practice mode. Opens the existing showPracticeDifficultyPicker.
    if (current === 'practice' && typeof showPracticeDifficultyPicker === 'function') {
      var diffBtn = document.createElement('button');
      diffBtn.className = 'mp-opt';
      diffBtn.style.cssText = 'display:block;width:100%;text-align:right;direction:rtl;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid rgba(0,0,0,0.08);background:#FFF6E6;cursor:pointer;font-family:inherit';
      var dTitleEl = document.createElement('div');
      dTitleEl.style.cssText = 'font-size:14px;font-weight:700;color:#1C1A18';
      var curDiff = (sessionDifficulty && sessionDifficulty.label) || 'default';
      var curPreset = DIFFICULTY_PRESETS[curDiff] || DIFFICULTY_PRESETS.default;
      dTitleEl.textContent = '🎚 רמת קושי · ' + curPreset.emoji + ' ' + curPreset.name;
      var dSubEl = document.createElement('div');
      dSubEl.style.cssText = 'font-size:11px;color:#6F6E68;margin-top:2px';
      dSubEl.textContent = 'בחר רמת קושי לאימון. רק "רגיל" נספר ללוח המובילים.';
      diffBtn.appendChild(dTitleEl);
      diffBtn.appendChild(dSubEl);
      diffBtn.onclick = function() {
        modal.remove();
        try { showPracticeDifficultyPicker(); } catch (e) {}
      };
      card.appendChild(diffBtn);
    }

    // If in contest, leaderboard shortcut.
    if (contestLBOpt) {
      var lbBtn = document.createElement('button');
      lbBtn.className = 'mp-opt';
      lbBtn.style.cssText = 'display:block;width:100%;text-align:right;direction:rtl;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid rgba(0,0,0,0.08);background:#FFFFFF;cursor:pointer;font-family:inherit';
      var lbTitleEl = document.createElement('div');
      lbTitleEl.style.cssText = 'font-size:14px;font-weight:700;color:#1C1A18';
      lbTitleEl.textContent = '📊 פתח לוח התחרות';
      var lbSubEl = document.createElement('div');
      lbSubEl.style.cssText = 'font-size:11px;color:#6F6E68;margin-top:2px';
      lbSubEl.textContent = 'ראה את הרנקינג הנוכחי בלי לאבד את המשחק.';
      lbBtn.appendChild(lbTitleEl);
      lbBtn.appendChild(lbSubEl);
      lbBtn.onclick = function() {
        modal.remove();
        if (typeof saveContestGameState === 'function') saveContestGameState();
        if (typeof showContestLeaderboard === 'function') showContestLeaderboard(activeContestCode);
      };
      card.appendChild(lbBtn);
    }

    // Mode options.
    options.forEach(function(opt) {
      var btn = document.createElement('button');
      btn.className = 'mp-opt';
      btn.setAttribute('data-mode', opt.id);
      var bg = opt.isCurrent ? '#FFF6E6' : '#FFFFFF';
      var border = opt.isCurrent ? '#BA7517' : 'rgba(0,0,0,0.08)';
      btn.style.cssText = 'display:block;width:100%;text-align:right;direction:rtl;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid ' + border + ';background:' + bg + ';cursor:pointer;font-family:inherit';
      var oTitle = document.createElement('div');
      oTitle.style.cssText = 'font-size:14px;font-weight:700;color:#1C1A18';
      oTitle.textContent = opt.title;
      if (opt.isCurrent) {
        var cur = document.createElement('span');
        cur.style.cssText = 'color:#BA7517;font-size:11px;margin-inline-start:6px';
        cur.textContent = '✓ נוכחי';
        oTitle.appendChild(cur);
      }
      var oSub = document.createElement('div');
      oSub.style.cssText = 'font-size:11px;color:#6F6E68;margin-top:2px';
      oSub.textContent = opt.sub;
      btn.appendChild(oTitle);
      btn.appendChild(oSub);
      btn.onclick = function() {
        modal.remove();
        if (opt.isCurrent && opt.id !== 'contest' && opt.id !== 'challenge') return;
        if (typeof buzz === 'function') buzz([12]);
        // Save current state if needed.
        if (mode === 'contest' && typeof saveContestGameState === 'function') saveContestGameState();
        if (mode === 'practice' && typeof savePracticeGameState === 'function') savePracticeGameState();
        // Routing per old mode-tabs behavior.
        if (opt.id === 'contest' && contestCount >= 2) {
          if (typeof showMyContestsList === 'function') showMyContestsList();
          return;
        }
        if (opt.id === 'challenge') {
          if (typeof showChallengesList === 'function') showChallengesList('in-game');
          return;
        }
        init(opt.id);
      };
      card.appendChild(btn);
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn secondary';
    cancelBtn.setAttribute('data-close-modal', '1');
    cancelBtn.style.cssText = 'width:100%;margin-top:6px';
    cancelBtn.textContent = 'בטל';
    cancelBtn.onclick = function() { modal.remove(); };
    card.appendChild(cancelBtn);

    modal.appendChild(card);
    document.body.appendChild(modal);
  }
  window.showModePicker = showModePicker;

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

  // AD.6 / UX audit 2026-06-02 fix — the over-screen renders a "next daily
  // rewards in HH:MM:SS" pill (#onr-countdown) and calls this to make it
  // tick. It was referenced at 12-tour-info.js but never defined, so the
  // strongest "come back at a specific time" hook showed a frozen value.
  // Mirrors startCountdown(): repaints every 1s, self-clears when the
  // over-screen (and #onr-countdown) leaves the DOM.
  function startNextRewardCountdown() {
    if (window._nextRewardTimer) { clearInterval(window._nextRewardTimer); window._nextRewardTimer = null; }
    if (typeof msUntilNextIsraelMidnight !== 'function' || typeof formatCountdown !== 'function') return;
    function tick() {
      var el = document.getElementById('onr-countdown');
      if (!el) { if (window._nextRewardTimer) { clearInterval(window._nextRewardTimer); window._nextRewardTimer = null; } return; }
      el.textContent = formatCountdown(msUntilNextIsraelMidnight());
    }
    tick();
    window._nextRewardTimer = setInterval(tick, 1000);
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
    var payload = {
      date: dailyDate,
      deviceId: deviceId,
      name: (playerName || 'אנונימי').slice(0, 24),
      score: score,
      tier: highestTier,
      drops: dropsCount | 0,
      token: deviceToken,
      country: getCountry() || null,
      // A9 — Ghost Mode: include the column-by-column drop record so
      // other players can race this run later. Server validates +
      // truncates; sending it is best-effort.
      drops_sequence: Array.isArray(window.__bloomDropsSeq) ? window.__bloomDropsSeq.slice(0, 200) : null
    };
    // T2.3 — retry-with-backoff + persistent queue. Network blips on
    // mobile are the #1 reason scores silently disappear; the queue
    // means a player who finished the daily on the bus and then went
    // through a tunnel still gets their submission delivered when they
    // open the app next time.
    var result = await submitScoreWithRetry(payload);
    if (result && result.ok && result.data) {
      var data = result.data;
      if (typeof data.rank === 'number') dailyRank = data.rank;
      if (typeof data.total === 'number') dailyTotal = data.total;
      if (!window.__bloomBotActive && mode === 'daily') earnCredits('daily_complete');
      trackEvent('game_over', { mode: mode, score: score, tier: highestTier });
    } else if (result && !result.ok) {
      // All retries failed → row queued. Tell the player.
      try {
        if (window.__bloomToast) window.__bloomToast('הציון נשמר במכשיר — ננסה לשלוח שוב כשתחזור', 'warning');
      } catch (e) {}
    }
    // Practice + duel scores also feed the difficulty leaderboard. Daily
    // mode is excluded by design (fairness — the daily seed is uniform and
    // its difficulty is admin-controlled, never per-player).
    submitPracticeOrDuelScore();
    await loadLeaderboard();
  }

  // T2.3 — Score submit with exponential-backoff retries + offline queue.
  // Attempts the POST up to 3 times (delays: 2s/4s/8s) — total worst-case
  // ~14s of waiting. The first successful response wins. On final fail,
  // serializes to localStorage[bloom_score_queue] for drain on next boot.
  // Returns { ok:true, data } on success, { ok:false, queued:true } on fail.
  var SCORE_QUEUE_KEY = 'bloom_score_queue';
  async function submitScoreWithRetry(payload) {
    var delays = [0, 2000, 4000, 8000]; // first attempt immediate, then back off
    var lastErr = null;
    for (var attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        // Tell the user we're retrying so they don't think it crashed.
        if (attempt === 1) {
          try { if (window.__bloomToast) window.__bloomToast('הציון לא נשמר — מנסה שוב…', 'warning'); } catch (e) {}
        }
        await new Promise(function(r) { setTimeout(r, delays[attempt]); });
      }
      try {
        var res = await fetch(API_BASE + '/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          var data = await res.json();
          if (attempt > 0) {
            try { if (window.__bloomToast) window.__bloomToast('הציון נשמר ✓', 'success'); } catch (e) {}
          }
          return { ok: true, data: data };
        }
        // 4xx errors (bad_date / bad_score / etc) are not transient —
        // don't retry, don't queue. Server has rejected the payload.
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, terminal: true, status: res.status };
        }
        lastErr = new Error('http_' + res.status);
      } catch (e) { lastErr = e; }
    }
    // All retries failed — queue for next session.
    enqueueScore(payload);
    return { ok: false, queued: true, error: lastErr ? String(lastErr.message || lastErr) : 'unknown' };
  }

  function enqueueScore(payload) {
    try {
      var raw = localStorage.getItem(SCORE_QUEUE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      // Cap the queue at 10 entries to prevent runaway storage growth
      // (10 daily attempts queued = ~10 days offline = realistic upper bound).
      arr.push({ ts: Date.now(), payload: payload });
      while (arr.length > 10) arr.shift();
      localStorage.setItem(SCORE_QUEUE_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  // Called once on boot (from 13-boot.js). Drains every queued submission
  // sequentially, removing each on success. Non-blocking — runs in the
  // background while the player navigates.
  async function drainScoreQueue() {
    var arr;
    try {
      var raw = localStorage.getItem(SCORE_QUEUE_KEY);
      if (!raw) return;
      arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return;
    } catch (e) { return; }
    var drained = 0;
    var remaining = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (!item || !item.payload) continue;
      try {
        var r = await fetch(API_BASE + '/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
        if (r.ok) { drained++; continue; }
        if (r.status >= 400 && r.status < 500) {
          // Terminal — drop the row, log + count as drained for stats.
          drained++; continue;
        }
        // 5xx / network — keep for next time.
        remaining.push(item);
      } catch (e) {
        remaining.push(item);
      }
    }
    try {
      if (remaining.length) localStorage.setItem(SCORE_QUEUE_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(SCORE_QUEUE_KEY);
    } catch (e) {}
    if (drained > 0) {
      try { if (window.__bloomToast) window.__bloomToast('🎯 ' + drained + ' ציון' + (drained > 1 ? 'ים' : '') + ' שמורים נשלחו בהצלחה', 'success'); } catch (e) {}
    }
  }
  try { window.__bloomDrainScoreQueue = drainScoreQueue; } catch (e) {}

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
          source: source,
          // A9 — Ghost Mode: practice ghosts also tracked.
          drops_sequence: Array.isArray(window.__bloomDropsSeq) ? window.__bloomDropsSeq.slice(0, 200) : null
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
  // Admin defaults: the audit caught that leaderboard_default_tab +
  // leaderboard_default_difficulty were saved in /admin but never
  // consulted here. localStorage still wins (returning player lands
  // on their last selection), but the admin's default is now what a
  // brand-new player or someone who cleared storage gets.
  function _lbAdminDefault(key, fallback) {
    try {
      var v = (typeof gameConfig === 'object' && gameConfig && gameConfig[key]) || '';
      return v ? String(v) : fallback;
    } catch (e) { return fallback; }
  }
  let lbModalScope = localStorage.getItem(LB_SCOPE_KEY) ||
                     _lbAdminDefault('leaderboard_default_tab', 'world');
  let lbModalPeriod = localStorage.getItem(LB_PERIOD_KEY) || 'day';
  let lbModalDifficulty = localStorage.getItem(LB_DIFF_KEY) ||
                          _lbAdminDefault('leaderboard_default_difficulty', 'default');
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
    // Mount on body so the modal is visible regardless of which
    // screen is active. grid-wrap is display:none while home is
    // showing, which previously made this modal invisible when
    // opened from the home screen.
    const wrap = document.body;
    if (!wrap || document.getElementById('lb-modal')) return;
    // Re-resolve admin defaults at open time — gameConfig is fetched
    // async after boot, so the module-init values may have used the
    // hardcoded fallback. Only override when the player has no
    // localStorage preference (first-time visitor).
    if (!localStorage.getItem(LB_SCOPE_KEY)) {
      lbModalScope = _lbAdminDefault('leaderboard_default_tab', 'world');
    }
    if (!localStorage.getItem(LB_DIFF_KEY)) {
      lbModalDifficulty = _lbAdminDefault('leaderboard_default_difficulty', 'default');
    }
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
    // Mount on body — see openLeaderboardModal / promptForName for
    // the same rationale (grid-wrap is hidden when home is showing).
    var wrap = document.body;
    if (document.getElementById('country-modal')) { cb && cb(); return; }
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
    // BUG FIX (May 2026): used to mount into #grid-wrap, which is set
    // `display:none` while the home screen is showing. That made the
    // edit-name modal invisible when clicking the ✏️ on the home pid
    // line. Always mount on body so the modal lives at viewport level
    // regardless of which screen is currently visible.
    if (document.getElementById('name-modal')) { cb && cb(); return; }
    const wrap = document.body;
    const modal = document.createElement('div');
    modal.id = 'name-modal';
    modal.className = 'info-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'name-modal-title');
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
    // A11y post-process: tag the title for aria-labelledby + ensure
    // buttons explicitly type="button" so they don't trigger a form
    // submit when the modal is mounted inside any future form context.
    var __titleEl = modal.querySelector('.info-title');
    if (__titleEl) __titleEl.id = 'name-modal-title';
    var __inputEl = modal.querySelector('.name-input');
    if (__inputEl) __inputEl.setAttribute('aria-label', 'השם שלך');
    var __saveBtn = modal.querySelector('#name-save');
    var __skipBtn = modal.querySelector('#name-skip');
    if (__saveBtn) __saveBtn.type = 'button';
    if (__skipBtn) {
      __skipBtn.type = 'button';
      // Lets the global ESC handler ([data-close-modal] / aria-label
      // selector in __bloomDismissTopmostModal) close via skip(), which
      // restores focus + chains the country picker correctly.
      __skipBtn.setAttribute('data-close-modal', '1');
    }
    // Save the element that had focus before opening so we can restore
    // it on close — keeps keyboard users in place.
    var __prevFocus = document.activeElement;
    const input = document.getElementById('name-input');
    setTimeout(function() {
      if (input) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
      }
    }, 50);
    // Tab focus trap — keeps Tab/Shift+Tab cycling within the modal.
    modal.addEventListener('keydown', function(ev) {
      if (ev.key !== 'Tab') return;
      var focusables = modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var visible = Array.prototype.filter.call(focusables, function(el) { return !el.disabled && el.offsetParent !== null; });
      if (!visible.length) return;
      var first = visible[0], last = visible[visible.length - 1];
      if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault(); }
      else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault(); }
    });
    // Backdrop click → skip (treats outside-tap like cancel).
    modal.addEventListener('click', function(ev) {
      if (ev.target === modal) { try { skip(); } catch (_) {} }
    });
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
    function restoreFocus() {
      try { if (__prevFocus && typeof __prevFocus.focus === 'function') __prevFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    function save() {
      const v = (input.value || '').trim().slice(0, 24);
      if (v) {
        playerName = v;
        localStorage.setItem(NAME_KEY, v);
        syncServerName(v);
      }
      modal.remove();
      restoreFocus();
      maybeChainCountry(function() { cb && cb(); });
    }
    function skip() {
      // 1.2-mod — playerName always has at least the deterministic default
      // ("שחקן XXXX"), so we don't fall back to "אנונימי" anymore. Skipping
      // simply leaves whatever was there (default or previously-saved name).
      modal.remove();
      restoreFocus();
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

  // The merge threshold — TWO or more orthogonally-adjacent same-tier tiles
  // merge into the next tier. Single source of truth: processChains reads it
  // below, and the FTUE tutorial (src/15-ftue.js) reads it via mergeMinGroup()
  // so the demo can NEVER teach a different number than the engine enforces.
  const MERGE_MIN_GROUP = 2;
  function mergeMinGroup() { return MERGE_MIN_GROUP; }

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
        if (r !== w) {
          grid[w][c] = grid[r][c]; grid[r][c] = 0; moves++;
          // GV.4.2 — record the move so render() can FLIP-slide this tile from
          // its old row to its new row (smooth gravity settle, v2 only).
          if (typeof v2On === 'function' && v2On()) { try { _v2GravityMoves.push({ toR: w, fromR: r, c: c }); } catch (e) {} }
        }
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

  function showChainBadge(chainCount, multiplier, opts) {
    opts = opts || {};
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#EF9F27;color:#412402;font-weight:900;font-size:' + (18 + chainCount * 2) + 'px;padding:10px 24px;border-radius:24px;letter-spacing:0.05em;pointer-events:none;text-align:center;box-shadow:0 6px 20px rgba(239,159,39,0.4);animation:chainPop 0.75s ease-out forwards';
    badge.textContent = '🔥 שרשרת ×' + multiplier;
    document.body.appendChild(badge);
    setTimeout(function() { badge.remove(); }, 750);
    // DG.2 — Legendary Chain. A chain of 5+ is genuinely rare (most
    // games never see one). The standard chain badge maxes out visually
    // around chain 4 — beyond that it reads as "same as ×4 but with a
    // bigger number". This adds a full-screen radial gold flash + giant
    // overlay text + 24-particle confetti + sustained buzz, so the
    // dopamine peak matches the rarity. The most-shared screenshot
    // moments in any merge game are exactly these spikes.
    if (chainCount >= 5 && !window.__bloomBotActive) {
      try { showLegendaryChainOverlay(chainCount, !!opts.lifetimeFirst); } catch (e) {}
    }
    // LF.2 — Lifetime-first chain ≥3. Even chains of 3-4 deserve a
    // "first time ever!" beat if the player has never had one — but a
    // subtler one than the legendary spectacle (legendaryFirst already
    // amplifies chain 5+). The 3-4 path uses a small badge above the
    // chain badge so it doesn't compete with the legendary overlay.
    if (chainCount >= 3 && chainCount < 5 && opts.lifetimeFirst && !window.__bloomBotActive) {
      try { showLifetimeFirstChainPill(chainCount); } catch (e) {}
    }
  }

  // LF.2 — subtler lifetime-first marker for chain 3-4. Mythic+ (5+)
  // gets the louder treatment via showLegendaryChainOverlay's
  // lifetimeFirst branch — this is for the "you just hit your first
  // chain 3!" moment that's still meaningful but doesn't deserve a
  // full-screen takeover.
  function showLifetimeFirstChainPill(chainCount) {
    // L1 — dedup. A rapid 3→4 lifetime-first chain sequence within the
    // 1.7s lifetime of the existing pill would stack two at the same
    // position. If one is already on-screen, drop the new one — the
    // bigger chain's legendary overlay will carry the spectacle anyway.
    try {
      if (document.querySelector('[data-bloom-banner="lifetime-chain-pill"]')) return;
    } catch (e) {}
    var pill = document.createElement('div');
    pill.setAttribute('data-bloom-banner', 'lifetime-chain-pill');
    pill.style.cssText =
      'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);' +
      'z-index:10000;pointer-events:none;text-align:center;' +
      'background:linear-gradient(135deg,#FFE08A,#FF8E3C);color:#1C1A18;' +
      'font-weight:900;font-size:14px;letter-spacing:0.04em;' +
      'padding:8px 16px;border-radius:18px;direction:rtl;' +
      'box-shadow:0 6px 20px rgba(255,142,60,0.55);' +
      'animation:lifetimeChainPillPop 1.6s ease-out forwards';
    pill.innerHTML = '✨ שרשרת ×' + chainCount + ' לראשונה אי-פעם!';
    document.body.appendChild(pill);
    setTimeout(function() { try { pill.remove(); } catch (e) {} }, 1700);
    if (typeof soundMilestone === 'function') {
      try { soundMilestone(Math.min(8, chainCount + 2)); } catch (e) {}
    }
    if (typeof buzz === 'function') {
      try { buzz([40, 30, 60, 30, 90]); } catch (e) {}
    }
    try {
      if (typeof trackEvent === 'function') {
        trackEvent('lifetime_first_chain', { chainCount: chainCount });
      }
    } catch (e) {}
  }

  // DG.2 — chains of 5+ get a full-screen fireworks treatment. Tiers:
  //   5 = "LEGENDARY", 6 = "MYTHIC", 7+ = "GODLIKE".
  // Sound is escalated milestone tone (already used for tier-ups);
  // buzz pattern grows with chain length; confetti count scales too.
  // LF.2 — when isLifetimeFirst is true, the label gets a "FIRST TIME!"
  // prefix and confetti is doubled. Chain of 5+ that's also lifetime-
  // first is the strongest mid-game moment after crown.
  function showLegendaryChainOverlay(chainCount, isLifetimeFirst) {
    var tier = chainCount >= 7 ? 'godlike' : chainCount >= 6 ? 'mythic' : 'legendary';
    var label = tier === 'godlike' ? 'GODLIKE' : tier === 'mythic' ? 'MYTHIC' : 'LEGENDARY';
    if (isLifetimeFirst) label = '✨ ' + label + ' · FIRST EVER!';
    var emoji = tier === 'godlike' ? '💎🔥' : tier === 'mythic' ? '🌟🔥' : '🔥';
    // Full-screen radial flash — sits at z-index just under the chain
    // badge so the text still pops over the flash. Auto-removes.
    var flash = document.createElement('div');
    flash.setAttribute('data-bloom-banner', 'chain-legendary');
    flash.style.cssText =
      'position:fixed;inset:0;z-index:9997;pointer-events:none;' +
      'background:radial-gradient(circle at center, rgba(255,217,106,0.55) 0%, rgba(255,142,60,0.30) 30%, rgba(255,107,157,0.0) 70%);' +
      'animation:legendaryFlash 1.1s ease-out forwards';
    document.body.appendChild(flash);
    // Giant label centered. Uses dedicated keyframes so the badge above
    // (showChainBadge) and the label here don't visually collide.
    var label2 = document.createElement('div');
    label2.setAttribute('data-bloom-banner', 'chain-legendary-text');
    label2.style.cssText =
      'position:fixed;top:32%;left:50%;transform:translate(-50%,-50%);' +
      'z-index:9999;pointer-events:none;text-align:center;' +
      'font-weight:900;font-size:54px;letter-spacing:0.08em;' +
      'background:linear-gradient(135deg,#FFE08A 0%,#FF8E3C 50%,#FF4D6D 100%);' +
      '-webkit-background-clip:text;background-clip:text;color:transparent;' +
      'text-shadow:0 0 24px rgba(255,142,60,0.6);' +
      'animation:legendaryText 1.2s cubic-bezier(0.17,0.67,0.21,1.4) forwards';
    label2.innerHTML = emoji + ' ' + label + ' <span style="font-size:32px;opacity:0.85">×' + chainCount + '</span>';
    document.body.appendChild(label2);
    setTimeout(function() { try { flash.remove(); label2.remove(); } catch (e) {} }, 1300);
    // Confetti scaled to tier — godlike rains the most.
    if (typeof showConfetti === 'function') {
      var confettiBase = tier === 'godlike' ? 36 : tier === 'mythic' ? 28 : 22;
      try { showConfetti(isLifetimeFirst ? confettiBase * 2 : confettiBase); } catch (e) {}
    }
    // Sound — escalated milestone tone matching the chain count.
    if (typeof soundMilestone === 'function') {
      try { soundMilestone(Math.min(8, chainCount + 1)); } catch (e) {}
    }
    // Buzz — pattern length grows with chain. Godlike gets the
    // longest, most dramatic vibration sequence.
    if (typeof buzz === 'function') {
      var pat = tier === 'godlike' ? [50,40,60,40,80,40,120]
              : tier === 'mythic'  ? [40,40,60,40,100]
              :                     [30,40,80,40,80];
      try { buzz(pat); } catch (e) {}
    }
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

  // LF.1 — Lifetime-first tier celebration. Fires when the player reaches
  // a tier (5-8) they have NEVER reached in their entire history. This is
  // the strongest "I'll remember this moment forever" lever in the game.
  // Crown (tier 8) lifetime-first is genuinely a once-in-a-player-lifetime
  // event — most players never reach it. The spectacle scales: tier 5 gets
  // a loud overlay, tier 8 gets a full-screen takeover + share prompt.
  function showLifetimeFirstTierOverlay(tier) {
    var t = (getActiveTiers() && getActiveTiers()[tier]) || { name: 'דרגה ' + tier, emoji: '⭐', bg: '#FAC775', fg: '#412402' };
    var isCrown = tier >= 8;
    var labelHe = isCrown ? 'הגעת לכתר! · האירוע הנדיר ביותר ב-BLOOM'
                          : tier === 7 ? 'הגעת ליהלום בפעם הראשונה אי-פעם!'
                          : tier === 6 ? 'הגעת לכוכב בפעם הראשונה אי-פעם!'
                          :              'הגעת לדרגה חדשה לראשונה אי-פעם!';
    // Full-screen radial flash matched to tier color. Crown gets the most
    // saturated gold-to-pink gradient — the rest use the tier's own palette.
    var flash = document.createElement('div');
    flash.setAttribute('data-bloom-banner', 'lifetime-first');
    var flashGrad = isCrown
      ? 'radial-gradient(circle at center, rgba(255,217,106,0.70) 0%, rgba(255,142,60,0.40) 35%, rgba(255,107,157,0.10) 70%, rgba(0,0,0,0) 100%)'
      : 'radial-gradient(circle at center, rgba(250,199,117,0.55) 0%, rgba(186,117,23,0.30) 40%, rgba(0,0,0,0) 75%)';
    flash.style.cssText =
      'position:fixed;inset:0;z-index:10001;pointer-events:none;' +
      'background:' + flashGrad + ';' +
      'animation:lifetimeFlash ' + (isCrown ? '1.8s' : '1.4s') + ' ease-out forwards';
    document.body.appendChild(flash);
    // Big card with tier emoji + lifetime-first label. Pointer events ON so
    // the player can tap a "share this moment" button on crown.
    var card = document.createElement('div');
    card.setAttribute('data-bloom-banner', 'lifetime-first-card');
    card.className = 'lifetime-first-card' + (isCrown ? ' lifetime-first-crown' : '');
    var shareBtn = isCrown
      ? '<button class="lifetime-share-btn" id="lifetime-share-btn">📤 שתף את הרגע הזה</button>'
      : '';
    card.innerHTML =
      '<div class="lf-eyebrow">✨ פעם ראשונה אי-פעם ✨</div>' +
      '<div class="lf-emoji" style="background:' + t.bg + ';color:' + t.fg + '">' + t.emoji + '</div>' +
      '<div class="lf-tier-name">' + escapeHtml(t.name) + '</div>' +
      '<div class="lf-sub">' + labelHe + '</div>' +
      shareBtn +
      '<button class="lifetime-dismiss-btn" id="lifetime-dismiss-btn">המשך לשחק →</button>';
    document.body.appendChild(card);
    var dismiss = function() {
      try { flash.remove(); card.remove(); } catch (e) {}
    };
    // Auto-dismiss after a long hold — crown gets the longest savor time.
    var holdMs = isCrown ? 6500 : 4500;
    var autoTimer = setTimeout(dismiss, holdMs);
    // Manual dismiss — both buttons close immediately.
    var dimBtn = card.querySelector('#lifetime-dismiss-btn');
    if (dimBtn) dimBtn.onclick = function() { clearTimeout(autoTimer); dismiss(); };
    // Share prompt — crown only. Reuses the existing Stage 32 Replay Share
    // pipeline if available, falls back to web-share with a canned message.
    var shareBtnEl = card.querySelector('#lifetime-share-btn');
    if (shareBtnEl) {
      shareBtnEl.onclick = function() {
        clearTimeout(autoTimer);
        try {
          if (window.__bloomReplay && typeof window.__bloomReplay.openShareModal === 'function') {
            window.__bloomReplay.openShareModal({ source: 'lifetime_crown' });
          } else if (navigator.share) {
            navigator.share({
              title: 'BLOOM',
              text: '👑 הגעתי לכתר ב-BLOOM בפעם הראשונה!',
              url: window.location.origin
            }).catch(function() {});
          }
        } catch (e) {}
        dismiss();
      };
    }
    // Confetti + sound + buzz scaled to importance.
    if (typeof showConfetti === 'function') {
      try { showConfetti(isCrown ? 60 : 36); } catch (e) {}
    }
    if (typeof soundMilestone === 'function') {
      try { soundMilestone(8); } catch (e) {}
      if (isCrown) {
        setTimeout(function() { try { soundMilestone(8); } catch (e) {} }, 700);
      }
    }
    if (typeof buzz === 'function') {
      var pat = isCrown
        ? [60, 40, 80, 40, 100, 40, 120, 40, 150]
        : [50, 40, 70, 40, 100];
      try { buzz(pat); } catch (e) {}
    }
    // Analytics — flag for product-side measurement.
    try {
      if (typeof trackEvent === 'function') {
        trackEvent('lifetime_first_tier', { tier: tier, crown: isCrown });
      }
    } catch (e) {}
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
  // MM.1 — multi-merge escalation. A merge of 6+ tiles in one group is
  // a genuinely rare event (most games never see one), but the previous
  // code rendered "🌟 MEGA ×6" with the same visual as "🌟 MEGA ×5".
  // Dopamine peak should match rarity, mirroring the LEGENDARY/MYTHIC/
  // GODLIKE escalation that chain 5+ already gets.
  //
  // Tiers:
  //   3 → "✨ Triple!"   (light celebration, orange badge)
  //   4 → "💥 Quad!"     (gold badge, escalated buzz + soundMilestone(3))
  //   5 → "🌟 MEGA!"     (gold-pink gradient, 14-particle confetti, soundMilestone(5))
  //   6+ → "⚡ MASSIVE ×N!" (full-screen radial flash + giant text + 24-particle confetti
  //                         + extreme buzz, mirroring chain-godlike spectacle)
  function showMultiMergeBadge(count) {
    if (count < 3) return;
    var tier = count >= 6 ? 'massive' : count >= 5 ? 'mega' : count === 4 ? 'quad' : 'triple';
    // Skip the bot-celebration entirely so AI test runs aren't visually noisy.
    var isBot = !!window.__bloomBotActive;
    // Badge — keep for ALL tiers (triple/quad/mega/massive). The massive
    // variant gets an ADDITIONAL full-screen overlay on top.
    var badge = document.createElement('div');
    badge.setAttribute('data-bloom-banner', 'multi-merge');
    var label, badgeBg, badgeColor, badgeFont, badgeShadow;
    if (tier === 'triple')      { label = '✨ Triple!';            badgeBg = '#EF9F27';                                                              badgeColor = '#412402'; badgeFont = 24; badgeShadow = '0 8px 24px rgba(0,0,0,0.3)'; }
    else if (tier === 'quad')   { label = '💥 Quad!';              badgeBg = '#FAC775';                                                              badgeColor = '#412402'; badgeFont = 28; badgeShadow = '0 10px 28px rgba(250,199,117,0.5)'; }
    else if (tier === 'mega')   { label = '🌟 MEGA!';              badgeBg = 'linear-gradient(135deg,#FFE08A 0%,#FF8E3C 100%)';                       badgeColor = '#1C1A18'; badgeFont = 32; badgeShadow = '0 12px 32px rgba(255,142,60,0.55)'; }
    else /* massive */          { label = '⚡ MASSIVE ×' + count + '!'; badgeBg = 'linear-gradient(135deg,#FFE08A 0%,#FF6B9D 50%,#C8472F 100%)';      badgeColor = '#FFF';    badgeFont = 34; badgeShadow = '0 0 28px rgba(255,217,106,0.7), 0 14px 36px rgba(200,71,47,0.5)'; }
    // max-width:90vw guards against label overflow on 320px-wide phones
    // (iPhone SE). The MASSIVE ×N label was the longest at 34px font.
    badge.style.cssText =
      'position:fixed;top:38%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
      'background:' + badgeBg + ';color:' + badgeColor + ';' +
      'font-weight:900;font-size:' + badgeFont + 'px;letter-spacing:0.05em;' +
      'padding:12px 28px;border-radius:24px;pointer-events:none;text-align:center;' +
      'max-width:90vw;white-space:nowrap;' +
      'box-shadow:' + badgeShadow + ';' +
      'animation:chainPop 0.95s ease-out forwards';
    badge.textContent = label;
    document.body.appendChild(badge);
    setTimeout(function() { try { badge.remove(); } catch (e) {} }, 950);
    // Sound — escalate with tier. Triple stays silent (the existing
    // soundMerge fires anyway); quad+ gets a milestone twinkle.
    if (!isBot) {
      if (typeof soundMilestone === 'function') {
        try {
          if (tier === 'massive')   soundMilestone(7);
          else if (tier === 'mega') soundMilestone(5);
          else if (tier === 'quad') soundMilestone(3);
        } catch (e) {}
      }
      // Buzz — pattern grows by tier. Triple = light, massive = extreme.
      if (typeof buzz === 'function') {
        try {
          if (tier === 'massive')      buzz([50, 40, 60, 40, 80, 40, 120]);
          else if (tier === 'mega')    buzz([40, 40, 60, 40, 100]);
          else if (tier === 'quad')    buzz([60, 40, 80]);
          else                         buzz([60, 40]);
        } catch (e) {}
      }
      // Confetti for mega+ only.
      if (typeof showConfetti === 'function') {
        try {
          if (tier === 'massive')   showConfetti(24);
          else if (tier === 'mega') showConfetti(14);
        } catch (e) {}
      }
    }
    // Shake — quad and mega get the existing escalation; massive shakes
    // harder to match the audio-visual peak.
    var mmShakeDefault = tier === 'massive' ? '8' : tier === 'mega' ? '6' : tier === 'quad' ? '5' : '3';
    var mmShake = parseInt(getEventConfig('shake_multi_merge', mmShakeDefault), 10) || 0;
    if (mmShake > 0) shakeGrid(mmShake);
    // MM.1 — full-screen flash only for tier='massive' (6+ tiles). Mirrors
    // the legendary chain spectacle: same z-index hierarchy + same fade
    // duration so the visual language reads as "this is the same kind
    // of peak moment".
    if (tier === 'massive' && !isBot) {
      try { showMassiveMergeFlash(count); } catch (e) {}
    }
    // Analytics — track rare big merges for product-side measurement.
    try {
      if (typeof trackEvent === 'function' && (tier === 'mega' || tier === 'massive')) {
        trackEvent('multi_merge_big', { count: count, tier: tier });
      }
    } catch (e) {}
  }

  // MM.1 — full-screen flash for 6+ tile merges (the rarest in-game
  // event after Crown Merge). Same shape as showLegendaryChainOverlay's
  // flash so the visual vocabulary stays consistent.
  function showMassiveMergeFlash(count) {
    var flash = document.createElement('div');
    flash.setAttribute('data-bloom-banner', 'massive-merge-flash');
    flash.style.cssText =
      'position:fixed;inset:0;z-index:9997;pointer-events:none;' +
      'background:radial-gradient(circle at center, rgba(255,217,106,0.60) 0%, rgba(255,107,157,0.30) 35%, rgba(200,71,47,0.10) 70%, rgba(0,0,0,0) 100%);' +
      'animation:massiveMergeFlash 1.2s ease-out forwards';
    document.body.appendChild(flash);
    setTimeout(function() { try { flash.remove(); } catch (e) {} }, 1300);
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
    //
    // ME.1 fix: querySelectorAll instead of getElementById — the chip
    // exists in BOTH the hidden .mode-sub (source of truth, has data-*
    // attributes) AND the visible .mode-extras (clone). Update both
    // so the visible one shows the celebration.
    var dynTargetEls = document.querySelectorAll('.dyn-target-chip[data-target]');
    if (dynTargetEls.length) {
      // H2 fix (silent-failure-hunter audit): prefer the visible clone
      // inside #mode-extras as the source-of-truth. The hidden .mode-sub
      // original might have different state if a future refactor reorders
      // DOM. The visible chip is the one the player sees animating.
      var dynTargetSrc = document.querySelector('#mode-extras .dyn-target-chip[data-target]') || dynTargetEls[0];
      var tgt = parseInt(dynTargetSrc.getAttribute('data-target') || '0', 10) || 0;
      var alreadyPassed = dynTargetSrc.classList.contains('dyn-target-chip-passed');
      if (tgt > 0 && score > tgt) {
        var passedLabel = '👑 עברת את עצמך! +' + (score - tgt).toLocaleString();
        dynTargetEls.forEach(function(el) {
          el.classList.add('dyn-target-chip-passed');
          el.innerHTML = passedLabel;
        });
        if (!alreadyPassed) {
          // Audio reward — fires ONCE at the moment of crossing.
          try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 40, 80]); } catch (e) {}
        }
      }
    }
    // Dynamic-board global leader chip — same live-overtake feedback,
    // even bigger reward (overtaking another player is the strongest
    // dopamine spike a casual game can give). Updates ALL instances.
    var dynLeaderEls = document.querySelectorAll('.dyn-leader-chip[data-leader]');
    if (dynLeaderEls.length) {
      // H2 fix: same visible-clone preference as the target chip above.
      var dynLeaderSrc = document.querySelector('#mode-extras .dyn-leader-chip[data-leader]') || dynLeaderEls[0];
      var leaderTgt = parseInt(dynLeaderSrc.getAttribute('data-leader') || '0', 10) || 0;
      var alreadyCelebrated = !!dynLeaderSrc.dataset.celebrated;
      if (leaderTgt > 0 && score > leaderTgt) {
        var leaderLabel = '👑 חצית את המוביל! +' + (score - leaderTgt).toLocaleString();
        dynLeaderEls.forEach(function(el) {
          el.classList.add('dyn-leader-chip-king');
          el.innerHTML = leaderLabel;
          el.dataset.celebrated = '1';
        });
        if (!alreadyCelebrated) {
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
          if (group.length >= MERGE_MIN_GROUP) {
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
            // AS.1 — × the flow multiplier so fast, engaged play scores more
            // (and stalling, which can't build flow, scores less). flowMultiplier()
            // returns 1 when the meter is disabled/empty — zero overhead then.
            const points = Math.round(pointsFor(nt, group.length, multiplier, kc) * eventMult * flowMultiplier());
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
              // LF.1 — Lifetime-first detection. Compare against the
              // persisted lifetime best, then mount the celebration. The
              // game-end `bumpLifetimeMax(BEST_TIER_KEY, highestTier)`
              // is still authoritative — this just gates the overlay.
              //
              // C2 fix (silent-failure-hunter audit): the previous code
              // bumped BEST_TIER_KEY BEFORE the celebration fired. If
              // the 900ms-later mount was suppressed (because a chain-
              // legendary banner was still on-screen), the marker said
              // "already seen" but the player got NO celebration —
              // permanently lost the lifetime-first crown moment.
              // New design: bump ONLY after showLifetimeFirstTierOverlay
              // actually mounts. If suppressed by the legendary banner,
              // retry every 200ms (up to ~3s total) until either it
              // mounts OR we give up — in which case we still bump (so
              // the player doesn't get spammed on every future drop) but
              // log to telemetry.
              try {
                if (typeof loadLifetimeInt === 'function' && nt >= 5 && !window.__bloomBotActive && !skinTrialMode) {
                  var lifetimeBest = loadLifetimeInt(BEST_TIER_KEY) || 0;
                  if (nt > lifetimeBest) {
                    var lf1Retries = 0;
                    var lf1Try = function() {
                      var legendaryShowing = false;
                      try {
                        legendaryShowing = !!document.querySelector('[data-bloom-banner="chain-legendary"]');
                      } catch (e) {}
                      if (legendaryShowing && lf1Retries < 15) {
                        lf1Retries++;
                        setTimeout(lf1Try, 200);
                        return;
                      }
                      // Mount succeeded OR we gave up after ~3s. Either way,
                      // bump the marker so the player isn't spammed on every
                      // future drop. If we gave up, the analytics event will
                      // show 'lifetime_first_tier' with a `deferred` flag for
                      // post-hoc inspection.
                      try {
                        if (!legendaryShowing) showLifetimeFirstTierOverlay(nt);
                        else if (typeof trackEvent === 'function') {
                          trackEvent('lifetime_first_tier_deferred', { tier: nt, retries: lf1Retries });
                        }
                      } catch (e) {}
                      try { bumpLifetimeMax(BEST_TIER_KEY, nt); } catch (e) {}
                    };
                    setTimeout(lf1Try, 900); // let the per-game banner play first
                  }
                }
              } catch (e) {}
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
              // LF.2 — capture lifetime-best BEFORE bumping so the celebration
              // logic can detect "first time ever reaching chain N" moments.
              // Pure read, no behavior change for the existing bumpLifetimeMax.
              var prevChainBest = (typeof loadLifetimeInt === 'function') ? (loadLifetimeInt(BEST_CHAIN_KEY) || 0) : 0;
              bumpLifetimeMax(BEST_CHAIN_KEY, chainCount);
              // Onboarding: first merge → step 2; first chain (≥2) → step 3.
              if (chainCount === 1) maybeOnboardStep2();
              else if (chainCount >= 2) maybeOnboardStep3();
              if (chainCount >= 2) {
                const m = chainCount === 2 ? 1.5 : chainCount === 3 ? 2 : chainCount === 4 ? 2.5 : 3;
                showChainBadge(chainCount, m, { lifetimeFirst: chainCount > prevChainBest });
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
      // HOME.3 dopamine: v2 fires gold particles flying merged-cell → score on
      // every merge (the core-loop reward made tactile). Gated v2On so classic
      // skips even the lookup; the function self-skips bots / Aurora / reduced-motion.
      if (typeof v2On === 'function' && v2On() && typeof v2FlyParticlesToScore === 'function') {
        var v2MergedCellEl = document.querySelector(
          '#grid .cell[data-r="' + merged[0] + '"][data-c="' + merged[1] + '"]'
        );
        if (v2MergedCellEl) v2FlyParticlesToScore(v2MergedCellEl, chainCount);
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

  // DG.1 — count empty cells in the playable area (excluding shape voids
  // and locked cells, which are walls not slots). Used by updateDangerMode
  // to drive the near-game-over warning state.
  function countEmptyPlayableCells() {
    if (!Array.isArray(grid) || !grid.length) return 0;
    var cols = getBoardCols();
    var rows = getBoardRows();
    var n = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (isShapeInactiveAt(r, c)) continue;
        if (isLockedAt(r, c)) continue;
        if (grid[r] && grid[r][c] === 0) n++;
      }
    }
    return n;
  }

  // DG.1 — toggle body.danger-mode when the grid is near-full. Fires sound
  // + buzz ONCE on the rising edge (entering danger) so the warning is
  // unmissable but doesn't spam while the player struggles to recover.
  // Skipped during onboarding (FTUE) + bot games to avoid spurious alerts.
  function updateDangerMode() {
    // Skip during game-over screen + before grid is initialized.
    if (window.__bloomGameOver) return;
    if (!Array.isArray(grid) || !grid.length) return;
    // Skip for bot games — alarms during AI play are noise.
    if (window.__bloomBotActive) return;
    var empties = countEmptyPlayableCells();
    var threshold = 3; // ≤3 empty cells = "one careless move from over"
    var shouldBeDanger = empties > 0 && empties <= threshold;
    // AD.4 — live "moves to survive" meter. Turns danger from a passive red
    // wash into a tactical puzzle ("can I free a cell in N moves?"). Repaint
    // the count on EVERY call (not just edges) so it stays accurate as the
    // player merges. Admin-gated by danger_meter_enabled (default on).
    try { paintDangerMeter(shouldBeDanger ? empties : 0); } catch (e) {}
    if (shouldBeDanger === inDangerMode) return; // no state change
    inDangerMode = shouldBeDanger;
    try {
      if (shouldBeDanger) {
        document.body.classList.add('danger-mode');
        // One-shot warning cue. Descending sawtooth pair (260 → 200Hz)
        // reads as a "danger" signal distinct from drop/merge/chain
        // pitches. Goes through tone() which already respects mute.
        if (typeof tone === 'function') {
          try {
            tone({ freq: 260, duration: 0.18, type: 'sawtooth', vol: 0.10, filter: 1800 });
            tone({ freq: 200, duration: 0.22, type: 'sawtooth', vol: 0.12, filter: 1500, delay: 0.12 });
          } catch (e) {}
        }
        if (typeof buzz === 'function') {
          try { buzz([20, 60, 20]); } catch (e) {}
        }
      } else {
        document.body.classList.remove('danger-mode');
        // CS.1 — CLUTCH SAVE. Falling-edge celebration: we were in danger,
        // and now we're not. This is THE most cinematic moment in any
        // board game — the player just escaped game-over via a merge.
        // Cooldown 5s prevents oscillation spam (player who rapidly
        // enters/exits danger doesn't get spammed). Don't fire if the
        // empties count is suspiciously high (>= 8) — that means the
        // recovery came from continue-ad clearing rows, not a clutch
        // merge, and shouldn't be celebrated as one.
        var now = Date.now();
        if (now - lastClutchSaveAt > 5000 && empties < 8) {
          lastClutchSaveAt = now;
          try { showClutchSaveBanner(); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // AD.4 — the live "moves to survive" meter. A small pill anchored to the
  // grid showing how many empty cells remain when in danger. empties=0 → hide.
  // Built once, then text-only updates (cheap, no flicker). Gated by the admin
  // key danger_meter_enabled (default on) so it can be turned off globally.
  function paintDangerMeter(empties) {
    var enabled = true;
    try {
      if (typeof gameConfig === 'object' && gameConfig && gameConfig.danger_meter_enabled === 'false') enabled = false;
    } catch (e) {}
    var existing = document.getElementById('danger-meter');
    if (!enabled || !empties || empties <= 0) {
      if (existing) existing.remove();
      return;
    }
    var wrap = document.getElementById('grid-wrap');
    if (!wrap) { if (existing) existing.remove(); return; }
    // AD.4 fix: mount into grid-wrap's PARENT (.app), NOT grid-wrap itself.
    // grid-wrap has overflow-y:auto / overflow-x:hidden, which CLIPS an
    // absolutely-positioned child sitting above its top edge — the pill
    // (top:-14px) showed as a thin red sliver half-hidden behind the
    // tier-bar (most visible during a live race, where the grid fills to
    // ~1 empty cell). .app is position:relative and doesn't clip in this
    // band, and the pill becomes the last child → highest paint order.
    var host = wrap.parentNode;
    if (!host) { if (existing) existing.remove(); return; }
    var el = existing;
    if (!el) {
      el = document.createElement('div');
      el.id = 'danger-meter';
      el.className = 'danger-meter';
    }
    if (el.parentNode !== host) {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(el);
    }
    // Anchor just above the grid (mirrors the old top:-14px intent) but
    // relative to .app so it escapes grid-wrap's overflow clipping. offsetTop
    // is dynamic, so it tracks the live-race padding-top shift automatically.
    try { el.style.top = Math.max(2, wrap.offsetTop - 14) + 'px'; } catch (e) {}
    var word = empties === 1 ? 'תא אחרון!' : (empties + ' תאים');
    el.textContent = '🚨 ' + word;
    el.className = 'danger-meter' + (empties === 1 ? ' danger-meter-critical' : '');
  }

  // CS.1 — the "you escaped game-over!" celebration. Gold-green gradient
  // (relief colors) with "💪 ניצלת ברגע!" copy. Slightly bigger than the
  // chain badge but smaller than the legendary overlay so the visual
  // hierarchy reads: clutch save < legendary chain < lifetime first.
  function showClutchSaveBanner() {
    var banner = document.createElement('div');
    banner.setAttribute('data-bloom-banner', 'clutch-save');
    banner.className = 'clutch-save-banner';
    banner.innerHTML =
      '<div class="cs-eyebrow">💪 ניצלת ברגע!</div>' +
      '<div class="cs-sub">המשך לשחק כדי לעלות יותר</div>';
    document.body.appendChild(banner);
    setTimeout(function() { try { banner.remove(); } catch (e) {} }, 1700);
    // Audio: rising tone pair (340 → 540Hz, opposite of the danger-enter
    // cue) reads as "relief / rescue". Then a brief milestone twinkle.
    if (typeof tone === 'function') {
      try {
        tone({ freq: 340, duration: 0.14, type: 'triangle', vol: 0.10, filter: 4000 });
        tone({ freq: 540, duration: 0.22, type: 'triangle', vol: 0.12, filter: 5000, delay: 0.10 });
      } catch (e) {}
    }
    if (typeof soundMilestone === 'function') {
      try { setTimeout(function() { soundMilestone(4); }, 240); } catch (e) {}
    }
    // Buzz: relief pulse — slower, softer than the chain-celebration
    // pattern. Reads as "exhale" not "punch".
    if (typeof buzz === 'function') {
      try { buzz([40, 80, 40, 80, 80]); } catch (e) {}
    }
    // Small confetti — relief sparkle, not full celebration. The full
    // moment-of-glory confetti is reserved for chain 5+ + lifetime-first.
    if (typeof showConfetti === 'function') {
      try { showConfetti(14); } catch (e) {}
    }
    try {
      if (typeof trackEvent === 'function') trackEvent('clutch_save', {});
    } catch (e) {}
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

  // ============================================================
  // AS.1 — Anti-stall: Flow meter (C) + Idle pressure (B)
  // ============================================================
  // Kills the "stall and wait for a bomb" exploit and rewards engaged play.
  // The flow meter builds with fast consecutive drops and multiplies merge
  // score; it resets when the player idles past the window. The idle watcher
  // nudges (and optionally acts) when the player camps. All admin-tunable via
  // gameConfig (flow_*, idle_*); every helper no-ops when its toggle is off.
  var flowLevel = 0;            // current flow level (0 = no bonus)
  var flowLastActivity = 0;     // ts of the last drop (also drives idle watch)
  var _idleTimer = null;        // idle-pressure interval handle
  var idleWarnEl = null;        // on-screen idle warning banner

  function _flowCfgNum(key, def) {
    var v = (typeof gameConfig === 'object' && gameConfig) ? gameConfig[key] : undefined;
    var n = parseFloat(v); return isFinite(n) ? n : def;
  }
  function _flowCfgOn(key) {
    return !(typeof gameConfig === 'object' && gameConfig && gameConfig[key] === 'false');
  }
  function flowMultiplier() {
    if (!_flowCfgOn('flow_meter_enabled') || flowLevel <= 0) return 1;
    return Math.min(_flowCfgNum('flow_max_mult', 2.0), 1 + flowLevel * _flowCfgNum('flow_mult_per_level', 0.15));
  }
  function flowMaxLevel() {
    var per = _flowCfgNum('flow_mult_per_level', 0.15);
    return per > 0 ? Math.ceil((_flowCfgNum('flow_max_mult', 2.0) - 1) / per) : 0;
  }
  function flowOnDrop() {
    if (!_flowCfgOn('flow_meter_enabled')) { flowLevel = 0; return; }
    var now = Date.now();
    var win = _flowCfgNum('flow_window_ms', 2500);
    if (flowLastActivity && (now - flowLastActivity) <= win) flowLevel = Math.min(flowMaxLevel(), flowLevel + 1);
    else flowLevel = 0; // too slow — start a fresh combo
    paintFlowPill();
  }
  function paintFlowPill() {
    var pill = document.getElementById('flow-pill');
    var m = flowMultiplier();
    if (!_flowCfgOn('flow_meter_enabled') || flowLevel <= 0 || m <= 1 || window.__bloomGameOver) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'flow-pill';
      pill.className = 'flow-pill';
      document.body.appendChild(pill);
    }
    pill.textContent = '🔥 זרימה ×' + (Math.round(m * 10) / 10);
    pill.classList.toggle('flow-hot', m >= 1.6);
    pill.classList.remove('flow-pop'); void pill.offsetWidth; pill.classList.add('flow-pop');
  }
  function resetFlow() {
    flowLevel = 0; flowLastActivity = 0;
    var pill = document.getElementById('flow-pill'); if (pill) pill.remove();
  }
  function showIdleWarn() {
    // Don't nag before the first move of a game — a player reading a fresh
    // board is not "stalling". The nudge only earns its place once they've
    // engaged (dropsCount > 0). Removes the banner-over-the-board on entry.
    if (typeof dropsCount === 'number' && dropsCount === 0) return;
    if (idleWarnEl && document.body.contains(idleWarnEl)) return;
    idleWarnEl = document.createElement('div');
    idleWarnEl.className = 'idle-warn-banner';
    idleWarnEl.id = 'idle-warn-banner';
    idleWarnEl.textContent = '⏰ שחק! הבונוסים מגיעים רק כשמשחקים';
    document.body.appendChild(idleWarnEl);
  }
  function doIdleAction() {
    var action = (typeof gameConfig === 'object' && gameConfig && gameConfig.idle_action) || 'warn';
    if (action === 'expire') { try { if (typeof clearActiveEvent === 'function') clearActiveEvent(); } catch (e) {} showIdleWarn(); return; }
    if (action === 'autodrop') {
      try {
        if (window.__bloomGameOver || busy) return;
        var bestCol = 0, bestRoom = -1;
        for (var c = 0; c < getBoardCols(); c++) {
          var room = 0;
          for (var r = 0; r < getBoardRows(); r++) { if (grid[r] && grid[r][c] === 0 && !isShapeInactiveAt(r, c) && !isLockedAt(r, c)) room++; }
          if (room > bestRoom) { bestRoom = room; bestCol = c; }
        }
        if (bestRoom > 0) drop(bestCol);
      } catch (e) {}
      return;
    }
    showIdleWarn(); // 'warn' (default) — gentle nudge only
  }
  function startIdleWatch() {
    stopIdleWatch();
    if (!_flowCfgOn('idle_pressure_enabled')) return;
    flowLastActivity = Date.now();
    _idleTimer = setInterval(function() {
      if (window.__bloomGameOver || busy || !flowLastActivity) return;
      // Only act during visible gameplay — never nudge/auto-drop on home, the
      // over-screen, a contest/challenge menu, etc.
      if (typeof isGameSurfaceVisible === 'function' && !isGameSurfaceVisible()) return;
      var idleMs = Date.now() - flowLastActivity;
      // Flow decays once the player idles past the window — a staller can't
      // keep a high multiplier by waiting.
      if (flowLevel > 0 && idleMs > _flowCfgNum('flow_window_ms', 2500)) { flowLevel = 0; paintFlowPill(); }
      var idleSec = idleMs / 1000;
      if (idleSec >= _flowCfgNum('idle_action_seconds', 18)) { doIdleAction(); flowLastActivity = Date.now(); }
      else if (idleSec >= _flowCfgNum('idle_warn_seconds', 10)) { showIdleWarn(); }
    }, 1000);
  }
  function stopIdleWatch() {
    if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
    if (idleWarnEl) { try { idleWarnEl.remove(); } catch (e) {} idleWarnEl = null; }
  }

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
        // DG.1 — clear danger-mode aura immediately when game-over fires.
        // Without this the over-screen renders behind a red-pulsing grid
        // and red-tinted empty cells — polluting the most emotional surface
        // in the game. `updateDangerMode()` early-returns on the game-over
        // flag, so it can't self-clear.
        try { document.body.classList.remove('danger-mode'); inDangerMode = false; } catch (e) {}
        // M2 fix (silent-failure-hunter audit): clear the clutch-save
        // banner if it's still on a 1.7s timeout. A merge that escapes
        // danger AND triggers game-over in the same drop would otherwise
        // show "💪 ניצלת ברגע!" overlapping the game-over screen.
        try {
          document.querySelectorAll('[data-bloom-banner="clutch-save"], .clutch-save-banner').forEach(function(b) { b.remove(); });
        } catch (e) {}
        if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
        stopEventSystem();
        // TB.1 — tear down the floating booster strip so it doesn't sit
        // on top of the over screen's share / play-again buttons.
        try {
          var __bs1 = document.getElementById('booster-strip');
          if (__bs1) __bs1.remove();
        } catch (e) {}
        // === LIVE RACE: the player's board filled before the 60-second clock. ===
        // Do NOT fall through to the practice over-screen + submitDuelScore +
        // difficulty-leaderboard path below — those overlays stack on top of the
        // still-running live HUD + 1s poll and make the screen "go crazy" and
        // freeze with the nav hidden. Hand off to the live-race module, which
        // locks the score, spectates the opponent for the remaining seconds,
        // then shows the winner at 0:00. Fully gated on _liveRaceMode → classic
        // and ordinary practice are byte-identical. (live-race bug fix)
        if (window._liveRaceMode && typeof window.__bloomOnLiveRaceBoardFull === 'function') {
          try { window.__bloomOnLiveRaceBoardFull(); } catch (e) {}
          return;
        }
        // Save best score BEFORE rendering game-over
        var isNewBest = score > best && !skinTrialMode;
        if (isNewBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
        // TA.1 — snapshot for refresh-restore. Practice/dynamic/contest
        // only; daily is excluded (DAILY_PLAYED_PREFIX handles it).
        saveLastGameSnapshot({ isNewBest: isNewBest });
        // Stage 20 — Starter Pack trigger: fire when player crosses trigger
        // score for the first time. Throttled inside maybeOfferStarterPack.
        // We fire it with the CURRENT game score (not best) so the trigger
        // can stamp eligible_at on the very first qualifying game.
        if (!skinTrialMode && !window.__bloomBotActive && typeof maybeOfferStarterPack === 'function') {
          try { maybeOfferStarterPack(score); } catch (e) {}
        }
        // Stage 28 — Pet XP grant. Fires for ALL game modes so the pet
        // grows continuously regardless of what the player chooses to play.
        // Server-side dedup per gameId prevents double-grant.
        if (!skinTrialMode && !window.__bloomBotActive && typeof grantPetXpForGame === 'function') {
          try {
            var __gid = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : ('game-' + Date.now());
            grantPetXpForGame(__gid);
          } catch (e) {}
        }
        // Stage 27 — Guild contribution. Count crowns (tier-8 tiles) on the
        // final grid. Server validates membership; safe no-op if not in a guild.
        if (!skinTrialMode && !window.__bloomBotActive && typeof contributeToGuild === 'function') {
          try {
            var __crowns = 0;
            try {
              if (typeof grid !== 'undefined') {
                for (var __cr = 0; __cr < grid.length; __cr++) {
                  for (var __cc = 0; __cc < (grid[__cr] || []).length; __cc++) {
                    if (grid[__cr][__cc] === 8) __crowns++;
                  }
                }
              }
            } catch (e) {}
            contributeToGuild(score, __crowns);
          } catch (e) {}
        }
        // Stage 38 — Trophy Road grant. Server-rolled trophy delta based on
        // score + tier + isNewBest. Fire-and-forget; toast + arena celebration
        // are rendered by the trophy module's own response handler.
        if (!skinTrialMode && !window.__bloomBotActive && typeof grantTrophiesForGame === 'function') {
          try {
            var __gid2 = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : '';
            var __isNewBest = (score > 0 && score === best);
            grantTrophiesForGame({
              score: score, tier: highestTier,
              isNewBest: __isNewBest,
              source: mode || 'game',
              gameId: __gid2
            });
          } catch (e) {}
        }
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
          // T1.1 — check progressive-unlock thresholds + refresh balance widget.
          // Order matters: incrementGamesPlayed happens BEFORE level check
          // so getPlayerLevel() reflects the JUST-finished game.
          try { if (typeof checkLevelUnlock === 'function') checkLevelUnlock(); } catch (e) {}
          try { if (typeof window.__bloomRenderBal === 'function') window.__bloomRenderBal(); } catch (e) {}
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
        // Task #23 — variable-reward Mystery Chest at EVERY game-over, not just
        // dynamic boards. The Skinner-box is the core retention loop; leaving
        // the most-played modes (daily/practice/contest) without it left them
        // flat. Pity floor + daily cap are server-enforced. Checked BEFORE
        // submitDuelScore() nulls activeDuelId so duels are correctly excluded.
        if (chestAllModesEnabled() && !window.__bloomBotActive && !skinTrialMode &&
            !activeDuelId && !window._duelMode &&
            (mode === 'daily' || mode === 'practice' || mode === 'contest') &&
            typeof openMysteryChest === 'function') {
          setTimeout(function() { try { openMysteryChest(); } catch (e) {} }, 950);
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
    // AS.1 — anti-stall: this is the canonical "a real drop happened" point.
    // Build the flow meter (rewards fast consecutive drops) and reset the
    // idle timer (so the idle-pressure watcher only fires when the player
    // is genuinely camping).
    flowOnDrop();
    flowLastActivity = Date.now();
    if (idleWarnEl) { try { idleWarnEl.remove(); } catch (e) {} idleWarnEl = null; }
    // A9 — Ghost Mode: record the column of every drop so the player's
    // run can be replayed as a ghost by another player later. Stored
    // in-memory; serialized into the score submission payload at game-over.
    try {
      if (!Array.isArray(window.__bloomDropsSeq)) window.__bloomDropsSeq = [];
      window.__bloomDropsSeq.push(col | 0);
    } catch (e) {}
    // Ghost playback tick: advance the ghost to the matching drop index
    // and update the score-vs-score HUD.
    try { if (typeof __bloomGhostTick === 'function') __bloomGhostTick(dropsCount); } catch (e) {}
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
    // GV.4 — v2 ONLY: play the true full-column fall (tile falls from the top of
    // the column through every empty row to its landing cell). Gated + awaited so
    // the whole fall is visible before merges shift the board. Classic = no-op.
    if (typeof v2On === 'function' && v2On() && typeof v2PlayFall === 'function') {
      try { await v2PlayFall(row, col); } catch (e) {}
    }
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
      // DG.1 — same cleanup as the column-full game-over branch above.
      try { document.body.classList.remove('danger-mode'); inDangerMode = false; } catch (e) {}
      if (window.endHeartbeat) window.endHeartbeat(); // remove from admin live view
      stopEventSystem();
      // TB.1 — tear down the floating booster strip so the over screen
      // isn't obscured by a stuck tool tray.
      try {
        var __bs2 = document.getElementById('booster-strip');
        if (__bs2) __bs2.remove();
      } catch (e) {}
      // === LIVE RACE board-full (second game-over path: board fills AFTER a
      // merge/gravity settle, e.g. a גהינום game that reaches Crown). Same
      // divert as the column-full branch above — without this, the practice
      // over-screen stacks under the still-running live HUD and freezes the
      // screen. Fully gated on _liveRaceMode. (live-race bug fix) ===
      if (window._liveRaceMode && typeof window.__bloomOnLiveRaceBoardFull === 'function') {
        try { window.__bloomOnLiveRaceBoardFull(); } catch (e) {}
        return;
      }
      // TA.1 — snapshot for refresh-restore (practice/dynamic/contest).
      saveLastGameSnapshot({ isNewBest: isNewBest });
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
            if (__streakResult && __streakResult.milestoneHit) {
              // Use the new dyn_streak_milestone action — server reads
              // the reward from dyn_streak_reward_<N> config. Bypasses
              // the event_gift clamp that was paying only ~10💎 instead
              // of the configured 50/150/300/600/1000/2000.
              try {
                if (typeof earnCredits === 'function') {
                  earnCredits('dyn_streak_milestone', {
                    milestone: __streakResult.milestoneHit
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        // Achievements pass — grants every newly-earned per-board and
        // cross-board achievement, returns the unlocks list for the
        // over screen. Rank-1 detection runs separately after the
        // leaderboard fetch resolves below.
        var __achUnlocks = [];
        try {
          if (typeof checkAndGrantAchievements === 'function') {
            __achUnlocks = checkAndGrantAchievements({
              boardId: __boardId,
              score: score,
              tier: highestTier,
              rank: null,
              knownBoards: window._availableBoards || []
            }) || [];
          }
        } catch (e) {}
        // Daily quests progress — updates the 3 quests for today.
        // Returns array of newly-completed quests (manual claim, so
        // the over screen shows "✅ הושלמה — לחץ לקבל את הפרס").
        var __questsCompleted = [];
        try {
          if (typeof applyQuestProgressOnGameOver === 'function') {
            __questsCompleted = applyQuestProgressOnGameOver({
              boardId: __boardId,
              board: window._activeDynamicBoard,
              score: score,
              tier: highestTier,
              rank: null,
              isBoardBest: __isBoardBest
            }) || [];
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
          streakResult: __streakResult,
          achUnlocks: __achUnlocks,
          questsCompleted: __questsCompleted
        });
        // 🎁 Mystery Chest — fire the Skinner-box reveal ~900ms after
        // the game-over UI lands so the player has a beat to read the
        // headline before the chest takes over. Server rolls the dice.
        if (typeof openMysteryChest === 'function') {
          setTimeout(function() { try { openMysteryChest(); } catch (e) {} }, 900);
        }
        // 🎖 Season Pass XP — server grants XP based on score/tier,
        // dedup'd per gameId. Fire silently; the level-up toast
        // (handled inside grantSeasonXpForGame) is delayed to land
        // AFTER the chest reveal so the dopamine bursts don't overlap.
        if (typeof grantSeasonXpForGame === 'function') {
          try {
            var __sessionGameId = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : 'dyn-' + __boardId + '-' + Date.now();
            // Pass boardId so the server can apply the Daily Special XP multiplier.
            grantSeasonXpForGame(__sessionGameId, score, highestTier, __boardId);
          } catch (e) {}
        }
        // Stage 29 — Album. Record the highest tier reached on this board.
        // Server idempotently inserts tiles 1..highestTier.
        if (typeof recordAlbumProgress === 'function' && highestTier >= 1) {
          try { recordAlbumProgress(__boardId, highestTier); } catch (e) {}
        }
        // Stage 15 — mark today's special as played if this game was the
        // special board. Drives the home FOMO label to switch off.
        try {
          var __ds = window._dailySpecial;
          if (__ds && __ds.enabled && __ds.id === __boardId && typeof markDailySpecialPlayed === 'function') {
            markDailySpecialPlayed(__ds.date, __boardId);
            if (typeof updateDynamicBoardsButton === 'function') {
              try { updateDynamicBoardsButton(); } catch (e) {}
            }
          }
        } catch (e) {}
        // 🏆 Live Tournament — if there's a tournament currently in its
        // window, auto-submit this score. Server best-score-wins.
        if (typeof submitTournamentScoreFromGame === 'function') {
          try { submitTournamentScoreFromGame(score, highestTier, window.__bloomDropCount || 0); } catch (e) {}
        }
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
                // Second-pass achievement check now that we know the
                // global rank. Fires the leaderboard1 cross-board ach.
                if (rank === 1 && typeof checkAndGrantAchievements === 'function') {
                  try {
                    var post = checkAndGrantAchievements({
                      boardId: __boardId,
                      score: score,
                      tier: highestTier,
                      rank: 1,
                      knownBoards: window._availableBoards || []
                    });
                    if (post && post.length && typeof renderAchievementUnlockToast === 'function') {
                      post.forEach(function(u) { renderAchievementUnlockToast(u); });
                    }
                  } catch (e) {}
                }
                // Second-pass quest check for the beat_leader quest.
                if (rank === 1 && typeof applyQuestProgressOnGameOver === 'function') {
                  try {
                    var postQ = applyQuestProgressOnGameOver({
                      boardId: __boardId,
                      board: window._activeDynamicBoard,
                      score: score,
                      tier: highestTier,
                      rank: 1,
                      isBoardBest: __isBoardBest
                    });
                    if (postQ && postQ.length && typeof renderQuestCompletedToast === 'function') {
                      postQ.forEach(function(qd) { renderQuestCompletedToast(qd); });
                    }
                  } catch (e) {}
                }
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

