# 📋 BLOOM — משימות עתידיות

> **מסמך מרכזי לכל מה שעדיין לא נבנה.**
> עודכן: 2026-05-24 · 39 שלבים חיים בפרודקשן · 13 משימות פתוחות (A3 Trophy Chests ✅)
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

### A2 · 🎯 Friend Challenges
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **המלצה לויראליות**

**מה זה**:
"אני מאתגר אותך לעבור 67K בלוח X" — דחיפה ישירה לחבר עם deep-link ללוח. כשהוא מסיים, אתה מקבל push עם הציון שלו. הדדי.

**למה לבנות**:
- K-factor הכי חזק שיש — כל אתגר = פוטנציאל לעוד שחקן
- מנצל את כל ה-infrastructure הקיים (friends + push + dynamic boards)
- שחקנים מאתגרים אחד את השני = שעות משחק נוספות

**טכני**:
- טבלה `friend_challenges` (challenger, challenged, board_id, target_score, status)
- 3 endpoints: send / accept / complete
- Push notif בכל מעבר סטטוס

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

### A4 · 📊 Weekly Recap ("BLOOM Wrapped")
**מאמץ**: 1 יום · **השפעה**: ★★★★

**מה זה**:
כל יום ראשון אחה"צ — מסך full-screen מסכם את השבוע: כמה משחקים שיחקת / שיא חדש / כמה trophies הרווחת / עם איזה חברים שיחקת / כמה שעות. סיום ב-image מוכן לשיתוף.

**למה לבנות**:
- Spotify Wrapped pattern — הוויראלי ביותר שיש
- שחקנים אוהבים להתפאר במספרים שלהם
- מעודד שיתוף = הגעה לחברים חדשים

**טכני**:
- 1 endpoint שמרכז סטטיסטיקות (קיים ב-DB)
- Canvas-rendered share image (כמו Stage 32 replay)
- Modal שמופיע אוטומטית בכניסה הראשונה ביום ראשון

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

### A6 · 🎚 Skill-based Duel Matchmaking
**מאמץ**: 1 יום · **השפעה**: ★★★★

**מה זה**:
כרגע דו-קרבים הם רק חבר-לחבר עם קוד. הוסף "🎲 דו-קרב אקראי" שמזווג אוטומטית שחקנים בטווח trophy דומה (±200 trophies).

**למה לבנות**:
- מנגיש דו-קרבים לשחקנים סולואיים (אין להם חברים שמשחקים)
- מנצל את Stage 38 Trophy ranges
- מאוד פשוט לבנות מעל ה-duels הקיים

**טכני**:
- 1 endpoint `POST /api/duels/random-match`
- Pool של שחקנים שלחצו "מחפש יריב" — מתאים בין שניים תוך 30 שניות
- שאר ה-duel flow זהה לקיים

---

### A7 · 📅 7-Day Login Calendar
**מאמץ**: 1 יום · **השפעה**: ★★★

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

### A10 · 💰 Compound Interest Gem Bank
**מאמץ**: 1 יום · **השפעה**: ★★★

**מה זה**:
שחקן "מפקיד" 💎 בבנק וצובר **1%/יום ריבית פסיבית**. ככל שמשאיר יותר זמן — צובר יותר. יציאה עולה 5% עמלה (מונע חיסכון קצר).

**למה לבנות**:
- Behavioral economics — שחקנים שונאים להחסיר רווחים
- מצדיק "סתם להיכנס לבית" כל יום (לראות כמה צבר)
- שילוב מעניין של חיסכון + רטנשן

**טכני**:
- טבלה `gem_bank` (device_id, balance, deposited_at)
- Cron יומי לחישוב ריבית
- 2 endpoints: deposit / withdraw

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
