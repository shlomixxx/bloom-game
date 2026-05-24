# 🔍 BLOOM — ביקורת מקיפה (Full Audit Report)

> **מטרת-על**: להפוך את BLOOM למשחק הכי ממכר שאפשר.
> כל בעיה ברשימה הזו פוגעת ב-retention, בהבנה של השחקן, או ביכולת האדמין לנהל.
> המסמך הזה הוא ה-reference — הקובץ השני (`BLOOM_TASKS.md`) מפרק את הכל למשימות.

---

## 🏗 ארכיטקטורה

### A1 · server.js — 13,180 שורות בקובץ אחד
- 135 API routes, הכל בקובץ אחד
- כל שינוי קטן מסכן את כל השרת
- בלתי אפשרי לעשות code review, לבדוק, או לתחזק
- **פתרון**: פצל ל-router files — `routes/player.js`, `routes/contests.js`, `routes/challenges.js`, `routes/guilds.js`, `routes/admin.js`, `routes/shop.js`, `routes/dynamic-boards.js`

### A2 · app.js — 24,800 שורות IIFE אחד
- כל הקליינט בקובץ אחד (כבר פוצל ל-`src/` — build.sh מחבר)
- 19 `maybeShow*` functions שנקראות ב-setTimeout מדורג (400ms-3200ms)
- 269 קריאות localStorage ללא try/catch wrapper
- **פתרון**: wrapper function ל-localStorage, consolidate API calls

### A3 · 60 טבלאות ב-schema.sql
- חלק מהטבלאות ריקות או לא בשימוש אמיתי (wager_settlements, daily_jackpot)
- dedup keys שמורים ב-game_config — מנפחים את הטבלה
- `game_config` משמשת גם להגדרות וגם ל-dedup — 127 references בקוד
- **פתרון**: טבלת `earn_dedup` נפרדת, audit של טבלאות לא בשימוש

### A4 · XP/Level חסרים ב-schema.sql
- עמודות `xp` ו-`level` על `player_profiles` נוספות רק ב-`db.js` (שורות 43-44)
- מי שמריץ `schema.sql` ידנית (כמו ב-README) — הכל ישבר
- **פתרון**: הוסף `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS xp/level` ל-schema.sql

---

## ⚡ ביצועים

### P1 · 15-20 DB queries בכל כניסה למסך הבית
- כל feature (lives, pet, gacha, season, deals, bundles, checklist, spin...) מריץ `SELECT FROM game_config WHERE key LIKE '...'` נפרד
- 19 maybeShow → 19 fetch → 19 server endpoints → 19+ LIKE queries
- **פתרון**: `GET /api/home-state?deviceId=...` אחד שמחזיר הכל. Match Masters עושה בדיוק את זה.

### P2 · game_config מנופחת
- 300K+ שורות dedup (`_earn:deviceId:action:date:meta`) אחרי חודש עם 1K שחקנים
- LIKE queries (`WHERE key LIKE 'pet_%'`) סורקות את כל הטבלה כולל dedup junk
- Cleanup cron מנקה רק אחרי 30 יום
- **פתרון**: טבלת `earn_dedup(device_id, action_key, earned_date)` עם PK + TTL 7 ימים

### P3 · loadConfig cache לא בשימוש
- `loadConfig()` עם cache 60s קיים — אבל רק `/api/config` משתמש בו
- כל שאר ה-endpoints (lives, pet, gacha, season...) קוראים ל-DB ישירות
- **פתרון**: פונקציית `getConfigValue(key)` שקוראת מה-cache, כל ה-endpoints משתמשים בה

### P4 · Rate Limiting in-memory
- `checkRateLimit` שומר counters בזיכרון — restart = reset
- עם מספר instances — לא יעבוד
- **כרגע OK** (instance אחד), אבל עם scale צריך Redis

### P5 · אין DB connection pool tuning
- pg Pool עם defaults — צריך לכוונן `pool.max`, `idleTimeoutMillis`, `connectionTimeoutMillis`

---

## 🎮 חוויית שחקן (Player UX)

### UX1 · מסך בית עמוס — "Feature Explosion"
> **🎯 זו הבעיה #1 שפוגעת ב-retention של שחקנים חדשים**

- שחקן חדש רואה 19 feature tiles מהרגע הראשון
- Lives, Trophy Road, Spin, Checklist, Pet, Daily Deal, Season Pass, Gacha, Bundle, Guild, Rival, League, War, Album, Achievements, Lifetime, Contests, Challenges, Duels
- ב-Match Masters: שחקן חדש רואה **רק Play + Leaderboard**. פיצ'רים נפתחים בהדרגה לפי trophy level
- **פתרון**: Progressive Unlock — פיצ'רים מתגלים לפי XP/Level:
  - Level 1-3: שחק + leaderboard בלבד
  - Level 5: תחרויות חברים
  - Level 8: סקינים
  - Level 10: דו-קרב
  - Level 12: season pass
  - Level 15: guilds
  - Level 20: gacha, leagues

### UX2 · אין FTUE/Tutorial אינטראקטיבי
- ה-Tour הנוכחי רק מסביר בטקסט
- אין "שחק תור ראשון עם הדרכה" כמו ב-Match Masters
- שחקן חדש לא מבין מה לעשות
- **פתרון**: 3 צעדים אינטראקטיביים:
  1. "לחץ על העמודה להטיל חלק" (highlight עמודה)
  2. "מזג שני חלקים זהים!" (highlight זוג)
  3. "שרשרת! ניקוד כפול!" (trigger chain)
  - אחרי 3 drops ← "מעולה! עכשיו שחק לבד" ← משחק אמיתי מתחיל

### UX3 · אין Progress Bar / Trophy Road ויזואלי
- יש XP ו-Level אבל **השחקן לא רואה את זה**
- אין progress bar בולט, אין מסלול התקדמות ויזואלי
- ב-Match Masters: Trophy Road הוא המנוע המרכזי — כל ניצחון מקדם אותך
- **פתרון**: הוסף Trophy Road strip בראש מסך הבית:
  ```
  [★1]──[★2]──[★3🎁]──[★4]──[★5🔓contests]──[★6]...
  ```
  כל level פותח משהו חדש + reward

### UX4 · Balance/Wallet לא נראה
- השחקן צובר gems אבל אין widget קבוע שמראה את היתרה
- צריך להיכנס לחנות כדי לגלות כמה יש לו
- ב-Match Masters: coins + gems מוצגים **תמיד** בראש המסך
- **פתרון**: Header bar קבוע: `💎 1,250  |  ❤️ 4/5  |  🔥 7-day streak`

### UX5 · הודעות שגיאה — alert() במקום toast
- הרבה שגיאות מוצגות כ-`alert('שגיאה')` או `alert('שגיאת רשת')`
- מערכת `showToast()` כבר קיימת ועובדת!
- **פתרון**: החלף כל `alert()` ב-`showToast(message, type)`

### UX6 · Score submission נכשל בשקט
- אם `submitAndShowLeaderboard()` נכשל — רק `console.warn`
- השחקן לא יודע שהציון לא נשמר. אין retry.
- **פתרון**: `showToast('הציון לא נשמר — נסה שוב', 'error')` + retry queue + כפתור "שלח שוב"

### UX7 · Daily date מחושב client-side
- `dailyDate` לפי timezone של הלקוח — שעון שגוי = date שגוי
- הסרבר לא מוודא שה-date הגיוני
- **פתרון**: validation בסרבר: `|submitted_date - server_today| <= 1`

### UX8 · Skin Trial ללא timeout
- `startSkinTrial()` מחליף סקין אבל אין timer שמחזיר
- סוגר ופותח = trial נצחי
- **פתרון**: timeout 60 שניות + שמור `trialStartedAt` ב-localStorage

### UX9 · Share/Emoji רק בעברית
- כל טקסטי ה-share הם בעברית. שחקנים לא ישראלים לא יבינו
- **פתרון**: זיהוי שפה או לפחות fallback לאנגלית

### UX10 · Loading States — מסך "קופץ"
- 19 tiles נטענים ב-setTimeout מדורג (400ms-3200ms)
- מסך הבית "קופץ" — tiles נוספים תוך כדי scrolling
- **פתרון**: Skeleton loaders, או single API call ← render הכל ביחד

### UX11 · Lives System לא מוסבר
- מערכת חיים קיימת אבל מושבתת (lives_enabled='false')
- כשתופעל — אין popup שמסביר לשחקן למה לא יכול לשחק
- **פתרון**: First-time popup: "יש לך 5 חיים. כל משחק עולה 1. חיים חוזרים כל 30 דקות."

### UX12 · Duel UX חסר
- דו-קרב אסינכרוני — אין notification ליריב
- אין countdown / expiry ברור
- אין "best of 3" / rematch
- **פתרון**: Push notification אוטומטי + timeout 24h ב-UI + rematch button

### UX13 · אין Notification Center / Inbox
- Push notifications קיימים אבל אין "Inbox" שמרכז הודעות
- תוצאות דו-קרב, gifts, guild events — אין מקום מרכזי
- **פתרון**: 🔔 icon עם badge count → inbox slide-out

### UX14 · אין Daily Login Calendar ויזואלי
- יש calendar_events ב-DB אבל ה-UI בסיסי
- ב-Match Masters: לוח חודשי מלא עם כל יום מסומן
- **פתרון**: 30-day grid, ✓ על ימים שעברו, הבהוב על היום, bonus days מוזהבים

### UX15 · Google Analytics לא מוגדר
- `GA_MEASUREMENT_ID` הוא placeholder — אין tracking אמיתי
- אתה עיוור לגבי מה שקורה עם שחקנים
- **פתרון**: החלף ב-ID אמיתי מ-GA4

---

## 🛠 פאנל אדמין

### AD1 · אין Config Editor ב-UI (API קיים!)
- `adminRouter.patch('/api/config/:key')` קיים ועובד
- אבל admin/index.html לא מציג UI לעריכה
- אדמין חייב SQL/curl כדי לשנות מחירי items, פרסים, regen time
- **פתרון**: טבלה + edit button שקורא ל-PATCH. ~2 שעות עבודה, חצי בנוי.

### AD2 · אין Challenge Creator
- אפשר ליצור challenges רק דרך SQL
- חסם ענק לתפעול יומיומי
- **פתרון**: Form: שם, סוג, threshold, winners, prize, dates, publish

### AD3 · אין Bot Control UI
- bot-engine.js = 25K שורות סימולציית משחק מלאה
- Routes קיימים (startBots, stopBots, getBotStatus) — אין UI
- **פתרון**: Bot section: toggle on/off, active count, last activity

### AD4 · Player Drill-Down חלקי
- חסר: היסטוריית רכישות, gems timeline, session history, flag/unflag cheat
- **פתרון**: Player detail page עם tabs

### AD5 · אין Push Notification Management
- קוד push קיים אבל אין ממשק לשלוח push לקבוצות
- **פתרון**: Send Push page: audience selector → message → send

### AD6 · Contest Mode לא ניתן לשינוי
- `score_mode` (cumulative/best) נקבע ביצירה, אי אפשר לתקן טעות
- **פתרון**: הוסף edit ב-admin panel

---

## 🔒 אבטחה ו-Data Integrity

### S1 · Multi-device gem farming
- יצירת deviceId חדש → welcome_bonus (100💎) → gift-friend לעצמך → חוזר
- 10 פעמים = 1000💎 חינם
- **פתרון**: הגבל gift-friend ל-accounts בני 7+ ימים, או cap יומי

### S2 · Challenge cheat_flag ללא אכיפה
- `cheat_flag BOOLEAN` קיים — אבל אין disqualification אוטומטי
- **פתרון**: Auto-disqualify if cheat_flag=true + admin button

### S3 · display_name לא synced בין טבלאות
- שינוי שם ב-`/api/profile/name` מעדכן `player_profiles`
- ציונים ישנים ב-`daily_scores` נשארים עם השם הישן
- בלוח תוצאות: אותו שחקן מופיע פעמיים עם שמות שונים
- **פתרון**: JOIN על player_profiles ב-leaderboard query, או batch update

### S4 · SQL injection — בטוח (✓)
- כל ה-dynamic SQL (scoreReducer, findCol, CSV export) — validated server-side
- Parameterized queries ($1, $2) בשימוש עקבי

### S5 · Security headers — טובים (✓)
- HSTS, CSP, X-Frame-Options, CORS strict, HMAC tokens — הכל מוגדר

---

## 🎯 חסר בהשוואה ל-Match Masters (Addiction Features)

### MM1 · אין PvP בזמן אמת
- ב-Match Masters: 1v1 על אותו לוח = הליבה
- ב-BLOOM: דו-קרב אסינכרוני (שחקן A משחק, שחקן B משחק מאוחר)
- **פתרון**: Live Duel — שני שחקנים, אותו seed, בו-זמנית, timer

### MM2 · אין Booster Economy
- ב-Match Masters: 30+ boosters שונים, קונים לפני כל משחק
- ב-BLOOM: tiles לקנייה בלבד
- **פתרון**: 5 boosters:
  - 🔀 "ערבב לוח" — shuffle all tiles
  - 🎯 "בחר tile" — pick next piece (tier 1-3)
  - 💥 "הסר שורה" — clear bottom row
  - ×2 "ניקוד כפול" — 30 seconds double points
  - 🛡 "חיים נוספים" — extra row before game-over

### MM3 · אין Sticker Album מלא
- ב-Match Masters: Album + sticker trading + set completion rewards
- ב-BLOOM: album בסיסי מאוד
- **פתרון**: UI ברור, progress bar per set, rewards על השלמה, trading

### MM4 · אין Events מתחלפים
- ב-Match Masters: events כל 3 ימים עם מכניקות שונות
- ב-BLOOM: אין event system
- **פתרון**: Weekly rotating events — "Golden Hour", "Chain Madness", "Speed Rush"

### MM5 · Guild System בסיסי
- ב-Match Masters: teams = חלק מרכזי (chat, challenges, wars)
- ב-BLOOM: guilds קיימים אבל UX בסיסי
- **פתרון**: Guild chat, weekly guild challenge, guild wars with rewards

### MM6 · אין Battle Pass שלם
- Season Pass קיים אבל UX לא ברור
- **פתרון**: Free track + Premium track side-by-side, ויזואלי, "UNLOCK PREMIUM" CTA

---

## ✅ מה שעובד טוב (לא לגעת!)

- ✅ מנוע מיזוג (BFS + gravity + chains) — יציב ומדויק
- ✅ Atomic wallet deductions — אין race conditions
- ✅ Security headers + CORS + HMAC tokens
- ✅ Admin dashboard KPIs, retention, funnel
- ✅ Live spectator mode — פיצ'ר ייחודי
- ✅ Rate limiting על כל endpoint רגיש
- ✅ Demo seeder לבדיקות
- ✅ Cleanup crons (heartbeat, PII purge, live state, dedup)
- ✅ Anti-cheat: score ceiling, drops validation, dedup allowlists
- ✅ Contest name-clash protection
- ✅ Bot engine with realistic gameplay simulation

---

*מסמך זה נכתב ב-24.05.2026. עדכן אותו כשנמצאות בעיות חדשות או נפתרות קיימות.*
