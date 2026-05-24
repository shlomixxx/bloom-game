# 📋 BLOOM — משימות עתידיות

> **מסמך מרכזי לכל מה שעדיין לא נבנה.**
> עודכן: 2026-05-24 · 45 שלבים חיים בפרודקשן · 8 משימות פתוחות (A1+A2+A3+A4+A6+A7+A10 ✅)
>
> 🎯 **איך להשתמש**: בשיחה חדשה תגיד "בוא נבנה A1" / "המשך עם הכי ממכר" / "תעשה A2 + A3 ביחד" ואני אדע בדיוק על מה אתה מדבר.

---

## 🎯 PURE ADDICTION — מוכן לבנייה (אין צורך בכסף אמיתי / חוקיות)

10 רעיונות מדורגים לפי **השפעה × קלות מימוש**.
כל אחד מהם עצמאי — אפשר לבנות בכל סדר.

---

### A1 · 📬 Notification Inbox ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **המלצה ראשונה שלי**

**מה זה**:
בדג׳ אדום בפינה העליונה של הבית, עם מספר שמראה כמה דברים חדשים מאז הביקור האחרון. לחיצה → רשימה של כל המהלכים האחרונים — push notifications שפיספסת, הישגים שנפתחו, פרסים שמחכים, פעילות חברים, תוצאות טורנירים.

**למה לבנות**:
- ה-UI element הכי-נלחץ בכל המשחקים המובילים (Clash Royale, Brawl Stars, Royal Match)
- פותר בעיה אמיתית — אחרי 38 שלבים הבית מלא פיצ׳רים ושחקנים לא יודעים "מה חדש"
- מספר אדום = retention boost כפול (Genshin משקיעה $10M/שנה רק במספרים אדומים)
- חוצה את כל 4 גירסאות הבית (35) — יעבוד בכולן

**טכני**:
- טבלה חדשה `notification_inbox` (PK device_id + id, type, message, link, created_at, read_at)
- 1 endpoint `GET /api/inbox` + `POST /api/inbox/mark-read`
- UI: כפתור בפינה + modal עם רשימה גוללת

---

### A2 · 🎯 Friend Challenges ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- שחקן A לוחץ 🎯 ליד חבר במודאל החברים → modal "אתגר חבר" עם BLOOM code (pre-filled) + יעד ניקוד (input) + הודעה אופציונלית
- שרת מאמת ש-A ו-B חברים בפועל (`friendships`), יוצר row, שולח push ל-B
- שחקן B רואה את האתגר ב-inbox (✅ source חמישי) + (לעתיד: בתוך מודאל "האתגרים שלי")
- **Auto-resolve**: כל submission של ציון (`/api/score`, `/api/score/practice`, `/api/boards/:id/score`) מפעיל `_resolveFriendChallengesForGame(deviceId, score)` שסורק את כל ה-pending challenges של השחקן ומפליפ ל-`passed` כל אחד שהציון עבר את היעד שלו. Atomic UPDATE עם WHERE status='pending' guard.
- **שני הצדדים מקבלים 50💎** (config-tunable `friend_challenge_win_reward`). כל אחד → push: "🏆 ניצח/ה!"
- **24 שעות** ל-pending (config-tunable). אחרי = `failed_expired` אוטומטית (lazy-update בכל `/mine` fetch).
- Schema: טבלה `friend_challenges` + 4 config keys. Server: 3 endpoints (send / mine / decline). Inbox כולל פסים לכל מצב: ⏳ sent / 🎯 incoming / 🏆 passed / ⌛ expired / 🚫 declined.
- Client: [src/39-friend-challenges.js](src/39-friend-challenges.js) — IIFE עצמאי. Send modal + List modal. CSS לאדום-ורוד (theme של אתגרים).

**Loop ויראלי**: A מאתגר B עם 67K → push ל-B → B חוזר ומשחק → עובר → שניהם מקבלים 50💎 + push ל-A "B עבר אותך" → A רוצה להתנקם → מאתגר חזרה. K-factor במלוא מובן המילה.

---

### A3 · 🎁 Trophy Chests ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- 3 רמות תיבות (🎁 common / 💎 rare / 🏆 legendary) עם משכי פתיחה 4ש / 8ש / 24ש (admin-tunable)
- 4 slots פתוחים, אם כולם מלאים → אין דרופים חדשים
- רק תיבה אחת יכולה להיפתח בכל רגע נתון (Clash Royale pattern — בחירה אסטרטגית)
- Drop chance 50% על משחק עם score ≥ 500 (admin-tunable). Arena promotion = guaranteed Rare. Milestone claim = guaranteed Legendary.
- Schema: טבלה `trophy_chests` + 13 config keys
- Endpoints: `GET /api/chests/state`, `POST /api/chests/start-unlock`, `POST /api/chests/open`
- Client: [src/38-trophy-chests.js](src/38-trophy-chests.js) — IIFE עצמאי. Home tile (L10+, only-when-chests-exist) עם 4 icon-pills + countdown. Modal עם 4 קלפים. Full-screen rarity-themed celebration (legendary = 40 confetti particles, soundMilestone(7)).
- חיווט אוטומטי דרך Stage 38 — `_trophyGrantFromGame` קורא ל-`_maybeGrantChest` בסוף, ומחזיר `chestEarned` ל-client. Client trophy module fires the chest toast 1.2s אחרי trophy toast.

---

### A4 · 📊 Weekly Recap ("BLOOM Wrapped") ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- Auto-fires כל יום ראשון אחה"צ (12:00 IL+) בכניסה הראשונה לבית של השבוע. Per-week dedup דרך `localStorage[bloom_wrapped_seen_<YYYY-MM-DD>]`. Gate נוסף: לפחות 5 משחקים השבוע (אחרת ה-recap ייראה ריק/עצוב).
- Modal פתיחה דרמטי בגרדיינט סגול-ורוד-זהוב עם "🌟 Wrapped" כותרת + bouncing brand + 6 stat cards:
  - 🎮 משחקים, 🏆 שיא ניקוד, 💎 דרגת אריח מירבית (👑 = tier 8), ⚡ trophies שצברתי, 👥 חברים שיחקו איתי, 🏅 דרגה כללית
- Activity grade: A+/A/B/C/D לפי גיימים השבוע (100+/50+/25+/10+/<10)
- **Canvas-rendered 720×1280 PNG** מוכן לשיתוף: גרדיינט מעוצב + scattered emojis + huge grade + 6 stats + brand + URL
- 4 share buttons: 💬 WhatsApp (pre-filled text + URL) / 📤 Native share API (אם תומך file share — שולח את ה-PNG ישירות) / 📋 Copy (text only) / 💾 Save (download PNG)
- Server: `GET /api/weekly-recap?deviceId=` מצרף 6 sources במקבל: daily_scores + difficulty_scores + dynamic_board_scores + trophy_history + friendship_shared_days + player_profiles (כולל trophies מ-player_trophies). אפס schema חדש.
- Client: [src/40-weekly-recap.js](src/40-weekly-recap.js) — IIFE עצמאי. Canvas render, share modal, dedup logic. `window.__bloomWrapped.openNow()` לבדיקת ה-flow ב-devtools.

---

### A5 · ⚡ Live PvP Race
**מאמץ**: 3-4 ימים · **השפעה**: ★★★★★ · **הכי מורכב**

**מה זה**:
מרוץ real-time 60 שניות — שני שחקנים, אותו seed של לוח, מי שמגיע לציון הכי גבוה מנצח. רואים אחד את השני בזמן אמת.

**למה לבנות**:
- אדרנלין טהור — הכי "ממכר תוך כדי משחק" שיש
- ההבדל בין משחק casual ל-competitive
- מצדיק "עוד משחק אחד"

**טכני**:
- **דורש WebSocket** — תוספת אמיתית לסטאק
- Matchmaking queue + room management
- Sync של drops + scores בזמן אמת
- הכי מורכב מהרשימה — אבל גם הכי גדול

---

### A6 · 🎚 Skill-based Duel Matchmaking ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- כפתור "🎲 דו-קרב אקראי (חיפוש אוטומטי)" במודאל הdueles, ליד הכפתור הקיים "שלח אתגר".
- שחקן לוחץ → modal חיפוש עם spinner + countdown + "👥 N בתור · 🏆 ±M". Polling כל 3s.
- Server: `POST /api/duels/find-random` הוא **atomic match-or-queue** — בכל קריאה: (1) בדוק אם יש לי duel מתאים שכבר נוצר (אני הצד השני שעדיין מחפש); (2) נסה לחפש opponent בטווח trophy ←atomic FOR UPDATE SKIP LOCKED → אם נמצא: DELETE שני entries + CREATE duel + return matched; (3) אם לא נמצא: UPSERT my queue row + return searching.
- **Range מתרחב כל poll**: 50 → 200 → 350 → 500 → ∞. שחקן לא נשאר תקוע בשעה שקטה.
- Schema: טבלה `duel_matchmaking_queue` (PK device_id, trophy_count, joined_queue_at, poll_count, difficulty_label) + 5 config keys (enabled, range_initial, range_widen, max_wait_secs, wager=0). ALTER duels ADD COLUMN is_random_match.
- Duel נוצר עם `status='accepted'` ישירות (skip accept dance) + `is_random_match=TRUE`. Wager=0 (random duels are FREE).
- Push לצד השני (שעדיין מחפש) כש-match נוצר — backup ל-polling במקרה שהאפליקציה מינימייז.
- Client: [src/02-shop.js](src/02-shop.js) `startRandomMatchmaking(diff)` → spinner overlay → match-found flash (gold gradient pop) → auto-start `startDuelGame()`. כמובן: cancel button מסיר מהqueue. Cleanup interval 5min מנקה queue rows ישנים.

---

### A7 · 📅 7-Day Login Calendar ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- מסלול 7-יומי נפרד מה-daily login הקיים. כל יום ברצף = פרס גדל: 50 / 100 / 200 / 500 / 1000 / 2000 / **5000💎**. אחרי יום 7 — חוזר ליום 1 (cycle אינסופי).
- **פספסת יום** = reset ליום 1. ה-FOMO של איבוד הג׳קפוט (5000💎) ביום 7 הוא ה-driver העיקרי.
- Schema: 2 עמודות חדשות על `player_profiles` (`login_cal_day`, `login_cal_last_claim`) + 8 config keys (master + 7 reward tiers). אפס טבלה חדשה.
- Server: `GET /state` + `POST /claim` עם atomic transaction (FOR UPDATE על המ player_profiles row → diff days → advance/reset → atomic balance update + state save).
- Client: [src/41-login-cal.js](src/41-login-cal.js) — home tile (L5+) עם mini 7-grid + status pill + claim ribbon. Modal עם 7-card grid (4-col, day 7 פורש על 2 stretches כי זה ג׳קפוט) + "🎁 קבל X💎 עכשיו" + tip.
- Celebration: 3 tiers — normal (3 sound, 10 confetti), big (5 sound, 24 confetti, day 5-6), **jackpot** (day 7: gold border ענק + 50 confetti + 7-pulse buzz + 76px 👑 spinning).
- כפתור לא auto-claim — שחקן חייב ללחוץ (Clash Royale pattern — מרגיש earned).

**מה זה**:
רשת 7-ימים. כל יום פרס מצטבר: 50→100→200→500→1000→2000→**5000💎**. אם מפסיד יום אחד → מתחיל מההתחלה.

**למה לבנות**:
- Genshin Impact pattern — דוחף 7 ימים רצופים
- שונה מ-daily login הקיים (שהוא flat per-day)
- ה-FOMO של "להפסיד יום שביעי" עוצמתי

**טכני**:
- שדרוג של ה-daily login הקיים
- Visual: 7 כרטיסים גריד 4+3 או 7-בשורה

---

### A8 · 🏟 Squad Tournaments
**מאמץ**: 2 ימים · **השפעה**: ★★★★

**מה זה**:
מרחיב את Live Tournaments (Stage 12) לטורנירים בין **קלאנים**. 4 קלאנים מתחרים ב-bracket שבועי. הקלאן עם הציון הכולל הכי גבוה מנצח.

**למה לבנות**:
- משלים את Stage 27 (Guilds) ו-Stage 37 (Guild Wars)
- "אנחנו vs הם" — peer pressure לקלאן + תחרות לטורניר
- שילוב של 2 פיצ׳רים קיימים — חוזק מוכפל

**טכני**:
- טבלה `squad_tournaments` (id, bracket, status, week_start)
- 4-guild bracket — semi-finals + final
- כל המנגנון של Stage 12 + scoring per guild

---

### A9 · 👻 Ghost Mode
**מאמץ**: 2 ימים · **השפעה**: ★★★

**מה זה**:
תוך כדי משחק, רואה shadow/overlay חלש של ה-tile placements של חבר על אותו לוח. "נצח את הרוח שלו".

**למה לבנות**:
- מנגנון "intimate competition" — מרגיש כאילו החבר שם איתך
- מאתגר אבל לא מפריע
- מאריך זמן משחק

**טכני**:
- צריך לתעד drop sequences (כבר נעשה חלקית ב-spectator)
- Visual: tiles בצבע אפור-שקוף בעמודות בהם החבר זרק
- אפשרות להפעיל/לכבות

---

### A10 · 💰 Compound Interest Gem Bank ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- Tile ירוק-זוהר במסך הבית (L8+). הצגה: "💰 בבנק: 1,500💎 · ⏰ ריבית הבאה: בעוד 14ש"
- Modal: יתרה בארנק + יתרה בבנק + total earned. שתי שורות action (הפקדה / משיכה) עם 25%/50%/הכל preset buttons.
- "💡 מחר תהיה לך X💎" projection — psychological hook.
- Schema: טבלה `gem_bank` (device_id PK, deposited, total_interest_paid, last_interest_date) + 5 config keys (enabled, interest_pct=1, fee_pct=5, min_deposit=100, max_balance=1M).
- Server: 3 endpoints — GET /state (lazy-creates row, computes msUntilNext), POST /deposit (atomic UPDATE עם balance>=amount guard), POST /withdraw (atomic, fee deducted). Daily cron בorder of 03:00 IL — UPDATE כל ה-rows עם last_interest_date < today.
- Client: [src/42-gem-bank.js](src/42-gem-bank.js). 1% ריבית מצטברת → אחרי 30 יום על 1,000💎 → 1,348💎.
- Loss aversion: עמלת 5% בכל משיכה. השחקן יחשוב פעמיים לפני שמוציא.

---

## 💵 MONETIZATION — דורש Stripe + חוקיות

4 משימות לכסף אמיתי. דורשות חשבון Stripe + חוקיות (במיוחד #24).

| # | פיצ׳ר | מאמץ | תיאור |
|---|---|---|---|
| **17b** | 💳 Stripe IAP | 3-4י | מסלול דולרים אמיתי. דרישת בסיס ל-22/23/24 |
| **22** | ⭐ VIP subscription | 2י | $4.99/חודש auto-renew. MRR יציב. דורש 17b |
| **23** | 🎨 Real-money cosmetic shop | 2י | סקינים premium ב-USD בלבד. דורש 17b |
| **24** | 💸 Wager / RM tournaments | 4י | $1 כניסה, 70% פרס. **דורש אישור חוקי** (חוק הימורים בישראל) |

---

## 🚫 מחוץ ל-Scope — תחום שלך (לא תכנותי)

| משימה | סטטוס |
|---|---|
| 🌐 דומיין bloom-game.co.il | טרם נקנה |
| 📱 App Store listing (PWA wrapper) | לא נעשה |
| 📊 GA4 measurement ID | יש קוד, חסר ID — דרוש חשבון Google Analytics |
| 🎯 Landing page + SEO | לא נעשה |

---

## 📊 סיכום למבט מהיר

| קטגוריה | כמה | מצב |
|---|---|---|
| ✅ נבנו וחיים בפרודקשן | 38 שלבים | פעילים |
| 🎯 Pure Addiction backlog | 10 משימות | מוכן לבנייה — אין תלות |
| 💵 Monetization backlog | 4 משימות | דורש Stripe + חוקיות |
| 🚫 מחוץ ל-scope | 4 פריטים | תחום המשתמש |

**סך הכל**: **14 משימות פתוחות** שאני יכול לבנות מתי שתחליט.

---

## 🎯 ההמלצות שלי (לפי סדר)

### 1️⃣ הכי הגיוני להתחיל: **A1 (Notification Inbox)**
- 1-2 ימים בלבד
- פותר בעיה ממשית (overload של 38 פיצ׳רים)
- ה-UI הכי-נלחץ במשחקים מובילים
- חוצה את כל 4 גירסאות הבית

### 2️⃣ לויראליות: **A2 (Friend Challenges)**
- K-factor הכי חזק שיש
- מנצל infrastructure קיים
- 1-2 ימים

### 3️⃣ לחיזוק Stage 38: **A3 (Trophy Chests)**
- משלים את Trophy Road
- "must return" mechanic
- 1-2 ימים

### 4️⃣ למשהו ויראלי-משותף: **A4 (BLOOM Wrapped)**
- 1 יום בלבד
- Spotify pattern — נוסטלגיה + שיתוף
- מתאים מאוד לסוף השבוע

---

## 📝 איך לפתוח שיחה חדשה ולהמשיך

תגיד אחד מהבאים ואני אדע בדיוק מה לבנות:

```
"בוא נבנה A1"          → בונה Notification Inbox
"תעשה A2 + A3 ביחד"     → בונה Friend Challenges + Trophy Chests
"המשך עם הכי ממכר"      → אני אבחר A1 (לפי ההמלצה)
"מה ב-FUTURE_TASKS.md?" → אקרא את הקובץ ואסכם
"שכח A10, תוסיף X"      → מעדכן את הרשימה
```

---

*קובץ זה מתעדכן אוטומטית כשבונים פיצ׳ר חדש או כשמוסיפים רעיון לbacklog.*
