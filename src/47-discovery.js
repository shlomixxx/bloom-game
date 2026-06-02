// ============================================================
// FD.1 — Feature Discovery Map (May 29 2026)
//
// New + returning players don't know what BLOOM offers because 40+
// features hide behind progressive-unlock gates (T1.1+T1.4). The
// checkLevelUnlock() toast is transient — players miss it.
//
// Three surfaces:
//   (1) Discovery Tile at top of home — "✨ פתוחים 9 / 28"
//   (2) Next-Unlock Banner — "ברמה 5 (עוד 2 משחקים): 🎨 + 🎯"
//   (3) Discovery Modal — 5 categories × 28 features with status
//       pills + locked-teaser bullets + search.
//
// Standalone IIFE — uses window.* APIs from other modules.
// Pure DOM construction (createElement + textContent), zero
// innerHTML for variable content → XSS-safe by design.
// ============================================================
(function() {
  'use strict';

  // Feature catalog. Each entry:
  //   id          — stable string for analytics + locked-row dedup
  //   emoji       — 1-char display icon
  //   name        — Hebrew display name
  //   description — 1-line Hebrew description (under modal cards)
  //   teaser      — 3 short Hebrew bullets shown when player taps a
  //                 locked feature (the FOMO punch — "this is what
  //                 you're missing")
  //   category    — 'economy' | 'competition' | 'social' |
  //                 'collection' | 'daily'
  //   minLevel    — gate from src/04-ui-utils.js LEVEL_UNLOCKS
  //                 (must match the gate inside the feature's
  //                 maybeShow* so the modal doesn't show "open" when
  //                 the tile still refuses to mount)
  //   tileSelector — primary path to open the feature: find the tile
  //                  in home and trigger its click. Falls back to
  //                  openGlobal if the tile hasn't mounted yet.
  //   openGlobal  — optional global function name like '__bloomBank.showModal'
  //                 invoked when tileSelector isn't found
  var FEATURES = [
    // ── ECONOMY ───────────────────────────────────────────────
    { id: 'bank', emoji: '💰', name: 'הבנק', category: 'economy', minLevel: 8,
      description: 'הפקד יהלומים וקבל 1% ריבית יום-יומית',
      teaser: ['השקעה לטווח ארוך — היהלומים גדלים בלי לעשות כלום',
               'ריבית דריבית — כל יום הסכום מצטבר על עצמו',
               '5% עמלת משיכה — לכן כדאי להשאיר בפנים'],
      tileSelector: '#gem-bank-tile', openGlobal: '__bloomGemBank.openModal' },
    { id: 'daily_deals', emoji: '🔥', name: 'דיל יומי', category: 'economy', minLevel: 8,
      description: 'מבצע אחד מתחלף כל יום — חיסכון של 60%+',
      teaser: ['7 דילים שונים — סקין / חבילה / חיים / chest',
               'דיל לאיש (לא חוזר אם דילגת)',
               'חיסכון של 60-90% מהמחיר הרגיל'],
      tileSelector: '.daily-deal-home-banner' },
    { id: 'skins', emoji: '🎨', name: 'חנות סקינים', category: 'economy', minLevel: 8,
      description: 'סקינים יפים לאריחים — אוצר אישי',
      teaser: ['7+ סקינים זמינים — חינמי / 200💎 / 500💎',
               'חלקם עם אנימציות נדירות (Aurora)',
               'אחד נשמר לכל המשחקים'],
      tileSelector: '#home-v2-skins' },
    { id: 'starter_pack', emoji: '🎁', name: 'חבילת התחלה', category: 'economy', minLevel: 1,
      description: 'חבילה חד-פעמית — 1500💎 + סקין + 3 דרגות BP ב-500💎',
      teaser: ['חיסכון 79% מהמחיר הרגיל',
               'נפתחת רק אחרי 5K ניקוד',
               'מוגבל ל-7 ימים מהפתיחה'],
      tileSelector: '.starter-pack-home-banner' },
    { id: 'gacha', emoji: '🎰', name: 'גאצ׳ה — סקין נדיר', category: 'economy', minLevel: 18,
      description: 'פתח חבילות וזכה בסקינים נדירים',
      teaser: ['5 דרגות נדירות — common עד mythic',
               'משיכה חופשית אחת ביום',
               'אחרי 50 משיכות — מובטח סקין אגדי'],
      tileSelector: '#gacha-banner', openGlobal: '__bloomGacha.showModal' },
    { id: 'bundles', emoji: '🎁', name: 'חבילות חג', category: 'economy', minLevel: 18,
      description: 'חבילות מוגבלות בזמן — חנוכה / ולנטיין / בלאק פריידי',
      teaser: ['ערכת חבילה ייחודית לכל חג',
               'מוגבל ל-3-30 ימים — FOMO אמיתי',
               'אחת לאיש — לא חוזר השנה'],
      tileSelector: '.limited-bundle-home' },

    // ── COMPETITION ───────────────────────────────────────────
    { id: 'battle_pass', emoji: '🎖', name: 'Battle Pass', category: 'competition', minLevel: 12,
      description: '20 דרגות פרסים בעונה הנוכחית · ~16,000💎 חינם',
      teaser: ['פרס בכל דרגה — 25💎 עד 3000💎',
               'כל משחק נותן XP',
               'גרסת Premium נותנת ×2 פרסים'],
      tileSelector: '#home-v2-season-pass' },
    { id: 'trophy_road', emoji: '🏆', name: 'דרך הגביעים', category: 'competition', minLevel: 10,
      description: 'מנצח = +15🏆 · מפסיד = −8🏆 · ארנות לפרסי 💎',
      teaser: ['8 ארנות חזותיות — sprout עד legend',
               '10 פרסי-דרך — 50💎 עד 15,000💎',
               'יש מה להפסיד — לכן יש מה לרוויח'],
      tileSelector: '#trophy-home-tile' },
    { id: 'contests', emoji: '👥', name: 'תחרויות חברים', category: 'competition', minLevel: 5,
      description: 'צור תחרות פרטית — אתה והחברים על אותו לוח',
      teaser: ['בחר משך — 1 / 3 / 7 ימים',
               'ניקוד מצטבר או הכי-גבוה',
               'שיתוף קוד תחרות בוואטסאפ'],
      tileSelector: '#home-v2-contest' },
    { id: 'challenges', emoji: '📅', name: 'אתגרים', category: 'competition', minLevel: 5,
      description: 'אתגרים יומיים עם פרסים אמיתיים',
      teaser: ['race / top-N / beat / first-to-tier',
               'פרס אמיתי לזוכה (לא רק 💎)',
               'ניסיון אחד לאיש'],
      tileSelector: '#home-v2-challenge' },
    { id: 'tournaments', emoji: '🏆', name: 'טורנירים חיים', category: 'competition', minLevel: 5,
      description: 'טורנירים מתוזמנים עם קופת פרסים לטופ-N',
      teaser: ['מתחילים בזמן prime-time',
               'הטופ-3 לוקח 5000💎 / 2000💎 / 1000💎',
               'התראה עם הסיום'],
      tileSelector: '.tournament-banner' },
    { id: 'leagues', emoji: '⚔️', name: 'ליגות שבועיות', category: 'competition', minLevel: 20,
      description: '5 דרגות — bronze עד master · פרס שבועי 50-3000💎',
      teaser: ['XP שבועי קובע את הליגה',
               'ראשון יום בהתחלה — קל לעלות',
               'שמירה על master = 3000💎 כל שבוע'],
      tileSelector: '#league-home-tile' },

    // ── SOCIAL ────────────────────────────────────────────────
    { id: 'friends', emoji: '👥', name: 'חברים', category: 'social', minLevel: 1,
      description: 'הוסף חבר — שניכם מקבלים 200💎 + 100💎 ביום משותף',
      teaser: ['הזמן בוואטסאפ — קוד BLOOM-XXXX',
               'בכל יום ששניכם תשחקו = +100💎 לאחד',
               'תעקוב מי שיחק היום ומי לא'],
      tileSelector: '#dyn-friends-pill', openGlobal: 'showFriendsModal' },
    { id: 'clan', emoji: '🛡', name: 'קלאן', category: 'social', minLevel: 8,
      description: 'הצטרף לקלאן — מטרה משותפת + פרסים יומיים',
      teaser: ['30 שחקנים בקלאן',
               'מטרה משותפת: 30 כתרים = 200💎 לאיש',
               'תכלת לוח מובילים פנימי'],
      tileSelector: '#guild-home-tile' },
    { id: 'duel', emoji: '⚔️', name: 'דו-קרב 1v1', category: 'social', minLevel: 10,
      description: 'אתגר שחקן ספציפי על אותו לוח — או הימור 💎',
      teaser: ['קוד חבר או חיפוש אקראי',
               'הימור על 💎 — המנצח לוקח הכל',
               'גם דו-קרב חי 60 שניות בזמן אמת'],
      tileSelector: '#home-v2-duel' },
    { id: 'ghost_mode', emoji: '👻', name: 'מצב רוח', category: 'social', minLevel: 8,
      description: 'שחק נגד רוח של חבר על אותו לוח יומי',
      teaser: ['רואה את ההצבות שלו בזמן אמת',
               '"עברתי את דניאל" = +3K בונוס',
               'דרך לרדוף יריב ספציפי'],
      tileSelector: '#ghost-mode-tile' },
    { id: 'squad_tournaments', emoji: '🏟', name: 'טורניר קבוצתי', category: 'social', minLevel: 15,
      description: 'טורניר שבועי בין 4 קלאנים — bracket עם semifinals',
      teaser: ['רץ אוטומטית בקלאן שלך',
               'מנצח: 1000💎 לאיש · גמר: 300💎',
               'פעם בשבוע — מתחיל ביום ראשון'],
      tileSelector: '#squad-tile' },
    { id: 'rivals', emoji: '🥊', name: 'יריב יומי', category: 'social', minLevel: 20,
      description: 'שחקן בערך באותה רמה — מי משחק יותר ב-24ש מנצח',
      teaser: ['זיווג אוטומטי כל 4 שעות',
               'אישי מאוד — שם של שחקן ספציפי',
               'פרס 150💎 לכל ניצחון'],
      tileSelector: '#rival-home-tile' },
    { id: 'guild_wars', emoji: '🛡⚔️', name: 'מלחמות קלאן', category: 'social', minLevel: 20,
      description: 'מלחמה שבועית בין קלאנים — תרומה אוטומטית מכל משחק',
      teaser: ['7 ימי מלחמה',
               'מנצח: 500💎 לאיש · מפסיד: 100💎',
               'מתחיל אוטומטית כשיש 3+ פעילים'],
      tileSelector: '#guild-war-home-tile' },

    // ── COLLECTION ────────────────────────────────────────────
    { id: 'pet', emoji: '🌱', name: 'חיית מחמד', category: 'collection', minLevel: 8,
      description: 'חיית מחמד שגדלה איתך — 4 שלבים, 20 דרגות',
      teaser: ['💗 לטף יום-יומי = 20💎',
               '🍽 האכל = +50 XP (10💎)',
               'חוזר בעצב אם לא ביקרת 48ש'],
      tileSelector: '#pet-tile' },
    { id: 'ach_lb', emoji: '🏅', name: 'לוח הישגים', category: 'collection', minLevel: 8,
      description: 'דירוג גלובלי לפי מספר הישגים — תחרות לאוסף',
      teaser: ['11 הישגים בכל לוח דינמי',
               '6 הישגים cross-board',
               'יש מי שיש לו 100+ הישגים'],
      tileSelector: '.ach-lb-home-tile' },
    { id: 'lifetime', emoji: '⭐', name: 'פרוגרס חיים', category: 'collection', minLevel: 10,
      description: 'דרגה לא מתאפסת בין עונות · עד 10⭐ Prestige',
      teaser: ['XP מצטבר מכל פעולה — 8 מקורות',
               'לא מתאפס לעולם',
               'Prestige = +5000💎 ופרס נצחי'],
      tileSelector: '#lifetime-home-tile' },
    { id: 'album', emoji: '📔', name: 'אלבום אריחים', category: 'collection', minLevel: 15,
      description: 'אוסף ויזואלי של כל הדרגות בכל הלוחות הדינמיים',
      teaser: ['8 דרגות × N לוחות',
               'השלמת לוח = 500💎',
               'השלמת דרגה בכל הלוחות = 200💎'],
      tileSelector: '#album-home-tile' },

    // ── DAILY ─────────────────────────────────────────────────
    { id: 'daily_special', emoji: '🌟', name: 'הלוח של היום', category: 'daily', minLevel: 1,
      description: 'לוח אחד מקבל ×3 XP + ×2 פרסים — מתחלף ב-00:00',
      teaser: ['אותו לוח לכל השחקנים היום',
               '×3 XP ב-Battle Pass',
               '×2 פרסי משימות'],
      tileSelector: '.daily-special-banner' },
    { id: 'login_reward', emoji: '🎁', name: 'בונוס יומי', category: 'daily', minLevel: 1,
      description: 'בונוס בכניסה — גדל עם הרצף · עד 200💎 ביום 30',
      teaser: ['1-2 ימים: 25💎 · 3-6: 50💎',
               '7-29: 100💎 · 30+: 200💎',
               'מכפילים: רצף-דינמי + חבר משותף'],
      tileSelector: '.daily-reward-overlay' },
    { id: 'login_cal', emoji: '📅', name: 'יומן 7 ימים', category: 'daily', minLevel: 5,
      description: 'יומן 7-ימי — בונוס מצטבר 50→5000💎 ביום 7',
      teaser: ['50 → 100 → 200 → 500 → 1000 → 2000 → 5000',
               'מפספס יום = חוזר ליום 1',
               'הג׳קפוט של יום 7: 5000💎'],
      tileSelector: '#login-cal-tile' },
    { id: 'spin', emoji: '🎡', name: 'גלגל יומי', category: 'daily', minLevel: 12,
      description: 'סובב פעם ביום — פרס משתנה · 10💎 עד 5000💎',
      teaser: ['12 פרסים שונים',
               'רצף בונוס: +10% לכל יום עוקב',
               '0.1% סיכוי לג׳קפוט 5000💎'],
      tileSelector: '#spin-home-tile' },
    { id: 'checklist', emoji: '📋', name: 'משימות יומיות', category: 'daily', minLevel: 5,
      description: '5 משימות פשוטות — השלמת הכל = +100💎',
      teaser: ['גאצ׳ה / דיל / משימה / רצף / לוח-היום',
               'כל אחד בנפרד נותן בונוס',
               'הכל = +100💎 בונוס סיום'],
      tileSelector: '#checklist-home-tile' }
  ];

  var CATEGORIES = [
    { id: 'economy',     emoji: '💎', name: 'כלכלה' },
    { id: 'competition', emoji: '🏆', name: 'תחרות' },
    { id: 'social',      emoji: '👥', name: 'חברתי' },
    { id: 'collection',  emoji: '📔', name: 'אוסף' },
    { id: 'daily',       emoji: '🎁', name: 'יומיים' }
  ];

  function getLevel() {
    try {
      if (window.__bloomLevel && typeof window.__bloomLevel.getPlayerLevel === 'function') {
        return window.__bloomLevel.getPlayerLevel() | 0;
      }
    } catch (e) {}
    return 1;
  }

  function summarize() {
    var level = getLevel();
    var openCount = 0;
    var nextLevel = null;
    var nextFeatures = [];
    for (var i = 0; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      if (level >= f.minLevel) {
        openCount++;
      } else {
        if (nextLevel === null || f.minLevel < nextLevel) nextLevel = f.minLevel;
      }
    }
    if (nextLevel !== null) {
      for (var j = 0; j < FEATURES.length; j++) {
        if (FEATURES[j].minLevel === nextLevel) nextFeatures.push(FEATURES[j]);
      }
    }
    return {
      level: level,
      openCount: openCount,
      total: FEATURES.length,
      nextLevel: nextLevel,
      nextFeatures: nextFeatures,
      gamesToNext: nextLevel !== null ? Math.max(0, nextLevel - level) : 0
    };
  }

  // ===== Tile =====
  function maybeMountTile() {
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    var tile = document.getElementById('discovery-tile');
    if (!tile) {
      tile = document.createElement('button');
      tile.id = 'discovery-tile';
      tile.className = 'discovery-tile';
      tile.type = 'button';
      tile.onclick = function() {
        try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}
        showDiscoveryModal();
      };
      mountAboveFooter(home, tile);
    }
    renderTile(tile);
  }

  // The discovery surfaces are mounted late (200ms) via createElement, so a
  // bare appendChild lands them BELOW the home footer links (privacy / how-to /
  // invite) as orphan tiles. Anchor them ABOVE the footer instead so they read
  // as the "browse all features" zone at the end of the home content.
  function mountAboveFooter(home, el) {
    var ft = home.querySelector('.home-v2-bottom');
    if (ft && ft.parentNode === home) home.insertBefore(el, ft);
    else home.appendChild(el);
  }

  function renderTile(tile) {
    while (tile.firstChild) tile.removeChild(tile.firstChild);
    var s = summarize();
    var pct = Math.max(0, Math.min(100, Math.round((s.openCount / s.total) * 100)));

    var head = document.createElement('div');
    head.className = 'discovery-tile-head';

    var title = document.createElement('div');
    title.className = 'discovery-tile-title';
    title.textContent = s.level >= 20 ? '✨ כל הפיצ\'רים של BLOOM' : '✨ הפיצ\'רים של BLOOM';
    head.appendChild(title);

    var stats = document.createElement('div');
    stats.className = 'discovery-tile-stats';
    stats.textContent = s.openCount + ' / ' + s.total + ' פתוחים · רמה ' + s.level + '/20';
    head.appendChild(stats);

    tile.appendChild(head);

    var barWrap = document.createElement('div');
    barWrap.className = 'discovery-tile-bar';
    var barFill = document.createElement('div');
    barFill.className = 'discovery-tile-bar-fill';
    barFill.style.width = pct + '%';
    barWrap.appendChild(barFill);
    tile.appendChild(barWrap);

    var foot = document.createElement('div');
    foot.className = 'discovery-tile-foot';
    foot.textContent = s.level >= 20
      ? '👆 לחץ למפת הפיצ\'רים'
      : '👆 לחץ לראות הכל';
    tile.appendChild(foot);

    if (s.level < 20) tile.classList.add('discovery-tile-pulse');
    else tile.classList.remove('discovery-tile-pulse');
  }

  // ===== Next-Unlock Banner =====
  function maybeMountNextUnlock() {
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    var s = summarize();
    var banner = document.getElementById('discovery-next-unlock');
    if (s.level >= 20 || s.nextLevel === null) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('button');
      banner.id = 'discovery-next-unlock';
      banner.type = 'button';
      banner.onclick = function() {
        try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}
        showDiscoveryModal();
      };
      mountAboveFooter(home, banner);
    }
    renderNextUnlock(banner, s);
  }

  function renderNextUnlock(banner, s) {
    while (banner.firstChild) banner.removeChild(banner.firstChild);
    var urgent = s.gamesToNext <= 1;
    banner.className = 'discovery-next-unlock' + (urgent ? ' discovery-next-unlock-urgent' : '');

    var icon = document.createElement('div');
    icon.className = 'discovery-next-icon';
    icon.textContent = urgent ? '🔥' : '🔓';
    banner.appendChild(icon);

    var body = document.createElement('div');
    body.className = 'discovery-next-body';

    var emojiList = s.nextFeatures.map(function(f) { return f.emoji; }).slice(0, 4).join(' ');
    var title = document.createElement('div');
    title.className = 'discovery-next-title';
    title.textContent = 'ברמה ' + s.nextLevel + ': ' + emojiList;
    body.appendChild(title);

    var sub = document.createElement('div');
    sub.className = 'discovery-next-sub';
    if (s.gamesToNext === 0) sub.textContent = '✨ פתוח עכשיו! לחץ כדי לראות';
    else if (s.gamesToNext === 1) sub.textContent = '🔥 משחק אחד עד הפתיחה!';
    else sub.textContent = 'עוד ' + s.gamesToNext + ' משחקים · ' +
                          s.nextFeatures.map(function(f) { return f.name; }).slice(0, 2).join(' + ');
    body.appendChild(sub);

    banner.appendChild(body);

    var arrow = document.createElement('div');
    arrow.className = 'discovery-next-arrow';
    arrow.textContent = '›';
    banner.appendChild(arrow);
  }

  // ===== Modal =====
  function showDiscoveryModal() {
    var existing = document.getElementById('discovery-modal');
    if (existing) { existing.remove(); return; }

    var ov = document.createElement('div');
    ov.id = 'discovery-modal';
    ov.className = 'discovery-modal-overlay modal-overlay';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

    var card = document.createElement('div');
    card.className = 'discovery-modal-card';

    // Head
    var head = document.createElement('div');
    head.className = 'discovery-modal-head';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'discovery-modal-close modal-close';
    closeBtn.setAttribute('aria-label', 'סגור');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.onclick = function() { ov.remove(); };
    head.appendChild(closeBtn);

    var s = summarize();
    var headTitle = document.createElement('div');
    headTitle.className = 'discovery-modal-title';
    headTitle.textContent = '✨ הפיצ\'רים של BLOOM';
    head.appendChild(headTitle);

    var headSub = document.createElement('div');
    headSub.className = 'discovery-modal-sub';
    headSub.textContent = s.openCount + ' / ' + s.total + ' פתוחים · רמה ' + s.level + '/20';
    head.appendChild(headSub);

    card.appendChild(head);

    // Search
    var searchWrap = document.createElement('div');
    searchWrap.className = 'discovery-modal-search-wrap';
    var search = document.createElement('input');
    search.type = 'text';
    search.placeholder = '🔍 חפש פיצ\'ר';
    search.className = 'discovery-modal-search';
    searchWrap.appendChild(search);
    card.appendChild(searchWrap);

    // Body
    var body = document.createElement('div');
    body.className = 'discovery-modal-body';
    card.appendChild(body);

    function renderBody(filter) {
      while (body.firstChild) body.removeChild(body.firstChild);
      var q = (filter || '').trim().toLowerCase();
      var anyShown = false;
      for (var c = 0; c < CATEGORIES.length; c++) {
        var cat = CATEGORIES[c];
        var entries = FEATURES.filter(function(f) {
          if (f.category !== cat.id) return false;
          if (!q) return true;
          // Bug #25 — also search the locked-feature teaser bullets so a
          // player searching for a benefit ("יהלומים", "חבר") finds the
          // locked feature whose teaser mentions it.
          var teaserText = Array.isArray(f.teaser) ? f.teaser.join(' ').toLowerCase() : '';
          return f.name.toLowerCase().indexOf(q) >= 0 ||
                 f.description.toLowerCase().indexOf(q) >= 0 ||
                 teaserText.indexOf(q) >= 0;
        });
        if (!entries.length) continue;
        anyShown = true;

        var section = document.createElement('div');
        section.className = 'discovery-section';

        var secHead = document.createElement('div');
        secHead.className = 'discovery-section-head';
        secHead.textContent = cat.emoji + ' ' + cat.name + ' · ' + entries.length;
        section.appendChild(secHead);

        for (var i = 0; i < entries.length; i++) {
          section.appendChild(buildRow(entries[i], s, ov));
        }

        body.appendChild(section);
      }
      if (!anyShown) {
        var empty = document.createElement('div');
        empty.className = 'discovery-empty';
        empty.textContent = 'לא נמצאו פיצ\'רים תואמים';
        body.appendChild(empty);
      }
    }

    renderBody('');

    var debTimer = null;
    search.addEventListener('input', function() {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(function() { renderBody(search.value); }, 120);
    });

    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  function buildRow(f, summary, overlay) {
    var unlocked = summary.level >= f.minLevel;
    var row = document.createElement('div');
    row.className = 'discovery-row' + (unlocked ? ' discovery-row-open' : ' discovery-row-locked');
    row.setAttribute('data-feature-id', f.id);

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'discovery-row-head';

    var icon = document.createElement('div');
    icon.className = 'discovery-row-icon';
    icon.textContent = f.emoji;
    head.appendChild(icon);

    var rowBody = document.createElement('div');
    rowBody.className = 'discovery-row-body';

    var name = document.createElement('div');
    name.className = 'discovery-row-name';
    name.textContent = f.name;
    rowBody.appendChild(name);

    var desc = document.createElement('div');
    desc.className = 'discovery-row-desc';
    desc.textContent = f.description;
    rowBody.appendChild(desc);

    head.appendChild(rowBody);

    var status = document.createElement('div');
    status.className = 'discovery-row-status';
    if (unlocked) {
      status.textContent = '→ פתח';
      status.classList.add('discovery-row-status-open');
      head.onclick = function() { openFeature(f, overlay); };
    } else {
      var gap = f.minLevel - summary.level;
      status.textContent = '🔒 רמה ' + f.minLevel;
      status.classList.add('discovery-row-status-locked');
      head.onclick = function() { toggleLockedTeaser(row, f, gap); };
    }
    head.appendChild(status);

    row.appendChild(head);
    return row;
  }

  function toggleLockedTeaser(row, f, gap) {
    var existing = row.querySelector('.discovery-row-teaser');
    if (existing) { existing.remove(); return; }
    var teaser = document.createElement('div');
    teaser.className = 'discovery-row-teaser';
    var bullets = (f.teaser || []).slice(0, 3);
    for (var i = 0; i < bullets.length; i++) {
      var li = document.createElement('div');
      li.className = 'discovery-row-teaser-bullet';
      li.textContent = '• ' + bullets[i];
      teaser.appendChild(li);
    }
    var hint = document.createElement('div');
    hint.className = 'discovery-row-teaser-hint';
    if (gap <= 0) hint.textContent = '✨ פתוח עכשיו! סגור ופתח מחדש';
    else if (gap === 1) hint.textContent = '🔥 משחק אחד לפתיחה!';
    else hint.textContent = '🔓 עוד ' + gap + ' משחקים לפתיחה';
    teaser.appendChild(hint);
    row.appendChild(teaser);
  }

  // Resolves a "global path" like "__bloomBank.openModal" against the
  // window object. Returns the function if found, else null. We use
  // this so each catalog entry can specify openGlobal as a string.
  function resolveGlobal(path) {
    if (!path) return null;
    var parts = String(path).split('.');
    var cur = window;
    for (var i = 0; i < parts.length; i++) {
      if (!cur) return null;
      cur = cur[parts[i]];
    }
    return typeof cur === 'function' ? cur : null;
  }

  function openFeature(f, overlay) {
    var triggered = false;
    if (f.tileSelector) {
      var tile = document.querySelector(f.tileSelector);
      if (tile && typeof tile.click === 'function') {
        if (overlay) overlay.remove();
        try { tile.click(); triggered = true; } catch (e) {}
      }
    }
    if (!triggered && f.openGlobal) {
      var fn = resolveGlobal(f.openGlobal);
      if (fn) {
        if (overlay) overlay.remove();
        try { fn(); triggered = true; } catch (e) {}
      }
    }
    if (!triggered) {
      // Tile hasn't mounted yet (level just crossed but module deferred
      // its setTimeout). Tell the player honestly.
      if (typeof showToast === 'function') {
        showToast('הפיצ\'ר עוד נטען — נסה שוב עוד רגע', 'info');
      }
    }
  }

  // ===== Public API =====
  window.__bloomDiscovery = {
    maybeMountTile: maybeMountTile,
    maybeMountNextUnlock: maybeMountNextUnlock,
    showModal: showDiscoveryModal,
    summarize: summarize,
    FEATURES: FEATURES,
    CATEGORIES: CATEGORIES
  };
})();
