# 📋 BLOOM — משימות מסודרות (Task Tracker)

> **🎯 מטרת-על: להפוך את BLOOM למשחק הכי ממכר שאפשר.**
> כל משימה פה מכוונת ל-retention, clarity, או addiction.
> סמן ✅ כשמשימה הושלמה. כל Phase בנוי על הקודם.
>
> **⚠️ כלל ברזל**: לפני כל שינוי — בדוק שמנוע המיזוג עדיין עובד.
> אל תשנה את: BFS group detection, gravity, chain scoring, merge logic.
>
> 📎 ראה `BLOOM_FULL_AUDIT.md` להסבר מלא על כל בעיה.

---

## PHASE 0 — תיקונים קריטיים (חובה לפני הכל)
> ⏱ ~3 שעות | 🎯 בלי זה כלום לא עובד כמו שצריך

- [x] **T0.1** ✅ — GA_MEASUREMENT_ID הוטמע (24.05.2026)
  - `G-KTRD0NCTX8` (property: bloom-game) הוחלף בכל 3 המופעים ב-[public/index.html](public/index.html) (שורות 6-10). `trackEvent()` עכשיו שולח אירועים אמיתיים ל-GA4. כל ה-`gtag('event', ...)` שכבר היו בקוד (`game_start`, `game_over`, `purchase`, `level_up`, וכו') יתחילו לזרום.

- [x] **T0.2** ✅ — XP/Level ב-schema.sql נוספו (24.05.2026)
  - שתי שורות `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS xp/level` נוספו ב-schema.sql אחרי ה-`updated_at` ALTER. `db.js` כבר ריצה את אותו migrate ב-boot, אבל עכשיו fresh `psql schema.sql` יקבל גם את העמודות.

- [x] **T0.3** ✅ — localStorage wrapper נוסף (24.05.2026)
  - `safeGet/safeSet/safeRemove/safeGetJSON/safeSetJSON` נוספו ב-`src/04-ui-utils.js` (sets at top of IIFE so they're hoisted everywhere) + הוצאו ל-`window.__bloomStorage` עבור bot.js / admin.
  - מיגרציה הדרגתית של ~200 הקריאות הקיימות תזרום בקבצים שנערכים ממילא — לא mass-rewrite.

- [x] **T0.4** ✅ — `alert()` → `showToast()` (24.05.2026)
  - 40 alerts ב-13 קבצי `src/` הוחלפו ב-`showToast(msg, type)`. סוגי הודעות מותאמים: error/warning/info/success. אחרי build — `public/app.js` נקי מ-`alert(`.

- [x] **T0.5** ✅ — Date validation בשרת נוספה (24.05.2026)
  - `server.js` POST `/api/score` — אחרי `isValidDate` נוסף diff check נגד Asia/Jerusalem today. submissions עם diff > 1 day → 400 bad_date. סוגר את ה-vector של "שעון שגוי = daily seed שגוי".

---

## PHASE 1 — שחקן חדש לא מתבלבל
> ⏱ ~8 שעות | 🎯 שחקן חדש מבין מה לעשות ב-30 שניות
> 💡 **למה זה ממכר**: Match Masters מראה רק "PLAY" לשחקנים חדשים. פשטות = שחקן לא בורח.

- [x] **T1.1** ✅ — Progressive Unlock System (24.05.2026)
  - `getPlayerLevel() = Math.min(20, games + 1)` ב-[src/04-ui-utils.js](src/04-ui-utils.js).
  - `LEVEL_UNLOCKS` map: L5 (contest/checklist) · L8 (skins/daily-deal/pet/ach-lb) · L10 (duel/trophy/lifetime) · L12 (season-pass/spin) · L15 (guilds/album) · L18 (gacha/bundles) · L20 (leagues/rivals/wars).
  - `applyLevelGates(root)` runs on home mount + 600/1500/2500/3400ms intervals to catch deferred `maybeShow*` mounts. Uses `data-min-level` attr — hides via display:none, restores on level-up.
  - `checkLevelUnlock()` fires on home-mount + every game-over — shows ONE combined toast for all newly-crossed thresholds.
  - 12 `maybeShow*` functions got `if (getPlayerLevel() < N) return;` top-line gate.
  - **Important**: existing players (≥19 games) are at level 20 → see everything. Zero regression.
  - קובץ: `public/app.js` — `showHomeV2()` (שורה ~4101)
  - הוסף function `getPlayerLevel()` שמושכת level מ-localStorage
  - כל `maybeShow*` function מקבלת check: `if (getPlayerLevel() < REQUIRED_LEVEL) return;`
  - Level thresholds:
    ```
    Level 1-3:  רק Play + Leaderboard + Tour
    Level 5:    תחרויות חברים, Checklist
    Level 8:    סקינים, Daily Deal
    Level 10:   דו-קרב, Trophy Road
    Level 12:   Season Pass, Spin
    Level 15:   Guilds, Album
    Level 18:   Gacha, Bundles
    Level 20:   Leagues, Rivals, Wars
    ```
  - כשפיצ'ר חדש נפתח → `showToast('🔓 נפתח: תחרויות חברים!', 'success')` + אנימציה

- [ ] **T1.2** — FTUE אינטראקטיבי (Tutorial) — **DEFERRED**
  - **סטטוס**: dferred. [src/15-ftue.js](src/15-ftue.js) הנוכחי כבר עושה 3 צעדים scripted-demo (drop → merge → chain) על mock board עם אותה אומנות. המעבר ל-"real board interactive" דורש כירורגיה במנוע (`init()` seed + drop interception + tour pause/resume) — risk גבוה למנוע ה-merge, ו-ROI נמוך אחרי שה-scripted-demo עובד. נחזור לזה אם data של D1 retention יראה שצריך.

- [x] **T1.3** ✅ — Balance Widget קבוע (24.05.2026)
  - 4-slot bar בראש home-v2: `💎 gems · ❤️ lives · 🔥 streak · ⭐ level`. Lives slot מוסתר אם המערכת disabled (matches lives_enabled config).
  - אנימציית bump + floating "+N" pill כל פעם שמקבלים gems (חיווט ב-`earnCredits` ב-[src/07-identity.js](src/07-identity.js#L463) דרך `window.__bloomBumpBal`).
  - `updateBalanceDisplay` ב-[src/02-shop.js](src/02-shop.js#L1446) קורא ל-`window.__bloomRenderBal` כדי לרענן את הוידג'ט אחרי כל spend/buy/refund.
  - render גם אחרי game-over (level + streak מתעדכנים).

- [x] **T1.4** ✅ — Simplified Home (24.05.2026)
  - מסך הבית עכשיו gating-by-level: שחקן L1-4 רואה רק את הטופ-בר (mute + live-pulse + balance bar), הירו, ה-pid, ה-CTA "שחק עכשיו", המסטטס, וה-bottom-links (Tour + Privacy). זהו.
  - 12 tiles + 4 action buttons מוסתרים עד שעוברים את ה-threshold (ראה T1.1).
  - הקצב: L1 שחק → L5 עוברים חבר (~4 משחקים) → L8 (~7) → L10 (~9) → L20 (~19 משחקים = הכל פתוח).

---

## PHASE 2 — Addiction Loops (מה שגורם לשחקנים לחזור)
> ⏱ ~12 שעות | 🎯 D1 retention מעל 40%
> 💡 **למה זה ממכר**: כל loop יוצר סיבה לחזור מחר

- [x] **T2.1** ✅ — Trophy Road ויזואלי (24.05.2026)
  - Horizontal strip של כל 8 הארנות בתוך ה-trophy tile עצמו ([src/34-trophy-road.js](src/34-trophy-road.js) `renderTrophyStrip`). nodes ✓-עברו (gold) / current (white pulsing ring) / locked-grey.
  - מילוי-ביניים פרופורציונלי בין הארנה הנוכחית לבאה (`(trophies - curr.min) / (next.min - curr.min)`).
  - Tile עדיין נפתח לmodal עם הפירוט המלא של 10 ה-milestones.
  - קובץ חדש: `src/34-trophy-road.js` (כבר קיים, צריך לשדרג UI)
  - Strip ויזואלי בראש מסך הבית:
    ```
    [★1]──[★2]──[★3🎁]──[★4]──[★5🔓]──[★6]──[★7🎁]...
    ```
  - כל level = node על המסלול
  - 🎁 = reward (gems/skin/booster)
  - 🔓 = feature unlock
  - Progress bar מונפש בין nodes
  - **Dopamine trigger**: כשמגיע ל-node חדש → confetti + sound + reward popup

- [x] **T2.2** ✅ — Streak Calendar visual (24.05.2026)
  - 14-cell calendar modal (7×2): 7 ימי עבר + היום + 6 ימים עתידיים. פתיחה דרך לחיצה על ה-streak slot ב-balance bar.
  - Past days: ✓ ירוק if in current streak; היום: gold pulsing border; עתיד: milestone markers (3/7/14/30/60/100) עם תצוגת הפרס "+50💎/+100💎/+250💎/...".
  - Next-milestone summary line: "🎯 עוד 4 ימים ל-🎁 +100💎" — prospective-FOMO.
  - לוגיקה ב-[src/04-ui-utils.js](src/04-ui-utils.js) `showStreakCalendar`; חיווט ב-[src/05a-home-v2.js](src/05a-home-v2.js).

- [x] **T2.3** ✅ — Score Submit Retry + offline queue (24.05.2026)
  - 4-attempt fetch עם backoff `[0, 2s, 4s, 8s]`. אחרי attempt 1 → showToast warning "הציון לא נשמר — מנסה שוב…". על הצלחה → toast success. על failure סופי → רושם ל-`localStorage[bloom_score_queue]` (max 10 entries).
  - 4xx terminal errors (bad_date/bad_score) לא retried, לא queued (השרת דחה ולא יקבל).
  - `drainScoreQueue()` נקרא אוטומטית 2.5s אחרי boot ([src/13-boot.js](src/13-boot.js)) — שולח את כל ההישנים ברצף, מסיר מהtable על הצלחה. Toast מציג כמה נשלחו.

- [x] **T2.4** ✅ — Streak Danger live countdown + persistent banner (24.05.2026)
  - Live countdown ticker שמתעדכן כל דקה ("נשארו N שעות עד חצות"). כשנשארת פחות משעה — "נשארו N דקות עד חצות".
  - הוספת `🎮 שחק` button מפורש בתוך הבאנר (ולא רק tap-anywhere סמוי) → סטראט מיידי של daily.
  - הבאנר persistent — לא מתפוגג אוטומטית, נשאר עד שהשחקן לוחץ play או ✕ explicit. Loss-aversion חזק יותר כשההזהרה ממשיכה להציק.
  - Comeback overlay כבר היה תקין — לא נגענו.

- [x] **T2.5** ✅ — Daily Checklist All-Done bonus + celebration (24.05.2026)
  - שרת: action חדש `daily_checklist_complete` ב-`/api/player/earn` ([server.js](server.js#L11526)). server **re-verifies** את כל 5 הפריטים מחדש לפני התשלום (anti-cheat) — gacha free pull / daily deal / quest / streak / daily-special (האחרון client-tracked כי הוא localStorage-only).
  - Config: `checklist_all_done_reward` (default 100💎) ב-[schema.sql](schema.sql).
  - Client: ב-[src/21-calendar.js](src/21-calendar.js) — `renderChecklistTile` בודק `data.allDone` ולא `bloom_checklist_bonus === today` → קורא ל-`earnCredits('daily_checklist_complete', {dailySpecialDone})` + מציג overlay full-screen עם 28-particle confetti, 🏆 spinning icon, "כל המשימות הושלמו! +100💎 בונוס יומי".
  - Daily dedup: lockbox client-side + server-side `_earn:<device>:daily_checklist_complete:<today>` dedup key.

---

## PHASE 3 — מערכות מטבע ו-Shop
> ⏱ ~10 שעות | 🎯 שחקנים מרגישים שהgems שווים משהו
> 💡 **למה זה ממכר**: Economy loop = earn → want → spend → need more → play more

- [x] **T3.1** ✅ — Booster System v1 (24.05.2026)
  - 2 boosters בטוחים שלא נוגעים במנוע ה-merge:
    1. 🎯 **בחר** (50💎) — modal עם 4 כפתורי tier 1-4, מגדיר את `nextPiece` ישירות.
    2. 💥 **הסר** (40💎) — tap-mode על הלוח, בחירה בתא לא-ריק מנקה אותו + applyGravity + render.
  - הצורות שלא מומשו ב-v1 (נדחו כי נוגעות בלוגיקת merge/scoring/game-over): 🔀 shuffle, ×2 double, 🛡 save.
  - Server: `POST /api/player/use-booster` ב-[server.js](server.js) עם allowlist `['pick','pop']`, פרייסינג מ-`booster_{id}_price` config, atomic UPDATE deduct, rate-limit 60/hr.
  - 4 config keys: `booster_enabled` (master toggle), `booster_pick_price`, `booster_pop_price`.
  - Client: [src/35-boosters.js](src/35-boosters.js) — חדש, בתוך ה-main IIFE (לא wrapped, גישה ישירה ל-grid/nextPiece/applyGravity). `maybeMountBoosterStrip` נקרא בסוף init() אחרי ה-render הראשון.
  - Mode gating: practice + dynamic בלבד. NOT daily/contest/duel/challenge (fairness). NOT bot/skin-trial.
  - Per-game once: `_boostersUsedThisGame` מאופס בכל init.

- [x] **T3.2** ✅ — Skin Shop polish (24.05.2026)
  - Full preview: 8 tiers (was 5) ב-22px each, נכנס בנוחות ב-modal 360px.
  - Badges: `⭐ פופולרי` (classic), `💎 פרימיום` (price ≥ 400), `🆕 חדש` (אם s.tag === 'new').
  - Trial timer ויזואלי: 60s countdown bar עם class `.skin-trial-urgent` ב-10 השניות האחרונות (אדום פולסי). Auto-ends הניסיון. Persisted ב-`localStorage[bloom_skin_trial_end]` כך שרענון לא מאריך.
  - סוגר בעיית UX8 — trial היה open-ended.

- [x] **T3.3** ✅ — Daily Deals UI polish (24.05.2026)
  - 💰 "חסכת N💎" pill מתחת למחיר (anchoring psychology — מספר אבסולוטי חזק יותר מאחוז).
  - "×N ערך!" sticker מסובב 8° עם pulse animation כש-originalValue / priceGems ≥ 3.
  - Last-hour urgency: ה-countdown אדום-פולסי כשנשארה פחות משעה. Expired state אפור.

- [x] **T3.4** ✅ — Gacha UX collection progress (24.05.2026)
  - Card חדש "📚 אוסף: 12 / 17 · עוד 5 סקינים לאסוף" בין pity ל-rates.
  - הצגה דינמית: "🔥 עוד N להשלמת האוסף!" כש≤3 חסרים, "👑 איסוף מלא!" כשהכל נאסף (gold gradient).
  - Server: `/api/gacha/state` החזיר `ownedSkinsCount` + `totalSkins` מ-`skin_configurations` JOIN על `player_skins`.

---

## PHASE 4 — Social & Competition (מה שגורם לשחקנים להזמין חברים)
> ⏱ ~12 שעות | 🎯 K-factor > 1 (כל שחקן מביא עוד שחקן)
> 💡 **למה זה ממכר**: "הבן דוד שלי ניצח אותי — חייב לנצח אותו בחזרה"

- [ ] **T4.1** — Live Duel (PvP בזמן אמת)
  - קובץ: `src/XX-live-duel.js` + server routes
  - שני שחקנים, אותו seed, בו-זמנית
  - Split screen: הלוח שלי | הלוח של היריב (צללית)
  - Timer: 2 דקות
  - מי שסיים עם יותר נקודות מנצח
  - **Dopamine trigger**: "ניצחת את אורי ב-340 נקודות! 🏆"

- [ ] **T4.2** — Push Notifications לDuels
  - קובץ: `server.js` — `POST /api/duels`
  - כשנוצר דו-קרב חדש → `sendPushToDevice(targetDeviceId, { title: '⚔️ אתגר חדש!', body: 'אורי מאתגר אותך לדו-קרב' })`
  - כשדו-קרב נגמר → push ליריב: "ניצחת!" / "הפסדת — נקמה?"

- [ ] **T4.3** — Guild Weekly Challenge
  - קובץ: `src/28-guilds.js` + `src/33-guild-wars.js`
  - כל שבוע: challenge משותף לכל חברי הגילדה
  - "הגילדה שלכם צברה 45K/100K — עוד 55K לפרס!"
  - Progress bar משותף
  - **Dopamine trigger**: "הגילדה שלך ניצחה! כולם מקבלים 200💎"

- [ ] **T4.4** — Notification Center (Inbox)
  - קובץ חדש: `src/XX-inbox.js`
  - 🔔 icon בראש מסך הבית עם badge count (3)
  - Slide-out panel עם:
    - תוצאות דו-קרב
    - Gifts שהתקבלו
    - Guild events
    - Challenge results
  - Mark as read + bulk clear

- [ ] **T4.5** — Friends List שיפור
  - קובץ: server `GET /api/friends/list`
  - הראה online status (🟢 / 🔴)
  - "שחקן X עבר אותך בדירוג!" → push notification
  - One-tap challenge: "אתגר לדו-קרב" כפתור ליד כל חבר

---

## PHASE 5 — Admin Control Panel
> ⏱ ~8 שעות | 🎯 אדמין מנהל הכל בלי SQL
> 💡 **למה זה חשוב**: אדמין שלא יכול לנהל = משחק שלא מתפתח

- [ ] **T5.1** — Config Editor UI
  - קובץ: `admin/index.html`
  - Section חדש: "⚙️ הגדרות משחק"
  - טבלה עם כל key/value מ-`GET /admin/api/config`
  - Filter/search bar
  - כפתור "ערוך" ליד כל שורה → modal עם input → `PATCH /admin/api/config/:key`
  - קטגוריות: Economy, Lives, Season, Gacha, Deals, Pet, Guild, Streak
  - **API כבר קיים** — רק צריך UI

- [ ] **T5.2** — Challenge Creator UI
  - קובץ: `admin/index.html` + server route `POST /admin/api/challenges`
  - Form:
    - שם (text)
    - סוג (dropdown: race / top_n / beat / first_to_tier)
    - Threshold (number)
    - מספר זוכים (number)
    - פרס (text + image URL)
    - תאריך התחלה/סיום
    - Status (draft / active)
    - כפתור Publish
  - Preview before publish

- [ ] **T5.3** — Bot Control Panel
  - קובץ: `admin/index.html`
  - Section: "🤖 בוטים"
  - Toggle: on/off
  - Active bots count
  - Bot speed slider
  - Last activity timestamp
  - קורא ל-`startBots()` / `stopBots()` / `getBotStatus()`

- [ ] **T5.4** — Player Management שלם
  - קובץ: `admin/index.html`
  - חיפוש: device ID / player code / display name
  - Player detail page:
    - Profile info (code, name, country, created_at)
    - Balance + history (earn/spend timeline)
    - Games played (daily + practice + contest + duel)
    - Skins owned
    - Guild membership
    - Season pass status
    - Actions: credit/debit gems, ban, reset streak, flag cheat

- [ ] **T5.5** — Push Notification Sender
  - קובץ: `admin/index.html` + server route
  - Audience: All / Active last 7d / Specific player / Guild
  - Message: title + body
  - Preview → Send
  - History log of sent pushes

---

## PHASE 6 — ביצועים ויציבות
> ⏱ ~6 שעות | 🎯 מסך הבית נטען ב-<2 שניות
> 💡 **למה זה ממכר**: משחק איטי = שחקן בורח

- [ ] **T6.1** — Single Home State API
  - קובץ: `server.js`
  - Route חדש: `GET /api/home-state?deviceId=...`
  - מחזיר JSON אחד עם:
    ```json
    {
      "balance": 1250, "xp": 340, "level": 7,
      "streak": { "current": 7, "freezeAvailable": true },
      "lives": { "current": 4, "max": 5, "nextRegenMs": 42000 },
      "checklist": { "items": [...], "doneCount": 3 },
      "dailyDeal": { "available": true, "discount": 40 },
      "pet": { "mood": "happy", "level": 3 },
      "seasonPass": { "tier": 5, "xp": 120 },
      "unreadNotifications": 3,
      "activeChallenges": 1,
      "guildWar": { "active": true }
    }
    ```
  - Client: **ONE** fetch → render all tiles

- [ ] **T6.2** — earn_dedup טבלה נפרדת
  - קובץ: `schema.sql` + `server.js`
  - טבלה חדשה:
    ```sql
    CREATE TABLE IF NOT EXISTS earn_dedup (
      device_id   VARCHAR(64) NOT NULL,
      action_key  VARCHAR(100) NOT NULL,
      earned_date DATE NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (device_id, action_key, earned_date)
    );
    ```
  - מעביר את כל `_earn:*` logic מ-game_config לטבלה הזו
  - Cleanup: `DELETE FROM earn_dedup WHERE earned_date < CURRENT_DATE - 7`

- [ ] **T6.3** — Config Cache גלובלי
  - קובץ: `server.js`
  - `_allConfigCache` — refreshed כל 60 שניות
  - `getConfigValue(key)` → קורא מה-cache
  - כל ה-`_loadLivesConfig()`, `_loadPetConfig()`, `_loadCalendarConfig()` → משתמשים ב-cache

- [ ] **T6.4** — Skeleton Loaders
  - קובץ: `public/app.js` + `public/styles.css`
  - בזמן טעינת home-state: rectangles אפורים מהבהבים (shimmer effect)
  - כשdata מגיע → fade-in לcontent אמיתי
  - **אין יותר "קפיצות"** של מסך הבית

- [ ] **T6.5** — Server.js Split (תחזוקה)
  - פצל server.js ל:
    ```
    routes/
    ├── player.js        (earn, spend, profile, gifts, code)
    ├── contests.js      (create, join, score, live, spectate)
    ├── challenges.js    (enter, score, complete, claim)
    ├── guilds.js        (create, join, contribute, wars)
    ├── shop.js          (skins, deals, gacha, bundles, boosters)
    ├── social.js        (friends, duels, referral)
    ├── boards.js        (dynamic boards, difficulty)
    ├── season.js        (season pass, trophy road)
    └── admin.js         (dashboard, config, export, players)
    ```

---

## PHASE 7 — Polish & Monetization
> ⏱ ~8 שעות | 🎯 הכנה ל-monetization אמיתי
> 💡 **למה זה ממכר**: "רק עוד משחק אחד ואני אקנה את הסקין הזה"

- [ ] **T7.1** — Battle Pass Visual (Free + Premium)
  - קובץ: `src/XX-season-pass-ui.js`
  - Two-track visual: Free (top) + Premium (bottom)
  - כל tier = node עם reward preview
  - Premium locked tiers = שקוף + 🔒
  - "UNLOCK PREMIUM — 500💎" CTA מהבהב

- [ ] **T7.2** — Weekly Events
  - Server: `events` table + admin UI to create
  - 3 rotating event types:
    1. **Golden Hour** (שעתיים, ×2 XP)
    2. **Chain Madness** (chains נותנות ×3 bonus)
    3. **Speed Rush** (timer 60 שניות, מירוץ ניקוד)
  - Banner מהבהב על מסך הבית כשevent פעיל

- [ ] **T7.3** — Rewarded Video Ads Prep
  - Client: `src/XX-ads.js` — placeholder for AdMob SDK
  - 3 ad surfaces:
    1. "צפה בסרטון ← +1 חיים" (lives refill)
    2. "צפה בסרטון ← ×2 score" (post-game)
    3. "צפה בסרטון ← free spin" (daily spin)
  - Server: `POST /api/player/ad-watch` (כבר קיים!)

- [ ] **T7.4** — Anti-Cheat Hardening
  - HMAC-signed score submission
  - Server-side game replay validation (seed + drops → expected score)
  - Anomaly detection: z-score > 3 → auto-flag

- [ ] **T7.5** — Multi-language Support (English)
  - קובץ: `src/XX-i18n.js`
  - Object עם `{ he: {...}, en: {...} }`
  - Auto-detect browser language
  - Fallback to Hebrew
  - **לפחות** אנגלית + עברית

---

## 📊 מעקב התקדמות

| Phase | משימות | הושלמו | % |
|-------|--------|--------|---|
| 0 — Critical Fixes | 5 | 5 | 100% |
| 1 — New Player Experience | 4 | 3 | 75% |
| 2 — Addiction Loops | 5 | 5 | 100% |
| 3 — Economy & Shop | 4 | 4 | 100% |
| 4 — Social & Competition | 5 | 0 | 0% |
| 5 — Admin Panel | 5 | 0 | 0% |
| 6 — Performance | 5 | 0 | 0% |
| 7 — Polish & Monetization | 5 | 0 | 0% |
| **סה"כ** | **38** | **17** | **44.7%** |

---

## 🧠 עקרונות ממכרות (זכור תמיד!)

1. **Variable Reward** — לא תמיד אותו פרס. הפתעות = dopamine.
2. **Loss Aversion** — "אתה עומד לאבד את הרצף!" חזק יותר מ-"בוא לשחק".
3. **Social Proof** — "🔥 47 שחקנים משחקים עכשיו" (כבר קיים!).
4. **Progress Illusion** — Trophy Road מראה כמה קרוב אתה ל-next reward.
5. **Endowed Progress** — תן reward אחרי המשחק הראשון (כבר קיים — welcome bonus).
6. **Sunk Cost** — "כבר השקעת 7 ימים רצוף — אל תשבור!"
7. **FOMO** — "דיל מוגבל! נגמר בעוד 3:42:18"
8. **Completion Drive** — "12/20 סקינים נאספו — עוד 8!"
9. **Social Competition** — "אורי עבר אותך! תחזור לנצח."
10. **Slot Machine Effect** — Gacha/spin = anticipation → reveal → dopamine

---

*עדכון אחרון: 24.05.2026*
*סמן ✅ ליד כל משימה שהושלמה ועדכן את טבלת המעקב.*
