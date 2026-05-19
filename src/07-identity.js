  function mulberry32(seed) {
    let s = seed >>> 0;
    return function() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function todayInIsrael() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
  }
  function formatDateHe(iso) {
    const parts = iso.split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }
  function msUntilNextIsraelMidnight() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = fmt.formatToParts(now).reduce(function(o,p){ o[p.type]=p.value; return o; }, {});
    const h = parseInt(parts.hour,10), m = parseInt(parts.minute,10), s = parseInt(parts.second,10);
    const elapsed = (h * 3600 + m * 60 + s) * 1000;
    return 24*3600*1000 - elapsed;
  }
  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }

  let grid, score, nextPiece, busy, highestTier, dropsCount;
  let mode = 'daily';
  let dailyDate = todayInIsrael();
  let rng = Math.random;
  let dailySubmitted = false;
  let dailyRank = null;
  let leaderboard = [];
  let leaderboardLoading = false;
  let countdownTimer = null;
  let best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  let playerName = localStorage.getItem(NAME_KEY) || '';

  // ============ FRIENDS CONTEST STATE ============
  const CONTEST_CODE_KEY = 'bloom_active_contest';
  const CONTEST_STATE_KEY = 'bloom_contest_game_state';        // legacy single-state key (kept for migration)
  const CONTEST_STATE_KEY_PREFIX = 'bloom_contest_state_';      // new per-contest scheme
  const CONTEST_STATE_TTL_MS = 24 * 60 * 60 * 1000;
  // Last final score we posted for this contest — used as the "score" we
  // show to the player we're now spectating, so they can see how far each
  // of their watchers got.
  const CONTEST_LAST_FINAL_PREFIX = 'bloom_contest_last_final_';
  function contestStateKey(code) { return CONTEST_STATE_KEY_PREFIX + code; }
  function getLastFinalScore(code) {
    if (!code) return 0;
    const raw = parseInt(localStorage.getItem(CONTEST_LAST_FINAL_PREFIX + code) || '0', 10);
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  function setLastFinalScore(code, value) {
    if (!code) return;
    try { localStorage.setItem(CONTEST_LAST_FINAL_PREFIX + code, String(Math.max(0, value | 0))); } catch (e) {}
  }
  let activeContestCode = localStorage.getItem(CONTEST_CODE_KEY) || null;
  let activeContestData = null;
  // Which contest the IN-MEMORY game state (grid/score/highestTier/nextPiece)
  // actually belongs to. Decoupled from `activeContestCode` so that switching
  // contests via the My Contests list does NOT cause the prior contest's
  // grid to be saved into the new contest's localStorage slot. Set to a
  // contest code when init('contest') restores/starts a game, cleared on
  // game-over or when leaving contest mode.
  let activeGameContestCode = null;
  let contestSubmitted = false;
  let contestRefreshTimer = null;
  let contestRefreshCode = null;
  let myContestsCache = null;        // last fetched /api/contests/mine result
  let myContestsCacheTs = 0;
  const MY_CONTESTS_CACHE_TTL_MS = 30 * 1000;  // refresh every 30s on demand

  // ============ LIVE CONTEST STATE (real-time score + spectators) ============
  // Demand-driven design: we only send the (heavier) grid frame when the
  // last server response said someone is actually watching. An idle contest
  // costs nothing beyond the existing 20s leaderboard poll.
  let liveScoreLastSentAt = 0;          // ms timestamp of last /live-score POST
  let liveScoreLastSentValue = -1;      // score value last sent (skip duplicates)
  let liveScoreFlushTimer = null;       // pending throttled flush
  let meHasWatchers = false;            // from /live-score response or leaderboard fetch
  let meWatchers = [];                  // [{name, lastScore}] — populated by leaderboard poll (every 20s)
  let meWatcherCount = 0;               // updated more frequently by /live-score response
  let audienceBadgeOpen = false;        // dropdown expanded?
  const LIVE_SCORE_MIN_INTERVAL_MS = 1000;
  let spectatorSession = null;          // { code, targetDeviceId, name, lastScore, pollTimer, heartbeatTimer, missCount, lastSnap }

  // ============ AVATAR ============
  // Stable per-deviceId emoji + color pair. The same player always gets the
  // same avatar across sessions; different players are visually distinct in
  // leaderboards even if their display names overlap. No PII, pure hash.
  const AVATAR_EMOJIS = [
    '🦁','🐯','🦊','🐺','🐻','🐼','🐰','🐹','🐮','🐷','🐸','🦉','🐢','🐬','🐙','🦋','🦄','🦖','🐳','🐝',
    '🌵','🌻','🌸','🌹','🍀','🍎','🍒','🍓','🥑','🍕','🌶','🌽','🥨','🍩','🌮','🍪','🌟','⚡','🔥','💎'
  ];
  const AVATAR_COLORS = [
    ['#FFE0B2', '#5D2E00'], ['#FFCDD2', '#5D1010'], ['#F8BBD0', '#5C1532'],
    ['#E1BEE7', '#3E1452'], ['#D1C4E9', '#23195C'], ['#C5CAE9', '#0F1B5C'],
    ['#BBDEFB', '#0D3D6D'], ['#B3E5FC', '#0F4A6D'], ['#B2EBF2', '#0E4F5C'],
    ['#B2DFDB', '#0F4F45'], ['#C8E6C9', '#194A1F'], ['#DCEDC8', '#324F11'],
    ['#FFF9C4', '#5C4A0E'], ['#FFE082', '#5C3D0E'], ['#FFCC80', '#5C2E0E']
  ];
  function avatarHash(deviceId) {
    let h = 2166136261 >>> 0;
    const s = String(deviceId || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function getAvatar(deviceId) {
    const h = avatarHash(deviceId);
    const emoji = AVATAR_EMOJIS[h % AVATAR_EMOJIS.length];
    const [bg, fg] = AVATAR_COLORS[(h >>> 8) % AVATAR_COLORS.length];
    return { emoji, bg, fg };
  }
  function renderAvatarHtml(deviceId, sizeClass) {
    const a = getAvatar(deviceId);
    return '<span class="avatar' + (sizeClass ? ' ' + sizeClass : '') +
      '" style="background:' + a.bg + ';color:' + a.fg + '">' + a.emoji + '</span>';
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
      else id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // ============ COUNTRY (for the country/world leaderboard tabs) ============
  // Player-chosen ISO-3166 alpha-2. Set once via the flag picker after the
  // name prompt, then sent with every score submission. Null = not chosen
  // (player skipped); those scores are excluded from the country tab.
  const COUNTRY_KEY = 'bloom_country';
  // Hebrew-labeled set covering ~95% of actual + plausible BLOOM players.
  // Add to the list rather than relying on locale APIs so the modal renders
  // identically on every browser (Safari iOS lacks Intl.DisplayNames in some
  // older builds, which would silently degrade to ISO codes).
  const COUNTRY_LIST = [
    ['IL', 'ישראל'], ['US', 'ארה״ב'], ['GB', 'בריטניה'], ['CA', 'קנדה'],
    ['DE', 'גרמניה'], ['FR', 'צרפת'], ['IT', 'איטליה'], ['ES', 'ספרד'],
    ['PT', 'פורטוגל'], ['NL', 'הולנד'], ['BE', 'בלגיה'], ['CH', 'שווייץ'],
    ['AT', 'אוסטריה'], ['SE', 'שוודיה'], ['NO', 'נורווגיה'], ['DK', 'דנמרק'],
    ['FI', 'פינלנד'], ['PL', 'פולין'], ['CZ', 'צ׳כיה'], ['HU', 'הונגריה'],
    ['RO', 'רומניה'], ['BG', 'בולגריה'], ['GR', 'יוון'], ['IE', 'אירלנד'],
    ['RU', 'רוסיה'], ['UA', 'אוקראינה'], ['TR', 'טורקיה'], ['EG', 'מצרים'],
    ['MA', 'מרוקו'], ['SA', 'ערב הסעודית'], ['AE', 'איחוד האמירויות'],
    ['JO', 'ירדן'], ['LB', 'לבנון'], ['ZA', 'דרום אפריקה'],
    ['AU', 'אוסטרליה'], ['NZ', 'ניו זילנד'], ['BR', 'ברזיל'],
    ['AR', 'ארגנטינה'], ['MX', 'מקסיקו'], ['CL', 'צ׳ילה'],
    ['JP', 'יפן'], ['KR', 'דרום קוריאה'], ['CN', 'סין'], ['HK', 'הונג קונג'],
    ['SG', 'סינגפור'], ['TH', 'תאילנד'], ['VN', 'וייטנאם'], ['ID', 'אינדונזיה'],
    ['PH', 'הפיליפינים'], ['MY', 'מלזיה'], ['IN', 'הודו'], ['PK', 'פקיסטן'],
    ['NG', 'ניגריה'], ['KE', 'קניה'], ['ET', 'אתיופיה']
  ];
  function countryName(cc) {
    if (!cc) return '';
    for (var i = 0; i < COUNTRY_LIST.length; i++) if (COUNTRY_LIST[i][0] === cc) return COUNTRY_LIST[i][1];
    return cc;
  }
  function flagEmoji(cc) {
    if (!cc || typeof cc !== 'string' || cc.length !== 2) return '🏳️';
    var s = cc.toUpperCase();
    try {
      return String.fromCodePoint(
        0x1F1E6 + (s.charCodeAt(0) - 65),
        0x1F1E6 + (s.charCodeAt(1) - 65)
      );
    } catch (e) { return '🏳️'; }
  }
  function getCountry() {
    var c = localStorage.getItem(COUNTRY_KEY) || '';
    return /^[A-Z]{2}$/.test(c) ? c : '';
  }
  function setCountry(cc) {
    var v = cc ? String(cc).toUpperCase().slice(0, 2) : '';
    if (v && !/^[A-Z]{2}$/.test(v)) v = '';
    try {
      if (v) localStorage.setItem(COUNTRY_KEY, v);
      else localStorage.removeItem(COUNTRY_KEY);
    } catch (e) {}
    // Fire-and-forget — server stores it on player_profiles so the v2
    // leaderboard can resolve the country tab even if the client forgets
    // to pass it explicitly later.
    try {
      fetch(API_BASE + '/api/profile/country', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, country: v || null })
      }).catch(function() {});
    } catch (e) {}
  }
  var playerCountry = getCountry();

  // Device token — HMAC proof that this deviceId was registered server-side.
  // Fetched once, stored forever. Sent with score submissions for anti-spoofing.
  const DEVICE_TOKEN_KEY = 'bloom_device_token';
  let deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY) || null;
  function ensureDeviceToken() {
    if (deviceToken) return;
    fetch(API_BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    }).then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.token) {
          deviceToken = data.token;
          try { localStorage.setItem(DEVICE_TOKEN_KEY, data.token); } catch (e) {}
        }
      }).catch(function() {});
  }
  ensureDeviceToken();

  // apiPost — POST helper that always injects deviceId + token so every
  // state-mutating request lands at the server with a verifiable identity.
  // Existing call sites that build their own body remain valid (server's
  // softDeviceAuth rejects only present-and-invalid tokens), but new code
  // should prefer this helper. Pass {raw: true} to skip auto-injection.
  function apiPost(path, body, opts) {
    const o = opts || {};
    const fullBody = (o.raw === true)
      ? (body || {})
      : Object.assign({}, body || {}, { deviceId: deviceId, token: deviceToken });
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullBody)
    });
  }

  // ============ PLAYER CODE (BLOOM-XXXX) + REFERRALS ============
  const PLAYER_CODE_KEY = 'bloom_player_code';
  const PLAYER_BALANCE_KEY = 'bloom_balance';
  const PLAYER_XP_KEY = 'bloom_xp';
  const PLAYER_LEVEL_KEY = 'bloom_level';
  const PLAYER_LEVEL_TITLE_KEY = 'bloom_level_title';
  let playerCode = localStorage.getItem(PLAYER_CODE_KEY) || null;
  let playerBalance = parseInt(localStorage.getItem(PLAYER_BALANCE_KEY) || '0', 10) || 0;
  let playerXp = parseInt(localStorage.getItem(PLAYER_XP_KEY) || '0', 10) || 0;
  let playerLevel = parseInt(localStorage.getItem(PLAYER_LEVEL_KEY) || '1', 10) || 1;
  let playerLevelTitle = localStorage.getItem(PLAYER_LEVEL_TITLE_KEY) || 'מתחיל';

  var LEVEL_ICONS = { 1: '🌱', 2: '🌱', 3: '🌿', 5: '😊', 8: '🎮', 10: '🎮', 15: '⭐', 20: '⭐', 30: '🔥', 50: '👑', 100: '💎' };
  function getLevelIcon() {
    var icon = '🌱';
    for (var k in LEVEL_ICONS) { if (playerLevel >= parseInt(k, 10)) icon = LEVEL_ICONS[k]; }
    return icon;
  }

  function fetchPlayerCode() {
    fetch(API_BASE + '/api/player/code?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.code) {
          playerCode = d.code;
          playerBalance = d.balance | 0;
          if (d.xp != null) playerXp = d.xp | 0;
          if (d.level) {
            playerLevel = d.level.level || 1;
            playerLevelTitle = d.level.title || 'מתחיל';
          }
          try {
            localStorage.setItem(PLAYER_CODE_KEY, d.code);
            localStorage.setItem(PLAYER_BALANCE_KEY, String(d.balance | 0));
            localStorage.setItem(PLAYER_XP_KEY, String(playerXp));
            localStorage.setItem(PLAYER_LEVEL_KEY, String(playerLevel));
            localStorage.setItem(PLAYER_LEVEL_TITLE_KEY, playerLevelTitle);
          } catch(e) {}
          updateBalanceDisplay();
          processReferral();
        }
      }).catch(function() {});
  }
  function processReferral() {
    var refCode = new URLSearchParams(window.location.search).get('ref');
    if (!refCode || refCode === playerCode) return;
    if (localStorage.getItem('bloom_ref_done')) return; // already processed
    fetch(API_BASE + '/api/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, refCode: refCode })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.ok) {
        localStorage.setItem('bloom_ref_done', '1');
        playerBalance += (d.referredReward || 0);
        try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      }
    }).catch(function() {});
  }
  fetchPlayerCode();
  function getShareLink() {
    return window.location.origin + (playerCode ? '/?ref=' + playerCode : '');
  }
  var _earnedThisSession = {};
  function earnCredits(action, meta) {
    // Client-side session dedup — except event_gift which can fire multiple times
    if (action !== 'event_gift') {
      var dedupKey = action + (meta ? ':' + JSON.stringify(meta) : '');
      if (_earnedThisSession[dedupKey]) return;
      _earnedThisSession[dedupKey] = true;
    }
    fetch(API_BASE + '/api/player/earn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, action: action, meta: meta || null })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.ok && d.reward > 0) {
        playerBalance = d.newBalance;
        try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
        showCreditToast(d.reward, action);
        // XP + Level
        if (d.xpGain) {
          playerXp = (d.level && d.level.xp) || (playerXp + d.xpGain);
          try { localStorage.setItem(PLAYER_XP_KEY, String(playerXp)); } catch(e) {}
        }
        if (d.level) {
          playerLevel = d.level.level || playerLevel;
          playerLevelTitle = d.level.title || playerLevelTitle;
          try { localStorage.setItem(PLAYER_LEVEL_KEY, String(playerLevel)); localStorage.setItem(PLAYER_LEVEL_TITLE_KEY, playerLevelTitle); } catch(e) {}
        }
        if (d.leveledUp) {
          showLevelUpToast(d.level);
        }
        updateBalanceDisplay();
      }
    }).catch(function() {});
  }
  function showLevelUpToast(level) {
    trackEvent('level_up', { level: level.level, title: level.title });
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.style.background = 'linear-gradient(135deg, #9B59B6, #6C3483)';
    t.style.color = '#FFF';
    t.innerHTML = '<span style="font-size:20px">🎉 רמה ' + (level.level || '') + '!</span><span style="font-size:12px">' + getLevelIcon() + ' ' + (level.title || '') + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 3500);
  }
  function showCreditToast(amount, action) {
    var labels = { daily_complete: 'אתגר יומי', streak_3: 'רצף 3 ימים!', streak_7: 'רצף 7 ימים!', streak_30: 'רצף 30 ימים!',
      contest_1st: 'מקום ראשון!', contest_2nd: 'מקום שני!', contest_3rd: 'מקום שלישי!', event_gift: '🎁 מתנה!' };
    var label = labels[action] || '';
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.innerHTML = '<span>+' + amount + ' 💎</span>' + (label ? '<span style="font-size:11px;opacity:0.8">' + label + '</span>' : '');
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 2800);
  }

