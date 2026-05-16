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
    return localStorage.getItem(NAME_KEY) || '';
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

