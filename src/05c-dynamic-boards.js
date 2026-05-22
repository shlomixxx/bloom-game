  // ============================================================
  // Dynamic Boards picker (May 2026)
  //
  // Boards are an OPT-IN game mode. The home screen shows a single
  // "🎯 לוחות דינמיים" button — only when the admin has at least one
  // available board AND it's currently in its schedule window. Tapping
  // the button opens a picker; tapping a board there starts a new
  // 'dynamic' mode session with that board's multipliers applied.
  //
  // Daily / contest / duel / challenge / default-practice never see
  // any of this — same engine, same vanilla pointsFor() chokepoint
  // (column multiplier = null when nothing is selected).
  // ============================================================

  // ============================================================
  // FOMO time helpers (Phase 6 — LiveOps urgency layer).
  //
  // Boards can carry starts_at + ends_at timestamps. We use them
  // to create scarcity: "💕 ולנטיין מסתיים בעוד 4ש 12ד" forces
  // the player to return to the home screen to check what's
  // available before it disappears. Wordle-style daily reset
  // psychology applied to special boards.
  // ============================================================
  function boardEndsInMs(board) {
    if (!board || !board.ends_at) return Infinity;
    var t = Date.parse(board.ends_at);
    if (!Number.isFinite(t)) return Infinity;
    return t - Date.now();
  }
  function boardJustStarted(board) {
    if (!board || !board.starts_at) return false;
    var t = Date.parse(board.starts_at);
    if (!Number.isFinite(t)) return false;
    var age = Date.now() - t;
    return age >= 0 && age < 24 * 3600 * 1000;
  }
  // Urgency tier: 'new' (just started <24h) / 'critical' (<4h ends) /
  // 'soon' (<24h ends) / 'normal' (>24h or no ends_at).
  function boardUrgency(board) {
    var endsIn = boardEndsInMs(board);
    if (endsIn !== Infinity && endsIn <= 0) return 'expired';
    if (endsIn !== Infinity && endsIn < 4 * 3600 * 1000)   return 'critical';
    if (endsIn !== Infinity && endsIn < 24 * 3600 * 1000)  return 'soon';
    if (boardJustStarted(board))                            return 'new';
    return 'normal';
  }
  function fmtCountdown(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    var totalMin = Math.floor(ms / 60000);
    var d = Math.floor(totalMin / (60 * 24));
    var h = Math.floor((totalMin % (60 * 24)) / 60);
    var m = totalMin % 60;
    if (d > 0) return d + 'י ' + h + 'ש';
    if (h > 0) return h + 'ש ' + (m < 10 ? '0' : '') + m + 'ד';
    return m + ' דקות';
  }
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var dd = d.getDate();
    var mm = d.getMonth() + 1;
    return dd + '/' + mm;
  }
  // Pick the board the player should care about MOST right now: a critical
  // one wins over a new one, which wins over a soon one. Returns null if
  // every board is "normal" (no FOMO to surface).
  function pickFocusBoard(boards) {
    if (!Array.isArray(boards) || !boards.length) return null;
    var byUrgency = { critical: [], new: [], soon: [] };
    for (var i = 0; i < boards.length; i++) {
      var u = boardUrgency(boards[i]);
      if (byUrgency[u]) byUrgency[u].push(boards[i]);
    }
    if (byUrgency.critical.length) {
      // Closest-to-ending first
      return byUrgency.critical.sort(function(a, b) { return boardEndsInMs(a) - boardEndsInMs(b); })[0];
    }
    if (byUrgency.new.length) return byUrgency.new[0];
    if (byUrgency.soon.length) {
      return byUrgency.soon.sort(function(a, b) { return boardEndsInMs(a) - boardEndsInMs(b); })[0];
    }
    return null;
  }
  function urgencyEmoji(u) {
    return u === 'critical' ? '🔥' : u === 'new' ? '🆕' : u === 'soon' ? '⏰' : '';
  }

  // 60s tick that updates every visible countdown — home button + picker
  // cards. Started by updateDynamicBoardsButton, torn down when boards
  // disappear from the home (e.g., player navigated away).
  var _fomoTickHandle = null;
  function startFomoTick() {
    if (_fomoTickHandle) return;
    _fomoTickHandle = setInterval(function() {
      updateDynamicBoardsButton();
      // Re-render picker cards if open — countdowns roll.
      var pickerOpen = document.getElementById('dynamic-boards-picker');
      if (pickerOpen && typeof refreshPickerTimers === 'function') refreshPickerTimers();
    }, 60 * 1000);
  }
  function stopFomoTick() {
    if (_fomoTickHandle) { clearInterval(_fomoTickHandle); _fomoTickHandle = null; }
  }

  // ============================================================
  // Admin-controlled config readers (May 2026)
  //
  // Every reward and feature toggle in the dynamic-boards retention
  // stack reads from gameConfig (loaded from /api/config). Defaults
  // mirror the original hardcoded values so legacy DBs that haven't
  // run the schema seeds still work. Master toggles default to true
  // — admin opts OUT, not in.
  // ============================================================
  function dynConfig(key, defaultValue) {
    try {
      if (typeof gameConfig !== 'undefined' && gameConfig && gameConfig[key] != null && gameConfig[key] !== '') {
        return gameConfig[key];
      }
    } catch (e) {}
    return defaultValue;
  }
  function dynConfigInt(key, defaultValue) {
    var raw = dynConfig(key, null);
    if (raw == null || raw === '') return defaultValue;
    var n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : defaultValue;
  }
  function dynConfigBool(key, defaultValue) {
    var raw = dynConfig(key, null);
    if (raw == null || raw === '') return defaultValue;
    return String(raw) !== 'false';
  }
  function dynFeatureEnabled(name) {
    // Master toggles — admin can disable each retention system.
    if (name === 'quests')        return dynConfigBool('dyn_quests_enabled',        true);
    if (name === 'achievements')  return dynConfigBool('dyn_achievements_enabled',  true);
    if (name === 'streak')        return dynConfigBool('dyn_streak_enabled',        true);
    if (name === 'personal_best') return dynConfigBool('dyn_personal_best_enabled', true);
    if (name === 'global_lb')     return dynConfigBool('dyn_global_lb_enabled',     true);
    if (name === 'fomo')          return dynConfigBool('dyn_fomo_enabled',          true);
    return true;
  }
  window.dynFeatureEnabled = dynFeatureEnabled;
  window.dynConfigInt      = dynConfigInt;

  // Called by the audio module after /api/boards/available resolves.
  // Toggles the home button's visibility. Safe to call when home isn't
  // mounted yet — it just no-ops.
  function updateDynamicBoardsButton() {
    var btn = document.getElementById('home-v2-boards');
    if (!btn) return;
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    if (!boards.length) {
      btn.style.display = 'none';
      stopFomoTick();
      return;
    }
    btn.style.display = '';
    var countEl = btn.querySelector('.home-v2-boards-count');
    var focus = pickFocusBoard(boards);
    // Streak status — if the player is on day ≥3 and HASN'T played
    // today, that's the highest-priority headline (loss aversion).
    // Master toggle: when admin disables streak feature, both the
    // count and the in-danger flag are forced to falsy values.
    var streakEnabled = dynFeatureEnabled('streak');
    var streakSt = (streakEnabled && typeof getDynamicStreak === 'function') ? getDynamicStreak() : { count: 0, last: null };
    var streakDanger = streakEnabled && typeof isStreakInDanger === 'function' && isStreakInDanger();
    var fomoEnabled = dynFeatureEnabled('fomo');
    // Quest claimable check — highest-priority headline when present
    // (a free 💎 sitting unclaimed is louder than any FOMO countdown).
    var qHomeSum = (typeof questsSummary === 'function') ? questsSummary() : null;
    var questClaimable = !!(qHomeSum && qHomeSum.claimable > 0);
    // Stage 15 — Daily Special check. Highest-positive-opportunity signal.
    // Shown only when the player hasn't played today's special yet.
    var dsHome = window._dailySpecial;
    var dailySpecialBoard = (dsHome && dsHome.enabled && dsHome.id)
      ? boards.find(function(bb) { return bb.id === dsHome.id; }) : null;
    var dailySpecialUnplayed = !!(dailySpecialBoard && !hasPlayedDailySpecialToday(dsHome.date, dsHome.id));
    if (countEl) {
      // Default label
      var defaultLabel = boards.length + ' ' + (boards.length === 1 ? 'לוח זמין' : 'לוחות זמינים');
      var label;
      // Quest-claimable: top priority — there's free 💎 waiting.
      if (questClaimable) {
        label = '🎁 ' + qHomeSum.claimable + ' פרס' + (qHomeSum.claimable === 1 ? '' : 'ים') + ' של משימה ממתינים לך — לחץ!';
      }
      // Streak-in-danger overrides everything except quest-claimable —
      // losing a streak is the strongest negative-loss signal.
      else if (streakDanger) {
        label = '🔥 הרצף שלך בסכנה! ' + streakSt.count + ' ימים — שחק היום';
      }
      // Daily Special unplayed — the "what's special today?" hook. Strongest
      // positive signal because it changes daily, teaching open-app habit.
      else if (dailySpecialUnplayed) {
        var xpML = (dsHome.xpMult % 1 === 0) ? dsHome.xpMult + '×' : dsHome.xpMult.toFixed(1) + '×';
        label = '🌟 הלוח של היום: ' + (dailySpecialBoard.name || 'לוח') + ' · ' + xpML + ' XP מחכים!';
      } else if (focus && fomoEnabled) {
        var u = boardUrgency(focus);
        var endsIn = boardEndsInMs(focus);
        if (u === 'critical') {
          label = '🔥 ' + (focus.name || 'לוח') + ' מסתיים בעוד ' + fmtCountdown(endsIn);
        } else if (u === 'new') {
          label = '🆕 ' + (focus.name || 'לוח') + ' — חדש היום';
        } else if (u === 'soon') {
          label = '⏰ ' + (focus.name || 'לוח') + ' — נשאר ' + fmtCountdown(endsIn);
        } else if (streakSt.count >= 1) {
          // Calm-state streak surfacing — even without urgency, show
          // the streak so the player knows what they're protecting.
          label = '🔥 רצף ' + streakSt.count + (streakSt.count === 1 ? ' יום' : ' ימים') + ' · ' + defaultLabel;
        } else {
          label = defaultLabel;
        }
      } else if (streakSt.count >= 1) {
        label = '🔥 רצף ' + streakSt.count + (streakSt.count === 1 ? ' יום' : ' ימים') + ' · ' + defaultLabel;
      } else {
        label = defaultLabel;
      }
      countEl.textContent = label;
    }
    // Add urgency CSS class to the button so we can pulse it for critical.
    btn.classList.remove('fomo-critical', 'fomo-new', 'fomo-soon', 'fomo-streak-danger', 'fomo-quest-claim', 'fomo-daily-special');
    if (questClaimable) {
      btn.classList.add('fomo-quest-claim');
    } else if (streakDanger) {
      btn.classList.add('fomo-streak-danger');
    } else if (dailySpecialUnplayed) {
      btn.classList.add('fomo-daily-special');
    } else if (focus && fomoEnabled) {
      var fu = boardUrgency(focus);
      if (fu === 'critical' || fu === 'new' || fu === 'soon') btn.classList.add('fomo-' + fu);
    }
    startFomoTick();
  }

  // Stage 15 — Daily Special "played today" tracker. localStorage keyed by
  // date so it auto-resets at midnight. Marked via markDailySpecialPlayed()
  // from the game-over flow when boardId matches today's special.
  var DAILY_SPECIAL_PLAYED_KEY = 'bloom_dyn_daily_special_played';
  function hasPlayedDailySpecialToday(date, boardId) {
    if (!date || !boardId) return false;
    try {
      var raw = localStorage.getItem(DAILY_SPECIAL_PLAYED_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      return !!(obj && obj.date === date && obj.boardId === boardId);
    } catch (e) { return false; }
  }
  function markDailySpecialPlayed(date, boardId) {
    if (!date || !boardId) return;
    try {
      localStorage.setItem(DAILY_SPECIAL_PLAYED_KEY, JSON.stringify({ date: date, boardId: boardId }));
    } catch (e) {}
  }
  window.markDailySpecialPlayed = markDailySpecialPlayed;

  // Expose so the audio-module fetch can poke us.
  window.updateDynamicBoardsButton = updateDynamicBoardsButton;
  window.stopDynamicBoardsTick = stopFomoTick;

  // ============================================================
  // Per-board personal best — the "beat your score" addiction loop.
  //
  // Each board carries its own localStorage record so a player who
  // hit 47K on the Valentine board sees that target every time the
  // board appears in the picker, plus an in-game pill that tracks
  // it live. Score chase is the single strongest engine in puzzle
  // games — Wordle / Suika / Tetris all run on it.
  //
  // Keyed by board id (server-issued), not name, because two boards
  // can share a display name across edits but the id is stable.
  // ============================================================
  function boardBestKey(boardId) { return 'bloom_board_best_' + boardId; }
  function getBoardBest(boardId) {
    if (boardId == null) return null;
    try {
      var raw = localStorage.getItem(boardBestKey(boardId));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.score !== 'number') return null;
      return obj;
    } catch (e) { return null; }
  }
  function setBoardBest(boardId, score, tier) {
    if (boardId == null) return false;
    var prev = getBoardBest(boardId);
    if (prev && prev.score >= score) return false;
    try {
      localStorage.setItem(boardBestKey(boardId), JSON.stringify({
        score: score | 0,
        tier:  tier | 0,
        ts:    Date.now()
      }));
    } catch (e) {}
    return true;
  }
  function formatBoardScore(n) {
    if (!Number.isFinite(n)) return String(n);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'מ';
    if (n >= 10000)   return Math.round(n / 1000) + 'K';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  window.getBoardBest        = getBoardBest;
  window.setBoardBest        = setBoardBest;
  window.formatBoardScore    = formatBoardScore;

  // ============================================================
  // Cross-board streak (Phase 5 — multi-day return loop)
  //
  // The streak counts CONSECUTIVE Asia/Jerusalem days on which the
  // player has finished at least one dynamic-board game. Missing a
  // day resets the streak (no auto-freeze in v1 — losing it on
  // purpose makes the regain feel earned).
  //
  // Milestones: 3, 7, 14, 30 days. Each milestone fires a celebratory
  // game-over banner + grants credits via earnCredits('event_gift').
  // The home button + picker header surface the running streak so
  // the player is reminded every time they return to the app.
  // ============================================================
  var DYN_STREAK_KEY = 'bloom_dyn_streak';
  var DYN_STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];
  // Defaults (used as fallback when admin config keys are missing).
  // The live values come from dynStreakReward(milestone) which reads
  // dyn_streak_reward_<N> from gameConfig.
  var DYN_STREAK_REWARDS_DEFAULTS = { 3: 50, 7: 150, 14: 300, 30: 600, 60: 1000, 100: 2000 };
  function dynStreakReward(milestone) {
    return dynConfigInt('dyn_streak_reward_' + milestone, DYN_STREAK_REWARDS_DEFAULTS[milestone] || 0);
  }
  function getDynamicStreak() {
    try {
      var raw = localStorage.getItem(DYN_STREAK_KEY);
      if (!raw) return { count: 0, last: null, milestonesClaimed: [] };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.count !== 'number') return { count: 0, last: null, milestonesClaimed: [] };
      if (!Array.isArray(obj.milestonesClaimed)) obj.milestonesClaimed = [];
      return obj;
    } catch (e) {
      return { count: 0, last: null, milestonesClaimed: [] };
    }
  }
  function setDynamicStreak(obj) {
    try { localStorage.setItem(DYN_STREAK_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  // Returns YYYY-MM-DD in Asia/Jerusalem — same epoch as the daily seed.
  function streakToday() {
    if (typeof todayInIsrael === 'function') return todayInIsrael();
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function dayDiffDates(a, b) {
    if (!a || !b) return Infinity;
    var ad = new Date(a + 'T00:00:00');
    var bd = new Date(b + 'T00:00:00');
    return Math.round((bd - ad) / (24 * 60 * 60 * 1000));
  }
  // Streak freeze count — pure client-side counter. Server enforces
  // the purchase (200💎 atomic deduction); the count itself is local.
  // A determined cheater could give themselves freezes, but the only
  // thing a freeze does is protect THEIR OWN streak — no trade value.
  var FREEZES_KEY = 'bloom_dyn_freezes';
  function getStreakFreezes() {
    try { return Math.max(0, parseInt(localStorage.getItem(FREEZES_KEY) || '0', 10) || 0); } catch (e) { return 0; }
  }
  function setStreakFreezes(n) {
    try { localStorage.setItem(FREEZES_KEY, String(Math.max(0, n | 0))); } catch (e) {}
  }
  function consumeStreakFreeze() {
    var n = getStreakFreezes();
    if (n <= 0) return false;
    setStreakFreezes(n - 1);
    return true;
  }
  window.getStreakFreezes = getStreakFreezes;
  window.setStreakFreezes = setStreakFreezes;

  // Called when player FINISHES a dynamic-board game. Returns a status
  // object: { streakBefore, streakAfter, milestoneHit, reward }. When
  // the admin has disabled the streak feature this becomes a no-op.
  function recordDynamicStreakDay() {
    if (!dynFeatureEnabled('streak')) return { streakBefore: 0, streakAfter: 0, milestoneHit: null, reward: 0, alreadyToday: true, disabled: true };
    var st = getDynamicStreak();
    var today = streakToday();
    var before = st.count | 0;
    var milestoneHit = null;
    if (st.last === today) {
      // Already counted today — no-op, return current state.
      return { streakBefore: before, streakAfter: before, milestoneHit: null, alreadyToday: true };
    }
    var gap = dayDiffDates(st.last, today);
    var freezeUsed = false;
    if (st.last && gap === 1) {
      st.count = (st.count | 0) + 1;
    } else if (st.last && gap === 2 && dynConfigBool('dyn_streak_freeze_enabled', true) && getStreakFreezes() > 0) {
      // 1-day miss + freeze available → consume freeze, treat as continuous.
      consumeStreakFreeze();
      st.count = (st.count | 0) + 1;
      freezeUsed = true;
    } else {
      // First play OR a real gap (≥2 days without freeze, or freeze absent) → reset to 1.
      // Save the lost streak for the comeback mechanic.
      if (before >= dynConfigInt('dyn_comeback_min_streak', 3)) {
        st.lostStreak = before;
        st.lostStreakDate = today;
      }
      st.count = 1;
      // Reset claimed milestones so the player can re-earn them on the next streak.
      st.milestonesClaimed = [];
    }
    st.last = today;
    setDynamicStreak(st);
    var after = st.count;
    // Milestone check — only the first time it's hit per streak.
    if (DYN_STREAK_MILESTONES.indexOf(after) !== -1 && st.milestonesClaimed.indexOf(after) === -1) {
      milestoneHit = after;
      st.milestonesClaimed = (st.milestonesClaimed || []).concat([after]);
      setDynamicStreak(st);
      // Smart push prompt — first 3-day streak is the best moment to
      // ask for notifications. Player is invested + earning rewards.
      if (after === 3 && typeof window.__bloomMaybeAskPush === 'function') {
        setTimeout(function() {
          try { window.__bloomMaybeAskPush('🔥 כל יום שתשחק לוח דינמי, נשמור על הרצף שלך. נשלח לך תזכורת חברית בערב אם שכחת — והרצף ניצל.'); } catch (e) {}
        }, 3500);
      }
    }
    return {
      streakBefore: before,
      streakAfter: after,
      milestoneHit: milestoneHit,
      reward: milestoneHit ? dynStreakReward(milestoneHit) : 0,
      freezeUsed: freezeUsed,
      alreadyToday: false
    };
  }
  // Returns the next milestone target above the current streak — used
  // for the "עוד N לבאדג׳" progress line.
  function nextStreakMilestone(currentCount) {
    for (var i = 0; i < DYN_STREAK_MILESTONES.length; i++) {
      if (DYN_STREAK_MILESTONES[i] > currentCount) return DYN_STREAK_MILESTONES[i];
    }
    return null;
  }
  // True when the player has a streak ≥3 and HASN'T played today (yet).
  // The streak is at risk — drives the loss-aversion FOMO banner.
  function isStreakInDanger() {
    var st = getDynamicStreak();
    if (!st || (st.count | 0) < 3) return false;
    return st.last !== streakToday();
  }
  window.getDynamicStreak       = getDynamicStreak;
  window.recordDynamicStreakDay = recordDynamicStreakDay;
  window.nextStreakMilestone    = nextStreakMilestone;
  window.isStreakInDanger       = isStreakInDanger;
  // Live-read accessor so UI code that reads window.DYN_STREAK_REWARDS[N]
  // gets admin-configured values, not the hardcoded defaults.
  window.DYN_STREAK_REWARDS = new Proxy({}, {
    get: function(_target, key) {
      var n = parseInt(key, 10);
      if (!Number.isFinite(n)) return undefined;
      return dynStreakReward(n);
    }
  });
  window.dynStreakReward = dynStreakReward;

  // ============================================================
  // Achievements — the completionist engine.
  //
  // Two flavors:
  //   - PER-BOARD (one row per board): "played" / "crown" / "100K"
  //   - CROSS-BOARD (single row): "5-board pioneer" / "all themes" /
  //     "all shapes" / "5 crowns"
  //
  // Each achievement can be unlocked ONCE. On unlock: confetti toast
  // + earnCredits reward. Stored together in localStorage so the
  // picker can paint earned badges without a server round-trip.
  // ============================================================
  var DYN_ACH_KEY = 'bloom_dyn_achievements';

  // Per-board achievements — checked against EACH board the player finishes.
  // Each grants its reward exactly once per board id. The `reward` field is
  // a DEFAULT — runtime calls dynAchReward(id) to pick up admin overrides.
  var ACH_PER_BOARD = [
    { id: 'played',  icon: '🌱', label: 'הצטרפת',         reward:  25, check: function(ctx) { return true; } },
    { id: 'crown',   icon: '👑', label: 'הגעת לכתר',      reward: 150, check: function(ctx) { return ctx.tier >= 8; } },
    { id: 'score10', icon: '💎', label: 'שיא: 10K',        reward:  50, check: function(ctx) { return ctx.score >= 10000; } },
    { id: 'score50', icon: '🏆', label: 'שיא: 50K',        reward: 150, check: function(ctx) { return ctx.score >= 50000; } },
    { id: 'score100',icon: '💯', label: 'שיא: 100K',       reward: 300, check: function(ctx) { return ctx.score >= 100000; } }
  ];
  // Cross-board achievements — checked across ALL boards the player has
  // touched. Use the aggregate state (per-board records + earned set).
  var ACH_CROSS = [
    { id: 'pioneer5',   icon: '🗺️', label: 'חלוץ — 5 לוחות שונים', reward: 200,
      check: function(agg) { return agg.playedBoards >= 5; } },
    { id: 'pioneer10',  icon: '🧭', label: 'חוקר — 10 לוחות שונים', reward: 500,
      check: function(agg) { return agg.playedBoards >= 10; } },
    { id: 'crown5',     icon: '👑', label: '5 כתרים בלוחות שונים', reward: 500,
      check: function(agg) { return agg.crownBoards >= 5; } },
    { id: 'all_themes', icon: '🎄', label: 'אספן חגים (4/4)', reward: 800,
      check: function(agg) { return agg.themesPlayed >= 4; } },
    { id: 'all_shapes', icon: '🟦', label: 'אומן צורות (4/4)', reward: 800,
      check: function(agg) { return agg.shapesPlayed >= 4; } },
    { id: 'leaderboard1', icon: '🥇', label: 'מקום #1 באיזשהו לוח', reward: 1000,
      check: function(agg) { return agg.rankOnes >= 1; } }
  ];
  function dynAchReward(id) {
    // Lookup the admin override; fall back to the default in the
    // ACH_PER_BOARD / ACH_CROSS tables above.
    var def = ACH_PER_BOARD.find(function(a) { return a.id === id; }) ||
              ACH_CROSS.find(function(a) { return a.id === id; });
    var fallback = def ? def.reward : 0;
    return dynConfigInt('dyn_ach_reward_' + id, fallback);
  }

  function getAchievementsState() {
    try {
      var raw = localStorage.getItem(DYN_ACH_KEY);
      if (!raw) return { perBoard: {}, cross: {} };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return { perBoard: {}, cross: {} };
      if (!obj.perBoard || typeof obj.perBoard !== 'object') obj.perBoard = {};
      if (!obj.cross || typeof obj.cross !== 'object') obj.cross = {};
      return obj;
    } catch (e) { return { perBoard: {}, cross: {} }; }
  }
  function saveAchievementsState(st) {
    try { localStorage.setItem(DYN_ACH_KEY, JSON.stringify(st)); } catch (e) {}
  }
  // True if the per-board achievement is already earned for this board id.
  function hasPerBoard(state, boardId, achId) {
    return !!(state.perBoard[boardId] && state.perBoard[boardId][achId]);
  }
  function grantPerBoard(state, boardId, achId) {
    if (!state.perBoard[boardId]) state.perBoard[boardId] = {};
    state.perBoard[boardId][achId] = Date.now();
  }
  function hasCross(state, achId) { return !!state.cross[achId]; }
  function grantCross(state, achId) { state.cross[achId] = Date.now(); }

  // Build the cross-board aggregate from the per-board state.
  // Theme/shape membership is read from the boards we have records on
  // (the picker passes the active boards in for theme/shape lookup).
  function aggregateAchievementContext(state, knownBoards) {
    var playedBoards = Object.keys(state.perBoard).length;
    var crownBoards  = 0;
    var rankOnes     = 0;
    var themeSet     = {};
    var shapeSet     = {};
    var byId = {};
    (knownBoards || []).forEach(function(b) { byId[b.id] = b; });
    Object.keys(state.perBoard).forEach(function(bidStr) {
      var bid = parseInt(bidStr, 10);
      var entry = state.perBoard[bid] || {};
      if (entry.crown) crownBoards++;
      if (entry.rank1) rankOnes++;
      var b = byId[bid];
      if (b && b.definition) {
        if (b.definition.theme_id) themeSet[b.definition.theme_id] = 1;
        if (b.definition.shape_id) shapeSet[b.definition.shape_id] = 1;
      }
    });
    return {
      playedBoards: playedBoards,
      crownBoards: crownBoards,
      rankOnes: rankOnes,
      themesPlayed: Object.keys(themeSet).length,
      shapesPlayed: Object.keys(shapeSet).length
    };
  }

  // Called from the dynamic-mode game-over branch. Returns the list of
  // achievement objects unlocked this game (could be both per-board and
  // cross-board). Each carries icon/label/reward — the over screen
  // renders them. Also fires earnCredits for each unlocked achievement.
  // Master toggle: admin can disable the system entirely.
  function checkAndGrantAchievements(ctx) {
    if (!ctx || !ctx.boardId) return [];
    if (!dynFeatureEnabled('achievements')) return [];
    var state = getAchievementsState();
    var unlocked = [];
    // Per-board pass
    for (var i = 0; i < ACH_PER_BOARD.length; i++) {
      var ach = ACH_PER_BOARD[i];
      if (hasPerBoard(state, ctx.boardId, ach.id)) continue;
      if (!ach.check(ctx)) continue;
      grantPerBoard(state, ctx.boardId, ach.id);
      unlocked.push({ scope: 'board', boardId: ctx.boardId, id: ach.id, icon: ach.icon, label: ach.label, reward: dynAchReward(ach.id) });
    }
    // Also flag "crown" / "rank1" markers used by the cross-board aggregate.
    if (ctx.tier >= 8 && state.perBoard[ctx.boardId] && !state.perBoard[ctx.boardId].crown) {
      state.perBoard[ctx.boardId].crown = Date.now();
    }
    if (ctx.rank === 1 && state.perBoard[ctx.boardId] && !state.perBoard[ctx.boardId].rank1) {
      state.perBoard[ctx.boardId].rank1 = Date.now();
    }
    // Cross-board pass (uses the freshly-updated state).
    var agg = aggregateAchievementContext(state, ctx.knownBoards || window._availableBoards || []);
    for (var j = 0; j < ACH_CROSS.length; j++) {
      var cach = ACH_CROSS[j];
      if (hasCross(state, cach.id)) continue;
      if (!cach.check(agg)) continue;
      grantCross(state, cach.id);
      unlocked.push({ scope: 'cross', id: cach.id, icon: cach.icon, label: cach.label, reward: dynAchReward(cach.id) });
    }
    saveAchievementsState(state);
    // Fire credits for each unlock — uses the new dyn_ach action so the
    // server reads the reward from dyn_ach_reward_<id>, bypassing the
    // event_gift clamp.
    if (unlocked.length && typeof earnCredits === 'function') {
      unlocked.forEach(function(u) {
        try {
          earnCredits('dyn_ach', {
            ach_id: u.id,
            scope: u.scope,
            board_id: u.boardId || undefined
          });
        } catch (e) {}
      });
    }
    // Smart push prompt — when a player FIRST unlocks ANY achievement,
    // the dopamine spike is the perfect moment to ask for notifications.
    // The internal cooldown (3 days) prevents over-asking.
    if (unlocked.length && typeof window.__bloomMaybeAskPush === 'function') {
      var totalEarned = Object.keys(state.perBoard || {}).reduce(function(acc, bid) {
        return acc + Object.keys(state.perBoard[bid] || {}).length;
      }, 0) + Object.keys(state.cross || {}).length;
      // First achievement EVER → ask. After that the cooldown handles dedup.
      if (totalEarned <= 2) {
        setTimeout(function() {
          try { window.__bloomMaybeAskPush('🏅 פתחת הישג ראשון! הפעל התראות כדי לדעת מתי הישגים חדשים זמינים — וכשמשהו ממכר קורה.'); } catch (e) {}
        }, 4500);
      }
    }
    return unlocked;
  }
  // Used by the picker to paint earned badge icons next to each board.
  function getEarnedPerBoardIcons(boardId) {
    var state = getAchievementsState();
    var entry = state.perBoard[boardId] || {};
    var icons = [];
    ACH_PER_BOARD.forEach(function(a) { if (entry[a.id]) icons.push(a.icon); });
    return icons;
  }
  // Used by the achievements modal. Rewards are resolved through the
  // admin config so the catalog matches what the player will actually
  // receive.
  function listAllAchievementsForUI(knownBoards) {
    var state = getAchievementsState();
    var agg = aggregateAchievementContext(state, knownBoards || window._availableBoards || []);
    return {
      cross: ACH_CROSS.map(function(a) {
        return Object.assign({}, a, {
          reward: dynAchReward(a.id),
          earned: hasCross(state, a.id),
          progress: aggProgress(a, agg)
        });
      }),
      perBoard: ACH_PER_BOARD.map(function(a) { return Object.assign({}, a, { reward: dynAchReward(a.id) }); }),
      perBoardState: state.perBoard
    };
  }
  function aggProgress(ach, agg) {
    // Returns a small "x / y" string for progressive cross-board achievements.
    if (ach.id === 'pioneer5')   return Math.min(agg.playedBoards, 5)  + ' / 5';
    if (ach.id === 'pioneer10')  return Math.min(agg.playedBoards, 10) + ' / 10';
    if (ach.id === 'crown5')     return Math.min(agg.crownBoards, 5)   + ' / 5';
    if (ach.id === 'all_themes') return Math.min(agg.themesPlayed, 4)  + ' / 4';
    if (ach.id === 'all_shapes') return Math.min(agg.shapesPlayed, 4)  + ' / 4';
    if (ach.id === 'leaderboard1') return agg.rankOnes >= 1 ? '✓' : '0 / 1';
    return null;
  }
  window.checkAndGrantAchievements = checkAndGrantAchievements;
  window.getEarnedPerBoardIcons    = getEarnedPerBoardIcons;
  window.listAllAchievementsForUI  = listAllAchievementsForUI;
  window.DYN_ACH_PER_BOARD         = ACH_PER_BOARD;
  window.DYN_ACH_CROSS             = ACH_CROSS;

  // Late-fire achievement toast for unlocks that happen AFTER the
  // initial game-over render (e.g. the rank-1 leaderboard achievement
  // can only be confirmed once the /leaderboard fetch resolves).
  // Floating top-of-viewport pill, auto-dismisses after 4s.
  function renderAchievementUnlockToast(u) {
    if (!u) return;
    var t = document.createElement('div');
    t.className = 'dyn-ach-toast';
    t.innerHTML =
      '<span class="dyn-ach-toast-icon">' + (u.icon || '🏅') + '</span>' +
      '<span class="dyn-ach-toast-body">' +
        '<strong>הישג חדש!</strong> ' + escapeHtml(u.label || '') +
        '<span class="dyn-ach-toast-reward">+' + (u.reward || 0) + '💎</span>' +
      '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('dyn-ach-toast-out'); setTimeout(function() { t.remove(); }, 320); }, 4000);
  }
  window.renderAchievementUnlockToast = renderAchievementUnlockToast;

  // ============================================================
  // Achievements modal — full catalog. Earned ones glow gold,
  // unearned ones are dimmed with their reward visible (creates
  // explicit "what I can earn" loop).
  // ============================================================
  function closeAchievementsModal() {
    var el = document.getElementById('dyn-ach-modal');
    if (el) el.remove();
  }
  function showAchievementsModal() {
    closeAchievementsModal();
    var data = (typeof listAllAchievementsForUI === 'function')
      ? listAllAchievementsForUI(window._availableBoards || [])
      : { cross: [], perBoard: [], perBoardState: {} };
    // Cross-board rows
    var crossHtml = '';
    (data.cross || []).forEach(function(a) {
      var cls = a.earned ? 'dyn-ach-row earned' : 'dyn-ach-row locked';
      crossHtml +=
        '<div class="' + cls + '">' +
          '<div class="dyn-ach-row-icon">' + a.icon + '</div>' +
          '<div class="dyn-ach-row-body">' +
            '<div class="dyn-ach-row-title">' + escapeHtml(a.label) + '</div>' +
            '<div class="dyn-ach-row-sub">' + (a.earned ? '✓ הושג' : (a.progress || '')) + '</div>' +
          '</div>' +
          '<div class="dyn-ach-row-reward">+' + a.reward + '💎</div>' +
        '</div>';
    });
    // Per-board rows — collapsed by board name. Shows per-board badge
    // grid: each per-board achievement icon either solid (earned) or
    // ghosted (locked).
    var perBoardHtml = '';
    var boards = window._availableBoards || [];
    if (boards.length) {
      boards.forEach(function(b) {
        var entry = (data.perBoardState && data.perBoardState[b.id]) || {};
        var earnedCt = 0;
        var pbBadges = (data.perBoard || []).map(function(a) {
          var earned = !!entry[a.id];
          if (earned) earnedCt++;
          return '<div class="dyn-ach-pb-badge' + (earned ? ' earned' : '') + '" title="' + escapeHtml(a.label) + ' (+' + a.reward + '💎)">' +
                  '<div class="dyn-ach-pb-icon">' + a.icon + '</div>' +
                  '<div class="dyn-ach-pb-label">' + escapeHtml(a.label) + '</div>' +
                  '<div class="dyn-ach-pb-reward">+' + a.reward + '💎</div>' +
                '</div>';
        }).join('');
        perBoardHtml +=
          '<div class="dyn-ach-pb-board">' +
            '<div class="dyn-ach-pb-board-head">' +
              '<span class="dyn-ach-pb-board-name">' + escapeHtml(b.name || 'לוח') + '</span>' +
              '<span class="dyn-ach-pb-board-count">' + earnedCt + ' / ' + (data.perBoard || []).length + '</span>' +
            '</div>' +
            '<div class="dyn-ach-pb-board-badges">' + pbBadges + '</div>' +
          '</div>';
      });
    } else {
      perBoardHtml = '<div class="dyn-ach-empty">אין לוחות זמינים כרגע</div>';
    }
    var overlay = document.createElement('div');
    overlay.id = 'dyn-ach-modal';
    overlay.className = 'dyn-ach-modal-overlay';
    overlay.innerHTML =
      '<div class="dyn-ach-modal-card">' +
        '<div class="dyn-ach-modal-head">' +
          '<button class="dyn-ach-modal-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-ach-modal-title">🏅 הישגים — לוחות דינמיים</div>' +
          '<div class="dyn-ach-modal-sub">השלם הישגים → קבל 💎 + צ׳יפ זהב על כל לוח</div>' +
        '</div>' +
        '<div class="dyn-ach-modal-body">' +
          '<div class="dyn-ach-section-title">🏆 הישגים כלליים</div>' +
          (crossHtml || '<div class="dyn-ach-empty">אין הישגים כלליים</div>') +
          '<div class="dyn-ach-section-title" style="margin-top:18px">🎯 הישגים פר לוח</div>' +
          perBoardHtml +
        '</div>' +
        '<div class="dyn-ach-modal-foot">' +
          '<button class="dyn-ach-modal-back">חזור</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.dyn-ach-modal-close').onclick = closeAchievementsModal;
    overlay.querySelector('.dyn-ach-modal-back').onclick = closeAchievementsModal;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeAchievementsModal();
    });
  }
  window.showAchievementsModal  = showAchievementsModal;
  window.closeAchievementsModal = closeAchievementsModal;

  // ============================================================
  // Daily quests — 3 fresh tasks every Asia/Jerusalem day.
  //
  // The strongest checklist mechanic in F2P games (Fortnite,
  // Clash Royale, Genshin). Layers on top of streaks + achievements
  // by giving the player 3 SPECIFIC tasks per day, each with its
  // own gem reward. Manual claim creates the "I have rewards
  // waiting!" hook even between play sessions.
  //
  // Selection: deterministic per date via mulberry32(hashSeed(date)),
  // so two players opening the app the same day see the same quests
  // (community talking-point), but different days vary the menu.
  // ============================================================
  var DYN_QUEST_KEY_PREFIX = 'bloom_dyn_quests_';
  var DYN_QUEST_POOL = [
    { id: 'play2',     label: 'שחק 2 לוחות דינמיים שונים',  reward:  50, type: 'play_boards', target: 2 },
    { id: 'play3',     label: 'שחק 3 לוחות דינמיים שונים',  reward: 100, type: 'play_boards', target: 3 },
    { id: 'score10k',  label: 'הגע ל-10,000+ נקודות בלוח דינמי', reward:  50, type: 'score_any', target: 10000 },
    { id: 'score30k',  label: 'הגע ל-30,000+ נקודות בלוח דינמי', reward: 100, type: 'score_any', target: 30000 },
    { id: 'score75k',  label: 'הגע ל-75,000+ נקודות בלוח דינמי', reward: 250, type: 'score_any', target: 75000 },
    { id: 'tier7',     label: 'הגע לדרגה 7 (יהלום) בלוח דינמי', reward:  75, type: 'tier_any', target: 7 },
    { id: 'tier8',     label: 'הגע לכתר (דרגה 8) בלוח דינמי',  reward: 200, type: 'tier_any', target: 8 },
    { id: 'theme',     label: 'שחק לוח חג (themed)',            reward:  60, type: 'play_theme' },
    { id: 'shape',     label: 'שחק לוח עם צורה',                reward:  60, type: 'play_shape' },
    { id: 'beatself',  label: 'עבור את השיא האישי שלך באיזשהו לוח', reward: 120, type: 'beat_self' },
    { id: 'beatleader',label: 'עבור את המוביל באיזשהו לוח (#1)',  reward: 300, type: 'beat_leader' }
  ];
  function questDateToday() { return (typeof todayInIsrael === 'function') ? todayInIsrael() : new Date().toISOString().slice(0, 10); }
  function questStorageKey(date) { return DYN_QUEST_KEY_PREFIX + (date || questDateToday()); }
  function dynQuestReward(id) {
    var def = DYN_QUEST_POOL.find(function(q) { return q.id === id; });
    var fallback = def ? def.reward : 0;
    return dynConfigInt('dyn_quest_reward_' + id, fallback);
  }
  function pickDailyQuests(date) {
    var poolWithRewards = DYN_QUEST_POOL.map(function(q) {
      return Object.assign({}, q, { reward: dynQuestReward(q.id) });
    });
    if (typeof mulberry32 !== 'function' || typeof hashSeed !== 'function') {
      // Fallback to first 3 if RNG helpers are missing.
      return poolWithRewards.slice(0, 3).map(function(q) {
        return Object.assign({}, q, { progress: 0, completed: false, claimed: false });
      });
    }
    var rng = mulberry32(hashSeed(date + ':dyn-quests-v1'));
    var pool = poolWithRewards.slice();
    // Fisher–Yates with deterministic RNG.
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, 3).map(function(q) {
      return Object.assign({}, q, { progress: 0, completed: false, claimed: false, _seenBoards: [] });
    });
  }
  function getDailyQuests() {
    // Admin disabled the quests system → return an empty quest list so
    // every check / claim / banner short-circuits cleanly without
    // breaking the UI shape.
    if (!dynFeatureEnabled('quests')) return { date: questDateToday(), quests: [], disabled: true };
    var date = questDateToday();
    var key = questStorageKey(date);
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.quests)) {
          // Live-refresh rewards from admin config — progress + claimed
          // state are preserved. So if admin bumps a reward mid-day,
          // un-claimed completed quests will show the new value.
          parsed.quests.forEach(function(q) {
            q.reward = dynQuestReward(q.id);
          });
          return parsed;
        }
      }
    } catch (e) {}
    var fresh = { date: date, quests: pickDailyQuests(date) };
    try { localStorage.setItem(key, JSON.stringify(fresh)); } catch (e) {}
    // Best-effort cleanup — keep only today's row.
    try {
      for (var k = 0; k < localStorage.length; k++) {
        var name = localStorage.key(k);
        if (name && name.indexOf(DYN_QUEST_KEY_PREFIX) === 0 && name !== key) {
          // Defer removal so we don't mutate while iterating.
          setTimeout((function(n) { return function() { try { localStorage.removeItem(n); } catch (e) {} }; })(name), 0);
        }
      }
    } catch (e) {}
    return fresh;
  }
  function saveDailyQuests(obj) {
    try { localStorage.setItem(questStorageKey(obj.date), JSON.stringify(obj)); } catch (e) {}
  }
  // Called after a dynamic-mode game-over. Updates progress on every
  // active quest, returns the array of quests that JUST completed.
  function applyQuestProgressOnGameOver(ctx) {
    var state = getDailyQuests();
    var justCompleted = [];
    state.quests.forEach(function(q) {
      if (q.completed) return;
      var prevProgress = q.progress | 0;
      if (q.type === 'play_boards') {
        if (q._seenBoards.indexOf(ctx.boardId) === -1) {
          q._seenBoards.push(ctx.boardId);
          q.progress = q._seenBoards.length;
        }
      } else if (q.type === 'score_any') {
        if (ctx.score > q.progress) q.progress = ctx.score;
      } else if (q.type === 'tier_any') {
        if (ctx.tier > q.progress) q.progress = ctx.tier;
      } else if (q.type === 'play_theme') {
        if (ctx.board && ctx.board.definition && ctx.board.definition.theme_id) {
          q.progress = 1;
        }
      } else if (q.type === 'play_shape') {
        if (ctx.board && ctx.board.definition && ctx.board.definition.shape_id) {
          q.progress = 1;
        }
      } else if (q.type === 'beat_self') {
        if (ctx.isBoardBest) q.progress = 1;
      } else if (q.type === 'beat_leader') {
        if (ctx.rank === 1) q.progress = 1;
      }
      var newlyCompleted = q.progress >= (q.target || 1) && !q.completed;
      if (newlyCompleted) {
        q.completed = true;
        if (q.progress < (q.target || 1)) q.progress = (q.target || 1);
        justCompleted.push(Object.assign({}, q));
      }
      // Hint: if the quest changed in any way, still safe to persist.
    });
    saveDailyQuests(state);
    return justCompleted;
  }
  function claimQuestReward(questId) {
    var state = getDailyQuests();
    var q = state.quests.find(function(x) { return x.id === questId; });
    if (!q) return { ok: false, reason: 'not_found' };
    if (!q.completed) return { ok: false, reason: 'not_completed' };
    if (q.claimed) return { ok: false, reason: 'already_claimed' };
    q.claimed = true;
    saveDailyQuests(state);
    if (typeof earnCredits === 'function') {
      // Use the new dyn_quest action — server reads the reward from
      // dyn_quest_reward_<id> config, bypassing the event_gift clamp
      // that capped payouts at event_gift_credits_max (typically 10💎).
      // Pass boardId so the server can apply the Daily Special 2× multiplier
      // when the quest was completed on today's special board.
      var lastBoard = window._activeSpecialBoard || window._activeDynamicBoard || null;
      var bidForQuest = lastBoard && lastBoard.id ? lastBoard.id : 0;
      try { earnCredits('dyn_quest', { quest_id: q.id, boardId: bidForQuest }); } catch (e) {}
    }
    return { ok: true, reward: q.reward };
  }
  function questsSummary() {
    var st = getDailyQuests();
    var done = st.quests.filter(function(q) { return q.completed; }).length;
    var claimable = st.quests.filter(function(q) { return q.completed && !q.claimed; }).length;
    var total = st.quests.length;
    return { done: done, total: total, claimable: claimable, quests: st.quests };
  }
  window.getDailyQuests              = getDailyQuests;
  window.applyQuestProgressOnGameOver = applyQuestProgressOnGameOver;
  window.claimQuestReward            = claimQuestReward;
  window.questsSummary               = questsSummary;
  window.DYN_QUEST_POOL              = DYN_QUEST_POOL;

  // Floating toast for quest completions that fire AFTER the over
  // screen renders (the beat_leader quest needs the leaderboard
  // fetch to resolve before we know rank).
  function renderQuestCompletedToast(q) {
    if (!q) return;
    var t = document.createElement('div');
    t.className = 'dyn-quest-toast';
    t.innerHTML =
      '<span class="dyn-quest-toast-icon">🎯</span>' +
      '<span class="dyn-quest-toast-body">' +
        '<strong>משימה הושלמה!</strong> ' + escapeHtml(q.label || '') +
        '<span class="dyn-quest-toast-reward">+' + (q.reward || 0) + '💎 ממתין במודאל המשימות</span>' +
      '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('dyn-ach-toast-out'); setTimeout(function() { t.remove(); }, 320); }, 4500);
  }
  window.renderQuestCompletedToast = renderQuestCompletedToast;

  // ============================================================
  // Quests modal — 3 rows per day, each with progress bar + claim.
  // The claim button is the dopamine hit (Clash Royale pattern):
  // - locked (not completed): dimmed, shows "X / Y" progress bar
  // - completed but unclaimed: pulsing gold "🎁 קבל +N💎" button
  // - claimed: ✓ silent state, "✓ נאסף"
  // ============================================================
  function closeQuestsModal() {
    var el = document.getElementById('dyn-quests-modal');
    if (el) el.remove();
  }
  function renderQuestRow(q) {
    var target = q.target || 1;
    var progress = Math.min(q.progress || 0, target);
    var pct = Math.round((progress / target) * 100);
    var stateCls = q.claimed ? 'claimed' : (q.completed ? 'completed' : 'locked');
    var ctaHtml = '';
    if (q.claimed) {
      ctaHtml = '<div class="dyn-quest-row-cta dyn-quest-row-cta-claimed">✓ נאסף</div>';
    } else if (q.completed) {
      ctaHtml = '<button class="dyn-quest-row-cta dyn-quest-row-cta-claim" data-claim="' + q.id + '">🎁 קבל +' + q.reward + '💎</button>';
    } else {
      ctaHtml = '<div class="dyn-quest-row-cta dyn-quest-row-cta-locked">+' + q.reward + '💎</div>';
    }
    var progressLabel;
    if (q.type === 'score_any' || q.type === 'tier_any') {
      progressLabel = (progress).toLocaleString() + ' / ' + (target).toLocaleString();
    } else if (q.type === 'play_boards') {
      progressLabel = progress + ' / ' + target;
    } else {
      progressLabel = q.completed ? '✓ הושלמה' : '⏳ לא הושלמה';
    }
    return (
      '<div class="dyn-quest-row dyn-quest-row-' + stateCls + '">' +
        '<div class="dyn-quest-row-head">' +
          '<div class="dyn-quest-row-label">' + escapeHtml(q.label || '') + '</div>' +
          ctaHtml +
        '</div>' +
        '<div class="dyn-quest-row-bar"><div class="dyn-quest-row-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="dyn-quest-row-sub">' + progressLabel + '</div>' +
      '</div>'
    );
  }
  function showQuestsModal() {
    closeQuestsModal();
    var sum = questsSummary();
    var body = sum.quests.map(renderQuestRow).join('');
    var overlay = document.createElement('div');
    overlay.id = 'dyn-quests-modal';
    overlay.className = 'dyn-quests-modal-overlay';
    overlay.innerHTML =
      '<div class="dyn-quests-modal-card">' +
        '<div class="dyn-quests-modal-head">' +
          '<button class="dyn-quests-modal-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-quests-modal-title">🎯 משימות יומיות</div>' +
          '<div class="dyn-quests-modal-sub">3 משימות מתחדשות כל יום בחצות (אסיה/ירושלים)</div>' +
        '</div>' +
        '<div class="dyn-quests-modal-body">' + body + '</div>' +
        '<div class="dyn-quests-modal-foot">' +
          '<button class="dyn-quests-modal-back">חזור</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.dyn-quests-modal-close').onclick = closeQuestsModal;
    overlay.querySelector('.dyn-quests-modal-back').onclick = closeQuestsModal;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeQuestsModal();
    });
    // Wire claim buttons.
    overlay.querySelectorAll('[data-claim]').forEach(function(btn) {
      btn.onclick = function() {
        var qid = btn.getAttribute('data-claim');
        var res = claimQuestReward(qid);
        if (res && res.ok) {
          // Replace just the claim button with the claimed state +
          // play a quick celebration. Avoid full re-render so the
          // user keeps scroll position.
          var row = btn.closest('.dyn-quest-row');
          if (row) {
            row.classList.remove('dyn-quest-row-completed');
            row.classList.add('dyn-quest-row-claimed');
            btn.outerHTML = '<div class="dyn-quest-row-cta dyn-quest-row-cta-claimed">✓ נאסף</div>';
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([30, 30, 60]); } catch (e) {}
          // Update the picker headline button if the picker is still open.
          var hBtn = document.getElementById('dyn-quests-headline');
          if (hBtn && typeof questsSummary === 'function') {
            var ns = questsSummary();
            var textEl = hBtn.querySelector('.dyn-quests-headline-text');
            if (textEl) {
              var cp = ns.claimable > 0
                ? ' <span class="dyn-quests-headline-claim">' + ns.claimable + ' 🎁 לקבל</span>'
                : '';
              textEl.innerHTML = 'משימות יומיות: ' + ns.done + ' / ' + ns.total + cp;
            }
            if (ns.claimable > 0) hBtn.setAttribute('data-claimable', '1');
            else hBtn.removeAttribute('data-claimable');
          }
        }
      };
    });
  }
  window.showQuestsModal  = showQuestsModal;
  window.closeQuestsModal = closeQuestsModal;

  // ============================================================
  // Mystery Chest — variable-rarity reward after every dynamic
  // game. The Skinner-box mechanic that makes slot machines
  // addictive: anticipation + dramatic reveal + variable payout.
  //
  // Server rolls the dice (anti-cheat). Client only animates.
  // Five tiers: common (white) / uncommon (green) / rare (blue) /
  // legendary (gold) / mythic (rainbow). First N chests of day
  // are "boosted" — guaranteed uncommon+ to avoid bad-first-3
  // frustration.
  // ============================================================
  var CHEST_TIER_STYLE = {
    common:    { label: 'רגיל',       color: '#B5B3AC', glow: 'rgba(181,179,172,0.4)', emoji: '📦' },
    uncommon:  { label: 'נדיר',       color: '#4FBD8B', glow: 'rgba(79,189,139,0.5)',  emoji: '🎁' },
    rare:      { label: 'נדיר מאוד',  color: '#3D8BFA', glow: 'rgba(61,139,250,0.55)', emoji: '💠' },
    legendary: { label: 'אגדי',       color: '#FAC775', glow: 'rgba(255,180,0,0.65)',  emoji: '🌟' },
    mythic:    { label: 'מיתי',       color: '#FF6B9D', glow: 'rgba(255,107,157,0.75)', emoji: '🔮' }
  };
  function chestEnabled() { return dynFeatureEnabled('chest') && dynConfigBool('dyn_chest_enabled', true); }
  // Master toggle compatible with dynFeatureEnabled('chest') — readers
  // can ask either via the dyn_chest_enabled key directly or via this
  // helper which also respects an upstream "chest" feature flag.
  function dynChestFeatureEnabled() {
    return dynConfigBool('dyn_chest_enabled', true);
  }
  // Opens a chest by calling the server, then animates the reveal in
  // a slot-machine overlay. Auto-dismisses 3.5s after the reveal
  // (player can tap to dismiss earlier).
  function openMysteryChest() {
    if (!dynChestFeatureEnabled()) return Promise.resolve(null);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    return fetch('/api/boards/chest/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (!d || !d.ok) return d;
        showChestRevealAnimation(d);
        // Reflect the new balance on the UI. The server already credited
        // it atomically — we just need to repaint the home pill so the
        // player sees the increase without a page refresh.
        if (typeof d.newBalance === 'number') {
          try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        }
        return d;
      });
  }
  // The reveal overlay — 5-stage choreography:
  //   1) Chest icon appears, shakes (1s)
  //   2) Lid pops open, light bursts (0.5s)
  //   3) Slot-machine reel spins through tiers, decelerating (1.5s)
  //   4) Lands on chosen tier with bounce + sound + confetti (0.3s)
  //   5) Number counts up from 0 to amount (0.6s)
  function showChestRevealAnimation(data) {
    if (!data || !data.tier) return;
    var tierStyle = CHEST_TIER_STYLE[data.tier] || CHEST_TIER_STYLE.common;
    // Tear down any existing chest overlay (race-safety).
    document.querySelectorAll('.dyn-chest-overlay').forEach(function(el) { el.remove(); });
    var overlay = document.createElement('div');
    overlay.className = 'dyn-chest-overlay';
    overlay.innerHTML =
      '<div class="dyn-chest-card" data-tier="' + data.tier + '" style="--tier-color:' + tierStyle.color + '; --tier-glow:' + tierStyle.glow + '">' +
        '<div class="dyn-chest-stage dyn-chest-stage-shake">' +
          '<div class="dyn-chest-icon">📦</div>' +
        '</div>' +
        '<div class="dyn-chest-stage dyn-chest-stage-reveal" style="display:none">' +
          '<div class="dyn-chest-burst"></div>' +
          '<div class="dyn-chest-emoji">' + tierStyle.emoji + '</div>' +
          '<div class="dyn-chest-tier-label">' + tierStyle.label + '</div>' +
          '<div class="dyn-chest-amount" id="dyn-chest-amount">0💎</div>' +
        '</div>' +
        '<div class="dyn-chest-meta" id="dyn-chest-meta">' +
          (data.boosted ? '⭐ אריזה משופרת!' : '') +
        '</div>' +
        '<div class="dyn-chest-tap-dismiss">לחץ להמשך</div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Stage 1 → 2 → 3 → 4 → 5 timing.
    var shakeMs  = 900;
    var reelMs   = 1500;
    var countMs  = 700;
    // Play chest-shake sound up front (single short knock).
    try { if (typeof playTone === 'function') playTone(140, 0.10, 0.04); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([30]); } catch (e) {}
    setTimeout(function() {
      var stage1 = overlay.querySelector('.dyn-chest-stage-shake');
      var stage2 = overlay.querySelector('.dyn-chest-stage-reveal');
      if (stage1) stage1.style.display = 'none';
      if (stage2) stage2.style.display = '';
      // Stage 3: reel spin through the tiers' colors before landing.
      // We re-use the dyn-chest-emoji + tier-label as the reel face.
      var emojiEl = overlay.querySelector('.dyn-chest-emoji');
      var labelEl = overlay.querySelector('.dyn-chest-tier-label');
      var tierOrder = CHEST_TIERS_ORDER.slice();
      var ticks = 14;
      var i = 0;
      var t0 = performance.now();
      // Pop sound at lid-open.
      try { if (typeof playTone === 'function') playTone(420, 0.10, 0.05); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([40, 30, 40]); } catch (e) {}
      function tick() {
        var elapsed = performance.now() - t0;
        var p = Math.min(1, elapsed / reelMs);
        // Ease-out: ticks come faster early, slower near the end.
        var eased = 1 - Math.pow(1 - p, 3);
        var targetIdx = Math.floor(eased * ticks);
        while (i < targetIdx) {
          var idx = i % tierOrder.length;
          var ts = CHEST_TIER_STYLE[tierOrder[idx]];
          if (emojiEl) emojiEl.textContent = ts.emoji;
          if (labelEl) labelEl.textContent = ts.label;
          try { if (typeof playTone === 'function') playTone(280 + (i * 30) % 200, 0.025, 0.02); } catch (e) {}
          i++;
        }
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          // Landing — paint the real tier + the gem amount counts up.
          if (emojiEl) emojiEl.textContent = tierStyle.emoji;
          if (labelEl) labelEl.textContent = tierStyle.label;
          // Card upgrades its tier class so the glow ramps up.
          var card = overlay.querySelector('.dyn-chest-card');
          if (card) card.classList.add('dyn-chest-card-landed');
          // Big landing sound — higher pitch for higher tier.
          var landFreq = data.tier === 'mythic' ? 880 : data.tier === 'legendary' ? 700 : data.tier === 'rare' ? 560 : data.tier === 'uncommon' ? 440 : 320;
          try { if (typeof playTone === 'function') { playTone(landFreq, 0.45, 0.15); setTimeout(function() { playTone(landFreq * 1.5, 0.35, 0.1); }, 80); } } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 40, 80]); } catch (e) {}
          // Confetti for rare+ tiers — handled by CSS particle layer.
          if (data.tier === 'rare' || data.tier === 'legendary' || data.tier === 'mythic') {
            spawnChestConfetti(overlay, data.tier);
          }
          // Count-up amount.
          var amtEl = overlay.querySelector('#dyn-chest-amount');
          var t1 = performance.now();
          (function countUp() {
            var e2 = performance.now() - t1;
            var q = Math.min(1, e2 / countMs);
            var n = Math.round(q * data.amount);
            if (amtEl) amtEl.textContent = '+' + n.toLocaleString() + '💎';
            if (q < 1) requestAnimationFrame(countUp);
          })();
          // Auto-dismiss after a moment.
          setTimeout(function() {
            overlay.classList.add('dyn-chest-out');
            setTimeout(function() { overlay.remove(); }, 350);
          }, 3500);
        }
      }
      requestAnimationFrame(tick);
    }, shakeMs);
    // Tap-anywhere to dismiss after the reveal stage.
    overlay.addEventListener('click', function() {
      overlay.classList.add('dyn-chest-out');
      setTimeout(function() { overlay.remove(); }, 350);
    });
  }
  var CHEST_TIERS_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
  // Confetti — 18 particles spawned with random keyframes.
  function spawnChestConfetti(host, tier) {
    var colors = tier === 'mythic'
      ? ['#FF6B9D', '#FFD86B', '#3D8BFA', '#4FBD8B', '#FFFFFF']
      : tier === 'legendary'
        ? ['#FFD86B', '#FAC775', '#FFFFFF']
        : ['#3D8BFA', '#9FE1CB'];
    for (var i = 0; i < 22; i++) {
      var c = document.createElement('div');
      c.className = 'dyn-chest-particle';
      var angle = (Math.PI * 2 * i) / 22;
      var dist = 80 + Math.random() * 60;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - 20;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', dx + 'px');
      c.style.setProperty('--dy', dy + 'px');
      c.style.animationDelay = (i * 12) + 'ms';
      host.appendChild(c);
    }
  }
  window.openMysteryChest          = openMysteryChest;
  window.dynChestFeatureEnabled    = dynChestFeatureEnabled;

  // ============================================================
  // Streak Freeze purchase + Comeback bonus (May 2026)
  // ============================================================
  function buyStreakFreeze() {
    if (!dynConfigBool('dyn_streak_freeze_enabled', true)) return Promise.resolve({ ok: false, reason: 'disabled' });
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    return fetch('/api/player/streak-freeze/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false, reason: 'network' }; })
      .then(function(d) {
        if (d && d.ok) {
          // Increment local freeze count + refresh balance UI.
          setStreakFreezes(getStreakFreezes() + 1);
          try { if (typeof playerBalance !== 'undefined' && typeof d.newBalance === 'number') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 40]); } catch (e) {}
        }
        return d;
      });
  }
  window.buyStreakFreeze = buyStreakFreeze;

  // Returns the comeback context if eligible, else null. Reads
  // ONLY localStorage — server-side dedup happens in the claim call.
  function getComebackContext() {
    if (!dynConfigBool('dyn_comeback_enabled', true)) return null;
    var st = getDynamicStreak();
    var minDays = dynConfigInt('dyn_comeback_min_days', 3);
    var minStreak = dynConfigInt('dyn_comeback_min_streak', 3);
    var lostStreak = st.lostStreak | 0;
    if (lostStreak < minStreak) return null;
    var lostDate = st.lostStreakDate || st.last;
    if (!lostDate) return null;
    var today = streakToday();
    var diff = dayDiffDates(lostDate, today);
    if (diff < minDays) return null;
    // Already claimed this comeback (cleared after claim).
    if (st.comebackClaimedFor === lostDate) return null;
    return {
      daysAway: diff,
      lostStreak: lostStreak,
      lostStreakDate: lostDate,
      reward: dynConfigInt('dyn_comeback_reward', 150)
    };
  }
  function claimComebackBonus() {
    var ctx = getComebackContext();
    if (!ctx) return Promise.resolve({ ok: false, reason: 'not_eligible' });
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    return fetch('/api/player/comeback-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        token: token,
        daysAway: ctx.daysAway,
        lostStreak: ctx.lostStreak
      })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false, reason: 'network' }; })
      .then(function(d) {
        if (d && d.ok) {
          // Mark this comeback as claimed so we don't show it again.
          var st = getDynamicStreak();
          st.comebackClaimedFor = ctx.lostStreakDate;
          setDynamicStreak(st);
          // Grant the freeze gift if configured.
          if (d.freezeGift) {
            setStreakFreezes(getStreakFreezes() + (d.freezeGift | 0));
          }
          // Refresh balance UI.
          try { if (typeof playerBalance !== 'undefined' && typeof d.newBalance === 'number') playerBalance = d.newBalance; } catch (e) {}
          try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          // Smart push prompt — comeback claimer is a high-intent player
          // returning after absence. Ask now so they don't lapse again.
          if (typeof window.__bloomMaybeAskPush === 'function') {
            setTimeout(function() {
              try { window.__bloomMaybeAskPush('👋 ברוך שובך! הפעל התראות כדי שלא תפספס שוב — נזכיר לך בערב אם הרצף בסכנה.'); } catch (e) {}
            }, 2500);
          }
        }
        return d;
      });
  }
  window.getComebackContext = getComebackContext;
  window.claimComebackBonus = claimComebackBonus;

  // The comeback overlay — big celebration when a lapsed player
  // returns. Fires from the picker open / home open if eligible.
  function showComebackOverlay() {
    var ctx = getComebackContext();
    if (!ctx) return;
    // Tear down any existing overlay first.
    document.querySelectorAll('.dyn-comeback-overlay').forEach(function(el) { el.remove(); });
    var overlay = document.createElement('div');
    overlay.className = 'dyn-comeback-overlay';
    overlay.innerHTML =
      '<div class="dyn-comeback-card">' +
        '<div class="dyn-comeback-confetti"></div>' +
        '<div class="dyn-comeback-icon">👋</div>' +
        '<div class="dyn-comeback-title">ברוך שובך!</div>' +
        '<div class="dyn-comeback-sub">היה לך רצף <strong>' + ctx.lostStreak + ' ימים</strong>. נתחיל מחדש?</div>' +
        '<div class="dyn-comeback-reward">+<span id="dyn-comeback-amount">' + ctx.reward + '</span>💎</div>' +
        '<div class="dyn-comeback-gift">+ הקפאת רצף 🛡 (חינם!)</div>' +
        '<button class="dyn-comeback-claim">🎁 קבל את הבונוס</button>' +
        '<button class="dyn-comeback-skip">לא תודה</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.dyn-comeback-claim').onclick = function() {
      claimComebackBonus().then(function(d) {
        if (d && d.ok) {
          var amountEl = overlay.querySelector('#dyn-comeback-amount');
          if (amountEl) amountEl.textContent = d.reward;
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 40, 80]); } catch (e) {}
          overlay.classList.add('dyn-comeback-celebrating');
          setTimeout(function() {
            overlay.classList.add('dyn-comeback-out');
            setTimeout(function() { overlay.remove(); }, 320);
          }, 1800);
        } else {
          // Soft-fail — close overlay either way.
          overlay.classList.add('dyn-comeback-out');
          setTimeout(function() { overlay.remove(); }, 320);
        }
      });
    };
    overlay.querySelector('.dyn-comeback-skip').onclick = function() {
      // Mark claimed so we don't re-prompt (player explicitly declined).
      var st = getDynamicStreak();
      st.comebackClaimedFor = ctx.lostStreakDate;
      setDynamicStreak(st);
      overlay.classList.add('dyn-comeback-out');
      setTimeout(function() { overlay.remove(); }, 320);
    };
  }
  window.showComebackOverlay = showComebackOverlay;

  // ============================================================
  // Season Pass (May 2026) — the #1 retention engine in F2P games.
  //
  // Every dynamic-board game / quest / achievement grants Season XP.
  // 20 reward tiers; each unlocked tier needs to be MANUALLY claimed
  // (Clash Royale pattern). "🎁 N לקבל" badge keeps players coming
  // back even on days they don't want to play — just to claim.
  //
  // Cache the latest status response so multiple UI surfaces (picker
  // header, modal, home button) can read without re-fetching.
  // ============================================================
  var _seasonCache = { data: null, fetchedAt: 0 };
  var SEASON_CACHE_MS = 60 * 1000;
  function getCachedSeasonStatus() { return _seasonCache.data; }
  function fetchSeasonStatus(force) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    if (!force && _seasonCache.data && (Date.now() - _seasonCache.fetchedAt) < SEASON_CACHE_MS) {
      return Promise.resolve(_seasonCache.data);
    }
    return fetch('/api/player/season/status?deviceId=' + encodeURIComponent(deviceId), { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok && d.enabled !== false) {
          _seasonCache.data = d;
          _seasonCache.fetchedAt = Date.now();
        }
        return d;
      });
  }
  window.fetchSeasonStatus = fetchSeasonStatus;
  window.getCachedSeasonStatus = getCachedSeasonStatus;

  // Grant XP from a dynamic-board game finish. Called from 11-game.js
  // after the chest reveal. Idempotent via gameId. Refreshes the
  // status cache so the picker shows the new XP/tier immediately.
  function grantSeasonXpForGame(gameId, score, tier, boardId) {
    if (!dynConfigBool('season_pass_enabled', true)) return Promise.resolve(null);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId || !gameId) return Promise.resolve(null);
    return fetch('/api/player/season/grant-xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        token: token,
        gameId: gameId,
        source: 'dyn_game_finish',
        meta: { score: score, tier: tier, boardId: boardId || 0 }
      })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          // Update the cache directly so the picker (when next opened)
          // shows the new XP without waiting for the next 60s refresh.
          if (_seasonCache.data) {
            _seasonCache.data.xp = d.newXp;
            _seasonCache.data.currentTier = d.currentTier;
            // Recompute unclaimed count.
            var tiers = _seasonCache.data.tiers || [];
            var claimed = _seasonCache.data.claimedTiers || [];
            _seasonCache.data.unclaimedCount = tiers
              .filter(function(t) { return t.tier <= d.currentTier && claimed.indexOf(t.tier) === -1; })
              .length;
          }
          // Big "leveled up!" celebration when the player crosses a tier.
          if (d.leveledUp) {
            setTimeout(function() { showSeasonLevelUpToast(d.currentTier); }, 4500);
          }
        }
        return d;
      });
  }
  window.grantSeasonXpForGame = grantSeasonXpForGame;

  function showSeasonLevelUpToast(tier) {
    var t = document.createElement('div');
    t.className = 'dyn-season-levelup-toast';
    t.innerHTML =
      '<span class="dyn-season-levelup-icon">🎖</span>' +
      '<span class="dyn-season-levelup-body">' +
        '<strong>עלית רמה בעונה! דרגה ' + tier + '</strong>' +
        '<span class="dyn-season-levelup-sub">🎁 פרס ממתין במסלול העונה</span>' +
      '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('dyn-season-levelup-out'); setTimeout(function() { t.remove(); }, 320); }, 4200);
    try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([60, 50, 90]); } catch (e) {}
  }
  window.showSeasonLevelUpToast = showSeasonLevelUpToast;

  // The Season Pass modal — 20-tier roadmap.
  function closeSeasonPassModal() {
    var el = document.getElementById('dyn-season-modal');
    if (el) el.remove();
  }
  function showSeasonPassModal() {
    closeSeasonPassModal();
    // Render shell first with loading state, then patch in the data.
    var overlay = document.createElement('div');
    overlay.id = 'dyn-season-modal';
    overlay.className = 'dyn-season-modal-overlay';
    overlay.innerHTML =
      '<div class="dyn-season-modal-card">' +
        '<div class="dyn-season-modal-head">' +
          '<button class="dyn-season-modal-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-season-modal-title">🎖 מסלול העונה</div>' +
          '<div class="dyn-season-modal-sub" id="dyn-season-modal-sub">⏳ טוען...</div>' +
        '</div>' +
        '<div class="dyn-season-modal-progress-row">' +
          '<div class="dyn-season-bar-wrap">' +
            '<div class="dyn-season-bar-fill" id="dyn-season-bar-fill" style="width:0%"></div>' +
          '</div>' +
          '<div class="dyn-season-bar-label" id="dyn-season-bar-label">0 / 0 XP</div>' +
        '</div>' +
        '<div class="dyn-season-modal-body" id="dyn-season-modal-body">' +
          '<div class="board-lb-loading">⏳ טוען...</div>' +
        '</div>' +
        '<div class="dyn-season-modal-foot">' +
          '<button class="dyn-season-modal-back">חזור</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.dyn-season-modal-close').onclick = closeSeasonPassModal;
    overlay.querySelector('.dyn-season-modal-back').onclick = closeSeasonPassModal;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeSeasonPassModal(); });
    fetchSeasonStatus(true).then(function(d) {
      renderSeasonModalBody(d);
    });
  }
  function renderSeasonModalBody(d) {
    var body = document.getElementById('dyn-season-modal-body');
    var sub  = document.getElementById('dyn-season-modal-sub');
    var barFill = document.getElementById('dyn-season-bar-fill');
    var barLabel = document.getElementById('dyn-season-bar-label');
    if (!body) return;
    if (!d || !d.ok) {
      body.innerHTML = '<div class="board-lb-empty">שגיאה בטעינת מסלול העונה</div>';
      return;
    }
    if (d.enabled === false) {
      body.innerHTML = '<div class="board-lb-empty">מסלול העונה כבוי כרגע</div>';
      return;
    }
    var xp = d.xp | 0;
    var currentTier = d.currentTier | 0;
    var claimed = d.claimedTiers || [];
    var tiers = d.tiers || [];
    if (sub) {
      var unclaimed = d.unclaimedCount | 0;
      sub.innerHTML = escapeHtml(d.seasonName || '') +
        (unclaimed > 0 ? ' · <span class="dyn-season-unclaimed-pill">' + unclaimed + ' 🎁 לקבל</span>' : '');
    }
    // Progress bar to the next unlocked tier (or to tier 20 if maxed).
    var nextTier = tiers.find(function(t) { return t.tier > currentTier; });
    var prevTierXp = currentTier > 0 ? (tiers.find(function(t) { return t.tier === currentTier; }) || {}).xpRequired || 0 : 0;
    var nextXp = nextTier ? nextTier.xpRequired : (tiers[tiers.length - 1] || {}).xpRequired || 1;
    var pct = nextTier
      ? Math.max(0, Math.min(100, Math.round(((xp - prevTierXp) / (nextXp - prevTierXp)) * 100)))
      : 100;
    if (barFill) barFill.style.width = pct + '%';
    if (barLabel) {
      barLabel.textContent = nextTier
        ? (xp - prevTierXp).toLocaleString() + ' / ' + (nextXp - prevTierXp).toLocaleString() + ' XP'
        : (xp.toLocaleString() + ' XP · עוונה הושלמה');
    }
    // Tier cards
    var html = '';
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var isUnlocked = currentTier >= t.tier;
      var isClaimed = claimed.indexOf(t.tier) !== -1;
      var stateCls = isClaimed ? 'claimed' : (isUnlocked ? 'unclocked' : 'locked');
      var stateLabel = isClaimed ? '✓ נאסף' : (isUnlocked ? '🎁 קבל' : '🔒');
      var ctaHtml = '';
      if (isClaimed) {
        ctaHtml = '<div class="dyn-season-tier-cta dyn-season-tier-cta-claimed">' + stateLabel + '</div>';
      } else if (isUnlocked) {
        ctaHtml = '<button class="dyn-season-tier-cta dyn-season-tier-cta-claim" data-claim-tier="' + t.tier + '">' + stateLabel + ' +' + t.reward + '💎</button>';
      } else {
        ctaHtml = '<div class="dyn-season-tier-cta dyn-season-tier-cta-locked">+' + t.reward + '💎</div>';
      }
      html +=
        '<div class="dyn-season-tier-card dyn-season-tier-' + stateCls + '">' +
          '<div class="dyn-season-tier-num">' + t.tier + '</div>' +
          '<div class="dyn-season-tier-body">' +
            '<div class="dyn-season-tier-xp">' + t.xpRequired.toLocaleString() + ' XP</div>' +
            '<div class="dyn-season-tier-reward">+' + t.reward + '💎</div>' +
          '</div>' +
          ctaHtml +
        '</div>';
    }
    body.innerHTML = html;
    body.querySelectorAll('[data-claim-tier]').forEach(function(btn) {
      btn.onclick = function() {
        var tn = parseInt(btn.getAttribute('data-claim-tier'), 10);
        claimSeasonTier(tn, btn);
      };
    });
  }
  function claimSeasonTier(tierN, btnEl) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return;
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳'; }
    fetch('/api/player/season/claim-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, tier: tierN })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          // Update local cache + balance UI.
          if (_seasonCache.data) {
            _seasonCache.data.claimedTiers = d.claimedTiers || [];
            var tiers = _seasonCache.data.tiers || [];
            var currentTier = _seasonCache.data.currentTier | 0;
            _seasonCache.data.unclaimedCount = tiers
              .filter(function(t) { return t.tier <= currentTier && (d.claimedTiers || []).indexOf(t.tier) === -1; })
              .length;
          }
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 40, 60]); } catch (e) {}
          // Re-render the modal body so the just-claimed tier flips to ✓ נאסף.
          renderSeasonModalBody(_seasonCache.data);
        } else {
          if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = (d && d.reason) || 'שגיאה'; }
        }
      });
  }
  window.showSeasonPassModal = showSeasonPassModal;
  window.closeSeasonPassModal = closeSeasonPassModal;

  // ============================================================
  // Live Tournaments — stage 12 (May 2026)
  //
  // Scheduled prime-time events. Player sees a live banner in the
  // picker header during the window. Every dynamic-board game-over
  // auto-submits to the tournament (best-score-wins). Top-N winners
  // are auto-credited when the window ends.
  // ============================================================
  var _tournamentsCache = { data: null, fetchedAt: 0 };
  var TOURNAMENT_CACHE_MS = 60 * 1000;
  function fetchTournaments(force) {
    if (!force && _tournamentsCache.data && (Date.now() - _tournamentsCache.fetchedAt) < TOURNAMENT_CACHE_MS) {
      return Promise.resolve(_tournamentsCache.data);
    }
    return fetch('/api/tournaments', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok && d.enabled !== false) {
          _tournamentsCache.data = d;
          _tournamentsCache.fetchedAt = Date.now();
        }
        return d;
      });
  }
  function getLiveTournament() {
    var d = _tournamentsCache.data;
    if (!d || !Array.isArray(d.tournaments)) return null;
    return d.tournaments.find(function(t) { return t.isLive; }) || null;
  }
  function getUpcomingTournament() {
    var d = _tournamentsCache.data;
    if (!d || !Array.isArray(d.tournaments)) return null;
    var now = Date.now();
    return d.tournaments.find(function(t) {
      return t.isUpcoming && (new Date(t.starts_at).getTime() - now) < 24 * 60 * 60 * 1000;
    }) || null;
  }
  window.fetchTournaments = fetchTournaments;
  window.getLiveTournament = getLiveTournament;
  window.getUpcomingTournament = getUpcomingTournament;

  // Auto-submit a dynamic-board game-over score to the live tournament.
  // Idempotent server-side via best-score-wins upsert.
  function submitTournamentScoreFromGame(score, tier, drops) {
    var live = getLiveTournament();
    if (!live) return Promise.resolve(null);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    var name     = (typeof getPlayerName === 'function') ? getPlayerName() : 'אנונימי';
    var country  = (typeof getCountry === 'function') ? getCountry() : null;
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/tournaments/' + live.id + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        token: token,
        name: name,
        score: score | 0,
        tier: tier | 0,
        drops: drops | 0,
        country: country
      })
    }).then(function(r) { return r.json(); }).catch(function() { return null; });
  }
  window.submitTournamentScoreFromGame = submitTournamentScoreFromGame;

  // Format a countdown like "4ש 12ד" or "23ד".
  function fmtTournamentCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    var total = Math.floor(ms / 1000);
    var d = Math.floor(total / (24 * 3600));
    var h = Math.floor((total % (24 * 3600)) / 3600);
    var m = Math.floor((total % 3600) / 60);
    if (d > 0) return d + 'י ' + h + 'ש';
    if (h > 0) return h + 'ש ' + m + 'ד';
    return m + ' דקות';
  }

  function renderTournamentBannerHtml() {
    var live = getLiveTournament();
    if (live) {
      var endsIn = new Date(live.ends_at).getTime() - Date.now();
      var topPrize = Array.isArray(live.prize_pool) && live.prize_pool.length ? live.prize_pool[0].reward : 0;
      return '<button class="dyn-tournament-banner dyn-tournament-banner-live" id="dyn-tournament-banner" data-tournament-id="' + live.id + '">' +
        '<div class="dyn-tournament-banner-pulse">🔴 LIVE</div>' +
        '<div class="dyn-tournament-banner-body">' +
          '<div class="dyn-tournament-banner-title">🏆 ' + escapeHtml(live.name) + '</div>' +
          '<div class="dyn-tournament-banner-sub">מסתיים בעוד <strong>' + fmtTournamentCountdown(endsIn) + '</strong> · פרס ראשון: ' + topPrize.toLocaleString() + '💎</div>' +
        '</div>' +
        '<div class="dyn-tournament-banner-cta">שחק וצבור!</div>' +
      '</button>';
    }
    var upcoming = getUpcomingTournament();
    if (upcoming) {
      var startsIn = new Date(upcoming.starts_at).getTime() - Date.now();
      var topPrize2 = Array.isArray(upcoming.prize_pool) && upcoming.prize_pool.length ? upcoming.prize_pool[0].reward : 0;
      return '<button class="dyn-tournament-banner dyn-tournament-banner-upcoming" id="dyn-tournament-banner" data-tournament-id="' + upcoming.id + '">' +
        '<div class="dyn-tournament-banner-pulse">⏰ בקרוב</div>' +
        '<div class="dyn-tournament-banner-body">' +
          '<div class="dyn-tournament-banner-title">' + escapeHtml(upcoming.name) + '</div>' +
          '<div class="dyn-tournament-banner-sub">מתחיל בעוד <strong>' + fmtTournamentCountdown(startsIn) + '</strong> · פרס ראשון: ' + topPrize2.toLocaleString() + '💎</div>' +
        '</div>' +
        '<div class="dyn-tournament-banner-cta">פרטים</div>' +
      '</button>';
    }
    return '';
  }

  // Tournament leaderboard modal — top 50 + my rank + prize pool display.
  function closeTournamentModal() {
    var el = document.getElementById('dyn-tournament-modal');
    if (el) el.remove();
  }
  function showTournamentModal(tournamentId) {
    closeTournamentModal();
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var overlay = document.createElement('div');
    overlay.id = 'dyn-tournament-modal';
    overlay.className = 'dyn-tournament-modal-overlay';
    overlay.innerHTML =
      '<div class="dyn-tournament-modal-card">' +
        '<div class="dyn-tournament-modal-head">' +
          '<button class="dyn-tournament-modal-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-tournament-modal-title">🏆 טורניר</div>' +
          '<div class="dyn-tournament-modal-sub" id="dyn-tournament-modal-sub">⏳ טוען...</div>' +
        '</div>' +
        '<div class="dyn-tournament-modal-body" id="dyn-tournament-modal-body">' +
          '<div class="board-lb-loading">⏳ טוען מובילי טורניר...</div>' +
        '</div>' +
        '<div class="dyn-tournament-modal-foot">' +
          '<button class="dyn-tournament-modal-back">חזור</button>' +
          '<button class="dyn-tournament-modal-play">🏆 שחק בטורניר</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.dyn-tournament-modal-close').onclick = closeTournamentModal;
    overlay.querySelector('.dyn-tournament-modal-back').onclick = closeTournamentModal;
    overlay.querySelector('.dyn-tournament-modal-play').onclick = function() {
      closeTournamentModal();
      // Open the picker so the player can pick a board and start playing.
      // The submit-on-game-over flow will auto-submit to the live tournament.
      if (typeof showDynamicBoardsPicker === 'function') showDynamicBoardsPicker();
    };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeTournamentModal(); });
    var url = '/api/tournaments/' + tournamentId + '/leaderboard' + (deviceId ? '?deviceId=' + encodeURIComponent(deviceId) : '');
    fetch(url, { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        var body = document.getElementById('dyn-tournament-modal-body');
        var sub  = document.getElementById('dyn-tournament-modal-sub');
        if (!body) return;
        if (!d || !d.ok) {
          body.innerHTML = '<div class="board-lb-empty">שגיאה בטעינה</div>';
          return;
        }
        var t = d.tournament || {};
        var endsIn = new Date(t.ends_at).getTime() - Date.now();
        if (sub) sub.innerHTML = escapeHtml(t.name || '') + (endsIn > 0 ? ' · נשאר ' + fmtTournamentCountdown(endsIn) : ' · הסתיים');
        var list = d.list || [];
        if (!list.length) {
          body.innerHTML = '<div class="board-lb-empty">🌱 עדיין אין מתחרים<br><span class="board-lb-empty-sub">היה הראשון להציב ניקוד!</span></div>';
          return;
        }
        // Find the cached tournament for prize_pool.
        var cached = _tournamentsCache.data;
        var fullTour = cached && cached.tournaments && cached.tournaments.find(function(x) { return x.id === tournamentId; });
        var prizePool = (fullTour && Array.isArray(fullTour.prize_pool)) ? fullTour.prize_pool : [];
        var rows = '';
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          var rank = i + 1;
          var rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
          var prize = prizePool.find(function(x) { return x.rank === rank; });
          var prizeHtml = prize ? '<span class="dyn-tournament-row-prize">+' + prize.reward.toLocaleString() + '💎</span>' : '';
          var youCls = p.you ? ' dyn-tournament-row-you' : '';
          var flagHtml = '';
          if (p.country) {
            try {
              var cc = String(p.country).toUpperCase();
              if (cc.length === 2) {
                flagHtml = '<span class="dyn-tournament-row-flag">' +
                  String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65) +
                  String.fromCodePoint(0x1F1E6 + cc.charCodeAt(1) - 65) +
                  '</span>';
              }
            } catch (e) {}
          }
          rows +=
            '<div class="dyn-tournament-row' + youCls + '">' +
              '<span class="dyn-tournament-row-rank">' + rankBadge + '</span>' +
              flagHtml +
              '<span class="dyn-tournament-row-name">' + escapeHtml(p.name || 'אנונימי') + (p.you ? ' (אתה)' : '') + '</span>' +
              '<span class="dyn-tournament-row-score">' + (p.score || 0).toLocaleString() + '</span>' +
              prizeHtml +
            '</div>';
        }
        var prizeTable = '';
        if (prizePool.length) {
          prizeTable = '<div class="dyn-tournament-prize-pool">';
          prizeTable += '<div class="dyn-tournament-prize-pool-title">💎 פרסים</div>';
          prizeTable += '<div class="dyn-tournament-prize-list">';
          prizePool.slice(0, 5).forEach(function(p) {
            var emoji = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : '#' + p.rank;
            prizeTable += '<span class="dyn-tournament-prize-item">' + emoji + ' ' + p.reward.toLocaleString() + '💎</span>';
          });
          prizeTable += '</div></div>';
        }
        body.innerHTML = prizeTable + '<div class="dyn-tournament-list">' + rows + '</div>';
      });
  }
  window.showTournamentModal = showTournamentModal;
  window.closeTournamentModal = closeTournamentModal;

  // Pre-fetch on module load so the cache is warm by the time the
  // picker opens.
  setTimeout(function() { try { fetchTournaments(false); } catch (e) {} }, 1500);

  // ============================================================
  // Friends Invite + Shared Streak — stage 13 (May 2026)
  //
  // The viral loop: every player has a BLOOM-XXXX code already
  // (from player_profiles). Sharing it via WhatsApp / native share
  // generates a URL like https://bloom.../?ref=BLOOM-XXXX. When the
  // recipient opens that URL on first load, the client auto-pops a
  // "ADD AS FRIEND" overlay → tap → both get 200💎. From then on,
  // every day both play a dynamic-board game → both get 100💎.
  // ============================================================
  var _friendsCache = { data: null, fetchedAt: 0 };
  var FRIENDS_CACHE_MS = 60 * 1000;
  function fetchFriends(force) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    if (!force && _friendsCache.data && (Date.now() - _friendsCache.fetchedAt) < FRIENDS_CACHE_MS) {
      return Promise.resolve(_friendsCache.data);
    }
    return fetch('/api/friends/list?deviceId=' + encodeURIComponent(deviceId), { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _friendsCache.data = d;
          _friendsCache.fetchedAt = Date.now();
        }
        return d;
      });
  }
  function getCachedFriends() { return _friendsCache.data; }
  window.fetchFriends = fetchFriends;

  // Send an invite — paired with a server endpoint that resolves the
  // BLOOM-XXXX code → device_id, creates the friendship symmetrically,
  // pays both signup bonuses.
  function sendFriendInvite(friendCode) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    return fetch('/api/friends/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, friendCode: friendCode })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return { ok: false, reason: 'network' }; })
      .then(function(d) {
        if (d && d.ok && !d.alreadyFriends && d.signupBonus) {
          // Update balance immediately.
          if (typeof updateBalanceDisplay === 'function') {
            try { updateBalanceDisplay(); } catch (e) {}
          }
          // Force-refetch the wallet + friends list.
          try {
            if (typeof playerBalance !== 'undefined') playerBalance = (playerBalance | 0) + d.signupBonus;
            if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
          } catch (e) {}
          fetchFriends(true);
        }
        return d;
      });
  }
  window.sendFriendInvite = sendFriendInvite;

  // Build the shareable invite URL. Format: <origin>/?ref=BLOOM-XXXX
  function buildInviteUrl() {
    var code = (typeof getMyPlayerCode === 'function') ? getMyPlayerCode() : '';
    if (!code) return null;
    return window.location.origin + '/?ref=' + encodeURIComponent(code);
  }
  function getMyPlayerCodeForShare() {
    // Resolve the player's own BLOOM-XXXX. Prefer the value cached by
    // the profile/identity module; fall back to localStorage.
    try {
      var raw = localStorage.getItem('bloom_player_code');
      if (raw) return raw;
    } catch (e) {}
    try {
      if (typeof window._myPlayerCode === 'string' && window._myPlayerCode) return window._myPlayerCode;
    } catch (e) {}
    return null;
  }
  function shareInviteViaWhatsApp() {
    var url = buildInviteUrl();
    if (!url) {
      // Fallback: just share the code if we have it.
      var code = getMyPlayerCodeForShare();
      if (!code) {
        if (typeof __bloomToast === 'function') __bloomToast('עדיין אין לך קוד שחקן · שחק משחק אחד קודם', 'warning');
        return;
      }
      url = window.location.origin + '/?ref=' + encodeURIComponent(code);
    }
    var text = '🌸 בוא תשחק איתי BLOOM! משחק מיזוג ממכר בעברית. הצטרף עם הקישור שלי וקבל 200💎 בחינם: ' + url;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
  function shareInviteViaNative() {
    var url = buildInviteUrl();
    var code = getMyPlayerCodeForShare();
    if (!url) { url = window.location.origin + '/?ref=' + encodeURIComponent(code || ''); }
    var text = '🌸 בוא תשחק איתי BLOOM! קבל 200💎 בחינם כשתצטרף עם הקישור שלי';
    if (navigator.share) {
      navigator.share({ title: 'BLOOM', text: text, url: url }).catch(function() {});
    } else {
      // Clipboard fallback.
      try {
        navigator.clipboard.writeText(text + ' ' + url);
        if (typeof __bloomToast === 'function') __bloomToast('הקישור הועתק ללוח', 'success');
      } catch (e) {}
    }
  }
  window.shareInviteViaWhatsApp = shareInviteViaWhatsApp;
  window.shareInviteViaNative   = shareInviteViaNative;

  // ?ref= URL param handler — fires once on boot. If the player isn't
  // already a friend, pops the soft pre-prompt overlay ("Add דניאל and
  // get 200💎?"). Stores a "ref_seen" flag in localStorage so we don't
  // re-prompt across reloads.
  function handleRefParam() {
    if (!dynConfigBool('friends_enabled', true)) return;
    try {
      var params = new URLSearchParams(window.location.search);
      var ref = params.get('ref');
      if (!ref) return;
      var key = 'bloom_ref_seen:' + ref;
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
      // Don't auto-prompt if the player IS the inviter (opens own link).
      var myCode = getMyPlayerCodeForShare();
      if (myCode && (ref === myCode || ref === 'BLOOM-' + myCode)) return;
      // Wait until profile is loaded so the API has a deviceId to pair.
      setTimeout(function() { showRefPrompt(ref); }, 2000);
    } catch (e) {}
  }
  function showRefPrompt(refCode) {
    if (document.getElementById('dyn-ref-prompt')) return;
    var bonus = dynConfigInt('friends_signup_bonus', 200);
    var ov = document.createElement('div');
    ov.id = 'dyn-ref-prompt';
    ov.className = 'dyn-ref-prompt-overlay';
    ov.innerHTML =
      '<div class="dyn-ref-prompt-card">' +
        '<div class="dyn-ref-prompt-icon">👥</div>' +
        '<div class="dyn-ref-prompt-title">חבר הזמין אותך!</div>' +
        '<div class="dyn-ref-prompt-sub">קוד החבר: <strong>' + escapeHtml(refCode) + '</strong></div>' +
        '<div class="dyn-ref-prompt-reward">+' + bonus + '💎</div>' +
        '<div class="dyn-ref-prompt-bonus-note">לשניכם · יחד מקבלים +100💎 בכל יום ששניכם תשחקו</div>' +
        '<button class="dyn-ref-prompt-accept">🎁 קבל את הבונוס</button>' +
        '<button class="dyn-ref-prompt-skip">לא תודה</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.dyn-ref-prompt-accept').onclick = function() {
      sendFriendInvite(refCode).then(function(d) {
        if (d && d.ok) {
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 50, 90]); } catch (e) {}
          ov.classList.add('dyn-ref-prompt-out');
          setTimeout(function() { ov.remove(); }, 320);
        } else {
          var sub = ov.querySelector('.dyn-ref-prompt-sub');
          if (sub) sub.innerHTML = '❌ ' + ((d && d.reason) || 'שגיאה');
        }
      });
    };
    ov.querySelector('.dyn-ref-prompt-skip').onclick = function() {
      ov.classList.add('dyn-ref-prompt-out');
      setTimeout(function() { ov.remove(); }, 320);
    };
  }
  window.handleRefParam = handleRefParam;
  // Run on module load. Wait 1.5s so the identity module finishes
  // resolving the player's own code first.
  setTimeout(function() { try { handleRefParam(); } catch (e) {} }, 1500);

  // Friends modal — list + add-by-code + share buttons.
  function closeFriendsModal() {
    var el = document.getElementById('dyn-friends-modal');
    if (el) el.remove();
  }
  function showFriendsModal() {
    closeFriendsModal();
    var myCode = getMyPlayerCodeForShare();
    var bonus = dynConfigInt('friends_signup_bonus', 200);
    var sharedBonus = dynConfigInt('friends_shared_day_bonus', 100);
    var ov = document.createElement('div');
    ov.id = 'dyn-friends-modal';
    ov.className = 'dyn-friends-modal-overlay';
    ov.innerHTML =
      '<div class="dyn-friends-modal-card">' +
        '<div class="dyn-friends-modal-head">' +
          '<button class="dyn-friends-modal-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-friends-modal-title">👥 חברים</div>' +
          '<div class="dyn-friends-modal-sub">הזמן חבר → שניכם מקבלים <strong>' + bonus + '💎</strong> · בכל יום ששניכם תשחקו = <strong>+' + sharedBonus + '💎</strong> כל אחד</div>' +
        '</div>' +
        '<div class="dyn-friends-share-row">' +
          (myCode
            ? '<div class="dyn-friends-mycode">הקוד שלך: <strong>' + escapeHtml(myCode) + '</strong></div>' +
              '<div class="dyn-friends-share-btns">' +
                '<button class="dyn-friends-share-wa">💬 שתף ב-WhatsApp</button>' +
                '<button class="dyn-friends-share-native">📤 שתף</button>' +
                '<button class="dyn-friends-share-copy">📋 העתק קישור</button>' +
              '</div>'
            : '<div class="dyn-friends-mycode-missing">⏳ הקוד שלך עוד לא זמין · סיים משחק אחד קודם</div>') +
        '</div>' +
        '<div class="dyn-friends-add-row">' +
          '<label class="dyn-friends-add-label">הוסף חבר לפי קוד</label>' +
          '<div class="dyn-friends-add-input-row">' +
            '<input type="text" id="dyn-friends-add-input" placeholder="BLOOM-XXXX" maxlength="14" />' +
            '<button class="dyn-friends-add-btn" id="dyn-friends-add-btn">➕ הוסף</button>' +
          '</div>' +
          '<div class="dyn-friends-add-status" id="dyn-friends-add-status"></div>' +
        '</div>' +
        '<div class="dyn-friends-list-host" id="dyn-friends-list-host">' +
          '<div class="board-lb-loading">⏳ טוען חברים...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.dyn-friends-modal-close').onclick = closeFriendsModal;
    ov.addEventListener('click', function(e) { if (e.target === ov) closeFriendsModal(); });
    var waBtn = ov.querySelector('.dyn-friends-share-wa');
    if (waBtn) waBtn.onclick = shareInviteViaWhatsApp;
    var natBtn = ov.querySelector('.dyn-friends-share-native');
    if (natBtn) natBtn.onclick = shareInviteViaNative;
    var copyBtn = ov.querySelector('.dyn-friends-share-copy');
    if (copyBtn) copyBtn.onclick = function() {
      var u = buildInviteUrl(); if (!u) return;
      try { navigator.clipboard.writeText(u); if (typeof __bloomToast === 'function') __bloomToast('הקישור הועתק', 'success'); } catch (e) {}
    };
    var addBtn = document.getElementById('dyn-friends-add-btn');
    var addInput = document.getElementById('dyn-friends-add-input');
    var addStatus = document.getElementById('dyn-friends-add-status');
    if (addBtn) addBtn.onclick = function() {
      var code = (addInput.value || '').trim().toUpperCase();
      if (!code) return;
      addBtn.disabled = true; addStatus.textContent = '⏳ מוסיף...';
      sendFriendInvite(code).then(function(d) {
        addBtn.disabled = false;
        if (d && d.ok) {
          if (d.alreadyFriends) {
            addStatus.textContent = '✓ כבר חברים';
            addStatus.style.color = '#6F6E68';
          } else {
            addStatus.innerHTML = '✅ נוסף! שניכם קיבלתם <strong>+' + d.signupBonus + '💎</strong>';
            addStatus.style.color = '#04342C';
            addInput.value = '';
            try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
            // Refresh list.
            renderFriendsList();
          }
        } else {
          var reasons = {
            'friend_not_found': '❌ קוד לא נמצא',
            'cant_self_friend': '❌ אי-אפשר להוסיף את עצמך',
            'max_friends_reached': '❌ הגעת למקסימום חברים',
            'disabled': '⚠ המנגנון כבוי',
            'network': '❌ שגיאת רשת',
            'rate_limited': '⚠ נסה שוב מאוחר יותר'
          };
          addStatus.textContent = reasons[(d && d.reason)] || ('❌ ' + ((d && d.reason) || 'שגיאה'));
          addStatus.style.color = '#E07A8E';
        }
      });
    };
    function renderFriendsList() {
      var host = document.getElementById('dyn-friends-list-host');
      if (!host) return;
      fetchFriends(true).then(function(d) {
        if (!d || !d.ok) {
          host.innerHTML = '<div class="board-lb-empty">שגיאה בטעינה</div>';
          return;
        }
        var list = d.friends || [];
        if (!list.length) {
          host.innerHTML = '<div class="board-lb-empty">🌱 עדיין אין חברים<br><span class="board-lb-empty-sub">שתף את הקוד שלך עם חבר!</span></div>';
          return;
        }
        var html = '<div class="dyn-friends-list-title">החברים שלך · ' + list.length + '</div>';
        list.forEach(function(f) {
          var todayPill = f.playedToday
            ? '<span class="dyn-friend-row-today dyn-friend-row-today-yes">✓ שיחק היום</span>'
            : '<span class="dyn-friend-row-today dyn-friend-row-today-no">⏰ עדיין לא היום</span>';
          html += '<div class="dyn-friend-row">' +
            '<div class="dyn-friend-row-avatar">👤</div>' +
            '<div class="dyn-friend-row-body">' +
              '<div class="dyn-friend-row-name">' + escapeHtml(f.name || 'אנונימי') + '</div>' +
              '<div class="dyn-friend-row-code">' + escapeHtml(f.code || '') + '</div>' +
            '</div>' +
            todayPill +
          '</div>';
        });
        host.innerHTML = html;
      });
    }
    renderFriendsList();
  }
  window.showFriendsModal = showFriendsModal;
  window.closeFriendsModal = closeFriendsModal;

  // Human-readable labels for themes / shapes so the player can tell the
  // boards apart before clicking — boring rectangular cards = no clicks.
  var THEME_LABELS = {
    hanukkah:      { icon: '🕎', label: 'חנוכה' },
    valentine:     { icon: '💕', label: 'ולנטיין' },
    yom_haatzmaut: { icon: '🇮🇱', label: 'יום העצמאות' },
    passover:      { icon: '🍷', label: 'פסח' }
  };
  var SHAPE_LABELS = {
    heart:   { icon: '❤️', label: 'לב' },
    diamond: { icon: '💎', label: 'יהלום' },
    tree:    { icon: '🌲', label: 'עץ' },
    pyramid: { icon: '🔺', label: 'פירמידה' }
  };
  // Per-cell-type label for the "special cells preview" line.
  var CELL_TYPE_ICON = {
    gold: '✨', bonus: '🪙', frozen: '❄️',
    electric: '⚡', locked: '🔒', teleport: '🌀'
  };
  function describeBoard(board) {
    if (!board || !board.definition) return '';
    var def = board.definition;
    if (board.type === 'multipliers' && Array.isArray(def.multipliers)) {
      return def.multipliers.map(function(m) {
        var v = Number(m);
        return '×' + (Number.isInteger(v) ? v : v.toFixed(1));
      }).join(' · ');
    }
    if (board.type === 'special_cells' || board.type === 'themed') {
      var parts = [];
      if (def.theme_id && THEME_LABELS[def.theme_id]) {
        parts.push(THEME_LABELS[def.theme_id].icon + ' ' + THEME_LABELS[def.theme_id].label);
      }
      if (def.shape_id && SHAPE_LABELS[def.shape_id]) {
        parts.push(SHAPE_LABELS[def.shape_id].icon + ' ' + SHAPE_LABELS[def.shape_id].label);
      }
      var cells = Array.isArray(def.cells) ? def.cells : [];
      if (cells.length) {
        var byType = {};
        cells.forEach(function(c) {
          if (!c || !c.type) return;
          byType[c.type] = (byType[c.type] || 0) + 1;
        });
        var cellSummary = Object.keys(byType).map(function(t) {
          return (CELL_TYPE_ICON[t] || '') + '×' + byType[t];
        }).join(' ');
        if (cellSummary) parts.push(cellSummary);
      }
      return parts.join(' · ');
    }
    return '';
  }

  function boardTypeBadge(type) {
    var map = {
      multipliers:   { icon: '🎯', label: 'מכפילי עמודות' },
      special_cells: { icon: '🔮', label: 'תאים מיוחדים' },
      shape:         { icon: '🟦', label: 'צורת לוח' },
      themed:        { icon: '🎄', label: 'חג' },
      mode:          { icon: '⏱', label: 'וריאציית חוקים' },
      vip:           { icon: '👑', label: 'בלעדי' }
    };
    return map[type] || { icon: '🎯', label: 'מותאם' };
  }

  function showDynamicBoardsPicker() {
    closeDynamicBoardsPicker();
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    // Streak banner — sits between the title and the list. Three states:
    //  - none / single day → muted "🌱 התחל רצף היום" pioneer copy
    //  - active streak, played today → calm "🔥 רצף N — שמרת אותו היום!"
    //  - active streak, NOT played today → red-orange "🔥 הרצף בסכנה!"
    var streakEnabled2 = dynFeatureEnabled('streak');
    var streakSt2 = (streakEnabled2 && typeof getDynamicStreak === 'function') ? getDynamicStreak() : { count: 0, last: null };
    var streakDanger2 = streakEnabled2 && typeof isStreakInDanger === 'function' && isStreakInDanger();
    var streakBannerHtml = '';
    if (streakEnabled2 && streakSt2.count >= 1) {
      var nextM = (typeof nextStreakMilestone === 'function') ? nextStreakMilestone(streakSt2.count) : null;
      var nextMRew = (window.DYN_STREAK_REWARDS || {})[nextM] || 0;
      var progressLine = nextM
        ? '<div class="dyn-streak-progress">עוד <strong>' + (nextM - streakSt2.count) + ' ימים</strong> לבאדג׳ ' + nextM + (nextMRew ? ' (+' + nextMRew + '💎)' : '') + '</div>'
        : '<div class="dyn-streak-progress">🏆 הרצף הארוך בהיסטוריה שלך!</div>';
      if (streakDanger2) {
        streakBannerHtml =
          '<div class="dyn-streak-banner dyn-streak-banner-danger">' +
            '<div class="dyn-streak-banner-icon">🔥</div>' +
            '<div class="dyn-streak-banner-body">' +
              '<div class="dyn-streak-banner-title">הרצף בסכנה! <strong>' + streakSt2.count + ' ימים</strong></div>' +
              '<div class="dyn-streak-banner-sub">שחק כל לוח דינמי עד חצות (אסיה/ירושלים) כדי לשמור עליו</div>' +
              progressLine +
            '</div>' +
          '</div>';
      } else {
        streakBannerHtml =
          '<div class="dyn-streak-banner dyn-streak-banner-safe">' +
            '<div class="dyn-streak-banner-icon">🔥</div>' +
            '<div class="dyn-streak-banner-body">' +
              '<div class="dyn-streak-banner-title">רצף <strong>' + streakSt2.count + ' ימים</strong> · שמרת אותו היום ✓</div>' +
              progressLine +
            '</div>' +
          '</div>';
      }
    } else if (streakEnabled2) {
      // Pioneer copy — adjust the day-N rewards to whatever the admin
      // has configured so the onboarding promise matches reality.
      var r3 = dynStreakReward(3), r7 = dynStreakReward(7), r14 = dynStreakReward(14), r30 = dynStreakReward(30);
      streakBannerHtml =
        '<div class="dyn-streak-banner dyn-streak-banner-pioneer">' +
          '<div class="dyn-streak-banner-icon">🌱</div>' +
          '<div class="dyn-streak-banner-body">' +
            '<div class="dyn-streak-banner-title">סיים לוח אחד היום — והרצף שלך מתחיל</div>' +
            '<div class="dyn-streak-banner-sub">3 ימים → ' + r3 + '💎 · 7 ימים → ' + r7 + '💎 · 14 ימים → ' + r14 + '💎 · 30 ימים → ' + r30 + '💎</div>' +
          '</div>' +
        '</div>';
    }
    // Friends headline — minimal pill at the top of the header when
    // the feature is enabled. Shows friend count + "X שיחקו היום" so
    // the player sees the social FOMO ("דניאל כבר שיחק היום, גם אני").
    var friendsCached = (typeof getCachedFriends === 'function') ? getCachedFriends() : null;
    var friendsHeadlineHtml = '';
    if (dynConfigBool('friends_enabled', true)) {
      var friendsCount = (friendsCached && friendsCached.friends) ? friendsCached.friends.length : 0;
      var playedTodayCount = (friendsCached && friendsCached.friends)
        ? friendsCached.friends.filter(function(f) { return f.playedToday; }).length
        : 0;
      var label;
      if (friendsCount === 0) {
        label = '👥 הזמן חבר → +' + dynConfigInt('friends_signup_bonus', 200) + '💎 לשניכם';
      } else if (playedTodayCount > 0) {
        label = '👥 ' + playedTodayCount + ' מ-' + friendsCount + ' חברים שיחקו היום';
      } else {
        label = '👥 ' + friendsCount + (friendsCount === 1 ? ' חבר' : ' חברים') + ' · אף אחד לא שיחק היום';
      }
      friendsHeadlineHtml =
        '<button class="dyn-friends-headline" id="dyn-friends-headline">' +
          '<span class="dyn-friends-headline-icon">👥</span>' +
          '<span class="dyn-friends-headline-text">' + label + '</span>' +
          '<span class="dyn-friends-headline-arrow">›</span>' +
        '</button>';
    }

    // Daily Special banner — Stage 15. Sits at the ABSOLUTE top of the
    // header because it's the #1 daily-return hook. Pulsing gold-pink
    // gradient screams "today is different". Only renders when the
    // server confirms a special board is live.
    var dailySpecialBannerHtml = (function() {
      var ds = window._dailySpecial;
      if (!ds || !ds.enabled || !ds.id) return '';
      var specialBoard = boards.find(function(b) { return b.id === ds.id; });
      if (!specialBoard) return '';
      var xpMultLabel = (ds.xpMult % 1 === 0) ? ds.xpMult + '×' : ds.xpMult.toFixed(1) + '×';
      var rewardMultLabel = (ds.rewardMult % 1 === 0) ? ds.rewardMult + '×' : ds.rewardMult.toFixed(1) + '×';
      return '<button class="dyn-daily-special-banner" id="dyn-daily-special-banner" data-board-id="' + specialBoard.id + '">' +
        '<span class="dyn-daily-special-banner-icon">🌟</span>' +
        '<span class="dyn-daily-special-banner-body">' +
          '<span class="dyn-daily-special-banner-title">הלוח של היום: <strong>' + escapeHtml(specialBoard.name || 'לוח') + '</strong></span>' +
          '<span class="dyn-daily-special-banner-perks">' +
            '<span class="dyn-daily-special-perk">' + xpMultLabel + ' XP</span>' +
            '<span class="dyn-daily-special-perk">' + rewardMultLabel + ' פרסים</span>' +
            '<span class="dyn-daily-special-perk-cta">שחק עכשיו ←</span>' +
          '</span>' +
        '</span>' +
      '</button>';
    })();

    // Live Tournament banner — sits below the Daily Special banner.
    // Highest-priority community surface, but daily-special wins because
    // it changes every day (vs tournaments which fire less frequently).
    var tournamentBannerHtml = renderTournamentBannerHtml();

    // Season Pass headline — sits at the very top of the header.
    // The most-prominent retention surface: XP bar + unclaimed badge.
    var seasonCached = getCachedSeasonStatus();
    var seasonHeadlineHtml = '';
    if (seasonCached && seasonCached.enabled !== false) {
      var sXp = seasonCached.xp | 0;
      var sTier = seasonCached.currentTier | 0;
      var sUnclaimed = seasonCached.unclaimedCount | 0;
      var tiers = seasonCached.tiers || [];
      var nextTier = tiers.find(function(t) { return t.tier > sTier; });
      var prevTierXp = sTier > 0 ? (tiers.find(function(t) { return t.tier === sTier; }) || {}).xpRequired || 0 : 0;
      var nextXp = nextTier ? nextTier.xpRequired : (tiers[tiers.length - 1] || {}).xpRequired || 1;
      var pct = nextTier
        ? Math.max(0, Math.min(100, Math.round(((sXp - prevTierXp) / (nextXp - prevTierXp)) * 100)))
        : 100;
      var unclaimedPill = sUnclaimed > 0
        ? ' <span class="dyn-season-headline-claim">' + sUnclaimed + ' 🎁</span>'
        : '';
      seasonHeadlineHtml =
        '<button class="dyn-season-headline" id="dyn-season-headline"' + (sUnclaimed > 0 ? ' data-has-claim="1"' : '') + '>' +
          '<span class="dyn-season-headline-icon">🎖</span>' +
          '<span class="dyn-season-headline-body">' +
            '<span class="dyn-season-headline-title">דרגה <strong>' + sTier + '</strong> · מסלול העונה' + unclaimedPill + '</span>' +
            '<span class="dyn-season-headline-bar"><span class="dyn-season-headline-bar-fill" style="width:' + pct + '%"></span></span>' +
          '</span>' +
          '<span class="dyn-season-headline-arrow">›</span>' +
        '</button>';
    }

    // Daily quests headline — sits at the very top of the header.
    // Shows progress + "claim N rewards" hint if any are completed
    // but unclaimed.
    var qSum = (typeof questsSummary === 'function') ? questsSummary() : null;
    var questsHeadlineHtml = '';
    if (qSum && qSum.total > 0) {
      var claimablePill = qSum.claimable > 0
        ? ' <span class="dyn-quests-headline-claim">' + qSum.claimable + ' 🎁 לקבל</span>'
        : '';
      questsHeadlineHtml =
        '<button class="dyn-quests-headline" id="dyn-quests-headline"' + (qSum.claimable > 0 ? ' data-claimable="1"' : '') + '>' +
          '<span class="dyn-quests-headline-icon">🎯</span>' +
          '<span class="dyn-quests-headline-text">' +
            'משימות יומיות: ' + qSum.done + ' / ' + qSum.total +
            claimablePill +
          '</span>' +
          '<span class="dyn-quests-headline-arrow">›</span>' +
        '</button>';
    }
    // Achievement progress headline — "X / Y total" pill that opens
    // the achievements modal on click. Visible regardless of streak
    // state since it's a separate completionist track.
    var achState = (typeof listAllAchievementsForUI === 'function') ? listAllAchievementsForUI(boards) : null;
    var achProgressHtml = '';
    if (achState) {
      var earnedCross = (achState.cross || []).filter(function(a) { return a.earned; }).length;
      var totalCross = (achState.cross || []).length;
      // Sum per-board earned across known boards.
      var earnedPerBoard = 0;
      var pbState = achState.perBoardState || {};
      Object.keys(pbState).forEach(function(bid) {
        var entry = pbState[bid] || {};
        (achState.perBoard || []).forEach(function(a) { if (entry[a.id]) earnedPerBoard++; });
      });
      var totalPerBoard = (achState.perBoard || []).length * Math.max(boards.length, 1);
      achProgressHtml =
        '<button class="dyn-ach-progress-btn" id="dyn-ach-progress-btn">' +
          '<span class="dyn-ach-progress-icon">🏅</span>' +
          '<span class="dyn-ach-progress-text">הישגים: ' + (earnedCross + earnedPerBoard) + ' / ' + (totalCross + totalPerBoard) + '</span>' +
          '<span class="dyn-ach-progress-arrow">›</span>' +
        '</button>';
    }
    var overlay = document.createElement('div');
    overlay.id = 'dynamic-boards-picker';
    overlay.className = 'dyn-boards-overlay';
    overlay.innerHTML =
      '<div class="dyn-boards-modal">' +
        '<div class="dyn-boards-head">' +
          '<button class="dyn-boards-close" aria-label="סגור">✕</button>' +
          '<div class="dyn-boards-title">🎯 לוחות דינמיים</div>' +
          '<div class="dyn-boards-sub">לוחות מיוחדים עם חוקים משלהם. כל לוח — לוח מובילים נפרד, שיא אישי משלך, ומשימות.</div>' +
          dailySpecialBannerHtml +
          tournamentBannerHtml +
          friendsHeadlineHtml +
          seasonHeadlineHtml +
          questsHeadlineHtml +
          achProgressHtml +
          streakBannerHtml +
          (function() {
            // Streak Freeze row — only when the feature is on. Shows
            // current count + buy button. Hidden if streak itself is off.
            if (!streakEnabled2) return '';
            if (!dynConfigBool('dyn_streak_freeze_enabled', true)) return '';
            var count = getStreakFreezes();
            var price = dynConfigInt('dyn_streak_freeze_price', 200);
            return '<div class="dyn-freeze-row">' +
              '<span class="dyn-freeze-icon">🛡</span>' +
              '<span class="dyn-freeze-text">' +
                'הקפאות רצף: <strong>' + count + '</strong>' +
                (count > 0 ? ' <span class="dyn-freeze-hint">(מצילות יום אחד שפספסת)</span>' : ' <span class="dyn-freeze-hint">(קנה לפני שתפספס יום)</span>') +
              '</span>' +
              '<button class="dyn-freeze-buy" id="dyn-freeze-buy-btn">🛡 קנה (' + price + '💎)</button>' +
            '</div>';
          })() +
        '</div>' +
        '<div class="dyn-boards-list" id="dyn-boards-list"></div>' +
        '<div class="dyn-boards-foot">' +
          '<button class="dyn-boards-cancel">חזרה לבית</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var achBtn = document.getElementById('dyn-ach-progress-btn');
    if (achBtn) achBtn.onclick = showAchievementsModal;
    var qBtn = document.getElementById('dyn-quests-headline');
    if (qBtn) qBtn.onclick = showQuestsModal;
    var sBtn = document.getElementById('dyn-season-headline');
    if (sBtn) sBtn.onclick = showSeasonPassModal;
    var tBnr = document.getElementById('dyn-tournament-banner');
    if (tBnr) tBnr.onclick = function() {
      var tid = parseInt(tBnr.getAttribute('data-tournament-id'), 10);
      if (Number.isFinite(tid)) showTournamentModal(tid);
    };
    var fBtn = document.getElementById('dyn-friends-headline');
    if (fBtn) fBtn.onclick = showFriendsModal;
    // Daily Special banner click — start the special board immediately.
    var dsBnr = document.getElementById('dyn-daily-special-banner');
    if (dsBnr) dsBnr.onclick = function() {
      var bid = parseInt(dsBnr.getAttribute('data-board-id'), 10);
      if (!Number.isFinite(bid)) return;
      var target = boards.find(function(b) { return b.id === bid; });
      if (!target) return;
      closeDynamicBoardsPicker();
      try { startDynamicBoard(target); } catch (e) {}
    };
    // Fire a background fetch on every picker open so the cache stays
    // fresh for the NEXT open. The current render uses whatever is in
    // the cache (which may be from a previous game-over's XP grant).
    fetchSeasonStatus(false);
    fetchTournaments(false);
    fetchFriends(false);
    // Streak-freeze buy button + comeback overlay (if eligible).
    var freezeBuyBtn = document.getElementById('dyn-freeze-buy-btn');
    if (freezeBuyBtn) freezeBuyBtn.onclick = function() {
      freezeBuyBtn.disabled = true;
      freezeBuyBtn.innerHTML = '⏳';
      buyStreakFreeze().then(function(d) {
        freezeBuyBtn.disabled = false;
        if (d && d.ok) {
          // Re-render the picker header to show updated count + balance.
          closeDynamicBoardsPicker();
          setTimeout(showDynamicBoardsPicker, 50);
        } else {
          freezeBuyBtn.innerHTML = d && d.reason === 'insufficient_funds' ? '💎 חסר' : 'שגיאה';
          setTimeout(function() {
            freezeBuyBtn.innerHTML = '🛡 קנה (' + (dynConfigInt('dyn_streak_freeze_price', 200)) + '💎)';
          }, 1800);
        }
      });
    };
    // Comeback — fire 350ms after picker opens so the player sees the
    // shell first, then the celebration. Acts as a positive re-entry.
    setTimeout(function() {
      if (getComebackContext()) showComebackOverlay();
    }, 350);

    var listEl = document.getElementById('dyn-boards-list');
    if (!boards.length) {
      listEl.innerHTML =
        '<div class="dyn-boards-empty">' +
          '<div class="dyn-boards-empty-icon">🌱</div>' +
          '<div class="dyn-boards-empty-title">לוחות חדשים בקרוב</div>' +
          '<div class="dyn-boards-empty-sub">אנחנו עובדים על לוחות חדשים — חזור לבדוק מאוחר יותר. בינתיים, נסה את האתגר היומי או תחרות חברים.</div>' +
        '</div>';
    } else {
      // Card backgrounds per theme — match css/boards.css body.theme-X-active
      // hue so the picker already feels like the board you're about to enter.
      var THEME_TINTS = {
        hanukkah:      'linear-gradient(135deg, rgba(14,42,91,0.18), rgba(30,79,170,0.12))',
        valentine:     'linear-gradient(135deg, rgba(255,122,168,0.18), rgba(255,209,220,0.18))',
        yom_haatzmaut: 'linear-gradient(135deg, rgba(11,124,196,0.20), rgba(232,243,255,0.14))',
        passover:      'linear-gradient(135deg, rgba(122,26,26,0.22), rgba(192,57,43,0.12))'
      };
      var html = '';
      for (var i = 0; i < boards.length; i++) {
        var b = boards[i];
        var badge = boardTypeBadge(b.type);
        var desc = describeBoard(b);
        var def = b.definition || {};
        var tint = (def.theme_id && THEME_TINTS[def.theme_id]) ? THEME_TINTS[def.theme_id] : '';
        var extraStyle = tint ? (' style="background:' + tint + '"') : '';
        // Pretty chip row — themed boards add an extra row of visual identity
        // pills so the player can see what they're picking before tapping.
        var chips = [];
        if (def.theme_id && THEME_LABELS[def.theme_id]) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-theme">' + THEME_LABELS[def.theme_id].icon + ' ' + THEME_LABELS[def.theme_id].label + '</span>');
        }
        if (def.shape_id && SHAPE_LABELS[def.shape_id]) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-shape">' + SHAPE_LABELS[def.shape_id].icon + ' ' + SHAPE_LABELS[def.shape_id].label + '</span>');
        }
        var cells = Array.isArray(def.cells) ? def.cells : [];
        if (cells.length) {
          var byT = {};
          cells.forEach(function(c) { if (c && c.type) byT[c.type] = (byT[c.type] || 0) + 1; });
          Object.keys(byT).forEach(function(t) {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-cell">' + (CELL_TYPE_ICON[t] || '') + ' ×' + byT[t] + '</span>');
          });
        }
        // Personal-best chip — the most addictive item on the card.
        // Empty record: gentle "🌱" pioneer chip (also drives "be the
        // first" psychology). Has a record: gold "🏆" chip with score.
        var best = getBoardBest(b.id);
        if (dynFeatureEnabled('personal_best')) {
          if (best && best.score > 0) {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-best">🏆 שיא ' + formatBoardScore(best.score) + '</span>');
          } else {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-pioneer">🌱 בוא נתחיל</span>');
          }
        }
        // Global per-board leader — the social half of the addiction loop.
        // When you're #1: special crown chip. Otherwise: shows the leader's
        // score as a clear target.
        if (dynFeatureEnabled('global_lb')) {
          if (b.leader_name && b.leader_score) {
            var imLeader = best && best.score >= b.leader_score;
            if (imLeader) {
              chips.push('<span class="dyn-boards-chip dyn-boards-chip-king">👑 אתה מוביל!</span>');
            } else {
              chips.push('<span class="dyn-boards-chip dyn-boards-chip-leader">👑 ' + escapeHtml(b.leader_name) + ': ' + formatBoardScore(b.leader_score) + '</span>');
            }
          }
          if (b.players && b.players > 0) {
            chips.push('<span class="dyn-boards-chip dyn-boards-chip-players">👥 ' + b.players + ' שיחקו</span>');
          }
        }
        // Earned achievement badge stack — shows ONLY the icons of
        // achievements the player has earned on THIS specific board.
        // Visual gamification: "I have 3 badges on Hanukkah, can I get
        // the missing 2?".
        var earnedIcons = (typeof getEarnedPerBoardIcons === 'function') ? getEarnedPerBoardIcons(b.id) : [];
        if (earnedIcons.length) {
          chips.push('<span class="dyn-boards-chip dyn-boards-chip-badges">🏅 ' + earnedIcons.join(' ') + '</span>');
        }
        // Stage 15 — Daily Special chip. Loudest chip on the card.
        // Pulsing gradient so the eye can't miss "today's the day".
        var ds15 = window._dailySpecial;
        var isDailySpecialBoard = !!(ds15 && ds15.enabled && ds15.id === b.id);
        if (isDailySpecialBoard) {
          var xpL = (ds15.xpMult % 1 === 0) ? ds15.xpMult + '×' : ds15.xpMult.toFixed(1) + '×';
          var rwL = (ds15.rewardMult % 1 === 0) ? ds15.rewardMult + '×' : ds15.rewardMult.toFixed(1) + '×';
          chips.unshift('<span class="dyn-boards-chip dyn-boards-chip-daily-special">🌟 הלוח של היום · ' + xpL + ' XP · ' + rwL + ' פרסים</span>');
        }
        var chipsHtml = chips.length ? ('<div class="dyn-boards-card-chips">' + chips.join('') + '</div>') : '';
        // Per-card urgency badge (Phase 6 LiveOps). data-board-id +
        // data-ends-at on the card so refreshPickerTimers() can re-paint
        // without a full re-render every minute.
        var u = boardUrgency(b);
        var endsAttr = b.ends_at ? (' data-ends-at="' + escapeHtml(b.ends_at) + '"') : '';
        var startsAttr = b.starts_at ? (' data-starts-at="' + escapeHtml(b.starts_at) + '"') : '';
        var classExtra = (u === 'critical' || u === 'new' || u === 'soon') ? (' fomo-' + u) : '';
        if (isDailySpecialBoard) classExtra += ' daily-special';
        var trophyHtml = dynFeatureEnabled('global_lb')
          ? '<button class="dyn-boards-trophy-btn" data-board-id="' + b.id + '" data-action="trophy" aria-label="לוח מובילים">🏆</button>'
          : '';
        var fomoBadgeHtml = dynFeatureEnabled('fomo') ? renderFomoBadge(b) : '';
        html +=
          '<div class="dyn-boards-card-wrap">' +
            '<button class="dyn-boards-card' + classExtra + '" data-board-id="' + b.id + '" data-action="play"' + endsAttr + startsAttr + extraStyle + '>' +
              '<div class="dyn-boards-card-icon">' + badge.icon + '</div>' +
              '<div class="dyn-boards-card-body">' +
                '<div class="dyn-boards-card-name">' + escapeHtml(b.name || 'לוח') + '</div>' +
                '<div class="dyn-boards-card-type">' + badge.label + (desc && b.type === 'multipliers' ? ' · ' + desc : '') + '</div>' +
                chipsHtml +
                '<div class="dyn-boards-card-fomo" data-fomo-host="1">' + fomoBadgeHtml + '</div>' +
              '</div>' +
              '<div class="dyn-boards-card-cta">שחק ←</div>' +
            '</button>' +
            trophyHtml +
          '</div>';
      }
      listEl.innerHTML = html;
      listEl.addEventListener('click', function(e) {
        // Trophy button is checked FIRST so it doesn't fall through to play.
        var trophyBtn = e.target.closest('.dyn-boards-trophy-btn');
        if (trophyBtn) {
          var tbId = parseInt(trophyBtn.getAttribute('data-board-id'), 10);
          var tBoard = boards.find(function(x) { return x.id === tbId; });
          if (tBoard) showBoardLeaderboard(tBoard);
          return;
        }
        var card = e.target.closest('.dyn-boards-card');
        if (!card) return;
        var id = parseInt(card.getAttribute('data-board-id'), 10);
        var board = boards.find(function(x) { return x.id === id; });
        if (board) startDynamicBoard(board);
      });
    }

    overlay.querySelector('.dyn-boards-close').onclick = closeDynamicBoardsPicker;
    overlay.querySelector('.dyn-boards-cancel').onclick = closeDynamicBoardsPicker;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDynamicBoardsPicker();
    });
  }

  // Renders the per-card FOMO badge — pure function of the board's
  // urgency tier. Empty string when nothing's urgent (keeps the card
  // clean for the boring case).
  function renderFomoBadge(board) {
    var u = boardUrgency(board);
    var endsIn = boardEndsInMs(board);
    if (u === 'critical') {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-critical">🔥 מסתיים בעוד ' + fmtCountdown(endsIn) + '</span>';
    }
    if (u === 'new') {
      var endStr = board.ends_at ? (' · עד ' + shortDate(board.ends_at)) : '';
      return '<span class="dyn-fomo-pill dyn-fomo-pill-new">🆕 חדש היום' + endStr + '</span>';
    }
    if (u === 'soon') {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-soon">⏰ נשאר ' + fmtCountdown(endsIn) + '</span>';
    }
    if (board.ends_at) {
      return '<span class="dyn-fomo-pill dyn-fomo-pill-cal">📅 עד ' + shortDate(board.ends_at) + '</span>';
    }
    return '';
  }

  // 60s tick callback when picker is open. Re-renders ONLY the badge
  // hosts — keeps focus / scroll position intact.
  function refreshPickerTimers() {
    var boards = Array.isArray(window._availableBoards) ? window._availableBoards : [];
    var byId = {};
    boards.forEach(function(b) { byId[b.id] = b; });
    document.querySelectorAll('#dyn-boards-list .dyn-boards-card').forEach(function(card) {
      var id = parseInt(card.getAttribute('data-board-id'), 10);
      var b = byId[id];
      if (!b) return;
      var host = card.querySelector('[data-fomo-host]');
      if (host) host.innerHTML = renderFomoBadge(b);
      // Re-apply urgency class — it may have changed tier (e.g. soon→critical).
      card.classList.remove('fomo-critical', 'fomo-new', 'fomo-soon');
      var u = boardUrgency(b);
      if (u === 'critical' || u === 'new' || u === 'soon') card.classList.add('fomo-' + u);
    });
  }
  window.refreshPickerTimers = refreshPickerTimers;

  function closeDynamicBoardsPicker() {
    var el = document.getElementById('dynamic-boards-picker');
    if (el) el.remove();
  }

  // ============================================================
  // Per-board leaderboard modal — top 50 + my rank with explicit
  // gap-to-next-rank target. Sits on top of the picker (doesn't
  // close it) so the player can flip between boards quickly.
  // Live refresh every 30s while open.
  // ============================================================
  var _boardLbRefreshHandle = null;
  var _boardLbCurrentBoard = null;
  function closeBoardLeaderboard() {
    var el = document.getElementById('board-lb-overlay');
    if (el) el.remove();
    if (_boardLbRefreshHandle) { clearInterval(_boardLbRefreshHandle); _boardLbRefreshHandle = null; }
    _boardLbCurrentBoard = null;
  }
  function showBoardLeaderboard(board) {
    if (!board || !board.id) return;
    closeBoardLeaderboard();
    _boardLbCurrentBoard = board;
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var theme = THEME_LABELS[board.definition && board.definition.theme_id];
    var shape = SHAPE_LABELS[board.definition && board.definition.shape_id];
    var hero = '';
    if (theme) hero = theme.icon + ' ' + theme.label;
    if (shape) hero += (hero ? ' · ' : '') + shape.icon + ' ' + shape.label;
    var overlay = document.createElement('div');
    overlay.id = 'board-lb-overlay';
    overlay.className = 'board-lb-overlay';
    overlay.innerHTML =
      '<div class="board-lb-modal">' +
        '<div class="board-lb-head">' +
          '<button class="board-lb-close" aria-label="סגור">✕</button>' +
          '<div class="board-lb-title">🏆 לוח מובילים</div>' +
          '<div class="board-lb-board-name">' + escapeHtml(board.name || 'לוח') + (hero ? ' <span class="board-lb-hero-meta">· ' + hero + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="board-lb-body" id="board-lb-body">' +
          '<div class="board-lb-loading">⏳ טוען מובילים…</div>' +
        '</div>' +
        '<div class="board-lb-foot">' +
          '<button class="board-lb-back">← חזור</button>' +
          '<button class="board-lb-play">▶ שחק עכשיו</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.board-lb-close').onclick = closeBoardLeaderboard;
    overlay.querySelector('.board-lb-back').onclick = closeBoardLeaderboard;
    overlay.querySelector('.board-lb-play').onclick = function() {
      var b = _boardLbCurrentBoard;
      closeBoardLeaderboard();
      if (b) startDynamicBoard(b);
    };
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeBoardLeaderboard();
    });
    function paint(data) {
      var body = document.getElementById('board-lb-body');
      if (!body || _boardLbCurrentBoard !== board) return;
      var list = (data && data.list) || [];
      var total = (data && data.total) | 0;
      var myRank = (data && data.myRank) | 0;
      var myScore = (data && data.myScore) | 0;
      if (!list.length) {
        body.innerHTML = '<div class="board-lb-empty">🌱 עדיין אין מובילים<br><span class="board-lb-empty-sub">היה הראשון להתעלף עם השיא!</span></div>';
        return;
      }
      var rows = '';
      var leaderScore = list[0].score;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var rank = i + 1;
        var rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
        var youCls = p.you ? ' board-lb-row-you' : '';
        var topCls = rank <= 3 ? (' board-lb-row-top board-lb-row-top-' + rank) : '';
        var flagHtml = '<span class="board-lb-flag"></span>';
        if (p.country) {
          try {
            var cc = String(p.country).toUpperCase();
            if (cc.length === 2) {
              flagHtml = '<span class="board-lb-flag">' +
                String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65) +
                String.fromCodePoint(0x1F1E6 + cc.charCodeAt(1) - 65) +
                '</span>';
            }
          } catch (e) {}
        }
        rows +=
          '<div class="board-lb-row' + youCls + topCls + '">' +
            '<span class="board-lb-rank">' + rankBadge + '</span>' +
            flagHtml +
            '<span class="board-lb-name">' + escapeHtml(p.name || 'אנונימי') + (p.you ? ' (אתה)' : '') + '</span>' +
            '<span class="board-lb-score">' + (p.score || 0).toLocaleString() + '</span>' +
          '</div>';
      }
      // Footer "your rank" pill — only when player has a score AND isn't
      // already on the visible top-50.
      var myRankHtml = '';
      if (myRank && myScore && myRank > list.length) {
        // Off-list (>50). Show their position separately.
        myRankHtml =
          '<div class="board-lb-row board-lb-row-you board-lb-row-off">' +
            '<span class="board-lb-rank">#' + myRank + '</span>' +
            '<span class="board-lb-flag"></span>' +
            '<span class="board-lb-name">אתה</span>' +
            '<span class="board-lb-score">' + myScore.toLocaleString() + '</span>' +
          '</div>';
      }
      // Persistent "beat the next player" target — strongest single hook.
      // Computed against the row directly above the player.
      var nextTargetHtml = '';
      if (myScore && myRank && myRank > 1) {
        var aboveScore = 0, aboveName = '';
        if (myRank <= list.length && list[myRank - 2]) {
          aboveScore = list[myRank - 2].score;
          aboveName = list[myRank - 2].name;
        }
        if (aboveScore > myScore) {
          var gap = aboveScore - myScore;
          nextTargetHtml =
            '<div class="board-lb-next-target">' +
              '⚔️ עוד <strong>' + gap.toLocaleString() + '</strong> נקודות כדי לעקוף את <strong>' + escapeHtml(aboveName || 'הבא בתור') + '</strong>' +
            '</div>';
        }
      } else if (myScore && myRank === 1) {
        nextTargetHtml = '<div class="board-lb-next-target board-lb-next-target-king">👑 אתה המוביל! · המקום השני: ' + (list[1] ? list[1].score.toLocaleString() : '—') + '</div>';
      }
      var totalHtml = '<div class="board-lb-total">סה״כ ' + total + ' שחקנים · המוביל: ' + (leaderScore || 0).toLocaleString() + '</div>';
      body.innerHTML = totalHtml + nextTargetHtml + '<div class="board-lb-list">' + rows + myRankHtml + '</div>';
    }
    function load() {
      var url = '/api/boards/' + board.id + '/leaderboard?limit=50' + (deviceId ? '&deviceId=' + encodeURIComponent(deviceId) : '');
      fetch(url, { cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; })
        .then(function(d) { paint(d); });
    }
    load();
    // 30s live refresh while open. Cleared in closeBoardLeaderboard.
    _boardLbRefreshHandle = setInterval(load, 30 * 1000);
  }
  window.showBoardLeaderboard = showBoardLeaderboard;
  window.closeBoardLeaderboard = closeBoardLeaderboard;

  function startDynamicBoard(board) {
    if (!board || !board.definition) return;
    closeDynamicBoardsPicker();
    if (board.type === 'multipliers' && Array.isArray(board.definition.multipliers)) {
      setColumnMultipliers(board.definition.multipliers);
    } else {
      setColumnMultipliers(null);
    }
    window._activeDynamicBoard = board;
    if (typeof hideHomeV2 === 'function') hideHomeV2();
    if (typeof hideHome === 'function') hideHome();
    ensureAudio();
    init('dynamic', { fresh: true });
    playMusic('game');
    if (typeof startEventSystem === 'function') startEventSystem();
  }

  // When the player leaves dynamic mode (back to home, switching to
  // contest, etc.), clear the multiplier so the next non-dynamic game
  // is vanilla.
  function clearDynamicBoardSession() {
    setColumnMultipliers(null);
    window._activeDynamicBoard = null;
  }

  window.showDynamicBoardsPicker  = showDynamicBoardsPicker;
  window.closeDynamicBoardsPicker = closeDynamicBoardsPicker;
  window.clearDynamicBoardSession = clearDynamicBoardSession;

  // ============================================================
  // showSpecialBoardToast — fired by init() when a board (daily /
  // practice / duel / dynamic) is active for this session. The "wow"
  // moment that turns a routine daily into "today is different!".
  // De-duped per board id so a quick replay doesn't spam.
  // ============================================================
  var _lastToastedBoardId = null;
  function showSpecialBoardToast(board) {
    if (!board) return;
    var boardKey = (board.id != null) ? board.id : (board.name || JSON.stringify(board.definition || {}));
    if (_lastToastedBoardId === boardKey) return;
    _lastToastedBoardId = boardKey;
    var mults = (board.definition && Array.isArray(board.definition.multipliers))
      ? board.definition.multipliers.map(function(m) {
          return '×' + (Number.isInteger(m) ? m : Number(m).toFixed(1));
        }).join(' · ')
      : '';
    // Clean up any prior banner with the same tag.
    document.querySelectorAll('.special-board-toast').forEach(function(el) { el.remove(); });
    var toast = document.createElement('div');
    toast.className = 'special-board-toast';
    toast.innerHTML =
      '<div class="sb-toast-icon">🎯</div>' +
      '<div class="sb-toast-body">' +
        '<div class="sb-toast-title">לוח מיוחד פעיל</div>' +
        '<div class="sb-toast-name">' + escapeHtml(board.name || 'לוח') + '</div>' +
        (mults ? '<div class="sb-toast-mults">' + mults + '</div>' : '') +
      '</div>';
    document.body.appendChild(toast);
    // Auto-remove after the slide-in + 3s display + fade.
    setTimeout(function() {
      toast.classList.add('sb-toast-out');
      setTimeout(function() { toast.remove(); }, 350);
    }, 3200);
    // Tap to dismiss early.
    toast.addEventListener('click', function() {
      toast.classList.add('sb-toast-out');
      setTimeout(function() { toast.remove(); }, 350);
    });
  }
  window.showSpecialBoardToast = showSpecialBoardToast;

  // Reset the toast dedup when leaving home/changing modes so the next
  // game can re-trigger. clearDynamicBoardSession already runs on home.
  var _origClear = clearDynamicBoardSession;
  clearDynamicBoardSession = function() {
    _lastToastedBoardId = null;
    return _origClear.apply(this, arguments);
  };
  window.clearDynamicBoardSession = clearDynamicBoardSession;
