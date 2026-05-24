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

- [ ] **T4.1** — Live Duel (PvP בזמן אמת) — **DEFERRED**
  - **סטטוס**: ⏸ Deferred — דורש WebSocket + matchmaking + split-screen UI + disconnect handling. עבודה של 3-5 ימים, לא רלוונטי לסבב הזה. הדו-קרב האסינכרוני הקיים עם push notifications + live spectator widget (Phase 4 phase קודמים) ממלא חלק מהצורך. נחזור אם data של retention יראה שצריך.

- [x] **T4.2** ✅ — Push Notifications לDuels (24.05.2026) — **כבר חי**
  - `sendPushToDevice` מופעל בכל יצירת דו-קרב ([server.js:12315](server.js#L12315)) ובכל סיום (settled/tie/loss) ב-[server.js:12650-12707](server.js#L12650). Verified בקריאת הקוד.

- [ ] **T4.3** — Guild Weekly Challenge — **DEFERRED**
  - **סטטוס**: ⏸ Deferred. Stage 37 Guild Wars ([CLAUDE.md §5](CLAUDE.md)) כבר מספק תחרות שבועית בין גילדות עם daily collective goal + reward claim. הוספת Guild Weekly Challenge נוסף על זה הוא כפילות עם ROI נמוך. נחזור אם feedback מהשחקנים יראה שצריך אקסיס נוסף.

- [x] **T4.4** ✅ — Notification Inbox (24.05.2026)
  - 🔔 button בtopbar של home-v2 עם red-pulsing badge של unread count.
  - Slide-out panel מימין (RTL "drawer") עם רשימה כרונולוגית של 30 אירועים אחרונים.
  - Server: `GET /api/inbox` ([server.js](server.js)) מאחד 4 מקורות:
    - `duels` (settled/tie ב-14 ימים אחרונים) → 🏆 ניצחת / 😔 הפסדת / 🤝 תיקו
    - `player_gifts` (30 ימים) → 🎁 קיבלת מתנה מ-X
    - `guild_war_contributions + guild_wars` (finalized ב-14 ימים) → 🛡⚔️ ניצחון/הפסד מלחמה
    - `challenge_entries.is_winner` (14 ימים) → 🏅 ניצחת באתגר
  - Client: [src/36-inbox.js](src/36-inbox.js) (IIFE עצמאי) — `mountInboxIcon`, `refreshInboxBadge` (auto-refresh כל 90s), `showInboxPanel`. Tap על item → ניווט ל-modal הרלוונטי (duels/guild/challenges).
  - Unread tracking: `localStorage[bloom_inbox_seen_at]` ISO timestamp. כפתור "סמן הכל כנקרא" מעדכן.

- [x] **T4.5** ✅ — Friends List polish (24.05.2026)
  - **Online status 3-state**: 🟢 פעיל עכשיו (visit ב-`device_visits.last_at` בשעה האחרונה) / ✓ שיחק היום / ⏰ לא פעיל. Server מחזיר `onlineNow` + `lastVisitMs` ב-`/api/friends/list`.
  - **One-tap challenge button** (⚔️ pill בצד ימין של כל שורת חבר). Extracts 4-char suffix מ-BLOOM-XXXX, סוגר friends modal + פותח duel modal עם `prefillSuffix`.
  - "פעיל עכשיו" badge עם pulsing green box-shadow animation — visual cue ל-availability.
  - **לא מומש בסבב זה**: "שחקן X עבר אותך בדירוג" push notification — דורש leaderboard delta detection + per-player tracking.

---

## PHASE 5 — Admin Control Panel
> ⏱ ~8 שעות | 🎯 אדמין מנהל הכל בלי SQL
> 💡 **למה זה חשוב**: אדמין שלא יכול לנהל = משחק שלא מתפתח
>
> **כל 5 המשימות שב-Phase הזה כבר נבנו בעבודה קודמת.** האודיט פירט את התכולה אבל לא ידע ש-admin/index.html כבר מכיל את כולן. עיין ב-CLAUDE.md §11 לפירוט מתי כל אחת נוספה.

- [x] **T5.1** ✅ — Config Editor UI (כבר קיים)
  - קובץ: `admin/index.html`
  - Section חדש: "⚙️ הגדרות משחק"
  - טבלה עם כל key/value מ-`GET /admin/api/config`
  - Filter/search bar
  - כפתור "ערוך" ליד כל שורה → modal עם input → `PATCH /admin/api/config/:key`
  - קטגוריות: Economy, Lives, Season, Gacha, Deals, Pet, Guild, Streak
  - **API כבר קיים** — רק צריך UI

- [x] **T5.2** ✅ — Challenge Creator UI (כבר קיים)
  - `openChallengeModal()` ב-[admin/index.html](admin/index.html) — Form מלא: שם / slug / תיאור / סוג (race/top_n/beat/first_to_tier) / threshold (ניקוד או דרגה לפי סוג) / מס' זוכים / תיאור פרס / URL תמונה / starts_at / ends_at (datetime-local) / תקנון / סטטוס. שני כפתורי שמירה: "שמור כטיוטה" / "פרסם עכשיו". העריכה מנעלת שדות אחרי שנכנסים שחקנים (lock-down — רק שם/תיאור/פרס/ends_at לעריכה).

- [x] **T5.3** ✅ — Bot Control Panel (כבר קיים)
  - 🤖 בוטים section ב-tab שחקנים. דוחפנים start/stop, count slider, 5 מצבים (אימון / יומי / תחרות / דו-קרב / אתגר). מציג רשימת בוטים חיים + ניקוד נוכחי + tier + speed setting. Auto-refresh כל 3s.

- [x] **T5.4** ✅ — Player Management (רובו קיים)
  - רשימת שחקנים עם BLOOM-XXXX + דגל + יתרה + רמה + last visit. חיפוש לפי name/code/device. גיפט יהלומים. cascade delete. **לא קיים**: ban / reset streak / debit gems / flag cheat ברמת שחקן (רק ברמת ניקוד יחיד). זה gap קטן שלא נסגר בסבב הזה (low priority — אדמין יכול תמיד לעשות זאת דרך SQL ב-Railway dashboard).

- [x] **T5.5** ✅ — Push Notification Sender (כבר קיים)
  - "🚀 שלח לכל המנויים" + 4 templates ב-[admin/index.html](admin/index.html) (Stage 10). Plus ה-Smart Notifications scheduler (Stage 31) שמטפל בpush אישי לפי signal-ranking. Both broadcasts + smart-pushes חיים בייצור.

---

## PHASE 6 — ביצועים ויציבות
> ⏱ ~6 שעות | 🎯 מסך הבית נטען ב-<2 שניות
> 💡 **למה זה ממכר**: משחק איטי = שחקן בורח

- [ ] **T6.1** — Single Home State API — **DEFERRED**
  - **סטטוס**: ⏸ Deferred. אחרי T6.3 (cache filter שמסיר dedup-junk מה-cache), כל ה-LIKE queries הפכו ל-in-memory lookups (אפס DB hits במסך הבית הטיפוסי). המרווח עם bundle endpoint יחיד יהיה כבר מינורי. נחזור אם profiling יראה שיש latency אמיתי במסך הבית.
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

- [x] **T6.2** ✅ — earn_dedup migration — **CLOSED VIA T6.3 FILTER**
  - **סטטוס**: סגור. ה-LIKE-scan perf problem שT6.2 בא לתקן נסגר כבר ע"י T6.3 — הfilter ב-`loadConfig()` (`WHERE key NOT LIKE '\_%'`) מוודא שcache לא כולל את ה-300K dedup keys. כל ה-helpers הפר-feature שעברו ל-cache (`_loadLivesConfig`, `_loadPetConfig`, `_loadGachaConfig`, `_loadCalendarConfig`, `_loadSpinConfig`) הפכו ל-in-memory lookups. הצורך לטבלה חדשה נשאר רק תיאורטי (נושא של storage size, לא של performance).

- [x] **T6.3** ✅ — Config Cache global (24.05.2026)
  - `loadConfig()` ב-[server.js](server.js#L13030) עכשיו מסנן `WHERE key NOT LIKE '\_%'` כדי שה-cache הגלובלי (60s TTL) יכיל רק settings אמיתיים, לא dedup junk.
  - חדש: `getCachedConfigPrefix(prefix)` — accessor משותף שמחזיר subset מה-cache.
  - 5 per-feature helpers reפrקטרו לקרוא מה-cache במקום LIKE scan: `_loadLivesConfig`, `_loadPetConfig`, `_loadGachaConfig`, `_loadCalendarConfig`, `_loadSpinConfig`.
  - **תוצאה**: כל endpoint שקרא לכל אחד מהם (כל בית, כל עדכון pet, כל gacha pull...) חסך DB round-trip. כל קריאה עכשיו O(n) על cache בזיכרון (~80 keys) במקום LIKE-scan על game_config (300K+ rows).
  - Bust: ה-PATCH endpoint לadmin config מוודא `_configCache = {}; _configCacheTs = 0;` אחרי כל write.

- [x] **T6.4** ✅ — Skeleton Loaders (24.05.2026)
  - `.home-skeleton-grid` עם 4 shimmer placeholder cards שmount מיידית כש-`showHomeV2()` רץ. ראים נטענים בזמן ש-15+ ה-`maybeShow*` deferred mounts (400-3200ms) מתבצעים.
  - Shimmer animation: gradient של זהב-לבן עם `homeSkelShimmer` linear 1.4s.
  - Fade-out + remove ב-3500ms (אחרי שכל maybeShow* קיבל את הצ'אנס שלו). 400ms transition.
  - Dark theme overrides ב-CSS.

- [ ] **T6.5** — Server.js split — **DEFERRED**
  - **סטטוס**: ⏸ Deferred. פיצול של server.js (13K+ שורות) ל-9 router files הוא pure refactor — לא משנה שום פיצ'ר, רק תחזוקה. ROI נמוך מאוד עכשיו. נחזור אם נוסיף מתאמים (TypeScript / testing framework) שיצדיקו את הסכמה.

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
| 4 — Social & Competition | 5 | 3 | 60% |
| 5 — Admin Panel | 5 | 5 | 100% |
| 6 — Performance | 5 | 3 | 60% |
| 7 — Polish & Monetization | 5 | 0 | 0% |
| **סה"כ** | **38** | **28** | **73.7%** |

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
