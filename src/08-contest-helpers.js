  // ============ FRIENDS CONTEST HELPERS ============
  function setActiveContest(code) {
    const prev = activeContestCode;
    activeContestCode = code || null;
    if (code) localStorage.setItem(CONTEST_CODE_KEY, code);
    else localStorage.removeItem(CONTEST_CODE_KEY);
    // CRITICAL: when the code changes, drop the cached activeContestData.
    // Otherwise init('contest') reads the OLD contest's board_seed and the
    // new contest's game gets the previous contest's piece sequence.
    if (prev !== activeContestCode) activeContestData = null;
    // The list of contests-I'm-in may have changed (joined/created/left)
    invalidateMyContestsCache();
  }

  function getPlayerName() {
    // Real chosen name if set; otherwise the code-based default ("KDPF") so
    // the displayed identity always matches the BLOOM-XXXX code. The
    // hasRealPlayerName() check (NAME_KEY non-empty) stays the discriminator
    // for "did they pick a real name", so onboarding nudges are unaffected.
    var n = (localStorage.getItem(NAME_KEY) || '').trim();
    return n || ((typeof defaultPlayerName === 'function') ? defaultPlayerName(deviceId) : '');
  }

  function setPlayerName(name) {
    if (name) localStorage.setItem(NAME_KEY, String(name).trim().slice(0, 50));
  }

  // Per-contest display names — a player may want different identities in
  // different contests ("סבא משה" at home, "המנהל" at the office). The
  // global name still acts as the default for new contests.
  const CONTEST_NAME_KEY_PREFIX = 'bloom_contest_name_';
  function getContestDisplayName(code) {
    if (!code) return getPlayerName();
    try {
      const name = localStorage.getItem(CONTEST_NAME_KEY_PREFIX + code);
      return (name && name.trim()) || getPlayerName();
    } catch (e) { return getPlayerName(); }
  }
  function setContestDisplayName(code, name) {
    if (!code || !name) return;
    try {
      localStorage.setItem(CONTEST_NAME_KEY_PREFIX + code, String(name).trim().slice(0, 50));
    } catch (e) {}
  }
  function clearContestDisplayName(code) {
    if (!code) return;
    try { localStorage.removeItem(CONTEST_NAME_KEY_PREFIX + code); } catch (e) {}
  }

  async function fetchMyContests(opts) {
    opts = opts || {};
    const fresh = !!opts.fresh;
    if (!fresh && myContestsCache && (Date.now() - myContestsCacheTs) < MY_CONTESTS_CACHE_TTL_MS) {
      return myContestsCache;
    }
    try {
      const url = API_BASE + '/api/contests/mine?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return myContestsCache;
      const data = await res.json();
      myContestsCache = (data && data.contests) || [];
      myContestsCacheTs = Date.now();
      return myContestsCache;
    } catch (e) {
      console.warn('fetchMyContests failed', e);
      return myContestsCache;
    }
  }
  function myContestsCountSync() {
    return myContestsCache ? myContestsCache.length : 0;
  }
  function invalidateMyContestsCache() {
    myContestsCache = null; myContestsCacheTs = 0;
  }

  async function fetchContest(code) {
    try {
      const url = API_BASE + '/api/contests/' + encodeURIComponent(code) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('fetchContest failed', e);
      return null;
    }
  }

  async function submitContestScore(code, scoreValue, tierValue) {
    try {
      const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(code) + '/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          token: deviceToken,
          displayName: getContestDisplayName(code) || 'אנונימי',
          score: scoreValue,
          tier: tierValue
        })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('submitContestScore failed', e);
      return null;
    }
  }

  function buildContestShareLink(code) {
    // Funnel through the universal share-URL builder so the host's
    // BLOOM-XXXX code rides along as ?ref= alongside the contest code.
    // Invitees who tap the link both JOIN the contest AND get attributed
    // to the host's referral counter — double K-factor lever.
    if (typeof window.__bloomBuildShareUrl === 'function') {
      return window.__bloomBuildShareUrl('/', { c: code });
    }
    const origin = window.location.origin + window.location.pathname;
    return origin + '?c=' + encodeURIComponent(code);
  }

  function saveContestGameState() {
    // Save to the contest the IN-MEMORY game state actually belongs to —
    // NOT to whatever activeContestCode currently is. Otherwise switching
    // contests via the My Contests list (which mutates activeContestCode
    // without resetting the grid) would write the previous contest's mid-game
    // state into the new contest's localStorage slot.
    const targetCode = activeGameContestCode || activeContestCode;
    if (mode !== 'contest' || !targetCode || !grid) return;
    // Don't save a fresh board (nothing on it yet)
    const hasPiece = grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (!hasPiece && (score | 0) === 0) {
      clearContestGameState(targetCode);
      return;
    }
    try {
      localStorage.setItem(contestStateKey(targetCode), JSON.stringify({
        code: targetCode,
        grid: grid,
        score: score | 0,
        highestTier: highestTier | 0,
        nextPiece: nextPiece,
        maxChain: currentGameMaxChain | 0,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function loadContestGameState(code) {
    if (!code) return null;
    try {
      let raw = localStorage.getItem(contestStateKey(code));
      // Migration: prior versions used a single key for the (only) active contest's state
      if (!raw) {
        const legacy = localStorage.getItem(CONTEST_STATE_KEY);
        if (legacy) {
          try {
            const s = JSON.parse(legacy);
            if (s && s.code === code) {
              raw = legacy;
              localStorage.setItem(contestStateKey(code), legacy);
            }
          } catch (e) {}
          localStorage.removeItem(CONTEST_STATE_KEY);
        }
      }
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.code !== code) return null;
      if (Date.now() - (s.ts || 0) > CONTEST_STATE_TTL_MS) return null;
      if (!Array.isArray(s.grid) || s.grid.length !== getBoardRows()) return null;
      return s;
    } catch (e) { return null; }
  }
  function clearContestGameState(code) {
    const target = code || activeContestCode;
    try {
      if (target) localStorage.removeItem(contestStateKey(target));
      // Also wipe the legacy single key so it can't shadow a future load
      localStorage.removeItem(CONTEST_STATE_KEY);
    } catch (e) {}
  }

  // Used by the home-screen hero card to surface "you have a paused
  // game in contest X — tap to resume". Scans localStorage for every
  // saved contest state and returns the freshest one (or null). Also
  // garbage-collects entries that have expired the TTL or that point
  // to a contest the player has since left.
  function findPausedContestGame() {
    try {
      const all = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(CONTEST_STATE_KEY_PREFIX) !== 0) continue;
        let s;
        try { s = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { continue; }
        if (!s || !s.code || !Array.isArray(s.grid)) continue;
        if (Date.now() - (s.ts || 0) > CONTEST_STATE_TTL_MS) {
          // GC stale entries opportunistically — we're already iterating
          try { localStorage.removeItem(k); } catch (e) {}
          continue;
        }
        // Must have actual progress (a piece on the board OR a score > 0).
        const hasPiece = s.grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
        if (!hasPiece && (s.score | 0) === 0) continue;
        all.push(s);
      }
      if (!all.length) return null;
      all.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      // Best-effort: attach the contest name from cached list (if any)
      const top = all[0];
      try {
        const cache = JSON.parse(localStorage.getItem('bloom_my_contests_cache') || 'null');
        if (cache && Array.isArray(cache.list)) {
          const match = cache.list.find(function(c) { return c.code === top.code; });
          if (match && match.name) top.contestName = match.name;
        }
      } catch (e) {}
      return top;
    } catch (e) { return null; }
  }

  // ============ PRACTICE STATE SAVE/RESTORE ============
  // Mirrors the contest state pattern so switching tabs mid-game doesn't
  // lose the player's board. TTL: 1 hour (practice is low-stakes).
  const PRACTICE_STATE_KEY = 'bloom_practice_state';
  const PRACTICE_STATE_TTL_MS = 60 * 60 * 1000;

  function savePracticeGameState() {
    if (mode !== 'practice' || !grid || skinTrialMode) return;
    const hasPiece = grid.some(function(row) { return row.some(function(c) { return c > 0; }); });
    if (!hasPiece && (score | 0) === 0) { clearPracticeGameState(); return; }
    try {
      localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify({
        grid: grid,
        score: score | 0,
        highestTier: highestTier | 0,
        nextPiece: nextPiece,
        maxChain: currentGameMaxChain | 0,
        drops: dropsCount | 0,
        mergesPerTier: gameMergesPerTier,
        pointsPerTier: gamePointsPerTier,
        totalMerges: gameTotalMerges,
        startTime: gameStartTime,
        usedContinue: usedContinue,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function loadPracticeGameState() {
    try {
      const raw = localStorage.getItem(PRACTICE_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.grid) || s.grid.length !== getBoardRows()) return null;
      if (Date.now() - (s.ts || 0) > PRACTICE_STATE_TTL_MS) return null;
      return s;
    } catch (e) { return null; }
  }
  function clearPracticeGameState() {
    try { localStorage.removeItem(PRACTICE_STATE_KEY); } catch (e) {}
  }

  function formatTimeLeft(endsAt) {
    const ms = new Date(endsAt) - new Date();
    if (ms <= 0) return 'הסתיים';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return days + ' ימים';
    if (hours > 0) return hours + ' שעות';
    return 'פחות משעה';
  }

  // ================================================================
  // ONBOARDING COACH — 3 progressive toasts on a brand-new player's
  // first game. Each step persists in localStorage so it never repeats.
  // The toasts are pinned to grid-wrap, dismissable, auto-fade after 6s.
  // ================================================================

  function dismissCoach() {
    const t = document.querySelector('.coach-toast');
    if (t) t.remove();
    const a = document.querySelector('.coach-arrow');
    if (a) a.remove();
  }

  function showCoach(step, title, body, opts) {
    // Don't pile multiple toasts.
    dismissCoach();
    const wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    opts = opts || {};
    const t = document.createElement('div');
    t.className = 'coach-toast';
    t.innerHTML =
      '<div class="coach-title">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>' +
        'BLOOM · שלב ' + step + ' מתוך 3' +
      '</div>' +
      escapeHtml(title) + '<br>' +
      '<span style="font-weight:500;color:#D6D5D1">' + escapeHtml(body) + '</span>' +
      (opts.dismiss !== false ? '<br><button class="coach-dismiss" id="coach-dismiss">הבנתי →</button>' : '');
    wrap.appendChild(t);
    const btn = document.getElementById('coach-dismiss');
    if (btn) btn.onclick = function() { dismissCoach(); };
    // Optional: a pointer arrow over a specific column.
    if (opts.arrowCol != null) {
      const arrow = document.createElement('div');
      arrow.className = 'coach-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22L4 12h5V2h6v10h5z"/></svg>';
      // Position over the chosen column (0-indexed, right-to-left since RTL but grid is LTR).
      // grid-wrap has padding 12px + 5px gap; each cell ~ (w - 24 - 15) / 4.
      const c = opts.arrowCol | 0;
      arrow.style.bottom = '24px';
      arrow.style.left   = 'calc(' + (12 + (c + 0.5) * 25) + '% - 18px)';
      // Use a CSS calc on percentage approximated via the grid columns.
      arrow.style.left = 'calc(12px + ' + ((c + 0.5) * 100 / 4) + '% - 18px - 12px)';
      wrap.appendChild(arrow);
    }
  }

  // Hooks called at key moments — they no-op if onboarding is already past.
  function maybeOnboardStep1() {
    if (getOnboardStep() >= 1) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    // Show after the grid renders. setTimeout makes it appear smoothly.
    setTimeout(function() {
      showCoach(1,
        'הקש על עמודה כדי להפיל את החלק',
        'החלק "הבא" (מסומן בסולם למעלה) ייפול לעמודה שתבחר.',
        { arrowCol: 1 });
      setOnboardStep(1);
    }, 350);
  }
  function maybeOnboardStep2() {
    if (getOnboardStep() >= 2) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    showCoach(2,
      'צרף 2 שווים → מיזוג + ניקוד',
      'אריחים אנכיים או אופקיים מאותו סוג מתמזגים לדרגה הבאה.');
    setOnboardStep(2);
  }
  function maybeOnboardStep3() {
    if (getOnboardStep() >= 3) return;
    if (mode !== 'daily' && mode !== 'practice') return;
    showCoach(3,
      'יפה! שרשרת = ניקוד גבוה יותר',
      'מיזוג שגורר מיזוג נוסף = שרשרת. תוכל לשרשר 5? היעד: כתר 👑.');
    setOnboardStep(3);
  }

  // ================================================================
  // BLOOM CHALLENGES (state + fetch helpers + screens)
  // ================================================================
  // Public single-shot prize contests. Distinct from Friends Contests in that:
  // - One attempt per device per challenge (server-enforced via PK).
  // - No reset, no pause, no game-state save. Closing the tab = forfeit.
  // - Score posts to /score on every drop; the server's score-only-grows
  //   guard means a closed tab still has a meaningful final score.

  let challengesCache = null;          // most recent /api/challenges payload
  let challengesCacheTs = 0;
  const CHALLENGES_CACHE_TTL_MS = 30 * 1000;
  let activeChallenge = null;          // { slug, name, prizeText, thresholdScore, thresholdTier, type, winnersCount, isWinner, winnerRank, drops }
  const CHALLENGE_DROPS_KEY_PREFIX = 'bloom_challenge_drops_';

  function challengeDropsKey(slug) { return CHALLENGE_DROPS_KEY_PREFIX + slug; }
  function readChallengeDrops(slug) {
    try { return parseInt(localStorage.getItem(challengeDropsKey(slug)) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function writeChallengeDrops(slug, n) {
    try { localStorage.setItem(challengeDropsKey(slug), String(n | 0)); } catch (e) {}
  }
  function clearChallengeDrops(slug) {
    try { localStorage.removeItem(challengeDropsKey(slug)); } catch (e) {}
  }

  async function fetchChallenges(opts) {
    opts = opts || {};
    if (!opts.fresh && challengesCache && (Date.now() - challengesCacheTs) < CHALLENGES_CACHE_TTL_MS) {
      return challengesCache;
    }
    try {
      const url = API_BASE + '/api/challenges?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return challengesCache;
      const data = await res.json();
      challengesCache = (data && data.challenges) || [];
      challengesCacheTs = Date.now();
      return challengesCache;
    } catch (e) { return challengesCache; }
  }

  async function fetchChallenge(slug) {
    try {
      const url = API_BASE + '/api/challenges/' + encodeURIComponent(slug) + '?deviceId=' + encodeURIComponent(deviceId);
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function challengeTypeLabel(c) {
    const t = c.challengeType;
    if (t === 'race')          return 'מרוץ ל-' + (c.thresholdScore || 0).toLocaleString();
    if (t === 'top_n')         return 'Top ' + (c.winnersCount || 1);
    if (t === 'beat')          return 'עבור ' + (c.thresholdScore || 0).toLocaleString();
    if (t === 'first_to_tier' && getActiveTiers()[c.thresholdTier|0]) return 'ראשון ל-' + getActiveTiers()[c.thresholdTier|0].name;
    if (t === 'first_to_tier') return 'ראשון לדרגה ' + (c.thresholdTier || '?');
    return t;
  }

  function challengeTimeLeft(endsAt) {
    const ms = new Date(endsAt) - new Date();
    if (ms <= 0) return 'הסתיים';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return days + ' ימים';
    if (hours > 0) return hours + ' שעות';
    if (minutes > 0) return minutes + ' דקות';
    return 'פחות מדקה';
  }

  // Personal-stats chip — visible only if the returning player has played
  // at least one game. Pulls from localStorage lifetime values + best score.
  function refreshHomeMyStats() {
    const host = document.getElementById('home-mystats-host');
    if (host) host.innerHTML = ''; // keep home clean
    const bubble = document.getElementById('home-stats-bubble');
    if (!bubble) return;
    const bestScore  = parseInt(localStorage.getItem(BEST_KEY)        || '0', 10) || 0;
    const bestTier   = parseInt(localStorage.getItem(BEST_TIER_KEY)   || '0', 10) || 0;
    const totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    if (bestScore <= 0 && totalGames <= 0) { bubble.innerHTML = ''; return; }
    const playerNm = (getPlayerName() || '').trim();
    const tierName = (getActiveTiers()[bestTier] && getActiveTiers()[bestTier].name) || '—';

    var totalMs = loadLifetimeInt(TOTAL_PLAY_TIME_KEY);
    if (totalMs < 60000 && totalGames > 0) {
      totalMs = totalGames * 180000;
      try { localStorage.setItem(TOTAL_PLAY_TIME_KEY, String(totalMs)); } catch(e) {}
    }
    var h = Math.floor(totalMs / 3600000);
    var m = Math.floor((totalMs % 3600000) / 60000);
    var timeText = totalMs >= 60000 ? (h > 0 ? h + ' שעות ו-' + m + ' דק\'' : m + ' דקות') : '';
    var level = playerLevel > 1 ? getLevelIcon() + ' Lv.' + playerLevel + ' ' + playerLevelTitle : '';

    bubble.innerHTML =
      '<div class="hsb-arrow"></div>' +
      '<div class="hsb-header">' +
        renderAvatarHtml(deviceId, 'sm') +
        '<strong>' + (playerNm ? escapeHtml(playerNm) : 'שחקן') + '</strong>' +
        (level ? '<span class="hsb-level">' + level + '</span>' : '') +
      '</div>' +
      (playerCode ? '<div class="hsb-code">' + playerCode + (playerBalance > 0 ? ' · <span class="hsb-balance">' + playerBalance + ' 💎</span>' : '') + '</div>' : '') +
      '<div class="hsb-grid">' +
        '<div class="hsb-cell"><div class="hsb-val">' + bestScore.toLocaleString() + '</div><div class="hsb-lbl">🏆 שיא</div></div>' +
        '<div class="hsb-cell"><div class="hsb-val">' + escapeHtml(tierName) + '</div><div class="hsb-lbl">דרגה</div></div>' +
        '<div class="hsb-cell"><div class="hsb-val">' + totalGames + '</div><div class="hsb-lbl">משחקים</div></div>' +
        (timeText ? '<div class="hsb-cell"><div class="hsb-val">' + timeText + '</div><div class="hsb-lbl">🕐 זמן</div></div>' : '') +
      '</div>' +
      '<button class="hsb-share" id="hsb-share-btn">📤 שתף את הפרופיל</button>' +
      (playerCode ? '<a href="/player/' + playerCode + '" target="_blank" style="display:block;text-align:center;font-size:11px;color:#6F6E68;margin-top:6px;text-decoration:underline">צפה בפרופיל הציבורי</a>' : '');

    document.getElementById('hsb-share-btn').onclick = function(e) {
      e.stopPropagation();
      var text = '🌸 BLOOM — ' + (playerNm || 'שחקן') + '\n' +
        '🏆 שיא: ' + bestScore.toLocaleString() + ' · ' + tierName + '\n' +
        '🎮 ' + totalGames + ' משחקים' + (timeText ? ' · 🕐 ' + timeText : '') + '\n' +
        (level ? level + '\n' : '') +
        '\nשחק גם: ' + getShareLink();
      if (navigator.share) navigator.share({ text: text }).catch(function(){});
      else if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        this.textContent = '✓ הועתק!';
        var btn = this;
        setTimeout(function() { btn.textContent = '📤 שתף את הפרופיל'; }, 1500);
      }
    };
  }

  // Social-proof line under the primary CTA. Pulls from the existing
  // /api/leaderboard/:date endpoint — one extra GET per home-visit.
  async function refreshHomeSocialProof() {
    const el = document.getElementById('home-social');
    if (!el) return;
    try {
      const res = await fetch(API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate));
      if (!res.ok) return;
      const data = await res.json();
      const total = (data && data.total) | 0;
      const list = (data && data.list) || [];
      if (total === 0) {
        el.innerHTML = '<span class="live-dot"></span> אתה הראשון היום — תהיה בראש הלוח';
      } else {
        var medals = ['🥇','🥈','🥉'];
        var html = '<span class="live-dot"></span> ' + '<strong>' + total + '</strong> שיחקו היום';
        if (list.length > 0) {
          html += '<div class="home-mini-lb">';
          for (var i = 0; i < Math.min(3, list.length); i++) {
            var p = list[i];
            var isMe = p.device_id === deviceId;
            html += '<div class="mini-lb-row' + (isMe ? ' mini-lb-me' : '') + '">' +
              '<span class="mini-lb-medal">' + medals[i] + '</span>' +
              '<span class="mini-lb-name">' + escapeHtml(p.name || 'אנונימי') + '</span>' +
              '<span class="mini-lb-score">' + (p.score | 0).toLocaleString() + '</span>' +
            '</div>';
          }
          html += '</div>';
        }
        el.innerHTML = html;
      }
    } catch (e) {}
  }

  async function refreshHomeJackpot() {
    var el = document.getElementById('home-jackpot');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/jackpot/today');
      var d = await r.json();
      if (!d || !d.enabled || (d.pool | 0) === 0) { el.innerHTML = ''; return; }
      el.innerHTML = '🎰 קופת הג\'קפוט היומי: <span class="jp-pool">' + (d.pool | 0) + ' 💎</span>' +
        '<br><span style="font-size:11px;font-weight:400">' + (d.entries | 0) + ' משתתפים · הזוכים מקבלים בחצות</span>';
    } catch (e) { el.innerHTML = ''; }
  }

  // ── Daily Login Reward ──
  var DAILY_LOGIN_KEY = 'bloom_daily_login';

  function getDailyLoginState() {
    try {
      var raw = localStorage.getItem(DAILY_LOGIN_KEY);
      if (!raw) return { lastClaimed: null, claimed: false };
      return JSON.parse(raw);
    } catch (e) { return { lastClaimed: null, claimed: false }; }
  }

  function hasDailyLoginReward() {
    var state = getDailyLoginState();
    var today = todayInIsrael();
    return state.lastClaimed !== today;
  }

  function getDailyRewardAmount(streakDay) {
    // Escalating visual display — actual server reward is from game_config
    if (streakDay >= 30) return 200;
    if (streakDay >= 7) return 100;
    if (streakDay >= 3) return 50;
    return 25;
  }

  // Stage 14 — render the multiplier breakdown inside the daily login
  // overlay. Shows EARNED multipliers (with green ✓) AND LOCKED ones
  // (greyed with "🔒 do X to unlock") so the player sees the path to
  // more rewards next time. The actual amount is computed server-side;
  // this is purely the visualization layer.
  function renderDailyLoginBreakdown(overlay, displayStreak) {
    if (!overlay) return;
    var host = overlay.querySelector('.daily-reward-card');
    if (!host) return;
    if (overlay.querySelector('.dr-breakdown')) return;
    // Pull current state from the cached helpers.
    var dynSt = (typeof getDynamicStreak === 'function') ? getDynamicStreak() : null;
    var dynStreakN = (dynSt && dynSt.count) | 0;
    var fc = (typeof getCachedFriends === 'function') ? getCachedFriends() : null;
    var friendActiveToday = !!(fc && fc.friends && fc.friends.some(function(f) { return f.playedToday; }));
    // Read multiplier configs from gameConfig.
    var dynPct = 25, dynMin = 3, friendPct = 20;
    try {
      if (typeof gameConfig === 'object' && gameConfig) {
        dynPct = parseInt(gameConfig.daily_login_mult_dyn_streak_pct, 10) || 25;
        dynMin = parseInt(gameConfig.daily_login_mult_dyn_streak_min, 10) || 3;
        friendPct = parseInt(gameConfig.daily_login_mult_friend_shared_pct, 10) || 20;
      }
    } catch (e) {}
    // Determine which streak tier the daily-login bonus is at.
    var streakTier = displayStreak >= 30 ? '30+ ימים' :
                     displayStreak >= 7 ? '7+ ימים' :
                     displayStreak >= 3 ? '3+ ימים' : 'מתחיל';
    var streakMult = displayStreak >= 30 ? '×4' :
                     displayStreak >= 7 ? '×3' :
                     displayStreak >= 3 ? '×2' : '×1';
    var rows = '';
    // Row 1: streak tier (always shown).
    rows += '<div class="dr-mult-row dr-mult-row-active">' +
      '<span class="dr-mult-row-icon">🔥</span>' +
      '<span class="dr-mult-row-label">רצף יומי · ' + streakTier + '</span>' +
      '<span class="dr-mult-row-factor">' + streakMult + '</span>' +
    '</div>';
    // Row 2: dynamic-board streak.
    if (dynStreakN >= dynMin) {
      rows += '<div class="dr-mult-row dr-mult-row-active">' +
        '<span class="dr-mult-row-icon">🎯</span>' +
        '<span class="dr-mult-row-label">רצף לוחות דינמיים · ' + dynStreakN + ' ימים</span>' +
        '<span class="dr-mult-row-factor">+' + dynPct + '%</span>' +
      '</div>';
    } else {
      var needDays = Math.max(1, dynMin - dynStreakN);
      rows += '<div class="dr-mult-row dr-mult-row-locked">' +
        '<span class="dr-mult-row-icon">🎯</span>' +
        '<span class="dr-mult-row-label">רצף לוחות דינמיים · עוד ' + needDays + ' ימים</span>' +
        '<span class="dr-mult-row-factor">+' + dynPct + '%</span>' +
      '</div>';
    }
    // Row 3: friend shared yesterday.
    if (friendActiveToday) {
      rows += '<div class="dr-mult-row dr-mult-row-active">' +
        '<span class="dr-mult-row-icon">👥</span>' +
        '<span class="dr-mult-row-label">חבר שיחק היום</span>' +
        '<span class="dr-mult-row-factor">+' + friendPct + '%</span>' +
      '</div>';
    } else if (fc && fc.friends && fc.friends.length > 0) {
      rows += '<div class="dr-mult-row dr-mult-row-locked">' +
        '<span class="dr-mult-row-icon">👥</span>' +
        '<span class="dr-mult-row-label">בקש מחבר לשחק היום</span>' +
        '<span class="dr-mult-row-factor">+' + friendPct + '%</span>' +
      '</div>';
    } else {
      // No friends yet — show invite hint.
      rows += '<div class="dr-mult-row dr-mult-row-locked dr-mult-row-cta">' +
        '<span class="dr-mult-row-icon">👥</span>' +
        '<span class="dr-mult-row-label">הזמן חבר → בכל יום ששניכם תשחקו</span>' +
        '<span class="dr-mult-row-factor">+' + friendPct + '%</span>' +
      '</div>';
    }
    // Insert before the claim button so the breakdown sits below the reward number.
    var claimBtn = host.querySelector('#dr-claim');
    if (!claimBtn) return;
    var wrap = document.createElement('div');
    wrap.className = 'dr-breakdown';
    wrap.innerHTML = '<div class="dr-breakdown-title">מה מרכיב את הבונוס</div>' + rows;
    host.insertBefore(wrap, claimBtn);
  }
  window.renderDailyLoginBreakdown = renderDailyLoginBreakdown;

  function showDailyLoginReward() {
    if (!hasDailyLoginReward()) return;
    if (document.getElementById('daily-reward-overlay')) return;
    // Don't show to brand new players (no games played yet)
    var totalGames = parseInt(localStorage.getItem(GAMES_COUNT_KEY) || '0', 10) || 0;
    if (totalGames === 0) return;

    var s = loadStreak();
    var today = todayInIsrael();
    var streakN = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) streakN = 0;
    // If they played today already, streak was bumped; if not, show what it WILL be
    var displayStreak = streakN > 0 ? streakN : 1;
    var displayReward = getDailyRewardAmount(displayStreak);

    var emoji = displayStreak >= 7 ? '🎉' : displayStreak >= 3 ? '🔥' : '🎁';
    var streakMsg = displayStreak >= 7 ? 'שבוע שלם ברצף! 💪'
      : displayStreak >= 3 ? displayStreak + ' ימים ברצף!'
      : displayStreak > 1 ? 'יום ' + displayStreak + ' ברצף'
      : 'ברוך שובך!';

    var tomorrowReward = getDailyRewardAmount(displayStreak + 1);
    var tomorrowExtra = tomorrowReward > displayReward ? ' (x' + Math.round(tomorrowReward / 25) + '!)' : '';

    // The server now applies tiered config keyed by streak (see
    // /api/player/earn for action='daily_login'). gameConfig is fetched at
    // boot, so we can pick the matching key locally without a round trip.
    // Final number on the slot reel = max(display tier, server tier) so a
    // generous admin tweak surfaces in the UI and a misconfig can never
    // undercut what the overlay teased.
    var resolvedReward = displayReward;
    try {
      if (typeof gameConfig === 'object' && gameConfig) {
        var srvKey = displayStreak >= 30 ? 'daily_login_reward_streak_30'
                   : displayStreak >= 7  ? 'daily_login_reward_streak_7'
                   : displayStreak >= 3  ? 'daily_login_reward_streak_3'
                   : 'daily_login_reward';
        var srvVal = parseInt(gameConfig[srvKey], 10) || 0;
        if (srvVal > 0) resolvedReward = Math.max(displayReward, srvVal);
      }
    } catch (e) {}

    var overlay = document.createElement('div');
    overlay.id = 'daily-reward-overlay';
    overlay.className = 'daily-reward-overlay';
    overlay.innerHTML =
      '<div class="daily-reward-card">' +
        '<button class="dr-close" id="dr-close">✕</button>' +
        '<div class="dr-emoji">' + emoji + '</div>' +
        '<div class="dr-title">בונוס יומי!</div>' +
        '<div class="dr-streak"><strong>' + streakMsg + '</strong></div>' +
        // §1.7 — Variable-reward slot animation. The actual payout is
        // deterministic (rises with streak length), but the *experience*
        // of seeing the number spin and land turns a flat "+25💎" into
        // an event. The reel starts blurred and fast, decelerates over
        // ~1.4s, and snaps to the true reward with a soundMilestone +
        // scale-up landing animation.
        '<div class="dr-reward dr-reward-spinning" id="dr-reward-num">+??? 💎</div>' +
        '<button class="dr-claim-btn" id="dr-claim">אסוף בונוס</button>' +
        '<div class="dr-tomorrow">חזור מחר ל-<strong>' + tomorrowReward + ' 💎' + tomorrowExtra + '</strong></div>' +
      '</div>';
    document.body.appendChild(overlay);

    // §1.7 reel: cycle random values, slowing down with each iteration,
    // then snap to the real reward.
    (function runRewardReel() {
      var el = document.getElementById('dr-reward-num');
      if (!el) return;
      var ticks = 0;
      var maxTicks = 22;
      var delay = 50;
      // Sample values straddle the real reward so the reel doesn't
      // visually contradict the outcome.
      var low  = Math.max(5,  Math.floor(resolvedReward * 0.4));
      var high = Math.max(50, Math.floor(resolvedReward * 2.2));
      function tick() {
        if (!document.getElementById('dr-reward-num')) return;
        ticks++;
        if (ticks >= maxTicks) {
          el.textContent = '+' + resolvedReward + ' 💎';
          el.classList.remove('dr-reward-spinning');
          el.classList.add('dr-reward-landed');
          try { if (typeof soundMilestone === 'function') soundMilestone(Math.min(8, 3 + Math.floor(displayStreak / 3))); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([10, 30, 10]); } catch (e) {}
          return;
        }
        var fake = low + Math.floor(Math.random() * (high - low));
        el.textContent = '+' + fake + ' 💎';
        // Ease-out: each tick gets a bit slower
        delay = Math.min(180, delay + (ticks > maxTicks - 8 ? 18 : 4));
        setTimeout(tick, delay);
      }
      // Tiny initial delay so the overlay finishes its entrance animation
      // before the reel starts spinning.
      setTimeout(tick, 220);
    })();

    var claimed = false;
    function claim() {
      if (claimed) return;
      claimed = true;
      // Mark as claimed for today
      try { localStorage.setItem(DAILY_LOGIN_KEY, JSON.stringify({ lastClaimed: todayInIsrael() })); } catch(e) {}
      // Earn credits via server. Streak passes through so the server picks
      // the matching tier. Stage 14 — also pass dynStreak + friend-shared
      // flag so the server stacks multipliers on top of the base tier.
      var dynStreakForLogin = 0;
      try {
        var dynSt = (typeof getDynamicStreak === 'function') ? getDynamicStreak() : null;
        if (dynSt && dynSt.count >= 1) dynStreakForLogin = dynSt.count | 0;
      } catch (e) {}
      // Check if any friend played yesterday (the "shared-yesterday" bonus).
      // Conservative: only flag when we can prove from the cached friends
      // list that at least one friend played the day before.
      var friendSharedYesterdayFlag = false;
      try {
        var fc = (typeof getCachedFriends === 'function') ? getCachedFriends() : null;
        if (fc && Array.isArray(fc.friends)) {
          // V1: use "playedToday" as a proxy — if a friend has activity today,
          // we know they're active. The server enforces its own anti-cheat
          // bounds so we don't need to second-guess.
          friendSharedYesterdayFlag = fc.friends.some(function(f) { return f.playedToday; });
        }
      } catch (e) {}
      earnCredits('daily_login', {
        streak: displayStreak,
        dynStreak: dynStreakForLogin,
        friendSharedYesterday: friendSharedYesterdayFlag
      });
      // Animate out
      var card = overlay.querySelector('.daily-reward-card');
      if (card) {
        card.style.transition = 'transform 0.3s, opacity 0.3s';
        card.style.transform = 'scale(1.1)';
        card.style.opacity = '0';
      }
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(function() {
        overlay.style.opacity = '0';
        setTimeout(function() { overlay.remove(); }, 300);
      }, 200);
      trackEvent('daily_login_claimed', { streak: displayStreak, reward: resolvedReward });
    }

    document.getElementById('dr-claim').onclick = claim;
    // Render the multiplier breakdown row by row — see definition below.
    if (typeof renderDailyLoginBreakdown === 'function') {
      try { renderDailyLoginBreakdown(overlay, displayStreak); } catch (e) {}
    }
    document.getElementById('dr-close').onclick = function() {
      // Closing without claiming = still claim (they saw it)
      claim();
    };
    overlay.onclick = function(e) {
      if (e.target === overlay) claim();
    };
  }

  // ── Home: Streak hero badge ──
  function refreshHomeStreak() {
    var host = document.getElementById('home-streak-host');
    if (!host) return;
    var s = loadStreak();
    var today = todayInIsrael();
    var n = s.count | 0;
    if (s.lastPlayed && daysBetween(s.lastPlayed, today) > 1) n = 0;
    var bestStreak = parseInt(localStorage.getItem(BEST_STREAK_KEY) || '0', 10) || 0;
    if (n === 0 && bestStreak === 0) {
      host.innerHTML =
        '<div class="home-streak zero">' +
          '<span class="streak-fire">🔥</span>' +
          '<span class="streak-num">0</span>' +
          '<div class="streak-label">שחק היום ותתחיל <strong>רצף יומי!</strong></div>' +
        '</div>';
    } else if (n === 0) {
      host.innerHTML =
        '<div class="home-streak zero">' +
          '<span class="streak-fire">💔</span>' +
          '<span class="streak-num">0</span>' +
          '<div class="streak-label">הרצף נשבר! שיא: <strong>' + bestStreak + ' ימים</strong><br>שחק עכשיו להתחיל מחדש</div>' +
        '</div>';
    } else {
      var msg = n >= 30 ? '🏆 אלוף!' : n >= 7 ? '💪 שבוע שלם!' : n >= 3 ? '🔥 ממשיכים!' : 'חזור מחר!';
      host.innerHTML =
        '<div class="home-streak">' +
          '<span class="streak-fire">🔥</span>' +
          '<span class="streak-num">' + n + '</span>' +
          '<div class="streak-label"><strong>' + n + ' ימים ברצף</strong><br>' + msg + '</div>' +
        '</div>';
    }
  }

  // ── Home: Mini leaderboard — shows player rank if not in top 3 ──
  // The top-3 is already shown by refreshHomeSocialProof. This adds the
  // player's own rank row when they're ranked 4th or lower.
  async function refreshHomeMiniLb() {
    var host = document.getElementById('home-mini-lb-host');
    if (!host) return;
    try {
      var res = await fetch(API_BASE + '/api/leaderboard/' + encodeURIComponent(dailyDate) + '?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) return;
      var data = await res.json();
      var myRank = data.rank | 0;
      if (myRank <= 3 || myRank === 0) { host.innerHTML = ''; return; }
      var list = (data && data.list) || [];
      var myEntry = list.find(function(p) { return p.device_id === deviceId; });
      if (!myEntry) { host.innerHTML = ''; return; }
      host.innerHTML =
        '<div class="home-mini-lb">' +
          '<div class="home-mini-lb-row me">' +
            '<span class="home-mini-lb-rank" style="color:#6F6E68">#' + myRank + '</span>' +
            '<span class="home-mini-lb-name">' + escapeHtml(myEntry.name || 'אנונימי') + ' (את/ה)</span>' +
            '<span class="home-mini-lb-score">' + (myEntry.score | 0).toLocaleString() + '</span>' +
          '</div>' +
        '</div>';
    } catch (e) {}
  }

  // ── Home: Addiction badge (total play time) ──
  function refreshHomeAddiction() {
    var host = document.getElementById('home-addiction-host');
    if (!host) return;
    var totalMs = parseInt(localStorage.getItem(TOTAL_PLAY_TIME_KEY) || '0', 10) || 0;
    if (totalMs < 60000) { host.innerHTML = ''; return; }
    var totalHours = Math.floor(totalMs / 3600000);
    var totalMins = Math.floor((totalMs % 3600000) / 60000);
    var emoji, text;
    if (totalHours >= 10) { emoji = '🤯'; text = 'שיחקת <strong>' + totalHours + ' שעות ו-' + totalMins + ' דקות</strong> ב-BLOOM. אין עליך!'; }
    else if (totalHours >= 1) { emoji = '⏰'; text = 'כבר <strong>' + totalHours + ' שעות ו-' + totalMins + ' דקות</strong> ב-BLOOM!'; }
    else { emoji = '🕐'; text = '<strong>' + totalMins + ' דקות</strong> ב-BLOOM עד עכשיו'; }
    host.innerHTML =
      '<div class="home-addiction">' +
        '<span class="addiction-emoji">' + emoji + '</span>' +
        '<span>' + text + '</span>' +
      '</div>' +
      '<div class="home-addiction-share-row">' +
        '<button class="home-addiction-share-btn" id="home-addiction-share">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5L15.4 17.5M15.4 6.5L8.6 10.5"/></svg>' +
          'שתף התמכרות' +
        '</button>' +
        '<button class="home-addiction-share-btn home-addiction-share-wa" id="home-addiction-share-wa">' +
          '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
          'WhatsApp' +
        '</button>' +
      '</div>';
    var shareBtn = document.getElementById('home-addiction-share');
    if (shareBtn) shareBtn.onclick = function() { shareAddiction('share'); };
    var waBtn = document.getElementById('home-addiction-share-wa');
    if (waBtn) waBtn.onclick = function() { shareAddiction('whatsapp'); };
  }

  // ── Home: Weekly Challenge Banner ──
  async function refreshHomeWeekly() {
    var host = document.getElementById('home-weekly-host');
    if (!host) return;
    try {
      var res = await fetch(API_BASE + '/api/weekly?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) { host.innerHTML = ''; return; }
      var data = await res.json();
      if (!data || !data.weekly) { host.innerHTML = ''; return; }
      var w = data.weekly;
      var endsAt = new Date(w.endsAt);
      var now = new Date();
      var hoursLeft = Math.max(0, Math.round((endsAt - now) / 3600000));
      var timeLeft = hoursLeft >= 24 ? Math.ceil(hoursLeft / 24) + ' ימים' : hoursLeft + ' שעות';
      var statusText = w.joined
        ? 'הציון שלך: <strong>' + (w.myScore | 0).toLocaleString() + '</strong> · ' + (w.myGames || 0) + ' משחקים'
        : (w.players || 0) > 0
          ? '<strong>' + (w.players || 0) + '</strong> משתתפים · הצטרף עכשיו!'
          : 'היה הראשון להצטרף! 🏅';

      host.innerHTML =
        '<div class="home-weekly" id="home-weekly-btn">' +
          '<div class="home-weekly-title">🏆 ' + escapeHtml(w.name) + '</div>' +
          '<div class="home-weekly-prize">פרס: ' + (w.prize || 500) + ' 💎 · נגמר בעוד ' + timeLeft + '</div>' +
          '<div class="home-weekly-meta">' + statusText + '</div>' +
          '<span class="home-weekly-arrow">←</span>' +
        '</div>';

      var btn = document.getElementById('home-weekly-btn');
      if (btn) btn.onclick = function() {
        ensureAudio();
        if (mode === 'practice') savePracticeGameState();
        // Navigate to the weekly contest
        activeContestCode = w.code;
        try { localStorage.setItem('bloom_active_contest', w.code); } catch(e) {}
        hideHome();
        showContestLeaderboard(w.code);
      };
    } catch (e) { host.innerHTML = ''; }
  }

  function refreshHomeChallengeCta() {
    const btn = document.getElementById('home-challenge');
    if (!btn) return;
    fetchChallenges().then(function(list) {
      if (!list || !list.length) { btn.classList.remove('visible'); return; }
      btn.classList.add('visible');
      const lbl = document.getElementById('home-challenge-label');
      if (lbl) lbl.textContent = list.length === 1
        ? 'אתגר פרס פעיל — ' + list[0].prizeText
        : list.length + ' אתגרי פרס פעילים';
      btn.onclick = function() {
        ensureAudio();
        if (mode === 'practice') savePracticeGameState();
        showChallengesList('home');
      };
    });
  }

  function hideChallengeScreens() {
    const el = document.getElementById('challenge-screen');
    if (el) el.remove();
  }

  // Tracks where the user came from before opening the challenges hub, so the
  // back button routes intelligently: from the home screen → back home; from
  // a mid-game mode-tap → back into the game; from a contest screen → back
  // there. Set by EVERY entry point into showChallengesList().
  let challengeListEntryFrom = 'home';
  // Tabs state for the challenges hub.
  let challengeListTab = 'active';   // 'active' | 'history'
  let historyChallengesCache = null;
  let historyChallengesCacheTs = 0;
  const HISTORY_CACHE_TTL_MS = 60 * 1000;

  async function fetchHistoryChallenges(opts) {
    opts = opts || {};
    if (!opts.fresh && historyChallengesCache && (Date.now() - historyChallengesCacheTs) < HISTORY_CACHE_TTL_MS) {
      return historyChallengesCache;
    }
    try {
      const res = await fetch(API_BASE + '/api/challenges/history?deviceId=' + encodeURIComponent(deviceId));
      if (!res.ok) return historyChallengesCache;
      const data = await res.json();
      historyChallengesCache = (data && data.challenges) || [];
      historyChallengesCacheTs = Date.now();
      return historyChallengesCache;
    } catch (e) { return historyChallengesCache; }
  }

  function navigateBackFromChallenges() {
    hideChallengeScreens();
    if (challengeListEntryFrom === 'in-game') {
      // The player tapped the "אתגרים" mode tab from inside a game — go back
      // to the appropriate game screen for the current mode.
      if (mode === 'contest' && activeContestCode) {
        // Resume their saved contest game state.
        init('contest');
      } else if (mode === 'daily' || mode === 'practice') {
        init(mode);
      } else {
        showHome();
      }
    } else if (challengeListEntryFrom === 'contest-screen') {
      if (activeContestCode) showContestLeaderboard(activeContestCode);
      else showContestMenu();
    } else {
      showHome();
    }
  }

